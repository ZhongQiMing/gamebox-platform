/**
 * App 多域名线路。
 *
 * WiFi 运营商常只污染某一个数字域名：主域名 /api/health 都打不开，
 * 备用域名还能通。启动时探测，断网时按名单轮换，通了的写入 localStorage。
 * 网页版不配 VITE_API_ORIGIN，这里返回空列表，行为与从前一致。
 */
export type OriginKind = 'api' | 'asset' | 'game'

const LS: Record<OriginKind, string> = {
  api: 'gb_live_api_origin',
  asset: 'gb_live_asset_origin',
  game: 'gb_live_game_origin',
}

const memory: Partial<Record<OriginKind, string>> = {}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

function unique(list: string[]): string[] {
  return [...new Set(list.map((s) => s.replace(/\/$/, '')).filter(Boolean))]
}

export function configuredOrigins(kind: OriginKind): string[] {
  if (kind === 'api') {
    return unique([
      String(import.meta.env.VITE_API_ORIGIN || ''),
      ...splitList(String(import.meta.env.VITE_API_FALLBACK_ORIGINS || '')),
    ])
  }
  if (kind === 'asset') {
    return unique([
      String(import.meta.env.VITE_ASSET_ORIGIN || ''),
      ...splitList(String(import.meta.env.VITE_ASSET_FALLBACK_ORIGINS || '')),
    ])
  }
  return unique([
    String(import.meta.env.VITE_GAME_ORIGIN || import.meta.env.VITE_ASSET_ORIGIN || ''),
    ...splitList(String(import.meta.env.VITE_GAME_FALLBACK_ORIGINS || '')),
  ])
}

function readSaved(kind: OriginKind): string {
  try {
    return String(localStorage.getItem(LS[kind]) || '').replace(/\/$/, '')
  } catch {
    return ''
  }
}

export function getLiveOrigin(kind: OriginKind): string {
  if (memory[kind]) return memory[kind] as string
  const list = configuredOrigins(kind)
  const saved = readSaved(kind)
  if (saved && list.includes(saved)) {
    memory[kind] = saved
    return saved
  }
  return list[0] || ''
}

export function rememberOrigin(kind: OriginKind, origin: string) {
  const clean = origin.replace(/\/$/, '')
  if (!configuredOrigins(kind).includes(clean)) return
  memory[kind] = clean
  try {
    localStorage.setItem(LS[kind], clean)
  } catch {
    /* 无存储也不挡请求 */
  }
}

export function remapKnownOriginUrl(url: string, kind: OriginKind): string {
  const live = getLiveOrigin(kind)
  const known = configuredOrigins(kind)
  if (!live || !known.length) return url
  try {
    const u = new URL(url, `${live}/`)
    if (!known.includes(u.origin)) return url
    return `${live}${u.pathname}${u.search}`
  } catch {
    return url
  }
}

export function nextOrigin(kind: OriginKind, failed: string): string {
  const list = configuredOrigins(kind)
  if (list.length < 2) return getLiveOrigin(kind)
  const i = list.indexOf(failed.replace(/\/$/, ''))
  return list[(i + 1 + list.length) % list.length] || list[0] || ''
}

function probeUrl(kind: OriginKind, origin: string): string {
  if (kind === 'api') return `${origin}/api/health`
  if (kind === 'asset') return `${origin}/audio/fruit/bgm-idle.mp3`
  return `${origin}/games-assets/kuai3/index.html`
}

async function originLooksLive(kind: OriginKind, origin: string, timeoutMs: number): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(probeUrl(kind, origin), {
      method: 'GET',
      signal: ctrl.signal,
      cache: 'no-store',
      mode: 'cors',
      credentials: 'omit',
    })
    if (!res.ok) return false
    if (kind === 'api') {
      const body = (await res.json()) as { code?: number; data?: { status?: string } }
      return body?.code === 0 && body?.data?.status === 'ok'
    }
    const type = String(res.headers.get('content-type') || '')
    if (kind === 'asset') return type.includes('audio')
    return type.includes('html')
  } catch {
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

export async function probeOriginKind(kind: OriginKind, timeoutMs = 3500): Promise<string> {
  const list = configuredOrigins(kind)
  if (!list.length) return ''
  if (list.length === 1) {
    rememberOrigin(kind, list[0]!)
    return list[0]!
  }

  const saved = getLiveOrigin(kind)
  const ordered = unique([saved, ...list])
  for (const origin of ordered) {
    if (await originLooksLive(kind, origin, timeoutMs)) {
      rememberOrigin(kind, origin)
      return origin
    }
  }
  return saved || list[0] || ''
}

export async function probeAllOrigins(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!configuredOrigins('api').length && !configuredOrigins('asset').length) return
  await Promise.all([
    probeOriginKind('api'),
    probeOriginKind('asset'),
    probeOriginKind('game'),
  ])
}
