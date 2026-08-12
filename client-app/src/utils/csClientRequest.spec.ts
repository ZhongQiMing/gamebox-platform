import { describe, expect, it, vi } from 'vitest'
import { completeCsRequest, csRequestForText, newCsClientRequestId } from './csClientRequest'

describe('客服消息 clientRequestId', () => {
  it('生成符合后端 8-64 位契约的请求号', () => {
    expect(newCsClientRequestId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
  })

  it('网络失败后同一文本重试复用请求号', () => {
    const create = vi.fn()
      .mockReturnValueOnce('cs_request_001')
      .mockReturnValueOnce('cs_request_002')
    const first = csRequestForText('上分500', null, create)
    const retry = csRequestForText('上分500', first, create)

    expect(retry).toBe(first)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('文本变化或成功完成后生成新请求号', () => {
    const create = vi.fn()
      .mockReturnValueOnce('cs_request_001')
      .mockReturnValueOnce('cs_request_002')
      .mockReturnValueOnce('cs_request_003')
    const first = csRequestForText('上分500', null, create)
    const changed = csRequestForText('上分600', first, create)
    const afterSuccess = csRequestForText(
      '上分600',
      completeCsRequest(changed, changed),
      create,
    )

    expect(changed.clientRequestId).toBe('cs_request_002')
    expect(afterSuccess.clientRequestId).toBe('cs_request_003')
  })
})
