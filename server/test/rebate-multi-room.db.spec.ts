import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { RebateService } from '../src/modules/rebate/rebate.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { FlyDiskService } from '../src/modules/console/fly-disk.service';
import {
  createPointsService,
  createTestPrisma,
  joinRoom,
  makeUser,
  readBalance,
  wipeMoneyTables,
} from './db/money-test-kit';

const ROOM_A = 'rebate-room-a';
const ROOM_B = 'rebate-room-b';
let prisma: PrismaClient;

function todayShanghai(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

beforeAll(async () => {
  prisma = createTestPrisma();
  await wipeMoneyTables(prisma);
});

afterAll(async () => {
  await wipeMoneyTables(prisma);
  await prisma.game.deleteMany({ where: { code: { startsWith: 'rebate-test-' } } });
  await prisma.$disconnect();
});

describe('每日回水按房间结算', () => {
  it('同日两房一次领取分别入账，并发重放不双发', async () => {
    const playerId = await makeUser(prisma);
    await joinRoom(prisma, playerId, ROOM_A);
    await joinRoom(prisma, playerId, ROOM_B);
    await prisma.pointsAccount.create({
      data: { ownerType: 'PLATFORM', ownerId: 'PLATFORM', roomId: '', balance: 10_000 },
    });
    const game = await prisma.game.create({
      data: {
        code: `rebate-test-${randomUUID().slice(0, 8)}`,
        name: '回水测试',
        category: 'SLOT',
        status: 'ONLINE',
        configs: {
          create: { version: 1, active: true, rtp: 0.95, payTable: {}, params: {} },
        },
      },
    });
    const settledAt = new Date();
    await prisma.bet.createMany({
      data: [
        {
          betNo: `RB${randomUUID()}`,
          playerId,
          gameId: game.id,
          amount: 100,
          payout: 0,
          validFlow: 100,
          status: 'LOST',
          settledAt,
          payload: { fly: { roomId: ROOM_A, flying: true } },
        },
        {
          betNo: `RB${randomUUID()}`,
          playerId,
          gameId: game.id,
          amount: 200,
          payout: 0,
          validFlow: 200,
          status: 'LOST',
          settledAt,
          payload: { fly: { roomId: ROOM_B, flying: true } },
        },
      ],
    });
    const fly = {
      resolvePlayerRate: jest.fn((_: string, roomId: string) =>
        Promise.resolve({ P: roomId === ROOM_A ? 0.01 : 0.025 }),
      ),
      resolveHouse: jest.fn((_: string, roomId: string) =>
        Promise.resolve({ type: 'PLATFORM', id: 'PLATFORM', flying: true, roomId }),
      ),
    } as unknown as FlyDiskService;
    const rebate = new RebateService(
      prisma as unknown as PrismaService,
      createPointsService(prisma),
      fly,
    );

    const status = await rebate.getStatus(playerId);
    expect(status.claimableTotal).toBe(6);
    expect(status.today.estimatedRebate).toBe(6);

    const results = await Promise.allSettled([
      rebate.claimDate(playerId, todayShanghai(), 'MANUAL'),
      rebate.claimDate(playerId, todayShanghai(), 'MANUAL'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await readBalance(prisma, 'PLAYER', playerId, ROOM_A)).toBe(1);
    expect(await readBalance(prisma, 'PLAYER', playerId, ROOM_B)).toBe(5);
    const settlements = await prisma.dailyRebateSettlement.findMany({
      where: { playerId },
      orderBy: { roomId: 'asc' },
      select: { roomId: true, amount: true },
    });
    expect(settlements.map((row) => [row.roomId, Number(row.amount)])).toEqual([
      [ROOM_A, 1],
      [ROOM_B, 5],
    ]);
    expect(
      await prisma.pointsLedger.count({
        where: { bizType: 'REBATE', account: { ownerType: 'PLAYER', ownerId: playerId } },
      }),
    ).toBe(2);
  });

  it('迁移前 roomId=null 的历史游标继续阻挡所有房间旧流水', async () => {
    const playerId = await makeUser(prisma);
    await joinRoom(prisma, playerId, ROOM_A);
    await joinRoom(prisma, playerId, ROOM_B);
    await prisma.pointsAccount.upsert({
      where: {
        ownerType_ownerId_roomId: {
          ownerType: 'PLATFORM',
          ownerId: 'PLATFORM',
          roomId: '',
        },
      },
      update: { balance: 10_000 },
      create: { ownerType: 'PLATFORM', ownerId: 'PLATFORM', roomId: '', balance: 10_000 },
    });
    const game = await prisma.game.create({
      data: {
        code: `rebate-test-${randomUUID().slice(0, 8)}`,
        name: '旧游标测试',
        category: 'SLOT',
        status: 'ONLINE',
      },
    });
    const cursor = new Date(Date.now() - 10_000);
    const rebateDate = new Date(`${todayShanghai()}T00:00:00.000Z`);
    await prisma.dailyRebateSettlement.create({
      data: {
        playerId,
        roomId: null,
        rebateDate,
        validFlow: 300,
        rate: 0.02,
        amount: 6,
        claimType: 'MANUAL',
        periodEnd: cursor,
      },
    });
    await prisma.bet.createMany({
      data: [
        {
          betNo: `RB${randomUUID()}`,
          playerId,
          gameId: game.id,
          amount: 100,
          validFlow: 100,
          status: 'LOST',
          settledAt: new Date(cursor.getTime() - 1_000),
          payload: { fly: { roomId: ROOM_A, flying: true } },
        },
        {
          betNo: `RB${randomUUID()}`,
          playerId,
          gameId: game.id,
          amount: 200,
          validFlow: 200,
          status: 'LOST',
          settledAt: new Date(cursor.getTime() - 1_000),
          payload: { fly: { roomId: ROOM_B, flying: true } },
        },
        {
          betNo: `RB${randomUUID()}`,
          playerId,
          gameId: game.id,
          amount: 50,
          validFlow: 50,
          status: 'LOST',
          settledAt: new Date(cursor.getTime() + 1_000),
          payload: { fly: { roomId: ROOM_A, flying: true } },
        },
        {
          betNo: `RB${randomUUID()}`,
          playerId,
          gameId: game.id,
          amount: 100,
          validFlow: 100,
          status: 'LOST',
          settledAt: new Date(cursor.getTime() + 1_000),
          payload: { fly: { roomId: ROOM_B, flying: true } },
        },
      ],
    });
    const rebate = new RebateService(
      prisma as unknown as PrismaService,
      createPointsService(prisma),
      {
        resolvePlayerRate: jest.fn().mockResolvedValue({ P: 0.02 }),
        resolveHouse: jest.fn((_: string, roomId: string) =>
          Promise.resolve({ type: 'PLATFORM', id: 'PLATFORM', flying: true, roomId }),
        ),
      } as unknown as FlyDiskService,
    );

    const result = await rebate.claimDate(playerId, todayShanghai(), 'MANUAL');
    expect(Number(result.amount)).toBe(3);
    expect(await readBalance(prisma, 'PLAYER', playerId, ROOM_A)).toBe(1);
    expect(await readBalance(prisma, 'PLAYER', playerId, ROOM_B)).toBe(2);
  });

  it('SQL 先排除旧已付流水，并完整领取超过 5000 条的同时间戳边界', async () => {
    const playerId = await makeUser(prisma);
    await joinRoom(prisma, playerId, ROOM_A);
    await prisma.pointsAccount.upsert({
      where: {
        ownerType_ownerId_roomId: {
          ownerType: 'PLATFORM',
          ownerId: 'PLATFORM',
          roomId: '',
        },
      },
      update: { balance: 100_000 },
      create: { ownerType: 'PLATFORM', ownerId: 'PLATFORM', roomId: '', balance: 100_000 },
    });
    const game = await prisma.game.create({
      data: {
        code: `rebate-test-${randomUUID().slice(0, 8)}`,
        name: '分页边界测试',
        category: 'SLOT',
        status: 'ONLINE',
      },
    });
    const oldAt = new Date(Date.now() - 2_000);
    const boundaryAt = new Date(Date.now() - 1_000);
    const paidRows = Array.from({ length: 5_000 }, (_, i) => ({
      betNo: `RBP${playerId.slice(-6)}${i}`,
      playerId,
      gameId: game.id,
      amount: 1,
      validFlow: 1,
      status: 'LOST' as const,
      settledAt: oldAt,
      payload: {
        flowRebatePaid: true,
        fly: { roomId: ROOM_A, flying: true, P: 0.02 },
      },
    }));
    const unclaimedRows = Array.from({ length: 5_001 }, (_, i) => ({
      betNo: `RBU${playerId.slice(-6)}${i}`,
      playerId,
      gameId: game.id,
      amount: 1,
      validFlow: 1,
      status: 'LOST' as const,
      settledAt: boundaryAt,
      payload: { fly: { roomId: ROOM_A, flying: true, P: 0.02 } },
    }));
    for (const chunk of [
      paidRows.slice(0, 2_500),
      paidRows.slice(2_500),
      unclaimedRows.slice(0, 2_500),
      unclaimedRows.slice(2_500),
    ]) {
      await prisma.bet.createMany({ data: chunk });
    }
    const fly = {
      resolvePlayerRate: jest.fn(),
      resolveHouse: jest.fn((_: string, roomId: string) =>
        Promise.resolve({ type: 'PLATFORM', id: 'PLATFORM', flying: true, roomId }),
      ),
    } as unknown as FlyDiskService;
    const rebate = new RebateService(
      prisma as unknown as PrismaService,
      createPointsService(prisma),
      fly,
    );

    const result = await rebate.claimDate(playerId, todayShanghai(), 'MANUAL');
    expect(Number(result.amount)).toBe(100.02);
    expect(await readBalance(prisma, 'PLAYER', playerId, ROOM_A)).toBe(100.02);
    expect(fly.resolvePlayerRate).not.toHaveBeenCalled();
    const rows = await prisma.dailyRebateSettlement.findMany({
      where: { playerId, roomId: ROOM_A },
      select: { validFlow: true, periodEnd: true },
    });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.validFlow)).toBe(5_001);
    expect(rows[0]!.periodEnd).toEqual(boundaryAt);
    await expect(
      rebate.claimDate(playerId, todayShanghai(), 'MANUAL'),
    ).rejects.toThrow('当前无可领取的回水');
  });
});
