/** 金额：全平台统一保留两位小数（存库 / 计算 / 展示一致，不用「分」换算） */

/** 玩家上分/下分（控制台直接操作 + 申请审核）单笔限额 */
export const PLAYER_UP_MIN = 200;
export const PLAYER_DOWN_MIN = 500;
export const PLAYER_FUND_MAX = 200_000;

/**
 * 高赔率玩法的单注上限。
 *
 * 六合彩四全中 9000 倍这类玩法，按通用限红 10 万下注，中一次要赔 9 亿，
 * 撞上 2000 万绝对封顶后玩家也拿不到挂牌赔率——两头不讨好。
 * 软控帮不上忙：这种单人冷门注不论开不开都会越过单期上下限，
 * 候选全非法直接回退自然开奖。所以只能在下注口子上限住。
 */
export const HIGH_ODDS_THRESHOLD = 500;
export const HIGH_ODDS_MAX_BET = 50;

/**
 * 该赔率对应的单注上限；不受限返回 null。
 * 赔率不是有限数说明赔率表写坏了，此时按限住处理——宁可拦下也不能放它不限额。
 */
export function highOddsBetCap(multiplier: number): number | null {
  if (typeof multiplier !== 'number' || Number.isNaN(multiplier)) return null;
  if (!Number.isFinite(multiplier)) return HIGH_ODDS_MAX_BET;
  return multiplier > HIGH_ODDS_THRESHOLD ? HIGH_ODDS_MAX_BET : null;
}

/** 四舍五入到分（两位小数） */
export function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** 展示：88,888.50 */
export function formatMoney(n: number): string {
  return roundMoney(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Prisma Decimal / 字符串金额 → number */
export function asMoney(v: unknown): number {
  if (typeof v === 'number') return roundMoney(v);
  if (typeof v === 'string' && v.trim() !== '') return roundMoney(Number(v));
  if (v && typeof v === 'object' && 'toNumber' in v && typeof (v as { toNumber: () => number }).toNumber === 'function') {
    return roundMoney((v as { toNumber: () => number }).toNumber());
  }
  return 0;
}
