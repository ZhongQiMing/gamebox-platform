import axios from 'axios'
import type { AxiosResponse } from 'axios'
import { useStaffStore } from '@/stores/staff'

interface Envelope<T = unknown> {
  code: number
  data: T
  message: string
}

const staffHttp = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

staffHttp.interceptors.request.use((config) => {
  const token = localStorage.getItem('staff_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

staffHttp.interceptors.response.use(
  (res: AxiosResponse<Envelope>) => {
    const envelope = res.data
    if (envelope.code === 0) return envelope.data as never
    return Promise.reject(new Error(envelope.message ?? '请求失败'))
  },
  (err) => {
    if (err.response?.status === 401) {
      const staff = useStaffStore()
      const kind = staff.loginKind || 'agent'
      staff.logout()
      if (!window.location.pathname.startsWith('/staff/login')) {
        window.location.replace(`/staff/login/${kind}`)
      }
    }
    const msg = err.response?.data?.message ?? err.message ?? '网络异常'
    return Promise.reject(new Error(msg))
  },
)

export default staffHttp
