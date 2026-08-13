import staffHttp from './staffHttp'
import { publicMediaUrl } from '@/utils/publicMediaUrl'

export interface StaffWalletMe {
  ownerType: string
  ownerId: string
  balance: number | null
  /** 管理员/房主：无个人钱包，上下分走平台池 */
  noPersonalWallet?: boolean
  poolMode?: boolean
  pointsQuota?: number
  flyCover?: number
  playerPointsTotal?: number
  csBalances?: number
  diskPoolRemaining?: number
  creditUnused?: number
  overIssueUsed?: number
  overIssueLimit?: number
  fakeExposure?: number
  /** CASH=现金盘 | CREDIT=信用盘（主房账本） */
  bookMode?: 'CASH' | 'CREDIT' | string
  creditLimit?: number
}

export interface StaffRoomFly {
  onCount: number
  offCount: number
  memberCount: number
  effective: boolean
  flyCover: number
}

export interface StaffRoom {
  id: string
  roomNo: string
  name: string
  /** 房间图标；缺省时前端用默认图 */
  icon?: string | null
  status: string
  enabledGames: string[]
  memberCount: number
  monthlyFee?: number
  nextBillAt?: string | null
  bookMode?: 'CASH' | 'CREDIT' | string
  creditLimit?: number
  fly?: StaffRoomFly
  agent: {
    agentId: string
    userId: string
    uid: string
    nickname: string
    username: string
    balance?: number
    pointsQuota?: number
    diskPoolRemaining?: number
    csBalances?: number
    pointsUsed?: number
    flyCover?: number
  } | null
  generalFlyEnabled?: boolean
  general?: {
    agentId: string
    userId: string
    uid: string
    nickname: string
    username: string
  } | null
}

