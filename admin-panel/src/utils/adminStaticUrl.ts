/**
 * 后台静态图（开奖球 / 骰子 / 水果 / 奔驰宝马）落在游戏素材域。
 * 开发走 Vite 同源代理；生产必须拼绝对 Origin，后台站点本身没有 /games-assets。
 */
export function adminStaticUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const configured = String(
    import.meta.env.VITE_GAME_ORIGIN || import.meta.env.VITE_ASSET_ORIGIN || '',
  ).trim()
  const fallback = import.meta.env.PROD ? 'https://jinyuhui.games.5323485.com' : ''
  const origin = (configured || fallback).replace(/\/$/, '')
  if (!origin) return normalized
  try {
    return new URL(normalized.replace(/^\//, ''), `${origin}/`).toString()
  } catch {
    return normalized
  }
}

export function adminStaticUrlOrNull(path: string | null | undefined): string | null {
  if (!path) return null
  return adminStaticUrl(path)
}
