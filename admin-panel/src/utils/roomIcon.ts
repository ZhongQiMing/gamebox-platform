/** 与玩家端一致的默认房间图路径（接口也可能直接返回这个） */
export const DEFAULT_ROOM_ICON_PATH = '/images/rooms/default-room.webp'

/**
 * 管理端展示用房间图标地址。
 * - /uploads/*：走 API 同源（vite 已代理）
 * - 默认图：管理端挂在 /admin/ 下，从本包 public 取
 * - 其它 /images/*：生产同域根路径；本地需 vite 代理到玩家端
 */
export function roomIconUrl(icon?: string | null): string {
  const raw = String(icon || '').trim() || DEFAULT_ROOM_ICON_PATH
  if (raw.startsWith('/uploads/')) return raw
  if (raw === DEFAULT_ROOM_ICON_PATH || /\/rooms\/default-room\.png(?:\?|$)/.test(raw)) {
    const base = import.meta.env.BASE_URL || '/'
    return `${base}images/rooms/default-room.png`.replace(/([^:]\/)\/+/g, '$1')
  }
  return raw
}
