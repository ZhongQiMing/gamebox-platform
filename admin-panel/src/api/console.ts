import http from './http'

export const consoleApi = {
  walletMe: () => http.get<WalletMe, WalletMe>('/console/wallet/me'),
  issue: (toUserId: string, amount: number, remark?: string) =>
    http.post('/console/wallet/issue', { toUserId, amount, remark }),
  /** 回收代理/子账号额度（下分） */
  recall: (fromUserId: string, amount: number, remark?: string) =>
    http.post('/console/wallet/recall', { fromUserId, amount, remark }),
  creditPlayer: (playerId: string, amount: number, remark?: string, clientRequestId?: string) =>
    http.post('/console/wallet/credit-player', { playerId, amount, remark, clientRequestId }),
  debitPlayer: (playerId: string, amount: number, remark?: string, clientRequestId?: string) =>
    http.post('/console/wallet/debit-player', { playerId, amount, remark, clientRequestId }),

  rooms: (params?: { includeClosed?: boolean }) =>
    http.get<ConsoleRoom[], ConsoleRoom[]>('/console/rooms', {
      params: params?.includeClosed ? { includeClosed: '1' } : undefined,
    }),
  room: (id: string) => http.get<unknown, unknown>(`/console/rooms/${id}`),
  createRoom: (data: {
    name: string
    roomNo?: string
    enabledGames?: string[]
    status?: string
    robotCount?: number
    ownerUserIds?: string[]
    agentUsername?: string
    agentPassword?: string
    agentNickname?: string
    monthlyFee?: number
    billingDay?: number
    nextBillAt?: string
  }) => http.post<{
    id: string
    roomNo: string
    name: string
    status: string
    monthlyFee: number
    billingDay: number
    nextBillAt: string | null
    agent: { id: string; uid: string; username: string; password: string; nickname: string }
  }, {
    id: string
    roomNo: string
    name: string
    status: string
    monthlyFee: number
    billingDay: number
    nextBillAt: string | null
    agent: { id: string; uid: string; username: string; password: string; nickname: string }
  }>('/console/rooms', data),
  resetAgentPassword: (roomId: string, password?: string) =>
    http.post<{
      ok: boolean
      username: string
      password: string
      message: string
    }, {
      ok: boolean
      username: string
      password: string
      message: string
    }>(`/console/rooms/${roomId}/reset-agent-password`, { password }),
  updateRoomBilling: (
    roomId: string,
    data: { monthlyFee?: number; billingDay?: number; nextBillAt?: string | null },
  ) =>
    http.patch<{
      monthlyFee: number
      billingDay: number
      nextBillAt: string | null
      lastBilledAt: string | null
    }, {
      monthlyFee: number
      billingDay: number
      nextBillAt: string | null
      lastBilledAt: string | null
    }>(`/console/rooms/${roomId}/billing`, data),
  grantOwner: (roomId: string, ownerUserId: string) =>
    http.post(`/console/rooms/${roomId}/grant-owner`, { ownerUserId }),
  revokeOwner: (roomId: string, ownerUserId: string) =>
    http.post(`/console/rooms/${roomId}/revoke-owner`, { ownerUserId }),
  setRoomStatus: (roomId: string, status: string) =>
    http.patch(`/console/rooms/${roomId}/status`, { status }),
  deleteRoom: (roomId: string) =>
    http.post<{ ok: boolean; mode: string; message: string }, { ok: boolean; mode: string; message: string }>(
      `/console/rooms/${roomId}/delete`,
      {},
    ),
  rotateCode: (roomId: string) => http.post(`/console/rooms/${roomId}/rotate-code`, {}),
  roomGames: (roomId: string) =>
    http.get<RoomGameCfg[], RoomGameCfg[]>(`/console/rooms/${roomId}/games`),
  patchRoomGame: (
    roomId: string,
    gameCode: string,
    data: { enabled?: boolean; robotCount?: number; rebateRate?: number | null },
  ) => http.patch(`/console/rooms/${roomId}/games/${gameCode}`, data),

  players: (params?: { page?: number; pageSize?: number; q?: string; roomId?: string }) =>
    http.get<PlayerPage, PlayerPage>('/console/players', { params }),
  agents: (params?: {
    page?: number
    pageSize?: number
    role?: string
    q?: string
    /** false=含未绑房代理；默认后端按已绑房筛 AGENT */
    boundOnly?: boolean
  }) =>
    http.get<AgentPage, AgentPage>('/console/agents', {
      params: {
        ...params,
        boundOnly:
          params?.boundOnly === false ? '0' : params?.boundOnly === true ? '1' : undefined,
      },
    }),
  agentDetail: (userId: string) =>
    http.get<AgentDetail, AgentDetail>(`/console/agents/${userId}`),
  agentAudit: (
    userId: string,
    params?: { page?: number; pageSize?: number; tab?: 'balance' | 'fund' | 'ops' },
  ) =>
    http.get<AgentAuditPage, AgentAuditPage>(`/console/agents/${userId}/audit`, { params }),
  setCsDuty: (userId: string, dutyUserId: string | null) =>
    http.patch<{ ok: boolean; dutyUserId: string | null }, { ok: boolean; dutyUserId: string | null }>(
      `/console/agents/${userId}/duty`,
      { dutyUserId },
    ),
  setPlayerStatus: (id: string, status: 'ACTIVE' | 'DISABLED') =>
    http.patch(`/console/players/${id}/status`, { status }),
  createAgent: (data: {
    username: string
    password: string
    nickname?: string
    role?: string
    parentAgentUserId?: string
  }) => http.post('/console/agents', data),
  setRebateRate: (userId: string, rate: number) =>
    http.patch(`/console/agents/${userId}/rebate-rate`, { rate }),
  setCommissionRate: (userId: string, rate: number) =>
    http.patch(`/console/agents/${userId}/commission-rate`, { rate }),
  setPlayerFly: (id: string, flyEnabled: boolean, roomId?: string) =>
    http.patch(`/console/players/${id}/fly`, { flyEnabled, roomId }),
  setPlayerRebateRate: (id: string, rate: number, roomId?: string) =>
    http.patch(`/console/players/${id}/rebate-rate`, { rate, roomId }),
  fundRoom: (roomId: string, amount: number, remark?: string) =>
    http.post(`/console/rooms/${roomId}/fund`, { amount, remark }),
  roomPool: (roomId: string) =>
    http.get<{ roomId: string; balance: number }, { roomId: string; balance: number }>(
      `/console/rooms/${roomId}/pool`,
    ),

  controlMeta: () => http.get<ControlMeta, ControlMeta>('/console/control-policies/meta'),
  controlList: () => http.get<ControlPolicy[], ControlPolicy[]>('/console/control-policies'),
  controlCreate: (data: Record<string, unknown>) =>
    http.post('/console/control-policies', data),
  controlStatus: (id: string, status: string) =>
    http.patch(`/console/control-policies/${id}/status`, { status }),
  controlDelete: (id: string) =>
    http.delete(`/console/control-policies/${id}`),

  dashboard: () => http.get<DashboardData, DashboardData>('/console/dashboard'),
  reportSummary: (params?: {
    roomId?: string
    roomIds?: string
    range?: string
    from?: string
    to?: string
  }) =>
    http.get<ReportSummary, ReportSummary>('/console/reports/summary', {
      params,
    }),
  reportByRoom: (params?: {
    roomId?: string
    roomIds?: string
    range?: string
    from?: string
    to?: string
  }) =>
    http.get<ReportByRoomResult, ReportByRoomResult>('/console/reports/by-room', {
      params,
    }),
  reconcile: () => http.get<Reconcile, Reconcile>('/console/reports/reconcile'),
  exportReport: (params?: {
    roomId?: string
    roomIds?: string
    range?: string
    from?: string
    to?: string
  }) =>
    http.get<{ filename: string; csv: string }, { filename: string; csv: string }>(
      '/console/reports/export',
      { params },
    ),

  rebatePolicy: () => http.get<RebatePolicy, RebatePolicy>('/console/rebate-policy'),
  patchRebatePolicy: (data: Partial<RebatePolicy>) =>
    http.patch('/console/rebate-policy', data),
}

