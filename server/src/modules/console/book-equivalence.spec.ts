/**
 * 现金盘与信用盘只差「额度的钱有没有先给平台」：
 * 现金是先付后用，信用是先用后付。一个账期走完，代理落到手的净额必须一样。
 *
 * 两边结账公式长得不同（现金按飞盘盈亏拆占成，信用按额度池超出轧差），
 * 差的那一截正好是代理当初预付的额度钱。这里把两条路一起算完对平，
 * 任何一边被改歪都会在这里断。
 */
import { computeCreditBook } from './credit-settle.helper';
import { cashFlownPayToAgent, splitHouseShare } from './share-split.helper';

const LIMIT = 100_000;
const AGENT_SHARE = 0.3;

type Scenario = {
  /** 玩家买分交给代理的现金（上分） */
  cashIn: number;
  /** 代理买回玩家分付出的现金（下分） */
  cashOut: number;
  /** 玩家手上还没下掉的分 */
  playerPoints: number;
};

/** 剩余盘分 / 剩余信用 = 合同额度 − 已上分 + 已下分 */
function quotaLeft(s: Scenario) {
  return LIMIT - s.cashIn + s.cashOut;
}

/** 飞盘庄家盈亏 = 发出去的分 − 买回的分 − 玩家还捏着的分 */
function flownHousePnl(s: Scenario) {
  return s.cashIn - s.cashOut - s.playerPoints;
}

/**
 * 现金盘代理净额：额度先付过钱，所以要减掉合同额度、加回手里剩的盘分。
 * 结账只收付占成那一份。
 */
function cashAgentNet(s: Scenario) {
  const split = splitHouseShare(flownHousePnl(s), AGENT_SHARE, null);
  const settlePay = cashFlownPayToAgent(split.agentShareAmount);
  return -LIMIT + s.cashIn - s.cashOut + settlePay + quotaLeft(s);
}

/**
 * 信用盘代理净额：额度没付过钱，不计入身家。
 * 结账按额度池超出轧差，并把额度校准回「合同 − 玩家持分」。
 */
function creditAgentNet(s: Scenario) {
  const book = computeCreditBook({
    creditLimit: LIMIT,
    pointsQuota: quotaLeft(s),
    playerBalances: s.playerPoints,
    agentShareRate: AGENT_SHARE,
  });
  const quotaAfterSettle = quotaLeft(s) - book.excess;
  return s.cashIn - s.cashOut + book.platformPayToAgent + (quotaAfterSettle - LIMIT);
}

function creditBookOf(s: Scenario) {
  return computeCreditBook({
    creditLimit: LIMIT,
    pointsQuota: quotaLeft(s),
    playerBalances: s.playerPoints,
    agentShareRate: AGENT_SHARE,
  });
}

describe('现金盘与信用盘同一场景下代理净额相同', () => {
  it('玩家买 1 万全输光：两边代理都净赚自己那 30%', () => {
    const s: Scenario = { cashIn: 10_000, cashOut: 0, playerPoints: 0 };
    /* 平台赢 1 万：现金是平台付代理 3000，信用是代理付平台 7000 */
    expect(cashAgentNet(s)).toBe(3_000);
    expect(creditAgentNet(s)).toBe(3_000);
  });

  it('玩家买 1 万赢 1 万并全部下分：两边代理都只担自己那 30%', () => {
    const s: Scenario = { cashIn: 10_000, cashOut: 20_000, playerPoints: 0 };
    expect(cashAgentNet(s)).toBe(-3_000);
    expect(creditAgentNet(s)).toBe(-3_000);
  });

  it('玩家赢了还没下分：分还在玩家手上也不影响两边净额', () => {
    const s: Scenario = { cashIn: 10_000, cashOut: 0, playerPoints: 20_000 };
    expect(cashAgentNet(s)).toBe(-3_000);
    expect(creditAgentNet(s)).toBe(-3_000);
  });

  it('没人下注：两边都互不找补', () => {
    const s: Scenario = { cashIn: 10_000, cashOut: 0, playerPoints: 10_000 };
    expect(cashAgentNet(s)).toBe(0);
    expect(creditAgentNet(s)).toBe(0);
  });

  it('各种上下分组合下两边恒等，且都等于代理该拿的占成', () => {
    const cases: Scenario[] = [
      { cashIn: 50_000, cashOut: 12_000, playerPoints: 8_000 },
      { cashIn: 80_000, cashOut: 95_000, playerPoints: 5_000 },
      { cashIn: 33_333, cashOut: 11_111, playerPoints: 4_444 },
      { cashIn: 100_000, cashOut: 0, playerPoints: 0 },
      { cashIn: 0, cashOut: 0, playerPoints: 0 },
    ];
    for (const s of cases) {
      const expected = splitHouseShare(flownHousePnl(s), AGENT_SHARE, null).agentShareAmount;
      expect(cashAgentNet(s)).toBeCloseTo(expected, 2);
      expect(creditAgentNet(s)).toBeCloseTo(expected, 2);
    }
  });
});

describe('信用盘额度池超出等价于飞盘庄家盈亏', () => {
  it('超出取负就是庄家盈亏，说明关盘不进这本账', () => {
    const cases: Scenario[] = [
      { cashIn: 10_000, cashOut: 0, playerPoints: 0 },
      { cashIn: 10_000, cashOut: 20_000, playerPoints: 0 },
      { cashIn: 60_000, cashOut: 15_000, playerPoints: 20_000 },
    ];
    for (const s of cases) {
      expect(creditBookOf(s).housePnl).toBeCloseTo(flownHousePnl(s), 2);
    }
  });

  it('结账后额度校准回「合同 − 玩家持分」，玩家没下的分不会被抹掉', () => {
    const s: Scenario = { cashIn: 30_000, cashOut: 0, playerPoints: 12_000 };
    const book = creditBookOf(s);
    expect(book.newQuota).toBe(LIMIT - 12_000);
    expect(quotaLeft(s) - book.excess).toBe(book.newQuota);
  });
});
