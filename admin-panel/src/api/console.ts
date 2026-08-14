import http from './http'
import {
  toFiniteNumber,
  toOptionalFiniteNumber,
  type NumericValue,
} from './number'

/** 运营控制台 API（console/...）；与 client-app staffConsole 路径对齐，并含管理端专有接口 */
export const consoleApi = {
  // ── 钱包 / 上下分 ──
  walletMe: () => http.get<WalletMe, WalletMe>('/console/wallet/me'),

  issue: (toUserId: string, amount: number, clientRequestId: string, remark?: string) =>
    http.post('/console/wallet/issue', { toUserId, amount, remark, clientRequestId }),

  /** 回收代理/子账号额度（下分） */
  recall: (fromUserId: string, amount: number, clientRequestId: string, remark?: string) =>
    http.post('/console/wallet/recall', { fromUserId, amount, remark, clientRequestId }),

  /** 给玩家上分（须带房间与订单号，同号重试不重复加分） */
  creditPlayer: (
    playerId: string,
    amount: number,
    roomId: string,
    remark: string | undefined,
    clientRequestId: string,
  ) =>
    http
      .post<PlayerFundResultWire, PlayerFundResultWire>('/console/wallet/credit-player', {
        playerId,
        amount,
        roomId,
        remark,
        clientRequestId,
      })
      .then(normalizePlayerFundResult),

  /** 给玩家下分（须带房间与订单号，同号重试不重复扣分） */
  debitPlayer: (
    playerId: string,
    amount: number,
    roomId: string,
    remark: string | undefined,
    clientRequestId: string,
  ) =>
    http
      .post<PlayerFundResultWire, PlayerFundResultWire>('/console/wallet/debit-player', {
        playerId,
        amount,
        roomId,
        remark,
        clientRequestId,
      })
      .then(normalizePlayerFundResult),

  // ── 进房审核 ──
  joinPending: () =>
    http.get<JoinPendingPage, JoinPendingPage>('/console/room-members/pending'),

  joinApprove: (id: string) =>
    http.post<{ ok?: boolean; status?: string }, { ok?: boolean; status?: string }>(
      `/console/room-members/${id}/approve`,
    ),

  joinReject: (id: string) =>
    http.post<{ ok?: boolean; status?: string }, { ok?: boolean; status?: string }>(
      `/console/room-members/${id}/reject`,
    ),

  // ── 房间 ──
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
    bookMode?: 'CASH' | 'CREDIT' | string
    generalAgentUserId?: string
    agentFlowRate?: number
    agentShareRate?: number
    creditLimit?: number
    overIssueLimit?: number
    settleCycle?: string
    /** 建房可选：房间图标 data URL */
    iconImage?: string
  }) =>
    http.post<{
      id: string
      roomNo: string
      name: string
      icon?: string
      status: string
      monthlyFee: number
      billingDay: number
      nextBillAt: string | null
      agent: { id: string; uid: string; username: string; password: string; nickname: string }
    }, {
      id: string
      roomNo: string
      name: string
      icon?: string
      status: string
      monthlyFee: number
      billingDay: number
      nextBillAt: string | null
      agent: { id: string; uid: string; username: string; password: string; nickname: string }
    }>('/console/rooms', data),

  uploadRoomIcon: (roomId: string, image: string) =>
    http.patch<{ icon: string }, { icon: string }>(
      `/console/rooms/${roomId}/icon`,
      { image },
      { timeout: 30000 },
    ),

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

  /** 整房飞盘开/关（仅主代理） */
  setRoomFly: (roomId: string, flyEnabled: boolean) =>
    http.patch<{
      ok: boolean
      flyEnabled: boolean
      updated: number
      message?: string
    }, {
      ok: boolean
      flyEnabled: boolean
      updated: number
      message?: string
    }>(`/console/rooms/${roomId}/fly`, { flyEnabled }),

  /** 总代整房飞盘：开=飞向平台，关=总代坐庄 */
  setGeneralRoomFly: (roomId: string, flyEnabled: boolean) =>
    http.patch<{
      ok: boolean
      flyEnabled: boolean
      message?: string
    }, {
      ok: boolean
      flyEnabled: boolean
      message?: string
    }>(`/console/rooms/${roomId}/general-fly`, { flyEnabled }),

  /** 信用盘：永久加减合同额度与剩余信用 */
  bumpCreditLimit: (
    roomId: string,
    data: { amount: number; direction?: 'up' | 'down'; remark?: string },
  ) =>
    http.post<{
      ok: boolean
      creditLimitBefore: number
      bumped: number
      direction?: string
      creditLimit: number
      excessAfter: number
      message?: string
    }, {
      ok: boolean
      creditLimitBefore: number
      bumped: number
      direction?: string
      creditLimit: number
      excessAfter: number
      message?: string
    }>(`/console/rooms/${roomId}/credit-limit/bump`, data),

  deleteRoom: (roomId: string, adminPassword: string) =>
    http.post<{ ok: boolean; mode: string; message: string }, { ok: boolean; mode: string; message: string }>(
      `/console/rooms/${roomId}/delete`,
      { adminPassword },
    ),

  roomGames: (roomId: string) =>
    http.get<RoomGameCfg[], RoomGameCfg[]>(`/console/rooms/${roomId}/games`),

  patchRoomGame: (
    roomId: string,
    gameCode: string,
    data: {
      enabled?: boolean
      robotCount?: number
      rebateRate?: number | null
      robotPlan?: RobotPlan
    },
  ) => http.patch(`/console/rooms/${roomId}/games/${gameCode}`, data),

  // ── 占成结账 ──
  roomWeekSettle: (roomId: string) =>
    http.get<RoomWeekSettleOverview, RoomWeekSettleOverview>(
      `/console/rooms/${roomId}/week-settle`,
    ),

  roomWeekSettleStatement: (
    roomId: string,
    params?: { period?: 'current' | 'last' | 'early'; weekStart?: string },
  ) =>
    http.get<RoomSettleStatement, RoomSettleStatement>(
      `/console/rooms/${roomId}/week-settle/statement`,
      { params },
    ),

  exportRoomWeekSettle: (
    roomId: string,
    params?: { period?: 'current' | 'last' | 'early'; weekStart?: string },
  ) =>
    http.get<{ filename: string; csv: string }, { filename: string; csv: string }>(
      `/console/rooms/${roomId}/week-settle/export`,
      { params },
    ),

  markRoomWeekSettle: (
    roomId: string,
    data?: { weekStart?: string; note?: string; early?: boolean },
  ) => http.post(`/console/rooms/${roomId}/week-settle/mark`, data || {}),

  /** 信用盘：确认线下已交割实付 */
  confirmRoomWeekSettlePayment: (
    roomId: string,
    data: { settleId?: string; weekStart?: string; note?: string },
  ) => http.post(`/console/rooms/${roomId}/week-settle/confirm-payment`, data),

  // ── 玩家 / 代理 ──
  players: (params?: { page?: number; pageSize?: number; q?: string; roomId?: string }) =>
    http.get<PlayerPage, PlayerPage>('/console/players', { params }),

  playerDetail: (id: string, params?: { roomId?: string }) =>
    http
      .get<PlayerDetailWire, PlayerDetailWire>(`/console/players/${id}`, { params })
      .then(normalizePlayerDetail),

  /** 把 friendUid（下级）挂到 underUid（推荐人）名下；仅主代理；按 roomId 隔离 */
  hangPlayer: (friendUid: string, underUid: string, roomId?: string) =>
    http.post<{
      ok: boolean
      message?: string
      roomId?: string
      friend?: { uid: string; nickname: string }
      under?: { uid: string; nickname: string }
    }, {
      ok: boolean
      message?: string
      roomId?: string
      friend?: { uid: string; nickname: string }
      under?: { uid: string; nickname: string }
    }>('/console/players/hang', { friendUid, underUid, roomId }),

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
    params?: {
      page?: number
      pageSize?: number
      tab?: 'balance' | 'fund' | 'ops' | 'wage'
      from?: string
      to?: string
      fundType?: string
    },
  ) =>
    http.get<AgentAuditPage, AgentAuditPage>(`/console/agents/${userId}/audit`, { params }),

  setCsDuty: (userId: string, dutyUserId: string | null) =>
    http.patch<{ ok: boolean; dutyUserId: string | null }, { ok: boolean; dutyUserId: string | null }>(
      `/console/agents/${userId}/duty`,
      { dutyUserId },
    ),

  setProxyStatus: (userId: string, status: 'ACTIVE' | 'DISABLED') =>
    http.patch<{ id: string; status: string }, { id: string; status: string }>(
      `/console/agents/${userId}/status`,
      { status },
    ),

  resetProxyPassword: (userId: string, password?: string) =>
    http.post<{
      ok: boolean
      username: string
      password: string
      message?: string
    }, {
      ok: boolean
      username: string
      password: string
      message?: string
    }>(`/console/agents/${userId}/reset-password`, { password }),

  renameProxyNickname: (userId: string, nickname: string) =>
    http.patch<{ id: string; nickname: string }, { id: string; nickname: string }>(
      `/console/agents/${userId}/nickname`,
      { nickname },
    ),

  setPlayerStatus: (id: string, status: 'ACTIVE' | 'DISABLED') =>
    http.patch(`/console/players/${id}/status`, { status }),

  /** 重置玩家密码并解冻（仅管理员 / 房主） */
  resetPlayerPassword: (id: string, password?: string) =>
    http.post<{
      ok: boolean
      username: string
      password: string
      message?: string
    }, {
      ok: boolean
      username: string
      password: string
      message?: string
    }>(`/console/players/${id}/reset-password`, { password }),

  createAgent: (data: {
    username: string
    password: string
    nickname?: string
    role?: string
    parentAgentUserId?: string
    flowRate?: number
    shareRate?: number
    /** 以下三项仅总代：与平台的盘口、合同额度、结算周期 */
    bookMode?: 'CASH' | 'CREDIT'
    creditLimit?: number
    settleCycle?: string
  }) => http.post('/console/agents', data),

  setCommissionRate: (userId: string, rate: number) =>
    http.patch(`/console/agents/${userId}/commission-rate`, { rate }),

  setPlayerFly: (id: string, flyEnabled: boolean, roomId?: string) =>
    http.patch(`/console/players/${id}/fly`, { flyEnabled, roomId }),

  setPlayerRebateRate: (id: string, rate: number, roomId?: string) =>
    http.patch(`/console/players/${id}/rebate-rate`, { rate, roomId }),

  // ── 客服账号 / 佣金 ──
  csStaffMe: () =>
    http
      .get<CsStaffDetailWire, CsStaffDetailWire>('/console/cs-staff/me')
      .then(normalizeCsStaffDetail),

  csStaffList: (params?: { parentAgentUserId?: string }) =>
    http.get<CsStaffRow[], CsStaffRow[]>('/console/cs-staff', { params }),

  csStaffCreate: (data?: {
    username?: string
    password?: string
    nickname?: string
    parentAgentUserId?: string
  }) => http.post<CsStaffCreated, CsStaffCreated>('/console/cs-staff', data ?? {}),

  /** clientRequestId 必填：兼作订单号与幂等键，同号重试不会重复划账 */
  csStaffAllocate: (id: string, amount: number, clientRequestId: string) =>
    http.post<CsStaffFundResult, CsStaffFundResult>(
      `/console/cs-staff/${id}/allocate`,
      { amount, clientRequestId },
    ),

  csStaffRecall: (id: string, amount: number, clientRequestId: string) =>
    http.post<CsStaffFundResult, CsStaffFundResult>(
      `/console/cs-staff/${id}/recall`,
      { amount, clientRequestId },
    ),

  csStaffPatch: (
    id: string,
    data: { wageRate?: number; idleWeight?: number; workStatus?: string; nickname?: string },
  ) =>
    http
      .patch<CsStaffDetailWire, CsStaffDetailWire>(`/console/cs-staff/${id}`, data)
      .then(normalizeCsStaffDetail),

  csStaffSetStatus: (id: string, status: 'ACTIVE' | 'DISABLED') =>
    http.patch<{ ok?: boolean; status?: string }, { ok?: boolean; status?: string }>(
      `/console/cs-staff/${id}/status`,
      { status },
    ),

  csStaffResetPassword: (id: string, password?: string) =>
    http.post<{
      ok: boolean
      username: string
      password: string
      message?: string
    }, {
      ok: boolean
      username: string
      password: string
      message?: string
    }>(`/console/cs-staff/${id}/reset-password`, { password }),

  csWageBills: (params?: {
    csUserId?: string
    status?: 'PENDING' | 'SETTLED' | 'ALL' | string
    page?: number
    pageSize?: number
  }) =>
    http
      .get<CsWageBillPageWire, CsWageBillPageWire>('/console/cs-staff/wage/bills', { params })
      .then(normalizeCsWageBillPage),

  csWageSettle: (data: { billId?: string; csUserId?: string }) =>
    http.post<CsWageSettleResult, CsWageSettleResult>('/console/cs-staff/wage/settle', data),

  // ── 控奖 ──
  controlGames: () =>
    http.get<ControlGamesResult, ControlGamesResult>('/console/control-games'),

  controlList: () => http.get<ControlPolicy[], ControlPolicy[]>('/console/control-policies'),

  controlCreate: (data: Record<string, unknown>) =>
    http.post('/console/control-policies', data),

  controlStatus: (id: string, status: string, adminPassword: string) =>
    http.patch(`/console/control-policies/${id}/status`, { status, adminPassword }),

  controlDelete: (id: string, adminPassword: string) =>
    http.delete(`/console/control-policies/${id}`, { data: { adminPassword } }),

  globalSoftControl: () =>
    http.get<GlobalSoftControlOverview, GlobalSoftControlOverview>('/console/global-soft-control'),

  verifyAdminPassword: (password: string) =>
    http.post<{ ok: boolean }, { ok: boolean }>('/console/verify-admin-password', { password }),

  saveGlobalSoftControl: (
    data: Partial<GlobalSoftControlConfig> & { enabled?: boolean; adminPassword?: string },
  ) =>
    http.put<GlobalSoftControlOverview, GlobalSoftControlOverview>('/console/global-soft-control', data),

  softBiasList: () =>
    http.get<GlobalSoftBias[], GlobalSoftBias[]>('/console/global-soft-biases'),

  /* 偏置能左右开奖结果，写操作与改软控参数同级：一律带管理员密码 */
  softBiasCreate: (data: {
    kind: string
    roomId: string
    playerId?: string | null
    biasPct?: number
    goalAmount?: number
    weight?: string
    remark?: string
    enabled?: boolean
    adminPassword: string
  }) => http.post<GlobalSoftBias[], GlobalSoftBias[]>('/console/global-soft-biases', data),

  softBiasSetEnabled: (id: string, enabled: boolean, adminPassword: string) =>
    http.patch<GlobalSoftBias[], GlobalSoftBias[]>(
      `/console/global-soft-biases/${id}`,
      { enabled, adminPassword },
    ),

  softBiasDelete: (id: string, adminPassword: string) =>
    http.delete<{ ok: boolean }, { ok: boolean }>(
      `/console/global-soft-biases/${id}`,
      { data: { adminPassword } },
    ),



  // ── 工作台 / 报表 ──
  dashboard: () => http.get<DashboardData, DashboardData>('/console/dashboard'),

  dashboardTrend: (days = 7) =>
    http.get<DashboardTrendPoint[], DashboardTrendPoint[]>('/console/dashboard/trend', {
      params: { days },
    }),

  reportSummary: (params?: {
    roomId?: string
    roomIds?: string
    range?: string
    from?: string
    to?: string
  }) =>
    http.get<ReportSummary, ReportSummary>('/console/reports/summary', { params }),

  reportByRoom: (params?: {
    roomId?: string
    roomIds?: string
    range?: string
    from?: string
    to?: string
  }) =>
    http.get<ReportByRoomResult, ReportByRoomResult>('/console/reports/by-room', { params }),

  reportRoomBets: (params: {
    roomId: string
    range?: string
    from?: string
    to?: string
    page?: number
    pageSize?: number
    playerId?: string
    gameCode?: string
  }) =>
    http.get<ReportRoomBetsResult, ReportRoomBetsResult>('/console/reports/room-bets', {
      params,
    }),

  /** 代理团队玩家有效流水榜 */
  playerFlow: (params?: { range?: string; limit?: number; playerId?: string }) =>
    http
      .get<PlayerFlowResultWire, PlayerFlowResultWire>('/console/reports/player-flow', { params })
      .then(normalizePlayerFlowResult),

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

  // ── 回水策略 ──
  rebatePolicy: () => http.get<RebatePolicy, RebatePolicy>('/console/rebate-policy'),

  patchRebatePolicy: (data: Partial<RebatePolicy>) =>
    http.patch('/console/rebate-policy', data),
}

