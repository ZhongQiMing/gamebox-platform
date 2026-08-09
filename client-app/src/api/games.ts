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
  /** true：跑灯未揭晓，注单仍为待开奖 */
  awaitingReveal?: boolean
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

  spin: (
    gameCode: string,
    amount: number,
    clientRequestId: string,
    clientSeed?: string,
    roomNo?: string,
  ) =>
    http.post<SpinResult, SpinResult>('/bet/spin', {
      gameCode,
      amount,
      clientRequestId,
      clientSeed,
      roomNo,
    }),

  fruitSpin: (
    bets: Record<string, number>,
    clientRequestId: string,
    clientSeed?: string,
    roomNo?: string,
  ) =>
    http.post<FruitSpinResult, FruitSpinResult>('/bet/fruit', {
      gameCode: 'fruit-machine',
      bets,
      clientRequestId,
      clientSeed,
      roomNo,
    }),

  /** 跑灯/报奖结束后揭晓派彩；此前注单为「待开奖」 */
  fruitReveal: (roundId: string) =>
    http.post<
      { ok: boolean; roundId: string; balance: number; totalPayout: number; pendingGambleAmount: number },
      { ok: boolean; roundId: string; balance: number; totalPayout: number; pendingGambleAmount: number }
    >('/bet/fruit/reveal', { roundId }),

  fruitGamble: (
    amount: number,
    choice: 'big' | 'small',
    clientRequestId: string,
    roomNo?: string,
  ) =>
    http.post<FruitGambleResult, FruitGambleResult>('/bet/fruit/gamble', {
      amount,
      choice,
      clientRequestId,
      roomNo,
    }),

  /** 查询可猜大小的当局赢分（从历史返回时恢复 UI）；传 roomNo 才能在无 pending 时拿到正确余额 */
  fruitPendingGamble: (roomNo?: string) => {
    const q = roomNo ? `?roomNo=${encodeURIComponent(roomNo)}` : ''
    return http.get<
      { pendingGambleAmount: number; balance?: number; roundId?: string },
      { pendingGambleAmount: number; balance?: number; roundId?: string }
    >(`/bet/fruit/pending-gamble${q}`)
  },

  /** 退币/放弃猜大小：清服务器 pendingGambleAmount */
  fruitAbandonGamble: (roomNo?: string) =>
    http.post<{ ok: boolean; balance?: number }, { ok: boolean; balance?: number }>(
      '/bet/fruit/abandon-gamble',
      roomNo ? { roomNo } : {},
    ),

  bcbmSpin: (
    bets: Record<string, number>,
    clientRequestId: string,
    clientSeed?: string,
    roomNo?: string,
  ) =>
    http.post<BcbmSpinResult, BcbmSpinResult>('/bet/bcbm', {
      gameCode: 'bcbm',
      bets,
      clientRequestId,
      clientSeed,
      roomNo,
    }),

  betHistory: () =>
    http.get<BetHistoryRowDTO[], BetHistoryRowDTO[]>('/bet/history'),
}
