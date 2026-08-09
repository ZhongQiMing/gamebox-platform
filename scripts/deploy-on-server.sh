#!/bin/bash
# 在服务器上执行（文件已上传到 /tmp 后）
# 用法：PUBLIC_BASE_URL=https://your-domain.com bash /tmp/deploy-on-server.sh
#
# 幂等：重复部署复用已有 DB/JWT 密钥，生产只 migrate 不 seed。
# 版本：镜像带不可变版本号，服务器保留最近 KEEP_VERSIONS 套，
#       新版起不来会自动退回上一版（见 rollback-on-server.sh 做手动回滚）。
set -euo pipefail

DEPLOY_DIR=/opt/gamebox-platform
COMPOSE_FILE=docker-compose.prod.images.yml
HISTORY_FILE=deploy-history.log
# 保留几套历史版本供回滚。真实回滚基本都在发版当天退一步，留 3 套足够；
# 镜像层是共享的，多留一套并不等于多占一份完整体积。
KEEP_VERSIONS=3
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"

mkdir -p "$DEPLOY_DIR/server"
cd "$DEPLOY_DIR"

dc() { docker compose -f "$COMPOSE_FILE" --env-file .env.prod "$@"; }

# 往 .env.prod 里写/改一个键，保留其余内容（密钥就存在这个文件里，不能整份重写）
set_env_kv() {
  local key=$1 val=$2
  touch .env.prod
  if grep -q "^${key}=" .env.prod; then
    sed -i "s#^${key}=.*#${key}=${val}#" .env.prod
  else
    printf '%s=%s\n' "$key" "$val" >> .env.prod
  fi
}

log_history() {
  printf '%s\t%s\t%s\t%s\n' "$(date -Iseconds)" "$1" "$2" "${3:-}" >> "$HISTORY_FILE"
}

# ── 上传物落位 ────────────────────────────────────────────
# 文件名带版本号，取最新上传的那个
TARBALL=$(ls -t /tmp/gamebox-images*.tar.gz 2>/dev/null | head -1 || true)
if [ -z "$TARBALL" ]; then
  echo "缺少 /tmp/gamebox-images-<版本>.tar.gz，请先在本机跑 scripts/build-images.ps1 再 scp 上来"
  exit 1
fi

if [ -f /tmp/$COMPOSE_FILE ]; then
  mv -f "/tmp/$COMPOSE_FILE" "$DEPLOY_DIR/"
elif [ ! -f "$DEPLOY_DIR/$COMPOSE_FILE" ]; then
  echo "缺少 $COMPOSE_FILE，请先从本机 scp 上传"
  exit 1
fi
# 回滚/备份/恢复/探活脚本随部署一起更新，免得出事时服务器上那份是旧的
for s in rollback-on-server.sh backup-on-server.sh restore-on-server.sh health-alert.mjs; do
  [ -f "/tmp/$s" ] && mv -f "/tmp/$s" "$DEPLOY_DIR/"
done

mv -f "$TARBALL" "$DEPLOY_DIR/"
TARBALL="$DEPLOY_DIR/$(basename "$TARBALL")"

# ── 密钥：首次生成并持久化，重复部署复用 ──────────────────
if [ -f .env.prod ] && grep -q '^DB_PASSWORD=' .env.prod; then
  # shellcheck disable=SC1091
  set -a
  # shellcheck disable=SC1091
  source .env.prod
  set +a
  echo "==> 复用已有 .env.prod 密钥"
else
  DB_PASSWORD=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 32)
  REDIS_PASSWORD=$(openssl rand -hex 16)
  echo "DB_PASSWORD=$DB_PASSWORD" > .env.prod
  echo "REDIS_PASSWORD=$REDIS_PASSWORD" >> .env.prod
  echo "JWT_SECRET=$JWT_SECRET" >> .env.prod
  echo "==> 已生成并写入 .env.prod（请妥善备份）"
fi
chmod 600 .env.prod

: "${DB_PASSWORD:?DB_PASSWORD 缺失}"
: "${JWT_SECRET:?JWT_SECRET 缺失}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"
# source 出来的就是上一次部署跑的版本，回退时要用
PREV_VERSION="${GAMEBOX_VERSION:-}"

# 8080 只绑 127.0.0.1，猜出来的 http://<公网IP>:8080 根本连不上，必须显式给对外域名
if [ -z "$PUBLIC_BASE_URL" ]; then
  echo "缺少 PUBLIC_BASE_URL。请填宿主机 Nginx 对外的 https 域名，例如："
  echo "  PUBLIC_BASE_URL=https://your-domain.com bash /tmp/deploy-on-server.sh"
  exit 1
fi
case "$PUBLIC_BASE_URL" in
  https://*) ;;
  *)
    echo "PUBLIC_BASE_URL 必须是 https://开头：登录态与上下分不能走明文。"
    echo "  当前值：$PUBLIC_BASE_URL"
    exit 1
    ;;
esac

# ── 导入镜像并认版本号 ────────────────────────────────────
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
# 前后端必须同版本，否则会出现新前端调旧接口
if ! docker image inspect "gamebox-web:$NEW_VERSION" >/dev/null 2>&1; then
  echo "tar 包里缺少同版本的 gamebox-web:$NEW_VERSION，拒绝部署。"
  exit 1
