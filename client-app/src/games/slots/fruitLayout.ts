/**
 * 水果机柜机布局：设计坐标与热区（纯数据，无业务/演出逻辑）
 * 设计稿基准 1024×1536；舞台显示比例可在 View CSS 中单独拉长。
 */
import type { FruitBetSymbolId } from '@gamebox/shared'

export const BASE_W = 1024
export const BASE_H = 1536

export interface PixelBox {
  x: number
  y: number
  w: number
  h: number
}

export const cabinetBodyUrl = '/images/games/slots/fruit-cabinet-base.webp'
export const cabinetAmbientUrl = '/images/games/slots/fruit-cabinet-bg-ambient.webp'
export const fruitRingUrl = '/images/games/slots/24格.png'

/** 24 格盘面（位置不动） */
export const fruitRingBox: PixelBox = { x: 139, y: 421, w: 752, h: 680 }
/** 底图中间大金框内侧黑屏 = 电视机画面区 */
export const tvScreenBox: PixelBox = { x: 256, y: 534, w: 518, h: 455 }
export const totalScoreBox: PixelBox = { x: 275, y: 323, w: 185, h: 48 }
export const winScoreBox: PixelBox = { x: 571, y: 323, w: 182, h: 47 }

/**
 * 「水果机」顶弧跑马灯（底图 1024×1536）
 * 位置：外金弧下沿 ↔ 内标题金框上沿 的灯槽中线
 */
export const TITLE_MARQUEE_BULBS = [
  { x: 214, y: 155 },
  { x: 244, y: 130 },
  { x: 280, y: 108 },
  { x: 320, y: 90 },
  { x: 361, y: 75 },
  { x: 403, y: 62 },
  { x: 445, y: 53 },
  { x: 489, y: 49 },
  { x: 535, y: 49 },
  { x: 579, y: 53 },
  { x: 621, y: 62 },
  { x: 663, y: 75 },
  { x: 704, y: 90 },
  { x: 744, y: 108 },
  { x: 782, y: 130 },
  { x: 820, y: 155 },
] as const

export const TITLE_MARQUEE_BULB_SIZE = 28

const RING_X = [0, 105, 214, 323, 432, 540, 648, 752] as const
const RING_Y = [0, 103, 210, 312, 391, 493, 580, 680] as const
const RING_PAD = 2

function ringCellAt(col: number, row: number): PixelBox {
  return {
    x: RING_X[col] + RING_PAD,
    y: RING_Y[row] + RING_PAD,
    w: RING_X[col + 1] - RING_X[col] - RING_PAD * 2,
    h: RING_Y[row + 1] - RING_Y[row] - RING_PAD * 2,
  }
}

const RING_CELL_LOCAL: ReadonlyArray<PixelBox> = [
  ringCellAt(0, 0),
  ringCellAt(1, 0),
  ringCellAt(2, 0),
  ringCellAt(3, 0),
  ringCellAt(4, 0),
  ringCellAt(5, 0),
  ringCellAt(6, 0),
  ringCellAt(6, 1),
  ringCellAt(6, 2),
  ringCellAt(6, 3),
  ringCellAt(6, 4),
  ringCellAt(6, 5),
  ringCellAt(6, 6),
  ringCellAt(5, 6),
  ringCellAt(4, 6),
  ringCellAt(3, 6),
  ringCellAt(2, 6),
  ringCellAt(1, 6),
  ringCellAt(0, 6),
  ringCellAt(0, 5),
  ringCellAt(0, 4),
  ringCellAt(0, 3),
  ringCellAt(0, 2),
  ringCellAt(0, 1),
]

export const cellBoxes: PixelBox[] = RING_CELL_LOCAL.map((b) => ({
  x: fruitRingBox.x + b.x,
  y: fruitRingBox.y + b.y,
  w: b.w,
  h: b.h,
}))

export type ControlId = 'refund' | 'auto' | 'small' | 'big' | 'start'

export interface ControlButton extends PixelBox {
  id: ControlId
  label: string
  src: string
}

export type BetId = FruitBetSymbolId

export interface BetButton extends PixelBox {
  id: BetId
  label: string
  src: string
}

