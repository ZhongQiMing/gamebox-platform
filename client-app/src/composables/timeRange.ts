/**
 * 时间筛选：全站唯一一份定义，玩家端与运营端共用。
 * 键名必须与服务端 shanghai-range.ts 一致，改一边就要改另一边。
 */
export const TIME_RANGES = [
  { key: 'today', label: '今 日' },
  { key: 'yesterday', label: '昨 日' },
  { key: 'thisweek', label: '本 周' },
  { key: 'lastweek', label: '上 周' },
  { key: 'thismonth', label: '本 月' },
] as const

export type TimeRangeKey = (typeof TIME_RANGES)[number]['key']

const TZ_OFFSET_MS = 8 * 3600 * 1000
const DAY_MS = 86400000

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`
}

/** 按上海时区格式化日期 YYYY-MM-DD */
export function formatDay(ts: number) {
  const u = new Date(ts + TZ_OFFSET_MS)
  return `${u.getUTCFullYear()}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())}`
}

/**
 * 周一为一周起点；返回 [from, to) 毫秒时间戳（上海自然日，与后端一致）
 */
export function rangeBounds(key: TimeRangeKey, nowMs = Date.now()): [number, number] {
  const sh = new Date(nowMs + TZ_OFFSET_MS)
  const y = sh.getUTCFullYear()
  const m = sh.getUTCMonth()
  const d = sh.getUTCDate()
  const today0 = Date.UTC(y, m, d) - TZ_OFFSET_MS
  const weekday = (new Date(today0 + TZ_OFFSET_MS).getUTCDay() + 6) % 7
  const week0 = today0 - weekday * DAY_MS
  const month0 = Date.UTC(y, m, 1) - TZ_OFFSET_MS
  switch (key) {
    case 'today':
      return [today0, today0 + DAY_MS]
    case 'yesterday':
      return [today0 - DAY_MS, today0]
    case 'thisweek':
      return [week0, week0 + 7 * DAY_MS]
    case 'lastweek':
      return [week0 - 7 * DAY_MS, week0]
    case 'thismonth':
      return [month0, nowMs + DAY_MS]
  }
}

/** 给只收 from/to 的接口用（如客服流水审计） */
export function rangeToIso(key: TimeRangeKey, nowMs = Date.now()) {
  const [from, to] = rangeBounds(key, nowMs)
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

/** 选中时段对应的日期文案：单日只显示一天，跨日显示起止 */
export function formatRangeDateText(key: TimeRangeKey) {
  const [from, to] = rangeBounds(key)
  const endTs = Math.min(to - 1, Date.now())
  const a = formatDay(from)
  const b = formatDay(endTs)
  return a === b ? a : `${a}  ~  ${b}`
}

/** 判断时间戳是否落在当前时段 */
export function isInRange(ts: number | string | Date, key: TimeRangeKey) {
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
  if (!Number.isFinite(t)) return false
  const [from, to] = rangeBounds(key)
  return t >= from && t < to
}
