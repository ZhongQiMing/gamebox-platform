export const TIME_RANGES = [
  { key: 'today', label: '今 日' },
  { key: 'yesterday', label: '昨 日' },
  { key: 'thisweek', label: '本 周' },
  { key: 'lastweek', label: '上 周' },
  { key: 'thismonth', label: '本 月' },
] as const

export type TimeRangeKey = (typeof TIME_RANGES)[number]['key']

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`
}

export function formatDay(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 周一为一周起点；返回 [from, to) 毫秒时间戳 */
export function rangeBounds(key: TimeRangeKey): [number, number] {
  const now = new Date()
  const DAY = 86400000
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const weekday = (now.getDay() + 6) % 7
  const week0 = today0 - weekday * DAY
  const month0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  switch (key) {
    case 'today':
      return [today0, today0 + DAY]
    case 'yesterday':
      return [today0 - DAY, today0]
    case 'thisweek':
      return [week0, week0 + 7 * DAY]
    case 'lastweek':
      return [week0 - 7 * DAY, week0]
    case 'thismonth':
      return [month0, Date.now() + DAY]
  }
}

/** 选中时段对应的日期文案：单日只显示一天，跨日显示起止 */
export function formatRangeDateText(key: TimeRangeKey) {
  const [from, to] = rangeBounds(key)
  const endTs = Math.min(to - 1, Date.now())
  const a = formatDay(from)
  const b = formatDay(endTs)
  return a === b ? a : `${a}  ~  ${b}`
}