// ─── 类型 ───────────────────────────────────────────────

type PlayerFundResultWire = Omit<
  PlayerFundResult,
  'real' | 'overIssue' | 'fake' | 'wage'
> & {
  real?: NumericValue
  overIssue?: NumericValue
  fake?: NumericValue
  wage?: NumericValue
}

/** 玩家上下分接口返回 */
export interface PlayerFundResult {
  ok?: boolean
  orderNo?: string
  real?: number
  overIssue?: number
  fake?: number
  wage?: number
}

function normalizePlayerFundResult(result: PlayerFundResultWire): PlayerFundResult {
  return {
    ...result,
    real: toOptionalFiniteNumber(result.real, 'PlayerFundResult.real') ?? undefined,
    overIssue:
      toOptionalFiniteNumber(result.overIssue, 'PlayerFundResult.overIssue') ?? undefined,
    fake: toOptionalFiniteNumber(result.fake, 'PlayerFundResult.fake') ?? undefined,
    wage: toOptionalFiniteNumber(result.wage, 'PlayerFundResult.wage') ?? undefined,
  }
}

export interface WalletMe {
  ownerType: string
  ownerId: string
  balance: number | null
  /** 管理员/房主：无个人钱包，上下分走平台池 */
  noPersonalWallet?: boolean
  poolMode?: boolean
  pointsQuota?: number
  flyCover?: number
  /** 现金盘可飞额度（与 flyCover 同口径） */
  flyAvailable?: number
  playerPointsTotal?: number
  csBalances?: number
  /** 未进玩家账：现金=桌额度+客服；信用=剩余信用+客服 */
  diskPoolRemaining?: number
  /** 信用盘顶栏：未发总额 */
  creditUnused?: number
  overIssueUsed?: number
  overIssueLimit?: number
  fakeExposure?: number
  /** 主房账本：CASH=现金盘 | CREDIT=信用盘；总代则是他与平台的盘口 */
  bookMode?: 'CASH' | 'CREDIT' | string
  creditLimit?: number
  agentShareRate?: number
  settleCycle?: string
  primaryRoomId?: string
  /** 总代自己的费率：建房时代理的流水/占成上限就是这两个值 */
  flowRate?: number
  shareRate?: number
}

