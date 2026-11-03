#!/bin/bash
# 在服务器上执行（文件已上传到 /tmp 后）
# 用法：PUBLIC_BASE_URL=https://app.example.com ADMIN_BASE_URL=https://admin.example.com \
#       GAME_BASE_URL=https://games.example.com bash /tmp/deploy-on-server.sh
#
# 幂等：重复部署复用已有 DB/JWT 密钥，生产只 migrate 不 seed。
# 版本：镜像带不可变版本号，服务器保留最近 KEEP_VERSIONS 套，
#       新版起不来会自动退回上一版（见 rollback-on-server.sh 做手动回滚）。
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/gamebox-platform}"
UPLOAD_DIR="${UPLOAD_DIR:-/tmp}"
COMPOSE_FILE=docker-compose.prod.images.yml
HISTORY_FILE=deploy-history.log
# 保留几套历史版本供回滚。真实回滚基本都在发版当天退一步，留 3 套足够；
# 镜像层是共享的，多留一套并不等于多占一份完整体积。
KEEP_VERSIONS=3
REQUESTED_PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
REQUESTED_ADMIN_BASE_URL="${ADMIN_BASE_URL:-}"
REQUESTED_GAME_BASE_URL="${GAME_BASE_URL:-}"
DEPLOY_WARNINGS=()

mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

STATE_DIR=$(mktemp -d)
KEEP_STATE=0
cleanup_state() { [ "$KEEP_STATE" = 1 ] || rm -rf "$STATE_DIR"; }
trap cleanup_state EXIT
for tool in docker openssl sha256sum awk sed; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "缺少部署必需工具：$tool" >&2
    exit 1
  }
done

ACTIVE_COMPOSE="$DEPLOY_DIR/$COMPOSE_FILE"
ACTIVE_ENV="$DEPLOY_DIR/.env.prod"
ACTIVE_SERVER_ENV="$DEPLOY_DIR/server/.env.production"
WORK_COMPOSE="$STATE_DIR/compose.candidate.yml"
WORK_COMPOSE_RUNTIME="$STATE_DIR/compose.runtime.yml"
WORK_ENV="$STATE_DIR/env.candidate"
NEW_SERVER_ENV="$STATE_DIR/server.env.new"

HAD_COMPOSE=0
HAD_ENV=0
HAD_SERVER_ENV=0
if [ -f "$ACTIVE_COMPOSE" ]; then
  cp "$ACTIVE_COMPOSE" "$STATE_DIR/compose.before"
  HAD_COMPOSE=1
fi
if [ -f "$ACTIVE_ENV" ]; then
  cp "$ACTIVE_ENV" "$STATE_DIR/env.before"
  HAD_ENV=1
fi
if [ -f "$ACTIVE_SERVER_ENV" ]; then
  cp "$ACTIVE_SERVER_ENV" "$STATE_DIR/server.env.before"
  HAD_SERVER_ENV=1
fi

compose_cmd() {
  local compose_file=$1 env_file=$2
  shift 2
  env -u GAMEBOX_VERSION docker compose --project-directory "$DEPLOY_DIR" \
    -f "$compose_file" --env-file "$env_file" "$@"
}
dc() { compose_cmd "$WORK_COMPOSE_RUNTIME" "$WORK_ENV" "$@"; }
active_dc() { compose_cmd "$ACTIVE_COMPOSE" "$ACTIVE_ENV" "$@"; }
dc_version() {
  local version=$1
  shift
  env -u GAMEBOX_VERSION GAMEBOX_VERSION="$version" docker compose \
    --project-directory "$DEPLOY_DIR" -f "$WORK_COMPOSE_RUNTIME" \
    --env-file "$WORK_ENV" "$@"
}

wait_healthy() {
  local attempts=$1 runner=${2:-dc} server_cid web_cid
  for i in $(seq 1 "$attempts"); do
    server_cid=$("$runner" ps -q server)
    web_cid=$("$runner" ps -q web)
    if [ -n "$server_cid" ] && [ -n "$web_cid" ] \
      && [ "$(docker inspect -f '{{.State.Health.Status}}' "$server_cid" 2>/dev/null)" = healthy ] \
      && docker exec "$web_cid" sh -ec \
        'wget -q -O /dev/null http://127.0.0.1:8080/ &&
         wget -q -O /dev/null http://127.0.0.1:8081/ &&
         wget -q -O /dev/null http://127.0.0.1:8082/' >/dev/null 2>&1; then
      echo "server + web 健康检查通过（第 ${i} 次）"
      return 0
    fi
    sleep 2
  done
  return 1
}

# 往 .env.prod 里写/改一个键，保留其余内容（密钥就存在这个文件里，不能整份重写）
set_env_kv() {
  local file=$1 key=$2 val=$3
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    sed -i "s#^${key}=.*#${key}=${val}#" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}

log_history() {
  printf '%s\t%s\t%s\t%s\n' "$(date -Iseconds)" "$1" "$2" "${3:-}" >> "$HISTORY_FILE"
}
add_warning() {
  DEPLOY_WARNINGS+=("$1")
  echo "!! 发布告警：$1" >&2
}

# ── 上传物落位 ────────────────────────────────────────────
# 所有上传物先在隔离目录验完；切换成功前绝不覆盖线上 Compose/运维脚本。
# 文件名带版本号，取最新上传的那个。
TARBALL=$(ls -t "$UPLOAD_DIR"/gamebox-images*.tar.gz 2>/dev/null | head -1 || true)
if [ -z "$TARBALL" ]; then
  echo "缺少 $UPLOAD_DIR/gamebox-images-<版本>.tar.gz，请先构建并上传"
  exit 1