export interface WalletMe {
  ownerType: string; ownerId: string; balance: number
  pointsQuota?: number; flyCover?: number; playerPointsTotal?: number; fakeExposure?: number
}
export interface ConsoleRoom {
  id: string; roomNo: string; name: string; title: string | null; status: string
  enabledGames: string[]; memberCount: number
  monthlyFee?: number
  billingDay?: number
  nextBillAt?: string | null
  lastBilledAt?: string | null
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
  owners: { userId: string; uid: string; nickname: string }[]
  createdAt: string
}
export interface RoomGameCfg {
  id: string; roomId: string; gameCode: string; enabled: boolean
  robotCount: number; rebateRate: number | null
}
export interface PlayerPage {
  total: number; page: number; pageSize: number
  list: { id: string; uid: string; username: string; nickname: string; status: string; balance: number; createdAt: string }[]
}
export interface AgentRoomBrief {
  id: string; roomNo: string; name: string; status: string
  monthlyFee?: number; memberCount?: number; openGames?: number
}
export interface AgentPage {
  total: number; page: number; pageSize: number
  list: {
    id: string; uid: string; username: string; nickname: string
    role: string; depth: number; status: string; balance: number
    parentId?: string | null
    commissionRate?: number; rebateRate?: number
    pointsQuota?: number; pointsUsed?: number; flyCover?: number
    parent?: { id: string; nickname: string; username: string; role: string } | null
    rooms?: AgentRoomBrief[]
    roomCount?: number
    memberCount?: number
    staffCount?: number
    onDuty?: boolean
    dutyUserId?: string | null
    createdAt?: string
    lastLoginAt?: string | null
  }[]
}
export interface AgentDetail {
  id: string; uid: string; username: string; nickname: string
  role: string; depth: number; status: string; balance: number
  parentId?: string | null
  commissionRate: number; rebateRate: number
  pointsQuota: number; pointsUsed: number; flyCover: number
  createdAt: string; lastLoginAt?: string | null
  parent?: { id: string; nickname: string; username: string; role: string; uid: string } | null
  rooms: AgentRoomBrief[]
  roomTotal?: number
  dutyUserId?: string | null
  agentRootId?: string
  children: {
    id: string; uid: string; username: string; nickname: string
    role: string; status: string; balance: number
    createdAt: string; lastLoginAt?: string | null; onDuty?: boolean
  }[]
  recentLogs?: {
    id: string; action: string; target: string | null
    createdAt: string; operatorId: string
  }[]
  permissions: {
    label: string; summary: string; can: string[]; cannot: string[]
  }
}
export interface AgentAuditUser {
  id: string; nickname: string; username: string; role: string; uid: string
}
export interface AgentAuditRow {
  id: string
  kind: string
  action: string
  actionLabel: string
  amount: number | null
  balanceAfter: number | null
  remark: string | null
  createdAt: string
  operator: AgentAuditUser | null
  counterparty: AgentAuditUser | null
  detail?: Record<string, unknown>
}
export interface AgentAuditPage {
  tab: 'balance' | 'fund' | 'ops'
  summary: {
    balance: number
    pointsQuota: number
    pointsUsed: number
    flyCover: number
    quotaIn: number
    quotaOut?: number
    playerUp: number
    playerDown: number
    ledgerIn: number
    ledgerOut: number
  }
  total: number
  page: number
  pageSize: number
  list: AgentAuditRow[]
}
export interface ControlMeta {
  model: string
  description: string
  example: string
  stakeMeaning: string
  goalMeaning?: string
  supportedGames: string[]
  allGameCodes?: string[]
  liveGames?: string[]
  minBetCount: number
  exactGuarantee: boolean
  sharedDrawNote: string
  candidateTries?: number
  candidateNote?: string
  safetyMaxDays?: number
  strengthFormula?: {
    expression: string
    examples: Array<{ strength: number; tries: number }>
  }
}
export interface ControlPolicy {
  id: string
  name: string
  roomId: string | null
  gameCode: string | null
  targetType: string
  targetValue: number
  holdRatio?: number
  goalAmount?: number | null
  recoveredAmount?: number
  progressPct?: number | null
  strength: number
  startAt: string
  endAt: string
  status: string
  remark: string | null
  candidateTries?: number
  inWindow?: boolean
  effective?: boolean
  legacyInvalid?: boolean
  windowState?: 'PENDING' | 'RUNNING' | 'ENDED'
  room?: { id: string; name: string; roomNo: string } | null
}
export interface ReportSummary {
  betFlow: number; payout: number; housePnl: number; playerPnl: number; betCount: number
  upAmount: number; downAmount: number; pendingUp: number; pendingDown: number; roomCount: number
  upCount?: number; downCount?: number
  /** 未结算注单（不计入流水/盈亏） */
  pendingBetFlow?: number
  pendingBetCount?: number
  activePlayers?: number; playerCount?: number | null; agentCount?: number; agentRoomCount?: number
  roomPoolTotal?: number; commissionAmount?: number; commissionCount?: number
  netChange?: number
  netPnl?: number
  rangeKey?: string
  range?: {
    from: string
    to: string
    fromText?: string
    toText?: string
    timezone?: string
  }
  byGame?: {
    gameCode: string
    gameName: string
    betCount: number
    betFlow: number
    payout: number
    housePnl: number
  }[]
}
export interface ReportByRoomRow {
  roomId: string
  roomNo: string
  name: string
  status: string
  agentNickname: string | null
  agentUsername: string | null
  memberCount: number
  activePlayers: number
  betCount: number
  betFlow: number
  payout: number
  housePnl: number
  playerPnl: number
  upAmount: number
  upCount: number
  downAmount: number
  downCount: number
  commissionAmount: number
  commissionCount: number
  netPnl: number
  netChange: number
}
export interface ReportByRoomResult {
  rangeKey: string
  range: ReportSummary['range']
  list: ReportByRoomRow[]
}
export interface Cashflow {
  playerBalance: number; upAmount: number; downAmount: number
  playerPnl: number; netChange: number
}
export interface DashboardData {
  summary: ReportSummary
  cashflow?: Cashflow
  reconcile: Reconcile
  byGame: { gameCode: string; gameName?: string; betCount: number; betFlow: number; payout: number; housePnl: number }[]
  recentLogs: { id: string; action: string; target: string | null; detail: unknown; createdAt: string; operator: string }[]
  canReviewRecharge: boolean
}
export interface Reconcile {
  playerCount: number; balanceSum: number
  openingEstimate?: number; upAmount?: number; downAmount?: number
  playerPnl?: number; closingCheck?: number; drift?: number; formula?: string
}
export interface RebatePolicy {
  id: number; minRate: number; maxRate: number; defaults: unknown
  totalRate?: number; playerMinRate?: number
}