export interface ConsoleRoomFly {
  onCount: number
  offCount: number
  memberCount: number
  effective: boolean
  flyCover: number
}

export interface ConsoleRoom {
  id: string
  roomNo: string
  name: string
  title: string | null
  status: string
  enabledGames: string[]
  memberCount: number
  monthlyFee?: number
  billingDay?: number
  nextBillAt?: string | null
  lastBilledAt?: string | null
  bookMode?: 'CASH' | 'CREDIT' | string
  creditLimit?: number
  agentShareRate?: number
  settleCycle?: string
  generalFlyEnabled?: boolean
  general?: {
    agentId: string
    userId: string
    uid: string
    nickname: string
    username: string
    flowRate?: number
    shareRate?: number
  } | null
  fly?: ConsoleRoomFly
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
    diskPoolRemaining?: number
    csBalances?: number
  } | null
  owners: { userId: string; uid: string; nickname: string }[]
  createdAt: string
}

export interface RobotDaySlot {
  key: 'morning' | 'afternoon' | 'peak' | 'night'
  startHour: number
  endHour: number
  count: number
}

export interface RobotPlan {
  scheme: 'OFF' | 'LIGHT' | 'NORMAL' | 'HEAVY' | 'CUSTOM'
  betStyle: 'follow' | 'random' | 'hedge'
  intensity: number
  winBias: number
  robotCount: number
  remark?: string
  /** 可选筹码 */
  amounts?: number[]
  /** 可选玩法编码 */
  plays?: string[]
  timing?: {
    startAfterOpenSec: number
    stopBeforeLockSec: number
    intervalSec: number
  }
  fundTalk?: {
    enabled: boolean
    upAmounts: number[]
    downAmounts: number[]
  }
  /** 上海时区：上午/下午/高峰/夜间 分时人数 */
  daySlots?: RobotDaySlot[]
}

