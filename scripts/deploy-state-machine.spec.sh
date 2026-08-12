#!/usr/bin/env bash
# deploy-on-server.sh 的纯文件系统/命令桩状态机回归；不连接真实 Docker、不操作生产卷。
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEPLOY_SCRIPT="$REPO_ROOT/scripts/deploy-on-server.sh"
VERIFY_SCRIPT="$REPO_ROOT/scripts/verify-runtime-security.sh"
COMPOSE_SOURCE="$REPO_ROOT/docker-compose.prod.images.yml"
NEW_VERSION=20260812-120000-abcdef0
OLD_VERSION=20260811-110000-1234567
NEW_PLAYER=https://new-player.example.com
NEW_ADMIN=https://new-admin.example.com
NEW_GAME=https://new-game.example.com
OLD_PLAYER=https://old-player.example.com
OLD_ADMIN=https://old-admin.example.com
OLD_GAME=https://old-game.example.com
SERVER_ID="sha256:$(printf 'b%.0s' {1..64})"
WEB_ID="sha256:$(printf 'c%.0s' {1..64})"

fail() { echo "[state-test] 失败：$*" >&2; exit 1; }
assert_file_contains() {
  grep -qF "$2" "$1" || fail "$1 不含 $2"
}
assert_before() {
  local first second
  first=$(grep -nF "$1" "$3" | head -1 | cut -d: -f1)
  second=$(grep -nF "$2" "$3" | head -1 | cut -d: -f1)
  [ -n "$first" ] && [ -n "$second" ] && [ "$first" -lt "$second" ] \
    || fail "$1 没有先于 $2"
}

make_stubs() {
  local root=$1
  mkdir -p "$root/bin"
  cat > "$root/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "docker:$*" >> "$TEST_EVENTS"
case "${1:-}" in
  load)
    echo "Loaded image: gamebox-server:$NEW_VERSION"
    echo "Loaded image: gamebox-web:$NEW_VERSION"
    ;;
  pull|exec|rmi) exit 0 ;;
  images)
    printf '%s\n' "$NEW_VERSION" "${OLD_VERSION:-}"
    ;;
  inspect)
    joined="$*"
    target="${@: -1}"
    if [[ "$joined" == *'.Config.User'* ]]; then
      [[ "$target" == cid-server ]] && echo 1000:1000 || echo 101:101
    elif [[ "$joined" == *'ReadonlyRootfs'* ]]; then
      echo true
    elif [[ "$joined" == *'CapDrop'* ]]; then
      echo '["ALL"]'
    elif [[ "$joined" == *'SecurityOpt'* ]]; then
      echo '["no-new-privileges:true"]'
    elif [[ "$joined" == *'NetworkSettings.Ports'* ]]; then
      echo 127.0.0.1
    else
      echo healthy
    fi
    ;;
  image)
    image="${@: -1}"
    joined="$*"
    if [[ "$joined" == *'{{.Id}}'* ]]; then
      [[ "$image" == gamebox-server:* ]] && echo "$SERVER_ID" || echo "$WEB_ID"
    elif [[ "$joined" == *'player-origin'* ]]; then
      [[ "$image" == *":$OLD_VERSION" ]] && echo "$OLD_PLAYER" || echo "$NEW_PLAYER"
    elif [[ "$joined" == *'game-origin'* ]]; then
      [[ "$image" == *":$OLD_VERSION" ]] && echo "$OLD_GAME" || echo "$NEW_GAME"
    fi
    ;;
  compose)
    if [ "${2:-}" = version ]; then exit 0; fi
    shift
    env_file=""
    compose_file=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --project-directory) shift 2 ;;
        -f) compose_file=$2; shift 2 ;;
        --env-file) env_file=$2; shift 2 ;;
        *) break ;;
      esac
    done
    command=${1:-}
    shift || true
    version=$(sed -n 's/^GAMEBOX_VERSION=//p' "$env_file" | head -1)
    echo "compose:$command:version=$version:shell=${GAMEBOX_VERSION-<unset>}" >> "$TEST_EVENTS"
    case "$command" in
      config)
        runtime_env=$(awk '/^[[:space:]]*env_file:/ { getline; print $2; exit }' "$compose_file")
        [ -f "$runtime_env" ]
        ;;
      ps)
        if [ "${1:-}" = -q ]; then
          [ "${2:-}" = server ] && echo cid-server || echo cid-web
        else
          echo "mock services healthy"
        fi
        ;;
      up|stop|run|exec|logs|start) exit 0 ;;
      *) exit 0 ;;
    esac
    ;;
  *) exit 0 ;;
