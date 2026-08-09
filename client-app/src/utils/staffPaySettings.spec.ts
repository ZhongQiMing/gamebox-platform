/**
 * 收款码/快捷话术的本地缓存解析。
 * 这段是纯防御代码：localStorage 里的东西可能是上一个版本写的、也可能被写坏，
 * 解析一抛异常客服工作台就打不开，所以每条兜底都要钉住。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/staffConsole', () => ({
  staffConsoleApi: { csDeskSettings: vi.fn(), csSaveDeskSettings: vi.fn() },
}))

import { DEFAULT_QUICK_REPLIES, loadStaffPaySettings } from './staffPaySettings'

const USER = 'u1'
const KEY = `cs_desk_settings_${USER}`

beforeEach(() => {
  localStorage.clear()
})

describe('loadStaffPaySettings', () => {
  it('没有缓存时给默认话术、收款码为空', () => {
    const s = loadStaffPaySettings(USER)
    expect(s.quickReplies).toEqual(DEFAULT_QUICK_REPLIES)
    expect(s.wechatQrs).toEqual([])
    expect(s.alipayQrs).toEqual([])
  })

  it('缓存是坏 JSON 也不抛异常，退回默认值', () => {
    localStorage.setItem(KEY, '{不是合法 JSON')
    expect(() => loadStaffPaySettings(USER)).not.toThrow()
    expect(loadStaffPaySettings(USER).quickReplies).toEqual(DEFAULT_QUICK_REPLIES)
  })

  it('旧版单个收款码字段能读出来，不至于升级后收款码消失', () => {
    localStorage.setItem(KEY, JSON.stringify({ wechatQrUrl: 'https://cdn/wx.png' }))
    const s = loadStaffPaySettings(USER)
    expect(s.wechatQrs).toEqual([{ id: 'legacy', url: 'https://cdn/wx.png' }])
  })

  it('丢掉没有 url 的脏项，最多保留 8 张', () => {
    const list = Array.from({ length: 12 }, (_, i) => ({ id: `q${i}`, url: `https://cdn/${i}.png` }))
    localStorage.setItem(
      KEY,
      JSON.stringify({ alipayQrs: [{ id: 'bad' }, ...list] }),
    )
    const s = loadStaffPaySettings(USER)
    expect(s.alipayQrs).toHaveLength(8)
    expect(s.alipayQrs.every((q) => !!q.url)).toBe(true)
  })

  it('话术全是空白时退回默认，不给客服一个空列表', () => {
    localStorage.setItem(KEY, JSON.stringify({ quickReplies: ['  ', ''] }))
    expect(loadStaffPaySettings(USER).quickReplies).toEqual(DEFAULT_QUICK_REPLIES)
  })

  it('不同客服各存各的，不会读到别人的收款码', () => {
    localStorage.setItem(
      `cs_desk_settings_other`,
      JSON.stringify({ wechatQrs: [{ id: 'a', url: 'https://cdn/other.png' }] }),
    )
    expect(loadStaffPaySettings(USER).wechatQrs).toEqual([])
  })
})
