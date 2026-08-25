/** 概览页的指标小卡片 */
export interface KpiChip {
  label: string
  value: string
  color?: string
  hot?: boolean
}

/**
 * 关盘流水专用色（橙）。
 *
 * 关盘＝下级自己坐庄，这部分平台不参与分成、赚不到钱，所以要和飞盘（蓝）
 * 一眼区分开，方便盯住关盘占比。改这个值会同步影响所有页面的关盘数字。
 */
export const CLOSED_FLOW_COLOR = 'var(--ops-closed-flow, #fb923c)'

/** 房间状态 */
export const ROOM_STATUS_LABEL: Record<string, string> = {
  OPEN: '营业中',
  MAINTENANCE: '维护中',
  FROZEN: '已冻结',
  CLOSED: '已关闭',
}

export function roomStatusLabel(status?: string | null) {
  if (!status) return '—'
  return ROOM_STATUS_LABEL[status] || status
}

export function roomStatusTagType(status?: string | null): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'OPEN') return 'success'
  if (status === 'MAINTENANCE') return 'warning'
  if (status === 'FROZEN' || status === 'CLOSED') return 'danger'
  return 'info'
}

/** 游戏 code → 中文名（后台开通/列表用；不含别名） */
export const GAME_LABEL: Record<string, string> = {
  ffc: '分分彩',
  ssc: '时时彩',
  kuai3: '快三',
  bjsc: '北京赛车',
  'speed-racing': '极速赛车',
  'speed-boat': '极速飞艇',
  lhc: '六合彩',
  baccarat: '百家乐',
  'dragon-tiger': '龙虎斗',
  douniu: '斗牛',
  zhajinhua: '炸金花',
  'fruit-machine': '水果机',
  bcbm: '奔驰宝马',
}

/** 历史别名 → 正式 code（同一款游戏，勿当成两款） */
const GAME_CODE_ALIAS: Record<string, string> = {
  longhu: 'dragon-tiger',
}

export function canonicalGameCode(code?: string | null) {
  if (!code) return ''
  return GAME_CODE_ALIAS[code] || code
}

export function gameLabel(code?: string | null) {
  if (!code) return '—'
  const c = canonicalGameCode(code)
  return GAME_LABEL[c] || GAME_LABEL[code] || code
}

export const GAME_OPTIONS = Object.entries(GAME_LABEL).map(([value, label]) => ({ value, label }))
