import { assertPayoutAllowed, payoutGateStatus } from './payout-gate.helper';

/**
 * 出款闸门：对账不平就不准出款。
 *
 * 这道闸门挡的是「账已经花了还继续往外付」——那会把一个可查的记账问题变成
 * 不可逆的资金损失。但它绝不能因为一次误报、一次重启或一次巡检没跑就把生意冻死，
 * 所以有三条退路：只看「账本被破坏」那几项、结论过期就不作为依据、管理员可知情放行。
 *
 * 判定写成只吃 Prisma 的纯函数：出款动作分布在 Console 与 Recharge 两个模块里，
 * 让它们去依赖 FundReconModule 会形成三方循环，Nest 会在模块实例化阶段卡死。
 */
describe('出款闸门', () => {
  const HOUR = 3600_000;

  /** 造一份报告：gatingBad 是「账本被破坏」类，noteBad 是只告警类 */
  const report = (gatingBad: number, noteBad = 0) => ({
    checkedAt: new Date().toISOString(),
    durationMs: 1,
    ok: gatingBad + noteBad === 0,
    totalBad: gatingBad + noteBad,
    checks: [
      { key: 'points_sum', label: '积分账', hint: '', bad: gatingBad, rows: [], gating: true },
      { key: 'credit_conservation', label: '信用盘守恒', hint: '', bad: noteBad, rows: [], gating: false },
    ],
  });

  function makeDb(opts: {
    run?: { gatingBad: number; noteBad?: number; ageHours?: number } | null;
    release?: { reason: string; expiresAt: Date; createdById: string } | null;
  }) {
    return {
      payoutGateRelease: {
        findFirst: async () => (opts.release
          ? { id: 'rel-1', revokedAt: null, ...opts.release }
          : null),
      },
      fundReconRun: {
        findFirst: async () => (opts.run
          ? {
              id: 'run-1',
              ok: (opts.run.gatingBad + (opts.run.noteBad ?? 0)) === 0,
              totalBad: opts.run.gatingBad + (opts.run.noteBad ?? 0),
              createdAt: new Date(Date.now() - (opts.run.ageHours ?? 1) * HOUR),
              report: report(opts.run.gatingBad, opts.run.noteBad ?? 0),
            }
          : null),
      },
    } as never;
  }

  it('账平就放行', async () => {
    const st = await payoutGateStatus(makeDb({ run: { gatingBad: 0 } }));
    expect(st.allowed).toBe(true);
    expect(st.reason).toBe('ok');
    await expect(assertPayoutAllowed(makeDb({ run: { gatingBad: 0 } }), '测试')).resolves.toBeUndefined();
  });

  it('账本被破坏就拦住，并说清是哪几项', async () => {
    const db = makeDb({ run: { gatingBad: 3, noteBad: 2 } });
    const st = await payoutGateStatus(db);
    expect(st.allowed).toBe(false);
    expect(st.reason).toBe('drift');
    /* 只统计该拦的那几项，不把正常波动算进去 */
    expect(st.totalBad).toBe(3);
    expect(st.blocking).toEqual(['积分账']);
    await expect(assertPayoutAllowed(db, '测试')).rejects.toThrow('已暂停出款');
  });

  it('只告警类的异常不拦出款（信用盘偏离属于正常经营波动）', async () => {
    const db = makeDb({ run: { gatingBad: 0, noteBad: 12 } });
    const st = await payoutGateStatus(db);
    expect(st.allowed).toBe(true);
    expect(st.reason).toBe('ok');
    await expect(assertPayoutAllowed(db, '测试')).resolves.toBeUndefined();
  });

  it('结论过期太久就不作为依据，放行并留痕', async () => {
    const st = await payoutGateStatus(makeDb({ run: { gatingBad: 9, ageHours: 100 } }));
    /* 拦死会让「巡检没跑起来」这一个运维问题停掉全部出款，影响面远大于它防的风险 */
    expect(st.allowed).toBe(true);
    expect(st.reason).toBe('stale');
  });

  it('从没对过账时放行', async () => {
    const st = await payoutGateStatus(makeDb({ run: null }));
    expect(st.allowed).toBe(true);
    expect(st.reason).toBe('no_report');
  });

  it('管理员知情放行期间即使账不平也放行，且带出放行信息', async () => {
    const db = makeDb({
      run: { gatingBad: 9 },
      release: {
        reason: '已确认是历史迁移遗留',
        expiresAt: new Date(Date.now() + 2 * HOUR),
        createdById: 'admin-1',
      },
    });
    const st = await payoutGateStatus(db);
    expect(st.allowed).toBe(true);
    expect(st.reason).toBe('released');
    expect(st.release?.reason).toBe('已确认是历史迁移遗留');
    await expect(assertPayoutAllowed(db, '测试')).resolves.toBeUndefined();
  });

  it('过期的放行不算，恢复拦截', async () => {
    const db = makeDb({
      run: { gatingBad: 4 },
      /* 已过期：helper 用 expiresAt > now 过滤，这里直接给 null 模拟查不到 */
      release: null,
    });
    const st = await payoutGateStatus(db);
    expect(st.allowed).toBe(false);
    expect(st.totalBad).toBe(4);
  });
});
