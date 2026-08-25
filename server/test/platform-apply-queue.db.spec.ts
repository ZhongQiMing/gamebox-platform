/**
 * 平台余额「先记账、后合并」。
 *
 * 这套机制的全部意义是缩短热行持锁时间，所以它必须做到「除了快，什么都没变」。
 * 每个用例钉住一条不变量：
 *   - 合并后的余额与「当场改余额」逐分钱一致，每条账本的 balanceAfter 也一致
 *   - 不会重复合并（两个工人同时跑也不行）
 *   - 不会漏合并（工人被打断后重启能补齐）
 *   - 幂等键照旧生效
 *   - 红线判断算上队列，工人停摆也不失灵
 */
import { PrismaClient } from '@prisma/client';
import {
  createPointsService,
  createTestPrisma,
  joinRoom,
  makeUser,
  readBalance,
  seedPlayerBalance,
  wipeMoneyTables,
} from './db/money-test-kit';
import { PLATFORM_OWNER_ID, type PointsService } from '../src/modules/points/points.service';
import { PlatformBalanceMergerService } from '../src/modules/points/platform-balance-merger.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { RedisService } from '../src/redis/redis.service';
import type { PlatformEmergencyService } from '../src/modules/points/platform-emergency.service';

describe('平台余额先记账后合并', () => {
  let prisma: PrismaClient;
  let points: PointsService;
  let merger: PlatformBalanceMergerService;
  /** 记录红线是否被触发，替代真的去改游戏状态 */
  let floorHits: number[];

  beforeAll(() => {
    prisma = createTestPrisma();
    points = createPointsService(prisma);
    floorHits = [];
    const emergency = {
      scheduleEnterOnPlatformFloor: (floor: number) => floorHits.push(floor),
    } as unknown as PlatformEmergencyService;
    /* 测试里直接调 mergeOnce，不需要真的 Redis 锁 */
    const redis = {
      runExclusive: async (_k: string, _t: number, task: () => Promise<void>) => {
        await task();
        return 'ran' as const;
      },
    } as unknown as RedisService;
    merger = new PlatformBalanceMergerService(
      prisma as unknown as PrismaService,
      redis,
      emergency,
    );
  });

  afterAll(async () => {
    await wipeMoneyTables(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "PlatformApplyQueue" CASCADE');
    await wipeMoneyTables(prisma);
    floorHits = [];
  });

  async function seedPlatform(balance: number): Promise<string> {
    const account = await prisma.pointsAccount.create({
      data: { ownerType: 'PLATFORM', ownerId: PLATFORM_OWNER_ID, roomId: '', balance },
    });
    await prisma.pointsLedger.create({
      data: {
        accountId: account.id,
        bizType: 'ADJUST',
        amount: balance,
        balanceAfter: balance,
        remark: '测试期初',
        idempotencyKey: `seed:${account.id}`,
      },
    });
    return account.id;
  }

  async function makePlayer(roomId: string, balance = 0): Promise<string> {
    const id = await makeUser(prisma);
    await joinRoom(prisma, id, roomId);
    await seedPlayerBalance(prisma, id, roomId, balance);
    return id;
  }

  /** 一批派彩：平台出钱、玩家进钱 */
  async function payouts(playerId: string, roomId: string, list: number[], keyPrefix: string) {
    return prisma.$transaction(async (tx) => {
      for (const [i, payout] of list.entries()) {
        await points.transferInTx(
          tx,
          {
            type: 'PLATFORM',
            id: PLATFORM_OWNER_ID,
            idempotencyKey: `${keyPrefix}_house_${i}`,
          },
          {
            type: 'PLAYER',
            id: playerId,
            roomId,
            idempotencyKey: `${keyPrefix}_player_${i}`,
          },
          payout,
          { bizType: 'WIN' },
        );
      }
    });
  }

  const list = [1200.5, 300, 45.25, 9999.99, 1, 7777.7, 250, 88.88];
  const total = list.reduce((s, v) => s + v, 0);

  async function platformLedger(accountId: string) {
    const rows = await prisma.pointsLedger.findMany({
      where: { accountId, bizType: 'WIN' },
      orderBy: { createdAt: 'asc' },
      select: { amount: true, balanceAfter: true, idempotencyKey: true },
    });
    return rows.map((r) => ({
      key: r.idempotencyKey,
      amount: Number(r.amount),
      balanceAfter: Number(r.balanceAfter),
    }));
  }

  it('下注/派彩当场不动平台余额，只排队', async () => {
    const roomId = 'q-room-defer';
    await seedPlatform(1_000_000);
    const playerId = await makePlayer(roomId);

    await payouts(playerId, roomId, list, 'defer');

    /* 余额还没变，但玩家已经拿到钱，账也已经记上 */
    expect(await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID)).toBeCloseTo(1_000_000, 2);
    expect(await readBalance(prisma, 'PLAYER', playerId, roomId)).toBeCloseTo(total, 2);
    expect(await prisma.platformApplyQueue.count()).toBe(list.length);
  });

  it('合并后的余额与 balanceAfter，与当场改余额完全一致', async () => {
    const roomId = 'q-room-cmp';
    const start = 5_000_000;

    /* 关掉记账走老路径，记下基准 */
    process.env.PLATFORM_JOURNAL = '0';
    const accPlain = await seedPlatform(start);
    const p1 = await makePlayer(roomId);
    await payouts(p1, roomId, list, 'cmp');
    const plainBalance = await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID);
    const plainLedger = await platformLedger(accPlain);
    delete process.env.PLATFORM_JOURNAL;

    /* 同一批走记账 + 合并 */
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "PlatformApplyQueue" CASCADE');
    await wipeMoneyTables(prisma);
    const accQueued = await seedPlatform(start);
    const p2 = await makePlayer(roomId);
    await payouts(p2, roomId, list, 'cmp');
    expect(await merger.mergeOnce()).toBe(list.length);

    expect(await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID)).toBeCloseTo(plainBalance, 2);
    expect(await platformLedger(accQueued)).toEqual(plainLedger);
    /* 顺带钉住绝对值，避免两边同时算错还互相对上 */
    expect(plainBalance).toBeCloseTo(start - total, 2);
  });

  it('合并完队列清空；再合并一次是空转，不会二次扣钱', async () => {
    const roomId = 'q-room-twice';
    await seedPlatform(1_000_000);
    const playerId = await makePlayer(roomId);
    await payouts(playerId, roomId, list, 'twice');

    await merger.mergeOnce();
    const once = await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID);
    expect(await prisma.platformApplyQueue.count()).toBe(0);

    expect(await merger.mergeOnce()).toBe(0);
    expect(await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID)).toBeCloseTo(once, 2);
  });

  it('两个工人同时跑：总额只被扣一次', async () => {
    const roomId = 'q-room-race';
    await seedPlatform(1_000_000);
    const playerId = await makePlayer(roomId);
    await payouts(playerId, roomId, list, 'race');

    /* 并发合并，两边都可能各领到一部分，但合起来必须刚好一遍 */
    const [a, b] = await Promise.all([merger.mergeOnce(), merger.mergeOnce()]);
    expect(a + b).toBe(list.length);
    expect(await prisma.platformApplyQueue.count()).toBe(0);
    expect(await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID)).toBeCloseTo(
      1_000_000 - total,
      2,
    );
  });

  it('工人中途没跑完：剩下的会在下一轮补齐，不漏账', async () => {
    const roomId = 'q-room-resume';
    await seedPlatform(1_000_000);
    const playerId = await makePlayer(roomId);
    await payouts(playerId, roomId, list, 'resume');

    /* 一轮只处理 3 条，相当于工人被打断 */
    expect(await merger.mergeOnce(3)).toBe(3);
    expect(await prisma.platformApplyQueue.count()).toBe(list.length - 3);

    /* 重启后的工人把剩下的补完，最终余额与一次合并等价 */
    while ((await merger.mergeOnce()) > 0) {
      /* 排空 */
    }
    expect(await prisma.platformApplyQueue.count()).toBe(0);
    expect(await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID)).toBeCloseTo(
      1_000_000 - total,
      2,
    );
  });

  it('幂等键照旧生效：整批重放不会二次排队', async () => {
    const roomId = 'q-room-idem';
    await seedPlatform(1_000_000);
    const playerId = await makePlayer(roomId);

    await payouts(playerId, roomId, list, 'idem');
    await payouts(playerId, roomId, list, 'idem');

    expect(await prisma.platformApplyQueue.count()).toBe(list.length);
    await merger.mergeOnce();
    expect(await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID)).toBeCloseTo(
      1_000_000 - total,
      2,
    );
  });

  it('红线算上队列：工人还没跑也能发现已经跌穿', async () => {
    const roomId = 'q-room-floor';
    process.env.PLATFORM_BALANCE_FLOOR = '-1000';
    try {
      await seedPlatform(0);
      const playerId = await makePlayer(roomId);
      /* 队列里已经赔出 1500，余额此刻还是 0 —— 只看余额会漏报 */
      await payouts(playerId, roomId, [500, 500, 500], 'floor');

      expect(await readBalance(prisma, 'PLATFORM', PLATFORM_OWNER_ID)).toBeCloseTo(0, 2);
      expect(await points.platformPendingSum()).toBeCloseTo(-1500, 2);
      expect(await points.platformEffectiveBalance()).toBeCloseTo(-1500, 2);

      /*
       * 看门狗要算出 -1500 并触发。断言这个数字而不只是「触发了」——
       * 曾经有个 bug 是在事务里用事务外连接查队列，把同一批钱算成 -3000，
       * 只断言「触发了」是抓不到的。
       */
      await merger.mergeOnce();
      expect(floorHits).toContain(-1000);
      expect((await merger.checkFloor()).effective).toBeCloseTo(-1500, 2);
    } finally {
      delete process.env.PLATFORM_BALANCE_FLOOR;
    }
  });

  /*
   * 这套机制的目的就是让下注不再争抢平台那一行，所以直接量它：一批派彩正在跑的
   * 时候，另一条连接去拿平台行的写锁，必须立刻拿到。
   */
  it('派彩期间别人能立刻拿到平台行的写锁', async () => {
    const roomId = 'q-room-lock';
    const other = createTestPrisma();
    try {
      await seedPlatform(1_000_000);
      const playerId = await makePlayer(roomId);

      /* 每笔之间插停顿，模拟逐笔的真实开销，把批次拉长到 400ms */
      const batch = prisma.$transaction(async (tx) => {
        for (let i = 0; i < 8; i++) {
          await points.transferInTx(
            tx,
            { type: 'PLATFORM', id: PLATFORM_OWNER_ID, idempotencyKey: `lock_house_${i}` },
            { type: 'PLAYER', id: playerId, roomId, idempotencyKey: `lock_player_${i}` },
            10,
            { bizType: 'WIN' },
          );
          await new Promise((r) => setTimeout(r, 50));
        }
      });

      await new Promise((r) => setTimeout(r, 120));
      const started = Date.now();
      await other.$transaction(async (tx) => {
        /*
         * 必须用 FOR NO KEY UPDATE —— 这正是「UPDATE 余额」拿的那把锁，也就是真实的
         * 竞争者。不能用 FOR UPDATE：往 PointsLedger 插行会因为外键给父行加
         * FOR KEY SHARE，FOR UPDATE 跟它冲突而 FOR NO KEY UPDATE 不冲突，用错了就会
         * 把「账本插入」误当成「余额争用」，测出来永远不达标。
         */
        await tx.$queryRaw`
          SELECT id FROM "PointsAccount"
          WHERE "ownerType" = 'PLATFORM'::"AccountOwnerType"
            AND "ownerId" = ${PLATFORM_OWNER_ID}
            AND "roomId" = ''
          FOR NO KEY UPDATE
        `;
      });
      const waited = Date.now() - started;
      await batch;

      /* 记账路径完全不动余额，所以这里应该是零等待 */
      expect(waited).toBeLessThan(100);
    } finally {
      await other.$disconnect();
    }
  });

  it('红线以内不误杀', async () => {
    const roomId = 'q-room-nofloor';
    process.env.PLATFORM_BALANCE_FLOOR = '-1000';
    try {
      await seedPlatform(0);
      const playerId = await makePlayer(roomId);
      await payouts(playerId, roomId, [300, 200], 'ok');
      await merger.mergeOnce();
      expect(floorHits).toEqual([]);
      expect(await points.platformEffectiveBalance()).toBeCloseTo(-500, 2);
    } finally {
      delete process.env.PLATFORM_BALANCE_FLOOR;
    }
  });
});
