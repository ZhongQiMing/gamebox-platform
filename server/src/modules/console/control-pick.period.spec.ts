import {
  decidePeriodGuard,
  isBetterSoftGlobalPick,
  periodCandidateLegal,
  periodLossPct,
  periodLossScore,
  periodNeedsSteer,
} from './control-pick.util';
import { periodGuardParams } from './control.constants';
import { resolveGearLevel } from './global-soft-control.service';

const normal = periodGuardParams('NORMAL');

/** 定位胆约 9.95 倍：等额覆盖 k 个号，中一个的总派彩 */
function positionCover(k: number, unit: number) {
  return { stake: k * unit, payout: 9.95 * unit };
}

describe('单期总账：基础度量', () => {
  it('periodLossPct：派彩>流水为正亏，派彩=0 为庄家赢满', () => {
    expect(periodLossPct(100, 150)).toBeCloseTo(50);
    expect(periodLossPct(100, 0)).toBeCloseTo(-100);
    expect(periodLossPct(0, 10)).toBe(0);
  });

  it('periodNeedsSteer / periodLossScore', () => {
    expect(periodNeedsSteer({
      periodStake: 100, naturalPayout: 149, triggerLossPct: 50,
    })).toBe(false);
    expect(periodNeedsSteer({
      periodStake: 100, naturalPayout: 151, triggerLossPct: 50,
    })).toBe(true);
    const near = periodLossScore({ periodStake: 100, periodPayout: 130, targetLossPct: 30 });
    const far = periodLossScore({ periodStake: 100, periodPayout: 0, targetLossPct: 30 });
    expect(near).toBeLessThan(far);
  });
});

/**
 * 玩家最担心的场景：买 1~9 漏 0，连着两期都开 0。
 * 覆盖打法的亏损比例天生很低，压根进不了软控。
 */
describe('覆盖打法不进软控（9 盖 1 / 8 盖 2）', () => {
  it.each([
    ['9 盖 1 · 每号 1 元', 9, 1],
    ['9 盖 1 · 每号 1000 元', 9, 1000],
    ['8 盖 2 · 每号 1 元', 8, 1],
    ['8 盖 2 · 每号 5000 元', 8, 5000],
    ['7 盖 3 · 每号 1000 元', 7, 1000],
  ])('%s 不开档', (_label, k, unit) => {
    const { stake, payout } = positionCover(k as number, unit as number);
    const d = decidePeriodGuard({
      periodStake: stake,
      naturalPayout: payout,
      playerCount: 1,
      cycleProfit: 10_000_000,
      params: normal,
    });
    expect(periodLossPct(stake, payout)).toBeLessThan(50);
    expect(d.steer).toBe(false);
  });

  it('覆盖到只剩 4 个号才会开档（6 盖 4 约亏 66%）', () => {
    const { stake, payout } = positionCover(6, 1000);
    expect(periodLossPct(stake, payout)).toBeGreaterThan(50);
    expect(decidePeriodGuard({
      periodStake: stake,
      naturalPayout: payout,
      playerCount: 8,
      cycleProfit: 500_000,
      params: normal,
    }).steer).toBe(true);
  });
});

describe('开档后的金额门', () => {
  const big = { periodStake: 50, naturalPayout: 450_000, playerCount: 8 };

  it('亏损小额：开档但不通杀', () => {
    const d = decidePeriodGuard({
      periodStake: 1000,
      naturalPayout: 3000,
      playerCount: 8,
      cycleProfit: 1_000_000,
      params: normal,
    });
    expect(d.steer).toBe(true);
    expect(d.allowWipeout).toBe(false);
  });

  it('小盘（人少）不通杀', () => {
    const d = decidePeriodGuard({ ...big, cycleProfit: 1_000_000, params: normal });
    expect(d.allowWipeout).toBe(false);
    expect(d.reason).toContain('小盘');
  });

  it('周期已赚够：认赔', () => {
    const d = decidePeriodGuard({
      periodStake: 20_000,
      naturalPayout: 470_000,
      playerCount: 30,
      cycleProfit: 10_000_000,
      params: normal,
    });
    expect(d.steer).toBe(true);
    expect(d.allowWipeout).toBe(false);
    expect(d.reason).toContain('赚够');
  });

  it('周期盈利过薄：不硬追', () => {
    const d = decidePeriodGuard({
      periodStake: 20_000,
      naturalPayout: 470_000,
      playerCount: 30,
      cycleProfit: 3000,
      params: normal,
    });
    expect(d.allowWipeout).toBe(false);
    expect(d.reason).toContain('过薄');
  });

  it('大盘 + 大额 + 周期扛不住：才允许通杀防爆', () => {
    const d = decidePeriodGuard({
      periodStake: 20_000,
      naturalPayout: 470_000,
      playerCount: 30,
      cycleProfit: 200_000,
      params: normal,
    });
    expect(d.allowWipeout).toBe(true);
  });
});

