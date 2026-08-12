/**
 * 资金层集成测试（连真实 Postgres）。
 *
 * 这里测的三件事都不可能用 mock 测出来：
 *   幂等  —— 靠 PointsLedger.idempotencyKey 的唯一约束
 *   并发  —— 靠事务 + 行锁 + 原子 UPDATE
 *   重复扣款 —— 靠「余额 + 变动额 >= 下限」这个写在 SQL 里的守卫
 * 换成假的 Prisma，这三条全都变成「测我自己写的 mock」。
 *
 *   pnpm --filter @gamebox/server test:db
 */
import type { PrismaClient } from '@prisma/client';
import { PLATFORM_OWNER_ID, type PointsService } from '../src/modules/points/points.service';
import { writeAgentQuotaInTx } from '../src/modules/console/player-fund.helper';
import {
  createPointsService,
  createTestPrisma,
  ledgerSum,
  makeUser,
  readBalance,
  runConcurrently,
  seedPlayerBalance,
  wipeMoneyTables,
} from './db/money-test-kit';

const ROOM = 'room-money-test';

let prisma: PrismaClient;
let points: PointsService;

beforeAll(async () => {
  prisma = createTestPrisma();
  points = createPointsService(prisma);
  await wipeMoneyTables(prisma);
});

afterAll(async () => {
  await wipeMoneyTables(prisma);
  await prisma.$disconnect();
});

describe('幂等键', () => {
  it('同一幂等键重复入账，只加一次钱、只留一条流水', async () => {
    const playerId = await makeUser(prisma);
    const accountId = await seedPlayerBalance(prisma, playerId, ROOM, 0);
    const key = `test:idem:${playerId}`;

    for (let i = 0; i < 3; i++) {
      await prisma.$transaction((tx) =>
        points.creditInTx(tx, 'PLAYER', playerId, 100, 'WIN', {
          roomId: ROOM,
          idempotencyKey: key,
        }),
      );
    }

    expect(await readBalance(prisma, 'PLAYER', playerId, ROOM)).toBe(100);
    const rows = await prisma.pointsLedger.count({ where: { idempotencyKey: key } });
    expect(rows).toBe(1);
    expect(await ledgerSum(prisma, accountId)).toBe(100);
  });

  it('并发派彩用同一幂等键，钱只加一次', async () => {
    const playerId = await makeUser(prisma);
    const accountId = await seedPlayerBalance(prisma, playerId, ROOM, 0);
    const key = `test:idem-race:${playerId}`;

    /* 同键先拿事务级 advisory lock；所有调用都应成功重放，不能靠 P2002 失败兜底。 */
    const concurrent = await runConcurrently(20, () =>
      prisma.$transaction((tx) =>
        points.creditInTx(tx, 'PLAYER', playerId, 50, 'WIN', {
          roomId: ROOM,
          idempotencyKey: key,
        }),
      ),
    );

    expect(concurrent).toMatchObject({ ok: 20, failed: 0, errors: [] });
    expect(await readBalance(prisma, 'PLAYER', playerId, ROOM)).toBe(50);
    expect(await prisma.pointsLedger.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await ledgerSum(prisma, accountId)).toBe(50);
  });
});

describe('重复扣款与余额下限', () => {
  it('余额不足直接拒绝，余额不动也不留流水', async () => {
    const playerId = await makeUser(prisma);
    const accountId = await seedPlayerBalance(prisma, playerId, ROOM, 30);

    await expect(
      prisma.$transaction((tx) =>
        points.creditInTx(tx, 'PLAYER', playerId, -50, 'BET', { roomId: ROOM }),
      ),
    ).rejects.toThrow('该房间账户余额不足');

    expect(await readBalance(prisma, 'PLAYER', playerId, ROOM)).toBe(30);
    expect(await prisma.pointsLedger.count({ where: { accountId, bizType: 'BET' } })).toBe(0);
    expect(await ledgerSum(prisma, accountId)).toBe(30);
  });

  it('并发扣款只能扣到 0，绝不透支', async () => {
    const playerId = await makeUser(prisma);
    const accountId = await seedPlayerBalance(prisma, playerId, ROOM, 100);

    /* 20 笔各扣 10，余额只够 10 笔 */
    const { ok, failed } = await runConcurrently(20, (i) =>
      prisma.$transaction((tx) =>
        points.creditInTx(tx, 'PLAYER', playerId, -10, 'BET', {
          roomId: ROOM,
          idempotencyKey: `test:race-bet:${playerId}:${i}`,
        }),
      ),
    );

    expect(ok).toBe(10);
    expect(failed).toBe(10);
    const balance = await readBalance(prisma, 'PLAYER', playerId, ROOM);
    expect(balance).toBe(0);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(await ledgerSum(prisma, accountId)).toBe(0);
  });

  it('同一注单并发重复提交，只扣一次', async () => {
    const playerId = await makeUser(prisma);
    const accountId = await seedPlayerBalance(prisma, playerId, ROOM, 100);
    const betKey = `test:bet:${playerId}:once`;

    await runConcurrently(10, () =>
      prisma
        .$transaction((tx) =>
          points.creditInTx(tx, 'PLAYER', playerId, -10, 'BET', {
            roomId: ROOM,
            idempotencyKey: betKey,
          }),
        )
        .catch(() => null),
    );

    expect(await readBalance(prisma, 'PLAYER', playerId, ROOM)).toBe(90);
    expect(await prisma.pointsLedger.count({ where: { idempotencyKey: betKey } })).toBe(1);
    expect(await ledgerSum(prisma, accountId)).toBe(90);
  });
});

