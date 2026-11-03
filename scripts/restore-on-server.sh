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
HELPER_IMAGE="${HELPER_IMAGE:-postgres:15-alpine@sha256:3d0f7584ed7d04e27fa050d6683a74746608faf21f202be78460d679cc56461f}"
SCRATCH_DB="${SCRATCH_DB:-gamebox_restore_test}"

cd "$DEPLOY_DIR"
[ -f .env.prod ] || {
  echo "找不到 $DEPLOY_DIR/.env.prod，恢复脚本不能连接当前基础设施。" >&2
  echo "新服务器必须先部署当前版本并保留新生成的基础设施凭据，再导入旧备份；不要删除 .env.prod。" >&2
  exit 1
}
dc() { docker compose -f "$COMPOSE_FILE" --env-file .env.prod "$@"; }
psql_db() { dc exec -T "$PG_SERVICE" psql -U "$DB_USER" -d "$1" -v ON_ERROR_STOP=1 "${@:2}"; }

die() { echo "$*" >&2; exit 1; }

# 加密与认证密钥跟 backup-on-server.sh 共用 backup.env
[ -f backup.env ] && { set -a; . ./backup.env; set +a; }
ENC_KEY="${BACKUP_ENCRYPT_KEY:-}"
AUTH_KEY="${BACKUP_AUTH_KEY:-}"
ENC_CIPHER="-aes-256-cbc -pbkdf2 -iter 200000"
AUTH_FOOTER_PREFIX='GAMEBOX-HMAC-SHA256:'
AUTH_FOOTER_BYTES=$((1 + ${#AUTH_FOOTER_PREFIX} + 64 + 1))
ARCHIVE_CIPHER_BYTES=''

backup_hmac() {
  local file=$1 bytes=$2
  node - "$file" "$bytes" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const [file, rawBytes] = process.argv.slice(2);
const secret = process.env.BACKUP_AUTH_KEY;
const bytes = Number(rawBytes);
if (!Number.isSafeInteger(bytes) || bytes <= 0) {
  throw new Error('invalid authenticated byte length');
}
if (!/^[0-9a-fA-F]{64}$/.test(secret || '')) {
  throw new Error('BACKUP_AUTH_KEY must be 64 hexadecimal characters');
}
const key = Buffer.from(secret, 'hex');
const hmac = crypto.createHmac('sha256', key);
const input = fs.createReadStream(file, { start: 0, end: bytes - 1 });
input.on('data', (chunk) => hmac.update(chunk));
input.on('end', () => process.stdout.write(hmac.digest('hex')));
input.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
NODE
}

prepare_archive_auth() {
  local file=$1 size footer stored actual
  ARCHIVE_CIPHER_BYTES=''
  case "$file" in
    *.auth.enc)
      [ -n "$ENC_KEY" ] || die "包是加密的，但 $DEPLOY_DIR/backup.env 里没有 BACKUP_ENCRYPT_KEY。
换新机器恢复时，口令要从你另存的那份里取回来，填进 backup.env 再重试。"
      command -v node >/dev/null 2>&1 || die "认证加密备份需要 node 验证 HMAC"
      size=$(stat -c%s "$file")
      [ "$size" -gt "$AUTH_FOOTER_BYTES" ] || die "认证加密包过短或缺少 HMAC 标签：$file"
      footer=$(tail -c "$AUTH_FOOTER_BYTES" "$file")
      stored=$(printf '%s\n' "$footer" \
        | sed -n "s/^${AUTH_FOOTER_PREFIX}\([0-9a-f]\{64\}\)$/\1/p")
      [ -n "$stored" ] || die "认证加密包缺少有效 HMAC 标签：$file"
      [[ "$AUTH_KEY" =~ ^[0-9a-fA-F]{64}$ ]] || die \
        "认证加密包需要 backup.env 中独立的 64 位十六进制 BACKUP_AUTH_KEY。"
      ARCHIVE_CIPHER_BYTES=$((size - AUTH_FOOTER_BYTES))
      actual=$(backup_hmac "$file" "$ARCHIVE_CIPHER_BYTES")
      [ "$stored" = "$actual" ] || die "备份 HMAC 完整性校验失败：$file
文件可能损坏或被篡改；尚未解密，也不会写入数据库或上传卷。"
      ;;
    *.enc)
      [ -n "$ENC_KEY" ] || die "包是加密的，但 $DEPLOY_DIR/backup.env 里没有 BACKUP_ENCRYPT_KEY。
换新机器恢复时，口令要从你另存的那份里取回来，填进 backup.env 再重试。"
      size=$(stat -c%s "$file")
      [ "${ALLOW_LEGACY_UNAUTHENTICATED_BACKUP:-0}" = 1 ] || die \
        "旧加密包没有 HMAC 完整性标签，默认拒绝解密：$file
先从可信离线副本核对文件；确需兼容旧包时仅对本次命令设置
ALLOW_LEGACY_UNAUTHENTICATED_BACKUP=1，并在恢复后立即生成新版认证备份。"
      echo "警告：正在恢复没有 HMAC 的历史 AES-CBC 包，仅允许用于已核验的可信离线副本。" >&2
      ARCHIVE_CIPHER_BYTES=$size
      ;;
  esac
}

resolve_archive() {
  local a=$1
  if [ "$a" = latest ]; then
    a=$(ls -t "$BACKUP_DIR"/gamebox-backup-*.tar.gz* 2>/dev/null | head -1 || true)
    [ -n "$a" ] || die "$BACKUP_DIR 里没有备份包"
  fi
  [ -f "$a" ] || a="$BACKUP_DIR/$a"
  [ -f "$a" ] || die "找不到备份包：$1"
  printf '%s' "$a"
}

# 把包的内容吐到 stdout：.auth.enc 必须先通过 Encrypt-then-MAC 校验，
# 再交给 CBC 解密。历史 .enc 无 HMAC 包只能显式一次性放行。
archive_cat() {
  case "$1" in
    *.enc)
      [ -n "$ARCHIVE_CIPHER_BYTES" ] || die "内部错误：加密包尚未完成 HMAC 预检"
      head -c "$ARCHIVE_CIPHER_BYTES" "$1" \
        | openssl enc -d $ENC_CIPHER -pass env:BACKUP_ENCRYPT_KEY
      ;;
    *) cat "$1" ;;
  esac
}

