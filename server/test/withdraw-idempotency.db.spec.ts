/**
 * 玩家自助下分的防连点（连真实 Postgres）。
 *
 * 连点下分是最难受的一种：每点一次冻一笔，余额被全部冻住，
 * 玩家看着钱在却动不了，还得客服一张张驳回。
 * 订单号即幂等键，同号重放必须返回同一张单、只冻一次。
 */
import type { PrismaClient } from '@prisma/client';
import { RechargeService } from '../src/modules/recharge/recharge.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AdminLogService } from '../src/modules/admin/admin-log.service';
import type { RiskDetectorService } from '../src/modules/risk/risk-detector.service';
import type { CsService } from '../src/modules/cs/cs.service';
import {
  createPointsService,
  createTestPrisma,
  joinRoom,
  makeUser,
  runConcurrently,
  seedPlayerBalance,
  wipeMoneyTables,
} from './db/money-test-kit';

const ROOM = 'room-withdraw-test';

/** 建玩家 + 入房 + 给余额 */
async function makePlayerInRoom(balance: number): Promise<string> {
  const playerId = await makeUser(prisma);
  await joinRoom(prisma, playerId, ROOM);
  await seedPlayerBalance(prisma, playerId, ROOM, balance);
  return playerId;
}

let prisma: PrismaClient;
let recharge: RechargeService;

const noop = { log: () => Promise.resolve() } as unknown as AdminLogService;
const riskStub = { onPlayerDebit: () => undefined } as unknown as RiskDetectorService;
const csStub = { notifyFundOrderSubmitted: () => Promise.resolve() } as unknown as CsService;

async function frozenOf(playerId: string): Promise<number> {
  const acc = await prisma.pointsAccount.findUnique({
    where: {
      ownerType_ownerId_roomId: { ownerType: 'PLAYER', ownerId: playerId, roomId: ROOM },
    },
    select: { frozen: true },
  });
  return Number(acc?.frozen ?? 0);
}

beforeAll(async () => {
  prisma = createTestPrisma();
  recharge = new RechargeService(
    prisma as unknown as PrismaService,
    createPointsService(prisma),
    noop,
    riskStub,
    csStub,
  );
  await wipeMoneyTables(prisma);
});

afterAll(async () => {
  await prisma.rechargeOrder.deleteMany({});
  await wipeMoneyTables(prisma);
  await prisma.$disconnect();
});

describe('下分防连点', () => {
  it('同一订单号重复提交只建一张单、只冻一次', async () => {
    const playerId = await makePlayerInRoom(2000);
    const orderNo = `XF${Date.now()}A`;

    const first = await recharge.applyWithdraw(playerId, 500, '人工', {
      roomId: ROOM,
      clientRequestId: orderNo,
      skipCsNotify: true,
    });
    const again = await recharge.applyWithdraw(playerId, 500, '人工', {
      roomId: ROOM,
      clientRequestId: orderNo,
      skipCsNotify: true,
    });

    expect(again.id).toBe(first.id);
    expect(await frozenOf(playerId)).toBe(500);
    expect(
      await prisma.rechargeOrder.count({ where: { playerId, type: 'DOWN' } }),
    ).toBe(1);
  });

  it('并发连点同号，余额不会被多冻', async () => {
    const playerId = await makePlayerInRoom(3000);
    const orderNo = `XF${Date.now()}B`;

    await runConcurrently(8, () =>
      recharge
        .applyWithdraw(playerId, 600, '人工', {
          roomId: ROOM,
          clientRequestId: orderNo,
          skipCsNotify: true,
        })
        .catch(() => null),
    );

    expect(await frozenOf(playerId)).toBe(600);
    expect(
      await prisma.rechargeOrder.count({ where: { playerId, type: 'DOWN' } }),
    ).toBe(1);
  });

  it('换个订单号是新的一笔，正常各冻各的', async () => {
    const playerId = await makePlayerInRoom(2000);

    await recharge.applyWithdraw(playerId, 500, '人工', {
      roomId: ROOM,
      clientRequestId: `XF${Date.now()}C1`,
      skipCsNotify: true,
    });
    await recharge.applyWithdraw(playerId, 700, '人工', {
      roomId: ROOM,
      clientRequestId: `XF${Date.now()}C2`,
      skipCsNotify: true,
    });

    expect(await frozenOf(playerId)).toBe(1200);
  });

  it('别人的订单号不能被拿来重放', async () => {
    const a = await makePlayerInRoom(2000);
    const b = await makePlayerInRoom(2000);
    const orderNo = `XF${Date.now()}D`;

    await recharge.applyWithdraw(a, 500, '人工', {
      roomId: ROOM,
      clientRequestId: orderNo,
      skipCsNotify: true,
    });

    await expect(
      recharge.applyWithdraw(b, 500, '人工', {
        roomId: ROOM,
        clientRequestId: orderNo,
        skipCsNotify: true,
      }),
    ).rejects.toThrow('订单号已被占用');
    expect(await frozenOf(b)).toBe(0);
  });

  it('订单号格式不合规直接拒，不落单', async () => {
    const playerId = await makePlayerInRoom(2000);

    await expect(
      recharge.applyWithdraw(playerId, 500, '人工', {
        roomId: ROOM,
        clientRequestId: '短',
        skipCsNotify: true,
      }),
    ).rejects.toThrow('订单号格式无效');
    expect(await frozenOf(playerId)).toBe(0);
  });

  it('上分同号重放也只建一张单', async () => {
    const playerId = await makePlayerInRoom(0);
    const orderNo = `SF${Date.now()}E`;

    const first = await recharge.applyRecharge(playerId, 500, '人工', {
      roomId: ROOM,
      clientRequestId: orderNo,
      skipCsNotify: true,
    });
    const again = await recharge.applyRecharge(playerId, 500, '人工', {
      roomId: ROOM,
      clientRequestId: orderNo,
      skipCsNotify: true,
    });

    expect(again.id).toBe(first.id);
    expect(await prisma.rechargeOrder.count({ where: { playerId, type: 'UP' } })).toBe(1);
  });
});
