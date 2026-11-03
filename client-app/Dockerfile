# 生产测试镜像：构建 client-app 静态产物（含 games-assets），交给 nginx 托管
# 构建上下文为仓库根目录（需要访问根级 games-assets/ 与 packages/shared）

ARG NODE_IMAGE=node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:alpine@sha256:334d92979f15aaecd5dd50af5105e1230e2bb70765d45b1e2f964e7c5eda81c3
ARG PLAYER_ORIGIN
ARG GAME_ORIGIN

FROM ${NODE_IMAGE} AS builder
ARG PLAYER_ORIGIN
ARG GAME_ORIGIN
ENV VITE_GAME_ORIGIN=${GAME_ORIGIN}
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo
COPY . .
RUN node -e "for (const [name, raw] of Object.entries({ PLAYER_ORIGIN: process.env.PLAYER_ORIGIN, GAME_ORIGIN: process.env.GAME_ORIGIN })) { if (!raw) throw new Error(name + ' is required'); const url = new URL(raw); if (url.origin !== raw || url.protocol !== 'https:') throw new Error(name + ' must be an HTTPS origin without path'); }"
# 固定官方 registry；玩家端与管理后台由同一 nginx 托管，两个包一起装。
RUN npm config set registry https://registry.npmjs.org \
  && pnpm config set registry https://registry.npmjs.org \
  && pnpm config set fetch-retries 5 \
  && pnpm config set fetch-retry-mintimeout 20000 \
  && pnpm config set fetch-retry-maxtimeout 120000 \
  && pnpm install --frozen-lockfile --filter @gamebox/client-app... --filter @gamebox/admin-panel...
# 恢复类型检查，再出静态产物
RUN pnpm --filter @gamebox/shared build \
  && pnpm --filter @gamebox/client-app exec vue-tsc -b \
  && pnpm --filter @gamebox/client-app exec vite build \
  && pnpm --filter @gamebox/admin-panel exec vue-tsc -b \
  && pnpm --filter @gamebox/admin-panel exec vite build

FROM ${NGINX_IMAGE} AS runner
ARG PLAYER_ORIGIN
ARG GAME_ORIGIN
USER root
RUN apk update && apk upgrade --no-cache
COPY --from=builder --chown=101:101 /repo/client-app/dist /usr/share/nginx/html
COPY --from=builder --chown=101:101 /repo/admin-panel/dist /usr/share/nginx/html/admin
COPY client-app/deploy/nginx.conf /etc/nginx/conf.d/default.conf
RUN sed -i "s|__PLAYER_ORIGIN__|${PLAYER_ORIGIN}|g; s|__GAME_ORIGIN__|${GAME_ORIGIN}|g" /etc/nginx/conf.d/default.conf \
  && ! grep -q '__[A-Z_]*__' /etc/nginx/conf.d/default.conf
LABEL org.gamebox.player-origin="${PLAYER_ORIGIN}" \
      org.gamebox.game-origin="${GAME_ORIGIN}"
# 容器只讲 HTTP：TLS 在宿主机 Nginx 终止，反代到 127.0.0.1:8080（见 docs/反向代理与TLS.md）
USER 101:101
EXPOSE 8080 8081 8082
