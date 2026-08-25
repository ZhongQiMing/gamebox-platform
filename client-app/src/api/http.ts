import axios from 'axios'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { useUserStore } from '@/stores/user'
import { getApiBase, registerApiClient } from './apiBase'
import { retryOnDeadOrigin } from './originRetry'
import { PLAYER_TOKEN_KEY, loadToken, sessionKind } from './session'

/** 后端统一响应信封 */
interface Envelope<T = unknown> {
  code: number
  data: T
  message: string
}

type HttpConfig = InternalAxiosRequestConfig & { __userToken?: string }

const http = axios.create({
  baseURL: getApiBase(),
  timeout: 10000,
})
registerApiClient(http)

/** 登录会顺带下发非 HttpOnly 的 gb_csrf；有 Cookie 会话时写操作必须回传 */
function readCsrfCookie(): string {
  const m = document.cookie.match(/(?:^|;\s*)gb_csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

function tokenOf(config?: HttpConfig): string {
  if (!config) return ''
  if (config.__userToken) return config.__userToken
  const headers = config.headers as { get?: (k: string) => unknown; Authorization?: unknown; authorization?: unknown }
  const raw = typeof headers?.get === 'function'
    ? headers.get('Authorization') ?? headers.get('authorization')
    : headers?.Authorization ?? headers?.authorization
  const s = Array.isArray(raw) ? raw[0] : raw
  if (typeof s !== 'string') return ''
  return s.startsWith('Bearer ') ? s.slice(7) : ''
}

function requestPath(config?: InternalAxiosRequestConfig): string {
  const u = String(config?.url || '')
  // url 可能是相对路径 /auth/login，或带 baseURL
  try {
    if (u.startsWith('http')) return new URL(u).pathname
  } catch { /* ignore */ }
  return u.split('?')[0] || ''
}

/** 建/拆会话接口的 401/429 只是业务失败，绝不能当成「已登录态失效」去整页踢登录 */
function isAuthSessionCall(config?: InternalAxiosRequestConfig): boolean {
  const path = requestPath(config)
  return /\/auth\/(login|register|logout)\/?$/.test(path)
}

function errorMessage(err: { response?: { status?: number; data?: { message?: string } }; message?: string }): string {
  const status = err.response?.status
  const raw = err.response?.data?.message ?? err.message ?? '网络异常'
  if (status === 429 || /too many requests|throttler/i.test(String(raw))) {
    return '尝试过于频繁，请稍后再试'
  }
  if (typeof raw === 'string' && raw.startsWith('ThrottlerException')) {
    return '尝试过于频繁，请稍后再试'
  }
  if (!status && /network error/i.test(String(raw))) {
    return '当前网络连不上服务器，请换网络后重试'
  }
  return String(raw)
}

// 请求拦截：App 注入 Bearer；网页版没有可注入的 token，靠同域自动带上的
// HttpOnly Cookie 认证。CSRF 头两边都带（Cookie 会话的写操作必须回传）。
http.interceptors.request.use((config: HttpConfig) => {
  const token = loadToken(PLAYER_TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
    config.__userToken = token
  }
  const csrf = readCsrfCookie()
  if (csrf) config.headers['X-CSRF-Token'] = csrf
  return config
})

// 响应拦截：解包信封 / 统一错误处理
http.interceptors.response.use(
  (res: AxiosResponse<Envelope>) => {
    const envelope = res.data
    if (envelope.code === 0) return envelope.data as never
    return Promise.reject(new Error(envelope.message ?? '请求失败'))
  },
  async (err) => {
    const retry = await retryOnDeadOrigin(http, err)
    if (retry) return retry
    if (err.response?.status === 401 && !isAuthSessionCall(err.config)) {
      const userStore = useUserStore()
      const staffPlay = localStorage.getItem('staff_play') === '1'
      const kind = (localStorage.getItem('staff_login_kind') as 'agent' | 'branch') || 'agent'
      const current = loadToken(PLAYER_TOKEN_KEY)
      const reqToken = tokenOf(err.config as HttpConfig | undefined)
      // 过期请求的 401（票已换/已清）忽略，避免误踢新登录。
      // 网页版没有票可比，401 只可能是 Cookie 会话没了，照常往下踢。
      if (reqToken && current && reqToken !== current) {
        return Promise.reject(new Error(errorMessage(err)))
      }
      /*
       * 仅代理「进游戏」play 态票失效时清运营会话。
       * 运营工作台期间玩家 http 401 只清玩家本地态，绝不整页踢运营登录。
       * /auth/login 密码错误的 401 已在上方排除，否则会把运营登录页整页踢去玩家登录。
       */
      if (staffPlay) {
        await import('@/stores/staff').then(async ({ useStaffStore }) => {
          await useStaffStore().logout()
          window.location.replace(`/staff/login/${kind}`)
        })
      } else if (sessionKind() === 'staff') {
        await userStore.clearLocal().catch(() => undefined)
      } else {
        await Promise.all([
          userStore.clearLocal().catch(() => undefined),
          import('@/api/auth').then(({ authApi }) => authApi.logout()).catch(() => undefined),
        ])
        const path = window.location.pathname
        if (!path.startsWith('/login') && !path.startsWith('/staff/login')) {
          window.location.replace('/login')
        }
      }
    }
    return Promise.reject(new Error(errorMessage(err)))
  },
)

export default http
