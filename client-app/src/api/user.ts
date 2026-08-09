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

  /** 注销前检查：还有钱没取、还有单没结，都会在 blockers 里列出来 */
  closeCheck: () =>
    http.get<CloseAccountCheck, CloseAccountCheck>('/users/me/close-check'),

  /** 注销账号（不可恢复），返回注销单号 */
  closeAccount: (password: string) =>
    http.post<CloseAccountResult, CloseAccountResult>('/users/me/close', {
      password,
      confirmText: CLOSE_CONFIRM_TEXT,
    }),
}

/** 与服务端 CloseAccountDto 的 @IsIn 校验一致 */
export const CLOSE_CONFIRM_TEXT = '注销账号'

export interface CloseAccountCheck {
  closable: boolean
  /** 必须先处理完才能注销 */
  blockers: Array<{ code: string; message: string }>
  /** 玩家自己会亏，确认后仍可注销 */
  warnings: Array<{ code: string; message: string }>
  balance?: number
  frozen?: number
}

export interface CloseAccountResult {
  ok: boolean
  /** 注销单号：账本里按它可查 */
  orderNo: string
  /** 本次清零的余额 */
  forfeited: number
}
