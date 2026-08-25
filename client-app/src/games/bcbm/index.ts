/**
 * 奔驰宝马前端 —— 素材来自 YoPlay PC_Benz（紫霓虹版，与截图一致）
 */
import type { BcbmBetId } from '@gamebox/shared'

export {
  BCBM_RING,
  BCBM_RING_XY,
  BCBM_RING_SIZE,
  BCBM_SLOT_POS,
  BCBM_BET_SLOTS,
  BCBM_BRANDS,
  BCBM_COLORS,
  BCBM_AWARD_LABELS,
  BCBM_AWARD_TYPES,
  BCBM_DISPLAY_PLAYTYPE_BY_BET,
  bcbmBetSlot,
  bcbmCarPosCandidatesForBet,
  bcbmRingIndexToCarPos,
  bcbmRingIndexesToCarPositions,
  isBcbmBetId,
  type BcbmAwardType,
  type BcbmBetId,
  type BcbmBrandId,
  type BcbmColorId,
  type BcbmRingCell,
} from '@gamebox/shared'

const IMG = '/images/games/bcbm/benz'
const BRAND_FILE: Record<string, string> = {
  benz: 'benz',
  bmw: 'bmw',
  audi: 'audi',
  vw: 'volkswagen',
}

export function bcbmBgUrl() {
  return '/images/games/bcbm/bg.webp'
}

export function bcbmSpinIconUrl(brand: string, color: string) {
  const b = BRAND_FILE[brand] ?? brand
  return `${IMG}/spin/yben_icon_large_${b}_${color}.webp`
}

export function bcbmBetIconUrl(brand: string, color: string) {
  const b = BRAND_FILE[brand] ?? brand
  return `${IMG}/bet/yben_icon_bet_${b}_${color}.webp`
}

export function bcbmOddsUrl(mult: number) {
  return `${IMG}/bet/yben_txt_x${mult}.webp`
}

export function bcbmSpecialSpinUrl(
  kind: 'sanyuan' | 'sixi' | 'lightning' | 'uturn' | 'fast' | 'drift',
) {
  const map = {
    sanyuan: 'yben_icon_three_great_scholars',
    sixi: 'yben_icon_four_great_blessings',
    lightning: 'yben_icon_lightning_bolt',
    uturn: 'yben_icon_U_turn',
    fast: 'yben_icon_fast_and_furious',
    drift: 'yben_icon_total_drift',
  } as const
  return `${IMG}/spin/${map[kind]}.webp`
}

export function bcbmBannerUrl(kind: 'sanyuan' | 'sixi' | 'lightning' | 'uturn' | 'fast' | 'drift') {
  const map = {
    sanyuan: 'yben_txt_three_great_scholars_hans',
    sixi: 'yben_txt_four_great_blessings_hans',
    lightning: 'yben_txt_lightning_bolt_hans',
    uturn: 'yben_txt_u_turn_hans',
    fast: 'yben_txt_fast_and_furious_hans',
    drift: 'yben_txt_total_drift_hans',
  } as const
  return `${IMG}/txt/${map[kind]}.webp`
}

export const BCBM_UI = {
  panel: `${IMG}/bet/yben_ui_panel.webp`,
  chipOff: `${IMG}/bet/yben_btn_chips_off.webp`,
  chipOn: `${IMG}/bet/yben_btn_chips_on.webp`,
  allOff: `${IMG}/bet/yben_btn_allbet_off.webp`,
  allOn: `${IMG}/bet/yben_btn_allbet_on.webp`,
  autoOff: `${IMG}/bet/yben_btn_autoplay_off.webp`,
  autoOn: `${IMG}/bet/yben_btn_autoplay_on.webp`,
  undo: `${IMG}/bet/yben_btn_undo.webp`,
  startVfx: `${IMG}/bet/yben_vfx_start_on.webp`,
  stopVfx: `${IMG}/bet/yben_vfx_stop_on.webp`,
  clearAuto: `${IMG}/bet/yben_vfx_auto_clear_auto_on.webp`,
  betAmountBg: `${IMG}/bet/yben_ui_txtbox_active.webp`,
  back: `${IMG}/main/yben_btn_back.webp`,
  menu: `${IMG}/main/yben_btn_setting.webp`,
  user: `${IMG}/main/yben_btn_user_own.webp`,
  border: `${IMG}/bet/yben_ui_geniric_border3.webp`,
  borderOn: `${IMG}/bet/yben_ui_geniric_border3_selected.webp`,
  txtStart: `${IMG}/txt/yben_txt_start_hans.webp`,
  txtClear: `${IMG}/txt/yben_txt_clear_off_hans.webp`,
  txtAuto: `${IMG}/txt/yben_txt_auto_off_hans.webp`,
  txtAll: `${IMG}/txt/yben_txt_allbet_off_hans.webp`,
} as const

/**
 * 筹码面额池（用户指定，非官网全量）
 * 默认展示 4 枚：1 / 5 / 10 / 100（对齐手机 createChipSettingPopup 选 4）
 */
export const BCBM_CHIP_POOL = [1, 5, 10, 50, 100, 200, 500, 1000] as const
export const BCBM_CHIP_DEFAULT = [1, 5, 10, 100] as const

/**
 * PC_Benz 灯环展示序（24 格，左右各一轮 12 色档）。
 * 与 SpinPanelV2Skin 车标顺序一致（无免费格，特殊奖走大奖流程）。
 */
export const BCBM_DISPLAY_RING: ReadonlyArray<{ brand: string; color: string }> = [
  { brand: 'vw', color: 'yellow' },
  { brand: 'vw', color: 'green' },
  { brand: 'vw', color: 'red' },
  { brand: 'audi', color: 'yellow' },
  { brand: 'audi', color: 'green' },
  { brand: 'audi', color: 'red' },
  { brand: 'bmw', color: 'yellow' },
  { brand: 'bmw', color: 'green' },
  { brand: 'bmw', color: 'red' },
  { brand: 'benz', color: 'yellow' },
  { brand: 'benz', color: 'green' },
  { brand: 'benz', color: 'red' },
  { brand: 'benz', color: 'red' },
  { brand: 'benz', color: 'green' },
  { brand: 'benz', color: 'yellow' },
  { brand: 'bmw', color: 'red' },
  { brand: 'bmw', color: 'green' },
  { brand: 'bmw', color: 'yellow' },
  { brand: 'audi', color: 'red' },
  { brand: 'audi', color: 'green' },
  { brand: 'audi', color: 'yellow' },
  { brand: 'vw', color: 'red' },
  { brand: 'vw', color: 'green' },
  { brand: 'vw', color: 'yellow' },
]

/** 椭圆上均匀取点（百分比，相对 ring-board） */
export function bcbmOvalPos(i: number, n: number, rx = 42, ry = 36) {
  const a = -Math.PI / 2 + (i / n) * Math.PI * 2
  return {
    left: `${50 + Math.cos(a) * rx}%`,
    top: `${50 + Math.sin(a) * ry}%`,
  }
}

/** 押注区展示顺序（对齐截图：上排大图标，下排小图标） */
export const BCBM_BET_LAYOUT: ReadonlyArray<BcbmBetId> = [
  'benz_red',
  'benz_green',
  'benz_yellow',
  'bmw_yellow',
  'bmw_green',
  'bmw_red',
  'audi_red',
  'audi_green',
  'audi_yellow',
  'vw_yellow',
  'vw_green',
  'vw_red',
] as const