fi
MANIFEST="$UPLOAD_DIR/$(basename "${TARBALL%.tar.gz}").manifest"
if [ ! -f "$MANIFEST" ]; then
  echo "缺少与镜像包配套的完整性清单：$MANIFEST" >&2
  exit 1
fi

if [ -f "$UPLOAD_DIR/$COMPOSE_FILE" ]; then
  cp "$UPLOAD_DIR/$COMPOSE_FILE" "$WORK_COMPOSE"
elif [ -f "$ACTIVE_COMPOSE" ]; then
  cp "$ACTIVE_COMPOSE" "$WORK_COMPOSE"
else
  echo "缺少 $COMPOSE_FILE，请先从本机 scp 上传"
  exit 1
fi

SECURITY_SCRIPT=""
TLS_SCRIPT=""
for pair in "verify-runtime-security.sh|SECURITY_SCRIPT" "check-tls-on-server.sh|TLS_SCRIPT"; do
  IFS='|' read -r script variable <<<"$pair"
  candidate=""
  [ ! -f "$DEPLOY_DIR/$script" ] || candidate="$DEPLOY_DIR/$script"
  [ ! -f "$UPLOAD_DIR/$script" ] || candidate="$UPLOAD_DIR/$script"
  [ -n "$candidate" ] || {
    echo "缺少必需运维脚本：$script" >&2
    exit 1
  }
  bash -n "$candidate"
  printf -v "$variable" '%s' "$candidate"
done

# ── 密钥：首次生成并持久化，重复部署复用 ──────────────────
if [ "$HAD_ENV" = 1 ]; then
  cp "$STATE_DIR/env.before" "$WORK_ENV"
  set -a
  # shellcheck disable=SC1090
  source "$WORK_ENV"
  set +a
fi
if grep -q '^DB_PASSWORD=' "$WORK_ENV" 2>/dev/null; then
  echo "==> 复用已有 .env.prod 密钥（候选副本）"
else
  DB_PASSWORD=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 32)
  REDIS_PASSWORD=$(openssl rand -hex 16)
  printf 'DB_PASSWORD=%s\nREDIS_PASSWORD=%s\nJWT_SECRET=%s\n' \
    "$DB_PASSWORD" "$REDIS_PASSWORD" "$JWT_SECRET" > "$WORK_ENV"
  echo "==> 已生成首装候选密钥（验收成功后才落位）"
fi
chmod 600 "$WORK_ENV"

: "${DB_PASSWORD:?DB_PASSWORD 缺失}"
: "${JWT_SECRET:?JWT_SECRET 缺失}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"

restore_previous_state() {
  local ok=1
  if [ "$HAD_ENV" = 1 ]; then
    cp "$STATE_DIR/env.before" "$ACTIVE_ENV" || ok=0
  else
    rm -f "$ACTIVE_ENV" || ok=0
  fi
  if [ "$HAD_COMPOSE" = 1 ]; then
    cp "$STATE_DIR/compose.before" "$ACTIVE_COMPOSE" || ok=0
  else
    rm -f "$ACTIVE_COMPOSE" || ok=0
  fi
  if [ "$HAD_SERVER_ENV" = 1 ]; then
    mkdir -p "$(dirname "$ACTIVE_SERVER_ENV")" || ok=0
    cp "$STATE_DIR/server.env.before" "$ACTIVE_SERVER_ENV" || ok=0
  else
    rm -f "$ACTIVE_SERVER_ENV" || ok=0
  fi
  [ ! -f "$ACTIVE_ENV" ] || chmod 600 "$ACTIVE_ENV" || ok=0
  [ ! -f "$ACTIVE_SERVER_ENV" ] || chmod 600 "$ACTIVE_SERVER_ENV" || ok=0
  return "$((1 - ok))"
}

# 对账探活密钥：/api/health/reconcile 会回差额金额与对不上的科目，不能公开。
# 老部署的 .env.prod 里没有这项，这里补生成（已有则沿用，换了探活脚本就得同步改）。
RECON_HEALTH_TOKEN="${RECON_HEALTH_TOKEN:-}"
if [ -z "$RECON_HEALTH_TOKEN" ]; then
  RECON_HEALTH_TOKEN=$(openssl rand -hex 24)
  set_env_kv "$WORK_ENV" RECON_HEALTH_TOKEN "$RECON_HEALTH_TOKEN"
  echo "==> 已生成对账探活密钥 RECON_HEALTH_TOKEN"
fi
# source 得到的是当前线上状态；命令行的非空 Origin 必须优先，未传才复用旧值。
PREV_VERSION="${GAMEBOX_VERSION:-}"
PREV_PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
PREV_ADMIN_BASE_URL="${ADMIN_BASE_URL:-}"
PREV_GAME_BASE_URL="${GAME_BASE_URL:-}"
PUBLIC_BASE_URL="${REQUESTED_PUBLIC_BASE_URL:-$PREV_PUBLIC_BASE_URL}"
ADMIN_BASE_URL="${REQUESTED_ADMIN_BASE_URL:-$PREV_ADMIN_BASE_URL}"
GAME_BASE_URL="${REQUESTED_GAME_BASE_URL:-$PREV_GAME_BASE_URL}"

