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

function normalizeAuthMessage(raw?: string) {
  const m = String(raw || '').trim()
  if (!m || m === 'Unauthorized' || m.toLowerCase() === 'unauthorized') {
    return '登录已失效，请重新登录'
  }
  return m
}

/*
 * 身份靠 Cookie 自动带，这里只补 CSRF 头。
 *
 * Cookie 是浏览器自动附加的，别的网站诱导一下也能借到登录态，所以写操作要
 * 额外回传一个只有本域 JS 才读得到的随机值，服务端两边比对。
 * GET 不改状态，服务端也不校验，带不带都行。
 */
http.interceptors.request.use((config) => {
  const csrf = readCsrfCookie()
  if (csrf) config.headers['X-CSRF-Token'] = csrf
  return config
})

http.interceptors.response.use(
  (res: AxiosResponse<Envelope>) => {
    const { code, data, message } = res.data
    if (code === 0) return data as never
    return Promise.reject(new Error(message ?? '请求失败'))
  },
  (err) => {
    const status = err.response?.status
    const rawMsg = err.response?.data?.message ?? err.message
    if (status === 401) {
      const store = useAdminStore()
      const msg = normalizeAuthMessage(
        Array.isArray(rawMsg) ? rawMsg.join('; ') : String(rawMsg || ''),
      )
      const onLogin = router.currentRoute.value.name === 'login'
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
        if (!onLogin) {
          void router.replace('/login').finally(() => {
            authRedirecting = false
          })
        } else {
          authRedirecting = false
        }
      }
      return Promise.reject(new Error('AUTH_EXPIRED'))
    }
    return Promise.reject(
      new Error(
        (Array.isArray(rawMsg) ? rawMsg.join('; ') : rawMsg) || '网络异常',
      ),
    )
  },
)

export default http
