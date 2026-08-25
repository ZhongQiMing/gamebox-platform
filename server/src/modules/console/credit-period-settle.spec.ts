import {
  cashFlownPayToAgent,
  cashFlownPayToPlatform,
  creditAgentFlyPayToAgent,
  splitAgentFlyingHouse,
  splitHouseShare,
} from './share-split.helper';
import {
  computeCreditBook,
  creditFlownSettlePay,
  creditQuotaRestoreDelta,
  creditRoomPayToPlatform,
  netCreditSettlePay,
} from './credit-settle.helper';

describe('信用盘一期结账（额度加回合同，欠款不冲）', () => {
  it('平台赢：上了 4 万全输，一半一半，佣金 1 万 → 代理付 1 万，充 3 万', () => {
    const house = 40_000;
    const comm = 10_000;
    const s = splitHouseShare(house, 0.5, 0.5);
    expect(s.agentShareAmount).toBe(20_000);
    expect(s.platformShareAmount).toBe(20_000);
    expect(creditFlownSettlePay(house, s.agentShareAmount, comm)).toBe(-10_000);
    expect(creditRoomPayToPlatform(s.platformShareAmount, comm)).toBe(10_000);
    expect(
      creditQuotaRestoreDelta({
        creditLimit: 100_000,
        pointsQuota: 70_000,
        playerBalances: 0,
        csBalances: 0,
      }),
    ).toBe(30_000);
  });

  it('平台输：可飞涨 1 万，占成一半 → 付给代理 5 千，再扣回 1 万', () => {
    const house = -10_000;
    const s = splitHouseShare(house, 0.5, 0.5);
    expect(creditFlownSettlePay(house, s.agentShareAmount, 0)).toBe(5_000);
    expect(creditRoomPayToPlatform(s.platformShareAmount, 0)).toBe(-5_000);
    expect(
      creditQuotaRestoreDelta({
        creditLimit: 100_000,
        pointsQuota: 100_000,
        playerBalances: 10_000,
        csBalances: 0,
      }),
    ).toBe(-10_000);
  });

  it('平台输且佣金已进盘：付占成+佣金，额度扣回合同', () => {
    const house = -10_000;
    const comm = 10_000;
    const s = splitHouseShare(house, 0.5, 0.5);
    expect(creditFlownSettlePay(house, s.agentShareAmount, comm)).toBe(15_000);
    expect(creditRoomPayToPlatform(s.platformShareAmount, comm)).toBe(-15_000);
    expect(
      creditQuotaRestoreDelta({
        creditLimit: 100_000,
        pointsQuota: 110_000,
        playerBalances: 10_000,
        csBalances: 0,
      }),
    ).toBe(-20_000);
  });

  it('111113：飞输 38000、佣金 380、占成 50% → 代理付 18620，充 37620', () => {
    const house = 38_000;
    const comm = 380;
    const s = splitHouseShare(house, 0.5, 0.5);
    expect(creditFlownSettlePay(house, s.agentShareAmount, comm)).toBe(-18_620);
    expect(creditRoomPayToPlatform(s.platformShareAmount, comm)).toBe(18_620);
    expect(
      creditQuotaRestoreDelta({
        creditLimit: 100_000,
        pointsQuota: 40_380,
        playerBalances: 22_000,
        csBalances: 0,
      }),
    ).toBe(37_620);
  });

  it('有成数差：代理上缴平台+总代那截，总表只收平台那份减佣金', () => {
    const house = 40_000;
    const comm = 10_000;
    const s = splitHouseShare(house, 0.3, 0.5);
    expect(creditFlownSettlePay(house, s.agentShareAmount, comm)).toBe(-18_000);
    expect(creditRoomPayToPlatform(s.platformShareAmount, comm)).toBe(10_000);
    /* 总代留成数差 8000：从代理收 18000，上缴平台 10000 */
    expect(roundKeep(18_000 - 10_000)).toBe(s.generalShareAmount);
  });

  it('与飞盘上缴公式一致：上缴 + 佣金 = 房间实付', () => {
    const split = splitAgentFlyingHouse(40_000, 0, 0.5, 0.5);
    expect(netCreditSettlePay(creditAgentFlyPayToAgent(split), 10_000)).toBe(-10_000);
  });

  it('现金总表公式不能被带歪', () => {
    const s = splitHouseShare(40_600, 0.3, 0.5);
    expect(cashFlownPayToPlatform(s.agentShareAmount, s.generalShareAmount)).toBe(-20_300);
  });
});

function roundKeep(n: number) {
  return Math.round(n * 100) / 100;
}