# 三端口只绑 127.0.0.1，必须由三个不同的 HTTPS Origin 对外提供。
for key in PUBLIC_BASE_URL ADMIN_BASE_URL GAME_BASE_URL; do
  value="${!key:-}"
  if [[ ! "$value" =~ ^https://[^/]+$ ]]; then
    echo "$key 必须是无路径的 HTTPS Origin，例如 https://app.example.com"
    echo "  当前值：${value:-<空>}"
    exit 1
  fi
done
if [ "$PUBLIC_BASE_URL" = "$ADMIN_BASE_URL" ] \
  || [ "$PUBLIC_BASE_URL" = "$GAME_BASE_URL" ] \
  || [ "$ADMIN_BASE_URL" = "$GAME_BASE_URL" ]; then
  echo "PUBLIC_BASE_URL、ADMIN_BASE_URL、GAME_BASE_URL 必须是三个不同 Origin。"
  exit 1
fi

# 新版 web 容器不再做来源 IP 限流：容器看到的是 Docker 网关，在内层限会变成全站共享桶。
# 必须先确认宿主机 TLS Nginx 已按真实 $remote_addr 配好 gamebox_api_ip，再允许部署。
NGINX_BIN=""
for candidate in nginx /usr/sbin/nginx /www/server/nginx/sbin/nginx; do
  if command -v "$candidate" >/dev/null 2>&1; then
    NGINX_BIN=$(command -v "$candidate")
    break
  fi
done
if [ -n "$NGINX_BIN" ]; then
  if ! NGINX_DUMP=$("$NGINX_BIN" -T 2>&1); then
    echo "宿主机 Nginx 配置无法通过 nginx -T，拒绝部署。"
    exit 1
  fi
  if ! grep -Eq 'limit_req_zone[[:space:]]+\$binary_remote_addr[[:space:]]+zone=gamebox_api_ip:' <<<"$NGINX_DUMP" \
    || ! grep -Eq 'limit_req[[:space:]]+zone=gamebox_api_ip([[:space:];]|$)' <<<"$NGINX_DUMP"; then
    echo "宿主机 Nginx 尚未配置 gamebox_api_ip 来源限流，拒绝部署新版 web。"
    echo "请先按 docs/反向代理与TLS.md 配置并执行 nginx -t && nginx -s reload。"
    exit 1
  fi
  echo "==> 宿主机 API 来源限流已确认；三 Origin 映射将在切换后用 Host+SNI 内容门禁逐一验证"
elif [ "${HOST_API_LIMIT_READY:-0}" != 1 ]; then
  echo "找不到宿主机 nginx 命令，无法确认 API 来源限流。"
  echo "确认配置无误后显式加 HOST_API_LIMIT_READY=1 重跑；不要把它当默认值写进脚本。"
  exit 1
fi

# ── 导入镜像并认版本号 ────────────────────────────────────
NORMALIZED_MANIFEST="$STATE_DIR/manifest.normalized"
tr -d '\r' < "$MANIFEST" > "$NORMALIZED_MANIFEST"
manifest_value() {
  local key=$1
  awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' \
    "$NORMALIZED_MANIFEST"
}
MANIFEST_KEYS=(manifest_version version git_commit dirty dirty_reason archive_sha256 server_image_id web_image_id compose_sha256)
[ "$(wc -l < "$NORMALIZED_MANIFEST" | tr -d ' ')" = "${#MANIFEST_KEYS[@]}" ] || {
  echo "完整性清单字段数不正确，拒绝部署。" >&2
  exit 1
}
for key in "${MANIFEST_KEYS[@]}"; do
  [ "$(grep -c "^${key}=" "$NORMALIZED_MANIFEST")" = 1 ] || {
    echo "完整性清单字段 $key 缺失或重复：$MANIFEST" >&2
    exit 1
  }
done
[ "$(manifest_value manifest_version)" = 1 ] || {
  echo "不支持的完整性清单版本" >&2
  exit 1
}
MANIFEST_VERSION=$(manifest_value version)
MANIFEST_COMMIT=$(manifest_value git_commit)
MANIFEST_DIRTY=$(manifest_value dirty)
MANIFEST_DIRTY_REASON=$(manifest_value dirty_reason)
EXPECTED_ARCHIVE_SHA=$(manifest_value archive_sha256)
EXPECTED_SERVER_IMAGE_ID=$(manifest_value server_image_id)
EXPECTED_WEB_IMAGE_ID=$(manifest_value web_image_id)
EXPECTED_COMPOSE_SHA=$(manifest_value compose_sha256)
[[ "$MANIFEST_VERSION" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}(-dirty-emergency)?$ ]] || {
  echo "manifest version 格式非法：$MANIFEST_VERSION" >&2
  exit 1
}
[[ "$MANIFEST_COMMIT" =~ ^[0-9a-f]{40}$ ]] || {
  echo "manifest git_commit 必须是 40 位小写十六进制。" >&2
  exit 1
}
[[ "$MANIFEST_DIRTY" =~ ^[01]$ ]] || {
  echo "manifest dirty 只能是 0 或 1。" >&2
  exit 1
}
if [ "$MANIFEST_DIRTY" = 1 ]; then
  [ -n "${MANIFEST_DIRTY_REASON//[[:space:]]/}" ] || {
    echo "manifest dirty=1 时 dirty_reason 必须非空。" >&2
    exit 1
  }
  [[ "$MANIFEST_VERSION" == *-dirty-emergency ]] || {
    echo "dirty 构建版本必须带 -dirty-emergency 后缀。" >&2
    exit 1
  }
elif [ -n "$MANIFEST_DIRTY_REASON" ] || [[ "$MANIFEST_VERSION" == *-dirty-emergency ]]; then
  echo "clean manifest 不得携带 dirty_reason/dirty 版本后缀。" >&2
  exit 1
fi
for hash in "$EXPECTED_ARCHIVE_SHA" "$EXPECTED_COMPOSE_SHA"; do
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || {
    echo "manifest SHA-256 格式非法：$hash" >&2
    exit 1
  }
done
for image_id in "$EXPECTED_SERVER_IMAGE_ID" "$EXPECTED_WEB_IMAGE_ID"; do
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "manifest 镜像 ID 格式非法：$image_id" >&2
    exit 1
  }
