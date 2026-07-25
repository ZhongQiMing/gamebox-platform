import http from './http'
import type { UserProfile } from './auth'

export const userApi = {
  me: () => http.get<UserProfile, UserProfile>('/users/me'),

  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    http.patch<{ ok: boolean }, { ok: boolean }>('/users/me/password', data),

  updateNickname: (nickname: string) =>
    http.patch<UserProfile, UserProfile>('/users/me/nickname', { nickname }),

  /** dataUrl: data:image/...;base64,... */
  updateAvatar: (image: string) =>
    http.patch<UserProfile, UserProfile>('/users/me/avatar', { image }, { timeout: 30000 }),
}
