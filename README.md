# 游戏盒子平台（仅积分模式 · 学习用途）

多游戏品类 + 多级代理分销平台。Monorepo，全栈 TypeScript。

> ⚠️ 仅供学习，严禁用于任何违法用途。

---

## 快速启动

### 前提条件

在运行本项目前，目标机器需要安装以下软件：

| 软件 | 版本要求 | 说明 |
|---|---|---|
| [Node.js](https://nodejs.org) | ≥ 20 | 当前开发环境：v22 |
| [pnpm](https://pnpm.io) | ≥ 9 | `npm install -g pnpm@9` |
| [Docker Desktop](https://www.docker.com/products/docker-desktop) | 任意最新版 | 用于一键启动 PostgreSQL + Redis，无需手动装数据库 |
| [Git](https://git-scm.com) | 任意 | 拉取代码 |

---

### 第一步：克隆代码

```bash
git clone https://github.com/ZhongQiMing/gamebox-platform.git
cd gamebox-platform
```

---

### 第二步：安装依赖

```bash
pnpm install
```

> 此命令会同时安装 `server`、`client-app`、`admin-panel` 三个子包的依赖。

---

### 第三步：启动数据库

```bash
docker compose up -d
```

这会在后台启动两个容器：

| 容器 | 服务 | 端口 |
|---|---|---|
| `gamebox-postgres` | PostgreSQL 15 | 5432 |
| `gamebox-redis` | Redis 7 | 6379 |

数据持久化在 Docker named volume 里，`docker compose down` 不会丢失数据。

---

### 第四步：配置后端环境变量

```bash
# Windows
copy server\.env.example server\.env

# macOS / Linux
cp server/.env.example server/.env
```

默认 `.env` 已配置好本地 Docker 的连接地址，**无需修改**即可直接运行。

如需自定义，编辑 `server/.env` 中的以下字段：

```ini
DATABASE_URL="postgresql://gamebox:gamebox_dev_2026@localhost:5432/gamebox?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET=请替换为随机长字符串（生产环境必改）
```

---

### 第五步：初始化数据库

```bash
# 建表（执行 Prisma migrations）
pnpm db:migrate

# 写入初始数据（管理员账号、游戏配置等）
pnpm db:seed
```

---

### 第六步：启动后端

```bash
# 构建
pnpm build:server

# 运行
node server/dist/main.js
```

或使用**开发模式**（文件变更自动重启）：

```bash
pnpm dev:server
```

后端启动后监听 `http://localhost:3000`。

---

### 第七步：启动前端

新开一个终端窗口：

```bash
pnpm dev:app
```

前端 Vite 开发服务器启动后访问 `http://localhost:5173`。

---

### 默认账号

`db:seed` 执行后自动创建以下账号，密码均为 `Test123456`：

| 账号 | 角色 |
|---|---|
| `admin` | 超级管理员 |
| `testplayer01` | 普通玩家 |

---

### 常用命令速查

```bash
# 启动数据库
docker compose up -d

# 停止数据库（数据保留）
docker compose down

# 安装依赖
pnpm install

# 数据库建表
pnpm db:migrate

# 写入初始数据
pnpm db:seed

# 开发模式：后端
pnpm dev:server

# 开发模式：前端
pnpm dev:app

# 生产构建：后端
pnpm build:server

# 生产构建：前端
pnpm build:app
```

---

### 常见问题

**数据库连接失败**
检查 Docker 是否正在运行：`docker ps`，确认 `gamebox-postgres` 在列表里。

**端口 5432 / 6379 已被占用**
修改 `docker-compose.yml` 里对应的 `ports` 映射，同步修改 `server/.env` 里的连接地址。

**pnpm 命令找不到**
执行 `npm install -g pnpm@9` 后重新打开终端。

**Windows 下 `copy` 命令乱码**
用记事本或 VS Code 手动复制 `server/.env.example` 为 `server/.env`。

---

## 项目结构

| 目录 | 角色 | 技术栈 |
|---|---|---|
| `server/` | 后端 API + WebSocket + 定时开奖 | NestJS · Prisma · PostgreSQL · Redis · Socket.IO · BullMQ |
| `client-app/` | 玩家端移动 Web App | Vue 3 · Pinia · Vue Router · Vite |
| `admin-panel/` | 管理后台 | Vue 3 · Element Plus · ECharts |
| `packages/shared/` | 多端共享类型/枚举 | TypeScript |

## 核心原则

**前端只负责展示和操作；凡涉及积分、爆率、开奖结果、分润、风控的逻辑，全部在 `server` 裁决。**

## 技术文档

见 [`docs/`](./docs) 目录：

1. `00-最优架构方案.md` — 总体技术架构
2. `01-落地方案.md` — 目录/部署/开发顺序
3. `02-开发规范.md` — 命名/Git/代码/API/安全红线
4. `03-数据库设计.md` — 表设计说明
5. `04-开工前准备清单.md` — 环境/账号/初始化
6. `05-工程实施清单.md` — 分阶段实施清单
