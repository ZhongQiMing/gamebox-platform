import http from './http'

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

export type RebateRange = 'today' | 'yesterday' | 'thisweek' | 'lastweek' | 'thismonth'

export const rebateApi = {
  status: (range: RebateRange = 'today') =>
    http.get<RebateStatus, RebateStatus>(`/rebate/status?range=${range}`),
  claim: (date?: string) =>
    http.post<RebateClaimResult, RebateClaimResult>('/rebate/claim', date ? { date } : {}),
}