manifest_get() { archive_cat "$1" | tar -xzO ./manifest.txt | sed -n "s#^$2=##p" | head -1; }

resolve_server_volume() {
  local destination=$1 label=$2 volume
  docker container inspect gamebox-server >/dev/null 2>&1 || die \
    "找不到 gamebox-server 容器，无法解析${label}真实卷。
新服务器请先完成当前版本部署；容器可以停机，但必须已创建。"
  volume=$(docker inspect --format \
    "{{range .Mounts}}{{if and (eq .Type \"volume\") (eq .Destination \"$destination\")}}{{.Name}}{{end}}{{end}}" \
    gamebox-server)
  [ -n "$volume" ] || die "gamebox-server 的 $destination 不是可识别的 Docker volume，拒绝恢复。"
  docker volume inspect "$volume" >/dev/null 2>&1 || die "${label}卷 $volume 不存在，拒绝让 Docker 新建错误卷。"
  printf '%s' "$volume"
}

validate_inner_tar() {
  local file=$1 label=$2 listing
  [ -s "$file" ] || return 0
  listing=$(tar -tzf "$file") || {
    echo "$label 内层 tar 已损坏，尚未覆盖任何上传文件。" >&2
    return 1
  }
  if printf '%s\n' "$listing" | awk '
    /(^|\/)\.\.(\/|$)/ || /^\// { bad=1 }
    END { exit bad ? 0 : 1 }
  '; then
    echo "$label 内层 tar 含绝对路径或 .. 路径，拒绝解压。" >&2
    return 1
  fi
}

