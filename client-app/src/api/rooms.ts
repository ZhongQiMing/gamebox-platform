import http from './http'
import { publicMediaUrl } from '@/utils/publicMediaUrl'

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

function withPublicRoomIcon(room: RoomCard): RoomCard {
  return { ...room, icon: publicMediaUrl(room.icon) || null }
}

function withPublicSenderAvatar(message: RoomChatMessage): RoomChatMessage {
  return { ...message, senderAvatar: publicMediaUrl(message.senderAvatar) || null }
}

export const roomsApi = {
  mine: () => http.get<RoomCard[], RoomCard[]>('/rooms/mine')
    .then((rooms) => rooms.map(withPublicRoomIcon)),
  enter: (roomNo: string) =>
    http.post<RoomCard, RoomCard>('/rooms/enter', { roomNo }).then(withPublicRoomIcon),
  chat: (roomNo: string, gameCode: string, params?: { after?: string; limit?: number }) => {
    const q = new URLSearchParams()
    if (params?.after) q.set('after', params.after)
    if (params?.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return http.get<RoomChatMessage[], RoomChatMessage[]>(
      `/rooms/${encodeURIComponent(roomNo)}/games/${encodeURIComponent(gameCode)}/chat${qs ? `?${qs}` : ''}`,
    ).then((messages) => messages.map(withPublicSenderAvatar))
  },
  /** 牌桌气氛：当前房间该游戏的有效托人数 */
  atmosphere: (roomNo: string, gameCode: string) =>
    http.get<{ robotCount: number }, { robotCount: number }>(
      `/rooms/${encodeURIComponent(roomNo)}/games/${encodeURIComponent(gameCode)}/atmosphere`,
    ),
}