export const betButtons: BetButton[] = [
  { id: 'bar', label: '天门', src: '/images/games/slots/1.png', x: 75, y: 1270, w: 118, h: 100 },
  { id: 'seven', label: '77', src: '/images/games/slots/2.png', x: 185, y: 1269, w: 113, h: 101 },
  { id: 'star', label: '双星', src: '/images/games/slots/3.png', x: 295, y: 1269, w: 108, h: 101 },
  { id: 'melon', label: '西瓜', src: '/images/games/slots/4.png', x: 402, y: 1269, w: 106, h: 101 },
  { id: 'bell', label: '铃铛', src: '/images/games/slots/5.png', x: 510, y: 1269, w: 109, h: 101 },
  { id: 'lemon', label: '芒果', src: '/images/games/slots/6.png', x: 618, y: 1269, w: 111, h: 101 },
  { id: 'orange', label: '橘子', src: '/images/games/slots/7.png', x: 726, y: 1269, w: 114, h: 101 },
  { id: 'apple', label: '苹果', src: '/images/games/slots/8.png', x: 832, y: 1269, w: 120, h: 101 },
]

export const betLeds: Array<PixelBox & { id: BetId }> = [
  { id: 'bar', x: 104, y: 1240, w: 83, h: 22 },
  { id: 'seven', x: 206, y: 1240, w: 85, h: 22 },
  { id: 'star', x: 313, y: 1240, w: 81, h: 22 },
  { id: 'melon', x: 414, y: 1240, w: 84, h: 22 },
  { id: 'bell', x: 520, y: 1240, w: 85, h: 22 },
  { id: 'lemon', x: 627, y: 1240, w: 83, h: 22 },
  { id: 'orange', x: 731, y: 1240, w: 86, h: 22 },
  { id: 'apple', x: 837, y: 1240, w: 87, h: 22 },
]

/** 与 `@/games/slots` 的 FRUIT_MULT_STEPS 保持一致 */
export type MultValue = 1 | 5 | 10 | 20 | 50 | 100

export interface MultButton extends PixelBox {
  value: MultValue
  src: string
}

export const multButtons: MultButton[] = [
  { value: 1, src: '/images/games/slots/X1.png', x: 242, y: 1435, w: 89, h: 66 },
  { value: 5, src: '/images/games/slots/X5.png', x: 354, y: 1435, w: 89, h: 66 },
  { value: 10, src: '/images/games/slots/X10.png', x: 470, y: 1435, w: 89, h: 66 },
  { value: 20, src: '/images/games/slots/X20.png', x: 586, y: 1435, w: 92, h: 66 },
  { value: 50, src: '/images/games/slots/X50.png', x: 703, y: 1435, w: 92, h: 66 },
  { value: 100, src: '/images/games/slots/X100.png', x: 823, y: 1435, w: 92, h: 66 },
]

export function boxStyle(box: PixelBox) {
  return {
    left: `${(box.x / BASE_W) * 100}%`,
    top: `${(box.y / BASE_H) * 100}%`,
    width: `${(box.w / BASE_W) * 100}%`,
    height: `${(box.h / BASE_H) * 100}%`,
  }
}

export function titleMarqueeBulbStyle(bulb: { x: number; y: number }) {
  const s = TITLE_MARQUEE_BULB_SIZE
  return {
    left: `${((bulb.x - s / 2) / BASE_W) * 100}%`,
    top: `${((bulb.y - s / 2) / BASE_H) * 100}%`,
    width: `${(s / BASE_W) * 100}%`,
  }
}

export function buildControlButtons(autoPlaying: boolean): ControlButton[] {
  return [
    { id: 'refund', label: '退币', src: '/images/games/slots/退币.png', x: 139, y: 1136, w: 129, h: 64 },
    {
      id: 'auto',
      label: autoPlaying ? '停止' : '自动',
      src: autoPlaying ? '/images/games/slots/停止.png' : '/images/games/slots/自动.png',
      x: 297,
      y: 1136,
      w: 127,
      h: 63,
    },
    { id: 'small', label: '小', src: '/images/games/slots/小.png', x: 451, y: 1136, w: 109, h: 63 },
    { id: 'big', label: '大', src: '/images/games/slots/大.png', x: 587, y: 1136, w: 109, h: 63 },
    { id: 'start', label: '开始', src: '/images/games/slots/开始.png', x: 726, y: 1137, w: 159, h: 62 },
  ]
}
