#!/usr/bin/env bash
# 三个生产 Origin 的边缘与映射验收：HTTP 跳转、TLS 主机名/有效期、HTTPS/HSTS，
# 以及每个域名返回的内容是否确实来自约定的本机端口。
set -uo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/gamebox-platform}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-${1:-}}"
ADMIN_BASE_URL="${ADMIN_BASE_URL:-}"
GAME_BASE_URL="${GAME_BASE_URL:-}"

if [ -f "$DEPLOY_DIR/.env.prod" ]; then
  [ -n "$PUBLIC_BASE_URL" ] || PUBLIC_BASE_URL=$(sed -n 's/^PUBLIC_BASE_URL=//p' "$DEPLOY_DIR/.env.prod" | head -1)
  [ -n "$ADMIN_BASE_URL" ] || ADMIN_BASE_URL=$(sed -n 's/^ADMIN_BASE_URL=//p' "$DEPLOY_DIR/.env.prod" | head -1)
  [ -n "$GAME_BASE_URL" ] || GAME_BASE_URL=$(sed -n 's/^GAME_BASE_URL=//p' "$DEPLOY_DIR/.env.prod" | head -1)
fi

FAILED=0
WARNED=0
ok()   { echo "[TLS] ok   $*"; }
warn() { echo "[TLS] 注意 $*"; WARNED=$((WARNED + 1)); }
bad()  { echo "[TLS] 失败 $*"; FAILED=$((FAILED + 1)); }

for tool in curl openssl sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || bad "缺少必需工具：$tool"
done
if [ "$FAILED" -gt 0 ]; then
  echo "[TLS] 结果：失败 $FAILED，注意 $WARNED"
  exit 1
fi

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

