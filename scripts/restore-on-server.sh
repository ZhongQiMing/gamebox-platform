#!/bin/bash
# 从备份包恢复。两种模式：
#
#   bash restore-on-server.sh                        列出可用备份
#   bash restore-on-server.sh --rehearse latest      演练：灌进一个临时库校验，不动线上
#   bash restore-on-server.sh --production <包>      真恢复：会覆盖线上数据
#
# 请每月跑一次演练。备份文件损坏、导出漏表、恢复顺序触发外键报错这些问题，
# 只有真恢复一次才会暴露。等出事那天第一次尝试，是最糟糕的时机 ——
# 那时候你在停机、玩家在等，而你在看一条从没见过的报错。
#
# 没恢复过的备份不算备份，只算一个占地方的文件。
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/gamebox-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.images.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/gamebox-backups}"
PG_SERVICE="${PG_SERVICE:-postgres}"
DB_NAME="${DB_NAME:-gamebox}"
DB_USER="${DB_USER:-gamebox}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-gamebox_uploads}"
HELPER_IMAGE="${HELPER_IMAGE:-postgres:15-alpine}"
SCRATCH_DB="${SCRATCH_DB:-gamebox_restore_test}"

cd "$DEPLOY_DIR"
dc() { docker compose -f "$COMPOSE_FILE" --env-file .env.prod "$@"; }
psql_db() { dc exec -T "$PG_SERVICE" psql -U "$DB_USER" -d "$1" -v ON_ERROR_STOP=1 "${@:2}"; }

die() { echo "$*" >&2; exit 1; }

resolve_archive() {
  local a=$1
  if [ "$a" = latest ]; then
    a=$(ls -t "$BACKUP_DIR"/gamebox-backup-*.tar.gz 2>/dev/null | head -1 || true)
    [ -n "$a" ] || die "$BACKUP_DIR 里没有备份包"
  fi
  [ -f "$a" ] || a="$BACKUP_DIR/$a"
  [ -f "$a" ] || die "找不到备份包：$1"
  printf '%s' "$a"
}

manifest_get() { tar -xzOf "$1" ./manifest.txt | sed -n "s#^$2=##p" | head -1; }

# ── 列表 ──────────────────────────────────────────────────
if [ $# -eq 0 ]; then
  echo "备份目录 $BACKUP_DIR"
  echo ""
  found=0
  for f in $(ls -t "$BACKUP_DIR"/gamebox-backup-*.tar.gz 2>/dev/null || true); do
    found=1
    printf '  %-42s %6s  用户 %-6s 余额合计 %s\n' \
      "$(basename "$f")" "$(du -h "$f" | awk '{print $1}')" \
      "$(manifest_get "$f" User)" "$(manifest_get "$f" balance_sum)"
  done
  [ "$found" = 1 ] || echo "  （空。先跑 backup-on-server.sh）"
  echo ""
  echo "演练（不动线上）：bash $0 --rehearse latest"
  echo "真恢复（覆盖线上）：bash $0 --production <包名>"
  exit 0
fi

MODE=$1
ARCHIVE=$(resolve_archive "${2:-latest}")
echo "备份包 $ARCHIVE"
echo "备份于 $(manifest_get "$ARCHIVE" created_at)（应用版本 $(manifest_get "$ARCHIVE" app_version)）"
echo ""

# 备份时刻的行数，恢复后要逐项对上
declare -A EXPECT
while IFS='=' read -r k v; do
  case "$k" in
    User|PointsAccount|PointsLedger|Agent|Room|balance_sum) EXPECT[$k]=$v ;;
  esac
done < <(tar -xzOf "$ARCHIVE" ./manifest.txt)

# 恢复后回查同样的口径，与 EXPECT 对照
verify_into() {
  local db=$1 bad=0
  local actual
  actual=$(psql_db "$db" -tAF'|' -c "
    SELECT 'User', count(*)::text FROM \"User\"
    UNION ALL SELECT 'PointsAccount', count(*)::text FROM \"PointsAccount\"
    UNION ALL SELECT 'PointsLedger', count(*)::text FROM \"PointsLedger\"
    UNION ALL SELECT 'Agent', count(*)::text FROM \"Agent\"
    UNION ALL SELECT 'Room', count(*)::text FROM \"Room\"
    UNION ALL SELECT 'balance_sum', COALESCE(sum(balance),0)::text FROM \"PointsAccount\"
  ")
  printf '  %-16s %-14s %-14s %s\n' 项 备份时 恢复后 结果
  while IFS='|' read -r k v; do
    [ -n "$k" ] || continue
    local want=${EXPECT[$k]:-}
    # 余额是 numeric，18.00 与 18 是同一个数，交给数据库判等而不是比字符串
    local ok=否
    if [ "$want" = "$v" ]; then
      ok=一致
    elif [ "$k" = balance_sum ] && [ -n "$want" ] \
      && [ "$(psql_db "$db" -tAc "SELECT ${want}::numeric = ${v}::numeric")" = t ]; then
      ok=一致
    else
      bad=1
      ok='不一致 <<<'
    fi
    printf '  %-16s %-14s %-14s %s\n' "$k" "${want:-?}" "$v" "$ok"
  done <<< "$actual"
  return $bad
}

case "$MODE" in
# ── 演练 ──────────────────────────────────────────────────
--rehearse)
  echo "演练模式：灌进临时库 $SCRATCH_DB，线上数据完全不动。"
  echo ""
  psql_db postgres -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\"" >/dev/null
  psql_db postgres -c "CREATE DATABASE \"$SCRATCH_DB\"" >/dev/null
  trap 'psql_db postgres -c "DROP DATABASE IF EXISTS \"'"$SCRATCH_DB"'\"" >/dev/null 2>&1 || true' EXIT

  echo "==> 导入..."
  # -q 之外仍会打 NOTICE，只在失败时才需要看，成功路径压掉
  if ! tar -xzOf "$ARCHIVE" ./db.sql | psql_db "$SCRATCH_DB" -q > /tmp/restore-rehearse.log 2>&1; then
    echo "!! 导入失败，最后 20 行："
    tail -20 /tmp/restore-rehearse.log
    die "演练失败：这个备份包恢复不了，尽快查明原因"
  fi

  echo "==> 核对："
  if verify_into "$SCRATCH_DB"; then
    echo ""
    echo "演练通过：这个备份包可以恢复，数据对得上。临时库已删除。"
  else
    echo ""
    die "演练失败：恢复出来的数据与备份时对不上，别指望它救命"
  fi
  ;;

