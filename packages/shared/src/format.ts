/** 展示格式化（纯函数，多端共用） */

import { formatMoney, roundMoney } from './money';

/** 积分展示（统一两位小数）：88888.5 -> "88,888.50" */
export function formatPoints(n: number): string {
  return formatMoney(n);
}

/** 人数、笔数：1,234 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.trunc(n).toLocaleString('en-US');
}

/** @deprecated 用 formatMoney；保留别名兼容旧调用 */
export function formatPointsInt(n: number): string {
  return formatCount(roundMoney(n));
}

/** 操作时间：2026/08/17 04:14:00（本地时区，24 小时） */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
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