check_origin() {
  local label=$1 origin=$2 port=$3 path=$4 host
  local headers body local_body status hsts max_age redir code target cert end

  if [[ ! "$origin" =~ ^https://[A-Za-z0-9.-]+$ ]]; then
    bad "$label Origin 必须是无路径、无自定义端口的 HTTPS 域名：${origin:-<空>}"
    return
  fi
  host=${origin#https://}
  echo "[TLS] 自检 $label $origin → 127.0.0.1:$port"

  headers="$WORK_DIR/${port}.headers"
  body="$WORK_DIR/${port}.edge"
  local_body="$WORK_DIR/${port}.local"
  : > "$headers"
  if status=$(curl -sS --max-time 15 -D "$headers" -o "$body" -w '%{http_code}' \
    "${origin}${path}" 2>"$WORK_DIR/${port}.curl.err"); then
    :
  else
    bad "$label HTTPS 请求失败：$(tr '\n' ' ' < "$WORK_DIR/${port}.curl.err")"
    status=""
  fi
  if [ -n "$status" ] && [ "$status" != 200 ]; then
    bad "$label HTTPS 返回 $status（期望 200）"
  elif [ "$status" = 200 ]; then
    ok "$label HTTPS 200，证书链与主机名通过 curl 校验"
  fi

  hsts=$(grep -i '^strict-transport-security:' "$headers" | tail -1 || true)
  if [ -z "$hsts" ]; then
    bad "$label 缺少 Strict-Transport-Security"
  else
    max_age=$(printf '%s' "$hsts" | grep -oi 'max-age=[0-9]\+' | head -1 | cut -d= -f2)
    max_age=${max_age:-0}
    if [ "$max_age" -ge 15552000 ]; then
      ok "$label HSTS max-age=$max_age"
    else
      warn "$label HSTS max-age=$max_age 偏小，建议 31536000"
    fi
  fi

  redir=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' \
    "http://${host}${path}" 2>/dev/null)
  if [ -z "$redir" ]; then
    bad "$label HTTP 80 无法验证到对应 HTTPS 的跳转"
  else
    code=${redir%% *}
    target=${redir#* }
    if [[ "$code" =~ ^(301|308)$ ]] && [[ "$target" == "${origin}${path}"* ]]; then
      ok "$label HTTP $code → 对应 HTTPS Origin"
    else
      bad "$label HTTP 跳转错误：${code:-空} ${target:-<空>}（期望 ${origin}${path}）"
    fi
  fi

  cert="$WORK_DIR/${port}.pem"
  if openssl s_client -servername "$host" -connect "$host:443" </dev/null 2>/dev/null \
    | openssl x509 -outform PEM > "$cert" 2>/dev/null \
    && [ -s "$cert" ]; then
    if openssl x509 -in "$cert" -noout -checkhost "$host" >/dev/null 2>&1; then
      ok "$label 证书 SAN/主机名匹配 $host"
    else
      bad "$label 证书 SAN/主机名不匹配 $host"
    fi
    end=$(openssl x509 -in "$cert" -noout -enddate | cut -d= -f2)
    if ! openssl x509 -in "$cert" -noout -checkend 604800 >/dev/null 2>&1; then
      bad "$label 证书将在 7 天内过期（$end）"
    elif ! openssl x509 -in "$cert" -noout -checkend 1814400 >/dev/null 2>&1; then
      warn "$label 证书将在 21 天内过期（$end）"
    else
      ok "$label 证书有效期超过 21 天（$end）"
    fi
  else
    bad "$label 无法读取 TLS 证书"
  fi

  # 外部域名请求天然携带该 Host，并由 TLS SNI 选择 server_name。与约定端口的
  # 唯一静态内容逐字节比较，可阻止三个域名互换后仅“全局存在 8080/1/2”仍误通过。
  if [ "$status" = 200 ] \
    && curl -fsS --max-time 10 "http://127.0.0.1:${port}${path}" -o "$local_body"; then
    if [ "$(sha256sum "$body" | awk '{print $1}')" = "$(sha256sum "$local_body" | awk '{print $1}')" ]; then
      ok "$label Host+SNI 内容唯一匹配端口 $port"
    else
      bad "$label 外部内容不匹配 127.0.0.1:$port，server_name 可能映射错端口"
    fi
  else
    bad "$label 无法取得本机 $port 的映射基准内容"
  fi
}

check_origin 玩家端 "$PUBLIC_BASE_URL" 8080 /index.html
check_origin 管理端 "$ADMIN_BASE_URL" 8081 /
check_origin 游戏域 "$GAME_BASE_URL" 8082 /games-assets/bjsc/index.html

# 三个后端端口都只能绑定回环，避免绕过 TLS 与宿主机真实 IP 限流。
if command -v ss >/dev/null 2>&1; then
  for port in 8080 8081 8082; do
    exposed=$(ss -lnt 2>/dev/null | awk '{print $4}' | grep ":${port}$" \
      | grep -v '^127\.0\.0\.1:' | grep -v '^\[::1\]:' || true)
    if [ -z "$exposed" ]; then
      ok "$port 未对外监听"
    else
      bad "$port 监听在 $(printf '%s' "$exposed" | tr '\n' ' ')，可绕过 TLS"
    fi
  done
fi

# API 来源限流必须在看到真实 remote_addr 的宿主机 Nginx。
NGINX_BIN=""
for candidate in nginx /usr/sbin/nginx /www/server/nginx/sbin/nginx; do
  if command -v "$candidate" >/dev/null 2>&1; then
    NGINX_BIN=$(command -v "$candidate")
    break
  fi
done
if [ -n "$NGINX_BIN" ]; then
  if ! NGINX_DUMP=$("$NGINX_BIN" -T 2>&1); then
    bad "宿主机 nginx -T 失败"
  elif grep -Eq 'limit_req_zone[[:space:]]+\$binary_remote_addr[[:space:]]+zone=gamebox_api_ip:' <<<"$NGINX_DUMP" \
    && grep -Eq 'limit_req[[:space:]]+zone=gamebox_api_ip([[:space:];]|$)' <<<"$NGINX_DUMP"; then
    ok "宿主机 gamebox_api_ip 来源限流已配置"
  else
    bad "宿主机缺少 gamebox_api_ip 来源限流"
  fi
else
  bad "找不到宿主机 nginx，无法核验来源限流"
fi

echo "[TLS] 结果：失败 $FAILED，注意 $WARNED"
[ "$FAILED" -eq 0 ]
