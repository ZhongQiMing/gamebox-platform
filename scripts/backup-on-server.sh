#!/bin/bash
# 每日备份：数据库 + 密钥 + 玩家上传文件，打成一个包。
#
# 宝塔计划任务（Shell 脚本，每天一次，建议 04:30，早于 05:00 的自动对账）：
#   bash /opt/gamebox-platform/backup-on-server.sh
#
# 为什么三样一起备：
#   数据库    —— 账号、余额、全部流水
#   .env.prod —— 数据库密码和 JWT 密钥。库文件还在但密码丢了，一样打不开
#   uploads   —— 充值凭证、头像，存在另一个 docker 卷里，不在数据库中
# 少任何一样，恢复出来的都是个残废系统。
#
# pg_dump 是钻进容器执行的：Postgres 没有对外开端口，宿主机上也没装 PostgreSQL，
# 在宿主机直接跑 pg_dump 连不上也找不到命令。
#
# 备份文件留在 BACKUP_DIR，跟数据库在同一块硬盘上 —— 这只防误删、不防硬盘坏和
# 服务器被回收。**请定期把包下载到本机**，那才是真正的异地副本。
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/gamebox-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.images.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/gamebox-backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
PG_SERVICE="${PG_SERVICE:-postgres}"
DB_NAME="${DB_NAME:-gamebox}"
DB_USER="${DB_USER:-gamebox}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-gamebox_uploads}"
# 挂卷打包用的临时容器镜像，用数据库镜像即可，服务器上一定有，不必额外拉取
HELPER_IMAGE="${HELPER_IMAGE:-postgres:15-alpine}"
# 磁盘至少要留这么多空余才开始备，否则备份失败还能顺手把数据库撑死
MIN_FREE_MB="${MIN_FREE_MB:-2048}"

STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/gamebox-backup-$STAMP.tar.gz"

cd "$DEPLOY_DIR"
dc() { docker compose -f "$COMPOSE_FILE" --env-file .env.prod "$@"; }

# Telegram 配置：跟 health-alert 用同一组变量名，可放在 DEPLOY_DIR/backup.env
[ -f backup.env ] && { set -a; . ./backup.env; set +a; }
BOT="${TELEGRAM_BOT_TOKEN:-}"
CHAT="${TELEGRAM_CHAT_ID:-}"