done
ACTUAL_ARCHIVE_SHA=$(sha256sum "$TARBALL" | awk '{print $1}')
[ "$ACTUAL_ARCHIVE_SHA" = "$EXPECTED_ARCHIVE_SHA" ] || {
  echo "镜像包 SHA-256 不匹配，拒绝 docker load。" >&2
  exit 1
}
ACTUAL_COMPOSE_SHA=$(sha256sum "$WORK_COMPOSE" | awk '{print $1}')
[ "$ACTUAL_COMPOSE_SHA" = "$EXPECTED_COMPOSE_SHA" ] || {
  echo "服务器 Compose 与构建时根权威文件不一致，拒绝部署。" >&2
  echo "  期望 $EXPECTED_COMPOSE_SHA；实际 $ACTUAL_COMPOSE_SHA" >&2
  exit 1
}

echo "==> 导入镜像 $(basename "$TARBALL")..."
LOAD_LOG=$(docker load -i "$TARBALL")
echo "$LOAD_LOG"

NEW_VERSION=$(printf '%s\n' "$LOAD_LOG" \
  | sed -n 's#^Loaded image: gamebox-server:\(.*\)$#\1#p' | head -1)
if [ -z "$NEW_VERSION" ]; then
  echo "tar 包里没找到带版本号的 gamebox-server 镜像。"
  echo "请用 scripts/build-images.ps1 重新构建（旧的 latest 包不支持回滚，不再接受）。"
  exit 1
fi
if [ "$NEW_VERSION" = latest ]; then
  echo "镜像标签仍是 latest：同名覆盖会摘掉旧镜像的标签，出事无法回退。"
  echo "请用 scripts/build-images.ps1 重新构建。"
  exit 1
fi
[ "$NEW_VERSION" = "$MANIFEST_VERSION" ] || {
  echo "docker load 得到的版本与完整性清单不一致。" >&2
  exit 1
}
# 前后端必须同版本，否则会出现新前端调旧接口
if ! docker image inspect "gamebox-web:$NEW_VERSION" >/dev/null 2>&1; then
  echo "tar 包里缺少同版本的 gamebox-web:$NEW_VERSION，拒绝部署。"
  exit 1
fi
ACTUAL_SERVER_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "gamebox-server:$NEW_VERSION")
ACTUAL_WEB_IMAGE_ID=$(docker image inspect --format '{{.Id}}' "gamebox-web:$NEW_VERSION")
if [ "$ACTUAL_SERVER_IMAGE_ID" != "$EXPECTED_SERVER_IMAGE_ID" ] \
  || [ "$ACTUAL_WEB_IMAGE_ID" != "$EXPECTED_WEB_IMAGE_ID" ]; then
  echo "docker load 后镜像 ID 与构建清单不一致，拒绝部署。" >&2
  exit 1
fi
echo "==> 镜像包 SHA-256、Compose SHA-256 与 server/web 镜像 ID 已核验"
BUILT_PLAYER_ORIGIN=$(docker image inspect \
  --format '{{ index .Config.Labels "org.gamebox.player-origin" }}' \
  "gamebox-web:$NEW_VERSION")
BUILT_GAME_ORIGIN=$(docker image inspect \
  --format '{{ index .Config.Labels "org.gamebox.game-origin" }}' \
  "gamebox-web:$NEW_VERSION")
if [ "$BUILT_PLAYER_ORIGIN" != "$PUBLIC_BASE_URL" ] \
  || [ "$BUILT_GAME_ORIGIN" != "$GAME_BASE_URL" ]; then
  echo "镜像内 Origin 与本次部署参数不一致，拒绝上线。"
  echo "  镜像玩家域：$BUILT_PLAYER_ORIGIN；部署玩家域：$PUBLIC_BASE_URL"
  echo "  镜像游戏域：$BUILT_GAME_ORIGIN；部署游戏域：$GAME_BASE_URL"
  exit 1
fi
if [ -n "$PREV_VERSION" ]; then
  if ! docker image inspect "gamebox-server:$PREV_VERSION" >/dev/null 2>&1 \
    || ! docker image inspect "gamebox-web:$PREV_VERSION" >/dev/null 2>&1; then
    echo "!! 上一版 $PREV_VERSION 镜像不完整，本次没有可自动回退版本。"
    PREV_VERSION=""
  else
    PREV_PLAYER_ORIGIN=$(docker image inspect \
      --format '{{ index .Config.Labels "org.gamebox.player-origin" }}' \
      "gamebox-web:$PREV_VERSION" 2>/dev/null || true)
    PREV_GAME_ORIGIN=$(docker image inspect \
      --format '{{ index .Config.Labels "org.gamebox.game-origin" }}' \
      "gamebox-web:$PREV_VERSION" 2>/dev/null || true)
    if [ -z "$PREV_PUBLIC_BASE_URL" ] || [ -z "$PREV_GAME_BASE_URL" ] \
      || [ "$PREV_PLAYER_ORIGIN" != "$PREV_PUBLIC_BASE_URL" ] \
      || [ "$PREV_GAME_ORIGIN" != "$PREV_GAME_BASE_URL" ]; then
      echo "!! 上一版 $PREV_VERSION 与其已保存 Origin 不兼容，本次不会自动回滚到它。"
      PREV_VERSION=""
    fi
  fi
fi

