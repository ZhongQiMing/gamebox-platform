import { FlyRebateService, ownRebateRates, persistedPkgRates } from './fly-rebate.service';

/**
 * 整包比例必须用下注时的快照结算。
 *
 * 结算可能比下注晚很久（彩票要等开奖、水果机要等揭晓、牌桌崩溃后要续跑）。
 * 期间管理端改了比例的话，现算就会按新比例结算旧流水——玩家回水 P 早就是
 * 下注时快照，代理与总代整包必须同样处理，否则同一笔注单三方口径不一致。
 */
describe('各人自己的回水点', () => {
  it('街机默认：总代 2.5、代理 1.5、玩家 0.5 → 各人 1 / 1 / 0.5', () => {
    expect(ownRebateRates(0.015, 0.025, 0.005)).toEqual({
      playerRate: 0.005,
      agentOwn: 0.01,
      generalOwn: 0.01,
    });
  });

  it('没有总代时总代自己的是 0', () => {
    expect(ownRebateRates(0.015, 0, 0.005)).toMatchObject({
      agentOwn: 0.01,
      generalOwn: 0,
    });
  });
});

describe('整包比例快照', () => {
  describe('persistedPkgRates', () => {
    it('两个比例都在时按快照取', () => {
      expect(persistedPkgRates({ agentPkg: 0.05, generalPkg: 0.08 })).toEqual({
        agentPkg: 0.05,
        generalPkg: 0.08,
        P: 0,
      });
    });

    it('只有一个时另一个按 0，不回退现算', () => {
      expect(persistedPkgRates({ agentPkg: 0.05 })).toEqual({ agentPkg: 0.05, generalPkg: 0, P: 0 });
      expect(persistedPkgRates({ generalPkg: 0.08 })).toEqual({ agentPkg: 0, generalPkg: 0.08, P: 0 });
    });

    it('老注单没有这两个字段时返回 null，由调用方现算', () => {
      expect(persistedPkgRates({})).toBeNull();
      expect(persistedPkgRates(null)).toBeNull();
      expect(persistedPkgRates(undefined)).toBeNull();
      expect(persistedPkgRates({ P: 0.018 } as never)).toBeNull();
    });

    it('越界或非数值不算有效快照', () => {
      expect(persistedPkgRates({ agentPkg: -0.1, generalPkg: 'x' })).toBeNull();
      expect(persistedPkgRates({ agentPkg: 1.5 })).toBeNull();
      expect(persistedPkgRates({ agentPkg: Number.NaN })).toBeNull();
      expect(persistedPkgRates({ agentPkg: Infinity })).toBeNull();
    });

    it('0 是有效比例，不能当成缺失', () => {
      expect(persistedPkgRates({ agentPkg: 0, generalPkg: 0 })).toEqual({
        agentPkg: 0,
        generalPkg: 0,
        P: 0,
      });
    });

    it('快照里的玩家 P 要带上，用来扣整包净额', () => {
      expect(persistedPkgRates({ agentPkg: 0.05, generalPkg: 0, P: 0.018 })).toEqual({
        agentPkg: 0.05,
        generalPkg: 0,
        P: 0.018,
      });
    });
  });

  describe('payBetFlowInTx 用哪套比例', () => {
    function makeService(liveRates: { agentPkg: number; generalPkg: number; P?: number }) {
      const paid: Array<{ who: string; amount: number; ratePct: number }> = [];
      const svc = Object.create(FlyRebateService.prototype) as FlyRebateService;
      const fly = { resolvePlayerRate: jest.fn().mockResolvedValue(liveRates) };
      (svc as unknown as Record<string, unknown>).fly = fly;
      (svc as unknown as Record<string, unknown>).commission = {
        distributeInTx: jest.fn().mockResolvedValue(undefined),
      };
      (svc as unknown as Record<string, unknown>).payPlatformToAgentWageInTx = async (
        _tx: unknown,
        o: { agentUserId: string; amount: number; ratePct: number; tag: string },
      ) => { paid.push({ who: `platform→${o.tag}`, amount: o.amount, ratePct: o.ratePct }); };
      (svc as unknown as Record<string, unknown>).payAgentToAgentWageInTx = async (
        _tx: unknown,
        o: { amount: number; ratePct: number },
      ) => { paid.push({ who: 'general→agent', amount: o.amount, ratePct: o.ratePct }); };
      (svc as unknown as Record<string, unknown>).reservePlayerRebateInTx = async (
        _tx: unknown,
        o: { amount: number; sitting: string; ratePct: number },
      ) => {
        if (o.amount > 0 && o.sitting !== 'PLATFORM') {
          paid.push({ who: `hold:${o.sitting}`, amount: o.amount, ratePct: o.ratePct });
        }
      };
      return { svc, fly, paid };
    }

    const base = {
      betId: 'bet-1',
      playerId: 'p1',
      validFlow: 100_000,
      flying: true,
      roomId: 'room-1',
      agentUserId: 'agent-1',
      generalUserId: 'general-1',
      sitting: 'PLATFORM' as const,
      gameCode: 'baccarat',
    };

    it('有快照时不查当前比例，按快照发放', async () => {
      /* 下注时 代理 5% / 总代 8%，之后管理端调高到 代理 9% / 总代 12% */
      const { svc, fly, paid } = makeService({ agentPkg: 0.09, generalPkg: 0.12 });
      await svc.payBetFlowInTx({} as never, {
        ...base,
        rateSnapshot: { agentPkg: 0.05, generalPkg: 0.08 },
      });
      expect(fly.resolvePlayerRate).not.toHaveBeenCalled();
      expect(paid).toEqual([
        { who: 'platform→general', amount: 3_000, ratePct: 3 },
        { who: 'platform→agent', amount: 5_000, ratePct: 5 },
      ]);
    });

    it('没有快照（老注单）时才回退到当前比例', async () => {
      const { svc, fly, paid } = makeService({ agentPkg: 0.09, generalPkg: 0.12 });
      await svc.payBetFlowInTx({} as never, { ...base, rateSnapshot: null });
      expect(fly.resolvePlayerRate).toHaveBeenCalledTimes(1);
      expect(paid).toEqual([
        { who: 'platform→general', amount: 3_000, ratePct: 3 },
        { who: 'platform→agent', amount: 9_000, ratePct: 9 },
      ]);
    });

    it('结算前调整比例不会改变已下注单的发放额', async () => {
      const snapshot = { agentPkg: 0.05, generalPkg: 0.08 };
      const before = makeService({ agentPkg: 0.05, generalPkg: 0.08 });
      await before.svc.payBetFlowInTx({} as never, { ...base, rateSnapshot: snapshot });
      /* 比例翻倍后再结同一笔 */
      const after = makeService({ agentPkg: 0.1, generalPkg: 0.16 });
      await after.svc.payBetFlowInTx({} as never, { ...base, rateSnapshot: snapshot });
      expect(after.paid).toEqual(before.paid);
    });

    it('飞盘分头打到总代、代理自己的盘分，玩家点不进代理', async () => {
      const { svc, paid } = makeService({ agentPkg: 0.05, generalPkg: 0.08, P: 0.018 });
      await svc.payBetFlowInTx({} as never, {
        ...base,
        rateSnapshot: { agentPkg: 0.05, generalPkg: 0.08, P: 0.018 },
      });
      expect(paid).toEqual([
        { who: 'platform→general', amount: 3_000, ratePct: 3 },
        { who: 'platform→agent', amount: 3_200, ratePct: 3.2 },
      ]);
    });

    it('总代关盘当场扣代理回水和玩家回水', async () => {
      const { svc, paid } = makeService({ agentPkg: 0.015, generalPkg: 0.025, P: 0.005 });
      await svc.payBetFlowInTx({} as never, {
        ...base,
        flying: false,
        sitting: 'GENERAL',
        validFlow: 3800,
        rateSnapshot: { agentPkg: 0.015, generalPkg: 0.025, P: 0.005 },
      });
      expect(paid).toEqual([
        { who: 'general→agent', amount: 38, ratePct: 1 },
        { who: 'hold:GENERAL', amount: 19, ratePct: 0.5 },
      ]);
    });

    it('直挂房只把 5%−1.8% 打给代理', async () => {
      const { svc, paid } = makeService({ agentPkg: 0.05, generalPkg: 0, P: 0.018 });
      await svc.payBetFlowInTx({} as never, {
        ...base,
        generalUserId: undefined,
        rateSnapshot: { agentPkg: 0.05, generalPkg: 0, P: 0.018 },
      });
      expect(paid).toEqual([
        { who: 'platform→agent', amount: 3_200, ratePct: 3.2 },
      ]);
    });
  });
});