export interface RoomGameCfg {
  id: string
  roomId: string
  gameCode: string
  enabled: boolean
  robotCount: number
  rebateRate: number | null
  robotPlan?: RobotPlan | null
}

export interface PlayerParentBrief {
  id: string
  uid: string
  nickname: string
  username: string
  role?: string
}

export interface PlayerDetail {
  id: string
  uid: string
  username: string
  nickname: string
  status: string
  balance: number
  createdAt: string
  lastLoginAt?: string | null
  /** 最近登录公网 IP */
  lastLoginIp?: string | null
  flyEnabled?: boolean
  playerRebateRate?: number | null
  roomId?: string | null
  room?: { id: string; roomNo: string; name: string } | null
  parent?: PlayerParentBrief | null
  children: Array<{
    id: string
    uid: string
    nickname: string
    username: string
    status: string
    createdAt: string
    balance: number
  }>
  childCount: number
}

type PlayerDetailWire = Omit<PlayerDetail, 'balance' | 'children'> & {
  balance: NumericValue
  children: Array<Omit<PlayerDetail['children'][number], 'balance'> & { balance: NumericValue }>
}

function normalizePlayerDetail(detail: PlayerDetailWire): PlayerDetail {
  return {
    ...detail,
    balance: toFiniteNumber(detail.balance, 'PlayerDetail.balance'),
    children: detail.children.map((child) => ({
      ...child,
      balance: toFiniteNumber(child.balance, 'PlayerDetail.children.balance'),
    })),
  }
}

