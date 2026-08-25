/** 官方 yben_win_font：预切透明字图（避免 CSS 精灵错位出白块） */
const GLYPH_BASE = '/images/games/bcbm/benz/font/glyphs'
/** 字图重建后 bump，避免浏览器继续用硬切 alpha 的脏缓存 */
const GLYPH_VER = 'v2'

/** 本平台仅积分：中奖金额显示整数（官网 YoPlay 真金是 toFixed(1)，这里不跟） */
export function formatBcbmWinAmount(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return String(Math.round(v))
}

type GlyphMeta = { file: string; w: number; h: number; advance: number }

const GLYPHS: Record<string, GlyphMeta> = {
  '0': { file: '0.webp', w: 115, h: 185, advance: 115 },
  '1': { file: '1.webp', w: 83, h: 184, advance: 83 },
  '2': { file: '2.webp', w: 119, h: 185, advance: 119 },
  '3': { file: '3.webp', w: 115, h: 185, advance: 115 },
  '4': { file: '4.webp', w: 111, h: 184, advance: 111 },
  '5': { file: '5.webp', w: 119, h: 185, advance: 119 },
  '6': { file: '6.webp', w: 111, h: 184, advance: 111 },
  '7': { file: '7.webp', w: 118, h: 184, advance: 118 },
  '8': { file: '8.webp', w: 114, h: 185, advance: 114 },
  '9': { file: '9.webp', w: 110, h: 185, advance: 110 },
  '.': { file: 'dot.webp', w: 59, h: 185, advance: 59 },
  K: { file: 'K.webp', w: 133, h: 184, advance: 133 },
  M: { file: 'M.webp', w: 155, h: 184, advance: 155 },
}

export function bcbmWinGlyphSrc(ch: string): string {
  const g = GLYPHS[ch]
  return g ? `${GLYPH_BASE}/${g.file}?${GLYPH_VER}` : ''
}

/** 返回字图的布局尺寸（用于 <img>） */
export function bcbmWinDigitStyle(
  ch: string,
  scale: number,
): Record<string, string> {
  const g = GLYPHS[ch]
  if (!g) return { display: 'none' }
  return {
    width: `${g.advance * scale}px`,
    height: `${g.h * scale}px`,
    flexShrink: '0',
  }
}

export function measureBcbmWinTextWidth(text: string, scale: number): number {
  let w = 0
  for (const ch of text) {
    const g = GLYPHS[ch]
    if (g) w += g.advance * scale
  }
  return w
}
