import axios from 'axios'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { useStaffStore } from '@/stores/staff'
import { getApiBase, registerApiClient } from './apiBase'
import { retryOnDeadOrigin } from './originRetry'
import { STAFF_TOKEN_KEY, isNativeApp, loadToken, sessionKind } from './session'

interface Envelope<T = unknown> {
  code: number
  data: T
  message: string
}

type StaffConfig = InternalAxiosRequestConfig & { __staffToken?: string }

const staffHttp = axios.create({
  baseURL: getApiBase(),
  timeout: 15000,
})
registerApiClient(staffHttp)

function readCsrfCookie(): string {
  const m = document.cookie.match(/(?:^|;\s*)gb_csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

function tokenOf(config?: StaffConfig): string {
  if (!config) return ''
  if (config.__staffToken) return config.__staffToken
  const headers = config.headers as { get?: (k: string) => unknown; Authorization?: unknown; authorization?: unknown }
  const raw = typeof headers?.get === 'function'
    ? headers.get('Authorization') ?? headers.get('authorization')
    : headers?.Authorization ?? headers?.authorization
  const s = Array.isArray(raw) ? raw[0] : raw
  if (typeof s !== 'string') return ''
  return s.startsWith('Bearer ') ? s.slice(7) : ''
}

staffHttp.interceptors.request.use((config: StaffConfig) => {
  const token = loadToken(STAFF_TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
    config.__staffToken = token
  }
  const csrf = readCsrfCookie()
  if (csrf) config.headers['X-CSRF-Token'] = csrf
  return config
})

staffHttp.interceptors.response.use(
  (res: AxiosResponse<Envelope>) => {
    const envelope = res.data
    if (envelope.code === 0) return envelope.data as never
    return Promise.reject(new Error(envelope.message ?? '请求失败'))
  },
  async (err) => {
    const retry = await retryOnDeadOrigin(staffHttp, err)
    if (retry) return retry
    if (err.response?.status === 401) {
      const current = loadToken(STAFF_TOKEN_KEY)
      const reqToken = tokenOf(err.config as StaffConfig | undefined)
      /*
       * Bearer（App）必须「请求票 === 当前票」才踢会话。
       * AxiosHeaders 读不到 Authorization 时绝不能用 !reqToken 兜底，否则任意 401 都会误踢刚登录的人。
       *
       * 网页版走 Cookie，压根没有票可比，401 就是会话没了；但要先确认这台机器上
       * 确实是运营会话，否则玩家态的 401 会把人踢去运营登录页。
       */
      const shouldKick = isNativeApp()
        ? !!current && !!reqToken && reqToken === current
        : sessionKind() === 'staff'
      if (shouldKick) {
        const staff = useStaffStore()
        const kind = staff.loginKind || 'agent'
        await staff.logout()
        if (!window.location.pathname.startsWith('/staff/login')) {
          window.location.replace(`/staff/login/${kind}`)
        }
      }
    }
    const raw = err.response?.data?.message ?? err.message ?? '网络异常'
    const msg =
      err.response?.status === 429 || /too many requests|throttler/i.test(String(raw))
        ? '尝试过于频繁，请稍后再试'
        : /network error/i.test(String(raw))
          ? '当前网络连不上服务器，请换网络后重试'
          : String(raw)
    return Promise.reject(new Error(msg))
  },
)

export default staffHttp
