/**
 * APK 白屏事故的看守：装进手机的 WebView 里，'/api' 会指到手机自己身上，
 * 必须由 VITE_API_ORIGIN 给出绝对域名；网页版则必须保持相对路径不变。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

/** 每次都要重新 import，API_BASE 是模块加载时就算好的常量 */
async function loadApiBase(origin?: string): Promise<string> {
  vi.resetModules()
  if (origin === undefined) vi.stubEnv('VITE_API_ORIGIN', '')
  else vi.stubEnv('VITE_API_ORIGIN', origin)
  const mod = await import('./apiBase')
  return mod.API_BASE
}

afterEach(() => {
  vi.unstubAllEnvs()
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
})
