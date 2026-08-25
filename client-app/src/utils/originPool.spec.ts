import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadPool(env: Record<string, string> = {}) {
  vi.resetModules()
  vi.stubEnv('VITE_API_ORIGIN', env.VITE_API_ORIGIN ?? '')
  vi.stubEnv('VITE_API_FALLBACK_ORIGINS', env.VITE_API_FALLBACK_ORIGINS ?? '')
  vi.stubEnv('VITE_ASSET_ORIGIN', env.VITE_ASSET_ORIGIN ?? '')
  vi.stubEnv('VITE_ASSET_FALLBACK_ORIGINS', env.VITE_ASSET_FALLBACK_ORIGINS ?? '')
  vi.stubEnv('VITE_GAME_ORIGIN', env.VITE_GAME_ORIGIN ?? '')
  vi.stubEnv('VITE_GAME_FALLBACK_ORIGINS', env.VITE_GAME_FALLBACK_ORIGINS ?? '')
  localStorage.clear()
  return import('./originPool')
}

afterEach(() => {
  vi.unstubAllEnvs()
  localStorage.clear()
})

describe('originPool', () => {
  it('主域名加备用去重', async () => {
    const pool = await loadPool({
      VITE_API_ORIGIN: 'https://a.example/',
      VITE_API_FALLBACK_ORIGINS: 'https://b.example,https://a.example,https://c.example/',
    })
    expect(pool.configuredOrigins('api')).toEqual([
      'https://a.example',
      'https://b.example',
      'https://c.example',
    ])
  })

  it('记住的线路优先，且只认名单里的', async () => {
    const pool = await loadPool({
      VITE_API_ORIGIN: 'https://a.example',
      VITE_API_FALLBACK_ORIGINS: 'https://b.example',
    })
    pool.rememberOrigin('api', 'https://evil.example')
    expect(pool.getLiveOrigin('api')).toBe('https://a.example')
    pool.rememberOrigin('api', 'https://b.example')
    expect(pool.getLiveOrigin('api')).toBe('https://b.example')
  })

  it('把已知素材域名的 URL 改写到当前线路', async () => {
    const pool = await loadPool({
      VITE_ASSET_ORIGIN: 'https://games-a.example',
      VITE_ASSET_FALLBACK_ORIGINS: 'https://games-b.example',
    })
    pool.rememberOrigin('asset', 'https://games-b.example')
    expect(pool.remapKnownOriginUrl('https://games-a.example/audio/fruit/bgm-idle.mp3', 'asset'))
      .toBe('https://games-b.example/audio/fruit/bgm-idle.mp3')
  })
})
