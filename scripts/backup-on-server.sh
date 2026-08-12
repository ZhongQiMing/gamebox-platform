#!/bin/bash
# 每日备份：数据库 + 密钥 + 玩家上传文件，打成一个包。
#
# 宝塔计划任务（Shell 脚本，每天一次，建议 04:30，早于 05:00 的自动对账）：
#   bash /opt/gamebox-platform/backup-on-server.sh
#
# 为什么三样一起备：
#   数据库    —— 账号、余额、全部流水
#   .env.prod —— 数据库密码和 JWT 密钥。库文件还在但密码丢了，一样打不开
#   uploads   —— 头像/房间图标；private-uploads —— 客服私有媒体
# 少任何一样，恢复出来的都是个残废系统。
#
# pg_dump 是钻进容器执行的：Postgres 没有对外开端口，宿主机上也没装 PostgreSQL，
# 在宿主机直接跑 pg_dump 连不上也找不到命令。
#
# 备份文件留在 BACKUP_DIR，跟数据库在同一块硬盘上 —— 这只防误删、不防硬盘坏和
# 服务器被回收。**请定期把包下载到本机**，那才是真正的异地副本。
#
# 认证加密：backup.env 里同时配置 BACKUP_ENCRYPT_KEY / BACKUP_AUTH_KEY 后生成 .auth.enc。
# 包里带着 .env.prod，也就是数据库密码和 JWT 密钥；一旦推去对象存储或别人的机器，
# 明文包等于把整个平台送出去。密钥丢了包也就废了，务必单独存一份到服务器之外。
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/gamebox-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.images.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/gamebox-backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
PG_SERVICE="${PG_SERVICE:-postgres}"
DB_NAME="${DB_NAME:-gamebox}"
DB_USER="${DB_USER:-gamebox}"
# 挂卷打包用的临时容器镜像，用数据库镜像即可，服务器上一定有，不必额外拉取
HELPER_IMAGE="${HELPER_IMAGE:-postgres:15-alpine@sha256:3d0f7584ed7d04e27fa050d6683a74746608faf21f202be78460d679cc56461f}"
# 磁盘至少要留这么多空余才开始备，否则备份失败还能顺手把数据库撑死
MIN_FREE_MB="${MIN_FREE_MB:-2048}"

STAMP="$(date +%Y%m%d-%H%M%S)"
# 先打明文包做自检（要能 tar -t、能读出 db.sql），确认可用后再整包加密
PLAIN="$BACKUP_DIR/gamebox-backup-$STAMP.tar.gz"

cd "$DEPLOY_DIR"
dc() { docker compose -f "$COMPOSE_FILE" --env-file .env.prod "$@"; }

# Compose 的实际卷名带 project 前缀，不能根据 yaml 里的逻辑名猜。
# 已停止的容器仍可 inspect；完全没有 server 容器说明尚未完成首次部署，宁可拒绝备份，
# 也不能让 docker run 因一个猜错的名字新建空卷并产出“成功”的空包。
resolve_server_volume() {
  local destination=$1 label=$2 volume
  if ! docker container inspect gamebox-server >/dev/null 2>&1; then
    echo "[backup] 找不到 gamebox-server 容器，无法解析${label}真实卷。" >&2
    echo "[backup] 新服务器请先完成一次部署；容器可以停机，但必须已创建。" >&2
    return 1
  fi
  volume=$(docker inspect --format \
    "{{range .Mounts}}{{if and (eq .Type \"volume\") (eq .Destination \"$destination\")}}{{.Name}}{{end}}{{end}}" \
    gamebox-server)
  [ -n "$volume" ] || {
    echo "[backup] gamebox-server 的 $destination 不是可识别的 Docker volume，拒绝生成备份。" >&2
    return 1
  }
  docker volume inspect "$volume" >/dev/null 2>&1 || {
    echo "[backup] ${label}卷 $volume 不存在，拒绝生成不完整备份。" >&2
    return 1
  }
  printf '%s' "$volume"
}

# Telegram 配置：跟 health-alert 用同一组变量名，可放在 DEPLOY_DIR/backup.env
# shellcheck disable=SC1091
[ -f backup.env ] && { set -a; . ./backup.env; set +a; }
BOT="${TELEGRAM_BOT_TOKEN:-}"
CHAT="${TELEGRAM_CHAT_ID:-}"

