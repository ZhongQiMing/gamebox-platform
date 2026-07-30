/** 展示格式化（纯函数，多端共用） */

import { formatMoney, roundMoney } from './money';

/** 积分展示（统一两位小数）：88888.5 -> "88,888.50" */
export function formatPoints(n: number): string {
  return formatMoney(n);
}

/** @deprecated 用 formatMoney；保留别名兼容旧调用 */
export function formatPointsInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.floor(roundMoney(n)).toLocaleString('en-US');
}

/** UID 脱敏：123456789 -> "玩家***6789" */
export function maskUid(uid: string, prefix = '玩家'): string {
  if (!uid) return prefix;
  const tail = uid.slice(-4);
  return `${prefix}***${tail}`;
}

/** 比率转百分比文案：0.012 -> "1.2%" */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return '0%';
  return `${(rate * 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`;
}
