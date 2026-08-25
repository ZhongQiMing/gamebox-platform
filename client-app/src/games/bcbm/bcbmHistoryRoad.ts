/**
 * 官方 YPUi.HistoryRoadList + Benz.HistoryPanel 车标/颜色路算法
 * 来源：ypui HistoryRoadList.addData / benz2221 HistoryPanel.initializing
 */
import {
  BCBM_WHEEL_PLAYTYPE,
  BCBM_PLAYTYPE_META,
} from '@/games/bcbm/bcbmSpinMath'
import { bcbmSpecialSpinUrl, type BcbmAwardType } from '@/games/bcbm'

export type BcbmHistoryResult = {
  carPos: number
  award: BcbmAwardType
}

export type BcbmRoadRow = {
  /** 局数，从 1 递增（官方 HistoryRoadItemData.index） */
  index: number
  result: BcbmHistoryResult
  /** 每列：-1=珠子，其它=距上次该列开出的局数 */
  ages: number[]
}

const WHEEL = BCBM_WHEEL_PLAYTYPE

/** 车标列：0=大众 1=奥迪 2=宝马 3=奔驰 */
export function carRoadCol(carPos: number): number {
  return Math.floor(WHEEL[((carPos % 24) + 24) % 24] / 3)
}

/**
 * 颜色列（表头 黄→绿→红）：
 * 物理 carPos%3：0红 1绿 2黄 → 显示列 2 / 1 / 0
 */
export function colorRoadCol(carPos: number): number {
  const t = ((carPos % 24) + 24) % 24 % 3
  if (t === 0) return 2
  if (t === 2) return 0
  return 1
}

/**
 * @param historyNewestFirst 最新在前（与 historyDatasource 一致）
 * @param numLines 车标 4 / 颜色 3
 */
export function buildHistoryRoad(
  historyNewestFirst: BcbmHistoryResult[],
  numLines: number,
  colOf: (r: BcbmHistoryResult) => number,
): BcbmRoadRow[] {
  const rows: BcbmRoadRow[] = []
  // 官方 refreshData：从旧到新 addData（每次 prepend）
  for (let i = historyNewestFirst.length - 1; i >= 0; i--) {
    const result = historyNewestFirst[i]!
    const col = colOf(result)
    const prev = rows[0]
    const prevAges = prev?.ages ?? Array.from({ length: numLines }, () => 0)
    const ages = prevAges.map((a, r) =>
      r === col ? -1 : a === -1 ? 1 : a + 1,
    )
    rows.unshift({
      index: prev ? prev.index + 1 : 1,
      result,
      ages,
    })
  }
  return rows.slice(0, 200)
}

export function historyCarIconUrl(carPos: number, size: 'l' | 's'): string {
  const pt = WHEEL[((carPos % 24) + 24) % 24]
  const m = BCBM_PLAYTYPE_META[pt]
  return `/images/games/bcbm/benz/main/yben_icon_history_${size}_${m.brand}_${m.color}.webp`
}

/** 面板格子：特殊奖用 spin 大图标 + 小车标；普通用 s 图 */
export function historyPanelIcons(r: BcbmHistoryResult): {
  mainUrl: string
  smallUrl: string | null
} {
  const a = String(r.award)
  const car = historyCarIconUrl(r.carPos, 's')
  // 官方 getBonusImageResByCarResult(ResultBonus 0–5) + 小车标
  if (a.startsWith('sanyuan_'))
    return { mainUrl: bcbmSpecialSpinUrl('sanyuan'), smallUrl: car }
  if (a.startsWith('sixi_'))
    return { mainUrl: bcbmSpecialSpinUrl('sixi'), smallUrl: car }
  if (a === 'fast') return { mainUrl: bcbmSpecialSpinUrl('fast'), smallUrl: car }
  if (a === 'uturn') return { mainUrl: bcbmSpecialSpinUrl('uturn'), smallUrl: car }
  if (a === 'lightning' || a === 'free')
    return { mainUrl: bcbmSpecialSpinUrl('lightning'), smallUrl: car }
  if (a === 'drift') return { mainUrl: bcbmSpecialSpinUrl('drift'), smallUrl: car }
  return { mainUrl: car, smallUrl: null }
}

export const CAR_ROAD_HEADERS = [
  'volkswagen',
  'audi',
  'bmw',
  'benz',
] as const
export const COLOR_ROAD_HEADERS = ['yellow', 'green', 'red'] as const
