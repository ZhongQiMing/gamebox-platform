import http from './http'

export interface CsMessageDto {
  id: string
  playerId: string
  sender: 'PLAYER' | 'AGENT' | 'SYSTEM' | string
  text: string
  isRead: boolean
  rechargeOrderId: string | null
  assigneeId: string | null
  createdAt: string
}

export const csApi = {
  list: (limit = 100) =>
    http.get<{ list: CsMessageDto[] }, { list: CsMessageDto[] }>('/cs/messages', {
      params: { limit },
    }),
  send: (text: string, clientRequestId: string) =>
    http.post<{ list: CsMessageDto[] }, { list: CsMessageDto[] }>(
      '/cs/messages',
      { text, clientRequestId },
    ),
  /** 上传聊天图片，返回 url 后用 `[img]${url}` 发消息 */
  upload: (dataUrl: string) =>
    http.post<{ kind: string; url: string }, { kind: string; url: string }>('/cs/upload', {
      dataUrl,
    }),
}
