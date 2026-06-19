/**
 * PG Soft《麻将胡了》(Mahjong Ways 1) 官方符号、赔付与消除逻辑
 */

export type PaySymbolId = 'fa' | 'zhong' | 'bai' | '8w' | '5t' | '5s' | '2t' | '2s'
export type MahjongSymbolId = PaySymbolId | 'wild' | 'hu'

export interface TileCell {
  symbol: MahjongSymbolId
  isGolden: boolean
}

export interface GridPos {
  col: number
  row: number
}

export const COLS = 5
export const VISIBLE_ROWS = 4
/** 上下各 1 行缓冲，共 6 行（中间 4 行参与中奖） */
export const BUFFER_ROWS_ABOVE = 1
export const BUFFER_ROWS_BELOW = 1
export const TOTAL_ROWS = VISIBLE_ROWS + BUFFER_ROWS_ABOVE + BUFFER_ROWS_BELOW
export const VISIBLE_ROW_INDICES = [1, 2, 3, 4] as const

export const PAY_SYMBOLS: readonly PaySymbolId[] = [
  'fa', 'zhong', 'bai', '8w', '5t', '5s', '2t', '2s',
]

export const SYMBOL_LABELS: Record<MahjongSymbolId, string> = {
  fa: '发财',
  zhong: '红中',
  bai: '白板',
  '8w': '八万',
  '5t': '五筒',
  '5s': '五条',
  '2t': '二筒',
  '2s': '二条',
  wild: '百搭',
  hu: '胡',
}

/** 赔付表：[3连, 4连, 5连] */
export const PAYTABLE: Record<PaySymbolId, [number, number, number]> = {
  fa: [15, 60, 100],
  zhong: [10, 40, 80],
  bai: [8, 20, 60],
  '8w': [6, 15, 40],
  '5t': [4, 10, 20],
  '5s': [4, 10, 20],
  '2t': [2, 5, 10],
  '2s': [2, 5, 10],
}

const SYMBOL_WEIGHTS: Record<PaySymbolId, number> = {
  '2t': 16,
  '2s': 16,
  '5t': 12,
  '5s': 12,
  '8w': 9,
  bai: 7,
  zhong: 6,
  fa: 5,
}

const WILD_WEIGHT = 2
const SCATTER_WEIGHT = 2.5
const GOLDEN_CHANCE = 0.14

export const GOLDEN_REEL_INDICES = [1, 2, 3] as const
export const CASCADE_MULTIPLIERS = [1, 2, 3, 5] as const
export const FREE_SPIN_MULTIPLIERS = [2, 4, 6, 10] as const
export const BASE_BET = 20

export interface WinResult {
  totalWin: number
  winCells: GridPos[]
  scatterCount: number
}

function weightedPick<T extends string>(entries: Array<{ id: T; weight: number }>): T {
  const total = entries.reduce((s, e) => s + e.weight, 0)
  let r = Math.random() * total
  for (const e of entries) {
    r -= e.weight
    if (r <= 0) return e.id
  }
  return entries[entries.length - 1].id
}

export function isPaySymbol(symbol: MahjongSymbolId): symbol is PaySymbolId {
  return (PAY_SYMBOLS as readonly string[]).includes(symbol)
}

export function cellMatches(cell: TileCell, target: PaySymbolId): boolean {
  if (cell.symbol === 'wild') return true
  return cell.symbol === target
}

export function getCascadeMultiplier(index: number, isFreeSpin: boolean): number {
  const ladder = isFreeSpin ? FREE_SPIN_MULTIPLIERS : CASCADE_MULTIPLIERS
  return ladder[Math.min(index, ladder.length - 1)]
}

export function freeSpinsFromScatters(scatterCount: number): number {
  if (scatterCount < 3) return 0
  return 12 + (scatterCount - 3) * 2
}

export function rollColumn(colIndex: number): TileCell[] {
  return Array.from({ length: TOTAL_ROWS }, () => rollTile(colIndex))
}

