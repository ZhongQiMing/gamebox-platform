import axios from 'axios'
import type { AxiosResponse } from 'axios'
import { ElMessage } from 'element-plus'
import { useAdminStore } from '@/stores/admin'
import router from '@/router'

interface Envelope<T = unknown> { code: number; data: T; message: string }

/* withCredentials：让浏览器把 HttpOnly 会话 Cookie 带上（同源其实也会带，写明更清楚） */
const http = axios.create({ baseURL: '/api', timeout: 15000, withCredentials: true })

/** 读非 HttpOnly 的 CSRF Cookie；HttpOnly 的会话 Cookie 这里读不到，也不需要读 */
function readCsrfCookie(): string {
  const m = document.cookie.match(/(?:^|;\s*)gb_csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

/** 并发 401 只提示一次、只跳转一次 */
let authRedirecting = false
let lastAuthToastAt = 0

/*
 * 会话已失效。
 *
 * 后台多个页面挂着 4s~60s 的轮询（充值审核、风控角标、房间待审），会话一断，
 * 这些定时器还会各自打一轮请求才 catch 到错误停下来。这里在请求出口直接短路，
 * 不必让每个页面各写一遍停表逻辑。重新登录成功即解除。
 */
let sessionExpired = false

function normalizeAuthMessage(raw?: string) {
  const m = String(raw || '').trim()
  if (!m || m === 'Unauthorized' || m.toLowerCase() === 'unauthorized') {
    return '登录已失效，请重新登录'
  }
  return m
}

/** 建会话接口的 401 是「密码错了」，不是「登录态失效」，不能走登出+跳转那套 */
function isAuthSessionCall(config?: { url?: string }): boolean {
  const url = String(config?.url || '').split('?')[0]
  return /\/auth\/(login|logout)\/?$/.test(url)
}

/*
 * 身份靠 Cookie 自动带，这里只补 CSRF 头。
 *
 * Cookie 是浏览器自动附加的，别的网站诱导一下也能借到登录态，所以写操作要
 * 额外回传一个只有本域 JS 才读得到的随机值，服务端两边比对。
 * GET 不改状态，服务端也不校验，带不带都行。
 */
http.interceptors.request.use((config) => {
  if (sessionExpired && !isAuthSessionCall(config)) {
    return Promise.reject(new Error('AUTH_EXPIRED'))
  }
  const csrf = readCsrfCookie()
  if (csrf) config.headers['X-CSRF-Token'] = csrf
  return config
})

http.interceptors.response.use(
  (res: AxiosResponse<Envelope>) => {
    if (isAuthSessionCall(res.config)) sessionExpired = false
    const { code, data, message } = res.data
    if (code === 0) return data as never
    return Promise.reject(new Error(message ?? '请求失败'))
  },
  (err) => {
    const status = err.response?.status
    const rawMsg = err.response?.data?.message ?? err.message
    if (status === 401 && !isAuthSessionCall(err.config)) {
      sessionExpired = true
      const store = useAdminStore()
      const serverMsg = Array.isArray(rawMsg) ? rawMsg.join('; ') : String(rawMsg || '')
      const onLogin = router.currentRoute.value.name === 'login'
      /*
       * 登录接口本身也会 401（密码错、账号冻结等）。这时不能当成「会话过期」：
       * 否则会被 LoginView 吞掉 AUTH_EXPIRED，页面上完全没提示，像点了没反应。
       */
      if (onLogin) {
        const m = serverMsg.trim()
        const isGeneric =
          !m || m === 'Unauthorized' || m.toLowerCase() === 'unauthorized'
        return Promise.reject(new Error(isGeneric ? '账号或密码错误' : m))
      }
      const msg = normalizeAuthMessage(serverMsg)
      /* 已登出后轮询仍会 401：只在「当时还有会话」时提示一次，避免连弹 */
      const hadSession = store.hadSession
      store.logout()
      if (!authRedirecting) {
        authRedirecting = true
        const now = Date.now()
        if (hadSession && now - lastAuthToastAt > 8000) {
          lastAuthToastAt = now
          ElMessage.error(msg)
        }
        void router.replace('/login').finally(() => {
          authRedirecting = false
        })
      }
      return Promise.reject(new Error('AUTH_EXPIRED'))
    }
    const msg = Array.isArray(rawMsg) ? rawMsg.join('; ') : rawMsg
    /* 403 兜底不能报「网络异常」——越权和断网得让人分得清 */
    if (status === 403) return Promise.reject(new Error(msg || '无权限执行该操作'))
    return Promise.reject(new Error(msg || '网络异常'))
  },
)

export default http
