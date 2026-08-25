import { TableService } from './table.service';

/**
 * 分批结算的关键不变量：
 *  1. 认领只能成功一次（并发结算者不会同时开工）
 *  2. 大局按批切分，每批独立提交
 *  3. 待结算未归零时局必须留在 PLAYING（否则就是吞单）
 *  4. 毒丸注单被隔离退款，不拖累整局
 */
describe('TableService 分批结算', () => {
  const room = {
    gameCode: 'zhajinhua',
    gameName: '炸金花',
    serverSeed: 'seed-x',
    serverSeedHash: 'hash-x',
    nonce: 1,
  } as never;
  const outcome = { game: 'zhajinhua', result: 'banker' } as never;

  function makeService(opts: {
    /** 每次抢批返回多少笔；用完返回空数组 */
    batches: string[][];
    /** 指定这些批次序号抛错 */
    failAt?: Set<number>;
    remainingAfter?: number;
    /** 模拟更小的批容量，用来验证真的分了多批 */
    lockCap?: number;
    /** 模拟「退款了但注单还留在待结算」，用来验证不会空转 */
    refundNoOp?: boolean;
  }) {
    const svc = Object.create(TableService.prototype) as TableService & Record<string, unknown>;
    const settled: string[] = [];
    const refunded: string[] = [];
    const roundUpdates: Array<Record<string, unknown>> = [];
    let batchIdx = 0;

    (svc as unknown as { logger: unknown }).logger = {
      log: jest.fn(), warn: jest.fn(), error: jest.fn(),
    };

    /* 平台账户合并写：这里只要透传，落地行为由真库用例把关 */
    (svc as unknown as Record<string, unknown>).points = {
      withPooledPlatformWrites: (_tx: unknown, fn: () => Promise<unknown>) => fn(),
    };

    /* 全部待结算注单按顺序排成一条队列，抢批时按 limit 取走 */
    const pending = opts.batches.flat();
    let locked: string[] = [];

    (svc as unknown as Record<string, unknown>).prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const idx = batchIdx++;
        if (opts.failAt?.has(idx)) throw new Error(`批次 ${idx} 故障`);
        const tx = {
          $queryRaw: async () => locked.map((id) => ({ id })),
          bet: {
            findMany: async () => locked.map((id) => ({
              id, playerId: 'p1', betType: 'banker', amount: 100, payload: null,
            })),
            updateMany: async () => ({ count: 1 }),
            findUnique: async () => ({ id: 'poison', status: 'PENDING', amount: 100 }),
            findFirst: async () => ({ id: 'poison' }),
            count: async () => opts.remainingAfter ?? 0,
            aggregate: async () => ({ _sum: { amount: 0 } }),
          },
          pointsLedger: { findMany: async () => [] },
          gameRound: { updateMany: async (a: Record<string, unknown>) => { roundUpdates.push(a); return { count: 1 }; } },
        };
        return fn(tx);
      },
      bet: {
        count: async () => opts.remainingAfter ?? 0,
        aggregate: async () => ({ _sum: { amount: 0 } }),
        findFirst: async () => ({ id: 'poison' }),
      },
      gameRound: {
        updateMany: async (a: Record<string, unknown>) => { roundUpdates.push(a); return { count: 1 }; },
      },
    };

    (svc as unknown as Record<string, unknown>).settleOneBetInTx = async (
      _tx: unknown,
      _ctx: unknown,
      bet: { id: string },
    ) => {
      settled.push(bet.id);
      const i = pending.indexOf(bet.id);
      if (i >= 0) pending.splice(i, 1);
    };
    (svc as unknown as Record<string, unknown>).refundOneBetById = async (id: string) => {
      refunded.push(id);
      /* 退款后该笔不再 PENDING（除非用例特意模拟退款没生效） */
      if (opts.refundNoOp) return;
      const i = pending.indexOf(id);
      if (i >= 0) pending.splice(i, 1);
    };
    (svc as unknown as Record<string, unknown>).legacyPlatformBetIdsInTx = async () => new Set();
    (svc as unknown as Record<string, unknown>).lockPendingBetIdsInTx = async (
      _tx: unknown,
      _rid: string,
      limit: number,
    ) => {
      locked = pending.slice(0, Math.min(limit, opts.lockCap ?? limit));
      return locked;
    };

    return { svc, settled, refunded, roundUpdates, txCount: () => batchIdx };
  }

  it('认领成功才结算；已被别人认领时不重复开工', async () => {
    const svc = Object.create(TableService.prototype) as TableService & Record<string, unknown>;
    (svc as unknown as Record<string, unknown>).prisma = {
      $executeRaw: async () => 0, /* 0 行受影响 = 没抢到 */
    };
    const claimed = await (
      svc as unknown as {
        claimRoundForSettle: (r: string, m: unknown, o: unknown) => Promise<boolean>;
      }
    ).claimRoundForSettle('round-1', room, outcome);
    expect(claimed).toBe(false);
  });

  it('认领语义：仅当 outcome 为空且局仍在进行才算抢到', async () => {
    const svc = Object.create(TableService.prototype) as TableService & Record<string, unknown>;
    let sql = '';
    (svc as unknown as Record<string, unknown>).prisma = {
      $executeRaw: async (parts: { strings?: string[] } | TemplateStringsArray) => {
        sql = Array.isArray(parts) ? parts.join('?') : String((parts as { strings?: string[] }).strings?.join('?') ?? '');
        return 1;
      },
    };
    const ok = await (
      svc as unknown as {
        claimRoundForSettle: (r: string, m: unknown, o: unknown) => Promise<boolean>;
      }
    ).claimRoundForSettle('round-1', room, outcome);
    expect(ok).toBe(true);
    expect(sql).toContain('outcome IS NULL');
    expect(sql).toContain("state = 'PLAYING'");
  });

  it('大局按批切分，每批独立提交且全部注单都被结算', async () => {
    const { svc, settled, txCount } = makeService({
      batches: [['b1', 'b2', 'b3', 'b4', 'b5']],
      lockCap: 2,
    });
    await (
      svc as unknown as {
        settleRoundInBatches: (r: string, m: unknown, o: unknown) => Promise<unknown>;
      }
    ).settleRoundInBatches('round-1', room, outcome);
    expect(settled).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    /* 5 笔按每批 2 笔切 → 3 批 + 1 次收尾空批 */
    expect(txCount()).toBe(4);
  });

  it('待结算未归零时局不能标成已结算（防吞单）', async () => {
    const { svc, roundUpdates } = makeService({
      batches: [['b1']],
      remainingAfter: 7,
    });
    await (
      svc as unknown as {
        settleRoundInBatches: (r: string, m: unknown, o: unknown) => Promise<unknown>;
      }
    ).settleRoundInBatches('round-1', room, outcome);
    const finalize = roundUpdates.filter(
      (u) => (u.data as Record<string, unknown> | undefined)?.state === 'SETTLED',
    );
    expect(finalize).toHaveLength(0);
  });

  it('毒丸注单连续失败后被退款隔离，其余继续结算', async () => {
    /* 前三次事务都失败 → 降为单笔 → 单笔仍失败 → 退款隔离 */
    const { svc, refunded } = makeService({
      batches: [['poison', 'b2']],
      failAt: new Set([0, 1, 2, 3, 4, 5]),
    });
    await (
      svc as unknown as {
        settleRoundInBatches: (r: string, m: unknown, o: unknown) => Promise<unknown>;
      }
    ).settleRoundInBatches('round-1', room, outcome);
    expect(refunded).toContain('poison');
  });

  /*
   * 失败分支不增加批次计数，所以 SETTLE_MAX_BATCHES 拦不住它。
   * 退款没让注单离开待结算时必须收手，否则空转会跑满一个核心、
   * 日志无上限地涨，最后把整个进程拖死（实测会 OOM）。
   */
  it('退款后注单仍在待结算时收手，不空转', async () => {
    const { svc, refunded } = makeService({
      batches: [['poison']],
      failAt: new Set(Array.from({ length: 200 }, (_, i) => i)),
      refundNoOp: true,
    });
    await (
      svc as unknown as {
        settleRoundInBatches: (r: string, m: unknown, o: unknown) => Promise<unknown>;
      }
    ).settleRoundInBatches('round-1', room, outcome);
    /* 同一笔只退一次，然后中止本局，交给续跑巡检 */
    expect(refunded).toEqual(['poison']);
  });
});
