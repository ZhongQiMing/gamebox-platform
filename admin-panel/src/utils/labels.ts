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

/** 游戏 code → 中文名 */
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
  longhu: '龙虎',
  douniu: '斗牛',
  zhajinhua: '炸金花',
  'fruit-machine': '水果机',
  bcbm: '奔驰宝马',
}

export function gameLabel(code?: string | null) {
  if (!code) return '—'
  return GAME_LABEL[code] || code
}

export const GAME_OPTIONS = Object.entries(GAME_LABEL).map(([value, label]) => ({ value, label }))
