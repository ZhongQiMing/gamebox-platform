/**
 * 手机竖屏布局 — 权威：benz.thm.d68a78f6 + sheet 原图像素
 * 子元素坐标相对 BetItem 皮肤左上角，图标用图集原始宽高（禁止百分比缩放）
 */
export const MOBILE_STAGE_W = 480
/**
 * 设计稿加长：底图 480×820（原官网 715 + 底部深色延展）
 * 给下注区下移留空，减少矮屏缩放后底部大块纯黑
 */
export const MOBILE_STAGE_H = 820
export const MOBILE_PANEL_H = 439
/**
 * 下注态面板 y：相对官网 276 下移 48，贴合加长底图
 * 开转仍按官网位移差 229（276→505）下移
 */
export const MOBILE_PANEL_TOP = 324
/**
 * 官方 BetBoardPanelV2.transformPanel：
 *   tween.to({ y: showBet ? 276 : 505 }, 400)  → 位移 229
 * 本版：324 ↔ 553（同位移），逻辑不变
 */
export const MOBILE_PANEL_TOP_SPIN = 553
export const MOBILE_PANEL_TRANSFORM_MS = 400
export const MOBILE_SPIN_Y = 168

export type PanelBet = {
  x: number
  y: number
  w: number
  h: number
  playType: number
  betId: string
  mult: number
  size: 'L' | 'M' | 'S'
}

const META: Record<number, { betId: string; mult: number }> = {
  0: { betId: 'vw_yellow', mult: 4 },
  1: { betId: 'vw_green', mult: 5 },
  2: { betId: 'vw_red', mult: 7 },
  3: { betId: 'audi_yellow', mult: 6 },
  4: { betId: 'audi_green', mult: 10 },
  5: { betId: 'audi_red', mult: 12 },
  6: { betId: 'bmw_yellow', mult: 13 },
  7: { betId: 'bmw_green', mult: 16 },
  8: { betId: 'bmw_red', mult: 22 },
  9: { betId: 'benz_yellow', mult: 27 },
  10: { betId: 'benz_green', mult: 38 },
  11: { betId: 'benz_red', mult: 45 },
}

const SIZE = { L: { w: 100, h: 160 }, M: { w: 70, h: 110 }, S: { w: 60, h: 80 } } as const

/** BetItemL/M/S 皮肤内子节点（sheet 原始尺寸） */
export const BET_SKIN = {
  L: {
    icon: { x: 21.14, y: 24.82, w: 57, h: 58 },
    odds: { y: 104, w: 42, h: 17 },
    amtBg: { y: 126, w: 66, h: 28, scale: 1 },
    amtLabelY: 136,
    amtFont: 18,
  },
  M: {
    icon: { x: 14.67, y: 16.46, w: 42, h: 41 },
    odds: { y: 74.02, w: 29, h: 12 },
    amtBg: { y: 86, w: 66, h: 28, scale: 0.7 },
    amtLabelY: 90,
    amtFont: 16,
  },
  S: {
    icon: { x: 11, y: 11.04, w: 36, h: 37 },
    odds: { y: 47.74, w: 24, h: 12 },
    amtBg: { y: 58, w: 66, h: 28, scale: 0.7 },
    amtLabelY: 61.92,
    amtFont: 16,
  },
} as const

export type GlowSpark = { x: number; y: number; rot: number }

/**
 * 车标外侧装饰光点（betGlowImage0..）— EXML 原坐标
 * Egret 默认绕图片左上角旋转
 */
export const BET_GLOW_SPARKS: Record<'L' | 'M' | 'S', readonly GlowSpark[]> = {
  L: [
    { x: 26.47, y: 70.8, rot: 0 },
    { x: 22.03, y: 49.72, rot: 45 },
    { x: 33.81, y: 31.46, rot: 90 },
    { x: 54.09, y: 27.16, rot: 135.25 },
    { x: 72.18, y: 39.43, rot: 182.52 },
    { x: 77.41, y: 59.76, rot: 225 },
    { x: 65.57, y: 78, rot: 270 },
    { x: 44.24, y: 82.42, rot: 315 },
  ],
  M: [
    { x: 18.67, y: 47.83, rot: 1 },
    { x: 15.92, y: 33.17, rot: 45 },
    { x: 24.47, y: 20.72, rot: 90 },
    { x: 39.16, y: 18.04, rot: 135 },
    { x: 51.66, y: 26.59, rot: 180 },
    { x: 54.39, y: 41.26, rot: 225 },
    { x: 46.17, y: 53.71, rot: 270 },
    { x: 31.17, y: 56.39, rot: 315 },
  ],
  S: [
    { x: 1.25, y: 28.37, rot: 0 },
    { x: 11.16, y: 9.46, rot: 46 },
    { x: 30.92, y: 2.37, rot: 90 },
    { x: 49.95, y: 11.54, rot: 133.7 },
    { x: 57.01, y: 31.87, rot: 180 },
    { x: 48.15, y: 50.4, rot: 224 },
  ],
}

