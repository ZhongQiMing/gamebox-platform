import http from './http'
import {
  toFiniteNumber,
  toOptionalFiniteNumber,
  type NumericValue,
} from './number'

/** 账号树翻页块大小；不够就继续翻，不设房间总数上限 */
export const OPS_TREE_PAGE_SIZE = 10_000

/** 结算页签：房间结账与总代结算共用同一组，顺序与文案都以此为准 */
export type SettlePeriod = 'current' | 'last' | 'early'

export interface GeneralOwnerRow {
  ownerUserId: string
  uid: string
  nickname: string
  username: string | null
  status: string
  createdAt?: string
}
/** 某总代的可见范围：已授权的总监 + 全部总监（用于勾选） */
export interface GeneralOwners {
  generalUserId: string
  granted: GeneralOwnerRow[]
  allBranches: GeneralOwnerRow[]
}

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

  setRoomAgentShareRate: (roomId: string, shareRate: number) =>
    http.patch<{
      ok: boolean
      agentShareRate: number
      pendingAgentShareRate: number | null
      pendingAgentShareFrom: string | null
      agentShareCap?: number
      message?: string
    }>(`/console/rooms/${roomId}/agent-share-rate`, { shareRate }),

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

  /** 某总代当前对哪些总监可见（含全部总监名单，供勾选） */
  generalOwners: (generalUserId: string) =>
    http.get<GeneralOwners, GeneralOwners>(
      `/console/generals/${generalUserId}/owners`,
    ),

  /** 开/关某个总监对该总代的可见性（仅管理） */
  setGeneralOwner: (generalUserId: string, ownerUserId: string, visible: boolean) =>
    http.post<
      { ok: boolean; visible: boolean; remaining: number },
      { ok: boolean; visible: boolean; remaining: number }
    >(`/console/generals/${generalUserId}/owner`, { ownerUserId, visible }),

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

  /** 信用盘：永久加减合同额度与剩余信用；clientRequestId 作幂等锚点，重放不会加两次 */
  bumpCreditLimit: (
    roomId: string,
    data: {
      amount: number
      direction?: 'up' | 'down'
      remark?: string
      clientRequestId: string
    },
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

  purgeRoom: (roomId: string, adminPassword: string) =>
    http.post<{ ok: boolean; mode: string; message: string }, { ok: boolean; mode: string; message: string }>(
      `/console/rooms/${roomId}/purge`,
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
    params?: { period?: SettlePeriod; weekStart?: string },
  ) =>
    http.get<RoomSettleStatement, RoomSettleStatement>(
      `/console/rooms/${roomId}/week-settle/statement`,
      { params },
    ),

  exportRoomWeekSettle: (
    roomId: string,
    params?: { period?: SettlePeriod; weekStart?: string },
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
  players: (params?: {
    page?: number
    pageSize?: number
    q?: string
    roomId?: string
    /** positive=持分>0；zero=持分为 0 */
    points?: string
  }) => http.get<PlayerPage, PlayerPage>('/console/players', { params }),

  playerDetail: (id: string, params?: { roomId?: string }) =>
    http
      .get<PlayerDetailWire, PlayerDetailWire>(`/console/players/${id}`, { params })
      .then(normalizePlayerDetail),

  /** 玩家画像：资金/风险/游戏偏好；仅管理与总监。roomId 为空看各房合计 */
  playerProfile: (id: string, roomId?: string) =>
    http.get<PlayerProfile, PlayerProfile>(`/console/players/${id}/profile`, {
      params: roomId ? { roomId } : undefined,
    }),

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

  /** 账号树/结算对象用：按 total 翻页拉完，房间再多也不会截断 */
  agentsAll: async (params?: {
    role?: string
    q?: string
    boundOnly?: boolean
  }): Promise<AgentPage> => {
    const pageSize = OPS_TREE_PAGE_SIZE
    const first = await consoleApi.agents({ ...params, page: 1, pageSize })
    const total = Number(first.total) || 0
    const list = [...(first.list || [])]
    /* 页数上限跟着 total 走，不再用固定 50 页；+2 是给翻页期间新增的行留余量 */
    const maxPages = Math.min(500, Math.ceil(total / pageSize) + 2)
    let page = 2
    while (list.length < total && page <= maxPages) {
      const next = await consoleApi.agents({ ...params, page, pageSize })
      const chunk = next.list || []
      if (!chunk.length) break
      list.push(...chunk)
      page += 1
    }
    if (list.length < total) {
      /* 账号树按「拿全了」渲染，少一批人就会整棵子树消失，必须留痕 */
      console.warn(`[agentsAll] 只取到 ${list.length}/${total} 条，账号树可能不完整`)
    }
    return { ...first, list, total, page: 1, pageSize: list.length }
  },

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
    /** 以下四项仅总代：与平台的盘口、合同额度、结算周期、每间房月费单价 */
    bookMode?: 'CASH' | 'CREDIT'
    creditLimit?: number
    settleCycle?: string
    roomMonthlyFee?: number
    /**
     * 建总代时勾选哪些总监可见（仅管理有效）。
     * 不传 = 全部在职总监可见。
     */
    ownerUserIds?: string[]
  }) => http.post('/console/agents', data),

  /** 改总代每间房缴给平台的月费单价 */
  setGeneralRoomMonthlyFee: (userId: string, amount: number) =>
    http.patch<{ ok: boolean; roomMonthlyFee: number }>(
      `/console/agents/${userId}/room-monthly-fee`,
      { amount },
    ),

  /** 改总代占成：本期不动，下一账期生效 */
  setGeneralShareRate: (userId: string, shareRate: number) =>
    http.patch<{
      ok: boolean
      shareRate: number
      pendingShareRate: number | null
      pendingShareFrom: string | null
      message?: string
    }>(`/console/agents/${userId}/share-rate`, { shareRate }),

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

  // ── 总代账期结算（平台 ↔ 总代）──
  generalSettleStatement: (params?: {
    generalUserId?: string
    period?: SettlePeriod
    periodStart?: string
  }) =>
    http.get<GeneralSettleStatement, GeneralSettleStatement>(
      '/console/general-settle/statement',
      { params },
    ),

  generalSettleHistory: (params?: { generalUserId?: string; take?: number }) =>
    http.get<{ list: GeneralSettleHistoryRow[] }, { list: GeneralSettleHistoryRow[] }>(
      '/console/general-settle/history',
      { params },
    ),

  exportGeneralSettle: (params?: {
    generalUserId?: string
    period?: SettlePeriod
    periodStart?: string
  }) =>
    http.get<{ filename: string; csv: string }, { filename: string; csv: string }>(
      '/console/general-settle/export',
      { params },
    ),

  directSettleStatement: (params?: { period?: 'current' | 'last' }) =>
    http.get<DirectSettleStatement, DirectSettleStatement>(
      '/console/general-settle/direct-statement',
      { params },
    ),

  exportDirectSettle: (params?: { period?: 'current' | 'last' }) =>
    http.get<{ filename: string; csv: string }, { filename: string; csv: string }>(
      '/console/general-settle/direct-export',
      { params },
    ),

  settleGeneralPeriod: (
    generalUserId: string,
    data: { period?: SettlePeriod; note?: string },
  ) => http.post(`/console/general-settle/${generalUserId}/settle`, data),

  bumpGeneralCreditLimit: (
    userId: string,
    data: { amount: number; direction: 'up' | 'down'; remark?: string; clientRequestId: string },
  ) => http.post(`/console/agents/${userId}/credit-limit/bump`, data),

  // ── 回水策略 ──
  rebatePolicy: (roomId?: string) =>
    http.get<RebatePolicy, RebatePolicy>('/console/rebate-policy', {
      params: roomId ? { roomId } : undefined,
    }),

  patchRebatePolicy: (data: RebatePolicyPatch) =>
    http.patch<RebatePolicy, RebatePolicy>('/console/rebate-policy', data),

  liveDraws: () => http.get<LiveDrawsPayload, LiveDrawsPayload>('/console/live-draws'),
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
  /**
   * 对外唯一的「代理余额」：信用盘=剩余信用+未结佣金，现金盘=余额。
   * 页面一律显示这个，别再自己拿 balance / pointsQuota 相加。
   */
  agentBalance?: number
  /** 合并数里「已挣到、待结账轧掉」的那一截；仅结账相关页面需要拆开说明 */
  unsettledWage?: number
  /** 总代：名下各代理房间那一支合计（代理盘分 + 客服 + 玩家），不含总代自己 */
  roomBalance?: number
  /** 总代：平台向他收的每间房月费单价，同时是名下房间月费的下限 */
  roomMonthlyFee?: number
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
  pendingShareRate?: number | null
  pendingShareFrom?: string | null
  downlineFlowRate?: number
}