echo "==> 本次版本 $NEW_VERSION（上一版 ${PREV_VERSION:-无}）"
if [ "$MANIFEST_DIRTY" = 1 ]; then
  add_warning "本版本由 dirty 工作区应急构建：$MANIFEST_DIRTY_REASON"
fi

echo "==> 预检运行时安全验收依赖..."
bash "$SECURITY_SCRIPT" --check-prerequisites
echo "==> 停旧服务前扫描新镜像漏洞..."
if ! DEPLOY_DIR="$DEPLOY_DIR" bash "$SECURITY_SCRIPT" --scan-images "$NEW_VERSION"; then
  log_history security-image-failed "$NEW_VERSION" "Trivy HIGH/CRITICAL"
  exit 1
fi
log_history security-image-passed "$NEW_VERSION" "停机前 Trivy HIGH/CRITICAL"

echo "==> 拉取 postgres/redis（若本地已有会很快）..."
docker pull postgres:15-alpine@sha256:3d0f7584ed7d04e27fa050d6683a74746608faf21f202be78460d679cc56461f
docker pull redis:7-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2

REDIS_URL="redis://redis:6379"
if [ -n "$REDIS_PASSWORD" ]; then
  REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379"
fi

cat > "$NEW_SERVER_ENV" <<EOF
NODE_ENV=production
PORT=3001
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
AUTH_ALLOWED_ORIGINS=${PUBLIC_BASE_URL},${ADMIN_BASE_URL}
# 两跳代理：宿主机 Nginx → web 容器 Nginx → server，两层都会往 XFF 追加一条。
# 填 1 会把 req.ip 解析成 docker 网关，导致按 IP 的限流与同 IP 风控全部失灵。
TRUST_PROXY=2
DATABASE_URL=postgresql://gamebox:${DB_PASSWORD}@postgres:5432/gamebox?schema=public
REDIS_URL=${REDIS_URL}
JWT_SECRET=${JWT_SECRET}
# 没有 refresh 机制，token 一旦泄露只能等它过期或改密（改密会 bump tokenVersion）。
# 8 小时够玩一整晚，又不至于让一台丢掉的手机长期有效。
JWT_EXPIRES_IN=8h
PLATFORM_FEE_RATE=0.05
DEFAULT_BALANCE=0
COMMISSION_MAX_LEVEL=5
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=./uploads
THROTTLE_TTL_MS=60000
THROTTLE_LIMIT=120
# 客服图片：玩家须已进房；日配额走 Redis，聊天图最多 2MB，防止公开注册号灌满磁盘
CS_PLAYER_UPLOAD_DAILY_LIMIT=10
CS_STAFF_UPLOAD_DAILY_LIMIT=30
CS_CHAT_IMAGE_MAX_BYTES=2097152
CS_PRIVATE_UPLOAD_DIR=private-uploads/cs
CS_MEDIA_ORPHAN_DAYS=7
CS_MEDIA_RETENTION_DAYS=90
RECON_HEALTH_TOKEN=${RECON_HEALTH_TOKEN}
# 容器内存上限 1g，而 Node 默认堆上限可能接近它：超了会被内核直接 OOM-kill，
# 只留一行 "Killed"。压到 768m 让它先抛 JS 堆溢出，至少有调用栈可查。
NODE_OPTIONS=--max-old-space-size=768
EOF

chmod 600 "$NEW_SERVER_ENV"

# 候选 Compose 只把 service env_file 改成隔离目录里的新配置；project directory 固定为
# DEPLOY_DIR，因此容器/网络/卷身份与线上一致，但首装不需要提前创建 server/.env.production。
awk -v env_file="$NEW_SERVER_ENV" '
  /^[[:space:]]+- server\/\.env\.production[[:space:]]*$/ {
    sub(/server\/\.env\.production/, env_file)
  }
  { print }
' "$WORK_COMPOSE" > "$WORK_COMPOSE_RUNTIME"
grep -qF "$NEW_SERVER_ENV" "$WORK_COMPOSE_RUNTIME" || {
  echo "无法为候选 Compose 注入隔离的 server env_file。" >&2
  exit 1
}
set_env_kv "$WORK_ENV" GAMEBOX_VERSION "$NEW_VERSION"
set_env_kv "$WORK_ENV" PUBLIC_BASE_URL "$PUBLIC_BASE_URL"
set_env_kv "$WORK_ENV" ADMIN_BASE_URL "$ADMIN_BASE_URL"
set_env_kv "$WORK_ENV" GAME_BASE_URL "$GAME_BASE_URL"
chmod 600 "$WORK_ENV"
# image Compose 不允许 latest；候选 env/server env 均已齐全，首装与升级都可解析。
dc config --quiet

# 迁移必须先于应用对外提供服务，否则新代码会短暂跑在旧表结构上
echo "==> 启动数据库与缓存..."
dc up -d postgres redis

echo "==> 等待数据库就绪..."
DB_ATTEMPTS=60
for i in $(seq 1 "$DB_ATTEMPTS"); do
  if dc exec -T postgres pg_isready -U gamebox -d gamebox >/dev/null 2>&1; then
    echo "数据库就绪（第 ${i} 次）"
    break
  fi
  if [ "$i" -eq "$DB_ATTEMPTS" ]; then
    echo "数据库启动超时，请查看 docker compose logs postgres"
    exit 1
  fi
  sleep 2
done

