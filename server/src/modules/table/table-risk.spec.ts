import { TableService } from './table.service';
import { equivalentBetSides, TABLE_RISK } from './table-risk';

/**
 * 下注临界区的风控不变量。
 *
 * 架构说明：平台单边限红由 Redis 里一段原子 Lua 把关（判上限与累加不可分割），
 * 玩家个人单边累计仍走数据库聚合，靠「按玩家的顾问锁」串行同一玩家的并发下注。
 * 原先是用整局排他行锁把所有人一起串起来，一桌上千人会排队到封盘。
 */
describe('TableService 下注风控', () => {
  function makeHarness(opts: {
    /** 玩家本局本方向已累计 */
    userTotal?: number;
    side?: string;
    /** Redis 限红闸门返回值：1 放行，-3 超限 */
    reserveResult?: number;
    gameCode?: string;
  } = {}) {
    const side = opts.side ?? 'dragon';
    const gameCode = opts.gameCode ?? 'dragon-tiger';
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      gameRound: {
        findUnique: jest.fn().mockResolvedValue({ state: 'PLAYING', outcome: null }),
      },
      bet: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.userTotal ?? 0 } }),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'bet-1' }),
      },
    };
    const prisma = {
      bet: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const room = {
      gameCode,
      gameName: '龙虎',
      gameId: 'game-1',
      roundId: 'round-1',
      roundNo: 'DT-1',
      phase: 'BETTING',
      phaseEndsAt: Date.now() + 60_000,
      minBet: 1,
      maxBet: 300_000,
      betSummary: {},
    };
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      reserveTableSideExposure: jest.fn().mockResolvedValue(opts.reserveResult ?? 1),
      patchTableBetSummary: jest.fn().mockResolvedValue(1),
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const points = { getPlayerBalance: jest.fn().mockResolvedValue(0), transferInTx: jest.fn() };
    const configCache = {
      get: jest.fn().mockResolvedValue({ status: 'ONLINE', minBet: 1, maxBet: 300_000 }),
    };
    const flyDisk = {
      requireOpsRoomId: jest.fn().mockResolvedValue('ops-room'),
      resolveHouse: jest.fn().mockResolvedValue({
        type: 'PLATFORM',
        id: 'PLATFORM',
        flying: true,
        roomId: 'ops-room',
        agentUserId: null,
        bookMode: null,
      }),
      resolvePlayerRate: jest.fn().mockResolvedValue({ P: 1 }),
    };
    const riskDetector = { onTableBet: jest.fn().mockResolvedValue(undefined) };
    const service = new TableService(
      prisma as never,
      redis as never,
      points as never,
      {} as never,
      configCache as never,
      riskDetector as never,
      {} as never,
      undefined,
      undefined,
      flyDisk as never,
      undefined,
    );
    (service as unknown as { getOrCreateRoom: jest.Mock }).getOrCreateRoom = jest
      .fn()
      .mockResolvedValue(room);
    (service as unknown as { resolveRoundId: jest.Mock }).resolveRoundId = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as unknown as { loadRoom: jest.Mock }).loadRoom = jest.fn().mockResolvedValue(room);
    return { tx, service, redis, points, side };
  }

  const bet = (side: string, amount = 2, key = 'risk-test', roomId = 'dragon-tiger') => ({
    roomId,
    roomNo: '100001',
    side,
    amount,
    clientKey: key,
  });

  it('平台单边限红由 Redis 原子闸门把关，超限直接拒绝', async () => {
    const { service, redis } = makeHarness({ reserveResult: -3 });

    await expect(service.placeBet('player-1', bet('dragon', 2, 'risk-001'))).rejects.toThrow(
      '该方向投注已满',
    );

    expect(redis.reserveTableSideExposure).toHaveBeenCalledWith(
      expect.objectContaining({
        side: 'dragon',
        /* 别名一起算，避免用大写方向绕开限红 */
        sides: ['dragon', 'DRAGON'],
        amount: 2,
        cap: TABLE_RISK.maxPlatformSideExposure,
        roundNo: 'DT-1',
      }),
    );
  });

  it('闸门放行时才真的落注', async () => {
    const { service, tx, redis } = makeHarness({ reserveResult: 1 });
    await expect(service.placeBet('player-1', bet('dragon', 2, 'risk-002'))).resolves.toBeDefined();
    expect(tx.bet.create).toHaveBeenCalled();
    expect(redis.reserveTableSideExposure).toHaveBeenCalledTimes(1);
  });

  it('玩家个人单边累计合并 alias，且不跨到 tiger/tie', async () => {
    const { tx, service } = makeHarness({
      userTotal: TABLE_RISK.maxUserSidePerRound - 1,
      side: 'DRAGON',
    });

    await expect(service.placeBet('player-1', bet('DRAGON', 2, 'risk-003'))).rejects.toThrow(
      `该方向本局累计不可超过 ${TABLE_RISK.maxUserSidePerRound}`,
    );

    expect(tx.bet.aggregate).toHaveBeenCalledWith({
      where: {
        roundId: 'round-1',
        playerId: 'player-1',
        status: 'PENDING',
        betType: { in: ['dragon', 'DRAGON'] },
      },
      _sum: { amount: true },
    });
    expect(equivalentBetSides('dragon-tiger', 'dragon')).toEqual(['dragon', 'DRAGON']);
    expect(equivalentBetSides('dragon-tiger', 'DRAGON')).toEqual(['dragon', 'DRAGON']);
    expect(equivalentBetSides('dragon-tiger', 'tiger')).toEqual(['tiger', 'TIGER']);
    expect(equivalentBetSides('dragon-tiger', 'tie')).toEqual(['tie', 'TIE']);
  });

  /*
   * 高赔率方向的全桌限红。默认 200 万不看赔率，顺金 100 倍下最坏赔 2 亿；
   * 拉到 10 万后最坏赔 1000 万，其余低赔率方向不受影响。
   */
  describe.each([
    ['zhajinhua', 'shunjin', 100],
    ['zhajinhua', 'baozi', 120],
    ['douniu', 'small', 100],
    ['douniu', 'flower', 90],
  ])('%s %s（%s 倍）', (gameCode, highSide, odds) => {
    it('全桌单边闸门用 10 万，最坏赔付压在 1200 万以内', async () => {
      const { service, redis } = makeHarness({ gameCode });
      await service.placeBet('player-1', bet(highSide, 100, `cap-${gameCode}-${highSide}`, gameCode));

      const cap = redis.reserveTableSideExposure.mock.calls[0]![0].cap;
      expect(cap).toBe(100_000);
      expect(cap).toBeLessThan(TABLE_RISK.maxPlatformSideExposure);
      expect(cap * odds).toBeLessThanOrEqual(12_000_000);
    });
  });

  it('低赔率方向不受影响，仍用默认全桌限红', async () => {
    const { service, redis } = makeHarness({ gameCode: 'douniu' });
    await service.placeBet('player-1', bet('niuniu', 100, 'cap-niuniu', 'douniu'));
    expect(redis.reserveTableSideExposure.mock.calls[0]![0].cap).toBe(
      TABLE_RISK.maxPlatformSideExposure,
    );
  });

  /** 取出每次 $queryRaw 的 SQL 片段（模板字符串数组）拼成可断言的文本 */
  const sqlTexts = (raw: jest.Mock) =>
    raw.mock.calls.map((c) => {
      const parts = c[0] as unknown as string[] | undefined;
      return Array.isArray(parts) ? parts.join('?') : String(parts ?? '');
    });

  it('先拿本局共享锁再拿玩家锁，之后才做个人累计判断', async () => {
    const { tx, service } = makeHarness({ userTotal: 0 });
    await service.placeBet('player-1', bet('dragon', 2, 'risk-004'));

    const sqls = sqlTexts(tx.$queryRaw);
    /* 第一条是本局共享锁（阻止结算认领），第二条是按玩家的顾问锁 */
    expect(sqls[0]).toContain('FOR SHARE');
    expect(sqls[1]).toContain('pg_advisory_xact_lock');
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.bet.aggregate.mock.invocationCallOrder[0]!,
    );
  });

  it('共享锁而非排他锁：同桌多人可并发下注', async () => {
    const { tx, service } = makeHarness({ userTotal: 0 });
    await service.placeBet('player-1', bet('dragon', 2, 'risk-005'));
    expect(sqlTexts(tx.$queryRaw).some((s) => s.includes('FOR UPDATE'))).toBe(false);
  });

  it('本局已写入开奖结果时不再接受下注', async () => {
    const { tx, service } = makeHarness({ userTotal: 0 });
    tx.gameRound.findUnique.mockResolvedValue({ state: 'PLAYING', outcome: { result: 'dragon' } });
    await expect(service.placeBet('player-1', bet('dragon', 2, 'risk-006'))).rejects.toThrow(
      '本局已封盘',
    );
  });

  it('存储/重放仍保留调用方 alias，幂等重放要求原 side 完全一致', async () => {
    const { service } = makeHarness({ side: 'DRAGON' });
    const replay = (
      service as unknown as {
        replayTableBet: (
          playerId: string,
          roomId: string,
          bet: {
            playerId: string;
            betType: string;
            amount: number;
            roundId: null;
          },
          side: string,
          amount: number,
        ) => Promise<unknown>;
      }
    ).replayTableBet.bind(service);
    const stored = {
      playerId: 'player-1',
      betType: 'DRAGON',
      amount: 10,
      roundId: null,
    };

    await expect(replay('player-1', 'dragon-tiger', stored, 'DRAGON', 10)).resolves.toBeDefined();
    await expect(replay('player-1', 'dragon-tiger', stored, 'dragon', 10)).rejects.toThrow(
      'clientKey 已被占用',
    );
  });
});