esac
EOF
  chmod +x "$root/bin/docker"

  cat > "$root/bin/nginx" <<'EOF'
#!/usr/bin/env bash
cat <<'DUMP'
limit_req_zone $binary_remote_addr zone=gamebox_api_ip:10m rate=10r/s;
limit_req zone=gamebox_api_ip;
DUMP
EOF
  chmod +x "$root/bin/nginx"

  cat > "$root/bin/openssl" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = rand ]; then
  [ "${2:-}" = -hex ] && printf 'a%.0s' $(seq 1 "$(( ${3:-16} * 2 ))")
  printf '\n'
  exit 0
fi
exit 0
EOF
  chmod +x "$root/bin/openssl"

  cat > "$root/bin/trivy" <<'EOF'
#!/usr/bin/env bash
echo "trivy:$*" >> "$TEST_EVENTS"
[ "${1:-}" = --version ] && echo 'Version: 0.73.0'
exit 0
EOF
  chmod +x "$root/bin/trivy"

  cat > "$root/bin/crontab" <<'EOF'
#!/usr/bin/env bash
if [ "${CRON_FAIL:-0}" = 1 ] && [ "${1:-}" != -l ]; then exit 1; fi
[ "${1:-}" = -l ] && [ -f "$TEST_ROOT/crontab" ] && cat "$TEST_ROOT/crontab"
if [ "${1:-}" != -l ]; then cat > "$TEST_ROOT/crontab"; fi
EOF
  chmod +x "$root/bin/crontab"
}

make_uploads() {
  local root=$1 dirty=${2:-0} reason=${3:-}
  mkdir -p "$root/upload"
  cp "$COMPOSE_SOURCE" "$root/upload/docker-compose.prod.images.yml"
  printf 'mock image archive\n' > "$root/upload/gamebox-images-$NEW_VERSION.tar.gz"
  archive_hash=$(sha256sum "$root/upload/gamebox-images-$NEW_VERSION.tar.gz" | awk '{print $1}')
  compose_hash=$(sha256sum "$root/upload/docker-compose.prod.images.yml" | awk '{print $1}')
  cat > "$root/upload/gamebox-images-$NEW_VERSION.manifest" <<EOF
manifest_version=1
version=$NEW_VERSION
git_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
dirty=$dirty
dirty_reason=$reason
archive_sha256=$archive_hash
server_image_id=$SERVER_ID
web_image_id=$WEB_ID
compose_sha256=$compose_hash
EOF
  cat > "$root/upload/verify-runtime-security.sh" <<'EOF'
#!/usr/bin/env bash
echo "security:$*" >> "$TEST_EVENTS"
[ "${1:-}" != --check-runtime ] || [ "${FAIL_RUNTIME:-0}" != 1 ]
EOF
  cat > "$root/upload/check-tls-on-server.sh" <<'EOF'
#!/usr/bin/env bash
echo "tls:$PUBLIC_BASE_URL:$ADMIN_BASE_URL:$GAME_BASE_URL" >> "$TEST_EVENTS"
[ "${FAIL_TLS:-0}" != 1 ]
EOF
  printf 'new backup script\n' > "$root/upload/backup-on-server.sh"
  chmod +x "$root/upload/"*.sh
}

make_existing() {
  local root=$1
  mkdir -p "$root/deploy/server"
  cp "$COMPOSE_SOURCE" "$root/deploy/docker-compose.prod.images.yml"
  cat > "$root/deploy/.env.prod" <<EOF
DB_PASSWORD=old-db
REDIS_PASSWORD=old-redis
JWT_SECRET=old-jwt
RECON_HEALTH_TOKEN=old-recon
GAMEBOX_VERSION=$OLD_VERSION
PUBLIC_BASE_URL=$OLD_PLAYER
ADMIN_BASE_URL=$OLD_ADMIN
GAME_BASE_URL=$OLD_GAME
EOF
  echo 'NODE_ENV=production' > "$root/deploy/server/.env.production"
  echo 'old backup script' > "$root/deploy/backup-on-server.sh"
}

