import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: true,
  secure: new Map<string, string>(),
  setSynchronize: vi.fn(),
  setDefaultKeychainAccess: vi.fn(),
  setKeyPrefix: vi.fn(),
  getItem: vi.fn(async (key: string) => mocks.secure.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => {
    mocks.secure.set(key, value)
  }),
  removeItem: vi.fn(async (key: string) => {
    mocks.secure.delete(key)
  }),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
  },
}))

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  KeychainAccess: { whenUnlockedThisDeviceOnly: 1 },
  SecureStorage: {
    setSynchronize: mocks.setSynchronize,
    setDefaultKeychainAccess: mocks.setDefaultKeychainAccess,
    setKeyPrefix: mocks.setKeyPrefix,
    getItem: mocks.getItem,
    setItem: mocks.setItem,
    removeItem: mocks.removeItem,
  },
}))

describe('Native 安全会话存储', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    mocks.secure.clear()
    mocks.native = true
  })

  it('首次升级把 localStorage token 迁入安全存储并立即删除明文', async () => {
    localStorage.setItem('token', 'legacy-player-token')
    const session = await import('./session')

    await session.initializeSessionStorage()

    expect(mocks.secure.get('token')).toBe('legacy-player-token')
    expect(localStorage.getItem('token')).toBeNull()
    expect(session.loadToken(session.PLAYER_TOKEN_KEY)).toBe('legacy-player-token')
    expect(mocks.setSynchronize).toHaveBeenCalledWith(false)
    expect(mocks.setDefaultKeychainAccess).toHaveBeenCalledWith(1)
  })

  it('已有 Keychain/Keystore token 优先于残留明文', async () => {
    mocks.secure.set('staff_token', 'secure-staff-token')
    localStorage.setItem('staff_token', 'stale-plain-token')
    const session = await import('./session')

    await session.initializeSessionStorage()

    expect(session.loadToken(session.STAFF_TOKEN_KEY)).toBe('secure-staff-token')
    expect(localStorage.getItem('staff_token')).toBeNull()
  })

  it('登录与退出按顺序写入并删除安全凭证', async () => {
    const session = await import('./session')
    await session.initializeSessionStorage()

    session.saveToken(session.PLAYER_TOKEN_KEY, 'new-token')
    expect(session.loadToken(session.PLAYER_TOKEN_KEY)).toBe('new-token')
    session.removeToken(session.PLAYER_TOKEN_KEY)
    await session.flushSessionStorageWrites()

    expect(mocks.secure.has('token')).toBe(false)
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('旧退出删除不会擦掉随后新登录的 token', async () => {
    const session = await import('./session')
    await session.initializeSessionStorage()
    await session.saveToken(session.PLAYER_TOKEN_KEY, 'old-token')

    const removal = session.removeToken(session.PLAYER_TOKEN_KEY)
    const saved = session.saveToken(session.PLAYER_TOKEN_KEY, 'new-token')
    await Promise.all([removal, saved, session.flushSessionStorageWrites()])

    expect(session.loadToken(session.PLAYER_TOKEN_KEY)).toBe('new-token')
    expect(mocks.secure.get('token')).toBe('new-token')
  })

  it('网页版只用 HttpOnly Cookie，并清除历史明文 token', async () => {
    mocks.native = false
    localStorage.setItem('token', 'legacy-web-token')
    const session = await import('./session')

    await session.initializeSessionStorage()

    expect(session.loadToken(session.PLAYER_TOKEN_KEY)).toBe('')
    expect(localStorage.getItem('token')).toBeNull()
    expect(session.sessionKind()).toBe('player')
    expect(mocks.getItem).not.toHaveBeenCalled()
  })
})
