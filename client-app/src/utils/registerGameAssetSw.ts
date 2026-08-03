/**
 * App 瘦包：注册素材 SW，进游戏时按需从 VITE_ASSET_ORIGIN 下载并缓存。
 * 开发 / 完整 Web 构建不设 VITE_ASSET_ORIGIN 时不注册。
 */
export function registerGameAssetSw() {
  const origin = String(import.meta.env.VITE_ASSET_ORIGIN || '').replace(/\/$/, '')
  if (!origin) return
  if (!('serviceWorker' in navigator)) return

  const swUrl = `/game-asset-sw.js?origin=${encodeURIComponent(origin)}`
  void navigator.serviceWorker.register(swUrl).catch((err) => {
    console.warn('[game-asset-sw] 注册失败', err)
  })
}
