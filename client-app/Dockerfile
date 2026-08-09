# 生产测试镜像：构建 client-app 静态产物（含 games-assets），交给 nginx 托管
# 构建上下文为仓库根目录（需要访问根级 games-assets/ 与 packages/shared）

FROM node:20-slim AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo
COPY . .
# 只用国内源；玩家端与管理后台由同一 nginx 托管，两个包一起装
RUN npm config set registry https://registry.npmmirror.com \
  && pnpm config set registry https://registry.npmmirror.com \
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

FROM nginx:1.27-alpine AS runner
COPY --from=builder /repo/client-app/dist /usr/share/nginx/html
COPY --from=builder /repo/admin-panel/dist /usr/share/nginx/html/admin
COPY client-app/deploy/nginx.conf /etc/nginx/conf.d/default.conf
# 容器只讲 HTTP：TLS 在宿主机 Nginx 终止，反代到 127.0.0.1:8080（见 docs/反向代理与TLS.md）
EXPOSE 80