cutover_failed() {
  local reason=${1:-未知错误} state_ok=1 stopped_ok=1
  trap - ERR
  set +e
  echo "!! 发布切换失败（$reason），先停止失败版本并恢复切换前 env/Compose 状态。" >&2
  dc stop server web || stopped_ok=0
  if [ "$stopped_ok" != 1 ]; then
    echo "!! 无法确认失败版本已停止，继续恢复旧状态但必须立即人工核验容器。" >&2
  fi
  restore_previous_state || state_ok=0
  if [ "$state_ok" != 1 ]; then
    KEEP_STATE=1
    echo "!! 旧环境文件恢复失败，禁止继续自动启动，请立即人工介入。备份仍在 $STATE_DIR。" >&2
    exit 1
  fi
  if [ -n "$PREV_VERSION" ]; then
    echo "==> 重启已通过兼容性校验的旧版本 $PREV_VERSION..."
    if active_dc up -d && wait_healthy 60 active_dc; then
      log_history auto-rollback "$PREV_VERSION" "失败版本=$NEW_VERSION；原因=$reason"
      echo "旧版本 $PREV_VERSION 已恢复健康；失败的新镜像保留供排查。" >&2
    else
      echo "!! 旧版本 $PREV_VERSION 启动或健康检查失败，服务保持当前状态，请立即人工介入。" >&2
      dc logs --tail 50 server web || true
    fi
  else
    echo "没有经过 Origin/镜像完整性校验的旧版本可恢复，server/web 保持停止。" >&2
  fi
  exit 1
}
trap 'cutover_failed "第 $LINENO 行命令失败"' ERR
echo "==> 停止旧 server/web，避免迁移期间旧代码继续写库..."
dc stop server web

echo "==> 数据库迁移（生产不执行 seed）..."
# 旧版本曾以 root 写 named volume；仅这个一次性任务补 CAP_CHOWN。
# 长期运行的 server 仍由 compose 保持 cap_drop: [ALL]。
dc_version "$NEW_VERSION" run --rm --no-deps --user 0:0 --cap-add CHOWN server \
  chown -R 1000:1000 /repo/server/uploads /repo/server/private-uploads
# 不走 npx，避免只读根文件系统下创建 npm 缓存或临时安装。
dc_version "$NEW_VERSION" run --rm --no-deps \
  -e "DATABASE_URL=postgresql://gamebox:${DB_PASSWORD}@postgres:5432/gamebox?schema=public" \
  server node node_modules/prisma/build/index.js migrate deploy

# 迁移只建空表。游戏目录、各游戏赔率、代理等级、平台 1 亿开账、管理员账号全在
# seed 里，而生产从不自动 seed。全新库不初始化的结果是：后台没有任何账号可登录，
# 就算进去也一个游戏都没有；postgres 又只挂在 internal 网络上，没法从外面补数据。
# 这种状态必须吵出来，不能让它静默通过成一次「成功」的发布。
echo "==> 检查平台基础数据（游戏目录 / 管理员）..."
BOOTSTRAP_NEEDED=0
set +e
SEED_PROBE=$(dc exec -T postgres psql -U gamebox -d gamebox -tAc \
  "SELECT (SELECT COUNT(*) FROM \"Game\") || ':' || (SELECT COUNT(*) FROM \"User\" WHERE role::text = 'ADMIN')" 2>/dev/null)
