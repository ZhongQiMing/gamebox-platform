# 反向代理与 TLS

## 拓扑

```
app.example.com   ──https──> 宿主机 Nginx ──> 127.0.0.1:8080（玩家）
admin.example.com ──https──> 宿主机 Nginx ──> 127.0.0.1:8081（后台）
games.example.com ──https──> 宿主机 Nginx ──> 127.0.0.1:8082（无 API 的 H5）
                                                   │
                                    玩家/后台 API ──> server:3001
```

容器自己不终止 TLS，证书只在宿主机上管理。`docker-compose.prod*.yml` 把三个端口都只
绑定到 `127.0.0.1`。浏览器层面三者是不同 Origin；游戏域没有 `/api` 反代，因此即使旧
H5 有 XSS，也拿不到玩家 Cookie，更不能直接调用资金接口。

## 宿主机 Nginx 示例

宝塔面板可在「网站 → 设置 → 配置文件」里贴，也可直接放到 `/etc/nginx/conf.d/gamebox.conf`。

```nginx
# http 段：这里看到的 $remote_addr 才是用户真实 IP。
limit_req_zone $binary_remote_addr zone=gamebox_api_ip:10m rate=30r/s;
limit_req_status 429;
map $host $gamebox_upstream {
    app.example.com   http://127.0.0.1:8080;
    admin.example.com http://127.0.0.1:8081;
    games.example.com http://127.0.0.1:8082;
}

server {
    listen 80;
    server_name app.example.com admin.example.com games.example.com;
    return 301 https://$host$request_uri;
}

# 三个域名应使用覆盖全部 SAN 的证书；也可拆成三个同结构 server 块。
server {
    listen 443 ssl http2;
    server_name app.example.com admin.example.com games.example.com;
    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 12m;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # 游戏域没有 API；直接在边缘也封死，容器内还有第二道 404。
    location /api/ {
        if ($host = games.example.com) { return 404; }
        limit_req zone=gamebox_api_ip burst=60 nodelay;
        proxy_pass $gamebox_upstream;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass $gamebox_upstream;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 300s;
    }
}
```

`$connection_upgrade` 与上面的 `limit_req_zone` 都需要在 `http` 段里定义一次
（宝塔默认没有）：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

## API 限流必须在宿主机

正式拓扑中，web 容器收到的 TCP 对端是宿主机或 Docker 网关，不是玩家。若在
`client-app/deploy/nginx.conf` 里用 `$binary_remote_addr`，所有玩家会共用一个
30r/s 桶，一个攻击者即可让全站返回 429。因此容器层只做代理，来源 IP 限流固定放在
最外层宿主机 Nginx。

部署新版 web 镜像前必须先完成上面的宿主机配置，并执行：

```bash
nginx -t && nginx -s reload
nginx -T 2>&1 | grep -E 'gamebox_api_ip|limit_req'
```

`deploy-on-server.sh` 会在导入新镜像前执行同样检查；宿主机 Nginx 不在 PATH 时会拒绝
继续。只有已经人工核实配置、但脚本确实找不到宝塔 Nginx 二进制时，才可对单次命令传
`HOST_API_LIMIT_READY=1`，禁止把这个变量永久写进环境文件。

绝对不要把 `$http_x_forwarded_for` 直接当限流键：它可由客户端伪造。宿主机
`$remote_addr` 是真实 TCP 对端，且宿主机继续用 `$proxy_add_x_forwarded_for`
向后端追加地址，两个用途不要混在一起。

## TRUST_PROXY 必须填 2

这套拓扑里 server 前面有**两层** Nginx，两层都会往 `X-Forwarded-For` 追加一条。
`TRUST_PROXY` 是 Express 的 `trust proxy` 跳数，填少了会把 `req.ip` 解析成 docker 网关地址
（如 `172.19.0.1`）——后果是所有玩家共用同一个限流桶，且 `isPrivateOrLocalIp()` 判定为内网，
同 IP 多号风控直接失效。

`scripts/deploy-on-server.sh` 生成的 `server/.env.production` 已经写死 `TRUST_PROXY=2`。
若改成裸机单层 Nginx，记得同步改回 1。

## 部署时的必填项

三个 Origin 都必须显式传入且互不相同。镜像构建时也会固化玩家域和游戏域；部署脚本会
核对镜像标签，防止把为 A 域构建的 CSP/iframe 包误发到 B 域：

```bash
PLAYER_ORIGIN=https://app.example.com GAME_ORIGIN=https://games.example.com \
  pwsh scripts/build-images.ps1

PUBLIC_BASE_URL=https://app.example.com \
ADMIN_BASE_URL=https://admin.example.com \
GAME_BASE_URL=https://games.example.com \
  bash /tmp/deploy-on-server.sh
```

## 上线后自检

上面这些配置全在宿主机上，部署脚本改不到它们——漏了不会有任何报错，直到有人用
`http://` 访问，登录态和上下分就明文出去了。所以做成了可执行的检查：

```bash
bash /opt/gamebox-platform/check-tls-on-server.sh
```

`deploy-on-server.sh` 每次部署结尾都会自动跑一次。它查这些项目：

| 检查项 | 不通过的后果 |
|---|---|
| HSTS 响应头（max-age ≥ 180 天） | 用户手输域名时仍会先走一次明文，可被跳转前劫持 |
| `http://` 返回 301 到 https | 同上，且 302/307 不会被浏览器长期记住 |
| 证书剩余有效期 | 续期任务坏掉没人知道，直到整站打不开 |
| 玩家、管理、游戏三个 HTTPS Origin | 域名未分离，旧 H5 XSS 可触及带凭证页面 |
| 8080/8081/8082 全部只绑回环 | 公网能绕过 TLS 直连，XFF 也可伪造 |
| 宿主机存在 `gamebox_api_ip` 限流 | 公开轮询接口无边缘保护，或旧容器共享桶导致全站 429 |

不通过时**不会回滚**：站点此刻是好的，判它失败反而会让人误以为要退版本。
脚本退出码非 0，可以单独挂定时任务。

剩下两项还得人工看：

```bash
# 公网直连三个端口都应失败（脚本只能查本机监听，查不到防火墙外的效果）
for p in 8080 8081 8082; do curl -m 5 "http://<公网IP>:$p/"; done

# 后端拿到的是真实客户端 IP，不是 172.x 网关
docker compose -f docker-compose.prod.images.yml logs server | grep -i ip

# 从出口 A 打满后应出现 429；此时从手机 4G/另一 VPS（出口 B）访问仍应 200
for i in $(seq 1 100); do
  curl -s -o /dev/null -w '%{http_code}\n' https://app.example.com/api/health
done
```
