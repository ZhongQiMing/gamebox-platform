import { splitHouseShare } from './share-split.helper';

describe('splitHouseShare 庄家盈亏三段拆', () => {
  it('未挂总代：成数差为 0，代理应付基数等于平台那份', () => {
    const s = splitHouseShare(10_000, 0.3, null);
    expect(s.agentShareAmount).toBe(3_000);
    expect(s.generalShareAmount).toBe(0);
    expect(s.platformShareAmount).toBe(7_000);
    expect(s.agentPayBase).toBe(7_000);
  });

  it('挂总代：代理 30% / 总代 50%，成数差 2000 归总代，平台拿 5000', () => {
    const s = splitHouseShare(10_000, 0.3, 0.5);
    expect(s.agentShareAmount).toBe(3_000);
    expect(s.generalShareAmount).toBe(2_000);
    expect(s.platformShareAmount).toBe(5_000);
    /* 中间多一层总代，代理照样按自己那一成付 7000，不能少付 */
    expect(s.agentPayBase).toBe(7_000);
  });

  it('三段相加恒等于庄家盈亏', () => {
    for (const [pnl, a, g] of [
      [12_345.67, 0.35, 0.55],
      [-8_888.88, 0.4, 0.6],
      [0.01, 0.33, 0.67],
      [999_999.99, 0.5, 0.7],
    ] as const) {
      const s = splitHouseShare(pnl, a, g);
      const sum = s.agentShareAmount + s.generalShareAmount + s.platformShareAmount;
      expect(Math.abs(sum - Math.round(pnl * 100) / 100)).toBeLessThan(0.01);
    }
  });

  it('玩家赢钱时三方一起分担亏损', () => {
    const s = splitHouseShare(-10_000, 0.3, 0.5);
    expect(s.agentShareAmount).toBe(-3_000);
    expect(s.generalShareAmount).toBe(-2_000);
    expect(s.platformShareAmount).toBe(-5_000);
  });

  it('总代成数被配得比代理还低时按代理算，成数差不会变负', () => {
    const s = splitHouseShare(10_000, 0.6, 0.4);
    expect(s.generalShareAmount).toBe(0);
    expect(s.generalShareRate).toBe(0.6);
    expect(s.agentShareAmount + s.platformShareAmount).toBe(10_000);
  });

  it('成数越界会被夹回 0~1', () => {
    expect(splitHouseShare(10_000, -0.5, null).agentShareAmount).toBe(0);
    expect(splitHouseShare(10_000, 2, null).agentShareAmount).toBe(10_000);
  });

  it('月结房被四次周结分段汇总后，平台那份等于整月一次算的结果', () => {
    const weekly = [3_000, -1_200, 5_500, 2_700];
    const monthly = weekly.reduce((s, x) => s + x, 0);
    const weeklyPlatform = weekly
      .map((w) => splitHouseShare(w, 0.3, 0.5).platformShareAmount)
      .reduce((s, x) => s + x, 0);
    expect(Math.abs(weeklyPlatform - splitHouseShare(monthly, 0.3, 0.5).platformShareAmount))
      .toBeLessThan(0.01);
  });
});
