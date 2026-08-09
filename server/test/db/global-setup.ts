/**
 * 资金集成测试的库准备：建一个独立测试库并跑迁移。
 *
 * 为什么必须独立库：这些用例要并发扣款、要断言「账本合计 == 余额」，
 * 跑在开发库上既会污染手测数据，也会被别人的残留数据带偏断言。
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const TEST_DB_SUFFIX = '_test';

/** 把 DATABASE_URL 的库名换成测试库；同时返回连 postgres 维护库的 URL */
function resolveUrls(): { testUrl: string; adminUrl: string; dbName: string } {
  const raw = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('缺少 DATABASE_URL：请先配置 server/.env 或设置 TEST_DATABASE_URL');
  }
  const url = new URL(raw);
  const devDb = url.pathname.replace(/^\//, '') || 'postgres';
  const dbName = process.env.TEST_DATABASE_URL
    ? devDb
    : `${devDb}${TEST_DB_SUFFIX}`;

  /* 兜底：绝不允许把测试跑进非 _test 库，否则会清掉开发数据 */
  if (!dbName.endsWith(TEST_DB_SUFFIX)) {
    throw new Error(`拒绝在库「${dbName}」上跑资金集成测试：库名必须以 ${TEST_DB_SUFFIX} 结尾`);
  }

  const testUrl = new URL(raw);
  testUrl.pathname = `/${dbName}`;
  const adminUrl = new URL(raw);
  adminUrl.pathname = '/postgres';
  return { testUrl: testUrl.toString(), adminUrl: adminUrl.toString(), dbName };
}

export default async function globalSetup(): Promise<void> {
  const { testUrl, adminUrl, dbName } = resolveUrls();

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`[money-test] 已创建测试库 ${dbName}`);
  } catch (e) {
    /* 42P04 = 库已存在，属正常复跑 */
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('already exists') && !msg.includes('42P04')) throw e;
  } finally {
    await admin.$disconnect();
  }

  execSync('pnpm exec prisma migrate deploy', {
    cwd: `${__dirname}/../..`,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });

  /* 供各测试进程使用；globalSetup 先于 worker 启动，env 会被继承 */
  process.env.DATABASE_URL = testUrl;
  process.env.MONEY_TEST_DATABASE_URL = testUrl;
}
