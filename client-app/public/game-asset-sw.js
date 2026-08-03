/**
 * 游戏素材按需下载：安装包瘦身后，本地没有的 /games-assets、/images/games、/audio
 * 从 VITE_ASSET_ORIGIN 拉取并写入 Cache，第二次进入同游戏走缓存。
 * 注册：/game-asset-sw.js?origin=https%3A%2F%2Fexample.com
 */
/* eslint-disable no-restricted-globals */
const CACHE = 'gamebox-game-assets-v1'

function assetOrigin() {
  try {
    return String(new URL(self.location.href).searchParams.get('origin') || '').replace(/\/$/, '')
  } catch {
    return ''
  }
}

function isDeferredPath(pathname) {
  return (
    pathname.startsWith('/games-assets/') ||
    pathname.startsWith('/images/games/') ||
    pathname.startsWith('/audio/')
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return
  if (!isDeferredPath(url.pathname)) return

  const origin = assetOrigin()
  if (!origin) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(req)
      if (cached) return cached

      /* 安装包内仍有的大厅图标/封面：优先本地（避开 SPA 把缺失资源回成 index.html） */
      try {
        const local = await fetch(req)
        if (local && local.ok) {
          const ct = local.headers.get('content-type') || ''
          const spaFallback =
            ct.includes('text/html') &&
            !url.pathname.endsWith('.html') &&
            !url.pathname.endsWith('/')
          if (!spaFallback) return local
        }
      } catch {
        /* 本地没有则走远端 */
      }

      const remoteUrl = origin + url.pathname + url.search
      const remote = await fetch(remoteUrl, { mode: 'cors', credentials: 'omit' })
      if (remote && remote.ok) {
        try {
          await cache.put(req, remote.clone())
        } catch {
          /* 部分响应不可缓存，忽略 */
        }
      }
      return remote
    })(),
  )
})
