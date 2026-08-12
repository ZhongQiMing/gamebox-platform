#!/usr/bin/env bash
# 构建/部署验收：扫描最终镜像，并确认线上容器以只读、非 root、最小权限运行。
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/gamebox-platform}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.images.yml}"
ENV_FILE="${ENV_FILE:-.env.prod}"
cd "$DEPLOY_DIR"

MODE="${1:---all}"
VERSION_ARG="${2:-}"
case "$MODE" in
  --all|--check-prerequisites|--check-runtime) [ "$#" -le 1 ] ;;
  --scan-images) [ "$#" -eq 2 ] ;;
  *) false ;;
esac || {
  echo "用法：$0 [--check-prerequisites | --scan-images <版本> | --check-runtime]" >&2
  exit 2
}

TOOLS=(docker)
if [ "$MODE" = "--all" ] || [ "$MODE" = "--check-prerequisites" ] || [ "$MODE" = "--scan-images" ]; then
  TOOLS+=(trivy tr)
fi
for tool in "${TOOLS[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[runtime-security] 缺少必需工具：$tool" >&2
    exit 2
  fi
done
if command -v trivy >/dev/null 2>&1 \
  && [[ "$(trivy --version | tr '\n' ' ')" != *'0.73.0'* ]]; then
  echo '[runtime-security] Trivy 版本必须是 0.73.0' >&2
  exit 2
fi
docker compose version >/dev/null 2>&1 || {
  echo '[runtime-security] docker compose 插件不可用' >&2
  exit 2
}
if [ "$MODE" = "--check-prerequisites" ]; then
  echo '[runtime-security] Docker/Compose/Trivy 依赖可用'
  exit 0
fi

scan_images() {
  local version=$1
  [[ "$version" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}(-dirty-emergency)?$ ]] || {
    echo "[runtime-security] 非法镜像版本：$version" >&2
    exit 2
  }
  for image in "gamebox-server:$version" "gamebox-web:$version"; do
    echo "[runtime-security] Trivy $image"
    trivy image --severity HIGH,CRITICAL --exit-code 1 "$image"
  done
}

if [ "$MODE" = "--scan-images" ]; then
  scan_images "$VERSION_ARG"
  echo '[runtime-security] 镜像漏洞扫描通过'
  exit 0
fi

[ -r "$COMPOSE_FILE" ] || {
  echo "[runtime-security] Compose 文件不可读：$COMPOSE_FILE" >&2
  exit 2
}
[ -r "$ENV_FILE" ] || {
  echo "[runtime-security] 环境文件不可读：$ENV_FILE" >&2
  exit 2
}
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${GAMEBOX_VERSION:?GAMEBOX_VERSION 缺失}"
dc() {
  env -u GAMEBOX_VERSION docker compose --project-directory "$DEPLOY_DIR" \
    -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}
dc config --quiet
if [ "$MODE" = "--all" ]; then
  scan_images "$GAMEBOX_VERSION"
fi

assert_hardened() {
  local service=$1 expected_user=$2
  local cid
  cid=$(dc ps -q "$service")
  [ -n "$cid" ] || { echo "$service 未运行" >&2; exit 1; }

  local user readonly_rootfs cap_drop security_opt
  user=$(docker inspect -f '{{.Config.User}}' "$cid")
  readonly_rootfs=$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$cid")
  cap_drop=$(docker inspect -f '{{json .HostConfig.CapDrop}}' "$cid")
  security_opt=$(docker inspect -f '{{json .HostConfig.SecurityOpt}}' "$cid")

  [ "$user" = "$expected_user" ] || {
    echo "$service 用户错误：$user（期望 $expected_user）" >&2
    exit 1
  }
  [ "$readonly_rootfs" = true ] || { echo "$service 根文件系统不是只读" >&2; exit 1; }
  [[ "$cap_drop" == *'"ALL"'* ]] || { echo "$service 未 cap_drop ALL" >&2; exit 1; }
  [[ "$security_opt" == *'no-new-privileges:true'* ]] || {
    echo "$service 未启用 no-new-privileges" >&2
    exit 1
  }
}

assert_hardened server 1000:1000
assert_hardened web 101:101

# 根文件系统写入必须失败；业务卷与 tmpfs 必须可写。
dc exec -T server sh -ec \
  '! touch /repo/server/.rootfs-write-test; touch uploads/.volume-write-test; rm uploads/.volume-write-test; touch /tmp/.tmp-write-test'
dc exec -T web sh -ec \
  '! touch /usr/share/nginx/html/.rootfs-write-test; touch /tmp/.tmp-write-test'

# web 只在 frontend 网络，不能直接解析/连接数据库。
dc exec -T web sh -ec \
  '! nc -z -w 2 postgres 5432 >/dev/null 2>&1'

for port in 8080 8081 8082; do
  binding=$(docker inspect -f "{{(index (index .NetworkSettings.Ports \"${port}/tcp\") 0).HostIp}}" "$(dc ps -q web)")
  [ "$binding" = 127.0.0.1 ] || {
    echo "web $port 暴露到 $binding，不是回环地址" >&2
    exit 1
  }
done

dc exec -T server node healthcheck.js >/dev/null
echo '[runtime-security] 运行时容器加固验收通过'
