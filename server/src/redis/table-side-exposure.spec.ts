import { RedisService } from './redis.service';

/**
 * 单边限红预留的关键不变量：判上限与累加必须在同一段 Lua 内完成。
 *
 * 这里用一个「串行执行 Lua」的假 Redis 来模拟并发：把多个请求排队跑，
 * 只要脚本是原子的，累计就绝不会冲破上限。
 */
describe('reserveTableSideExposure', () => {
  /** 极简 Lua 语义模拟：只实现脚本里用到的那几个操作 */
  function makeFakeRedis(initialRoom: Record<string, unknown>) {
    let store = JSON.stringify(initialRoom);
    return {
      store: () => JSON.parse(store) as Record<string, unknown>,
      client: {
        eval: async (
          _script: string,
          _n: number,
          _key: string,
          roundNo: string,
          roundId: string,
          side: string,
          amount: string,
          cap: string,
          sidesJson: string,
        ) => {
          const room = JSON.parse(store) as Record<string, unknown>;
          if (room.phase !== 'BETTING') return -1;
          if (String(room.roundNo) !== String(roundNo)) return -2;
          if (roundId) room.roundId = roundId;
          const sum = (room.betSummary ?? {}) as Record<string, number>;
          const sides = JSON.parse(sidesJson) as string[];
          const amt = Number(amount);
          const capN = Number(cap);
          let total = 0;
          for (const s of sides) total += Number(sum[s] || 0);
          if (capN > 0 && total + amt > capN) return -3;
          sum[side] = Number(sum[side] || 0) + amt;
          room.betSummary = sum;
          room.version = Number(room.version || 0) + 1;
          store = JSON.stringify(room);
          return 1;
        },
      },
    };
  }

  function makeService(fake: ReturnType<typeof makeFakeRedis>) {
    const svc = Object.create(RedisService.prototype) as RedisService;
    (svc as unknown as { client: unknown }).client = fake.client;
    return svc;
  }

  const baseRoom = {
    phase: 'BETTING',
    roundNo: 'ZJH-1',
    roundId: '',
    betSummary: {},
    version: 1,
    history: [] as unknown[],
  };

  it('未超上限时累加成功', async () => {
    const fake = makeFakeRedis({ ...baseRoom });
    const svc = makeService(fake);
    const r = await svc.reserveTableSideExposure({
      key: 'k', roundNo: 'ZJH-1', roundId: 'r1',
      side: 'banker', sides: ['banker'], amount: 100, cap: 1000,
    });
    expect(r).toBe(1);
    expect((fake.store().betSummary as Record<string, number>).banker).toBe(100);
    expect(fake.store().roundId).toBe('r1');
  });

  it('并发下注不会冲破单边限红', async () => {
    const fake = makeFakeRedis({ ...baseRoom });
    const svc = makeService(fake);
    /* 20 个人同时各下 100，上限 1000：只能有 10 笔成功 */
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        svc.reserveTableSideExposure({
          key: 'k', roundNo: 'ZJH-1', roundId: 'r1',
          side: 'banker', sides: ['banker'], amount: 100, cap: 1000,
        }),
      ),
    );
    expect(results.filter((x) => x === 1)).toHaveLength(10);
    expect(results.filter((x) => x === -3)).toHaveLength(10);
    expect((fake.store().betSummary as Record<string, number>).banker).toBe(1000);
  });

  it('等价方向合计判上限，别名绕不过去', async () => {
    const fake = makeFakeRedis({
      ...baseRoom,
      betSummary: { dragon: 900 },
    });
    const svc = makeService(fake);
    /* 已占 900，再用别名 DRAGON 下 200 应被拒 */
    const r = await svc.reserveTableSideExposure({
      key: 'k', roundNo: 'ZJH-1', roundId: 'r1',
      side: 'DRAGON', sides: ['dragon', 'DRAGON'], amount: 200, cap: 1000,
    });
    expect(r).toBe(-3);
    expect((fake.store().betSummary as Record<string, number>).DRAGON).toBeUndefined();
  });

  it('非下注阶段与局号不符分别返回 -1 / -2', async () => {
    const closed = makeFakeRedis({ ...baseRoom, phase: 'DRAWING' });
    await expect(
      makeService(closed).reserveTableSideExposure({
        key: 'k', roundNo: 'ZJH-1', roundId: '', side: 'banker', sides: ['banker'], amount: 1, cap: 1000,
      }),
    ).resolves.toBe(-1);

    const stale = makeFakeRedis({ ...baseRoom });
    await expect(
      makeService(stale).reserveTableSideExposure({
        key: 'k', roundNo: 'ZJH-2', roundId: '', side: 'banker', sides: ['banker'], amount: 1, cap: 1000,
      }),
    ).resolves.toBe(-2);
  });

  it('cap 为 0 表示不限，不做上限判断', async () => {
    const fake = makeFakeRedis({ ...baseRoom });
    const svc = makeService(fake);
    const r = await svc.reserveTableSideExposure({
      key: 'k', roundNo: 'ZJH-1', roundId: '', side: 'banker', sides: ['banker'], amount: 10_000_000, cap: 0,
    });
    expect(r).toBe(1);
  });
});
