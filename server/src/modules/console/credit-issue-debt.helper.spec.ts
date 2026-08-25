import { creditDebtConsumeAmount } from './credit-issue-debt.helper';
import { cashFlownPayToPlatform } from './share-split.helper';
import { creditRoomPayToPlatform } from './credit-settle.helper';

describe('下分冲欠金额（每周结账不用这套轧占成）', () => {
  it('下分 10 万、已上分 8 万 → 冲掉 8 万', () => {
    expect(creditDebtConsumeAmount(100_000, 80_000)).toBe(80_000);
  });

  it('下分 10 万、已上分 12 万 → 只冲 10 万，剩余 2 万继续挂', () => {
    expect(creditDebtConsumeAmount(100_000, 120_000)).toBe(100_000);
  });

  it('金额为负时不冲欠款', () => {
    expect(creditDebtConsumeAmount(-30_000, 80_000)).toBe(0);
  });

  it('没有欠款时不冲', () => {
    expect(creditDebtConsumeAmount(19_000, 0)).toBe(0);
  });
});

describe('总表不冲平台给总代的上分', () => {
  it('现金房总表公式仍是 −(代理占成+成数差)', () => {
    expect(cashFlownPayToPlatform(19_000, 0)).toBe(-19_000);
  });

  it('现金房+信用房并进总表：各房公式相加，不减总代欠款', () => {
    const cashLeg = cashFlownPayToPlatform(20_000, 0);
    const creditLeg = creditRoomPayToPlatform(20_000, 10_000);
    expect(cashLeg + creditLeg).toBe(-10_000);
  });
});