describe('八种盘口：谁跟谁结（飞赢 4 万、占成一半、佣金 1 万）', () => {
  const house = 40_000;
  const comm = 10_000;
  const half = splitHouseShare(house, 0.5, 0.5);
  const withGap = splitHouseShare(house, 0.3, 0.5);

  it('直挂现金房：房间单平台付代理占成，无总表，不加回额度', () => {
    expect(cashFlownPayToAgent(half.agentShareAmount)).toBe(20_000);
  });

  it('直挂信用房：房间单代理付平台（上缴+佣金），额度加回合同，欠平台不冲', () => {
    expect(creditFlownSettlePay(house, half.agentShareAmount, comm)).toBe(-10_000);
    expect(
      creditQuotaRestoreDelta({
        creditLimit: 100_000,
        pointsQuota: 70_000,
        playerBalances: 0,
      }),
    ).toBe(30_000);
  });

  it('现金总代+现金房：总表付给总代占成+成数差，房间单总代付代理占成', () => {
    expect(cashFlownPayToPlatform(withGap.agentShareAmount, withGap.generalShareAmount)).toBe(-20_000);
    expect(cashFlownPayToAgent(withGap.agentShareAmount)).toBe(12_000);
  });

  it('现金总代+信用房：总表向总代收平台占成-佣金，房间单总代向代理收上缴+佣金', () => {
    expect(creditRoomPayToPlatform(half.platformShareAmount, comm)).toBe(10_000);
    expect(creditFlownSettlePay(house, half.agentShareAmount, comm)).toBe(-10_000);
  });

  it('现金总代表不冲名下信用房代理欠款', () => {
    /* 总表只汇总各房 payToPlatform，不减 CreditIssueDebt */
    const cashLeg = cashFlownPayToPlatform(20_300, 0);
    const creditLeg = creditRoomPayToPlatform(19_000, 380);
    expect(roundKeep(cashLeg + creditLeg)).toBe(-20_300 + 18_620);
  });
});

describe('信用总代三条（总表不冲上分，和代理同一口径）', () => {
  const house = 40_000;
  const comm = 10_000;
  const half = splitHouseShare(house, 0.5, 0.5);

  it('房间单：名下现金房/信用房各自仍按房间盘口算', () => {
    expect(cashFlownPayToAgent(half.agentShareAmount)).toBe(20_000);
    expect(creditFlownSettlePay(house, half.agentShareAmount, comm)).toBe(-10_000);
    expect(creditRoomPayToPlatform(half.platformShareAmount, comm)).toBe(10_000);
  });

  it('总表只汇总各房+月费：平台应付 2 万就付 2 万，欠款不进交割', () => {
    const cashLeg = cashFlownPayToPlatform(half.agentShareAmount, half.generalShareAmount);
    expect(cashLeg).toBe(-20_000);
  });

  it('名下现金房+信用房并进总表：各房公式相加，不冲总代欠平台的上分', () => {
    const cashLeg = cashFlownPayToPlatform(half.agentShareAmount, half.generalShareAmount);
    const creditLeg = creditRoomPayToPlatform(half.platformShareAmount, comm);
    expect(roundKeep(cashLeg + creditLeg)).toBe(-10_000);
  });
});

/**
 * 账期按**开奖时间**归期：输赢在开奖那一刻才定，派完彩这一期才算完。
 * 跨点那笔注（23:58 下注、00:03 开奖）落到它开奖的那一期，不会两头落空。
 */