# 口令从环境变量交给 openssl（-pass env:），不写在命令行上——命令行同机器任何人 ps 都看得到
ENC_KEY="${BACKUP_ENCRYPT_KEY:-}"
AUTH_KEY="${BACKUP_AUTH_KEY:-}"
ENC_CIPHER=(-aes-256-cbc -pbkdf2 -iter 200000)
AUTH_FOOTER_PREFIX='GAMEBOX-HMAC-SHA256:'
AUTH_FOOTER_BYTES=$((1 + ${#AUTH_FOOTER_PREFIX} + 64 + 1))
CIPHER_TMP=''

backup_hmac() {
  local file=$1 bytes=${2:-}
  node - "$file" "$bytes" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const [file, rawBytes] = process.argv.slice(2);
const secret = process.env.BACKUP_AUTH_KEY;
if (!/^[0-9a-fA-F]{64}$/.test(secret || '')) {
  throw new Error('BACKUP_AUTH_KEY must be 64 hexadecimal characters');
}
const key = Buffer.from(secret, 'hex');
const hmac = crypto.createHmac('sha256', key);
const bytes = rawBytes ? Number(rawBytes) : null;
if (bytes !== null && (!Number.isSafeInteger(bytes) || bytes <= 0)) {
  throw new Error('invalid authenticated byte length');
}
const input = fs.createReadStream(file, bytes === null ? {} : { start: 0, end: bytes - 1 });
input.on('data', (chunk) => hmac.update(chunk));
input.on('end', () => process.stdout.write(hmac.digest('hex')));
input.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
NODE
}

if [ -n "$ENC_KEY" ]; then
  [[ "$AUTH_KEY" =~ ^[0-9a-fA-F]{64}$ ]] || {
    echo "[backup] 配了 BACKUP_ENCRYPT_KEY 但缺少独立的 64 位十六进制 BACKUP_AUTH_KEY" >&2
    echo "[backup] 请重新运行部署脚本生成认证密钥，并把两把密钥一起存到服务器外。" >&2
    exit 1
  }
  command -v openssl >/dev/null 2>&1 || {
    echo "[backup] 配了 BACKUP_ENCRYPT_KEY 但没有 openssl 命令" >&2; exit 1; }
  command -v node >/dev/null 2>&1 || {
    echo "[backup] 加密备份需要 node 计算 HMAC 完整性标签" >&2; exit 1; }
  # CentOS 7 的 openssl 1.0.2 没有 -pbkdf2，退回它的老式派生等于弱化加密，宁可直接报错
  openssl enc -help 2>&1 | grep -q -- -pbkdf2 || {
    echo "[backup] openssl 太旧（不支持 -pbkdf2），请升级后再启用备份加密" >&2; exit 1; }
  ARCHIVE="$PLAIN.auth.enc"
else
  ARCHIVE="$PLAIN"
fi

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
APP_STATE_CAPTURED=0
APP_STATE_RESTORED=0
SERVER_WAS_RUNNING=0
WEB_WAS_RUNNING=0

service_running() {
  dc ps --status running --services 2>/dev/null | grep -qx "$1"
}

restore_app_state() {
  local services="" attempts=60 cid
  [ "$APP_STATE_CAPTURED" = 1 ] || return 0
  [ "$APP_STATE_RESTORED" = 0 ] || return 0
  [ "$SERVER_WAS_RUNNING" = 1 ] && services="$services server"
  [ "$WEB_WAS_RUNNING" = 1 ] && services="$services web"
  if [ -n "$services" ]; then
    echo "[backup] 恢复备份前应用运行状态：$services"
    # shellcheck disable=SC2086
    dc start $services >/dev/null || return 1
    for _ in $(seq 1 "$attempts"); do
      local healthy=1
      if [ "$SERVER_WAS_RUNNING" = 1 ]; then
        cid=$(dc ps -q server)
        [ -n "$cid" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null)" = healthy ] \
          || healthy=0
      fi
      if [ "$WEB_WAS_RUNNING" = 1 ]; then
        cid=$(dc ps -q web)
        [ -n "$cid" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null)" = healthy ] \
          || healthy=0
      fi
      if [ "$healthy" = 1 ]; then
        APP_STATE_RESTORED=1
        echo "[backup] 应用已恢复到备份前运行状态并通过健康检查"
        return 0
      fi
      sleep 2
    done
    return 1
  fi
  APP_STATE_RESTORED=1
  echo "[backup] 备份前 server/web 均未运行，保持停止状态"
}

finalize() {
  local status=$?
  trap - EXIT ERR
  set +e
  if [ "$APP_STATE_CAPTURED" = 1 ] && [ "$APP_STATE_RESTORED" = 0 ]; then
    if ! restore_app_state; then
      echo "[backup] 严重：无法恢复备份前应用状态，备份不得报告成功，请立即人工启动并检查。" >&2
      send_telegram "gamebox 备份收尾失败：server/web 未恢复健康
主机 $(hostname)
时间 $(date -Iseconds)
请立即登录检查。"
      status=1
    fi
  fi
  [ -z "$STAGE" ] || rm -rf "$STAGE"
  exit "$status"
}
trap finalize EXIT

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
  rm -f "$ARCHIVE" "$PLAIN" "${CIPHER_TMP:-}"
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

UPLOADS_VOLUME=$(resolve_server_volume /repo/server/uploads "上传文件")
PRIVATE_UPLOADS_VOLUME=$(resolve_server_volume /repo/server/private-uploads "客服私有媒体")

STAGE="$(mktemp -d)"
echo "[backup] 开始 $STAMP"

# 数据库记录与两个上传卷有跨存储引用。仅 pg_dump 的 MVCC 快照不能冻结文件系统，
# 因此短暂停止所有会写这三处的应用容器；postgres/redis 始终保持运行。
service_running server && SERVER_WAS_RUNNING=1
service_running web && WEB_WAS_RUNNING=1
APP_STATE_CAPTURED=1
echo "[backup] 进入一致性窗口：停止 server/web（postgres/redis 保持运行）..."
dc stop server web

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
docker run --rm -v "$UPLOADS_VOLUME":/data:ro -v "$STAGE":/out "$HELPER_IMAGE" \
  tar -czf /out/uploads.tar.gz -C /data .
docker run --rm -v "$PRIVATE_UPLOADS_VOLUME":/data:ro -v "$STAGE":/out "$HELPER_IMAGE" \
  tar -czf /out/private-uploads.tar.gz -C /data .

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

# 一致性数据已经全部落入 STAGE，立即缩短停机窗口。恢复失败属于整个备份失败，
# 即使归档内容本身随后能通过自检，也绝不能打印“备份成功”。
if ! restore_app_state; then
  echo "[backup] 无法恢复备份前应用运行状态，拒绝继续封包。" >&2
  exit 1
fi

{
  echo "created_at=$(date -Iseconds)"
  echo "hostname=$(hostname)"
  echo "app_version=$(sed -n 's#^GAMEBOX_VERSION=##p' .env.prod | head -1)"
  echo "db_name=$DB_NAME"
  echo "db_sql_bytes=$(stat -c%s "$STAGE/db.sql")"
  echo "uploads_bytes=$(stat -c%s "$STAGE/uploads.tar.gz")"
  echo "private_uploads_bytes=$(stat -c%s "$STAGE/private-uploads.tar.gz")"
  echo "# 下面是备份时刻的行数与余额合计，恢复演练时逐项对照"
  printf '%s\n' "$COUNTS" | sed 's/|/=/'
  echo "# 占地方最多的三张表，备份变慢变大时先看它们"
  printf '%s\n' "$BIGGEST" | sed 's/^/biggest_table=/; s/|/ /'
} > "$STAGE/manifest.txt"

# ── 5. 打包 ────────────────────────────────────────────────
tar -czf "$PLAIN" -C "$STAGE" .

# ── 6. 自检：备了一堆空文件却以为备好了，是最常见的假象 ────
echo "[backup] 自检..."
gzip -t "$PLAIN"
gzip -t "$STAGE/uploads.tar.gz"
gzip -t "$STAGE/private-uploads.tar.gz"

MEMBERS=$(tar -tzf "$PLAIN")
for want in ./db.sql ./env.prod ./manifest.txt ./uploads.tar.gz ./private-uploads.tar.gz; do
  printf '%s\n' "$MEMBERS" | grep -qx "$want" || {
    echo "[backup] 自检失败：包里缺 $want" >&2
    exit 1
  }
done

# 一次扫完拿两个结论。不用 grep -q：它命中就退出，上游 tar 收到 SIGPIPE，
# 在 pipefail 下整条管道算失败，好包会被误判成坏包。awk 读到 EOF 才结束。
SUMMARY=$(tar -xzOf "$PLAIN" ./db.sql | awk '
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

# ── 6.4 加密 ───────────────────────────────────────────────
# 顺序是「先自检明文、再加密」：加密后的包没法直接 tar -t，
# 反过来做就只能验证「解得开」，验证不了「里面是不是一个完整的库」。
if [ -n "$ENC_KEY" ]; then
  # 加密的瞬间明文包和密文包同时存在，磁盘要吃得下两份。
  # 开头那次余量检查是按「备份前」算的，这里得按包的实际大小再确认一次。
  NEED_MB=$(( $(stat -c%s "$PLAIN") / 1048576 + 1 ))
  FREE_NOW=$(df -Pm "$BACKUP_DIR" | awk 'NR==2 {print $4}')
  if [ "$FREE_NOW" -lt "$NEED_MB" ]; then
    echo "[backup] 加密还需 ${NEED_MB}MB，磁盘只剩 ${FREE_NOW}MB" >&2
    exit 1
  fi
  echo "[backup] 加密..."
  CIPHER_TMP="$ARCHIVE.cipher.$$"
  openssl enc "${ENC_CIPHER[@]}" -salt -pass env:BACKUP_ENCRYPT_KEY \
    -in "$PLAIN" -out "$CIPHER_TMP"
  AUTH_TAG=$(backup_hmac "$CIPHER_TMP")
  [[ "$AUTH_TAG" =~ ^[0-9a-f]{64}$ ]] || {
    echo "[backup] HMAC 完整性标签生成失败" >&2
    exit 1
  }
  {
    cat "$CIPHER_TMP"
    printf '\n%s%s\n' "$AUTH_FOOTER_PREFIX" "$AUTH_TAG"
  } > "$ARCHIVE"
  rm -f "$CIPHER_TMP"
  CIPHER_TMP=''

  CIPHER_BYTES=$(( $(stat -c%s "$ARCHIVE") - AUTH_FOOTER_BYTES ))
  STORED_TAG=$(tail -c "$AUTH_FOOTER_BYTES" "$ARCHIVE" \
    | sed -n "s/^${AUTH_FOOTER_PREFIX}\([0-9a-f]\{64\}\)$/\1/p")
  ACTUAL_TAG=$(backup_hmac "$ARCHIVE" "$CIPHER_BYTES")
  [ "$STORED_TAG" = "$ACTUAL_TAG" ] || {
    echo "[backup] 自检失败：密文 HMAC 完整性标签不匹配" >&2
    exit 1
  }
  # 必须先验 HMAC 再解密，避免 CBC 密文被篡改后进入解密器。
  head -c "$CIPHER_BYTES" "$ARCHIVE" \
    | openssl enc -d "${ENC_CIPHER[@]}" -pass env:BACKUP_ENCRYPT_KEY \
    | gzip -t || {
      echo "[backup] 自检失败：认证后的加密包解不开" >&2
      exit 1
    }
  rm -f "$PLAIN"
  echo "[backup] 已加密并认证（AES-256-CBC + HMAC-SHA-256，Encrypt-then-MAC）"
else
  echo "[backup] 警告：未配置 BACKUP_ENCRYPT_KEY，包内含 .env.prod 明文密钥"
  echo "         下载到本机或推去对象存储前请先想清楚这一点"
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
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'gamebox-backup-*.tar.gz*' \
  -mtime +"$KEEP_DAYS" -print -delete || true

SIZE=$(du -h "$ARCHIVE" | awk '{print $1}')
COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'gamebox-backup-*.tar.gz*' | wc -l | tr -d ' ')
echo "[backup] 完成 $ARCHIVE（$SIZE），共 $TABLES 张表 / $USERS 个用户"
echo "[backup] 目录内共 $COUNT 份，保留 $KEEP_DAYS 天"
# hostname -I 不是哪儿都有（busybox、macOS 都没有），取不到就退回占位符。
# 这行只为拼一条能照抄的 scp 命令，绝不能因此让整个备份算失败。
HOST_IP=$( (hostname -I 2>/dev/null || true) | awk '{print $1}' )
echo "[backup] 提醒：这份还在同一块硬盘上，硬盘坏了或服务器被回收就一起没。"
echo "         请定期下载到本机，那才算异地副本："
echo "  scp root@${HOST_IP:-<服务器>}:$ARCHIVE ."
if [ -n "$ENC_KEY" ]; then
  # 密钥跟包放在同一台机器上，服务器整台没了就全部没了 —— 那正是最需要备份的时候
  echo "[backup] 加密与认证密钥在 $DEPLOY_DIR/backup.env。"
  echo "         请把 BACKUP_ENCRYPT_KEY 和 BACKUP_AUTH_KEY 一起存到服务器之外，"
  echo "         否则这些包无法验证或解密。"
fi
