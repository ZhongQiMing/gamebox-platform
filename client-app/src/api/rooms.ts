import http from './http'

export interface RoomCard {
  roomNo: string
  name: string
  icon: string | null
  /** APPROVED 可进厅；PENDING 待代理审核 */
  memberStatus?: 'PENDING' | 'APPROVED' | 'REJECTED'
}

export interface RoomChatMessage {
  id: string
  gameCode: string
  kind: 'bet' | 'close' | 'result' | 'bet_verify' | 'win_verify' | 'system' | string
  issueNo: string | null
  senderId: string | null
  senderName: string
  senderAvatar: string | null
  isRobot: boolean
  payload: Record<string, unknown>
  createdAt: string
}

export const roomsApi = {
  mine: () => http.get<RoomCard[], RoomCard[]>('/rooms/mine'),
  enter: (roomNo: string) =>
    http.post<RoomCard, RoomCard>('/rooms/enter', { roomNo }),
  chat: (roomNo: string, gameCode: string, params?: { after?: string; limit?: number }) => {
    const q = new URLSearchParams()
    if (params?.after) q.set('after', params.after)
    if (params?.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return http.get<RoomChatMessage[], RoomChatMessage[]>(
      `/rooms/${encodeURIComponent(roomNo)}/games/${encodeURIComponent(gameCode)}/chat${qs ? `?${qs}` : ''}`,
    )
  },
  /** 牌桌气氛：当前房间该游戏的有效托人数 */
  atmosphere: (roomNo: string, gameCode: string) =>
    http.get<{ robotCount: number }, { robotCount: number }>(
      `/rooms/${encodeURIComponent(roomNo)}/games/${encodeURIComponent(gameCode)}/atmosphere`,
    ),
}
