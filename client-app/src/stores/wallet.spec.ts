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

const roomNo = { value: '' }
vi.mock('@/stores/room', () => ({
  useRoomStore: () => ({ roomNo: roomNo.value }),
}))

import { useWalletStore } from './wallet'

beforeEach(() => {
  setActivePinia(createPinia())
  roomNo.value = '123456'
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
    roomNo.value = ''
    const wallet = useWalletStore()
    wallet.balance = 999

    await wallet.fetchBalance()

    expect(balanceMock).not.toHaveBeenCalled()
    expect(wallet.balance).toBe(0)
  })

  it('房号不是 6 位数字一律当没进房，不拿别的房的钱', async () => {
    roomNo.value = '12ab56'
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
})
