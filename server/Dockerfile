# 生产测试镜像：多阶段构建 NestJS 服务
# 构建上下文为仓库根目录（需要访问 packages/shared 与根 lockfile）

ARG NODE_IMAGE=node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
# 本机代理拦 deb.debian.org 时传入 mirrors.aliyun.com 即可；默认仍走官方源。
ARG DEBIAN_MIRROR=deb.debian.org

FROM ${NODE_IMAGE} AS build-base
ARG DEBIAN_MIRROR
RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo

FROM build-base AS builder
COPY . .
RUN pnpm install --frozen-lockfile --filter @gamebox/server...
RUN pnpm --filter @gamebox/shared build
RUN pnpm --filter @gamebox/server exec prisma generate
RUN pnpm --filter @gamebox/server build
# 初始化脚本单独编译：生产镜像没有 ts-node、也不带 src，
# 不编出来的话服务器上就没有任何办法灌入游戏目录/赔率/管理员（迁移只建空表）。
RUN pnpm --filter @gamebox/server build:seed

# 单独安装生产依赖，避免把编译器、Jest、ESLint 等开发工具带进运行镜像。
FROM build-base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY server/package.json ./server/package.json
COPY server/prisma ./server/prisma
RUN pnpm install --frozen-lockfile --prod --filter @gamebox/server... \
    && pnpm --filter @gamebox/server exec prisma generate

FROM ${NODE_IMAGE} AS runner
ARG DEBIAN_MIRROR
RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo

# 只拷运行依赖、构建产物、Prisma 迁移和探针，不携带源码与开发依赖。
COPY --from=prod-deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /repo/server/node_modules ./server/node_modules
COPY --from=builder --chown=node:node /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=node:node /repo/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=node:node /repo/server/package.json ./server/package.json
COPY --from=builder --chown=node:node /repo/server/dist ./server/dist
COPY --from=builder --chown=node:node /repo/server/dist-seed ./server/dist-seed
COPY --from=builder --chown=node:node /repo/server/prisma ./server/prisma
COPY --from=builder --chown=node:node /repo/server/healthcheck.js ./server/healthcheck.js
RUN mkdir -p /repo/server/uploads /repo/server/private-uploads/cs \
    && chown -R node:node /repo

WORKDIR /repo/server
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
