/**
 * 启动后端开发服务，且不依附当前终端会话。
 *
 * 背景：后端原先跑在受管理的临时终端里，终端被回收时它会一起消失，
 * 日志里没有任何报错、端口突然不通（今晚出现多次，日志只留下一个 ^C）。
 * Windows 上仅用 detached 不够——父级作业对象被清理时子进程仍会被连带终止，
 * 所以这里用 Start-Process 起一个真正独立的进程。
 *
 * 日志写到系统临时目录，不放仓库内，避免任何文件监视器被日志写入反复触发。
 *
 * 跑法：node scripts/dev-start-backend.mjs
 * 停止：node scripts/dev-stop-backend.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEV_DIR = join(tmpdir(), 'gamebox-dev');
export const BACKEND_LOG = join(DEV_DIR, 'backend.log');
export const BACKEND_ERR = join(DEV_DIR, 'backend.err.log');
export const BACKEND_PID = join(DEV_DIR, 'backend.pid');

async function healthy() {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 2500);
  try {
    const r = await fetch('http://127.0.0.1:3000/api/health', { signal: c.signal });
    return r.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('dev-start-backend.mjs')) {
  mkdirSync(DEV_DIR, { recursive: true });

  if (await healthy()) {
    console.log('后端已在运行（3000 端口健康），不重复启动');
    process.exit(0);
  }

  const repo = process.cwd().replace(/'/g, "''");
  const ps = [
    `$p = Start-Process -FilePath 'cmd.exe'`,
    `-ArgumentList '/c','pnpm dev:server'`,
    `-WorkingDirectory '${repo}'`,
    `-WindowStyle Hidden`,
    `-RedirectStandardOutput '${BACKEND_LOG.replace(/'/g, "''")}'`,
    `-RedirectStandardError '${BACKEND_ERR.replace(/'/g, "''")}'`,
    `-PassThru; $p.Id`,
  ].join(' ');

  const pid = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  }).trim();
  writeFileSync(BACKEND_PID, pid);
  console.log(`后端已独立启动 pid=${pid}`);
  console.log(`标准输出：${BACKEND_LOG}`);
  console.log(`错误输出：${BACKEND_ERR}`);

  process.stdout.write('等待就绪');
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    process.stdout.write('.');
    if (await healthy()) {
      console.log(`\n后端就绪（约 ${(i + 1) * 3} 秒）`);
      process.exit(0);
    }
  }
  console.log('\n等待超时，请查看错误输出文件');
  process.exit(1);
}
