import http from './http'

export interface LotteryIssue {
  id: string
  issueNo: string
  status: string
  openAt: string
  lockAt: string
  serverSeedHash: string
}

export interface DrawHistory {
  issueNo: string
  drawNumbers: string     // JSON 字符串 "[1,2,3,4,5]"
  drawnAt: string
  openAt: string
  serverSeed: string
  serverSeedHash: string
  /** 开奖页码：复算用 seed:server:nonce；自然开奖为 1 */
  nonce?: number | null
  totalFlow: number
}

export interface LotteryBet {
  id: string
  betType: string
  amount: number
  payout: number
  odds?: number
  status: string
  createdAt: string
  settledAt?: string | null
  payload?: { betType?: string; value?: string } | null
  issue: { issueNo: string; drawNumbers: string | null; openAt: string } | null
}

export type LotteryPayTable = Record<string, { multiplier: number; desc?: string }>

export const lotteryApi = {
  currentIssue: (gameCode: string) =>
    http.get<LotteryIssue | null, LotteryIssue | null>(`/lottery/${gameCode}/current`),

  history: (gameCode: string, limit = 10) =>
    http.get<DrawHistory[], DrawHistory[]>(`/lottery/${gameCode}/history?limit=${limit}`),

  /** 活跃赔率表（与结算同一份） */
  payTable: (gameCode: string) =>
    http.get<{ gameCode: string; payTable: LotteryPayTable }, { gameCode: string; payTable: LotteryPayTable }>(
      `/lottery/${gameCode}/pay-table`,
    ),

  myBets: (gameCode: string, page = 1, pageSize = 20, issueNo?: string) => {
    const q = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (issueNo) q.set('issueNo', issueNo)
    return http.get<{ total: number; list: LotteryBet[] }, { total: number; list: LotteryBet[] }>(
      `/lottery/${gameCode}/my-bets?${q.toString()}`,
    )
  },

  bet: (
    gameCode: string,
    data: {
      betType: string
      betValue?: string
      amount: number
      clientRequestId: string
    },
  ) =>
    http.post<{ betId: string; issueNo: string; openAt: string }, { betId: string; issueNo: string; openAt: string }>(
      `/lottery/${gameCode}/bet`, data
    ),

  /** 批量投注（服务端事务，全成全败） */
  betBatch: (
    gameCode: string,
    bets: Array<{ betType: string; betValue?: string; amount: number }>,
    extra: { clientRequestId: string; roomNo: string; chatText?: string },
  ) =>
    http.post<
      { issueNo: string; count: number; totalAmount: number; bets: unknown[]; chatPosted?: boolean },
      { issueNo: string; count: number; totalAmount: number; bets: unknown[]; chatPosted?: boolean }
    >(`/lottery/${gameCode}/bet-batch`, {
      bets,
      clientRequestId: extra.clientRequestId,
      roomNo: extra.roomNo,
      chatText: extra.chatText,
    }),

  /** 取消当前可投注期内本人全部 PENDING 注单 */
  cancel: (gameCode: string) =>
    http.post<{ issueNo: string; count: number; refunded: number }, { issueNo: string; count: number; refunded: number }>(
      `/lottery/${gameCode}/cancel`, {}
    ),
}
