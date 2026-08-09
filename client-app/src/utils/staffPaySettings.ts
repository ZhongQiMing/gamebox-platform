/**
 * 客服/代理收款设置：权威在服务端 /console/cs/desk-settings。
 * localStorage 仅作离线缓存与首次迁移。
 */
import { staffConsoleApi } from '@/api/staffConsole'

export interface PayQrItem {
  id: string
  url: string
  note?: string
  name?: string
}

export interface StaffPaySettings {
  quickReplies: string[]
  wechatQrs: PayQrItem[]
  alipayQrs: PayQrItem[]
}

export const DEFAULT_QUICK_REPLIES = [
  '请提供付款截图',
  '已为您上分，请查收',
  '请稍等，正在为您处理',
]

function key(userId: string) {
  return `cs_desk_settings_${userId || 'anon'}`
}

function normalizePayQrs(
  list: PayQrItem[] | undefined,
  legacyUrl?: string,
): PayQrItem[] {
  if (Array.isArray(list) && list.length) {
    return list
      .filter((q) => q && q.url)
      .map((q, i) => ({
        id: q.id || `q-${i}`,
        url: String(q.url),
        note: q.note || q.name || '',
        name: q.name || q.note || '',
      }))
      .slice(0, 8)
  }
  if (legacyUrl) {
    return [{ id: 'legacy', url: String(legacyUrl) }]
  }
  return []
}

function normalizeQuick(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const list = raw.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8)
    if (list.length) return list
  }
  return [...DEFAULT_QUICK_REPLIES]
}

function emptySettings(): StaffPaySettings {
  return { quickReplies: [...DEFAULT_QUICK_REPLIES], wechatQrs: [], alipayQrs: [] }
}

/** 同步读本地缓存（聊天页快捷话术；权威仍以 fetch 为准） */
export function loadStaffPaySettings(userId: string): StaffPaySettings {
  try {
    const raw = localStorage.getItem(key(userId))
    if (!raw) return emptySettings()
    const parsed = JSON.parse(raw) as {
      quickReplies?: string[]
      wechatQrs?: PayQrItem[]
      alipayQrs?: PayQrItem[]
      wechatQrUrl?: string
      alipayQrUrl?: string
    }
    return {
      quickReplies: normalizeQuick(parsed.quickReplies),
      wechatQrs: normalizePayQrs(parsed.wechatQrs, parsed.wechatQrUrl),
      alipayQrs: normalizePayQrs(parsed.alipayQrs, parsed.alipayQrUrl),
    }
  } catch {
    return emptySettings()
  }
}

function cacheLocal(userId: string, settings: StaffPaySettings) {
  localStorage.setItem(
    key(userId),
    JSON.stringify({
      quickReplies: settings.quickReplies.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8),
      wechatQrs: settings.wechatQrs.slice(0, 8),
      alipayQrs: settings.alipayQrs.slice(0, 8),
    }),
  )
}

function hasPayData(s: StaffPaySettings) {
  return s.wechatQrs.length > 0 || s.alipayQrs.length > 0 || (
    s.quickReplies.length > 0 &&
    JSON.stringify(s.quickReplies) !== JSON.stringify(DEFAULT_QUICK_REPLIES)
  )
}

/** 从服务端拉取；若服务端空且本地有旧数据则自动迁上去 */
export async function fetchStaffPaySettings(userId: string): Promise<StaffPaySettings> {
  const remote = await staffConsoleApi.csDeskSettings()
  const server: StaffPaySettings = {
    quickReplies: normalizeQuick(remote.quickReplies),
    wechatQrs: normalizePayQrs(remote.wechatQrs),
    alipayQrs: normalizePayQrs(remote.alipayQrs),
  }
  const local = loadStaffPaySettings(userId)
  const serverEmpty = !server.wechatQrs.length && !server.alipayQrs.length
  if (serverEmpty && hasPayData(local)) {
    const migrated = await staffConsoleApi.csSaveDeskSettings(local)
    const next: StaffPaySettings = {
      quickReplies: normalizeQuick(migrated.quickReplies),
      wechatQrs: normalizePayQrs(migrated.wechatQrs),
      alipayQrs: normalizePayQrs(migrated.alipayQrs),
    }
    cacheLocal(userId, next)
    return next
  }
  cacheLocal(userId, server)
  return server
}

export async function saveStaffPaySettingsRemote(
  userId: string,
  settings: StaffPaySettings,
): Promise<StaffPaySettings> {
  const payload: StaffPaySettings = {
    quickReplies: settings.quickReplies.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8),
    wechatQrs: settings.wechatQrs.slice(0, 8),
    alipayQrs: settings.alipayQrs.slice(0, 8),
  }
  if (!payload.quickReplies.length) payload.quickReplies = [...DEFAULT_QUICK_REPLIES]
  const saved = await staffConsoleApi.csSaveDeskSettings(payload)
  const next: StaffPaySettings = {
    quickReplies: normalizeQuick(saved.quickReplies),
    wechatQrs: normalizePayQrs(saved.wechatQrs),
    alipayQrs: normalizePayQrs(saved.alipayQrs),
  }
  cacheLocal(userId, next)
  return next
}

/** @deprecated 请用 saveStaffPaySettingsRemote */
export function saveStaffPaySettings(userId: string, settings: StaffPaySettings) {
  cacheLocal(userId, settings)
}
