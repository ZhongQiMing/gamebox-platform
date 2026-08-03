import staffHttp from './staffHttp'

export interface StaffWalletMe {
  ownerType: string
  ownerId: string
  balance: number
  pointsQuota?: number
  flyCover?: number
  playerPointsTotal?: number
  fakeExposure?: number
}

export interface StaffRoom {
  id: string
  roomNo: string
  name: string
  status: string
  enabledGames: string[]
  memberCount: number
  monthlyFee?: number
  nextBillAt?: string | null
  agent: {
    agentId: string
    userId: string
    uid: string
    nickname: string
    username: string
    balance?: number
    pointsQuota?: number
    pointsUsed?: number
    flyCover?: number
  } | null
  /** 列表页异步补齐 */
  poolBalance?: number
}

export interface StaffRoomDetail {
  id: string
  roomNo: string
  name: string
  status: string
  enabledGames: string[]
  memberCount: number
  roundCount?: number
  monthlyFee?: number
  billingDay?: number
  nextBillAt?: string | null
  createdAt?: string
  ownerAgent: {
    agentId: string
    userId: string
    flyCover: number
    pointsQuota: number
    pointsUsed: number
    balance: number | null
    user: { id: string; uid: string; nickname: string; username: string }
  } | null
}

export interface StaffPlayerRow {
  id: string
  uid: string
  username: string
  nickname: string
  status: string
  balance: number
  createdAt: string
}

export interface StaffPlayerPage {
  total: number
  page: number
  pageSize: number
  list: StaffPlayerRow[]
}

export interface StaffAuditRow {
  id: string
  action: string
  actionLabel: string
  amount: number | null
  createdAt: string
  operator?: { nickname: string; role: string } | null
  counterparty?: { nickname: string; role: string; uid: string } | null
}

export interface StaffReportSummary {
  betFlow: number
  payout: number
  housePnl: number
  playerPnl: number
  betCount: number
  upAmount: number
  downAmount: number
  roomCount: number
  activePlayers?: number
  byGame?: {
    gameCode: string
    gameName: string
    betCount: number
    betFlow: number
    payout: number
    housePnl: number
  }[]
  range?: { from: string; to: string; fromText?: string; toText?: string }
}

export interface StaffAgentRow {
  id: string
  uid: string
  username: string
  nickname: string
  role: string
  status: string
  balance: number
  pointsQuota?: number
  pointsUsed?: number
  flyCover?: number
  memberCount?: number
  staffCount?: number
  rooms?: { id: string; roomNo: string; name: string; status: string }[]
  lastLoginAt?: string | null
}

export interface StaffAgentPage {
  total: number
  page: number
  pageSize: number
  list: StaffAgentRow[]
}

export interface StaffRiskSummary {
  unhandled: number
  critical: number
  warn: number
  todayNew: number
}

export interface StaffRiskEvent {
  id: string
  type: string
  typeLabel: string
  level: string
  summary: string
  handled: boolean
  createdAt: string
  target?: { uid: string; nickname: string; username: string } | null
}

export interface StaffRiskPage {
  total: number
  page: number
  pageSize: number
  list: StaffRiskEvent[]
}

export const staffConsoleApi = {
  walletMe: () => staffHttp.get<StaffWalletMe, StaffWalletMe>('/console/wallet/me'),

  rooms: () => staffHttp.get<StaffRoom[], StaffRoom[]>('/console/rooms'),

  room: (id: string) => staffHttp.get<StaffRoomDetail, StaffRoomDetail>(`/console/rooms/${id}`),

  roomPool: (id: string) =>
    staffHttp.get<{ roomId: string; balance: number }, { roomId: string; balance: number }>(
      `/console/rooms/${id}/pool`,
    ),

  fundRoom: (id: string, amount: number, remark?: string) =>
    staffHttp.post<{ ok: boolean; poolBalance?: number }, { ok: boolean; poolBalance?: number }>(
      `/console/rooms/${id}/fund`,
      { amount, remark },
    ),

  players: (params?: { page?: number; pageSize?: number; q?: string; roomId?: string }) =>
    staffHttp.get<StaffPlayerPage, StaffPlayerPage>('/console/players', { params }),

  creditPlayer: (playerId: string, amount: number, remark?: string, clientRequestId?: string) =>
    staffHttp.post('/console/wallet/credit-player', {
      playerId,
      amount,
      remark,
      clientRequestId,
    }),

  debitPlayer: (playerId: string, amount: number, remark?: string, clientRequestId?: string) =>
    staffHttp.post('/console/wallet/debit-player', {
      playerId,
      amount,
      remark,
      clientRequestId,
    }),

  issue: (toUserId: string, amount: number, remark?: string) =>
    staffHttp.post('/console/wallet/issue', { toUserId, amount, remark }),

  recall: (fromUserId: string, amount: number, remark?: string) =>
    staffHttp.post('/console/wallet/recall', { fromUserId, amount, remark }),

  agentAudit: (
    userId: string,
    params?: { page?: number; pageSize?: number; tab?: 'balance' | 'fund' | 'ops' },
  ) =>
    staffHttp.get<{ list: StaffAuditRow[]; total: number }, { list: StaffAuditRow[]; total: number }>(
      `/console/agents/${userId}/audit`,
      { params },
    ),

  reportSummary: (params?: { range?: string; roomId?: string }) =>
    staffHttp.get<StaffReportSummary, StaffReportSummary>('/console/reports/summary', { params }),

  agents: (params?: {
    page?: number
    pageSize?: number
    role?: string
    q?: string
    boundOnly?: boolean
  }) =>
    staffHttp.get<StaffAgentPage, StaffAgentPage>('/console/agents', {
      params: {
        ...params,
        boundOnly:
          params?.boundOnly === false ? '0' : params?.boundOnly === true ? '1' : undefined,
      },
    }),

  riskSummary: () =>
    staffHttp.get<StaffRiskSummary, StaffRiskSummary>('/admin/risk/summary'),

  riskList: (params?: {
    handled?: boolean
    level?: string
    page?: number
    pageSize?: number
  }) =>
    staffHttp.get<StaffRiskPage, StaffRiskPage>('/admin/risk', {
      params: {
        ...params,
        handled:
          params?.handled === false
            ? 'false'
            : params?.handled === true
              ? 'true'
              : undefined,
      },
    }),

  riskHandle: (id: string, note?: string) =>
    staffHttp.patch<{ ok: boolean }, { ok: boolean }>(`/admin/risk/${id}/handle`, { note }),
}
