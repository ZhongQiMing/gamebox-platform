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
  /**
   * 对外唯一的「代理余额」：信用盘=剩余信用+未结佣金，现金盘=余额。
   * 页面一律显示这个，别再自己拿 balance / pointsQuota 相加。
   */
  agentBalance?: number
  /** 总代：名下各代理房间那一支合计 */
  roomBalance?: number
  /** 合并数里「已挣到、待结账轧掉」的那一截 */
  unsettledWage?: number
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
    /** 总代占成，0.4 = 40% */
    shareRate?: number
    /** 总代整包，0.07 = 7% */
    flowRate?: number
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
  general?: {
    agentId: string
    userId: string
    uid: string
    nickname: string
    username: string
  } | null
  ownerAgent: {
    agentId: string
    userId: string
    flyCover: number
    pointsQuota: number
    diskPoolRemaining?: number
    csBalances?: number
    pointsUsed: number
    balance: number | null
    /** 对外唯一的「代理余额」：信用盘=剩余信用+未结佣金 */
    agentBalance?: number
    unsettledWage?: number
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
  /** 该玩家的注是飞给平台还是代理自己坐庄 */
  flyEnabled?: boolean
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
  /** 漏接被强制下线后锁号，需代理解锁 */
  slaLocked?: boolean
  slaLockReason?: string | null
  /** 今日值班时长（秒），空闲与休息分开 */
  idleSecToday?: number
  restSecToday?: number
}

/** 客服响应考核规则：时限与奖惩金额由代理自己设 */
export interface CsSlaPolicy {
  enabled: boolean
  remindSec: number
  kickSec: number
  lateFine: number
  missFine: number
  bonusMinRate: number
  bonusMinRounds: number
  dailyBonus: number
  streakDays: number
  streakBonus: number
}

export interface CsSlaStatRow {
  csUserId: string
  nickname: string
  username: string
  workStatus: string
  locked: boolean
  lockReason: string | null
  rounds: number
  onTime: number
  late: number
  missed: number
  onTimeRate: number | null
  fine: number
  waivedCount: number
  idleSec: number
  restSec: number
}

