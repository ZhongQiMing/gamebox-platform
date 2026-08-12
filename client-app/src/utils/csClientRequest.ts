export type CsRequestIdFactory = () => string

export interface PendingCsRequest {
  text: string
  clientRequestId: string
}

export function newCsClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cs_${crypto.randomUUID()}`
  }
  return `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

/**
 * 同一文本在失败重试时复用请求号；文本变化代表新的逻辑发送。
 */
export function csRequestForText(
  text: string,
  pending: PendingCsRequest | null,
  createId: CsRequestIdFactory = newCsClientRequestId,
): PendingCsRequest {
  if (pending?.text === text) return pending
  return { text, clientRequestId: createId() }
}

export function completeCsRequest(
  pending: PendingCsRequest | null,
  completed: PendingCsRequest,
): PendingCsRequest | null {
  return pending?.clientRequestId === completed.clientRequestId ? null : pending
}
