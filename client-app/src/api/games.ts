import http from './http'

export interface GameItem {
  id: string
  code: string
  name: string
  category: string
  status: string
  coverUrl: string | null
  sortOrder: number
  minBet: number
  maxBet: number
  configs: Array<{ version: number; rtp: number; payTable: unknown }>
}

export interface SpinResult {
  gameCode: string
  category: string
  refType: string
  refId: string
  totalFlow: number
  outcome: { prize: { label: string; multiplier: number }; index: number }
  bets: Array<{ betId: string; amount: number; payout: number; multiplier: number; won: boolean }>
  balance: number
}

export const gamesApi = {
  list: () => http.get<GameItem[], GameItem[]>('/games'),

  spin: (gameCode: string, amount: number, clientSeed?: string) =>
    http.post<SpinResult, SpinResult>('/bet/spin', { gameCode, amount, clientSeed }),

  betHistory: () =>
    http.get<any[], any[]>('/bet/history'),
}
