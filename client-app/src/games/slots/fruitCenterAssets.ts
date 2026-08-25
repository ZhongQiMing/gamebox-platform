/**
 * 中心舞台素材：优先用「多帧贴图 / 精灵表」，数字与文案由代码叠加。
 * 视频整段不可控（猜大小跳不出指定点数），故不用整段视频当主方案。
 */
import type { FruitAwardType, FruitBetSymbolId } from '@gamebox/shared'

const BASE = '/images/games/slots/center'
const SYM = `${BASE}/symbols`
const SHEETS = `${BASE}/sheets`

export type CenterStageMode =
  | 'idle'
  | 'gamble_roll'
  | 'gamble_win'
  | 'gamble_lose'
  | 'gamble_push'
  | 'award'

/** 精灵表规格：一张图里横 cols × 竖 rows 格，从左到右、从上到下播放 */
export interface CenterSheetSpec {
  /** 素材 URL；文件不存在时组件自动回退 CSS */
  url: string
  cols: number
  rows: number
  fps: number
  /** 是否循环；false 则播到最后一帧停住 */
  loop: boolean
}

/**
 * 分镜动画精灵表（场景舞台，不是纯粒子环）。
 * 放到 sheets/ 同名即可；cols/rows 必须与图里真实格子一致。
 */
export const CENTER_SHEETS: Record<string, CenterSheetSpec> = {
  idle: {
    url: `${SHEETS}/idle.webp`,
    cols: 4,
    rows: 3,
    fps: 10,
    loop: true,
  },
  // 猜大小仍复用 idle；下列 gamble-* 仅作历史兼容，不再参与舞台
  gamble_roll: {
    url: `${SHEETS}/gamble-roll.webp`,
    cols: 4,
    rows: 3,
    fps: 10,
    loop: true,
  },
  gamble_win: {
    url: `${SHEETS}/gamble-win.webp`,
    cols: 4,
    rows: 3,
    fps: 10,
    loop: false,
  },
  gamble_lose: {
    url: `${SHEETS}/gamble-lose.webp`,
    cols: 4,
    rows: 3,
    fps: 10,
    loop: false,
  },
}

export function centerSheetKeyForMode(
  mode: CenterStageMode,
  awardType?: string,
): string | null {
  void awardType
  if (mode === 'idle') return 'idle'
  // 猜大小 / 报奖：一律常驻金框+橙底（大奖不再播分镜图）
  if (
    mode === 'gamble_roll' ||
    mode === 'gamble_win' ||
    mode === 'gamble_lose' ||
    mode === 'gamble_push' ||
    mode === 'award'
  ) {
    return 'idle'
  }
  return null
}

/**
 * 中奖符号展示：重新设计的 2×2 分镜（水果本体 + 环绕光效），
 * 不是从 24 格裁下来的按钮图。倍率数字仍由 HTML 叠。
 */
export const CENTER_SYMBOL_SHEETS: Record<string, CenterSheetSpec> = {
  apple: { url: `${SYM}/apple.webp`, cols: 2, rows: 2, fps: 8, loop: true },
  orange: { url: `${SYM}/orange.webp`, cols: 2, rows: 2, fps: 8, loop: true },
  lemon: { url: `${SYM}/lemon.webp`, cols: 2, rows: 2, fps: 8, loop: true },
  melon: { url: `${SYM}/melon.webp`, cols: 2, rows: 2, fps: 8, loop: true },
  bell: { url: `${SYM}/bell.webp`, cols: 2, rows: 2, fps: 8, loop: true },
  star: { url: `${SYM}/star.webp`, cols: 2, rows: 2, fps: 8, loop: true },
  seven: { url: `${SYM}/seven.webp`, cols: 2, rows: 2, fps: 8, loop: true },
  bar: { url: `${SYM}/bar.webp`, cols: 2, rows: 2, fps: 8, loop: true },
  luck: { url: `${SYM}/luck.webp`, cols: 2, rows: 2, fps: 8, loop: true },
}

export function centerSymbolSheetKey(
  symbol: FruitBetSymbolId | 'luck' | null | undefined,
): string | null {
  if (!symbol) return null
  return symbol in CENTER_SYMBOL_SHEETS ? symbol : null
}

export function centerSymbolUrl(
  symbol: FruitBetSymbolId | 'luck' | null | undefined,
  size: 'big' | 'small' | 'luck' = 'big',
): string {
  if (!symbol || symbol === 'luck' || size === 'luck') return `${SYM}/luck.webp`
  if (size === 'big') return `${SYM}/${symbol}.webp`
  return `${SYM}/${symbol}_small.webp`
}

export function centerKindUrl(kind: string): string {
  return `${SYM}/${kind}.webp`
}

export function awardTitleForCenter(awardType: FruitAwardType | 'bar' | string): string {
  switch (awardType) {
    case 'train':
      return '开火车啦'
    case 'big3':
      return '大三元'
    case 'small3':
      return '小三元'
    case 'four':
      return '大四喜'
    case 'slam':
      return '大满贯'
    case 'luck_send':
      return '送灯'
    case 'luck_eat':
      return '吃灯'
    case 'bar':
      return '天门'
    default:
      return '大奖'
  }
}

/** 用户抠好的 24 格纯符号图（1024×1024，真透明底） */
export const RING_ICONS_SHEET = `${SYM}/fruit-ring-icons-clean.webp`
export const RING_ICONS_W = 1024
export const RING_ICONS_H = 1024

/** 常驻顶行：每种符号对应整格区域（避免紧裁切掉边缘） */
export const IDLE_RING_ICON_BOX: Record<
  FruitBetSymbolId | 'luck',
  { x: number; y: number; w: number; h: number }
> = {
  orange: { x: 2, y: 2, w: 139, h: 151 },
  bell: { x: 145, y: 2, w: 144, h: 151 },
  bar: { x: 442, y: 2, w: 144, h: 151 },
  apple: { x: 737, y: 2, w: 143, h: 151 },
  lemon: { x: 145, y: 875, w: 144, h: 147 },
  melon: { x: 884, y: 318, w: 138, h: 150 },
  seven: { x: 590, y: 875, w: 143, h: 147 },
  star: { x: 2, y: 591, w: 139, h: 149 },
  luck: { x: 884, y: 472, w: 138, h: 115 },
}

/** 橙色纯色内区（相对电视屏，避开金框跑马灯；与 idle-rays 裁切对齐） */
export const IDLE_ORANGE_BOX = {
  leftPct: 16,
  rightPct: 16,
  topPct: 10.5,
  bottomPct: 11,
} as const

/** 橙色内区四行布局 */
export const IDLE_LAYOUT_PCT = {
  padding: { y: 3.5, x: 4.5, bottom: 4 },
  topFlex: 16,
  winFlex: 30,
  ledMaxWidthPct: 72,
  ledAspect: 320 / 78,
} as const
export const IDLE_FORMULA_COLS_CH = {
  odds: 2.4,
  mult: 2.4,
  units: 1.7,
  sep: 0.42,
} as const
export function ringIconSpriteStyle(box: {
  x: number
  y: number
  w: number
  h: number
}): Record<string, string> {
  const { x, y, w, h } = box
  return {
    backgroundImage: `url(${RING_ICONS_SHEET})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${(RING_ICONS_W / w) * 100}% ${(RING_ICONS_H / h) * 100}%`,
    backgroundPosition: `${(x / (RING_ICONS_W - w)) * 100}% ${(y / (RING_ICONS_H - h)) * 100}%`,
    aspectRatio: `${w} / ${h}`,
  }
}