send_telegram() {
  [ -n "$BOT" ] && [ -n "$CHAT" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  curl -sS -m 15 -X POST "https://api.telegram.org/bot$BOT/sendMessage" \
    -H 'Content-Type: application/json' \
    --data-binary @- >/dev/null 2>&1 <<EOF || true
{"chat_id":"$CHAT","text":$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n' | sed 's/^/"/; s/$/"/'),"disable_web_page_preview":true}
EOF
}

STAGE=''
cleanup() { [ -n "$STAGE" ] && rm -rf "$STAGE"; }
trap cleanup EXIT

# 自检通过后置 1。此后再出错也不许删包：收尾那几行只是打印提示，
# 让一句 hostname 取不到 IP 就把刚备好的包删掉并报「备份失败」，是最坑的失败方式。
SEALED=0

# 定时任务的失败是静默的：不主动喊一声，可能连着几个月没备成功而你毫不知情
on_error() {
  local line=$1
  echo "[backup] 失败：第 $line 行" >&2
  if [ "$SEALED" = 1 ]; then
    echo "[backup] 包已通过自检，保留：$ARCHIVE" >&2
    return
  fi
  rm -f "$ARCHIVE"
  send_telegram "gamebox 备份失败
主机 $(hostname)
脚本第 $line 行
时间 $(date -Iseconds)
请登录服务器查看：bash $DEPLOY_DIR/backup-on-server.sh"
}
trap 'on_error $LINENO' ERR

mkdir -p "$BACKUP_DIR"

FREE_MB=$(df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}')
if [ "$FREE_MB" -lt "$MIN_FREE_MB" ]; then
  echo "[backup] 磁盘剩余 ${FREE_MB}MB，低于下限 ${MIN_FREE_MB}MB，拒绝执行" >&2
  send_telegram "gamebox 备份未执行：磁盘只剩 ${FREE_MB}MB（下限 ${MIN_FREE_MB}MB）。先清理再说，撑满会把数据库一起搞停。"
  exit 1
fi

if ! dc ps --status running --services 2>/dev/null | grep -qx "$PG_SERVICE"; then
  echo "[backup] $PG_SERVICE 容器没在运行，无法备份" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
echo "[backup] 开始 $STAMP"

# ── 1. 数据库 ──────────────────────────────────────────────
# --no-owner/--no-acl：恢复到别的机器时不会因为角色名对不上而报错
echo "[backup] 导出数据库..."
dc exec -T "$PG_SERVICE" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl > "$STAGE/db.sql"

# ── 2. 密钥与运行配置 ──────────────────────────────────────
cp .env.prod "$STAGE/env.prod"
[ -f server/.env.production ] && cp server/.env.production "$STAGE/env.production"

# ── 3. 上传文件 ────────────────────────────────────────────
# 直接挂卷用临时容器打包，不依赖 server 容器活着（要备份的时候它多半正好挂了）
echo "[backup] 打包上传文件..."
if docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
  docker run --rm -v "$UPLOADS_VOLUME":/data:ro -v "$STAGE":/out "$HELPER_IMAGE" \
    tar -czf /out/uploads.tar.gz -C /data . 2>/dev/null
else
  echo "[backup] 卷 $UPLOADS_VOLUME 不存在，跳过上传文件"
  : > "$STAGE/uploads.tar.gz"
fi

# ── 4. 清单：记下当时的行数，恢复后拿它对照 ────────────────
echo "[backup] 统计行数..."
COUNTS=$(dc exec -T "$PG_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -tAF'|' -c "
  SELECT 'User', count(*)::text FROM \"User\"
  UNION ALL SELECT 'PointsAccount', count(*)::text FROM \"PointsAccount\"
  UNION ALL SELECT 'PointsLedger', count(*)::text FROM \"PointsLedger\"
  UNION ALL SELECT 'Agent', count(*)::text FROM \"Agent\"
  UNION ALL SELECT 'Room', count(*)::text FROM \"Room\"
  UNION ALL SELECT 'balance_sum', COALESCE(sum(balance),0)::text FROM \"PointsAccount\"
")

# 备份体积失控的原因几乎总是某一两张表在无节制增长，记在清单里让它一直显眼
BIGGEST=$(dc exec -T "$PG_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -tAF'|' -c "
  SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid))
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r'
  ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 3
")

{
  echo "created_at=$(date -Iseconds)"
  echo "hostname=$(hostname)"
  echo "app_version=$(sed -n 's#^GAMEBOX_VERSION=##p' .env.prod | head -1)"
  echo "db_name=$DB_NAME"
  echo "db_sql_bytes=$(stat -c%s "$STAGE/db.sql")"
  echo "uploads_bytes=$(stat -c%s "$STAGE/uploads.tar.gz")"
  echo "# 下面是备份时刻的行数与余额合计，恢复演练时逐项对照"
  printf '%s\n' "$COUNTS" | sed 's/|/=/'
  echo "# 占地方最多的三张表，备份变慢变大时先看它们"
  printf '%s\n' "$BIGGEST" | sed 's/^/biggest_table=/; s/|/ /'
} > "$STAGE/manifest.txt"

# ── 5. 打包 ────────────────────────────────────────────────
tar -czf "$ARCHIVE" -C "$STAGE" .

# ── 6. 自检：备了一堆空文件却以为备好了，是最常见的假象 ────
echo "[backup] 自检..."
gzip -t "$ARCHIVE"

MEMBERS=$(tar -tzf "$ARCHIVE")
for want in ./db.sql ./env.prod ./manifest.txt ./uploads.tar.gz; do
  printf '%s\n' "$MEMBERS" | grep -qx "$want" || {
    echo "[backup] 自检失败：包里缺 $want" >&2
    exit 1
  }
done

# 一次扫完拿两个结论。不用 grep -q：它命中就退出，上游 tar 收到 SIGPIPE，
# 在 pipefail 下整条管道算失败，好包会被误判成坏包。awk 读到 EOF 才结束。
SUMMARY=$(tar -xzOf "$ARCHIVE" ./db.sql | awk '
  /^CREATE TABLE/          { tables++ }
  /^COPY public\."User" /   { userdata = 1 }
  END                      { print tables + 0, userdata + 0 }
')
TABLES=${SUMMARY%% *}
USER_DATA=${SUMMARY##* }
if [ "$TABLES" -lt 20 ]; then
  echo "[backup] 自检失败：dump 里只有 $TABLES 张表，明显不完整" >&2
  exit 1
fi
if [ "$USER_DATA" != 1 ]; then
  echo "[backup] 自检失败：dump 里没有 User 表的数据段" >&2
  exit 1
fi

USERS=$(printf '%s\n' "$COUNTS" | awk -F'|' '$1=="User"{print $2}')
if [ "${USERS:-0}" -eq 0 ]; then
  echo "[backup] 警告：库里一个用户都没有，确认这是不是一个空库"
fi

# 到这里包已经确认可用，后面再出什么岔子都不能把它删掉
SEALED=1

# ── 6.5 异地副本 ───────────────────────────────────────────
# 备份跟数据库在同一块盘上，只防误删。配了 BACKUP_OFFSITE_CMD 就自动推走
# （rclone / s3cmd / scp 都行，$1 是刚生成的包）；没配就一直提醒，
# 别让「我以为有备份」变成事故当天才发现的真相。
OFFSITE_STAMP="$BACKUP_DIR/.last-offsite"
if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then
  echo "[backup] 推送异地副本..."
  if bash -c "$BACKUP_OFFSITE_CMD" _ "$ARCHIVE"; then
    date -Iseconds > "$OFFSITE_STAMP"
    echo "[backup] 异地副本完成"
  else
    echo "[backup] 异地推送失败（本地包已保留）" >&2
    send_telegram "gamebox 异地备份推送失败
主机 $(hostname)
本地包仍在：$ARCHIVE
时间 $(date -Iseconds)"
  fi
else
  LAST_OFFSITE=$( [ -f "$OFFSITE_STAMP" ] && cat "$OFFSITE_STAMP" || echo '从未' )
  echo "[backup] 未配置 BACKUP_OFFSITE_CMD，无自动异地副本（上次：$LAST_OFFSITE）"
  # 每周提醒一次就够，天天喊会被当成噪音直接忽略
  if [ "$(date +%u)" = 1 ]; then
    send_telegram "gamebox 备份提醒：未配置异地副本
主机 $(hostname)
备份目录 $BACKUP_DIR 与数据库同盘，硬盘坏即全灭。
在 $DEPLOY_DIR/backup.env 里配 BACKUP_OFFSITE_CMD，或每周手工下载一次。"
  fi
fi

# ── 7. 清理过期 ────────────────────────────────────────────
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'gamebox-backup-*.tar.gz' \
  -mtime +"$KEEP_DAYS" -print -delete || true

SIZE=$(du -h "$ARCHIVE" | awk '{print $1}')
COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'gamebox-backup-*.tar.gz' | wc -l | tr -d ' ')
echo "[backup] 完成 $ARCHIVE（$SIZE），共 $TABLES 张表 / $USERS 个用户"
echo "[backup] 目录内共 $COUNT 份，保留 $KEEP_DAYS 天"
# hostname -I 不是哪儿都有（busybox、macOS 都没有），取不到就退回占位符。
# 这行只为拼一条能照抄的 scp 命令，绝不能因此让整个备份算失败。
HOST_IP=$( (hostname -I 2>/dev/null || true) | awk '{print $1}' )
echo "[backup] 提醒：这份还在同一块硬盘上，硬盘坏了或服务器被回收就一起没。"
echo "         请定期下载到本机，那才算异地副本："
echo "  scp root@${HOST_IP:-<服务器>}:$ARCHIVE ."
