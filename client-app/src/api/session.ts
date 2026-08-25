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
 * App：用 Authorization: Bearer。App 的页面从安装包本地加载，来源是
 *   capacitor://localhost，跟接口天然跨站，iOS 的 WKWebView 对跨站 Cookie
 *   卡得很死，硬上会变成「安卓能用、iOS 登不上」。
 *
 * **App 的 token 只存内存，不落盘。**
 * 以前存在 Keystore 里，重开自动登录；但这是给人上下分的账号，
 * 手机借人一用、丢了、被拿去修，谁拿到手机谁就是客服。
 * 现在从最近任务里划掉 App＝进程结束＝凭证一起没，重开必须重新输密码。
 * 只是切到后台（进程还活着）不受影响，回来接着用。
 *
 * 注意：划掉的那一刻代码根本跑不了，安卓直接杀进程。所以「划掉即退出」
 * 不可能靠「划掉时清理」实现，只能靠「凭证本来就不落盘」。
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
  /* 只放内存。同时清掉历史版本可能留下的落盘副本，升级上来的机器不该还能自动登录 */
  localStorage.removeItem(key)
  return enqueueSecureWrite(() => purgeStoredToken(key))
}

export function removeToken(key: TokenKey): Promise<void> {
  tokenGeneration[key] += 1
  tokenCache[key] = ''
  localStorage.removeItem(key)
  if (!isNativeApp()) return Promise.resolve()
  return enqueueSecureWrite(() => purgeStoredToken(key))
}

/** 抹掉旧版本写进安全存储的凭证；本身不存在时静默通过 */
async function purgeStoredToken(key: TokenKey): Promise<void> {
  try {
    await SecureStorage.removeItem(key)
  } catch {
    /* 没有这一项、或安全存储不可用，都不影响内存里的会话 */
  }
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
 * 必须在 Vue/路由启动前调用。
 *
 * App 不再恢复任何登录态：进程是新起的，就必须重新登录。
 * 这里只做一件事——把历史版本写进 Keystore / localStorage 的旧凭证抹掉，
 * 否则从老版本升上来的手机第一次打开还会自动登进去。
 */
export function initializeSessionStorage(): Promise<void> {
  if (initializePromise) return initializePromise
  initializePromise = (async () => {
    if (!isNativeApp()) {
      migrateWebLegacyTokens()
      return
    }

    for (const key of TOKEN_KEYS) {
      tokenCache[key] = ''
      localStorage.removeItem(key)
    }
    /*
     * 这些标记在 localStorage 里，进程被杀也还在。凭证既然没了，
     * 它们留着只会让路由以为「上次还在运营台 / 还在试玩中」，一并抹掉。
     */
    localStorage.removeItem(SESSION_KIND_KEY)
    localStorage.removeItem('staff_play')
    localStorage.removeItem('staff_play_room')

    try {
      await SecureStorage.setSynchronize(false)
      await SecureStorage.setDefaultKeychainAccess(
        KeychainAccess.whenUnlockedThisDeviceOnly,
      )
      await SecureStorage.setKeyPrefix('gamebox_')
      for (const key of TOKEN_KEYS) await purgeStoredToken(key)
    } catch (error) {
      /* 安全存储不可用不影响本次会话——反正也不打算从它那里读回什么 */
      console.warn('[session] secure storage unavailable while purging legacy token', error)
    }
  })()
  return initializePromise
}

/** 测试/退出流程可等待排队中的安全存储写操作完成。 */
export async function flushSessionStorageWrites(): Promise<void> {
  await secureWriteQueue
}