export interface StaffRoomDetail {
  id: string
  roomNo: string
  name: string
  icon?: string | null
  status: string
  enabledGames: string[]
  memberCount: number
  roundCount?: number
  monthlyFee?: number
  billingDay?: number
  nextBillAt?: string | null
  overIssueEnabled?: boolean
  overIssueLimit?: number
  overIssueUsed?: number
  bookMode?: 'CASH' | 'CREDIT' | string
  creditLimit?: number
  agentShareRate?: number
  playerPointsTotal?: number
  createdAt?: string
  fly?: StaffRoomFly
  ownerAgent: {
    agentId: string
    userId: string
    flyCover: number
    pointsQuota: number
    diskPoolRemaining?: number
    csBalances?: number
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
  /** 登录失败过多被冻结 */
  loginLocked?: boolean
  balance: number
  createdAt: string
  /** 生效回水比例（含继承代理默认） */
  rebateRate?: number
  /** 玩家覆盖比例，null=继承 */
  playerRebateRate?: number | null
}

export interface StaffJoinRow {
  id: string
  playerId: string
  roomId: string
  status: string
  createdAt: string
  updatedAt: string
  player: { id: string; uid: string; nickname: string; username: string }
  room: { id: string; roomNo: string; name: string }
}

export interface StaffJoinPage {
  total: number
  list: StaffJoinRow[]
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
  remark?: string | null
  /** 上下分订单号 */
  orderNo?: string | null
  /** 上分 / 下分 */
  method?: string | null
  operator?: { nickname: string; role: string } | null
  counterparty?: { nickname: string; role: string; uid: string } | null
}

export interface StaffCsMe {
  id: string
  uid: string
  username: string
  nickname: string
  status: string
  balance: number
  wageRate: number
  idleWeight: number
  workStatus: 'IDLE' | 'REST' | string
  todayWage?: number
  totalWage?: number
  todayWageCount?: number
  totalWageCount?: number
}

export interface StaffReportSummary {
  betFlow: number
  payout: number
  housePnl: number
  playerPnl: number
  betCount: number
  upAmount: number
  downAmount: number
  pendingUp?: number
  pendingDown?: number
  roomCount: number
  activePlayers?: number
  /** 挂靠/代理佣金支出 */
  commissionAmount?: number
  commissionCount?: number
  /** 管理/房主：平台占成 */
  platformShareAmount?: number
  /** 管理/房主：平台占成 − 佣金；代理：庄家盈亏 − 佣金 */
  netPnl?: number
  netChange?: number
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

export interface StaffFundOrder {
  id: string
  orderNo?: string
  type: 'UP' | 'DOWN' | string
  amount: number
  status: string
  channel?: string | null
  rejectReason?: string | null
  createdAt: string
  reviewedAt?: string | null
  playerId?: string
  player: { id?: string; uid: string; nickname: string }
}

export interface StaffFundPage {
  total: number
  page: number
  pageSize: number
  list: StaffFundOrder[]
}

export interface StaffCsSession {
  playerId: string
  uid: string
  nickname: string
  avatar: string | null
  lastText: string
  lastSender: string
  lastAt: string
  unread: number
}

export interface StaffCsMessage {
  id: string
  playerId: string
  sender: string
  text: string
  isRead: boolean
  rechargeOrderId: string | null
  assigneeId: string | null
  createdAt: string
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
  rooms?: { id: string; roomNo: string; name: string; status: string; bookMode?: string }[]
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

export interface StaffRoomGameCfg {
  id: string
  roomId: string
  gameCode: string
  enabled: boolean
  robotCount: number
  rebateRate: number | null
}

export interface StaffReportByRoomRow {
  roomId: string
  roomNo: string
  name: string
  status: string
  memberCount: number
  betCount: number
  betFlow: number
  payout?: number
  housePnl: number
  playerPnl: number
  upAmount: number
  downAmount: number
  commissionAmount?: number
  platformShareAmount?: number
  netPnl?: number
  agentNickname?: string | null
}

function withPublicRoomIcon<T extends { icon?: string | null }>(room: T): T {
  return { ...room, icon: publicMediaUrl(room.icon) || null }
}

export const staffConsoleApi = {
  walletMe: () => staffHttp.get<StaffWalletMe, StaffWalletMe>('/console/wallet/me'),

  rooms: () => staffHttp.get<StaffRoom[], StaffRoom[]>('/console/rooms')
    .then((rooms) => rooms.map(withPublicRoomIcon)),

  room: (id: string) => staffHttp.get<StaffRoomDetail, StaffRoomDetail>(`/console/rooms/${id}`)
    .then(withPublicRoomIcon),

  /** 上传房间图标（管理/房主/代理）；data URL */
  uploadRoomIcon: (roomId: string, image: string) =>
    staffHttp.patch<{ icon: string }, { icon: string }>(
      `/console/rooms/${roomId}/icon`,
      { image },
      { timeout: 30000 },
    ).then((result) => ({ ...result, icon: publicMediaUrl(result.icon) })),

  setRoomStatus: (roomId: string, status: string) =>
    staffHttp.patch(`/console/rooms/${roomId}/status`, { status }),

  /** 信用盘：永久加减合同额度与剩余信用（仅管理员/房主） */
  bumpCreditLimit: (
    roomId: string,
    data: { amount: number; direction?: 'up' | 'down'; remark?: string },
  ) =>
    staffHttp.post<{
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

  /** 整房飞盘开/关（仅主代理） */
  setRoomFly: (roomId: string, flyEnabled: boolean) =>
    staffHttp.patch<
      { ok: boolean; flyEnabled: boolean; updated: number; message?: string },
      { ok: boolean; flyEnabled: boolean; updated: number; message?: string }
    >(`/console/rooms/${roomId}/fly`, { flyEnabled }),

  setGeneralRoomFly: (roomId: string, flyEnabled: boolean) =>
    staffHttp.patch<
      { ok: boolean; flyEnabled: boolean; message?: string },
      { ok: boolean; flyEnabled: boolean; message?: string }
    >(`/console/rooms/${roomId}/general-fly`, { flyEnabled }),

  // 进房码仅创建时可设，创建后不可换——换码接口停用
  // rotateCode: (roomId: string) =>
  //   staffHttp.post<{ roomNo?: string }, { roomNo?: string }>(
  //     `/console/rooms/${roomId}/rotate-code`,
  //     {},
  //   ),

  roomGames: (roomId: string) =>
    staffHttp.get<StaffRoomGameCfg[], StaffRoomGameCfg[]>(`/console/rooms/${roomId}/games`),

  /** 代理进本房游戏（成员 APPROVED） */
  playEnter: (roomId: string) =>
    staffHttp.post<
      { roomNo: string; name: string; icon: string | null; memberStatus: 'APPROVED'; roomId: string },
      { roomNo: string; name: string; icon: string | null; memberStatus: 'APPROVED'; roomId: string }
    >(`/console/rooms/${roomId}/play-enter`),

  patchRoomGame: (
    roomId: string,
    gameCode: string,
    data: { enabled?: boolean; robotCount?: number; rebateRate?: number | null },
  ) => staffHttp.patch(`/console/rooms/${roomId}/games/${gameCode}`, data),

  players: (params?: {
    page?: number
    pageSize?: number
    q?: string
    roomId?: string
    /** positive=持分>0；zero=持分=0 */
    points?: 'positive' | 'zero' | string
  }) =>
    staffHttp.get<StaffPlayerPage, StaffPlayerPage>('/console/players', { params }),

  /** 重置玩家密码并解冻（仅管理 / 房主） */
  resetPlayerPassword: (id: string, password?: string) =>
    staffHttp.post<{
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

  /** 把 friendUid（下级）挂到 underUid（推荐人）名下；仅主代理；按 roomId 隔离 */
  hangPlayer: (friendUid: string, underUid: string, roomId?: string) =>
    staffHttp.post<{
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

  creditPlayer: (
    playerId: string,
    amount: number,
    roomId: string,
    remark: string | undefined,
    clientRequestId: string,
  ) =>
    staffHttp.post<{ ok?: boolean; orderNo?: string }, { ok?: boolean; orderNo?: string }>(
      '/console/wallet/credit-player',
      {
        playerId,
        amount,
        roomId,
        remark,
        clientRequestId,
      },
    ),

  debitPlayer: (
    playerId: string,
    amount: number,
    roomId: string,
    remark: string | undefined,
    clientRequestId: string,
  ) =>
    staffHttp.post<{ ok?: boolean; orderNo?: string }, { ok?: boolean; orderNo?: string }>(
      '/console/wallet/debit-player',
      {
        playerId,
        amount,
        roomId,
        remark,
        clientRequestId,
      },
    ),

  /** 玩家申请上下分待审（主代理）；可选 playerId 只看该玩家 */
  fundPending: (page = 1, playerId?: string) =>
    staffHttp.get<StaffFundPage, StaffFundPage>('/recharge/pending', {
      params: { page, ...(playerId ? { playerId } : {}) },
    }),

  /** 已审上下分；客服默认看本人通过的单；可按 range / type 过滤 */
  fundHistory: (
    page = 1,
    params?: { status?: string; type?: string; playerId?: string; range?: string },
  ) =>
    staffHttp.get<StaffFundPage, StaffFundPage>('/recharge/history', {
      params: { page, ...params },
    }),

  fundApprove: (id: string) =>
    staffHttp.patch<{ ok?: boolean }, { ok?: boolean }>(`/recharge/${id}/approve`),

  fundReject: (id: string, reason: string) =>
    staffHttp.patch<{ ok?: boolean }, { ok?: boolean }>(`/recharge/${id}/reject`, { reason }),

  csSessions: () =>
    staffHttp.get<{ list: StaffCsSession[] }, { list: StaffCsSession[] }>('/console/cs/sessions')
      .then((result) => ({
        ...result,
        list: (result.list || []).map((session) => ({
          ...session,
          avatar: publicMediaUrl(session.avatar) || null,
        })),
      })),

  csMessages: (playerId: string, limit = 100) =>
    staffHttp.get<{ list: StaffCsMessage[] }, { list: StaffCsMessage[] }>(
      `/console/cs/sessions/${playerId}/messages`,
      { params: { limit } },
    ),

  csReply: (playerId: string, text: string) =>
    staffHttp.post<{ message: StaffCsMessage }, { message: StaffCsMessage }>(
      `/console/cs/sessions/${playerId}/messages`,
      { text },
    ),

  csRead: (playerId: string) =>
    staffHttp.post<{ ok: boolean }, { ok: boolean }>(`/console/cs/sessions/${playerId}/read`),

  csUploadPayQr: (kind: 'wechat' | 'alipay', dataUrl: string) =>
    staffHttp.post<{ kind: string; url: string }, { kind: string; url: string }>(
      '/console/cs/pay-qr',
      { kind, dataUrl },
    ),

  /** 客服聊天本地图片 */
  csUploadImage: (dataUrl: string) =>
    staffHttp.post<{ kind: string; url: string }, { kind: string; url: string }>(
      '/console/cs/upload',
      { dataUrl },
    ),

  csDeskSettings: () =>
    staffHttp.get<
      {
        quickReplies: string[]
        wechatQrs: Array<{ id: string; url: string; name?: string }>
        alipayQrs: Array<{ id: string; url: string; name?: string }>
      },
      {
        quickReplies: string[]
        wechatQrs: Array<{ id: string; url: string; name?: string }>
        alipayQrs: Array<{ id: string; url: string; name?: string }>
      }
    >('/console/cs/desk-settings'),

  csSaveDeskSettings: (data: {
    quickReplies: string[]
    wechatQrs: Array<{ id?: string; url: string; name?: string; note?: string }>
    alipayQrs: Array<{ id?: string; url: string; name?: string; note?: string }>
  }) =>
    staffHttp.put<
      {
        quickReplies: string[]
        wechatQrs: Array<{ id: string; url: string; name: string }>
        alipayQrs: Array<{ id: string; url: string; name: string }>
      },
      {
        quickReplies: string[]
        wechatQrs: Array<{ id: string; url: string; name: string }>
        alipayQrs: Array<{ id: string; url: string; name: string }>
      }
    >('/console/cs/desk-settings', data),

  joinPending: () =>
    staffHttp.get<StaffJoinPage, StaffJoinPage>('/console/room-members/pending'),

  joinApprove: (id: string) =>
    staffHttp.post<{ ok?: boolean }, { ok?: boolean }>(`/console/room-members/${id}/approve`),

  joinReject: (id: string) =>
    staffHttp.post<{ ok?: boolean }, { ok?: boolean }>(`/console/room-members/${id}/reject`),

  setPlayerRebateRate: (playerId: string, rate: number, roomId?: string) =>
    staffHttp.patch(`/console/players/${playerId}/rebate-rate`, { rate, roomId }),

  playersRebateBrief: (playerIds: string[]) =>
    staffHttp.post<
      { list: { playerId: string; claimableTotal: number; todayEstimated: number }[] },
      { list: { playerId: string; claimableTotal: number; todayEstimated: number }[] }
    >('/console/players/rebate-brief', { playerIds }),

  claimPlayerRebate: (playerId: string) =>
    staffHttp.post<
      { ok: boolean; amount: number; dates: string[]; message?: string },
      { ok: boolean; amount: number; dates: string[]; message?: string }
    >(`/console/players/${playerId}/rebate/claim`),

  issue: (toUserId: string, amount: number, clientRequestId: string, remark?: string) =>
    staffHttp.post('/console/wallet/issue', { toUserId, amount, remark, clientRequestId }),

  recall: (fromUserId: string, amount: number, clientRequestId: string, remark?: string) =>
    staffHttp.post('/console/wallet/recall', { fromUserId, amount, remark, clientRequestId }),

  agentAudit: (
    userId: string,
    params?: { page?: number; pageSize?: number; tab?: 'balance' | 'fund' | 'ops' | 'wage' },
  ) =>
    staffHttp.get<{ list: StaffAuditRow[]; total: number }, { list: StaffAuditRow[]; total: number }>(
      `/console/agents/${userId}/audit`,
      { params },
    ),

  csStaffMe: () =>
    staffHttp.get<StaffCsMe, StaffCsMe>('/console/cs-staff/me'),

  patchCsStaff: (id: string, body: { workStatus?: string; nickname?: string }) =>
    staffHttp.patch<StaffCsMe, StaffCsMe>(`/console/cs-staff/${id}`, body),

  reportSummary: (params?: { range?: string; roomId?: string }) =>
    staffHttp.get<StaffReportSummary, StaffReportSummary>('/console/reports/summary', { params }),

  reportByRoom: (params?: { range?: string }) =>
    staffHttp.get<{ list: StaffReportByRoomRow[] }, { list: StaffReportByRoomRow[] }>(
      '/console/reports/by-room',
      { params },
    ),

  /** 代理团队玩家有效流水榜 */
  playerFlow: (params?: { range?: string; limit?: number }) =>
    staffHttp.get<
      {
        range: string
        list: {
          playerId: string
          uid: string
          nickname: string
          avatar: string | null
          validFlow: number
          betCount: number
        }[]
      },
      {
        range: string
        list: {
          playerId: string
          uid: string
          nickname: string
          avatar: string | null
          validFlow: number
          betCount: number
        }[]
      }
    >('/console/reports/player-flow', { params }),

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

  /** 操作日志（管理/房主首页「资金流水」入口用） */
  adminLogs: (params?: {
    action?: string
    keyword?: string
    page?: number
    pageSize?: number
  }) =>
    staffHttp.get<StaffAdminLogPage, StaffAdminLogPage>('/admin/logs', { params }),
}

export interface StaffAdminLogItem {
  id: string
  action: string
  actionLabel: string
  summary: string
  createdAt: string
  operator: {
    id: string
    uid: string
    nickname: string
    role: string
  }
}

export interface StaffAdminLogPage {
  total: number
  page: number
  pageSize: number
  list: StaffAdminLogItem[]
}
