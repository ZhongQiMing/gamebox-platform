/**
 * 牌桌赔率单源（服务端结算 + H5 动画预估必须同源）
 *
 * profit-odds：返还 = 本金 + roundMoney(本金 × 利润倍率)
 * stake-mult-commission：返还 = 本金 + roundMoney(本金×(倍数-1)×(1-抽水))（龙虎）
 */

import { roundMoney } from './money';

export type TablePayMode = 'profit-odds' | 'stake-mult-commission';

/**
 * 某个方向的单局累计上限。
 *
 * 通用限红只管「押了多少」，不看「可能赔多少」：同样押满全桌 200 万，
 * 百家乐闲家最坏赔 400 万，顺金 100 倍最坏赔 2 亿，差 50 倍。
 * 单注上限（sideMaxBet）挡得住一个人，挡不住一桌几千人各押 500 凑到 200 万。
 *
 * 只给赔率特别高（超过 HIGH_ODDS_SIDE_THRESHOLD 倍）的方向设这个，
 * 常规方向一律用 TABLE_RISK 默认值。这几个方向限住之后软控也省事：
 * 它只要挑一副赢家不在这几个方向上的牌，而绝大多数牌本来就不是。
 */
export interface SideRoundCap {
  /** 单个玩家本局在该方向的累计上限 */
  user: number;
  /** 全桌本局在该方向的累计上限 */
  table: number;
}

/** 赔率超过这个倍数的方向才需要单独设累计限红 */
export const HIGH_ODDS_SIDE_THRESHOLD = 50;

export interface ProfitOddsPayTable {
  mode: 'profit-odds';
  odds: Record<string, number>;
  /** 开和时退本的边 */
  tieRefundSides?: string[];
  /**
   * 这些边的 odds 是含本总赔率（押 1 共拿回 odds），其余边按净赔率结算。
   * 市面盘口两种口径混用，照抄时必须逐项标注，否则少算/多算一份本金。
   */
  totalOddsSides?: string[];
  /** 高赔低频边的单注上限（未列出的边用房间 maxBet） */
  sideMaxBet?: Record<string, number>;
  /** 高赔低频边的单局累计上限；未列出的边用 TABLE_RISK 默认值 */
  sideRoundCap?: Record<string, SideRoundCap>;
}

export interface CommissionMultPayTable {
  mode: 'stake-mult-commission';
  /** 含本金倍数 */
  mult: Record<string, number>;
  commission: number;
  tieRefundSides?: string[];
  sideMaxBet?: Record<string, number>;
  sideRoundCap?: Record<string, SideRoundCap>;
}

export type TablePayTable = ProfitOddsPayTable | CommissionMultPayTable;

export const TABLE_PAYTABLE: Record<string, TablePayTable> = {
  baccarat: {
    mode: 'profit-odds',
    odds: { banker: 0.95, player: 1, tie: 8, bankerPair: 11, playerPair: 11 },
    tieRefundSides: ['banker', 'player'],
  },
  zhajinhua: {
    mode: 'profit-odds',
    /**
     * 牌型副注只认赢方牌型；点数相同比花色，无和局/和注。
     * 牌型赔率对齐 OG Plus「New Three Cards / 龙凤炸金花」市面口径：
     * 顺子 7 / 金花 8 / 顺金 100 / 豹子 120；庄 0.95 抽水、闲 1。
     * （单手出现率：金花>顺子，但赢方口径下顺子更稀；正版仍把金花赔更高。）
     */
    odds: {
      banker: 0.95,
      player: 1,
      shunjin: 100,
      baozi: 120,
      san2: 0.75,
      san3: 2,
      san6: 7,
      san7: 8,
    },
    sideMaxBet: { shunjin: 500, baozi: 500 },
    /*
     * 顺金 100 倍、豹子 120 倍：全桌押满 10 万最坏赔 1000~1200 万。
     * 其余方向（庄 0.95 / 闲 1 / 对子 2 / 顺子 7 / 金花 8）都在几十倍以内，不设。
     */
    sideRoundCap: {
      shunjin: { user: 10_000, table: 100_000 },
      baozi: { user: 10_000, table: 100_000 },
    },
  },
  douniu: {
    mode: 'profit-odds',
    /**
     * 庄 0.95 抽水、闲 1；牌型副注按市面给定：
     * 小牛 100 / 五花牛 90 / 牛牛 6.84 / 牛7-9 2.98 / 无牛-牛6 1.82。
     *
     * 牛牛 / 牛7-9 / 无牛-牛6 三项盘口报的是含本总赔率（6.84 ≈ 0.96÷命中率），
     * 当净赔率结算会多送一份本金，RTP 从 96% 弹到 110%~151%。
     */
    odds: {
      banker: 0.95,
      player: 1,
      small: 100,
      niuniu: 6.84,
      niu79: 2.98,
      niu06: 1.82,
      flower: 90,
    },
    totalOddsSides: ['niuniu', 'niu79', 'niu06'],
    sideMaxBet: { small: 200, flower: 200, niuniu: 2000 },
    /*
     * 小牛 100 倍、花牛 90 倍：全桌押满 10 万最坏赔 900~1000 万。
     * 牛牛 6.84（含本，净 5.84）与牛7-9、无牛-牛6 都在几十倍以内，不设。
     */
    sideRoundCap: {
      small: { user: 10_000, table: 100_000 },
      flower: { user: 10_000, table: 100_000 },
    },
  },
  'dragon-tiger': {
    mode: 'profit-odds',
    /** 龙 0.95 抽水、虎 1、和 8；开和时龙/虎全退 */
    odds: {
      dragon: 0.95,
      tiger: 1,
      tie: 8,
      DRAGON: 0.95,
      TIGER: 1,
      TIE: 8,
    },
    tieRefundSides: ['dragon', 'tiger', 'DRAGON', 'TIGER'],
    sideMaxBet: { tie: 5000, TIE: 5000 },
  },
};

