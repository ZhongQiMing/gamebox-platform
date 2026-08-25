/**
 * 接口根地址。
 *
 * 网页版跑在跟后端同一个域名下，用相对路径 `/api` 即可。
 * APK 必须用 VITE_API_ORIGIN；可再配 VITE_API_FALLBACK_ORIGINS，
 * 当前线路不通时换下一个（见 originPool）。
 */
import type { AxiosInstance } from 'axios'
import { getLiveOrigin } from '@/utils/originPool'

const clients = new Set<AxiosInstance>()

export function getApiBase(): string {
  const origin = getLiveOrigin('api')
  return origin ? `${origin}/api` : '/api'
}

export let API_BASE = getApiBase()

export function registerApiClient(instance: AxiosInstance) {
  clients.add(instance)
  instance.defaults.baseURL = getApiBase()
}

export function syncApiClients() {
  API_BASE = getApiBase()
  for (const client of clients) client.defaults.baseURL = API_BASE
}
