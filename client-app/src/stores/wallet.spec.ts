/**
 * 余额是玩家最敏感的数字：显示成分、没进房不能残留上一个房的余额。
 * 玩家持分按房隔离，串房显示会让人以为钱丢了。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const balanceMock = vi.fn()

vi.mock('@/api/wallet', () => ({
  walletApi: { balance: (...args: unknown[]) => balanceMock(...args) },
}))

const roomState = { roomNo: '', current: null as { id?: string } | null }
vi.mock('@/stores/room', () => ({
  useRoomStore: () => roomState,
}))

const userState = {
  sessionEpoch: 1,
  profile: { uid: 'user-1' } as { uid: string } | null,
}
vi.mock('@/stores/user', () => ({
  useUserStore: () => userState,
}))

import { useWalletStore } from './wallet'

beforeEach(() => {
  setActivePinia(createPinia())
  roomState.roomNo = '123456'
  roomState.current = { id: 'room-1' }
  userState.sessionEpoch = 1
  userState.profile = { uid: 'user-1' }
  balanceMock.mockReset()
})

describe('wallet store', () => {
  it('按当前房间取余额并四舍五入到分', async () => {
    balanceMock.mockResolvedValue({ balance: 12.3456 })
    const wallet = useWalletStore()

    await wallet.fetchBalance()

    expect(balanceMock).toHaveBeenCalledWith({ roomNo: '123456' })
    expect(wallet.balance).toBe(12.35)
  })

  it('没进房时置 0，且不发请求', async () => {
    roomState.roomNo = ''
    const wallet = useWalletStore()
    wallet.balance = 999

    await wallet.fetchBalance()

    expect(balanceMock).not.toHaveBeenCalled()
    expect(wallet.balance).toBe(0)
  })

  it('房号不是 6 位数字一律当没进房，不拿别的房的钱', async () => {
    roomState.roomNo = '12ab56'
    const wallet = useWalletStore()

    await wallet.fetchBalance()

    expect(balanceMock).not.toHaveBeenCalled()
    expect(wallet.balance).toBe(0)
  })

  it('后端返回脏数据时按 0 处理，不显示 NaN', async () => {
    balanceMock.mockResolvedValue({ balance: 'abc' })
    const wallet = useWalletStore()

    await wallet.fetchBalance()

    expect(wallet.balance).toBe(0)
  })

  it('请求失败也要收起 loading，否则界面一直转圈', async () => {
    balanceMock.mockRejectedValue(new Error('网络错误'))
    const wallet = useWalletStore()

    await expect(wallet.fetchBalance()).rejects.toThrow('网络错误')
    expect(wallet.loading).toBe(false)
  })

  it('退出登录 reset 后余额归零', () => {
    const wallet = useWalletStore()
    wallet.balance = 500
    wallet.reset()
    expect(wallet.balance).toBe(0)
  })

  it('并发请求只提交最后一次响应', async () => {
    let resolveFirst!: (value: { balance: number }) => void
    let resolveSecond!: (value: { balance: number }) => void
    balanceMock
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve }))
    const wallet = useWalletStore()

    const first = wallet.fetchBalance()
    const second = wallet.fetchBalance()
    resolveSecond({ balance: 200 })
    await second
    resolveFirst({ balance: 100 })
    await first

    expect(wallet.balance).toBe(200)
    expect(wallet.loading).toBe(false)
  })

  it('切房、换号或 reset 后旧响应不得写回', async () => {
    let resolve!: (value: { balance: number }) => void
    balanceMock.mockReturnValue(new Promise((done) => { resolve = done }))
    const wallet = useWalletStore()
    wallet.balance = 50

    const pending = wallet.fetchBalance()
    roomState.roomNo = '654321'
    roomState.current = { id: 'room-2' }
    userState.sessionEpoch += 1
    userState.profile = { uid: 'user-2' }
    wallet.reset()
    resolve({ balance: 999 })
    await pending

    expect(wallet.balance).toBe(0)
  })
})
