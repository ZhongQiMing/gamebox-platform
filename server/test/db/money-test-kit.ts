/**
 * 资金集成测试夹具：真库 PrismaClient + 一次性测试账号。
 * 每个用例用自己的随机后缀建号，互不干扰，跑完整体清库。
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PointsService } from '../../src/modules/points/points.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { PlatformEmergencyService } from '../../src/modules/points/platform-emergency.service';

export function createTestPrisma(): PrismaClient {
  const url = process.env.MONEY_TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url || !/_test(\?|$)/.test(new URL(url).pathname + (new URL(url).search ? '?' : ''))) {
    /* URL 里库名必须是 *_test，避免误连开发库 */
    const dbName = url ? new URL(url).pathname.replace(/^\//, '') : '(空)';
    if (!dbName.endsWith('_test')) {
      throw new Error(`拒绝连接非测试库「${dbName}」`);
    }
  }
  return new PrismaClient({
    datasources: { db: { url } },
    transactionOptions: { maxWait: 15_000, timeout: 60_000 },
  });
}

/** 平台触底会异步进维护，测试里只需要不抛错的空实现 */
const emergencyStub = {
  scheduleEnterOnPlatformFloor: () => undefined,
} as unknown as PlatformEmergencyService;

export function createPointsService(prisma: PrismaClient): PointsService {
  return new PointsService(prisma as unknown as PrismaService, emergencyStub);
}

let seq = 0;

/** 建一个测试玩家；username/uid/nickname 都有唯一约束，必须每次不同 */
export async function makeUser(
  prisma: PrismaClient,
  role: 'PLAYER' | 'AGENT' = 'PLAYER',
): Promise<string> {
  seq += 1;
  const tag = `${Date.now().toString(36)}${seq}${randomUUID().slice(0, 6)}`.toLowerCase();
  const user = await prisma.user.create({
    data: {
      username: `t${tag}`.slice(0, 20),
      passwordHash: 'x',
      uid: String(100_000_000 + (seq % 800_000_000) + Math.floor(Math.random() * 1_000_000)),
      nickname: `测试${tag}`,
      role,
    },
    select: { id: true },
  });
  return user.id;
}

/** 直接把玩家某房余额顶到指定值：只在准备阶段用，不走被测路径 */
export async function seedPlayerBalance(
  prisma: PrismaClient,
  playerId: string,
  roomId: string,
  balance: number,
): Promise<string> {
  const account = await prisma.pointsAccount.upsert({
    where: {
      ownerType_ownerId_roomId: { ownerType: 'PLAYER', ownerId: playerId, roomId },
    },
    update: { balance },
    create: { ownerType: 'PLAYER', ownerId: playerId, roomId, balance },
    select: { id: true },
  });
  /* 账实相符断言要用，期初也补一条流水 */
  await prisma.pointsLedger.create({
    data: {
      accountId: account.id,
      bizType: 'ADJUST',
      amount: balance,
      balanceAfter: balance,
      remark: '测试期初',
      idempotencyKey: `seed:${account.id}:${randomUUID()}`,
    },
  });
  return account.id;
}

/** 建房 + 把玩家设为已通过审核的成员；上下分接口要求玩家在房内 */
export async function joinRoom(
  prisma: PrismaClient,
  playerId: string,
  roomId: string,
): Promise<void> {
  seq += 1;
  await prisma.room.upsert({
    where: { id: roomId },
    update: {},
    create: {
      id: roomId,
      roomNo: String(100_000 + (seq % 900_000)),
      name: `测试房${seq}`,
    },
  });
  const existed = await prisma.roomMember.findFirst({
    where: { playerId, roomId },
    select: { id: true },
  });
  if (existed) return;
  await prisma.roomMember.create({
    data: { playerId, roomId, status: 'APPROVED' },
  });
}

export async function readBalance(
  prisma: PrismaClient,
  ownerType: 'PLAYER' | 'PLATFORM',
  ownerId: string,
  roomId = '',
): Promise<number> {
  const row = await prisma.pointsAccount.findUnique({
    where: { ownerType_ownerId_roomId: { ownerType, ownerId, roomId } },
    select: { balance: true },
  });
  return Number(row?.balance ?? 0);
}

/** 对账不变量：某账户的流水合计必须等于余额 */
export async function ledgerSum(prisma: PrismaClient, accountId: string): Promise<number> {
  const agg = await prisma.pointsLedger.aggregate({
    where: { accountId },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0);
}

/** 并发跑同一个操作，返回成功数与失败数（失败原因不吞） */
export async function runConcurrently<T>(
  times: number,
  fn: (i: number) => Promise<T>,
): Promise<{ ok: number; failed: number; errors: string[] }> {
  const results = await Promise.allSettled(
    Array.from({ length: times }, (_, i) => fn(i)),
  );
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
  return { ok: results.length - errors.length, failed: errors.length, errors };
}

export async function wipeMoneyTables(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "PointsLedger", "AgentQuotaLedger", "PointsAccount",
      "RechargeOrder", "RoomMember", "Room", "Agent", "User"
    RESTART IDENTITY CASCADE
  `);
}
