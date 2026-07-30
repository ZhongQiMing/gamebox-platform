/** 金额：全平台统一保留两位小数（存库 / 计算 / 展示一致，不用「分」换算） */

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
