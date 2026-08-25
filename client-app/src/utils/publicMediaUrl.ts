import { isNativeApp } from '@/api/session'
import { getLiveOrigin } from '@/utils/originPool'

export interface PublicMediaUrlOptions {
  native?: boolean
  apiOrigin?: string
}

/**
 * 服务端公开上传文件在 Web 保持同源相对地址；Native WebView 则补后端 Origin。
 * 私有 `/api/cs/media/*` 不属于公开媒体，必须继续由鉴权组件读取。
 */
export function publicMediaUrl(
  value?: string | null,
  options: PublicMediaUrlOptions = {},
): string {
  const url = String(value || '').trim()
  if (!url || !url.startsWith('/uploads/')) return url

  const native = options.native ?? isNativeApp()
  if (!native) return url

  const origin = String(options.apiOrigin ?? getLiveOrigin('api') ?? import.meta.env.VITE_API_ORIGIN ?? '')
    .trim()
    .replace(/\/+$/, '')
  return origin ? `${origin}${url}` : url
}
