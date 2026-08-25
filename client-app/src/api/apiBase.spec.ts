/**
 * APK 白屏事故的看守：装进手机的 WebView 里，'/api' 会指到手机自己身上，
 * 必须由 VITE_API_ORIGIN 给出绝对域名；网页版则必须保持相对路径不变。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadApiBase(origin?: string, fallbacks?: string): Promise<string> {
  vi.resetModules()
  localStorage.clear()
  if (origin === undefined) vi.stubEnv('VITE_API_ORIGIN', '')
  else vi.stubEnv('VITE_API_ORIGIN', origin)
  vi.stubEnv('VITE_API_FALLBACK_ORIGINS', fallbacks ?? '')
  const mod = await import('./apiBase')
  return mod.getApiBase()
}

afterEach(() => {
  vi.unstubAllEnvs()
  localStorage.clear()
})

describe('API_BASE', () => {
  it('没配域名时保持相对路径，网页版行为不变', async () => {
    expect(await loadApiBase()).toBe('/api')
  })

  it('配了域名时用绝对地址，APK 才连得上后端', async () => {
    expect(await loadApiBase('https://api.example.com')).toBe('https://api.example.com/api')
  })

  it('域名结尾多写一个斜杠也不会拼出 //api', async () => {
    expect(await loadApiBase('https://api.example.com/')).toBe('https://api.example.com/api')
  })

  it('记住备用线路后接口打到备用域名', async () => {
    vi.resetModules()
    localStorage.clear()
    vi.stubEnv('VITE_API_ORIGIN', 'https://a.example')
    vi.stubEnv('VITE_API_FALLBACK_ORIGINS', 'https://b.example')
    const pool = await import('@/utils/originPool')
    pool.rememberOrigin('api', 'https://b.example')
    const mod = await import('./apiBase')
    expect(mod.getApiBase()).toBe('https://b.example/api')
  })
})
