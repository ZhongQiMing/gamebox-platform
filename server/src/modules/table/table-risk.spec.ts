import { TableService } from './table.service';
import { equivalentBetSides, TABLE_RISK } from './table-risk';

describe('TableService 平台单边暴露', () => {
  function makeHarness(platformTotal: number, userTotal = 0, side = 'dragon') {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      gameRound: {
        findUnique: jest.fn().mockResolvedValue({ state: 'PLAYING' }),
      },
      bet: {
        aggregate: jest
          .fn()
          .mockResolvedValueOnce({ _sum: { amount: platformTotal } })
          .mockResolvedValueOnce({ _sum: { amount: userTotal } }),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    const prisma = {
      bet: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const redis = {
      get: jest.fn().mockResolvedValue(null),
    };
    const points = { getPlayerBalance: jest.fn() };
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
    const service = new TableService(
      prisma as never,
      redis as never,
      points as never,
      {} as never,
      configCache as never,
      {} as never,
      {} as never,
      undefined,
      undefined,
      flyDisk as never,
      undefined,
    );
    const room = {
      gameCode: 'dragon-tiger',
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
    (service as unknown as { getOrCreateRoom: jest.Mock }).getOrCreateRoom = jest
      .fn()
      .mockResolvedValue(room);
    (service as unknown as { resolveRoundId: jest.Mock }).resolveRoundId = jest
      .fn()
      .mockResolvedValue(undefined);
    return { tx, service, side };
  }

  it('锁内平台聚合同时统计小写和大写历史注单', async () => {
    const { tx, service, side } = makeHarness(TABLE_RISK.maxPlatformSideExposure - 1);

    await expect(
      service.placeBet('player-1', {
        roomId: 'dragon-tiger',
        roomNo: '100001',
        side,
        amount: 2,
        clientKey: 'risk-test-001',
      }),
    ).rejects.toThrow('该方向投注已满');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.gameRound.findUnique).toHaveBeenCalledWith({
      where: { id: 'round-1' },
      select: { state: true },
    });
    expect(tx.bet.aggregate).toHaveBeenCalledWith({
      where: {
        roundId: 'round-1',
        status: 'PENDING',
        betType: { in: ['dragon', 'DRAGON'] },
      },
      _sum: { amount: true },
    });
    expect(tx.bet.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.bet.aggregate.mock.invocationCallOrder[0]!,
    );
  });

  it('锁内玩家累计也合并 alias，且不跨到 tiger/tie', async () => {
    const { tx, service } = makeHarness(0, TABLE_RISK.maxUserSidePerRound - 1, 'DRAGON');

    await expect(
      service.placeBet('player-1', {
        roomId: 'dragon-tiger',
        roomNo: '100001',
        side: 'DRAGON',
        amount: 2,
        clientKey: 'risk-test-002',
      }),
    ).rejects.toThrow(`该方向本局累计不可超过 ${TABLE_RISK.maxUserSidePerRound}`);

    expect(tx.bet.aggregate).toHaveBeenNthCalledWith(2, {
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

  it('存储/重放仍保留调用方 alias，幂等重放要求原 side 完全一致', async () => {
    const { service } = makeHarness(0, 0, 'DRAGON');
    (service as unknown as { loadRoom: jest.Mock }).loadRoom = jest.fn().mockResolvedValue({
      roundNo: 'DT-1',
      phase: 'BETTING',
      phaseEndsAt: Date.now() + 60_000,
    });
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
