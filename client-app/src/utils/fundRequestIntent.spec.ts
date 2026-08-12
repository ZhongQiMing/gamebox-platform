import { describe, expect, it } from 'vitest'
import { fundRequestIntentKey, type FundRequestIntent } from './fundRequestIntent'

describe('上下分幂等意图', () => {
  const base: FundRequestIntent = {
    type: 'up',
    amount: 500,
    channel: 'wechat',
    roomNo: '123456',
  }

  it('完整上下文相同才生成相同 key', () => {
    expect(fundRequestIntentKey(base)).toBe(fundRequestIntentKey({ ...base }))
  })

  it.each([
    ['类型', { type: 'down' as const }],
    ['金额', { amount: 501 }],
    ['渠道', { channel: 'alipay' }],
    ['房间', { roomNo: '654321' }],
  ])('%s变化会生成新 key', (_label, change) => {
    expect(fundRequestIntentKey({ ...base, ...change })).not.toBe(fundRequestIntentKey(base))
  })
})
