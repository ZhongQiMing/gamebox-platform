import type { PrismaClient } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import { CsService } from '../src/modules/cs/cs.service';
import { RechargeService } from '../src/modules/recharge/recharge.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { RedisService } from '../src/redis/redis.service';
import type { AdminLogService } from '../src/modules/admin/admin-log.service';
import type { RiskDetectorService } from '../src/modules/risk/risk-detector.service';
import type { CsStaffService } from '../src/modules/console/cs-staff.service';
import {
  createPointsService,
  createTestPrisma,
  joinRoom,
  makeUser,
  seedPlayerBalance,
  wipeMoneyTables,
} from './db/money-test-kit';

const ROOM = 'room-cs-idempotency-test';
const noopLog = { log: () => Promise.resolve() } as unknown as AdminLogService;
const riskStub = { onPlayerDebit: () => undefined } as unknown as RiskDetectorService;
const notifyStub = { notifyFundOrderSubmitted: () => Promise.resolve() } as unknown as CsService;
const configStub = { get: () => undefined } as unknown as ConfigService;
const redisStub = {} as RedisService;
const staffStub = {} as CsStaffService;

let prisma: PrismaClient;
let cs: CsService;

beforeAll(async () => {
  prisma = createTestPrisma();
  const points = createPointsService(prisma);
  const recharge = new RechargeService(
    prisma as unknown as PrismaService,
    points,
    noopLog,
    riskStub,
    notifyStub,
  );
  cs = new CsService(
    prisma as unknown as PrismaService,
    configStub,
    redisStub,
    recharge,
    staffStub,
  );
  await wipeMoneyTables(prisma);
});

afterAll(async () => {
  await wipeMoneyTables(prisma);
  await prisma.$disconnect();
});

async function playerWithBalance(balance: number) {
  const playerId = await makeUser(prisma);
  await joinRoom(prisma, playerId, ROOM);
  await seedPlayerBalance(prisma, playerId, ROOM, balance);
  return playerId;
}

describe('客服消息持久化幂等', () => {
  it('并发重放下分口令只建一单、冻结一次，并返回同一消息和回执', async () => {
    const playerId = await playerWithBalance(3000);
    const clientRequestId = `CS${Date.now()}A`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => cs.playerSend(playerId, '下分500', clientRequestId)),
    );

    const ids = results.map((result) => result.list.map((message) => message.id).join(','));
    expect(new Set(ids).size).toBe(1);
    expect(await prisma.rechargeOrder.count({ where: { playerId, type: 'DOWN' } })).toBe(1);
    expect(await prisma.csMessage.count({ where: { playerId } })).toBe(2);
    expect(
      await prisma.csMessageRequest.count({ where: { playerId, clientRequestId } }),
    ).toBe(1);
    const account = await prisma.pointsAccount.findUnique({
      where: {
        ownerType_ownerId_roomId: { ownerType: 'PLAYER', ownerId: playerId, roomId: ROOM },
      },
    });
    expect(Number(account?.balance)).toBe(2500);
    expect(Number(account?.frozen)).toBe(500);
  });

  it('同键不同文本返回冲突且不产生第二笔资金操作', async () => {
    const playerId = await playerWithBalance(2000);
    const clientRequestId = `CS${Date.now()}B`;
    await cs.playerSend(playerId, '下分500', clientRequestId);

    await expect(cs.playerSend(playerId, '下分600', clientRequestId)).rejects.toMatchObject({
      status: 409,
    });
    expect(await prisma.rechargeOrder.count({ where: { playerId } })).toBe(1);
    const account = await prisma.pointsAccount.findUnique({
      where: {
        ownerType_ownerId_roomId: { ownerType: 'PLAYER', ownerId: playerId, roomId: ROOM },
      },
    });
    expect(Number(account?.frozen)).toBe(500);
  });

  it('普通聊天仍可不带 clientRequestId', async () => {
    const playerId = await playerWithBalance(0);
    const sent = await cs.playerSend(playerId, '你好');
    expect(sent.list).toHaveLength(1);
    expect(sent.list[0]?.text).toBe('你好');
  });

  it('资金口令缺少 clientRequestId 时拒绝且不落消息', async () => {
    const playerId = await playerWithBalance(1000);
    await expect(cs.playerSend(playerId, '下分500')).rejects.toThrow('clientRequestId');
    expect(await prisma.csMessage.count({ where: { playerId } })).toBe(0);
  });
});