export interface ConsoleRoomFly {
  onCount: number
  offCount: number
  memberCount: number
  effective: boolean
  flyCover: number
}

export interface ConsoleRoomTodayStats {
  betFlow: number
  pendingBetFlow?: number
  /** 该角色视角的飞盘投注额（管理/总代=飞上台，代理=飞出去） */
  flownBetFlow?: number
  /** 该角色视角的关盘投注额 */
  closedBetFlow?: number
  payout: number
  housePnl: number
  betCount: number
  activePlayers: number
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
  pendingAgentShareRate?: number | null
  pendingAgentShareFrom?: string | Date | null
  agentShareCap?: number
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
  todayStats?: ConsoleRoomTodayStats
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
    /** 对外唯一的「代理余额」：信用盘=剩余信用+未结佣金 */
    agentBalance?: number
    unsettledWage?: number
    diskPoolRemaining?: number
    csBalances?: number
    /** 该房玩家持分合计；与 pointsQuota、csBalances 相加即 flyCover */
    playerBalances?: number
  } | null
  owners: { userId: string; uid: string; nickname: string }[]
  createdAt: string
}

export interface RobotDaySlot {
  key: 'night' | 'morning' | 'noon' | 'afternoon' | 'peak'
  startHour: number
  endHour: number
  count: number
  countMin?: number
  countMax?: number
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

export interface PlayerProfile {
  member: {
    id: string
    uid: string
    username: string
    nickname: string
    status: string
    createdAt: string
    lastLoginAt: string | null
    lastLoginIp: string | null
    /** 持分按房隔离，这里是各房合计 */
    totalBalance: number
    rooms: Array<{
      roomId: string
      roomNo: string
      name: string
      bookMode: string
      agentNickname: string | null
      agentUsername: string | null
      balance: number
    }>
  }
  /** 空串=各房合计；否则下面的资金与偏好只算这一间 */
  scopeRoomId: string
  funds: {
    /** 累计充值＝累计上分毛额，不扣下分 */
    upAmount: number
    downAmount: number
    totalBet: number
    winAmount: number
    loseAmount: number
    /** 下分 ÷ 上分，百分数；上分为 0 时为 null */
    rip: number | null
  }
  risk: {
    alerts: Array<{
      id: string
      type: string
      level: string
      handled: boolean
      summary: string
      createdAt: string
    }>
    sameIpAccounts: Array<{
      id: string
      uid: string
      nickname: string
      username: string
      lastLoginAt: string | null
    }>
    softBias: Array<{
      id: string
      kind: string
      enabled: boolean
      goalAmount: number
      progressAmount: number
      roomNo: string | null
      roomName: string | null
      createdAt: string
    }>
  }
  preferences: Array<{
    gameCode: string
    name: string
    category: string | null
    amount: number
    betCount: number
    pct: number
  }>
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
  generalUserId?: string
  generalNickname?: string
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
    pendingShareRate?: number | null
    pendingShareFrom?: string | Date | null
    downlineFlowRate?: number
    playerMinRate?: number | null
    playerMaxRate?: number | null
    /** 仅总代：与平台的盘口、合同额度、结算周期、每间房月费单价 */
    bookMode?: 'CASH' | 'CREDIT'
    creditLimit?: number
    settleCycle?: string
    roomMonthlyFee?: number
    pointsQuota?: number
    pointsUsed?: number
    flyCover?: number
    parent?: { id: string; nickname: string; username: string; role: string } | null
    rooms?: AgentRoomBrief[]
    roomCount?: number
    memberCount?: number
    staffCount?: number
    csCount?: number
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
  flowRate?: number
  shareRate?: number
  pendingShareRate?: number | null
  pendingShareFrom?: string | Date | null
  bookMode?: 'CASH' | 'CREDIT'
  creditLimit?: number
  settleCycle?: string
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
  /**
   * 服务端如实交代的「界面 vs 实际」差异。
   * 界面显示的必须等于实际执行的，否则运营会基于错误认知做决策。
   */
  truth?: {
    /** 后台能配、但当前不参与任何判断的项 */
    ineffective: Array<{ key: string; label: string; why: string }>
    /** 每个开关的适用游戏类别；不是每项都全站生效 */
    scopes: Array<{ key: string; label: string; applies: string[]; note?: string }>
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
  /** 未开奖投注额（已计入「流水」展示，不进盈亏） */
  pendingBetFlow?: number
  pendingBetCount?: number
  /** 注单缺房间号：报表与账单都不认，>0 说明有单要排查 */
  unattributedBetFlow?: number
  unattributedBetCount?: number
  /** 飞上台（平台坐庄，已结；占成/结账用） */
  flownBetFlow?: number
  flownPayout?: number
  flownHousePnl?: number
  flownBetCount?: number
  /** 代理飞盘：上台 + 飞到总代（已结） */
  agentFlyBetFlow?: number
  agentFlyPayout?: number
  agentFlyHousePnl?: number
  /** 飞上台（已结 + 未开奖，经营展示） */
  flownBetFlowLive?: number
  /** 代理飞盘（已结 + 未开奖，经营展示） */
  agentFlyBetFlowLive?: number
  /** 该角色视角的关盘流水（经营展示含未开奖） */
  closedBetFlow?: number
  activePlayers?: number
  playerCount?: number | null
  agentCount?: number
  agentRoomCount?: number
  roomPoolTotal?: number
  commissionAmount?: number
  commissionCount?: number
  /** 按 shareBasis 变含义：平台那份 / 总代成数差 / 整房庄家盈亏 */
  platformShareAmount?: number
  /** 我自己坐庄那部分的毛输赢 */
  satHousePnl?: number
  /** 我分到的那份：平台=平台占成；总代=成数差+坐庄留存；代理=飞出去部分的占成 */
  myShareAmount?: number
  /** 我今日净赚：代理已扣挂靠佣金 */
  myNetEarning?: number
  /** 平台整包返水：总代实发 + 代理实发 + 玩家回水 */
  rebatePackage?: number
  /** 总代自己留下的返水 */
  rebateGeneral?: number
  /** 代理收到的返水 */
  rebateAgent?: number
  /** 玩家回水，含未领 */
  rebatePlayer?: number
  /** 平台真正盈亏：庄家盈亏 − 整包返水 */
  realNetEarning?: number
  shareBasis?: 'PLATFORM' | 'GENERAL_DIFF' | 'HOUSE'
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
  username?: string
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
  pendingBetFlow?: number
  flownBetFlow?: number
  closedBetFlow?: number
  payout: number
  housePnl: number
  playerPnl: number
  agentShareRate: number
  agentShareAmount: number
  /** 挂总代时总代那份；直挂房恒为 0。三段相加 = flownHousePnl */
  generalShareAmount: number
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
    actionLabel?: string
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

/** 总代账期里的单房明细 */
export interface GeneralSettleRoomLine {
  roomId: string
  roomNo: string
  name: string
  status: string
  bookMode: string
  agentNickname: string | null
  agentUsername: string | null
  settleCycle: string
  settleLabel: string
  betFlow: number
  payout: number
  housePnl: number
  agentShareRate: number
  agentShareAmount: number
  generalShareAmount: number
  platformShareAmount: number
  payToPlatform: number
  /** 该房代理收益：正=应付给他，负=应从他那收。只含占成 */
  agentPnl: number
  agentSettleStatus: 'SETTLED' | 'PENDING'
  agentSettledAt: string | null
  agentWageAmount?: number
  generalWageAmount?: number
  generalWageKeep?: number
  playerRebate?: number
  wageCount?: number
}

/** 工资条一格：上行项目名、下行金额 */
export interface SettlePayslipCell {
  key: string
  label: string
  kind: 'text' | 'money' | 'count'
  amount?: number
  text?: string
  emphasis?: boolean
}

export interface GeneralSettleStatement {
  general: {
    userId: string
    uid: string
    nickname: string
    username: string
    bookMode: string
    creditLimit: number
    pointsQuota: number
    shareRate: number
    flowRate: number
    settleCycle: string
    settleLabel: string
  }
  period: {
    key: string
    periodStart: string
    periodEnd: string
    status: string
    settledAt: string | null
  }
  totals: {
    roomCount: number
    betFlow: number
    payout: number
    housePnl: number
    agentShareAmount: number
    generalShareAmount: number
    platformShareAmount: number
    payToPlatform: number
    /** 占成+月费，与 payToPlatform 相同（每周不冲欠） */
    sharePayToPlatform?: number
    /** 平台给该信用总代的未结上分（往来，不进本期交割） */
    unsettledIssueDebt?: number
    agentPnl: number
    /** 本期房间月费，已含在 payToPlatform 里 */
    roomFee: number
    wageCount?: number
    agentWageAmount?: number
    generalWageAmount?: number
    generalWageKeep?: number
    playerRebate?: number
    /** 与房间详情同一口径：庄家盈亏 − 占成 − 整包净额 − 回水 */
    platformNet?: number
    upAmount?: number
    downAmount?: number
  }
  payslip: SettlePayslipCell[]
  rooms: GeneralSettleRoomLine[]
  /** 分房明细的用途说明：账期不一致时合计对不上属正常 */
  roomsNote?: string
  /** 本期房间月费逐房明细：平台按单价向总代收 */
  roomFee?: {
    unitFee: number
    total: number
    roomCount: number
    monthCount: number
    note: string
    lines: Array<{
      roomId: string
      roomNo: string
      name: string
      months: number
      unitFee: number
      amount: number
    }>
  }
  /** 平台应得里还没从代理收上来的部分，总代先垫 */
  pendingFromAgents: number
  canSettle: boolean
  note?: string | null
}

export interface GeneralSettleHistoryRow {
  id: string
  periodStart: string
  periodEnd: string
  bookMode: string
  roomCount: number
  betFlow: number
  housePnl: number
  agentShareAmount: number
  generalShareAmount: number
  platformShareAmount: number
  settlePay: number
  status: string
  settledAt: string | null
  note: string | null
}

export interface DirectSettleStatement {
  kind: 'direct'
  period: {
    key: string
    periodStart: string
    periodEnd: string
    settleLabel: string
  }
  totals: GeneralSettleStatement['totals']
  rooms: GeneralSettleRoomLine[]
  roomsNote?: string
}

export interface RebateGameRule {
  gameCode: string
  name: string
  category: string
  status: string
  generalMin: number
  generalDefault: number
  generalMax: number
  agentMin: number
  agentDefault: number
  agentMax: number
  playerMin: number
  playerDefault: number
  playerMax: number
  adminGeneralMin?: number
  adminGeneralDefault?: number
  adminGeneralMax?: number
  adminAgentMin?: number
  adminAgentDefault?: number
  adminAgentMax?: number
  adminPlayerMin?: number
  adminPlayerDefault?: number
  adminPlayerMax?: number
  capAgentMin?: number
  capAgentMax?: number
  capPlayerMin?: number
  capPlayerMax?: number
  editGeneral?: boolean
  editAgent?: boolean
  editPlayer?: boolean
  generalPkg?: number
  agentPkg?: number
  minRate: number
  maxRate: number
  playerRate: number
}

export interface RebateChainPlatform {
  generalMin: number
  generalMax: number
  generalDefault: number
  agentMin: number
  agentMax: number
  agentDefault: number
  playerMin: number
  playerMax: number
}

export interface RebateChainDownline {
  userId: string
  uid: string
  nickname: string
  username: string
  roomId: string
  roomNo: string
  roomName: string
  flowRate: number
  rebateRate: number
  playerMin: number
  playerMax: number
}

export interface RebatePolicyChain {
  canEdit: 'platform' | 'general' | 'agent' | 'none'
  platform: RebateChainPlatform
  mine: {
    userId?: string
    flowRate?: number
    downlineFlowRate?: number
    rebateRate?: number
    playerMin?: number
    playerMax?: number
    roomId?: string | null
    roomName?: string | null
    roomNo?: string | null
  } | null
  downlines: RebateChainDownline[]
  effective: {
    agentPkg: number
    generalPkg: number
    playerMin: number
    playerMax: number
    defaultPlayerRate: number
  }
}

export interface RebatePolicy {
  id: number
  minRate: number
  maxRate: number
  defaults: unknown
  totalRate?: number
  playerMinRate?: number
  playerMaxRate?: number
  generalMinRate?: number
  generalDefaultRate?: number
  generalMaxRate?: number
  agentMinRate?: number
  agentDefaultRate?: number
  agentMaxRate?: number
  games?: RebateGameRule[]
  chain?: RebatePolicyChain
}

export interface RebatePolicyPatch {
  generalMinRate?: number
  generalMaxRate?: number
  generalDefaultRate?: number
  totalRate?: number
  agentMinRate?: number
  agentMaxRate?: number
  agentDefaultRate?: number
  playerMinRate?: number
  playerMaxRate?: number
  games?: Array<{
    gameCode: string
    generalMin?: number
    generalDefault?: number
    generalMax?: number
    agentMin?: number
    agentDefault?: number
    agentMax?: number
    playerMin?: number
    playerDefault?: number
    playerMax?: number
  }>
}

export interface LiveDrawGame {
  code: string
  name: string
  category: string
  status: string
  phase: string
  phaseLabel: string
  issueNo: string
  remainSec: number
  lastDraw: string
  lastIssueNo: string
  currentBetAmount: number
  currentBetCount: number
  todayBetAmount: number
  todayBetCount: number
  todayPayout: number
  sortOrder?: number
}

export interface LiveDrawsPayload {
  ts: number
  maint?: {
    windowActive: boolean
    disabled?: boolean
    window: string
    timezone: string
    remainSec: number
  }
  games: LiveDrawGame[]
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
    generalUserId?: string | null
    agent: { userId: string; uid: string; nickname: string; username: string } | null
  }
  period: {
    key: string
    label: string
    weekStart: string
    weekEnd: string
    fromText: string
    toText: string
    /** 这一段是否已经封成账单 */
    settled: boolean
    settledAt: string | null
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
    playerRebateAccrued?: number
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
  /** 三方对账：流水/输赢/各家分成/谁付谁 */
  sheet: {
    basisLabel: string
    betFlow: number
    payout: number
    housePnl: number
    /** 平台最终落到手的：庄家盈亏 − 下家占成 − 平台出的整包与玩家回水 */
    platformNet: number
    /** 工资条：一行项目名、一行金额横排下去；页面与导出 CSV 共用这一份 */
    payslip: SettlePayslipCell[]
    parties: Array<{
      key: 'AGENT' | 'GENERAL' | 'PLATFORM'
      role: string
      name: string
      sharePct: number
      amount: number
      note: string
    }>
    transfers: Array<{
      key: string
      scope: '本单' | '另结'
      from: string | null
      to: string | null
      amount: number
      label: string
      note: string
    }>
    /** 流水佣金：按有效流水另算，下注当场发放 */
    wages: {
      rows: Array<{
        key: string
        label: string
        from: string
        to: string
        amount: number
        count: number
      }>
      platformOut: number
      generalKeep: number
      agentGet: number
      note: string
    }
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
