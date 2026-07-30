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
     * 牌型副注只认赢方牌型（和局时任一方），赢方天然偏大牌，
     * 因此命中率与「单手出现该牌型」完全不同，必须按赢方分布标定：
     * 散牌 55.6% / 对子 27.8% / 顺子 6.1% / 金花 9.6% / 顺金 0.42% / 豹子 0.49% / 和 0.11%
     */
    odds: {
      banker: 0.95,
      player: 0.95,
      tie: 860,
      shunjin: 218,
      baozi: 200,
      san2: 0.72,
      san3: 2.45,
      san6: 14.7,
      san7: 8.95,
    },
    tieRefundSides: ['banker', 'player'],
    sideMaxBet: { tie: 200, shunjin: 500, baozi: 500 },
  },
  douniu: {
    mode: 'profit-odds',
    /**
     * 同为赢方牌型口径：牛牛 14.0% / 牛7-9 32.4% / 无牛-牛6 53.3%；
     * 五小牛与五花牛作为赢方仅约 0.09%，低赔会让这两格形同虚设。
     */
    odds: {
      banker: 0.95,
      player: 0.95,
      small: 1000,
      niuniu: 5.8,
      niu79: 1.96,
      niu06: 0.8,
      flower: 1150,
    },
    sideMaxBet: { small: 200, flower: 200, niuniu: 2000 },
  },
  'dragon-tiger': {
    mode: 'stake-mult-commission',
    /* 开和时龙/虎全退，和局本身没有平台优势来源，倍数需按 5.88% 命中率标定 */
    mult: { dragon: 2, tiger: 2, tie: 17, DRAGON: 2, TIGER: 2, TIE: 17 },
    commission: 0.05,
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
