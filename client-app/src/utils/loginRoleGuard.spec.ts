import { describe, expect, it, vi } from 'vitest'
import { acceptLoginRole } from './loginRoleGuard'

describe('登录入口角色隔离', () => {
  it('角色不符时等待服务端会话清理完成', async () => {
    let finish!: () => void
    const logout = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    let settled = false

    const result = acceptLoginRole('AGENT', (role) => role === 'PLAYER', logout).then((value) => {
      settled = true
      return value
    })
    await Promise.resolve()

    expect(logout).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    finish()
    await expect(result).resolves.toBe(false)
  })

  it('角色匹配时不清理刚建立的会话', async () => {
    const logout = vi.fn()
    await expect(acceptLoginRole('PLAYER', (role) => role === 'PLAYER', logout)).resolves.toBe(true)
    expect(logout).not.toHaveBeenCalled()
  })
})