describe('转账原子性', () => {
  it('付款方扣不动时整笔回滚，收款方不会凭空多钱', async () => {
    const playerId = await makeUser(prisma);
    await seedPlayerBalance(prisma, playerId, ROOM, 10);
    const platformBefore = await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID);

    await expect(
      prisma.$transaction((tx) =>
        points.transferInTx(
          tx,
          { type: 'PLAYER', id: playerId, roomId: ROOM },
          { type: 'PLATFORM', id: PLATFORM_OWNER_ID },
          999,
          { bizType: 'BET' },
        ),
      ),
    ).rejects.toThrow('余额不足');

    expect(await readBalance(prisma, 'PLAYER', playerId, ROOM)).toBe(10);
    expect(await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID)).toBe(platformBefore);
  });

  it('成功转账两侧金额相等，账实相符', async () => {
    const playerId = await makeUser(prisma);
    const accountId = await seedPlayerBalance(prisma, playerId, ROOM, 200);
    const platformBefore = await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID);

    await prisma.$transaction((tx) =>
      points.transferInTx(
        tx,
        { type: 'PLAYER', id: playerId, roomId: ROOM, idempotencyKey: `test:tr:${playerId}:OUT` },
        { type: 'PLATFORM', id: PLATFORM_OWNER_ID, idempotencyKey: `test:tr:${playerId}:IN` },
        80,
        { bizType: 'BET' },
      ),
    );

    expect(await readBalance(prisma, 'PLAYER', playerId, ROOM)).toBe(120);
    expect(await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID)).toBe(platformBefore + 80);
    expect(await ledgerSum(prisma, accountId)).toBe(120);
  });
});

describe('下分冻结', () => {
  it('并发申请下分，冻结总额不超过余额', async () => {
    const playerId = await makeUser(prisma);
    const accountId = await seedPlayerBalance(prisma, playerId, ROOM, 100);

    await runConcurrently(20, (i) =>
      prisma
        .$transaction((tx) =>
          points.freezeInTx(tx, playerId, 10, {
            roomId: ROOM,
            idempotencyKey: `test:freeze:${playerId}:${i}`,
          }),
        )
        .catch(() => null),
    );

    const row = await prisma.pointsAccount.findUnique({
      where: { ownerType_ownerId_roomId: { ownerType: 'PLAYER', ownerId: playerId, roomId: ROOM } },
      select: { balance: true, frozen: true },
    });
    expect(Number(row?.balance)).toBe(0);
    expect(Number(row?.frozen)).toBe(100);
    /* 冻结是账内搬家：流水合计仍等于可用余额 */
    expect(await ledgerSum(prisma, accountId)).toBe(0);
  });
});

describe('代理盘分额度', () => {
  it('同一幂等键重复写额度只生效一次，额度与流水对得上', async () => {
    const agentUserId = await makeUser(prisma, 'AGENT');
    const key = `test:quota:${agentUserId}`;

    const results: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(
        await prisma.$transaction((tx) =>
          writeAgentQuotaInTx(tx, {
            agentUserId,
            bookMode: 'CREDIT',
            delta: 500,
            bizType: 'TRANSFER_IN',
            remark: '测试发放',
            idempotencyKey: key,
            createIfMissing: true,
          }),
        ),
      );
    }

    expect(results).toEqual([true, false, false]);
    const agent = await prisma.agent.findUnique({
      where: { userId: agentUserId },
      select: { pointsQuota: true },
    });
    const ledger = await prisma.agentQuotaLedger.aggregate({
      where: { agentUserId },
      _sum: { delta: true },
    });
    expect(Number(agent?.pointsQuota)).toBe(500);
    expect(Number(ledger._sum.delta ?? 0)).toBe(500);
  });

  it('并发发放同一笔额度，不会翻倍', async () => {
    const agentUserId = await makeUser(prisma, 'AGENT');
    const key = `test:quota-race:${agentUserId}`;

    await runConcurrently(10, () =>
      prisma
        .$transaction((tx) =>
          writeAgentQuotaInTx(tx, {
            agentUserId,
            bookMode: 'CREDIT',
            delta: 300,
            bizType: 'TRANSFER_IN',
            remark: '测试并发发放',
            idempotencyKey: key,
            createIfMissing: true,
          }),
        )
        .catch(() => null),
    );

    const agent = await prisma.agent.findUnique({
      where: { userId: agentUserId },
      select: { pointsQuota: true },
    });
    const ledger = await prisma.agentQuotaLedger.aggregate({
      where: { agentUserId },
      _sum: { delta: true },
    });
    expect(Number(agent?.pointsQuota)).toBe(300);
    expect(Number(ledger._sum.delta ?? 0)).toBe(300);
  });
});
