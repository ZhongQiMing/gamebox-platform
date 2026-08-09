/**
 * 上下分订单号同时是幂等键：格式不合服务端的校验，玩家点上分会直接被拒。
 * 这里把服务端 assertFundOrderNo 的规则抄成断言，两边任一改动都能被发现。
 * 服务端规则见 server/src/modules/console/player-fund.helper.ts
 */
import { describe, expect, it } from 'vitest'
import { newFundOrderNo } from './fundOrderNo'

/** 与服务端 assertFundOrderNo 完全一致 */
const SERVER_RULE = /^[A-Za-z0-9_-]{8,64}$/

describe('newFundOrderNo', () => {
  it('生成的订单号能通过服务端校验', () => {
    expect(newFundOrderNo('up')).toMatch(SERVER_RULE)
    expect(newFundOrderNo('down')).toMatch(SERVER_RULE)
  })

  it('上分 SF / 下分 XF，前缀不混', () => {
    expect(newFundOrderNo('up').startsWith('SF')).toBe(true)
    expect(newFundOrderNo('down').startsWith('XF')).toBe(true)
  })

  it('同一秒内连续生成也不重复，否则第二笔会被当成重复提交吞掉', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newFundOrderNo('up')))
    expect(ids.size).toBe(500)
  })

  it('长度落在服务端要求的 8~64 之间', () => {
    const id = newFundOrderNo('up')
    expect(id.length).toBeGreaterThanOrEqual(8)
    expect(id.length).toBeLessThanOrEqual(64)
  })
})
