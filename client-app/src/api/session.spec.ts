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

/**
 * App 的登录态只活在进程内存里：从最近任务划掉＝进程结束＝必须重新登录。
 * 这几条钉的是「不许再落盘」，一旦有人把 setItem 加回来，测试立刻失败。
 */
describe('Native 会话只存内存', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    mocks.secure.clear()
    mocks.native = true
  })

  it('登录后的 token 不写进安全存储', async () => {
    const session = await import('./session')
    await session.initializeSessionStorage()

    await session.saveToken(session.PLAYER_TOKEN_KEY, 'new-token')

    expect(session.loadToken(session.PLAYER_TOKEN_KEY)).toBe('new-token')
    expect(mocks.setItem).not.toHaveBeenCalled()
    expect(mocks.secure.has('token')).toBe(false)
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('重新启动不会把上次的 token 读回来（等价于划掉后台）', async () => {
    /* 模拟老版本遗留：安全存储里还躺着一张票 */
    mocks.secure.set('staff_token', 'stale-secure-token')
    const session = await import('./session')

    await session.initializeSessionStorage()

    expect(session.loadToken(session.STAFF_TOKEN_KEY)).toBe('')
    /* 而且要顺手抹掉，免得老版本升上来的机器还留着凭证 */
    expect(mocks.secure.has('staff_token')).toBe(false)
  })

  it('启动时清掉会话标记与试玩标记，避免路由误判上次还登着', async () => {
    localStorage.setItem('gb_session_kind', 'staff')
    localStorage.setItem('staff_play', '1')
    localStorage.setItem('staff_play_room', 'room-1')
    const session = await import('./session')

    await session.initializeSessionStorage()

    expect(session.sessionKind()).toBeNull()
    expect(localStorage.getItem('staff_play')).toBeNull()
    expect(localStorage.getItem('staff_play_room')).toBeNull()
  })

  it('退出后内存里的票立即失效', async () => {
    const session = await import('./session')
    await session.initializeSessionStorage()
    await session.saveToken(session.PLAYER_TOKEN_KEY, 'tk')

    await session.removeToken(session.PLAYER_TOKEN_KEY)

    expect(session.loadToken(session.PLAYER_TOKEN_KEY)).toBe('')
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