describe('候选过滤', () => {
  const base = decidePeriodGuard({
    periodStake: 20_000,
    naturalPayout: 470_000,
    playerCount: 30,
    cycleProfit: 200_000,
    params: normal,
  });

  it('仍然爆赔的候选一律非法', () => {
    expect(periodCandidateLegal({
      periodStake: 20_000, periodPayout: 400_000, decision: base,
    })).toBe(false);
  });

  it('允许通杀时 0 派彩合法', () => {
    expect(periodCandidateLegal({
      periodStake: 20_000, periodPayout: 0, decision: base,
    })).toBe(true);
  });

  it('不允许通杀时，庄家赢走 80% 以上的候选被挡掉', () => {
    const noWipe = { ...base, allowWipeout: false };
    expect(periodCandidateLegal({
      periodStake: 20_000, periodPayout: 0, decision: noWipe,
    })).toBe(false);
    expect(periodCandidateLegal({
      periodStake: 20_000, periodPayout: 3999, decision: noWipe,
    })).toBe(false);
    /* 留了赢家的候选仍可用 */
    expect(periodCandidateLegal({
      periodStake: 20_000, periodPayout: 12_000, decision: noWipe,
    })).toBe(true);
  });
});

describe('挑号排序：同分优先赢家人数', () => {
  it('单期分接近时选赢家多的', () => {
    const few = { valid: true, day: 0, bias: 0, brake: 0, period: 1000, winners: 1 };
    const many = { valid: true, day: 0, bias: 0, brake: 0, period: 1020, winners: 6 };
    expect(isBetterSoftGlobalPick(many, few, 1, { periodFirst: true })).toBe(true);
  });

  it('单期分差得多时仍以单期分为准', () => {
    const near = { valid: true, day: 0, bias: 0, brake: 0, period: 100, winners: 1 };
    const far = { valid: true, day: 0, bias: 0, brake: 0, period: 9000, winners: 9 };
    expect(isBetterSoftGlobalPick(near, far, 1, { periodFirst: true })).toBe(true);
  });
});

describe('慢性失血档位滞回', () => {
  it('流水不足不进档', () => {
    expect(resolveGearLevel({
      prev: 'NORMAL', cycleR: -40, cycleStake: 1000,
    })).toBe('NORMAL');
  });

  it('亏超 10% 进回收，亏超 25% 进强回收', () => {
    expect(resolveGearLevel({ prev: 'NORMAL', cycleR: -12, cycleStake: 200_000 }))
      .toBe('RECOVER');
    expect(resolveGearLevel({ prev: 'NORMAL', cycleR: -30, cycleStake: 200_000 }))
      .toBe('STRONG');
  });

  it('回到 −5% 以上才退回正常（滞回）', () => {
    expect(resolveGearLevel({ prev: 'RECOVER', cycleR: -7, cycleStake: 200_000 }))
      .toBe('RECOVER');
    expect(resolveGearLevel({ prev: 'RECOVER', cycleR: -2, cycleStake: 200_000 }))
      .toBe('NORMAL');
    expect(resolveGearLevel({ prev: 'STRONG', cycleR: -12, cycleStake: 200_000 }))
      .toBe('STRONG');
  });

  it('回收档把开档线收紧到 30%，强回收到 15%', () => {
    expect(periodGuardParams('RECOVER').openLossPct).toBe(30);
    expect(periodGuardParams('STRONG').openLossPct).toBe(15);
    expect(periodGuardParams('STRONG').targetLossPct).toBe(-10);
  });

  it('回收档下 8 盖 2 仍不开档（约亏 24%）', () => {
    const { stake, payout } = positionCover(8, 1000);
    expect(decidePeriodGuard({
      periodStake: stake,
      naturalPayout: payout,
      playerCount: 1,
      cycleProfit: 0,
      params: periodGuardParams('RECOVER'),
    }).steer).toBe(false);
  });
});
