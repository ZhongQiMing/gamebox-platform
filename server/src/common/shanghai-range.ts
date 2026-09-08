/**
 * 上海时区日界工具：与前端 timeRange / 回水结算对齐。
 *
 * 这里算出的 Date 是「上海 00:00」对应的 UTC 瞬间。
 * Prisma DateTime 若是 timestamp without time zone，Postgres 会话时区必须是 UTC，
 * 否则比较时会被再加 8 小时，凌晨数据全部记到昨天（见 prisma/pg-utc-timezone.ts）。
 */

export const SHANGHAI_TZ_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 86400000;

export type TimeRangeKey = 'today' | 'yesterday' | 'thisweek' | 'lastweek' | 'thismonth';

export const TIME_RANGE_KEYS: TimeRangeKey[] = [
  'today',
  'yesterday',
  'thisweek',
  'lastweek',
  'thismonth',
];

export function isTimeRangeKey(v: unknown): v is TimeRangeKey {
  return typeof v === 'string' && (TIME_RANGE_KEYS as string[]).includes(v);
}

/** 返回 [from, to) 的 Date，上海自然日 */
export function shanghaiRangeBounds(key: TimeRangeKey, nowMs = Date.now()): [Date, Date] {
  const sh = new Date(nowMs + SHANGHAI_TZ_OFFSET_MS);
  const y = sh.getUTCFullYear();
  const m = sh.getUTCMonth();
  const d = sh.getUTCDate();
  const today0 = Date.UTC(y, m, d) - SHANGHAI_TZ_OFFSET_MS;
  const weekday = (new Date(today0 + SHANGHAI_TZ_OFFSET_MS).getUTCDay() + 6) % 7;
  const week0 = today0 - weekday * DAY_MS;
  const month0 = Date.UTC(y, m, 1) - SHANGHAI_TZ_OFFSET_MS;
  switch (key) {
    case 'today':
      return [new Date(today0), new Date(today0 + DAY_MS)];
    case 'yesterday':
      return [new Date(today0 - DAY_MS), new Date(today0)];
    case 'thisweek':
      return [new Date(week0), new Date(week0 + 7 * DAY_MS)];
    case 'lastweek':
      return [new Date(week0 - 7 * DAY_MS), new Date(week0)];
    case 'thismonth':
      return [new Date(month0), new Date(nowMs + DAY_MS)];
  }
}

/** 解析 range 或 from/to 毫秒，得到 [from, to)；无效则 null */
export function resolveTimeWindow(opts: {
  range?: string;
  fromMs?: number;
  toMs?: number;
  nowMs?: number;
}): [Date, Date] | null {
  if (isTimeRangeKey(opts.range)) {
    return shanghaiRangeBounds(opts.range, opts.nowMs);
  }
  const fromMs = opts.fromMs;
  const toMs = opts.toMs;
  if (
    fromMs != null &&
    toMs != null &&
    Number.isFinite(fromMs) &&
    Number.isFinite(toMs) &&
    toMs > fromMs
  ) {
    return [new Date(fromMs), new Date(toMs)];
  }
  return null;
}