export function rollTile(colIndex: number): TileCell {
  const entries: Array<{ id: MahjongSymbolId; weight: number }> = [
    ...PAY_SYMBOLS.map((id) => ({ id, weight: SYMBOL_WEIGHTS[id] })),
    { id: 'wild', weight: WILD_WEIGHT },
    { id: 'hu', weight: SCATTER_WEIGHT },
  ]
  const symbol = weightedPick(entries)
  const canGolden =
    isPaySymbol(symbol) &&
    (GOLDEN_REEL_INDICES as readonly number[]).includes(colIndex)

  return {
    symbol,
    isGolden: canGolden && Math.random() < GOLDEN_CHANCE,
  }
}

export function createEmptyGrid(): TileCell[][] {
  return Array.from({ length: COLS }, (_, c) => rollColumn(c))
}

export function countScatters(grid: TileCell[][]): number {
  let n = 0
  for (const col of grid) {
    for (const r of VISIBLE_ROW_INDICES) {
      if (col[r]?.symbol === 'hu') n++
    }
  }
  return n
}

export function evaluateWins(
  grid: TileCell[][],
  betAmount: number,
  cascadeStep: number,
  isFreeSpin = false,
): WinResult {
  const unitBet = betAmount / BASE_BET
  const cascadeMult = getCascadeMultiplier(cascadeStep, isFreeSpin)
  const winCells: GridPos[] = []
  let totalWin = 0
  const scatterCount = countScatters(grid)

  for (const symbol of PAY_SYMBOLS) {
    const reelCounts: number[] = []
    const reelPositions: GridPos[][] = []

    for (let c = 0; c < COLS; c++) {
      const positions: GridPos[] = []
      for (const r of VISIBLE_ROW_INDICES) {
        const cell = grid[c][r]
        if (cell && cellMatches(cell, symbol)) {
          positions.push({ col: c, row: r })
        }
      }
      if (positions.length === 0) break
      reelCounts.push(positions.length)
      reelPositions.push(positions)
    }

    const waysLength = reelCounts.length
    if (waysLength < 3) continue

    const payValue = PAYTABLE[symbol][waysLength - 3]
    const ways = reelCounts.reduce((p, n) => p * n, 1)
    totalWin += unitBet * payValue * ways * cascadeMult

    for (let i = 0; i < waysLength; i++) {
      winCells.push(...reelPositions[i])
    }
  }

  return { totalWin, winCells: dedupeCells(winCells), scatterCount }
}

export function dedupeCells(cells: GridPos[]): GridPos[] {
  const seen = new Set<string>()
  return cells.filter(({ col, row }) => {
    const key = `${col}-${row}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 镀金符号参与中奖后转为百搭（官方机制） */
export function applyGoldenToWild(grid: TileCell[][], winCells: GridPos[]): void {
  for (const { col, row } of winCells) {
    const cell = grid[col][row]
    if (cell?.isGolden && isPaySymbol(cell.symbol)) {
      grid[col][row] = { symbol: 'wild', isGolden: false }
    }
  }
}

/** 需消除的格子（已转百搭的镀金牌保留） */
export function getCellsToRemove(grid: TileCell[][], winCells: GridPos[]): GridPos[] {
  return dedupeCells(winCells).filter(({ col, row }) => {
    const cell = grid[col][row]
    if (!cell) return false
    if (cell.isGolden && isPaySymbol(cell.symbol)) return false
    if (cell.symbol === 'wild') return true
    return isPaySymbol(cell.symbol)
  })
}

/** 消除后下落补牌 */
export function dropAndRefill(grid: TileCell[][], removeCells: GridPos[]): void {
  const byCol = new Map<number, Set<number>>()
  for (const { col, row } of removeCells) {
    if (!byCol.has(col)) byCol.set(col, new Set())
    byCol.get(col)!.add(row)
  }

  for (let c = 0; c < COLS; c++) {
    const removeRows = byCol.get(c) ?? new Set()
    const kept = grid[c].filter((_, r) => !removeRows.has(r))
    const incoming = Array.from(
      { length: TOTAL_ROWS - kept.length },
      () => rollTile(c),
    )
    grid[c] = [...kept, ...incoming]
  }
}

export function posKey(col: number, row: number): string {
  return `${col}-${row}`
}