# ── 列表 ──────────────────────────────────────────────────
if [ $# -eq 0 ]; then
  echo "备份目录 $BACKUP_DIR"
  echo ""
  found=0
  for f in $(ls -t "$BACKUP_DIR"/gamebox-backup-*.tar.gz* 2>/dev/null || true); do
    found=1
    prepare_archive_auth "$f"
    printf '  %-46s %6s  用户 %-6s 余额合计 %s\n' \
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
prepare_archive_auth "$ARCHIVE"

# 先确认这个包读得动再往下走。口令不对的话，后面每一步都会以各种莫名其妙的
# 方式失败（psql 收到一堆二进制、tar 报 not in gzip format），不如在这里说清楚。
archive_cat "$ARCHIVE" | gzip -t 2>/dev/null || die "包读不出来：$ARCHIVE
加密包请确认 backup.env 里的 BACKUP_ENCRYPT_KEY 与 BACKUP_AUTH_KEY 都来自原服务器；
明文包报这个错说明文件已经损坏，换一份再试。"

case "$MODE" in --rehearse|--production) ;; *) die "未知模式 $MODE（只支持 --rehearse / --production）" ;; esac

STAGE=$(mktemp -d)
cleanup_stage() { rm -rf "$STAGE"; }
trap cleanup_stage EXIT
OUTER_MEMBERS=$(archive_cat "$ARCHIVE" | tar -tzf -)
if printf '%s\n' "$OUTER_MEMBERS" | awk '
  /(^|\/)\.\.(\/|$)/ || /^\// { bad=1 }
  END { exit bad ? 0 : 1 }
'; then
  die "备份包含绝对路径或 .. 路径，拒绝解压。"
fi
for want in ./db.sql ./env.prod ./manifest.txt ./uploads.tar.gz; do
  printf '%s\n' "$OUTER_MEMBERS" | grep -qx "$want" || die "备份包缺少 $want"
done
archive_cat "$ARCHIVE" | tar -xzf - -C "$STAGE"
[ -s "$STAGE/db.sql" ] || die "备份包中的 db.sql 为空"
validate_inner_tar "$STAGE/uploads.tar.gz" uploads || die "上传包预检失败"
if [ -f "$STAGE/private-uploads.tar.gz" ]; then
  validate_inner_tar "$STAGE/private-uploads.tar.gz" private-uploads || die "私有上传包预检失败"
fi

BACKUP_VERSION=$(sed -n 's#^app_version=##p' "$STAGE/manifest.txt" | head -1)
CURRENT_VERSION=$(sed -n 's#^GAMEBOX_VERSION=##p' .env.prod | head -1)
echo "备份包 $ARCHIVE"
echo "备份于 $(sed -n 's#^created_at=##p' "$STAGE/manifest.txt" | head -1)"
echo "备份应用版本：${BACKUP_VERSION:-未记录}；当前镜像版本：${CURRENT_VERSION:-未记录}"
if [ -n "$BACKUP_VERSION" ] && [ -n "$CURRENT_VERSION" ] && [ "$BACKUP_VERSION" != "$CURRENT_VERSION" ]; then
  echo "!! 版本不同：将导入旧数据，但迁移必须由当前镜像 $CURRENT_VERSION 执行。"
fi
echo ""

# 备份时刻的行数，恢复后要逐项对上
declare -A EXPECT
while IFS='=' read -r k v; do
  case "$k" in
    User|PointsAccount|PointsLedger|Agent|Room|balance_sum) EXPECT[$k]=$v ;;
  esac
