/**
 * 管理后台开奖图：路径与游戏内 / 玩家大厅同一套。
 * 生产打到游戏 Origin（后台静态站没有 /games-assets）；开发仍走 Vite 同源代理。
 */
import { adminStaticUrl } from '@/utils/adminStaticUrl'

export type DrawKind = 'digit5' | 'dice3' | 'pk10' | 'lhc' | 'table' | 'fruit' | 'bcbm'

export const DRAW_KIND: Record<string, DrawKind> = {
  ssc: 'digit5',
  ffc: 'digit5',
  kuai3: 'dice3',
  bjsc: 'pk10',
  'speed-racing': 'pk10',
  'speed-boat': 'pk10',
  lhc: 'lhc',
  zhajinhua: 'table',
  douniu: 'table',
  baccarat: 'table',
  longhu: 'table',
  'dragon-tiger': 'table',
  'fruit-machine': 'fruit',
  slots: 'fruit',
  bcbm: 'bcbm',
}

const PK10_BALL_BASE: Record<string, string> = {
  bjsc: '/games-assets/bjsc/assets/balls',
  'speed-racing': '/games-assets/speed-racing/assets/balls',
  'speed-boat': '/games-assets/speed-boat/assets/balls',
}

const CODE_TO_KEY: Record<string, string> = {
  'dragon-tiger': 'longhu',
  'fruit-machine': 'slots',
}

export function lobbyDrawKey(gameCode: string) {
  return CODE_TO_KEY[gameCode] ?? gameCode
}

export function drawKindOf(gameCode: string): DrawKind | undefined {
  const key = lobbyDrawKey(gameCode)
  return DRAW_KIND[gameCode] || DRAW_KIND[key]
}

export function pk10BallUrl(gameKey: string, n: string) {
  const base = PK10_BALL_BASE[gameKey] || PK10_BALL_BASE['speed-racing']
  const num = Math.max(1, Math.min(10, Number(n) || 1))
  return adminStaticUrl(`${base}/ball-${String(num).padStart(2, '0')}.png`)
}

export function kuai3DiceUrl(n: string) {
  const num = Math.max(1, Math.min(6, Number(n) || 1))
  return adminStaticUrl(`/games-assets/kuai3/assets/result/icon-${String(num).padStart(2, '0')}.png`)
}

export function lhcBallUrl(n: string) {
  const num = Math.max(1, Math.min(49, Number(n) || 1))
  return adminStaticUrl(`/games-assets/lhc/assets/balls/ball_${String(num).padStart(2, '0')}.png`)
}

export function lhcFootNums(nums: string[]): string[] {
  const raw = nums.filter((n) => n !== '+')
  if (raw.length < 7) return nums
  const mains = raw.slice(0, 6).map((n) => String(n).padStart(2, '0'))
  const special = String(raw[6]).padStart(2, '0')
  return [...mains, '+', special]
}