run_deploy() {
  local root=$1
  shift
  TEST_ROOT="$root" TEST_EVENTS="$root/events" \
  PATH="$root/bin:$PATH" DEPLOY_DIR="$root/deploy" UPLOAD_DIR="$root/upload" \
  NEW_VERSION="$NEW_VERSION" OLD_VERSION="$OLD_VERSION" SERVER_ID="$SERVER_ID" WEB_ID="$WEB_ID" \
  NEW_PLAYER="$NEW_PLAYER" NEW_GAME="$NEW_GAME" OLD_PLAYER="$OLD_PLAYER" OLD_GAME="$OLD_GAME" \
  HOST_API_LIMIT_READY=1 "$@" bash "$DEPLOY_SCRIPT" >"$root/output" 2>&1
}

case_first_install() {
  local root
  root=$(mktemp -d)
  make_stubs "$root"
  make_uploads "$root"
  if ! run_deploy "$root" env PUBLIC_BASE_URL="$NEW_PLAYER" ADMIN_BASE_URL="$NEW_ADMIN" GAME_BASE_URL="$NEW_GAME"; then
    cat "$root/output" >&2
    fail "首次部署执行失败"
  fi
  assert_file_contains "$root/deploy/.env.prod" "GAMEBOX_VERSION=$NEW_VERSION"
  [ -f "$root/deploy/server/.env.production" ] || fail "首装未落位 server env"
  ! grep -q 'latest' "$root/events" || fail "首装使用了 latest"
  assert_file_contains "$root/events" "compose:config:version=$NEW_VERSION:shell=<unset>"
  assert_before "security:--scan-images" "compose:stop" "$root/events"
  echo "[state-test] ok 首次部署"
  rm -rf "$root"
}

case_upgrade_explicit_origin() {
  local root
  root=$(mktemp -d)
  make_stubs "$root"
  make_uploads "$root"
  make_existing "$root"
  if ! run_deploy "$root" env PUBLIC_BASE_URL="$NEW_PLAYER" ADMIN_BASE_URL="$NEW_ADMIN" GAME_BASE_URL="$NEW_GAME"; then
    cat "$root/output" >&2
    fail "升级部署执行失败"
  fi
  assert_file_contains "$root/deploy/.env.prod" "PUBLIC_BASE_URL=$NEW_PLAYER"
  assert_file_contains "$root/deploy/.env.prod" "ADMIN_BASE_URL=$NEW_ADMIN"
  assert_file_contains "$root/deploy/.env.prod" "GAME_BASE_URL=$NEW_GAME"
  assert_file_contains "$root/events" "tls:$NEW_PLAYER:$NEW_ADMIN:$NEW_GAME"
  rm -rf "$root"

  root=$(mktemp -d)
  make_stubs "$root"
  make_uploads "$root"
  make_existing "$root"
  sed -i "s#$OLD_PLAYER#$NEW_PLAYER#; s#$OLD_ADMIN#$NEW_ADMIN#; s#$OLD_GAME#$NEW_GAME#" \
    "$root/deploy/.env.prod"
  if ! run_deploy "$root" env; then
    cat "$root/output" >&2
    fail "升级复用已有 Origin 执行失败"
  fi
  assert_file_contains "$root/deploy/.env.prod" "PUBLIC_BASE_URL=$NEW_PLAYER"
  assert_file_contains "$root/events" "tls:$NEW_PLAYER:$NEW_ADMIN:$NEW_GAME"
  echo "[state-test] ok 升级显式/复用 Origin"
  rm -rf "$root"
}

