#!/bin/bash
# 回滚到服务器上留存的历史版本。
#
# 用法：
#   bash /opt/gamebox-platform/rollback-on-server.sh            列出可回滚的版本
#   bash /opt/gamebox-platform/rollback-on-server.sh <版本号>    切到该版本
#   bash /opt/gamebox-platform/rollback-on-server.sh <版本号> -y 跳过确认
#
# 回滚只换代码，不动数据库。Prisma 的迁移是单向的，没有「退回上一版表结构」
# 这种命令，所以脚本会先把「那个版本部署之后又跑了哪些迁移」列出来让你确认：
#   可以安全回滚 —— 加可空字段、加新表、加索引（旧代码看不见，不影响）
#   不能直接回滚 —— 加必填字段、删字段、改字段类型、加唯一约束
#                   （旧代码不知道要填新字段，一写就报错，回滚会变成第二次事故）
# 后者要么先手工把表结构改回去，要么就别回滚，直接往前修。
set -euo pipefail

DEPLOY_DIR=/opt/gamebox-platform
COMPOSE_FILE=docker-compose.prod.images.yml
HISTORY_FILE=deploy-history.log

cd "$DEPLOY_DIR"

dc() { docker compose -f "$COMPOSE_FILE" --env-file .env.prod "$@"; }

if [ ! -f .env.prod ]; then
  echo "找不到 $DEPLOY_DIR/.env.prod，这台机器上还没部署过。"
  exit 1
fi
CURRENT=$(sed -n 's#^GAMEBOX_VERSION=##p' .env.prod | head -1)

# 只有两个镜像都在的版本才切得过去，缺一个切过去就是半套
available_versions() {
  docker images gamebox-server --format '{{.Tag}}' \
    | grep -vx 'latest' | grep -vx '<none>' | sort -r \
    | while read -r tag; do
        if docker image inspect "gamebox-web:$tag" >/dev/null 2>&1; then
          echo "$tag"
        fi
      done
}

# 某个版本是什么时候部署上去的（取最后一次），用来算之后跑过哪些迁移
deployed_at() {
  [ -f "$HISTORY_FILE" ] || return 1
  awk -F'\t' -v v="$1" '$2 == "deploy" && $3 == v { t = $1 } END { if (t) print t }' \
    "$HISTORY_FILE"
}

TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  echo "当前版本：${CURRENT:-未知}"
  echo ""
  echo "可回滚的版本（新→旧）："
  available_versions | while read -r v; do
    mark='  '
    [ "$v" = "$CURRENT" ] && mark='* '
    when=$(deployed_at "$v" || true)
    printf '%s%s%s\n' "$mark" "$v" "${when:+   部署于 $when}"
  done
  echo ""
  if [ -f "$HISTORY_FILE" ]; then
    echo "最近的发布记录："
    tail -5 "$HISTORY_FILE" | awk -F'\t' '{ printf "  %s  %-14s %s  %s\n", $1, $2, $3, $4 }'
    echo ""
  fi
  echo "回滚：bash $0 <版本号>"
  exit 0
fi

if [ "$TARGET" = "$CURRENT" ]; then
  echo "当前跑的就是 $TARGET，无需回滚。"
  exit 0
fi
if ! available_versions | grep -qx "$TARGET"; then
  echo "服务器上没有版本 $TARGET（或者它只剩一半镜像）。可选："
  available_versions | sed 's/^/  /'
  exit 1
fi

# ── 迁移影响评估 ──────────────────────────────────────────
echo "准备回滚：$CURRENT  →  $TARGET"
echo ""
SINCE=$(deployed_at "$TARGET" || true)
if [ -n "$SINCE" ]; then
  MIGRATIONS=$(dc exec -T postgres psql -U gamebox -d gamebox -tAc \
    "SELECT migration_name FROM _prisma_migrations
      WHERE finished_at > '$SINCE' ORDER BY finished_at" 2>/dev/null || true)
  if [ -n "$MIGRATIONS" ]; then
    echo "自 $TARGET 部署以来，数据库跑过这些迁移（回滚不会撤销它们）："
    printf '%s\n' "$MIGRATIONS" | sed 's/^/  - /'
    echo ""
    echo "先确认这些改动对 $TARGET 的旧代码是安全的（加可空字段/加表/加索引=安全，"
    echo "加必填字段/删字段/改类型=不安全，硬切会写不进数据）。"
  else
    echo "自 $TARGET 部署以来没有新迁移，回滚是干净的。"
  fi
else
  echo "发布记录里查不到 $TARGET 的部署时间，无法自动判断迁移影响。"
  echo "最近执行的 5 个迁移："
  dc exec -T postgres psql -U gamebox -d gamebox -tAc \
    "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5" \
    2>/dev/null | sed 's/^/  - /' || echo "  （查询失败，数据库可能没起来）"
fi
echo ""

if [ "${2:-}" != "-y" ]; then
  if [ ! -t 0 ]; then
    echo "非交互环境，确认无误请加 -y：bash $0 $TARGET -y"
    exit 1
  fi
  read -r -p "确认回滚到 $TARGET？(输入 yes 继续) " answer
  [ "$answer" = yes ] || { echo "已取消。"; exit 1; }
fi

# ── 执行 ──────────────────────────────────────────────────
sed -i "s#^GAMEBOX_VERSION=.*#GAMEBOX_VERSION=$TARGET#" .env.prod
echo "==> 切换到 $TARGET..."
dc up -d

echo "==> 等待服务健康..."
for i in $(seq 1 60); do
  if dc exec -T server node healthcheck.js >/dev/null 2>&1; then
    printf '%s\t%s\t%s\t%s\n' "$(date -Iseconds)" rollback "$TARGET" "回滚自=$CURRENT" \
      >> "$HISTORY_FILE"
    echo "健康检查通过（第 ${i} 次）"
    echo ""
    echo "已回滚到 $TARGET。$CURRENT 的镜像还在服务器上，修好后可以直接切回去。"
    exit 0
  fi
  sleep 2
done

echo ""
echo "!! 回滚到 $TARGET 后健康检查仍未通过，最近 50 行日志："
dc logs --tail 50 server || true
echo ""
echo "旧版本也起不来，问题多半不在应用代码（数据库、Redis、迁移不兼容都有可能）。"
echo "当前 .env.prod 已指向 $TARGET，排查完直接 dc up -d 即可，不用再改。"
exit 1
