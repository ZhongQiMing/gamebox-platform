import http from './http'
import type { UserProfileDTO, AuthResultDTO } from '@gamebox/shared'

// 契约统一由 @gamebox/shared 提供，前端保留同名类型别名避免大面积改动
export type UserProfile = UserProfileDTO
export type AuthResult = AuthResultDTO

export const authApi = {
  register: (data: { username: string; password: string; nickname?: string; inviteCode?: string }) =>
    http.post<AuthResult, AuthResult>('/auth/register', data),

  login: (data: { username: string; password: string }) =>
    http.post<AuthResult, AuthResult>('/auth/login', data),

  /** 清服务端会话 Cookie（gb_session / gb_csrf）；本地 token 仍由各 store 自己删 */
  logout: () => http.post<{ ok: boolean }, { ok: boolean }>('/auth/logout'),

  /** 用已有 token 恢复 profile（刷新会话时调用） */
  me: () => http.get<UserProfile, UserProfile>('/users/me'),
}
