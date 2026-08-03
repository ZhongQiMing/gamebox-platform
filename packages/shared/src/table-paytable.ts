/**
 * 牌桌赔率单源（服务端结算 + H5 动画预估必须同源）
 *
 * profit-odds：返还 = 本金 + roundMoney(本金 × 利润倍率)
 * stake-mult-commission：返还 = 本金 + roundMoney(本金×(倍数-1)×(1-抽水))（龙虎）
 */

import { roundMoney } from './money';

export type TablePayMode = 'profit-odds' | 'stake-mult-commission';

export interface ProfitOddsPayTable {
  mode: 'profit-odds';
  odds: Record<string, number>;
  /** 开和时退本的边 */
  tieRefundSides?: string[];
  /** 高赔低频边的单注上限（未列出的边用房间 maxBet） */
  sideMaxBet?: Record<string, number>;
}

export interface CommissionMultPayTable {
  mode: 'stake-mult-commission';
  /** 含本金倍数 */
  mult: Record<string, number>;
  commission: number;
  tieRefundSides?: string[];
  sideMaxBet?: Record<string, number>;
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
  },
  douniu: {
    mode: 'profit-odds',
    /**
     * 庄 0.95 抽水、闲 1；牌型副注按市面给定：
     * 小牛 100 / 五花牛 90 / 牛牛 6.84 / 牛7-9 2.98 / 无牛-牛6 1.82。
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
    sideMaxBet: { small: 200, flower: 200, niuniu: 2000 },
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

/** 利润倍率 → 含本返还（两位小数） */
export function payoutFromProfitOdds(amount: number, profitOdds: number): number {
  return roundMoney(amount + roundMoney(amount * profitOdds));
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