done < "$STAGE/manifest.txt"

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
  trap 'psql_db postgres -c "DROP DATABASE IF EXISTS \"'"$SCRATCH_DB"'\"" >/dev/null 2>&1 || true; cleanup_stage' EXIT

  echo "==> 导入..."
  # -q 之外仍会打 NOTICE，只在失败时才需要看，成功路径压掉
  if ! psql_db "$SCRATCH_DB" -q < "$STAGE/db.sql" > /tmp/restore-rehearse.log 2>&1; then
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
  echo "!! 真恢复会用备份覆盖当前线上数据，备份时刻之后的所有变动都会丢失。"
  echo "   当前 .env.prod 与 Postgres 凭据始终保留；备份里的旧 DB_PASSWORD 不会写回。"
  echo ""
  if [ "${3:-}" != "-y" ]; then
    [ -t 0 ] || die "非交互环境。确认无误请加 -y：bash $0 --production $(basename "$ARCHIVE") -y"
    read -r -p "输入 RESTORE 继续： " ans
    [ "$ans" = RESTORE ] || { echo "已取消。"; exit 1; }
  fi

  UPLOADS_VOLUME=$(resolve_server_volume /repo/server/uploads "上传文件")
  PRIVATE_UPLOADS_VOLUME=$(resolve_server_volume /repo/server/private-uploads "客服私有媒体")

  safety_copy_failure() {
    local line=$1
    trap - ERR
    set +e
    echo "!! 第 $line 行创建恢复前安全副本失败；线上数据尚未改动，正在重启原服务。" >&2
    if dc up -d; then
      echo "   原服务启动命令已成功提交；请继续确认 server + web 健康。" >&2
    else
      echo "!! 原服务重启失败，当前服务状态不确定，必须立即人工介入。" >&2
      dc logs --tail 50 server web || true
    fi
    echo "   请修复磁盘空间、卷或权限问题后重试；不要绕过安全副本。" >&2
    exit 1
  }
  trap 'safety_copy_failure $LINENO' ERR
  echo "==> 停应用（保留数据库，且避免残留连接占住库）..."
  dc stop server web

  SAFETY_DIR="$BACKUP_DIR/pre-restore-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$SAFETY_DIR"
  chmod 700 "$SAFETY_DIR"
  echo "==> 为当前数据库与两个上传卷创建安全副本：$SAFETY_DIR"
  dc exec -T "$PG_SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl \
    | gzip -c > "$SAFETY_DIR/db.sql.gz"
  docker run --rm -v "$UPLOADS_VOLUME":/data:ro -v "$SAFETY_DIR":/out "$HELPER_IMAGE" \
    tar -czf /out/uploads.tar.gz -C /data .
  docker run --rm -v "$PRIVATE_UPLOADS_VOLUME":/data:ro -v "$SAFETY_DIR":/out "$HELPER_IMAGE" \
    tar -czf /out/private-uploads.tar.gz -C /data .
  gzip -t "$SAFETY_DIR/db.sql.gz"
  validate_inner_tar "$SAFETY_DIR/uploads.tar.gz" safety-uploads
  validate_inner_tar "$SAFETY_DIR/private-uploads.tar.gz" safety-private-uploads
  chmod 600 "$SAFETY_DIR"/*

  DB_TOUCHED=0
  UPLOADS_TOUCHED=0
  PRIVATE_UPLOADS_TOUCHED=0
  restore_volume_copy() {
    local volume=$1 archive=$2
    docker run --rm -v "$volume":/data -v "$SAFETY_DIR":/safety:ro "$HELPER_IMAGE" \
      sh -ec "find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf /safety/$archive -C /data"
  }
  production_failure() {
    local line=$1 incomplete=0 can_restore=1
    local db_status=未需恢复 uploads_status=未需恢复 private_status=未需恢复
    trap - ERR
    set +e
    echo ""
    echo "!! 恢复在第 $line 行失败；应用保持停止，开始自动恢复操作前状态。" >&2
    if ! dc stop server web >/dev/null 2>&1; then
      echo "!! 无法确认 server/web 已停止，禁止继续自动改写数据库或上传卷。" >&2
      incomplete=1
      can_restore=0
    fi
    if [ "$DB_TOUCHED" = 1 ]; then
      db_status=失败
      if [ "$can_restore" = 1 ] \
        && psql_db postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid()" >/dev/null \
        && psql_db postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\"" >/dev/null \
        && psql_db postgres -c "CREATE DATABASE \"$DB_NAME\"" >/dev/null \
        && gunzip -c "$SAFETY_DIR/db.sql.gz" | psql_db "$DB_NAME" -q; then
        db_status=成功
      else
        incomplete=1
      fi
    fi
    if [ "$UPLOADS_TOUCHED" = 1 ]; then
      uploads_status=失败
      if [ "$can_restore" = 1 ] && restore_volume_copy "$UPLOADS_VOLUME" uploads.tar.gz; then
        uploads_status=成功
      else
        incomplete=1
      fi
    fi
    if [ "$PRIVATE_UPLOADS_TOUCHED" = 1 ]; then
      private_status=失败
      if [ "$can_restore" = 1 ] && restore_volume_copy "$PRIVATE_UPLOADS_VOLUME" private-uploads.tar.gz; then
        private_status=成功
      else
        incomplete=1
      fi
    fi
    echo "   自动恢复状态：数据库=$db_status，uploads=$uploads_status，private-uploads=$private_status" >&2
    if [ "$incomplete" = 1 ]; then
      echo "!! 自动恢复不完整 / 必须人工介入；服务继续停止。" >&2
    else
      echo "!! 自动恢复完整，但服务按 fail-closed 策略继续停止，核对后再人工启动。" >&2
    fi
    echo "   安全副本保留在：$SAFETY_DIR" >&2
    echo "   手工数据库恢复：gunzip -c $SAFETY_DIR/db.sql.gz | docker compose -f $COMPOSE_FILE --env-file .env.prod exec -T $PG_SERVICE psql -U $DB_USER -d $DB_NAME" >&2
    echo "   手工卷恢复：使用 $SAFETY_DIR/uploads.tar.gz 与 private-uploads.tar.gz 覆盖上面解析出的真实卷。" >&2
    exit 1
  }
  trap 'production_failure $LINENO' ERR

  echo "==> 重建数据库..."
  DB_TOUCHED=1
  psql_db postgres -c "
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid()" >/dev/null
  psql_db postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\"" >/dev/null
  psql_db postgres -c "CREATE DATABASE \"$DB_NAME\"" >/dev/null

  echo "==> 导入数据..."
  psql_db "$DB_NAME" -q < "$STAGE/db.sql" > /tmp/restore-prod.log 2>&1

  echo "==> 核对："
  verify_into "$DB_NAME"

  if [ "${RESTORE_UPLOADS:-1}" = 1 ]; then
    echo "==> 恢复上传文件..."
    if [ -s "$STAGE/uploads.tar.gz" ]; then
      UPLOADS_TOUCHED=1
      docker run --rm -v "$UPLOADS_VOLUME":/data -v "$STAGE":/in "$HELPER_IMAGE" \
        sh -ec 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf /in/uploads.tar.gz -C /data; chown -R 1000:1000 /data'
    else
      echo "   包内 uploads.tar.gz 为空，保留当前上传卷"
    fi
    if [ -f "$STAGE/private-uploads.tar.gz" ]; then
      if [ -s "$STAGE/private-uploads.tar.gz" ]; then
        PRIVATE_UPLOADS_TOUCHED=1
        docker run --rm -v "$PRIVATE_UPLOADS_VOLUME":/data -v "$STAGE":/in "$HELPER_IMAGE" \
          sh -ec 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf /in/private-uploads.tar.gz -C /data; chown -R 1000:1000 /data'
      else
        echo "   包内 private-uploads.tar.gz 为空，保留当前私有上传卷"
      fi
    else
      echo "   旧备份不含客服私有媒体，保留当前私有上传卷"
    fi
  fi

  echo "==> 用当前镜像执行 Prisma 迁移（不使用备份中的旧凭据）..."
  # shellcheck disable=SC1091
  set -a; source .env.prod; set +a
  : "${DB_PASSWORD:?当前 .env.prod 缺少 DB_PASSWORD}"
  dc run --rm --no-deps \
    -e "DATABASE_URL=postgresql://$DB_USER:${DB_PASSWORD}@postgres:5432/$DB_NAME?schema=public" \
    server node node_modules/prisma/build/index.js migrate deploy

  echo "==> 起应用..."
  dc up -d
  for i in $(seq 1 60); do
    SERVER_CID=$(dc ps -q server)
    WEB_CID=$(dc ps -q web)
    if [ -n "$SERVER_CID" ] && [ -n "$WEB_CID" ] \
      && [ "$(docker inspect -f '{{.State.Health.Status}}' "$SERVER_CID" 2>/dev/null)" = healthy ] \
      && [ "$(docker inspect -f '{{.State.Health.Status}}' "$WEB_CID" 2>/dev/null)" = healthy ]; then
      echo "server + web 健康检查通过（第 ${i} 次）"
      break
    fi
    [ "$i" -eq 60 ] && { dc logs --tail 50 server web; false; }
    sleep 2
  done
  trap - ERR
  trap cleanup_stage EXIT

  echo ""
  echo "恢复完成。接下来："
  echo "  1. 后台「资金对账」点「立即对账」，确认四项通过"
  echo "  2. 抽查几个玩家余额，跟他们自己记的对一下"
  echo "  3. 确认无误后再删 $SAFETY_DIR"
  ;;

esac
