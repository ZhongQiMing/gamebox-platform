/**
 * 信用盘结账分账口径。
 *
 * 这里算错的直接后果是平台与代理之间多付/少付真钱，而且每周结一次、
 * 错了要往前追一整周的账，所以四种局面（平台亏/平台赚/持平/超发）都钉住。
 */
import { agentDisplayBalance, agentWorkingDisk, clampShareRate, computeCreditBook } from './credit-settle.helper';
import { creditDiskMerge } from './player-fund.helper';

describe('clampShareRate', () => {
  it('夹在 0~1', () => {
    expect(clampShareRate(-0.5)).toBe(0);
    expect(clampShareRate(1.5)).toBe(1);
    expect(clampShareRate(0.3)).toBe(0.3);
  });

  it('非有限数按 0 占成，不会让代理白拿', () => {
    expect(clampShareRate(NaN)).toBe(0);
    expect(clampShareRate(Infinity)).toBe(0);
    expect(clampShareRate(-Infinity)).toBe(0);
  });
});

describe('computeCreditBook', () => {
  const base = {
    creditLimit: 100_000,
    pointsQuota: 60_000,
    playerBalances: 30_000,
    csBalances: 10_000,
    agentShareRate: 0,
  };

  it('合计=剩余信用+玩家余额+客服额度；打平时不找补', () => {
    const b = computeCreditBook(base);
    expect(b.sum).toBe(100_000);
    expect(b.excess).toBe(0);
    expect(b.housePnl).toBe(0);
    expect(b.platformPayToAgent).toBe(0);
  });

  it('玩家赢钱（合计超合同）→ 平台亏，按 1−占成 补给代理', () => {
    const b = computeCreditBook({ ...base, playerBalances: 45_000 });
    expect(b.sum).toBe(115_000);
    expect(b.excess).toBe(15_000);
    expect(b.housePnl).toBe(-15_000);
    expect(b.platformPayToAgent).toBe(15_000);
  });

  it('玩家输钱（合计不足合同）→ 平台赚，代理上缴（应付为负）', () => {
    const b = computeCreditBook({ ...base, playerBalances: 10_000 });
    expect(b.sum).toBe(80_000);
    expect(b.excess).toBe(-20_000);
    expect(b.housePnl).toBe(20_000);
    expect(b.platformPayToAgent).toBe(-20_000);
  });

  it('占成三七开：代理拿 30%，平台留 70%，两者相加等于庄家盈亏', () => {
    const b = computeCreditBook({ ...base, playerBalances: 10_000, agentShareRate: 0.3 });
    expect(b.housePnl).toBe(20_000);
    expect(b.agentShareAmount).toBe(6_000);
    expect(b.platformShareAmount).toBe(14_000);
    expect(b.agentShareAmount + b.platformShareAmount).toBe(b.housePnl);
    expect(b.platformPayToAgent).toBe(-14_000);
  });

  it('客服额度必须计入合计——不计的话一划额合计就假跌，平台白赔', () => {
    const withCs = computeCreditBook({ ...base, csBalances: 10_000 });
    const withoutCs = computeCreditBook({ ...base, csBalances: 0 });
    expect(withCs.sum - withoutCs.sum).toBe(10_000);
    expect(withoutCs.excess).toBe(-10_000);
  });

  it('结后剩余信用 = 合同 − 玩家 − 客服，超发时为负', () => {
    expect(computeCreditBook(base).newQuota).toBe(60_000);
    const over = computeCreditBook({ ...base, playerBalances: 120_000 });
    expect(over.newQuota).toBe(-30_000);
  });

  it('负的输入被夹到 0，剩余信用可负（超分是合法状态）', () => {
    const b = computeCreditBook({
      creditLimit: -5,
      pointsQuota: -2_000,
      playerBalances: -100,
      csBalances: -50,
      agentShareRate: 0.5,
    });
    expect(b.creditLimit).toBe(0);
    expect(b.playerBalances).toBe(0);
    expect(b.csBalances).toBe(0);
    expect(b.pointsQuota).toBe(-2_000);
    expect(b.sum).toBe(-2_000);
  });

  it('占成分账不产生分以下的碎屑', () => {
    const b = computeCreditBook({
      creditLimit: 10_000,
      pointsQuota: 3_333.33,
      playerBalances: 3_333.33,
      csBalances: 0,
      agentShareRate: 0.33,
    });
    expect(b.housePnl).toBe(3_333.34);
    expect(b.agentShareAmount).toBe(1_100.0);
    expect(b.platformShareAmount).toBe(2_233.34);
    expect(b.agentShareAmount + b.platformShareAmount).toBe(b.housePnl);
  });
});

describe('两盘同一本盘分', () => {
  it('代理余额就是余额，不再把额度和佣金袋相加', () => {
    expect(agentDisplayBalance({ bookMode: 'CREDIT', balance: 200, pointsQuota: -80 })).toBe(200);
    expect(agentDisplayBalance({ bookMode: 'CASH', balance: 50, pointsQuota: 50 })).toBe(50);
  });

  it('未并账时取更紧的一侧，避免佣金袋和剩余信用加两遍', () => {
    expect(agentWorkingDisk(100, 5)).toBe(5);
    expect(agentWorkingDisk(-80, -60)).toBe(-80);
  });

  it('并账：额度吸收佣金、余额补上剩余信用，两边落到同一个数', () => {
    const zongdai = creditDiskMerge(2_616_818, -204_663.15);
    expect(zongdai.alreadySynced).toBe(false);
    expect(zongdai.merged).toBe(2_412_154.85);
    expect(zongdai.quota + zongdai.quotaDelta).toBe(zongdai.merged);
    expect(zongdai.balance + zongdai.balanceDelta).toBe(zongdai.merged);

    const agent = creditDiskMerge(-864_386.04, 204_663.15);
    expect(agent.merged).toBe(-659_722.89);
    expect(agent.quota + agent.quotaDelta).toBe(agent.merged);
    expect(agent.balance + agent.balanceDelta).toBe(agent.merged);
  });

  it('已经同步的不改（余额=额度就是一本盘分，不能再相加）', () => {
    expect(creditDiskMerge(100, 100).alreadySynced).toBe(true);
    expect(creditDiskMerge(0, 0).alreadySynced).toBe(true);
  });
});
