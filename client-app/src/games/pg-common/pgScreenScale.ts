/** 正版 #splash.screen_compat 设计稿尺寸 */

export const PG_SCREEN_W = 360
export const PG_SCREEN_H = 640
/** 正版 .screen_compat { min-height:640; max-height:780 } */
export const PG_SCREEN_H_MIN = 640
export const PG_SCREEN_H_MAX = 780

/**
 * 正版主玩法 Canvas（实测 cc.view / Canvas.designResolution）：
 * 宽固定 1080，高度随视口在 [1920, 2340] 自适应。
 * 与壳层 360×[640,780] 为同一套比例（×3）。
 */
export const PG_GAME_W = 1080
export const PG_GAME_H_MIN = 1920
export const PG_GAME_H_MAX = 2340

export interface PgScreenMetrics {
  width: number
  height: number
  scale: number
}

/** 固定 360×640 等比缩放（旧行为） */
export function calcPgScreenScale(): number {
  const scaleH = window.innerHeight / PG_SCREEN_H
  const scaleW = window.innerWidth / PG_SCREEN_W
  return Math.min(scaleH, scaleW)
}

/**
 * 正版壳层：宽固定 360，高度在 [640,780] 间随视口增高，
 * 再整体 scale 铺满，避免高屏上下黑边把封面裁切/挤歪。
 */
export function calcPgScreenMetrics(adaptiveHeight = false): PgScreenMetrics {
  if (!adaptiveHeight) {
    const scale = calcPgScreenScale()
    return { width: PG_SCREEN_W, height: PG_SCREEN_H, scale }
  }

  return calcPgAdaptiveMetrics(
    window.innerWidth,
    window.innerHeight,
    PG_SCREEN_W,
    PG_SCREEN_H_MIN,
    PG_SCREEN_H_MAX,
  )
}

/**
 * 正版主玩法自适应（桌面/矮屏 → 1920；全面屏 → 最高 2340）。
 * 实测：1920×1080 → 画布约 608×1080；390×844 → 390×844。
 */
export function calcPgGameMetrics(
  vw = typeof window !== 'undefined' ? window.innerWidth : PG_GAME_W,
  vh = typeof window !== 'undefined' ? window.innerHeight : PG_GAME_H_MIN,
): PgScreenMetrics {
  return calcPgAdaptiveMetrics(vw, vh, PG_GAME_W, PG_GAME_H_MIN, PG_GAME_H_MAX)
}

/** 宽固定 + 高度 clamp 后 contain scale（正版 shell / 主玩法共用） */
export function calcPgAdaptiveMetrics(
  vw: number,
  vh: number,
  designW: number,
  heightMin: number,
  heightMax: number,
): PgScreenMetrics {
  const w = Math.max(1, vw)
  const h = Math.max(1, vh)
  const scaleW = w / designW
  const naturalH = scaleW > 0 ? h / scaleW : heightMin
  const height = Math.min(heightMax, Math.max(heightMin, naturalH))
  const scale = Math.min(w / designW, h / height)
  return { width: designW, height, scale }
}
