import { Capacitor } from '@capacitor/core'
import {
  KeychainAccess,
  SecureStorage,
} from '@aparajita/capacitor-secure-storage'

/**
 * 会话凭证放在哪。
 *
 * 网页版：放服务端下发的 HttpOnly Cookie（gb_session）里，JS 读不到。
 *   以前 token 存在 localStorage，一个能执行的 XSS 就等于把账号交出去；
 *   现在偷不走，脚本最多借当前页面发几个请求，关掉页面就没了。
 *   写操作另有 gb_csrf 双提交挡跨站伪造，两条路互不替代。
 *
 * App：继续用 Authorization: Bearer。App 的页面从安装包本地加载，来源是
 *   capacitor://localhost，跟接口天然跨站，iOS 的 WKWebView 对跨站 Cookie
 *   卡得很死，硬上会变成「安卓能用、iOS 登不上」。
 *
 * 服务端两条都认（先看 Authorization 头，没有再看 Cookie），所以这里只是
 * 决定「本端用哪条」，不需要后端配合改动。
 */

let nativeCache: boolean | null = null

export function isNativeApp(): boolean {
  if (nativeCache === null) {
    try {
      nativeCache = Capacitor.isNativePlatform()
    } catch {
      /* 浏览器里没有 Capacitor 运行时也不该炸，按网页版处理 */
      nativeCache = false
    }
  }
  return nativeCache
}

export const PLAYER_TOKEN_KEY = 'token'
export const STAFF_TOKEN_KEY = 'staff_token'

export type TokenKey = typeof PLAYER_TOKEN_KEY | typeof STAFF_TOKEN_KEY
export type SessionKind = 'player' | 'staff'
const TOKEN_KEYS: TokenKey[] = [PLAYER_TOKEN_KEY, STAFF_TOKEN_KEY]
const tokenCache: Record<TokenKey, string> = {
  [PLAYER_TOKEN_KEY]: '',
  [STAFF_TOKEN_KEY]: '',
}
let initializePromise: Promise<void> | null = null
let secureWriteQueue = Promise.resolve()
const tokenGeneration: Record<TokenKey, number> = {
  [PLAYER_TOKEN_KEY]: 0,
  [STAFF_TOKEN_KEY]: 0,
}

function enqueueSecureWrite(operation: () => Promise<void>): Promise<void> {
  const write = secureWriteQueue
    .catch(() => undefined)
    .then(operation)
  secureWriteQueue = write
  return write
}

/**
 * 网页版没有可读的 token，但仍要知道「Cookie 里可能还有会话、是谁的会话」：
 * 刷新页面后要不要去 /users/me 恢复、401 该踢哪一边，都靠它。
 * 只是个标记，不含任何凭证。
 */
const SESSION_KIND_KEY = 'gb_session_kind'

export function loadToken(key: TokenKey): string {
  if (!isNativeApp()) return ''
  return tokenCache[key]
}

export function saveToken(key: TokenKey, token: string): Promise<void> {
  tokenGeneration[key] += 1
  if (!isNativeApp()) return Promise.resolve()
  tokenCache[key] = token
  /* 防止升级/异常路径重新留下 WebView 明文副本。 */
  localStorage.removeItem(key)
  const write = enqueueSecureWrite(async () => {
      if (token) await SecureStorage.setItem(key, token)
      else await SecureStorage.removeItem(key)
    })
  void write.catch((error) => {
    console.error('[session] secure token write failed', error)
  })
  return write
}

export function removeToken(key: TokenKey): Promise<void> {
  const generation = ++tokenGeneration[key]
  tokenCache[key] = ''
  localStorage.removeItem(key)
  if (!isNativeApp()) return Promise.resolve()
  const removal = enqueueSecureWrite(async () => {
    /*
     * 删除排队期间若同一 key 已被新登录覆盖，就跳过旧删除。队列本身保证顺序，
     * generation 再防止底层实现延迟完成时把新会话当成旧会话删掉。
     */
    if (tokenGeneration[key] !== generation) return
    await SecureStorage.removeItem(key)
  })
  void removal.catch((error) => {
    console.error('[session] secure token removal failed', error)
  })
  return removal
}

export function markSession(kind: SessionKind) {
  localStorage.setItem(SESSION_KIND_KEY, kind)
}

export function sessionKind(): SessionKind | null {
  const v = localStorage.getItem(SESSION_KIND_KEY)
  return v === 'player' || v === 'staff' ? v : null
}

/**
 * 只清自己那一种。
 * 运营登录时会顺手清玩家本地态，那一步不能把刚打上的 staff 标记一起抹掉。
 */
export function clearSessionMark(kind?: SessionKind) {
  if (kind && sessionKind() !== kind) return
  localStorage.removeItem(SESSION_KIND_KEY)
}

function migrateWebLegacyTokens() {
  const player = localStorage.getItem(PLAYER_TOKEN_KEY)
  const staff = localStorage.getItem(STAFF_TOKEN_KEY)
  if (!player && !staff) return
  if (!sessionKind()) markSession(staff ? 'staff' : 'player')
  localStorage.removeItem(PLAYER_TOKEN_KEY)
  localStorage.removeItem(STAFF_TOKEN_KEY)
}

/**
 * 必须在 Vue/路由启动前调用：Native 从 Keystore/Keychain 恢复 token，并把旧版
 * localStorage 凭证一次性迁入后立即删除。安全存储不可用时 fail closed，不回退明文。
 */
export function initializeSessionStorage(): Promise<void> {
  if (initializePromise) return initializePromise
  initializePromise = (async () => {
    if (!isNativeApp()) {
      migrateWebLegacyTokens()
      return
    }

    try {
      await SecureStorage.setSynchronize(false)
      await SecureStorage.setDefaultKeychainAccess(
        KeychainAccess.whenUnlockedThisDeviceOnly,
      )
      await SecureStorage.setKeyPrefix('gamebox_')

      for (const key of TOKEN_KEYS) {
        const legacy = localStorage.getItem(key) || ''
        let secure = (await SecureStorage.getItem(key)) || ''
        if (!secure && legacy) {
          await SecureStorage.setItem(key, legacy)
          secure = legacy
        }
        tokenCache[key] = secure
        localStorage.removeItem(key)
      }
    } catch (error) {
      for (const key of TOKEN_KEYS) {
        tokenCache[key] = ''
        localStorage.removeItem(key)
      }
      console.error('[session] secure storage unavailable; local session cleared', error)
    }
  })()
  return initializePromise
}

/** 测试/退出流程可等待排队中的安全存储写操作完成。 */
export async function flushSessionStorageWrites(): Promise<void> {
  await secureWriteQueue
}
