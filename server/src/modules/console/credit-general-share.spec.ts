import { computeCreditBook } from './credit-settle.helper';
import { splitHouseShare } from './share-split.helper';

/**
 * 信用盘挂总代时的三方分账。
 *
 * 口径以《结账对账单模板》为准：
 *   超出 = 剩余额度 + 玩家余额 + 客服额度 − 合同额度，取负即庄家盈亏
 *   总代成数差 = 庄家盈亏 ×（总代成数 − 代理成数）
 *   平台那份 = 庄家盈亏 − 代理占成 − 总代成数差
 *
 * 之前信用盘固定把成数差算成 0，总代那一份一直留在平台。
 */
describe('信用盘挂总代的成数差', () => {
  /** 合同 100 万、剩余额度 40 万、玩家持分 0、客服 0 → 超出 −60 万 → 庄家盈亏 +60 万 */
  const book = (agentShareRate: number, generalShareRate?: number | null) =>
    computeCreditBook({
      creditLimit: 1_000_000,
      pointsQuota: 400_000,
      playerBalances: 0,
      csBalances: 0,
      agentShareRate,
      generalShareRate,
    });

  it('庄家盈亏仍按信用账本超出轧差', () => {
    const b = book(0.3, 0.5);
    expect(b.excess).toBe(-600_000);
    expect(b.housePnl).toBe(600_000);
  });

  it('总代成数差 = 庄家盈亏 ×（总代成数 − 代理成数）', () => {
    const b = book(0.3, 0.5);
    expect(b.agentShareAmount).toBe(180_000); // 60万 × 30%
    expect(b.generalShareAmount).toBe(120_000); // 60万 ×（50%−30%）
    expect(b.platformShareAmount).toBe(300_000); // 余下
  });

  it('三方合计必须等于庄家盈亏', () => {
    for (const [a, g] of [[0.3, 0.5], [0.5, 0.5], [0, 0.7], [0.45, 0.6]] as const) {
      const b = book(a, g);
      expect(b.agentShareAmount + b.generalShareAmount + b.platformShareAmount).toBeCloseTo(
        b.housePnl,
        2,
      );
    }
  });

  it('代理的交割额不受总代成数影响', () => {
    /* 同一个代理成数，挂不挂总代、总代几成，代理该缴的都一样 */
    const noGeneral = book(0.3, null);
    const g50 = book(0.3, 0.5);
    const g70 = book(0.3, 0.7);
    expect(g50.platformPayToAgent).toBe(noGeneral.platformPayToAgent);
    expect(g70.platformPayToAgent).toBe(noGeneral.platformPayToAgent);
    /* 庄家赢 60 万、代理占三成 → 代理应上缴 42 万 */
    expect(noGeneral.platformPayToAgent).toBe(-420_000);
  });

  it('不挂总代时成数差为 0，行为与改动前一致', () => {
    const b = book(0.3, null);
    expect(b.generalShareAmount).toBe(0);
    expect(b.generalShareRate).toBe(0.3);
    expect(b.platformShareAmount).toBe(420_000);
  });

  it('总代成数被设得低于代理时按代理成数兜住，不让总代倒贴', () => {
    const b = book(0.5, 0.3);
    expect(b.generalShareAmount).toBe(0);
    expect(b.generalShareRate).toBe(0.5);
  });

  it('庄家亏损时三方按同一比例分担', () => {
    /* 剩余额度 130 万 > 合同 100 万 → 超出 +30 万 → 庄家亏 30 万 */
    const b = computeCreditBook({
      creditLimit: 1_000_000,
      pointsQuota: 1_300_000,
      playerBalances: 0,
      csBalances: 0,
      agentShareRate: 0.3,
      generalShareRate: 0.5,
    });
    expect(b.housePnl).toBe(-300_000);
    expect(b.agentShareAmount).toBe(-90_000);
    expect(b.generalShareAmount).toBe(-60_000);
    expect(b.platformShareAmount).toBe(-150_000);
    /* 亏损时平台补给代理 */
    expect(b.platformPayToAgent).toBe(210_000);
  });

  it('与现金盘用同一套成数公式，只是盈亏基准不同', () => {
    const b = book(0.3, 0.5);
    const cash = splitHouseShare(b.housePnl, 0.3, 0.5);
    expect(b.agentShareAmount).toBe(cash.agentShareAmount);
    expect(b.generalShareAmount).toBe(cash.generalShareAmount);
    expect(b.platformShareAmount).toBe(cash.platformShareAmount);
  });
});
