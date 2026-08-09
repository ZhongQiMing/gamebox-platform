# 反向代理与 TLS

## 拓扑

```
玩家浏览器 ──https──> 宿主机 Nginx（终止 TLS，443）
                        │ http
                        ▼
                  127.0.0.1:8080  →  web 容器 Nginx（静态资源 + 反代）
                                        │ http
                                        ▼
                                   server:3001（NestJS）
```

容器自己不终止 TLS，证书只在宿主机上管理。`docker-compose.prod*.yml` 把 web 容器发布成
`127.0.0.1:8080:80`，公网无法直连，只有宿主机 Nginx 进得来。

## 宿主机 Nginx 示例

宝塔面板可在「网站 → 设置 → 配置文件」里贴，也可直接放到 `/etc/nginx/conf.d/gamebox.conf`。

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 与后端 12mb body 上限对齐；默认 1m 会把收款码上传提前 413 掉
    client_max_body_size 12m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Socket.IO 走同一 location，需要 Upgrade 头
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 300s;
    }
}
```

`$connection_upgrade` 需要在 `http` 段里定义一次（宝塔默认没有）：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

## TRUST_PROXY 必须填 2

这套拓扑里 server 前面有**两层** Nginx，两层都会往 `X-Forwarded-For` 追加一条。
`TRUST_PROXY` 是 Express 的 `trust proxy` 跳数，填少了会把 `req.ip` 解析成 docker 网关地址
（如 `172.19.0.1`）——后果是所有玩家共用同一个限流桶，且 `isPrivateOrLocalIp()` 判定为内网，
同 IP 多号风控直接失效。

`scripts/deploy-on-server.sh` 生成的 `server/.env.production` 已经写死 `TRUST_PROXY=2`。
若改成裸机单层 Nginx，记得同步改回 1。

## 部署时的必填项

`PUBLIC_BASE_URL` 不再自动猜测，必须显式给对外的 https 域名，否则脚本直接退出：

```bash
PUBLIC_BASE_URL=https://your-domain.com bash /tmp/deploy-on-server.sh
```

## 上线后自检

```bash
# 1. 8080 只应监听在回环地址
ss -lntp | grep 8080          # 期望 127.0.0.1:8080，不是 0.0.0.0:8080

# 2. 公网直连 8080 应当失败
curl -m 5 http://<公网IP>:8080/    # 期望超时或拒绝

# 3. 域名走 https 正常，http 会 301
curl -sI https://your-domain.com/api/health
curl -sI http://your-domain.com/ | head -n 1

# 4. 后端拿到的是真实客户端 IP，不是 172.x 网关
docker compose -f docker-compose.prod.images.yml logs server | grep -i ip
```