/** mid / out 环（S 无）；out 的 x/y 为锚点，ax/ay=anchorOffset */
export const BET_GLOW_RING = {
  L: {
    mid: { x: 9.77, y: 15.17 },
    out: { x: 49.5, y: 55, ax: 41, ay: 41 },
  },
  M: {
    mid: { x: 6.66, y: 8.88 },
    out: { x: 35.1, y: 37.5, ax: 29.5, ay: 29.5 },
  },
  S: null,
} as const

/** 按下高亮 highlightRect / S 的 vfx_add */
export const BET_HIGHLIGHT = {
  L: { x: 11.75, y: 17, w: 76, h: 76, color: 'rgba(158,7,7,0.5)' },
  M: { x: 7.8, y: 10.2, w: 55, h: 55, color: 'rgba(21,124,9,0.5)' },
  S: { x: 3, y: 4, scale: 0.86 },
} as const

/** EXML 旁路控件（补齐开始钮两侧视觉） */
export const PANEL_SELECT = { x: 2, y: 104, w: 75, h: 42 }
export const PANEL_CHIP_SETTING = { x: 405.9, y: 140, w: 55, h: 55 }
/** moreBtn：x=390 y=37，素材 yben_btn_more_hans 50×45 */
export const PANEL_MORE = { x: 390, y: 37, w: 50, h: 45 }

/** 清零/自动文字相对按钮中心的 EXML horizontalCenter */
export const CLEAR_TXT_HC = -10
export const AUTO_TXT_HC = 10

function bet(
  x: number,
  y: number,
  playType: number,
  size: 'L' | 'M' | 'S',
): PanelBet {
  const m = META[playType]
  const s = SIZE[size]
  return { x, y, w: s.w, h: s.h, playType, betId: m.betId, mult: m.mult, size }
}

export const PANEL_TOP_BETS: PanelBet[] = [
  bet(4.4, 182.5, 11, 'L'),
  bet(102.5, 215.5, 10, 'M'),
  bet(170, 208, 9, 'M'),
  bet(240.5, 208.5, 6, 'M'),
  bet(308.4, 215, 7, 'M'),
  bet(379, 182, 8, 'L'),
]

export const PANEL_BOTTOM_BETS: PanelBet[] = [
  bet(26.9, 348.5, 5, 'S'),
  bet(95.4, 349, 4, 'S'),
  bet(162.9, 348.5, 3, 'S'),
  bet(257.5, 348.5, 0, 'S'),
  bet(325.5, 348.5, 1, 'S'),
  bet(392.6, 348.5, 2, 'S'),
]

/** start：皮肤实测以 120×120 VFX 为准，y=94，水平居中 */
export const PANEL_START = { x: (480 - 120) / 2, y: 94, w: 120, h: 120 }
export const PANEL_CLEAR = { x: 83.48, y: 107.5, w: 126, h: 37 }
export const PANEL_AUTO = { x: 272.5, y: 108, w: 126, h: 37 }
export const PANEL_ALL = { x: -2, y: 132.5, w: 82, h: 56 }
export const PANEL_UNDO = { x: 417.9, y: 96, w: 55, h: 55 }
/** chip 槽位坐标（图集 62×62）；面额由所选筹码动态填入 */
export const PANEL_CHIP_SLOTS = [
  { x: 71.96, y: 150, w: 62, h: 62 },
  { x: 130.98, y: 150, w: 62, h: 62 },
  { x: 286.5, y: 150, w: 62, h: 62 },
  { x: 346.73, y: 150, w: 62, h: 62 },
] as const
/** historyList：x=46 y=33 w=345 h=50，gap=-1；item 50×50；约 7 格可见 */
export const PANEL_HISTORY = { x: 46, y: 33, w: 345, h: 50 }
/** historyListMask：为 latest 62 图与小车标溢出预留 */
export const PANEL_HISTORY_MASK = { x: 17, y: 20, w: 370, h: 77 }
/** totalBetLabel：y=6 size=20 HC=0；底图 y=-7 HC=0.5 */
export const PANEL_TOTAL_BET = { y: 6, fontSize: 20 }
/** 文案来自 locale Benz.total_bet */
export const TOTAL_BET_LABEL = '总下注:'

export const H5 = {
  bg: '/images/games/bcbm/benz/main/yben_bg.webp',
  panel: '/images/games/bcbm/benz/bet/yben_ui_panel.webp',
  panelH: 426,
  totalBetBg: '/images/games/bcbm/benz/bet/yben_bg_total_bet.webp',
  txtbox: '/images/games/bcbm/benz/main/yben_ui_txtbox_active.webp',
} as const