export function normalizeTableGameCode(code: string): string {
  if (code === 'longhu') return 'dragon-tiger';
  return code;
}

export function getTablePayTable(gameCode: string): TablePayTable | null {
  return TABLE_PAYTABLE[normalizeTableGameCode(gameCode)] ?? null;
}

/**
 * 该边的单注上限；无专属限红时返回 fallback。
 * 千倍赔率的边必须限红，否则单注就能击穿平台池。
 */
export function tableSideMaxBet(gameCode: string, side: string, fallback: number): number {
  const pt = getTablePayTable(gameCode);
  const cap = pt?.sideMaxBet?.[side];
  return typeof cap === 'number' && cap > 0 ? Math.min(cap, fallback) : fallback;
}

/**
 * 该方向的单局累计上限（单人 / 全桌）。没有专属限红的方向返回传入的默认值。
 *
 * 取更严的那个：专属限红只用来「往下拉」，不能因为它比默认值大而反过来放宽。
 */
export function tableSideRoundCap(
  gameCode: string,
  side: string,
  fallback: SideRoundCap,
): SideRoundCap {
  const pt = getTablePayTable(gameCode);
  const cap = pt?.sideRoundCap?.[side];
  if (!cap) return fallback;
  return {
    user: Math.min(cap.user, fallback.user),
    table: Math.min(cap.table, fallback.table),
  };
}

/** 利润倍率 → 含本返还（两位小数） */
export function payoutFromProfitOdds(amount: number, profitOdds: number): number {
  return roundMoney(amount + roundMoney(amount * profitOdds));
}

/** 含本总赔率 → 返还（两位小数） */
export function payoutFromTotalOdds(amount: number, totalOdds: number): number {
  return roundMoney(amount * totalOdds);
}

/** 该边中奖时的含本返还；边不存在返回 0。赔率口径由赔率表决定，调用方不必关心 */
export function payoutForTableSide(gameCode: string, side: string, amount: number): number {
  const pt = getTablePayTable(gameCode);
  if (!pt) return 0;
  if (pt.mode === 'stake-mult-commission') {
    const mult = pt.mult[side];
    return typeof mult === 'number'
      ? payoutFromStakeMultCommission(amount, mult, pt.commission)
      : 0;
  }
  const odds = pt.odds[side];
  if (typeof odds !== 'number') return 0;
  return pt.totalOddsSides?.includes(side)
    ? payoutFromTotalOdds(amount, odds)
    : payoutFromProfitOdds(amount, odds);
}

/** 龙虎：含本倍数 + 赢利抽水 */
export function payoutFromStakeMultCommission(
  amount: number,
  stakeMult: number,
  commission: number,
): number {
  const grossProfit = amount * (stakeMult - 1);
  return roundMoney(amount + roundMoney(grossProfit * (1 - commission)));
}
