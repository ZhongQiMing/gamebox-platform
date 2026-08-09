/**
 * 容器健康探针：请求本进程的 /api/health，2xx 退出 0，其余退出 1。
 *
 * 用 Node 内置 fetch 而不是 wget/curl —— 运行镜像基于 node:20-slim，
 * 这两个工具都不存在，探针会永远失败并把 server 卡在 unhealthy。
 * 端口跟随 PORT，避免探针与服务实际监听端口漂移。
 */
const port = Number(process.env.PORT) || 3001;
const url = `http://127.0.0.1:${port}/api/health`;

/* 略小于 compose 的 healthcheck timeout(5s)，让超时由本进程收口 */
const TIMEOUT_MS = 4000;

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

fetch(url, { signal: controller.signal })
  .then((res) => {
    clearTimeout(timer);
    process.exit(res.ok ? 0 : 1);
  })
  .catch(() => {
    clearTimeout(timer);
    process.exit(1);
  });