export interface PlayerPage {
  total: number
  page: number
  pageSize: number
  list: {
    id: string
    uid: string
    username: string
    nickname: string
    status: string
    balance: number
    createdAt: string
    lastLoginAt?: string | null
    lastLoginIp?: string | null
    /** 本房飞盘：开=跟平台结算；关=跟代理结算 */
    flyEnabled?: boolean
    playerRebateRate?: number | null
    /** 直属下级人数 */
    childCount?: number
    parent?: PlayerParentBrief | null
  }[]
}

export interface JoinPendingRow {
  id: string
  playerId: string
  roomId: string
  status: string
  createdAt: string
  updatedAt: string
  player: { id: string; uid: string; nickname: string; username: string }
  room: { id: string; roomNo: string; name: string }
}

export interface JoinPendingPage {
  total: number
  list: JoinPendingRow[]
}

export interface AgentRoomBrief {
  id: string
  roomNo: string
  name: string
  status: string
  monthlyFee?: number
  memberCount?: number
  openGames?: number
  bookMode?: string
}

export interface AgentPage {
  total: number
  page: number
  pageSize: number
  list: {
    id: string
    uid: string
    username: string
    nickname: string
    role: string
    depth: number
    status: string
    balance: number
    parentId?: string | null
    commissionRate?: number
    rebateRate?: number
    flowRate?: number
    shareRate?: number
    /** 仅总代：与平台的盘口、合同额度、结算周期 */
    bookMode?: 'CASH' | 'CREDIT'
    creditLimit?: number
    settleCycle?: string
    pointsQuota?: number
    pointsUsed?: number
    flyCover?: number
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
  id: string
  uid: string
  username: string
  nickname: string
  role: string
  depth: number
  status: string
  balance: number
  parentId?: string | null
  commissionRate: number
  rebateRate: number
  pointsQuota: number
  pointsUsed: number
  flyCover: number
  createdAt: string
  lastLoginAt?: string | null
  parent?: { id: string; nickname: string; username: string; role: string; uid: string } | null
  rooms: AgentRoomBrief[]
  roomTotal?: number
  dutyUserId?: string | null
  agentRootId?: string
  children: {
    id: string
    uid: string
    username: string
    nickname: string
    role: string
    status: string
    balance: number
    createdAt: string
    lastLoginAt?: string | null
    onDuty?: boolean
  }[]
  recentLogs?: {
    id: string
    action: string
    target: string | null
    createdAt: string
    operatorId: string
  }[]
  permissions: {
    label: string
    summary: string
    can: string[]
    cannot: string[]
  }
}

export interface AgentAuditUser {
  id: string
  nickname: string
  username: string
  role: string
  uid: string
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
  /** 上下分订单号 */
  orderNo?: string | null
  /** 上分 / 下分 */
  method?: string | null
  operator: AgentAuditUser | null
  counterparty: AgentAuditUser | null
  detail?: Record<string, unknown>
}

export interface AgentAuditFundTotals {
  count: number
  quotaIn: number
  quotaOut: number
  playerUp: number
  playerDown: number
  csAlloc: number
  csRecall: number
}

export interface AgentAuditPage {
  tab: 'balance' | 'fund' | 'ops' | 'wage'
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
  fundTotals?: AgentAuditFundTotals
  total: number
  page: number
  pageSize: number
  list: AgentAuditRow[]
}

export interface CsStaffRow {
  id: string
  uid: string
  username: string
  nickname: string
  status: string
  balance: number
  wageRate: number
  idleWeight: number
  workStatus: string
  parentAgentUserId?: string | null
  parentAgentNickname?: string
  pendingWage?: number
  pendingWageCount?: number
  createdAt: string
}

export interface CsStaffFundResult {
  ok: boolean
  orderNo: string
  balance: number
}

export interface CsStaffCreated {
  id: string
  uid: string
  username: string
  password: string
  nickname: string
  parentAgentUserId?: string
}

export interface CsStaffDetail {
  id: string
  uid: string
  username: string
  nickname: string
  status: string
  balance: number
  wageRate: number
  idleWeight: number
  workStatus: string
  pendingWage?: number
  pendingWageCount?: number
  todayWage?: number
  totalWage?: number
  todayWageCount?: number
  totalWageCount?: number
}

type CsStaffDetailWire = Omit<
  CsStaffDetail,
  | 'balance'
  | 'wageRate'
  | 'pendingWage'
  | 'todayWage'
  | 'totalWage'
> & {
  balance: NumericValue
  wageRate: NumericValue
  pendingWage?: NumericValue
  todayWage?: NumericValue
  totalWage?: NumericValue
}

function normalizeCsStaffDetail(detail: CsStaffDetailWire): CsStaffDetail {
  return {
    ...detail,
    balance: toFiniteNumber(detail.balance, 'CsStaffDetail.balance'),
    wageRate: toFiniteNumber(detail.wageRate, 'CsStaffDetail.wageRate'),
    pendingWage:
      toOptionalFiniteNumber(detail.pendingWage, 'CsStaffDetail.pendingWage') ?? undefined,
    todayWage: toOptionalFiniteNumber(detail.todayWage, 'CsStaffDetail.todayWage') ?? undefined,
    totalWage: toOptionalFiniteNumber(detail.totalWage, 'CsStaffDetail.totalWage') ?? undefined,
  }
}

export interface CsWageBillRow {
  id: string
  kind: 'UP' | 'DOWN' | string
  fundAmount: number
  wageAmount: number
  wageRate: number
  status: 'PENDING' | 'SETTLED' | string
  playerId: string
  playerNickname: string
  playerUid: string
  settledAt?: string | null
  createdAt: string
}

export interface CsWageBillPage {
  total: number
  page: number
  pageSize: number
  list: CsWageBillRow[]
}

type CsWageBillRowWire = Omit<CsWageBillRow, 'fundAmount' | 'wageAmount' | 'wageRate'> & {
  fundAmount: NumericValue
  wageAmount: NumericValue
  wageRate: NumericValue
}
type CsWageBillPageWire = Omit<CsWageBillPage, 'list'> & { list: CsWageBillRowWire[] }

function normalizeCsWageBillPage(page: CsWageBillPageWire): CsWageBillPage {
  return {
    ...page,
    list: (page.list || []).map((row) => ({
      ...row,
      fundAmount: toFiniteNumber(row.fundAmount, 'CsWageBillRow.fundAmount'),
      wageAmount: toFiniteNumber(row.wageAmount, 'CsWageBillRow.wageAmount'),
      wageRate: toFiniteNumber(row.wageRate, 'CsWageBillRow.wageRate'),
    })),
  }
}

export interface CsWageSettleResult {
  settledCount: number
  settledAmount: number
  remainingPending: number
  message?: string
  shortfall?: number
}

export interface ControlGameOpt {
  code: string
  name: string
}

export interface ControlGamesResult {
  lottery: ControlGameOpt[]
  table: ControlGameOpt[]
  arcade: ControlGameOpt[]
  slot: ControlGameOpt[]
}

export interface ControlPolicy {
  id: string
  name: string
  roomId: string | null
  gameCode: string | null
  targetType: string
  mode?: string
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
  player?: { id: string; nickname: string; username: string; uid: string } | null
  haltedConflict?: number
}

export interface GlobalSoftControlConfig {
  enabled: boolean
  minFlowToControl: number
  targetNetPct: number
  bandLowPct: number
  bandHighPct: number
  maxPeriodWinPct: number
  maxPeriodLossPct: number
  /** 只读：回水规则·回水总额%，不可在软控里改 */
  commissionRatePct: number
  candidateTries: number
  /** HALT 偏热回拉试号 */
  candidateTriesHalt: number
  candidateTriesBoost: number
  playerBrakeEnabled: boolean
  playerBrakeMultiple: number
  /** 街机+电子池目标返还率 0~1 */
  arcadeRtpTarget: number
  /** 街机池试号（与共盘 candidateTries 解耦） */
  arcadeCandidateTries: number
  /** 街机池统计窗口天数；窗口外盈亏永久落袋 */
  arcadePoolWindowDays: number
  /** @deprecated 控后冷却已停用（冷却期会让出防爆权） */
  cooldownEnabled: boolean
  /** 慢性失血档位开关 */
  gearMode: 'AUTO' | 'FORCE_NORMAL' | 'FORCE_RECOVER'
}

export interface PeriodGuardParams {
  openLossPct: number
  targetLossPct: number
  wipeoutPayoutPct: number
  smallLossAmount: number
  bigLossAmount: number
  cycleLossPctOfProfit: number
  cycleProfitFloor: number
  minPlayers: number
  minStake: number
}

export interface GlobalSoftBias {
  id: string
  kind: 'ROOM_RECOVER' | 'ROOM_RELEASE' | 'PLAYER_WIN' | 'PLAYER_LOSE' | string
  kindLabel: string
  roomId: string
  room?: { id: string; name: string; roomNo: string } | null
  playerId: string | null
  player?: { id: string; nickname: string; username: string; uid: string } | null
  biasPct: number | null
  biasPctLabel: string | null
  goalAmount: number | null
  progressAmount: number | null
  progressPct: number | null
  strengthLabel: string
  exhausted?: boolean
  enabled: boolean
  remark: string | null
  createdAt: string
  updatedAt: string
}

export interface GlobalSoftControlOverview {
  config: GlobalSoftControlConfig
  stats: {
    from: string
    to: string
    stake: number
    payout: number
    house: number
    commission: number
    commissionActual: number
    commissionEst: number
    netPct: number | null
    betCount: number
    targetHouseNet: number
    gapToTarget: number
    minFlowToControl: number
    underMinFlow: boolean
  }
  /** 每个街机/电子游戏一口独立资金池 */
  arcadePools?: Array<{
    gameCode: string
    name: string
    stake: number
    payout: number
    balance: number
    rtp: number | null
    betCount: number
    targetBalance: number
    targetRtp: number
    balanceGap: number
    /** 池只统计最近这么多天；更早的盈亏已落袋 */
    windowDays: number
  }>
  mode: 'IDLE' | 'STEER' | 'BOOST' | 'HALT' | 'OFF'
  modeLabel: string
  /** 上海整点小时档，如 2026-08-07 21时 */
  modeHour?: string
  modeHourNote?: string
  /** @deprecated 控后冷却已停用 */
  cooldown?: {
    enabled: boolean
    redisOk: boolean
    activeGameCodes: string[]
    games: Array<{ gameCode: string; name: string; active: boolean }>
  }
  /** 慢性失血档位：48h 周期账定档，只收紧单期门槛 */
  gear?: {
    mode: 'AUTO' | 'FORCE_NORMAL' | 'FORCE_RECOVER'
    cycleHours: number
    games: Array<{
      gameCode: string
      name: string
      stake: number
      profit: number
      netPct: number | null
      gear: 'NORMAL' | 'RECOVER' | 'STRONG'
    }>
    params: {
      normal: PeriodGuardParams
      recover: PeriodGuardParams
      strong: PeriodGuardParams
    }
    enterRecoverPct: number
    enterStrongPct: number
    exitPct: number
    minCycleFlow: number
  }
  updatedAt: string
}

export interface ReportSummary {
  betFlow: number
  payout: number
  housePnl: number
  playerPnl: number
  betCount: number
  upAmount: number
  downAmount: number
  pendingUp: number
  pendingDown: number
  roomCount: number
  upCount?: number
  downCount?: number
  /** 未结算注单（不计入流水/盈亏） */
  pendingBetFlow?: number
  pendingBetCount?: number
  activePlayers?: number
  playerCount?: number | null
  agentCount?: number
  agentRoomCount?: number
  roomPoolTotal?: number
  commissionAmount?: number
  commissionCount?: number
  platformShareAmount?: number
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

export interface ReportRoomBetRow {
  id: string
  betNo: string
  playerId: string
  playerNickname: string
  playerUid?: string | null
  playerUsername?: string | null
  gameCode: string
  gameName: string
  betType?: string | null
  amount: number
  payout: number
  playerPnl: number
  status: string
  createdAt: string
  settledAt?: string | null
}

export interface ReportRoomBetsResult {
  total: number
  page: number
  pageSize: number
  range?: ReportSummary['range']
  list: ReportRoomBetRow[]
}

export interface PlayerFlowRow {
  playerId: string
  uid: string
  nickname: string
  avatar: string | null
  validFlow: number
  betCount: number
}

export interface PlayerFlowResult {
  range: 'yesterday' | 'today' | string
  from?: string
  to?: string
  list: PlayerFlowRow[]
}

type PlayerFlowResultWire = Omit<PlayerFlowResult, 'list'> & {
  list: Array<Omit<PlayerFlowRow, 'validFlow'> & { validFlow: NumericValue }>
}

function normalizePlayerFlowResult(result: PlayerFlowResultWire): PlayerFlowResult {
  return {
    ...result,
    list: (result.list || []).map((row) => ({
      ...row,
      validFlow: toFiniteNumber(row.validFlow, 'PlayerFlowRow.validFlow'),
    })),
  }
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
  agentShareRate: number
  agentShareAmount: number
  platformShareAmount: number
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
  playerBalance: number
  upAmount: number
  downAmount: number
  playerPnl: number
  netChange: number
}

export interface DashboardTrendPoint {
  date: string
  betFlow: number
  pnl: number
  newUsers: number
}

export interface DashboardData {
  summary: ReportSummary
  cashflow?: Cashflow
  reconcile: Reconcile
  byGame: {
    gameCode: string
    gameName?: string
    betCount: number
    betFlow: number
    payout: number
    housePnl: number
  }[]
  recentLogs: {
    id: string
    action: string
    target: string | null
    detail: unknown
    createdAt: string
    operator: string
  }[]
  canReviewRecharge: boolean
  books?: {
    roomCount: number
    cashRooms: number
    creditRooms: number
  }
  settle?: {
    lastWeekPending: number
    lastWeekStart: string
    thisWeekStart: string
    thisWeekEnd: string
    pendingRooms?: Array<{ id: string; roomNo: string; name: string }>
  }
  share?: {
    rate: number | null
    ratePct: number | null
    weekBetFlow: number
    weekHousePnl: number
    weekAgentShare: number
    weekPlatformShare: number
  }
  agentQuota?: {
    issueAmount: number
    issueCount: number
    recallAmount: number
    recallCount: number
  }
}

export interface Reconcile {
  playerCount: number
  balanceSum: number
  openingEstimate?: number
  upAmount?: number
  downAmount?: number
  playerPnl?: number
  closingCheck?: number
  drift?: number
  formula?: string
}

export interface RebatePolicy {
  id: number
  minRate: number
  maxRate: number
  defaults: unknown
  totalRate?: number
  playerMinRate?: number
  generalDefaultRate?: number
  generalMaxRate?: number
  agentDefaultRate?: number
}

/** 信用盘实时账本快照 */
export interface CreditBookSnapshot {
  creditLimit: number
  pointsQuota: number
  playerBalances: number
  csBalances: number
  sum: number
  excess: number
  newQuota: number
  platformPayToAgent: number
  agentShareAmount: number
  platformShareAmount: number
  housePnl: number
  agentShareRate?: number
}

export interface RoomWeekSlice {
  weekStart: string
  weekEnd: string
  fromText: string
  toText: string
  status: string
  betFlow: number
  payout?: number
  housePnl: number
  betCount?: number
  agentShareAmount: number
  platformShareAmount: number
}

export interface RoomWeekSettleOverview {
  contract: {
    bookMode: 'CASH' | 'CREDIT'
    bookLabel: string
    agentShareRate: number
    agentSharePct: number
    platformSharePct: number
    creditLimit: number
    settleCycle?: string
    settleLabel?: string
    settleWeekday: number
  }
  /** 信用盘实时账本；现金盘为 null */
  creditBook?: CreditBookSnapshot | null
  currentWeek: RoomWeekSlice
  lastWeek: RoomWeekSlice & {
    canMarkSettled?: boolean
    settledAt?: string | null
    creditRestored?: boolean
    id?: string | null
  }
  /** CREDIT：可提前结清本期并校准信用额度 */
  canEarlySettle?: boolean
  history: Array<{
    id: string
    weekStart: string
    weekEnd: string
    fromText: string
    toText: string
    bookMode: string
    agentShareRate: number
    generalShareRate?: number
    betFlow: number
    housePnl: number
    agentShareAmount: number
    generalShareAmount?: number
    platformShareAmount: number
    settlePay?: number
    agentPocketAtSettle?: number
    monthlyFeePeriod?: number
    paymentStatus?: string
    paidAt?: string | null
    status: string
    settledAt?: string | null
    creditRestored?: boolean
    note?: string | null
  }>
}

export interface RoomSettleStatementLine {
  key: string
  group: string
  label: string
  amount: number
  kind: 'info' | 'settle'
  note?: string
}

export interface RoomSettleStatement {
  room: {
    id: string
    roomNo: string
    name: string
    bookMode: 'CASH' | 'CREDIT'
    bookLabel: string
    agentShareRate: number
    agentSharePct: number
    platformSharePct: number
    creditLimit: number
    agent: { userId: string; uid: string; nickname: string; username: string } | null
  }
  period: {
    key: string
    label: string
    weekStart: string
    weekEnd: string
    fromText: string
    toText: string
  }
  ops: {
    betFlow: number
    payout: number
    betCount: number
    housePnl: number
    playerPnl: number
    upAmount: number
    upCount: number
    downAmount: number
    downCount: number
    activePlayers: number
    byGame: Array<{
      gameCode: string
      gameName: string
      betCount: number
      betFlow: number
      payout: number
      housePnl: number
    }>
  }
  fees: {
    commissionAmount: number
    commissionCount: number
    flyRebateToAgent: number
    playerRebateClaimed: number
    playerRebateCount: number
    /** 合同月费（整月） */
    monthlyFee?: number
    /** 本期摊入月费（信用盘进交割） */
    monthlyFeePeriod?: number
    nextBillAt?: string | null
  }
  creditBook: CreditBookSnapshot | null
  share: {
    mode: string
    label: string
    housePnl: number
    agentShareAmount: number
    /** 总代成数差；由总代与平台单独交割，不进代理应付 */
    generalShareAmount?: number
    platformShareAmount: number
    platformPayToAgent: number
  }
  lines: RoomSettleStatementLine[]
  settlement: {
    platformToAgent: number
    agentToPlatform: number
    netAmount: number
    netDirection: 'PLATFORM_PAYS_AGENT' | 'AGENT_PAYS_PLATFORM' | 'EVEN'
    netLabel: string
    alreadyPaidToAgent: number
    /** 信用盘：轧入交割的代理余额/佣金账户 */
    agentBalanceOffset?: number
  /** @deprecated 兼容旧字段 */
    flyRebateOffset?: number
    monthlyFeePeriod?: number
    grossPlatformPayToAgent?: number
  }
}
