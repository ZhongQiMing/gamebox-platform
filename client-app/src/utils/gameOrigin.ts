export type GameOriginMode = 'development' | 'production-web' | 'native'

export interface ResolveGameOriginOptions {
  mode: GameOriginMode
  pageOrigin: string
  gameOrigin?: string
  nativeAssetOrigin?: string
}

function parseOrigin(value: string, variableName: string): string {
  try {
    const url = new URL(value)
    if (!/^https?:$/.test(url.protocol) || url.origin !== value.replace(/\/$/, '')) {
      throw new Error('必须是仅含协议和主机的绝对 Origin（不能含路径、参数或认证信息）')
    }
    return url.origin
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `[game-origin] ${variableName} 配置无效：${value || '(空)'}；${detail}`,
      { cause: error },
    )
  }
}

/** 纯函数供运行时与测试共用；生产 Web 永不回退到不托管游戏的玩家 Origin。 */
export function resolveGameOrigin(options: ResolveGameOriginOptions): string {
  const configured = String(options.gameOrigin || '').trim()
  const nativeAsset = String(options.nativeAssetOrigin || '').trim()
  const candidate = configured || (options.mode === 'native' ? nativeAsset : '')
  const variableName = configured ? 'VITE_GAME_ORIGIN' : 'VITE_ASSET_ORIGIN'

  if (!candidate) {
    if (options.mode === 'development') return options.pageOrigin
    throw new Error(
      options.mode === 'native'
        ? '[game-origin] Native 构建缺少游戏域：请配置 VITE_GAME_ORIGIN，或用 VITE_ASSET_ORIGIN 指向游戏素材域'
        : '[game-origin] 生产 Web 缺少 VITE_GAME_ORIGIN：玩家域不提供 /games-assets，禁止同源回退',
    )
  }

  try {
    const origin = parseOrigin(candidate, variableName)
    if (options.pageOrigin.startsWith('https://') && !origin.startsWith('https://')) {
      throw new Error(`[game-origin] HTTPS 页面不能加载 HTTP 游戏源：${origin}`)
    }
    if (options.mode !== 'development' && !origin.startsWith('https://')) {
      throw new Error(`[game-origin] 生产游戏源必须使用 HTTPS：${origin}`)
    }
    return origin
  } catch (error) {
    if (options.mode !== 'development') throw error
    console.warn(
      `[game-origin] 开发模式忽略无效游戏域并回退到 ${options.pageOrigin}`,
      error,
    )
    return options.pageOrigin
  }
}

const runtimeMode: GameOriginMode = import.meta.env.MODE === 'app'
  || import.meta.env.VITE_SLIM_APP === '1'
  ? 'native'
  : import.meta.env.DEV
    ? 'development'
    : 'production-web'

/** H5 游戏独立 Origin；仅开发模式允许明确回退到 Vite 同源素材服务。 */
export const gameOrigin = resolveGameOrigin({
  mode: runtimeMode,
  pageOrigin: window.location.origin,
  gameOrigin: import.meta.env.VITE_GAME_ORIGIN,
  nativeAssetOrigin: import.meta.env.VITE_ASSET_ORIGIN,
})

export function gameAssetUrl(path: string): string {
  return new URL(path.replace(/^\/+/, ''), `${gameOrigin}/`).toString()
}

/** postMessage 必须同时来自独立游戏 Origin 和当前 iframe Window。 */
export function isTrustedGameMessage(
  event: Pick<MessageEvent, 'origin' | 'source'>,
  frameWindow: Window | null,
): boolean {
  if (!frameWindow || event.origin !== gameOrigin) return false
  try {
    return event.source === frameWindow
  } catch {
    return false
  }
}