case_preflight_failure() {
  local root before_compose before_script
  root=$(mktemp -d)
  make_stubs "$root"
  make_uploads "$root" 2 invalid
  make_existing "$root"
  before_compose=$(sha256sum "$root/deploy/docker-compose.prod.images.yml")
  before_script=$(sha256sum "$root/deploy/backup-on-server.sh")
  if run_deploy "$root" env PUBLIC_BASE_URL="$NEW_PLAYER" ADMIN_BASE_URL="$NEW_ADMIN" GAME_BASE_URL="$NEW_GAME"; then
    fail "非法 manifest 预检未失败"
  fi
  [ "$before_compose" = "$(sha256sum "$root/deploy/docker-compose.prod.images.yml")" ] \
    || fail "预检失败污染 Compose"
  [ "$before_script" = "$(sha256sum "$root/deploy/backup-on-server.sh")" ] \
    || fail "预检失败污染运维脚本"
  assert_file_contains "$root/deploy/.env.prod" "GAMEBOX_VERSION=$OLD_VERSION"
  echo "[state-test] ok 预切换失败"
  rm -rf "$root"
}

case_cutover_failure() {
  local root
  root=$(mktemp -d)
  make_stubs "$root"
  make_uploads "$root"
  make_existing "$root"
  if FAIL_RUNTIME=1 run_deploy "$root" env PUBLIC_BASE_URL="$NEW_PLAYER" ADMIN_BASE_URL="$NEW_ADMIN" GAME_BASE_URL="$NEW_GAME"; then
    fail "运行时验收失败未触发回滚"
  fi
  assert_file_contains "$root/deploy/.env.prod" "GAMEBOX_VERSION=$OLD_VERSION"
  assert_file_contains "$root/events" "compose:up:version=$OLD_VERSION:shell=<unset>"
  assert_file_contains "$root/deploy/backup-on-server.sh" "old backup script"
  echo "[state-test] ok 切换失败回滚"
  rm -rf "$root"
}

case_late_warning() {
  local root
  root=$(mktemp -d)
  make_stubs "$root"
  make_uploads "$root"
  make_existing "$root"
  if ! CRON_FAIL=1 run_deploy "$root" env PUBLIC_BASE_URL="$NEW_PLAYER" ADMIN_BASE_URL="$NEW_ADMIN" GAME_BASE_URL="$NEW_GAME"; then
    cat "$root/output" >&2
    fail "成功后收尾路径执行失败"
  fi
  assert_file_contains "$root/deploy/.env.prod" "GAMEBOX_VERSION=$NEW_VERSION"
  assert_file_contains "$root/deploy/deploy-history.log" "crontab 写入"
  assert_file_contains "$root/deploy/backup-on-server.sh" "new backup script"
  echo "[state-test] ok 成功后收尾告警"
  rm -rf "$root"
}

case_security_modes() {
  local root
  root=$(mktemp -d)
  make_stubs "$root"
  mkdir -p "$root/deploy/server"
  cp "$COMPOSE_SOURCE" "$root/deploy/docker-compose.prod.images.yml"
  cat > "$root/deploy/.env.prod" <<EOF
GAMEBOX_VERSION=$NEW_VERSION
DB_PASSWORD=test
EOF
  echo 'NODE_ENV=production' > "$root/deploy/server/.env.production"
  TEST_ROOT="$root" TEST_EVENTS="$root/events" PATH="$root/bin:$PATH" \
    DEPLOY_DIR="$root/deploy" bash "$VERIFY_SCRIPT" --check-prerequisites
  TEST_ROOT="$root" TEST_EVENTS="$root/events" PATH="$root/bin:$PATH" \
    DEPLOY_DIR="$root/deploy" bash "$VERIFY_SCRIPT" --scan-images "$NEW_VERSION"
  TEST_ROOT="$root" TEST_EVENTS="$root/events" PATH="$root/bin:$PATH" \
    DEPLOY_DIR="$root/deploy" bash "$VERIFY_SCRIPT" --check-runtime
  assert_file_contains "$root/events" "trivy:image --severity HIGH,CRITICAL --exit-code 1 gamebox-server:$NEW_VERSION"
  assert_file_contains "$root/events" "compose:config:version=$NEW_VERSION:shell=<unset>"
  echo "[state-test] ok 安全验收拆分模式"
  rm -rf "$root"
}

case_first_install
case_upgrade_explicit_origin
case_preflight_failure
case_cutover_failure
case_late_warning
case_security_modes
echo "[state-test] 五条发布路径全部通过"