fi

echo "==> 本次版本 $NEW_VERSION（上一版 ${PREV_VERSION:-无}）"

echo "==> 拉取 postgres/redis（若本地已有会很快）..."
docker pull postgres:15-alpine || true
docker pull redis:7-alpine || true

REDIS_URL="redis://redis:6379"
if [ -n "$REDIS_PASSWORD" ]; then
  REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379"
fi

cat > server/.env.production <<EOF
NODE_ENV=production
PORT=3001
PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
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
EOF

chmod 600 server/.env.production

# compose 里的 ${GAMEBOX_VERSION} 从这里取，下面所有 dc 调用都会认到新版本
set_env_kv GAMEBOX_VERSION "$NEW_VERSION"

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

echo "==> 数据库迁移（生产不执行 seed）..."
dc run --rm --no-deps server npx prisma migrate deploy

echo "==> 启动应用容器..."
dc up -d

wait_healthy() {
  local attempts=$1
  for i in $(seq 1 "$attempts"); do
    if dc exec -T server node healthcheck.js >/dev/null 2>&1; then
      echo "健康检查通过（第 ${i} 次）"
      return 0
    fi
    sleep 2
  done
  return 1
}

echo "==> 等待服务健康..."
if ! wait_healthy 60; then
  echo ""
  echo "!! 新版本 $NEW_VERSION 起不来，最近 50 行日志："
  dc logs --tail 50 server || true

  if [ -n "$PREV_VERSION" ] && [ "$PREV_VERSION" != "$NEW_VERSION" ] \
     && docker image inspect "gamebox-server:$PREV_VERSION" >/dev/null 2>&1; then
    echo ""
    echo "==> 自动退回上一版 $PREV_VERSION..."
    set_env_kv GAMEBOX_VERSION "$PREV_VERSION"
    dc up -d
    if wait_healthy 60; then
      log_history auto-rollback "$PREV_VERSION" "失败版本=$NEW_VERSION"
      echo ""
      echo "已退回 $PREV_VERSION，站点恢复。"
      echo "新版镜像仍在服务器上，修好代码重新发即可。"
      echo "注意：数据库迁移已经执行且不会回退，排查时先确认这次迁移对旧代码是否安全。"
      exit 1
    fi
    echo "!! 退回 $PREV_VERSION 后仍不健康，需要人工介入（很可能是数据库或 Redis 的问题）。"
  else
    echo "没有可回退的历史版本（这是首次部署，或旧镜像已被清理）。"
  fi
  dc ps
  exit 1
fi

log_history deploy "$NEW_VERSION" "上一版=${PREV_VERSION:-无}"

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
  printf '%s\n%s\n' "$current" "$line" | sed '/^$/d' | crontab - && \
    echo "  已写入：$desc"
}

echo "==> 检查定时任务..."
if command -v crontab >/dev/null 2>&1; then
  ensure_cron \
    "$DEPLOY_DIR/backup-on-server.sh" \
    "30 4 * * * bash $DEPLOY_DIR/backup-on-server.sh >> $DEPLOY_DIR/backup.log 2>&1" \
    "每日 04:30 备份"
  if [ -f "$DEPLOY_DIR/health-alert.mjs" ]; then
    ensure_cron \
      "$DEPLOY_DIR/health-alert.mjs" \
      "*/5 * * * * node $DEPLOY_DIR/health-alert.mjs >> $DEPLOY_DIR/health-alert.log 2>&1" \
      "每 5 分钟探活"
  else
    echo "  !! 缺少 health-alert.mjs，服务挂了不会有人收到通知"
    echo "     scp scripts/health-alert.mjs root@<服务器>:$DEPLOY_DIR/ 后重新部署"
  fi
else
  echo "  !! 系统没有 crontab，请手工在宝塔计划任务里加："
  echo "     每日 04:30  bash $DEPLOY_DIR/backup-on-server.sh"
  echo "     每 5 分钟   node $DEPLOY_DIR/health-alert.mjs"
fi

# 异地副本没配就一直喊。备份和库在同一块盘上，硬盘坏了等于没备过。
if [ ! -f "$DEPLOY_DIR/backup.env" ] || ! grep -q '^BACKUP_OFFSITE_CMD=' "$DEPLOY_DIR/backup.env" 2>/dev/null; then
  echo ""
  echo "  !! 未配置异地备份（backup.env 里的 BACKUP_OFFSITE_CMD）"
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
}
echo "==> 清理旧镜像（保留最近 $KEEP_VERSIONS 套）..."
prune_old_images gamebox-server
prune_old_images gamebox-web
# tar 包本身不留：镜像已经在 Docker 里了，留着纯占地方
find "$DEPLOY_DIR" -maxdepth 1 -name 'gamebox-images*.tar.gz' -delete

echo "==> 状态："
dc ps
echo ""
echo "可回滚到的版本："
docker images gamebox-server --format '  {{.Tag}}' | grep -vx '  latest' | sort -r

echo ""
echo "完成。当前版本 $NEW_VERSION，访问：${PUBLIC_BASE_URL}"
echo "出问题回滚：bash $DEPLOY_DIR/rollback-on-server.sh"
echo "（生产环境不自动 seed；测试账号请自行创建）"