export interface CsSlaEventRow {
  id: string
  playerId: string
  playerNickname: string
  playerUid: string
  askedAt: string
  repliedAt: string | null
  responseSec: number | null
  level: string
  fine: number
  waived: boolean
  waiveReason: string | null
  responseText?: string
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
  /** 我自己坐庄那部分的毛输赢 */
  satHousePnl?: number
  /** 平台占成 / 总代成数差 / 代理占成 */
  myShareAmount?: number
  myNetEarning?: number
  /** 总代实发 + 代理实发 + 玩家回水 */
  rebatePackage?: number
  rebateGeneral?: number
  rebateAgent?: number
  rebatePlayer?: number
  /** 平台：庄家盈亏 − 整包。总代：占成 + 自己的返水 */
  realNetEarning?: number
  /** 管理/房主：平台占成；代理：庄家盈亏 − 佣金 */
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

export interface StaffRoomBet {
  id: string
  betNo: string
  playerNickname: string
  playerUid: string | null
  betType: string | null
  amount: number
  payout: number
  playerPnl: number
  status: string
  createdAt: string
}

export interface StaffRoomBetPage {
  total: number
  page: number
  pageSize: number
  list: StaffRoomBet[]
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
  /** 本轮响应计时的起点；null = 没有等着回复的消息 */
  askedAt?: string | null
}

/** 响应考核时限，客服端据此在本地跑倒计时 */
export interface StaffCsSlaLimits {
  enabled: boolean
  remindSec: number
  kickSec: number
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
  /** 对外唯一的「代理余额」：信用盘=剩余信用+未结佣金 */
  agentBalance?: number
  unsettledWage?: number
  memberCount?: number
  staffCount?: number
  rooms?: { id: string; roomNo: string; name: string; status: string; bookMode?: string }[]
  lastLoginAt?: string | null
  parent?: { id: string; nickname: string; username: string; role: string } | null
  bookMode?: string
  creditLimit?: number
  shareRate?: number
  flowRate?: number
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
  agentShareAmount?: number
  /** 这间房里总代自己的占成 */
  generalShareAmount?: number
  netPnl?: number
  agentNickname?: string | null
}

function withPublicRoomIcon<T extends { icon?: string | null }>(room: T): T {
  return { ...room, icon: publicMediaUrl(room.icon) || null }
}

type CountedRoom = {
  id: string
  memberCount?: number
  fly?: { onCount: number; offCount: number; memberCount: number; effective?: boolean; flyCover?: number }
}

/**
 * 房间成员数会把进过游戏大厅的代理/管理算进去。
 * 玩家列表只认注册玩家，展示人数和飞盘开关都以它为准。
 */
async function withRegisteredPlayers<T extends CountedRoom>(room: T): Promise<T> {
  try {
    const page = await staffHttp.get<StaffPlayerPage, StaffPlayerPage>('/console/players', {
      params: { roomId: room.id, page: 1, pageSize: 1 },
    })
    const players = Number(page?.total ?? 0)
    const fly = room.fly
    if (!fly) return { ...room, memberCount: players }
    const extra = Math.max(0, Number(fly.memberCount || 0) - players)
    const onCount = Math.max(0, Number(fly.onCount || 0) - extra)
    return {
      ...room,
      memberCount: players,
      fly: {
        ...fly,
        memberCount: players,
        onCount,
        offCount: Math.max(0, players - onCount),
      },
    }
  } catch {
    return room
  }
}

/** 实时开奖里的一个游戏 */
export interface StaffLiveDrawGame {
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

export interface StaffLiveDrawsPayload {
  ts: number
  maint?: {
    windowActive: boolean
    disabled?: boolean
    window: string
    timezone: string
    remainSec: number
  }
  games: StaffLiveDrawGame[]
}

export const staffConsoleApi = {
  walletMe: () => staffHttp.get<StaffWalletMe, StaffWalletMe>('/console/wallet/me'),

  /** 实时开奖：各游戏当期倒计时、上期结果、当期与今日下注 */
  liveDraws: () =>
    staffHttp.get<StaffLiveDrawsPayload, StaffLiveDrawsPayload>('/console/live-draws'),

  rooms: () => staffHttp.get<StaffRoom[], StaffRoom[]>('/console/rooms')
    .then((rooms) => Promise.all(rooms.map((room) => withRegisteredPlayers(withPublicRoomIcon(room))))),

  room: (id: string) => staffHttp.get<StaffRoomDetail, StaffRoomDetail>(`/console/rooms/${id}`)
    .then((room) => withRegisteredPlayers(withPublicRoomIcon(room))),

  /** 上传房间图标（管理/房主/代理）；data URL */
  uploadRoomIcon: (roomId: string, image: string) =>
    staffHttp.patch<{ icon: string }, { icon: string }>(
      `/console/rooms/${roomId}/icon`,
      { image },
      { timeout: 30000 },
    ).then((result) => ({ ...result, icon: publicMediaUrl(result.icon) })),

  setRoomStatus: (roomId: string, status: string) =>
    staffHttp.patch(`/console/rooms/${roomId}/status`, { status }),

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

  /** 单个玩家飞盘开/关（仅本房主代理）。整房一刀切之外，还要能单独盯住大额玩家 */
  setPlayerFly: (playerId: string, flyEnabled: boolean, roomId?: string) =>
    staffHttp.patch<{ flyEnabled: boolean }, { flyEnabled: boolean }>(
      `/console/players/${playerId}/fly`,
      { flyEnabled, roomId },
    ),

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
    staffHttp.get<
      { list: StaffCsSession[]; sla?: StaffCsSlaLimits | null },
      { list: StaffCsSession[]; sla?: StaffCsSlaLimits | null }
    >('/console/cs/sessions')
      .then((result) => ({
        ...result,
        list: (result.list || []).map((session) => ({
          ...session,
          avatar: publicMediaUrl(session.avatar) || null,
        })),
      })),

  csMessages: (playerId: string, limit = 100) =>
    staffHttp.get<
      { list: StaffCsMessage[]; askedAt?: string | null; sla?: StaffCsSlaLimits | null },
      { list: StaffCsMessage[]; askedAt?: string | null; sla?: StaffCsSlaLimits | null }
    >(
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
    params?: {
      page?: number
      pageSize?: number
      tab?: 'balance' | 'fund' | 'ops' | 'wage'
      from?: string
      to?: string
    },
  ) =>
    staffHttp.get<{ list: StaffAuditRow[]; total: number }, { list: StaffAuditRow[]; total: number }>(
      `/console/agents/${userId}/audit`,
      { params },
    ),

  csStaffMe: () =>
    staffHttp.get<StaffCsMe, StaffCsMe>('/console/cs-staff/me'),

  patchCsStaff: (id: string, body: { workStatus?: string; nickname?: string }) =>
    staffHttp.patch<StaffCsMe, StaffCsMe>(`/console/cs-staff/${id}`, body),

  csSlaPolicy: () => staffHttp.get<CsSlaPolicy, CsSlaPolicy>('/console/cs-sla/policy'),

  saveCsSlaPolicy: (body: Partial<CsSlaPolicy>) =>
    staffHttp.put<CsSlaPolicy, CsSlaPolicy>('/console/cs-sla/policy', body),

  csSlaStats: (range = 'today') =>
    staffHttp.get<{ list: CsSlaStatRow[] }, { list: CsSlaStatRow[] }>('/console/cs-sla/stats', {
      params: { range },
    }),

  csSlaEvents: (csUserId: string, range = 'today') =>
    staffHttp.get<{ list: CsSlaEventRow[] }, { list: CsSlaEventRow[] }>('/console/cs-sla/events', {
      params: { csUserId, range },
    }),

  csSlaWaive: (eventId: string, reason?: string) =>
    staffHttp.post<{ ok: boolean }, { ok: boolean }>(`/console/cs-sla/events/${eventId}/waive`, {
      reason,
    }),

  /** 客服端心跳：App 活着就报一次，断了服务端当他把 App 划掉了 */
  csHeartbeat: () =>
    staffHttp.post<{ ok: boolean }, { ok: boolean }>('/console/cs-sla/heartbeat', {}),

  csSlaUnlock: (csUserId: string) =>
    staffHttp.post<{ ok: boolean }, { ok: boolean }>(`/console/cs-staff/${csUserId}/sla-unlock`),

  reportSummary: (params?: { range?: string; roomId?: string }) =>
    staffHttp.get<StaffReportSummary, StaffReportSummary>('/console/reports/summary', { params }),

  reportRoomBets: (params: {
    roomId: string
    range?: string
    page?: number
    pageSize?: number
    gameCode?: string
  }) =>
    staffHttp.get<StaffRoomBetPage, StaffRoomBetPage>('/console/reports/room-bets', { params }),

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