describe('结账归期：按开奖时间，不按下注时间', () => {
  type Bet = { id: string; createdAt: string; settledAt: string | null; amount: number };
  const PERIOD_END = '2026-08-24T00:00:00+08:00';
  const inPeriod = (b: Bet, endIso: string, byDraw: boolean) => {
    const t = byDraw ? b.settledAt : b.createdAt;
    return t != null && new Date(t) < new Date(endIso);
  };

  /* 23:58 下注、00:03 开奖：下注在上一期，开奖在下一期 */
  const crossing: Bet = {
    id: 'crossing',
    createdAt: '2026-08-23T23:58:00+08:00',
    settledAt: '2026-08-24T00:03:00+08:00',
    amount: 1_000,
  };
  /* 23:00 下注、23:10 开奖：整笔都在上一期 */
  const settledInPeriod: Bet = {
    id: 'settled',
    createdAt: '2026-08-23T23:00:00+08:00',
    settledAt: '2026-08-23T23:10:00+08:00',
    amount: 2_000,
  };

  it('按下注时间归期：跨点那笔算进上一期，但结账时它还没开奖 → 被漏掉', () => {
    /* 旧口径：属于上一期，可账单只收已开奖的，于是这 1000 两期都算不到 */
    expect(inPeriod(crossing, PERIOD_END, false)).toBe(true);
    expect(crossing.settledAt! > PERIOD_END).toBe(true);
  });

  it('按开奖时间归期：跨点那笔不属于上一期，自动落到下一期', () => {
    expect(inPeriod(crossing, PERIOD_END, true)).toBe(false);
    /* 下一期（次日 00:00 起）收得到它 */
    const nextPeriodStart = new Date(PERIOD_END);
    expect(new Date(crossing.settledAt!) >= nextPeriodStart).toBe(true);
  });

  it('期内开完的注两种口径都算这一期', () => {
    expect(inPeriod(settledInPeriod, PERIOD_END, false)).toBe(true);
    expect(inPeriod(settledInPeriod, PERIOD_END, true)).toBe(true);
  });

  it('两期相加不重不漏：每笔注恰好落在一期', () => {
    const bets = [crossing, settledInPeriod];
    const prev = bets.filter((b) => inPeriod(b, PERIOD_END, true));
    const next = bets.filter((b) => !inPeriod(b, PERIOD_END, true));
    expect(prev.map((b) => b.id)).toEqual(['settled']);
    expect(next.map((b) => b.id)).toEqual(['crossing']);
    expect(prev.length + next.length).toBe(bets.length);
    expect(
      prev.reduce((s, b) => s + b.amount, 0) + next.reduce((s, b) => s + b.amount, 0),
    ).toBe(3_000);
  });

  it('未开奖的注 settledAt 为空，落不进任何一期，不用拦人也不会丢', () => {
    const flying: Bet = {
      id: 'flying',
      createdAt: '2026-08-23T23:59:00+08:00',
      settledAt: null,
      amount: 500,
    };
    expect(inPeriod(flying, PERIOD_END, true)).toBe(false);
    /* 开奖后补上 settledAt，就进它开奖的那一期 */
    const drawn = { ...flying, settledAt: '2026-08-24T00:05:00+08:00' };
    expect(inPeriod(drawn, PERIOD_END, true)).toBe(false);
    expect(new Date(drawn.settledAt) >= new Date(PERIOD_END)).toBe(true);
  });
});

/**
 * 账期 00:00 自动封账，人第二天才来对账。这中间新一期已经在下注，
 * 实时余额里混着新一期的输赢和已扣本金未派彩的在飞注单。
 * 额度加回必须用封账那一刻的快照，否则等于把下一期的钱结进上一期。
 */
describe('信用盘额度加回：按封账快照，不按结账时的实时余额', () => {
  /* 封账时刻：合同 10 万、代理盘分 40380、玩家持分 22000 */
  const CLOSE = {
    creditLimit: 100_000,
    pointsQuota: 40_380,
    playerBalances: 22_000,
    csBalances: 0,
  };
  const closeBook = computeCreditBook({ ...CLOSE, agentShareRate: 0 });
  /* 结账取的就是这个数：加回额 = −封账超出 */
  const fromSnapshot = roundKeep(-closeBook.excess);

  it('封账那一刻，两种算法等价', () => {
    expect(fromSnapshot).toBe(creditQuotaRestoreDelta(CLOSE));
    expect(fromSnapshot).toBe(37_620);
  });

  it('第二天再结：拿实时余额算，会把新一期玩家输的 5000 结进上一期', () => {
    const live = creditQuotaRestoreDelta({ ...CLOSE, playerBalances: 17_000 });
    expect(roundKeep(live - fromSnapshot)).toBe(5_000);
    expect(fromSnapshot).toBe(37_620);
  });

  it('在飞注单（已扣本金未派彩）同样让实时余额偏低，加回会多算', () => {
    const live = creditQuotaRestoreDelta({ ...CLOSE, playerBalances: 22_000 - 3_000 });
    expect(roundKeep(live - fromSnapshot)).toBe(3_000);
  });

  it('加回额叠加到实时额度，封账后代理自己发出去的分照样留着', () => {
    /* 封账后代理又给玩家发了 1200 */
    const liveQuota = roundKeep(CLOSE.pointsQuota - 1_200);
    expect(roundKeep(liveQuota + fromSnapshot)).toBe(76_800);
    /* 不是补回合同额度，那样这 1200 会被抹掉 */
    expect(roundKeep(liveQuota + fromSnapshot)).not.toBe(CLOSE.creditLimit);
  });
});

