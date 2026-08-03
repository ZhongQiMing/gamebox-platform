import http from './http'
import type {
  BetHistoryRowDTO,
  GameItemDTO,
} from '@gamebox/shared'

export type GameItem = GameItemDTO

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

export interface FruitSpinResult {
  gameCode: string
  roundId: string
  awardType: string
  stopIndex: number
  hitIndexes: number[]
  wins: Array<{ symbol: string; mult: number; amount: number; cellIndex: number }>
  bets: Array<{ position: string; amount: number; payout: number; won: boolean }>
  totalBet: number
  totalWin: number
  totalPayout: number
  balance: number
}

export interface FruitGambleResult {
  roll: number
  choice: 'big' | 'small'
  result: 'win' | 'lose' | 'push'
  amount: number
  payout: number
  /** 续赌后仍可再赌的金额（输则为 0） */
  pendingGambleAmount?: number
  balance: number
}

export interface BcbmSpinResult {
  gameCode: string
  awardType: string
  stopIndex: number
  hitIndexes: number[]
  freeStopIndex: number | null
  winner: string
  winnerKind: string
  multiplier: number
  wins: Array<{ position: string; mult: number; amount: number; cellIndex: number }>
  bets: Array<{ position: string; amount: number; payout: number; won: boolean }>
  totalBet: number
  totalPayout: number
  balance: number
}

export const gamesApi = {
  list: () => http.get<GameItem[], GameItem[]>('/games'),

  spin: (gameCode: string, amount: number, clientRequestId: string, clientSeed?: string) =>
    http.post<SpinResult, SpinResult>('/bet/spin', {
      gameCode,
      amount,
      clientRequestId,
      clientSeed,
    }),

  fruitSpin: (
    bets: Record<string, number>,
    clientRequestId: string,
    clientSeed?: string,
  ) =>
    http.post<FruitSpinResult, FruitSpinResult>('/bet/fruit', {
      gameCode: 'fruit-machine',
      bets,
      clientRequestId,
      clientSeed,
    }),

  fruitGamble: (amount: number, choice: 'big' | 'small', clientRequestId: string) =>
    http.post<FruitGambleResult, FruitGambleResult>('/bet/fruit/gamble', {
      amount,
      choice,
      clientRequestId,
    }),

  /** 查询可猜大小的当局赢分（从历史返回时恢复 UI） */
  fruitPendingGamble: () =>
    http.get<
      { pendingGambleAmount: number; balance: number; roundId?: string },
      { pendingGambleAmount: number; balance: number; roundId?: string }
    >('/bet/fruit/pending-gamble'),

  /** 退币/放弃猜大小：清服务器 pendingGambleAmount */
  fruitAbandonGamble: () =>
    http.post<{ ok: boolean; balance: number }, { ok: boolean; balance: number }>(
      '/bet/fruit/abandon-gamble',
      {},
    ),

  bcbmSpin: (
    bets: Record<string, number>,
    clientRequestId: string,
    clientSeed?: string,
  ) =>
    http.post<BcbmSpinResult, BcbmSpinResult>('/bet/bcbm', {
      gameCode: 'bcbm',
      bets,
      clientRequestId,
      clientSeed,
    }),

  betHistory: () =>
    http.get<BetHistoryRowDTO[], BetHistoryRowDTO[]>('/bet/history'),
}
