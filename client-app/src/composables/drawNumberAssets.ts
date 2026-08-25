import { gameAssetUrl } from '@/utils/gameOrigin'

/**
 * 开奖号码的形态判定与素材路径。
 *
 * 原先只写在玩家端大厅的 composable 闭包里，运营端的实时开奖页够不到，
 * 只能把结果印成一串纯文字。抽出来之后两端画的是同一套球。
 */

/** 开奖号码形态：底条展示用 */
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
  slots: 'fruit',
  'fruit-machine': 'fruit',
  bcbm: 'bcbm',
}

/** 各 PK10 游戏自带赛道号素材目录（与游戏内 ballHtml 一致） */
const PK10_BALL_BASE: Record<string, string> = {
  bjsc: '/games-assets/bjsc/assets/balls',
  'speed-racing': '/games-assets/speed-racing/assets/balls',
  'speed-boat': '/games-assets/speed-boat/assets/balls',
}

export function isPk10Game(key: string) {
  return DRAW_KIND[key] === 'pk10'
}
export function isDice3Game(key: string) {
  return DRAW_KIND[key] === 'dice3'
}
export function isDigit5Game(key: string) {
  return DRAW_KIND[key] === 'digit5'
}
export function isLhcGame(key: string) {
  return DRAW_KIND[key] === 'lhc'
}
export function isTableGame(key: string) {
  return DRAW_KIND[key] === 'table'
}
export function isFruitGame(key: string) {
  return DRAW_KIND[key] === 'fruit'
}
export function isBcbmGame(key: string) {
  return DRAW_KIND[key] === 'bcbm'
}

export function pk10BallUrl(gameKey: string, n: string) {
  const base = PK10_BALL_BASE[gameKey] || PK10_BALL_BASE['speed-racing']
  const num = Math.max(1, Math.min(10, Number(n) || 1))
  return gameAssetUrl(`${base}/ball-${String(num).padStart(2, '0')}.png`)
}

/** 快三用游戏内 xs/tbl 同款扁平骰子图标 */
export function kuai3DiceUrl(n: string) {
  const num = Math.max(1, Math.min(6, Number(n) || 1))
  return gameAssetUrl(`/games-assets/kuai3/assets/result/icon-${String(num).padStart(2, '0')}.png`)
}

/** 六合彩：与游戏内 ballHtml 同路径 ball_01.png … ball_49.png */
export function lhcBallUrl(n: string) {
  const num = Math.max(1, Math.min(49, Number(n) || 1))
  return gameAssetUrl(`/games-assets/lhc/assets/balls/ball_${String(num).padStart(2, '0')}.png`)
}

/** 底条：正码 6 + 「+」+ 特码（接口若无加号则补上） */
export function lhcFootNums(nums: string[]): string[] {
  const raw = nums.filter((n) => n !== '+')
  if (raw.length < 7) return nums
  const mains = raw.slice(0, 6).map((n) => String(n).padStart(2, '0'))
  const special = String(raw[6]).padStart(2, '0')
  return [...mains, '+', special]
}