# ── 真恢复 ────────────────────────────────────────────────
--production)
  echo "!! 真恢复会用备份覆盖当前线上数据，$(manifest_get "$ARCHIVE" created_at) 之后的所有变动都会丢失。"
  echo "   开始前会先把当前状态另存一份，万一恢复错了还能退回去。"
  echo ""
  if [ "${3:-}" != "-y" ]; then
    [ -t 0 ] || die "非交互环境。确认无误请加 -y：bash $0 --production $(basename "$ARCHIVE") -y"
    read -r -p "输入 RESTORE 继续： " ans
    [ "$ans" = RESTORE ] || { echo "已取消。"; exit 1; }
  fi

  echo "==> 停应用（保留数据库，且避免残留连接占住库）..."
  dc stop server web || true

  SAFETY="$BACKUP_DIR/pre-restore-$(date +%Y%m%d-%H%M%S).sql.gz"
  echo "==> 先存一份当前状态到 $SAFETY ..."
  dc exec -T "$PG_SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl | gzip -c > "$SAFETY"

  echo "==> 重建数据库..."
  psql_db postgres -c "
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid()" >/dev/null
  psql_db postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\"" >/dev/null
  psql_db postgres -c "CREATE DATABASE \"$DB_NAME\"" >/dev/null

  echo "==> 导入数据..."
  if ! tar -xzOf "$ARCHIVE" ./db.sql | psql_db "$DB_NAME" -q > /tmp/restore-prod.log 2>&1; then
    echo "!! 导入失败，最后 20 行："
    tail -20 /tmp/restore-prod.log
    echo ""
    echo "当前状态已存在 $SAFETY，可用它退回："
    echo "  gunzip -c $SAFETY | docker compose -f $COMPOSE_FILE --env-file .env.prod exec -T $PG_SERVICE psql -U $DB_USER -d $DB_NAME"
    exit 1
  fi

  echo "==> 核对："
  verify_into "$DB_NAME" || echo "  （对不上，继续之前先查清楚）"

  if [ "${RESTORE_UPLOADS:-1}" = 1 ]; then
    echo "==> 恢复上传文件..."
    STAGE=$(mktemp -d)
    tar -xzf "$ARCHIVE" -C "$STAGE" ./uploads.tar.gz
    if [ -s "$STAGE/uploads.tar.gz" ]; then
      docker run --rm -v "$UPLOADS_VOLUME":/data -v "$STAGE":/in "$HELPER_IMAGE" \
        sh -c 'rm -rf /data/* && tar -xzf /in/uploads.tar.gz -C /data'
    else
      echo "   包里没有上传文件，跳过"
    fi
    rm -rf "$STAGE"
  fi

  # .env.prod 只在缺失时补（换新机器的场景），绝不覆盖正在用的那份密钥
  if [ ! -f .env.prod ]; then
    echo "==> 当前没有 .env.prod，从备份恢复密钥..."
    tar -xzOf "$ARCHIVE" ./env.prod > .env.prod
    chmod 600 .env.prod
  fi

  echo "==> 起应用..."
  dc up -d
  for i in $(seq 1 60); do
    if dc exec -T server node healthcheck.js >/dev/null 2>&1; then
      echo "健康检查通过（第 ${i} 次）"
      break
    fi
    [ "$i" -eq 60 ] && { dc logs --tail 50 server; die "恢复完成但服务起不来，看上面日志"; }
    sleep 2
  done

  echo ""
  echo "恢复完成。接下来："
  echo "  1. 后台「资金对账」点「立即对账」，确认四项通过"
  echo "  2. 抽查几个玩家余额，跟他们自己记的对一下"
  echo "  3. 确认无误后再删 $SAFETY"
  ;;

*)
  die "未知模式 $MODE（只支持 --rehearse / --production）"
  ;;
esac