SEED_PROBE_RC=$?
set -e
if [ "$SEED_PROBE_RC" = 0 ] && [ -n "$SEED_PROBE" ]; then
  SEED_PROBE=$(echo "$SEED_PROBE" | tr -d '[:space:]')
  GAME_COUNT=${SEED_PROBE%%:*}
  ADMIN_COUNT=${SEED_PROBE##*:}
  if [ "${GAME_COUNT:-0}" = 0 ] || [ "${ADMIN_COUNT:-0}" = 0 ]; then
    BOOTSTRAP_NEEDED=1
    add_warning "平台基础数据缺失（游戏 ${GAME_COUNT} 个、管理员 ${ADMIN_COUNT} 个），须先跑一次初始化，否则后台登不进去且没有游戏"
  fi
else
  add_warning "无法探测平台基础数据，请手动确认游戏目录与管理员账号是否存在"
fi

echo "==> 启动应用容器..."
dc up -d

echo "==> 等待服务健康..."
if ! wait_healthy 60; then
  echo ""
  echo "!! 新版本 $NEW_VERSION 起不来，最近 50 行日志："
  dc logs --tail 50 server web || true
  cutover_failed "新版本健康检查超时"
fi

echo "==> 强制执行运行时容器加固验收..."
if ! DEPLOY_DIR="$DEPLOY_DIR" COMPOSE_FILE="$WORK_COMPOSE_RUNTIME" ENV_FILE="$WORK_ENV" \
  bash "$SECURITY_SCRIPT" --check-runtime; then
  log_history security-runtime-failed "$NEW_VERSION" "新版本健康后容器加固失败"
  cutover_failed "运行时安全验收失败"
fi
log_history security-runtime-passed "$NEW_VERSION" "非 root/只读/权限/网络"

echo "==> 强制执行三 Origin TLS/映射验收..."
if ! PUBLIC_BASE_URL="$PUBLIC_BASE_URL" ADMIN_BASE_URL="$ADMIN_BASE_URL" \
  GAME_BASE_URL="$GAME_BASE_URL" DEPLOY_DIR="$DEPLOY_DIR" bash "$TLS_SCRIPT"; then
  log_history tls-origin-failed "$NEW_VERSION" "HTTP/TLS/HSTS/Host+SNI 映射失败"
  cutover_failed "三 Origin TLS/映射验收失败"
fi
log_history tls-origin-passed "$NEW_VERSION" "8080/8081/8082 映射已逐一证明"

# 直到镜像扫描、迁移、健康、运行时与 TLS 全部通过，才把三份核心配置作为一组落位。
install_atomic() {
  local source=$1 destination=$2 mode=${3:-}
  local directory temporary
  directory=$(dirname "$destination")
  mkdir -p "$directory" || return 1
  temporary="$directory/.deploy.$(basename "$destination").$$"
  cp "$source" "$temporary" || return 1
  if [ -n "$mode" ]; then
    chmod "$mode" "$temporary" || return 1
  fi
  mv -f "$temporary" "$destination" || return 1
}
commit_core_state() {
  install_atomic "$WORK_COMPOSE" "$ACTIVE_COMPOSE" || return 1
  install_atomic "$WORK_ENV" "$ACTIVE_ENV" 600 || return 1
  install_atomic "$NEW_SERVER_ENV" "$ACTIVE_SERVER_ENV" 600 || return 1
}
echo "==> 原子落位已验收的 Compose/env 状态..."
if ! commit_core_state; then
  cutover_failed "核心配置落位失败"
fi

trap - ERR
set +e

# 运维脚本也只在切换成功后逐个原子替换；失败保留旧脚本并记录告警。
for s in deploy-on-server.sh rollback-on-server.sh backup-on-server.sh restore-on-server.sh \
  check-tls-on-server.sh verify-runtime-security.sh health-alert.mjs; do
  if [ -f "$UPLOAD_DIR/$s" ]; then
    install_atomic "$UPLOAD_DIR/$s" "$DEPLOY_DIR/$s" \
      || add_warning "更新运维文件 $s 失败，保留旧版本"
  fi
done

# ── 定时任务：备份与探活 ──────────────────────────────────
#
# 这两件事以前只写在文档里，靠人去宝塔面板手点。漏了不会有任何报错，
# 等到需要恢复的那天才发现一份备份都没有。改成部署时自动写进 crontab，
# 已存在就不动（运营改过时间的话保留他改的）。
ensure_cron() {
  local marker=$1 line=$2 desc=$3
  local current
  current=$(crontab -l 2>/dev/null || true)
  if printf '%s\n' "$current" | grep -qF "$marker"; then
    echo "  已存在：$desc"
    return 0
  fi
  if printf '%s\n%s\n' "$current" "$line" | sed '/^$/d' | crontab -; then
    echo "  已写入：$desc"
    return 0
  fi
  return 1
}

# 探活脚本跑在宿主机上，读的是它同目录的 health-alert.env，跟容器里的环境变量不通。
# 密钥两边必须一致，否则把 HEALTH_URL 指到 /api/health/reconcile 会一直 403 误报。
configure_health_env() {
  [ -f "$DEPLOY_DIR/health-alert.mjs" ] || return 0
  touch "$DEPLOY_DIR/health-alert.env"
  chmod 600 "$DEPLOY_DIR/health-alert.env"
  if grep -q '^RECON_HEALTH_TOKEN=' "$DEPLOY_DIR/health-alert.env"; then
    sed -i "s#^RECON_HEALTH_TOKEN=.*#RECON_HEALTH_TOKEN=${RECON_HEALTH_TOKEN}#" \
      "$DEPLOY_DIR/health-alert.env"
  else
    printf 'RECON_HEALTH_TOKEN=%s\n' "$RECON_HEALTH_TOKEN" >> "$DEPLOY_DIR/health-alert.env"
  fi
}
configure_health_env || add_warning "同步 health-alert.env 的对账密钥失败"

echo "==> 检查定时任务..."
if command -v crontab >/dev/null 2>&1; then
  if ! ensure_cron \
    "$DEPLOY_DIR/backup-on-server.sh" \
    "30 4 * * * bash $DEPLOY_DIR/backup-on-server.sh >> $DEPLOY_DIR/backup.log 2>&1" \
    "每日 04:30 备份"; then
    add_warning "crontab 写入每日备份任务失败，须立即手工配置"
  fi
  if [ -f "$DEPLOY_DIR/health-alert.mjs" ]; then
    if ! ensure_cron \
      "$DEPLOY_DIR/health-alert.mjs" \
      "*/5 * * * * node $DEPLOY_DIR/health-alert.mjs >> $DEPLOY_DIR/health-alert.log 2>&1" \
      "每 5 分钟探活"; then
      add_warning "crontab 写入健康告警任务失败，须立即手工配置"
    fi
  else
    add_warning "缺少 health-alert.mjs，服务故障不会自动通知"
    echo "     scp scripts/health-alert.mjs root@<服务器>:$DEPLOY_DIR/ 后重新部署"
  fi
else
  add_warning "系统没有 crontab，须在宝塔手工配置备份与探活任务"
  echo "  请手工在宝塔计划任务里加："
  echo "     每日 04:30  bash $DEPLOY_DIR/backup-on-server.sh"
  echo "     每 5 分钟   node $DEPLOY_DIR/health-alert.mjs"
fi

# ── 备份加密与 HMAC 认证口令 ───────────────────────────────
# 备份包里带着 .env.prod（数据库密码 + JWT 密钥），推去对象存储或别人的机器时
# 明文包等于把整个平台交出去。加密与 HMAC 使用两把独立随机密钥，恢复时先验
# Encrypt-then-MAC 再解密。首次部署生成，之后一直复用——换密钥会让已有包失效。
if [ ! -f backup.env ] || ! grep -q '^BACKUP_ENCRYPT_KEY=' backup.env 2>/dev/null; then
  if printf 'BACKUP_ENCRYPT_KEY=%s\n' "$(openssl rand -hex 32)" >> backup.env \
    && chmod 600 backup.env; then
    echo "==> 已生成备份加密密钥，写入 $DEPLOY_DIR/backup.env"
  else
    add_warning "生成 backup.env 加密口令失败，自动备份不可安全异地保存"
  fi
fi
if [ ! -f backup.env ] || ! grep -q '^BACKUP_AUTH_KEY=' backup.env 2>/dev/null; then
  if printf 'BACKUP_AUTH_KEY=%s\n' "$(openssl rand -hex 32)" >> backup.env \
    && chmod 600 backup.env; then
    echo "==> 已生成备份 HMAC 认证密钥"
  else
    add_warning "生成备份 HMAC 认证密钥失败，认证加密备份会 fail closed"
  fi
fi
if grep -q '^BACKUP_ENCRYPT_KEY=' backup.env 2>/dev/null \
  && grep -q '^BACKUP_AUTH_KEY=' backup.env 2>/dev/null; then
  echo "   !! 请把两把备份密钥一起存到服务器之外（密码管理器等）："
  echo "      grep '^BACKUP_\\(ENCRYPT\\|AUTH\\)_KEY=' $DEPLOY_DIR/backup.env"
  echo "      任一密钥丢失，已有备份就无法验证或解密。"
fi

# 异地副本没配就一直喊。备份和库在同一块盘上，硬盘坏了等于没备过。
if [ ! -f "$DEPLOY_DIR/backup.env" ] || ! grep -q '^BACKUP_OFFSITE_CMD=' "$DEPLOY_DIR/backup.env" 2>/dev/null; then
  echo ""
  add_warning "未配置异地备份 BACKUP_OFFSITE_CMD，备份与数据库仍同盘"
  echo "     当前备份与数据库同盘，只防误删，不防硬盘损坏与服务器回收。"
  echo "     例：BACKUP_OFFSITE_CMD='rclone copy \"\$1\" remote:gamebox-backups'"
fi

# ── 清理超出保留数的旧镜像 ────────────────────────────────
# 标签是「日期-时刻-提交号」，字典序倒排就是时间倒排
prune_old_images() {
  local repo=$1
  docker images "$repo" --format '{{.Tag}}' \
    | grep -vx 'latest' | grep -vx '<none>' \
    | sort -r | tail -n "+$((KEEP_VERSIONS + 1))" \
    | while read -r tag; do
        [ "$tag" = "$NEW_VERSION" ] && continue
        if docker rmi "$repo:$tag" >/dev/null 2>&1; then
          echo "  已清理 $repo:$tag"
        fi
      done
  return 0
}
echo "==> 清理旧镜像（保留最近 $KEEP_VERSIONS 套）..."
prune_old_images gamebox-server || add_warning "清理旧 server 镜像失败"
prune_old_images gamebox-web || add_warning "清理旧 web 镜像失败"
# tar 包本身不留：镜像已经在 Docker 里了，留着纯占地方
rm -f "$TARBALL" "$MANIFEST" || add_warning "清理已导入的上传镜像包/清单失败"

WARNINGS_TEXT="无"
if [ "${#DEPLOY_WARNINGS[@]}" -gt 0 ]; then
  WARNINGS_TEXT=$(IFS='；'; echo "${DEPLOY_WARNINGS[*]}")
fi
if ! log_history deploy "$NEW_VERSION" "上一版=${PREV_VERSION:-无}；告警=${WARNINGS_TEXT}"; then
  add_warning "写入最终发布历史失败，须立即人工补记"
fi

echo "==> 状态："
active_dc ps || echo "!! 最终 docker compose ps 查询失败，请手工复查。" >&2
echo ""
echo "可回滚到的版本："
docker images gamebox-server --format '  {{.Tag}}' | grep -vx '  latest' | sort -r

echo ""
echo "完成。当前版本 $NEW_VERSION"
echo "  玩家端：${PUBLIC_BASE_URL}"
echo "  管理端：${ADMIN_BASE_URL}"
echo "  游戏域：${GAME_BASE_URL}"
echo "出问题回滚：bash $DEPLOY_DIR/rollback-on-server.sh"
if [ "${BOOTSTRAP_NEEDED:-0}" = 1 ]; then
  echo ""
  echo "!! 这个库还没初始化：没有游戏目录 / 没有管理员，现在打开后台是登不进去的。"
  echo "   补一次（只需一次，脚本幂等，已有数据会自动跳过）："
  echo ""
  # 这里必须用 ACTIVE_* 持久路径：WORK_* 在 mktemp 目录里，脚本一退出就被清掉，
  # 打出去的命令你隔天复制来跑会找不到文件。
  # 不要显式传 DATABASE_URL：server 服务已通过 env_file 加载 server/.env.production，
  # 里面就有正确的连接串。显式 -e 会覆盖它，而你的 shell 里没有 DB_PASSWORD，
  # 展开成空密码后只会得到一个认证失败。
  echo "   cd $DEPLOY_DIR && SEED_ADMIN_PASSWORD='换成你自己的强口令' \\"
  echo "     docker compose --project-directory $DEPLOY_DIR -f $ACTIVE_COMPOSE --env-file $ACTIVE_ENV \\"
  echo "     run --rm --no-deps -e SEED_ADMIN_PASSWORD server node dist-seed/prisma/seed.js"
  echo ""
  echo "   跑完用 admin + 该口令登录后台。忘记口令只能改库，系统没有重置管理员密码的接口。"
else
  echo "（生产环境不自动 seed；测试账号请自行创建）"
fi
if [ "${#DEPLOY_WARNINGS[@]}" -gt 0 ]; then
  echo ""
  echo "!! 发布完成但有 ${#DEPLOY_WARNINGS[@]} 项高可见告警（已写入 $HISTORY_FILE）："
  printf '   - %s\n' "${DEPLOY_WARNINGS[@]}"
fi
