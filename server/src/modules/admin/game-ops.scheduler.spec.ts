import { GameOpsScheduler } from './game-ops.scheduler';

/*
 * 这些用例断言的是「维护窗真的生效」，所以必须屏蔽开发者本地 .env 里可能存在的
 * DISABLE_DAILY_MAINT=1（夜间联调常开），否则调度器会整段跳过、断言凭空失败。
 */
const savedDisableMaint = process.env.DISABLE_DAILY_MAINT;
beforeAll(() => {
  delete process.env.DISABLE_DAILY_MAINT;
});
afterAll(() => {
  if (savedDisableMaint === undefined) delete process.env.DISABLE_DAILY_MAINT;
  else process.env.DISABLE_DAILY_MAINT = savedDisableMaint;
});

/**
 * 调度器的日切/维护 cron 外面包了单实例锁。
 * 测试是单进程，锁直接放行，断言的仍是锁内的业务行为。
 */
function runExclusiveMock() {
  return {
    runExclusive: jest.fn(
      async (_key: string, _ttl: number, task: () => Promise<void>) => {
        await task();
        return 'ran' as const;
      },
    ),
  };
}

function makeScheduler(opts: { autoCount: number; autoCodes?: string[] }) {
  const prisma = {
    game: {
      count: jest.fn().mockResolvedValue(opts.autoCount),
      findFirst: jest.fn().mockResolvedValue(
        opts.autoCodes?.length ? { maintenanceBatchId: 'batch-restart' } : null,
      ),
      findMany: jest
        .fn()
        .mockResolvedValue((opts.autoCodes ?? []).map((code) => ({ code }))),
      updateMany: jest.fn().mockResolvedValue({ count: opts.autoCodes?.length ?? 0 }),
    },
    user: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(undefined),
    ...runExclusiveMock(),
  };
  const scheduler = new GameOpsScheduler(
    prisma as never,
    redis as never,
    { invalidateAll: jest.fn() } as never,
    { log: jest.fn() } as never,
    { isEmergencyActive: jest.fn().mockResolvedValue(false) } as never,
  );
  const internals = scheduler as unknown as { inMaintWindow(d?: Date): boolean };
  jest.spyOn(internals, 'inMaintWindow').mockReturnValue(false);
  return { scheduler, prisma };
}

describe('GameOpsScheduler 重启恢复', () => {
  it('只恢复持久化 AUTO 批次，更新条件不会命中人工维护', async () => {
    const { scheduler, prisma } = makeScheduler({
      autoCount: 2,
      autoCodes: ['ssc', 'ffc'],
    });

    await scheduler.reconcileMaintenanceWindow();

    expect(prisma.game.updateMany).toHaveBeenCalledWith({
      where: {
        code: { in: ['ssc', 'ffc'] },
        status: 'MAINTENANCE',
        maintenanceSource: 'AUTO',
        maintenanceBatchId: 'batch-restart',
      },
      data: {
        status: 'ONLINE',
        maintenanceSource: null,
        maintenanceBatchId: null,
      },
    });
  });

  it('只有人工 MAINTENANCE 时重启不触发恢复', async () => {
    const { scheduler, prisma } = makeScheduler({ autoCount: 0 });

    await scheduler.reconcileMaintenanceWindow();

    expect(prisma.game.updateMany).not.toHaveBeenCalled();
  });

  it('窗口内 stale marker 与 DB 批次不符时，以 DB 批次接管遗漏的 ONLINE 游戏', async () => {
    const prisma = {
      game: {
        findMany: jest
          .fn()
          /* DB 权威批次的原有游戏 */
          .mockResolvedValueOnce([{ code: 'ssc' }])
          /* 重启时遗漏的在线游戏 */
          .mockResolvedValueOnce([{ id: 'game-ffc', code: 'ffc' }]),
        findFirst: jest.fn().mockResolvedValue({ maintenanceBatchId: 'db-batch' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const redis = {
      get: jest.fn().mockResolvedValue(JSON.stringify({ batchId: 'stale-batch' })),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      ...runExclusiveMock(),
    };
    const cache = { invalidateAll: jest.fn() };
    const scheduler = new GameOpsScheduler(
      prisma as never,
      redis as never,
      cache as never,
      { log: jest.fn() } as never,
      { isEmergencyActive: jest.fn().mockResolvedValue(false) } as never,
    );
    const internals = scheduler as unknown as { inMaintWindow(d?: Date): boolean };
    jest.spyOn(internals, 'inMaintWindow').mockReturnValue(true);

    await scheduler.reconcileMaintenanceWindow();

    expect(prisma.game.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['game-ffc'] }, status: 'ONLINE' },
      data: {
        status: 'MAINTENANCE',
        maintenanceSource: 'AUTO',
        maintenanceBatchId: 'db-batch',
      },
    });
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      JSON.stringify({ batchId: 'db-batch', codes: ['ssc', 'ffc'] }),
      26 * 3600,
    );
    expect(cache.invalidateAll).toHaveBeenCalled();
  });

  it('窗口内 marker 无任何 AUTO 行时重新建立批次，不被 stale marker 短路', async () => {
    const online = [{ id: 'game-ssc', code: 'ssc' }];
    const prisma = {
      game: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(online)
          .mockResolvedValueOnce(online),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const redis = {
      get: jest.fn().mockResolvedValue(JSON.stringify({ batchId: 'gone-batch' })),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      ...runExclusiveMock(),
    };
    const scheduler = new GameOpsScheduler(
      prisma as never,
      redis as never,
      { invalidateAll: jest.fn() } as never,
      { log: jest.fn() } as never,
      { isEmergencyActive: jest.fn().mockResolvedValue(false) } as never,
    );
    const internals = scheduler as unknown as { inMaintWindow(d?: Date): boolean };
    jest.spyOn(internals, 'inMaintWindow').mockReturnValue(true);

    await scheduler.reconcileMaintenanceWindow();

    expect(prisma.game.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['game-ssc'] } },
      data: {
        status: 'MAINTENANCE',
        maintenanceSource: 'AUTO',
        maintenanceBatchId: expect.any(String),
      },
    });
  });
});
