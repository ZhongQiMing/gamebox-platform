import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { configuredOrigins, getLiveOrigin, nextOrigin, rememberOrigin } from '@/utils/originPool'
import { getApiBase, syncApiClients } from './apiBase'

type RetryConfig = InternalAxiosRequestConfig & { __originTried?: string[] }

export function isTransportError(err: { response?: unknown; code?: string; message?: string }): boolean {
  if (err.response) return false
  const code = String(err.code || '')
  const msg = String(err.message || '')
  return (
    code === 'ERR_NETWORK' ||
    code === 'ECONNABORTED' ||
    /network error/i.test(msg) ||
    /timeout/i.test(msg)
  )
}

export async function retryOnDeadOrigin(
  instance: AxiosInstance,
  err: { config?: RetryConfig; response?: unknown; code?: string; message?: string },
) {
  const cfg = err.config
  const origins = configuredOrigins('api')
  if (!cfg || origins.length < 2 || !isTransportError(err)) return null

  const current = getLiveOrigin('api')
  const tried = cfg.__originTried?.length ? cfg.__originTried : [current]
  const leftover = origins.filter((o) => !tried.includes(o))
  if (!leftover.length) return null

  const rotated = nextOrigin('api', current)
  const next = leftover.includes(rotated) ? rotated : leftover[0]!
  if (!next || tried.includes(next)) return null
  rememberOrigin('api', next)
  syncApiClients()
  cfg.__originTried = [...tried, next]
  cfg.baseURL = getApiBase()
  return instance.request(cfg)
}
