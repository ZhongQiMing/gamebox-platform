import http from './http'

export interface UserProfile {
  id: string
  uid: string
  username: string
  nickname: string
  avatar: string | null
  role: string
  status: string
  promoCode: string | null
  createdAt: string
}

export interface AuthResult {
  user: UserProfile
  token: string
}

export const authApi = {
  register: (data: { username: string; password: string; nickname?: string; inviteCode?: string }) =>
    http.post<AuthResult, AuthResult>('/auth/register', data),

  login: (data: { username: string; password: string }) =>
    http.post<AuthResult, AuthResult>('/auth/login', data),

  /** 用已有 token 恢复 profile（刷新会话时调用） */
  me: () => http.get<UserProfile, UserProfile>('/users/me'),
}
