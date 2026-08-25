import http from './http'
import type { TimeRangeKey } from '@/composables/timeRange'

export interface RebateGameSlice {
  gameCode: string
  gameName: string
  validFlow: number
  rate: number
  amount: number
}

export interface RebateClaimableItem {
  date: string
  validFlow: number
  amount: number
  games: RebateGameSlice[]
}

export interface RebateHistoryItem {
  id: string
  date: string
  validFlow: number
  amount: number
  claimType: 'AUTO' | 'MANUAL'
  claimedAt: string
  games: RebateGameSlice[]
}

export interface RebateStatus {
  claimableTotal: number
  today: {
    date: string
    validFlow: number
    estimatedRebate: number
    games: RebateGameSlice[]
  }
  claimable: RebateClaimableItem[]
  history: RebateHistoryItem[]
}

export interface RebateClaimResult {
  ok: boolean
  amount: number
  date: string
  message: string
}

/** 与 composables/timeRange 同源，别在这里另开一份枚举 */
export type RebateRange = TimeRangeKey

export const rebateApi = {
  status: (range: RebateRange = 'today') =>
    http.get<RebateStatus, RebateStatus>(`/rebate/status?range=${range}`),
  claim: (date?: string) =>
    http.post<RebateClaimResult, RebateClaimResult>('/rebate/claim', date ? { date } : {}),
  /** 当前生效的玩家回水比例（小数）；游戏内展示用 */
  rate: (gameCode?: string) =>
    http.get<{ rate: number }, { rate: number }>(
      `/rebate/rate${gameCode ? `?gameCode=${encodeURIComponent(gameCode)}` : ''}`,
    ),
}
