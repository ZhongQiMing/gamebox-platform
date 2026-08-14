import { computeCreditBook } from './credit-settle.helper';

/**
 * 封账与实际对接之间隔了几小时，中间还在上下分、还在输赢。
 * 账单金额必须锁在封账那一刻，补额度则按「当前剩余 − 封账超出」，
 * 这样那几小时的输赢会自动留到下一期，而不是被抹掉或重复算一次。
 */
describe('信用盘封账快照与补额度', () => {
  const CONTRACT = 100_000;

  it('封账时用掉 3 万，账单就锁 3 万', () => {
    const atClose = computeCreditBook({
      creditLimit: CONTRACT,
      pointsQuota: 70_000,
      playerBalances: 0,
      csBalances: 0,
      agentShareRate: 0,
    });
    expect(atClose.excess).toBe(-30_000);
    /* 庄家视角为正：这一期代理赢了 3 万 */
    expect(atClose.housePnl).toBe(30_000);
  });

  it('封账后又上分又输赢，补额度按「当前剩余 − 封账超出」，差额留到下期', () => {
    const atClose = computeCreditBook({
      creditLimit: CONTRACT,
      pointsQuota: 70_000,
      playerBalances: 0,
      csBalances: 0,
      agentShareRate: 0,
    });

    /* 早上对接时：期间又给玩家上了 5 千，玩家输回 2 千 */
    const quotaNow = 65_000;
    const playerNow = 3_000;

    const quotaAfterSettle = Math.round((quotaNow - atClose.excess) * 100) / 100;
    expect(quotaAfterSettle).toBe(95_000);

    /* 下一期起算：只剩封账之后那 2 千的盈亏 */
    const nextPeriod = computeCreditBook({
      creditLimit: CONTRACT,
      pointsQuota: quotaAfterSettle,
      playerBalances: playerNow,
      csBalances: 0,
      agentShareRate: 0,
    });
    expect(nextPeriod.excess).toBe(-2_000);
    expect(nextPeriod.housePnl).toBe(2_000);
  });

  it('封账即对接（没有时间差）时，与补回合同额度的老口径完全一致', () => {
    const book = computeCreditBook({
      creditLimit: CONTRACT,
      pointsQuota: 70_000,
      playerBalances: 12_000,
      csBalances: 3_000,
      agentShareRate: 0,
    });
    const byNewFormula = Math.round((book.pointsQuota - book.excess) * 100) / 100;
    expect(byNewFormula).toBe(book.newQuota);
  });

  it('两期加起来等于整段一次算的结果，中间那段不会漏也不会重复', () => {
    const first = computeCreditBook({
      creditLimit: CONTRACT,
      pointsQuota: 70_000,
      playerBalances: 0,
      csBalances: 0,
      agentShareRate: 0,
    });
    const quotaAfter = first.pointsQuota - first.excess;
    const second = computeCreditBook({
      creditLimit: CONTRACT,
      pointsQuota: quotaAfter - 5_000,
      playerBalances: 3_000,
      csBalances: 0,
      agentShareRate: 0,
    });
    /* 一次算到底：从 10 万合同直接看最终状态 */
    const oneShot = computeCreditBook({
      creditLimit: CONTRACT,
      pointsQuota: 65_000,
      playerBalances: 3_000,
      csBalances: 0,
      agentShareRate: 0,
    });
    expect(first.housePnl + second.housePnl).toBe(oneShot.housePnl);
  });
});
