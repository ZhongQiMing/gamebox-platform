import http from './http'
import { toFiniteNumber, type NumericValue } from './number'

/* 旧 /admin/dashboard/* 已由 /console/dashboard 替代，前端不再封装。 */

// ─── Recharge / Withdraw review ──────────────────────────────
export const reviewApi = {
  list: (params?: {
    status?: string
    type?: string
    playerId?: string
    page?: number
    pageSize?: number
  }) =>
    http
      .get<ReviewPageWire, ReviewPageWire>('/admin/recharge', { params })
      .then(normalizeReviewPage),
  approve: (id: string) => http.patch<{ ok: boolean }, { ok: boolean }>(`/recharge/${id}/approve`),
  reject: (id: string, reason: string) =>
    http.patch<{ ok: boolean }, { ok: boolean }>(`/recharge/${id}/reject`, { reason }),
}
interface ReviewOrderWire extends Omit<ReviewOrder, 'amount'> {
  amount: NumericValue
}
interface ReviewPageWire extends Omit<ReviewPage, 'list'> {
  list: ReviewOrderWire[]
}
export interface ReviewOrder {
  id: string; orderNo: string; type: string; amount: number; status: string
  channel: string; rejectReason: string | null; createdAt: string; reviewedAt: string | null
  playerId?: string
  player: { uid: string; nickname: string; username?: string }
}
export interface ReviewPage { total: number; page: number; pageSize: number; list: ReviewOrder[] }

export function normalizeReviewOrder(order: ReviewOrderWire): ReviewOrder {
  return {
    ...order,
    amount: toFiniteNumber(order.amount, 'ReviewOrder.amount'),
  }
}

export function normalizeReviewPage(page: ReviewPageWire): ReviewPage {
  return {
    ...page,
    list: (page.list || []).map(normalizeReviewOrder),
  }
}

// ─── 客服会话（代理/子账号） ─────────────────────────────────
export const csConsoleApi = {
  sessions: () =>
    http.get<{ list: CsSession[] }, { list: CsSession[] }>('/console/cs/sessions'),
  messages: (playerId: string, limit = 100) =>
    http.get<{ list: CsConsoleMessage[] }, { list: CsConsoleMessage[] }>(
      `/console/cs/sessions/${playerId}/messages`,
      { params: { limit } },
    ),
  reply: (playerId: string, text: string) =>
    http.post<{ message: CsConsoleMessage }, { message: CsConsoleMessage }>(
      `/console/cs/sessions/${playerId}/messages`,
      { text },
    ),
  read: (playerId: string) =>
    http.post<{ ok: boolean }, { ok: boolean }>(`/console/cs/sessions/${playerId}/read`),
  uploadPayQr: (kind: 'wechat' | 'alipay', dataUrl: string) =>
    http.post<{ kind: string; url: string }, { kind: string; url: string }>(
      '/console/cs/pay-qr',
      { kind, dataUrl },
    ),
  deskSettings: () =>
    http.get<CsDeskSettingsDto, CsDeskSettingsDto>('/console/cs/desk-settings'),
  saveDeskSettings: (data: {
    quickReplies: string[]
    wechatQrs: Array<{ id?: string; url: string; name?: string; note?: string }>
    alipayQrs: Array<{ id?: string; url: string; name?: string; note?: string }>
  }) => http.put<CsDeskSettingsDto, CsDeskSettingsDto>('/console/cs/desk-settings', data),
}
export interface CsDeskSettingsDto {
  quickReplies: string[]
  wechatQrs: Array<{ id: string; url: string; name?: string }>
  alipayQrs: Array<{ id: string; url: string; name?: string }>
}
export interface CsSession {
  playerId: string
  uid: string
  nickname: string
  username?: string
  avatar: string | null
  lastText: string
  lastSender: string
  lastAt: string
  unread: number
}
export interface CsConsoleMessage {
  id: string
  playerId: string
  sender: string
  text: string
  isRead: boolean
  rechargeOrderId: string | null
  assigneeId: string | null
  createdAt: string
}

// ─── Games management ────────────────────────────────────────
export const gameAdminApi = {
  list: () => http.get<GameAdmin[], GameAdmin[]>('/admin/games'),
  opsSchedule: () => http.get<GameOpsSchedule, GameOpsSchedule>('/admin/games/ops-schedule'),
  /** 把卡在维护中的游戏全部恢复上架 */
  restoreOnline: () =>
    http.post<{ ok: boolean; restored: number; codes: string[] }, { ok: boolean; restored: number; codes: string[] }>(
      '/admin/games/restore-online',
    ),
  reorder: (codes: string[]) =>
    http.post<{ ok: boolean }, { ok: boolean }>('/admin/games/reorder', { codes }),
  setStatus: (code: string, status: string) =>
    http.patch<{ ok: boolean }, { ok: boolean }>(`/admin/games/${code}/status`, { status }),
  updateBasics: (code: string, data: {
    minBet?: number
    maxBet?: number
    name?: string
    playLimits?: Record<string, { minBet: number; maxBet: number }>
  }) =>
    http.patch<{ ok: boolean }, { ok: boolean }>(`/admin/games/${code}`, data),
  listPlays: (code: string) =>
    http.get<GamePlayCatalog, GamePlayCatalog>(`/admin/games/${code}/plays`),
  createConfig: (code: string, data: { rtp: number; payTable: unknown }) =>
    http.post<{ ok: boolean; version?: number }, { ok: boolean; version?: number }>(
      `/admin/games/${code}/config`,
      data,
    ),
  listConfigs: (code: string) =>
    http.get<GameConfigAdmin[], GameConfigAdmin[]>(`/admin/games/${code}/configs`),
  activateConfig: (code: string, version: number) =>
    http.patch<{ ok: boolean }, { ok: boolean }>(`/admin/games/${code}/config/${version}/activate`),
}
export interface GameOpsSchedule {
  timezone: string
  items: { key: string; cron: string; label: string; desc: string; window?: string }[]
  notes: string[]
}
export interface GameAdmin {
  id: string; code: string; name: string; category: string
  status: string; minBet: number; maxBet: number
  sortOrder?: number
  drawIntervalSec?: number | null
  configs: { version: number; rtp: number; active: boolean }[]
}
export interface GamePlayRow {
  key: string
  label: string
  minBet: number
  maxBet: number
  hint?: string
}
export interface GamePlayCatalog {
  code: string
  name: string
  plays: GamePlayRow[]
}
export interface GameConfigAdmin {
  id: string; version: number; rtp: number; active: boolean
  payTable: unknown; params: unknown; createdAt: string
}

// ─── Risk events ─────────────────────────────────────────────
export const riskApi = {
  meta: () => http.get<RiskMeta, RiskMeta>('/admin/risk/meta'),
  summary: () => http.get<RiskSummary, RiskSummary>('/admin/risk/summary'),
  list: (params?: {
    handled?: boolean
    level?: string
    type?: string
    keyword?: string
    from?: string
    to?: string
    page?: number
    pageSize?: number
  }) => http.get<RiskPage, RiskPage>('/admin/risk', { params }),
  handle: (id: string, note?: string) =>
    http.patch<{ ok: boolean }, { ok: boolean }>(`/admin/risk/${id}/handle`, { note }),
  handleBatch: (ids: string[], note?: string) =>
    http.patch<{ ok: boolean; count: number }, { ok: boolean; count: number }>(
      '/admin/risk/handle-batch',
      { ids, note },
    ),
}
export interface RiskTarget {
  id: string
  uid: string
  nickname: string
  username: string
  lastLoginIp: string | null
  status: string
}
export interface RiskEvent {
  id: string
  type: string
  typeLabel: string
  typeHint: string
  level: string
  targetId: string | null
  target: RiskTarget | null
  detail: Record<string, unknown>
  summary: string
  handled: boolean
  handleNote: string | null
  handledAt: string | null
  handler: { id: string; uid: string; nickname: string } | null
  createdAt: string
}
export interface RiskPage { total: number; page: number; pageSize: number; list: RiskEvent[] }
export interface RiskSummary {
  unhandled: number
  critical: number
  warn: number
  /** 要人去看的：严重 + 警告，不含逐笔下注写的 INFO 噪音 */
  actionable: number
  todayNew: number
  byType: Record<string, number>
}
export interface RiskMeta {
  types: Array<{ value: string; label: string; hint: string }>
  levels: Array<{ value: string; label: string }>
  monitors: Array<{ type: string; label: string; desc: string }>
}

// ─── Fund reconciliation ─────────────────────────────────────
export const fundReconApi = {
  last: () => http.get<ReconLastResp, ReconLastResp>('/admin/fund-recon'),
  run: () => http.post<{ report: ReconReport }, { report: ReconReport }>('/admin/fund-recon/run'),
  /** 历次对账记录：重启也不会丢，用来回溯「什么时候开始不平的」 */
  history: (page = 1, pageSize = 20) =>
    http.get<ReconHistoryResp, ReconHistoryResp>(
      `/admin/fund-recon/history?page=${page}&pageSize=${pageSize}`,
    ),
  payoutGate: () => http.get<PayoutGate, PayoutGate>('/admin/fund-recon/payout-gate'),
  /** 知情放行：账不平时临时允许出款，必须写原因 + 二次验密 */
  releaseGate: (reason: string, hours: number, adminPassword: string) =>
    http.post<{ id: string; expiresAt: string; hours: number }, { id: string; expiresAt: string; hours: number }>(
      '/admin/fund-recon/payout-gate/release', { reason, hours, adminPassword },
    ),
  revokeGate: () => http.post<{ ok: boolean }, { ok: boolean }>(
    '/admin/fund-recon/payout-gate/revoke',
  ),
  /*
   * 「补记差额」两个接口已在服务端删除：它只写流水不动余额，
   * 真相是「余额多了」时会把流水一起改错，等于抹掉证据。
   * 对不上要查原因，再走正常上下分把钱调平。
   */
}
export interface PayoutGate {
  allowed: boolean
  /** ok=账平 | drift=账本异常拦截 | released=人工放行中 | no_report/recon_unavailable=暂无结论 */
  reason: 'ok' | 'drift' | 'released' | 'no_report' | 'recon_unavailable'
  release?: { reason: string; expiresAt: string; createdById: string }
  lastCheckedAt?: string
  totalBad?: number
  /** 具体是哪几项在拦 */
  blocking?: string[]
  staleHours?: number
}
export interface ReconLastResp {
  report: ReconReport | null
  /** 内存里没有、从库里读出来的那次 */
  persisted?: { trigger: string; checkedAt: string } | null
  gate?: PayoutGate
}
export interface ReconHistoryItem {
  id: string
  trigger: 'cron' | 'manual' | 'gate'
  ok: boolean
  totalBad: number
  durationMs: number
  checkedAt: string
}
export interface ReconHistoryResp {
  total: number
  page: number
  pageSize: number
  items: ReconHistoryItem[]
}
export interface ReconRow {
  scope: 'ACCOUNT' | 'AGENT' | 'NONE'
  id: string
  label: string
  actual: number
  expected: number
  drift: number
}
export type ReconCheckKey =
  | 'points_sum'
  | 'quota_sum'
  | 'frozen_orders'
  | 'negative_balance'
  | 'credit_conservation'
  | 'swallowed_bets'
  | 'bet_debit_voucher'
  | 'duplicate_payout'
  | 'global_ledger_net'
  | 'bet_without_room'
  | 'platform_apply_backlog'
export interface ReconCheck {
  key: ReconCheckKey
  label: string
  hint: string
  bad: number
  rows: ReconRow[]
  /** 是否作为出款闸门的判据；只告警的项为 false */
  gating: boolean
}
export interface ReconReport {
  checkedAt: string
  durationMs: number
  ok: boolean
  totalBad: number
  checks: ReconCheck[]
}

// ─── Admin log ───────────────────────────────────────────────
export const adminLogApi = {
  meta: () => http.get<LogMeta, LogMeta>('/admin/logs/meta'),
  list: (params?: {
    action?: string
    keyword?: string
    from?: string
    to?: string
    page?: number
    pageSize?: number
  }) => http.get<LogPage, LogPage>('/admin/logs', { params }),
}
export interface LogActionOption {
  value: string
  label: string
  group: string
}
export interface LogMeta {
  actions: LogActionOption[]
}
export interface AdminLogItem {
  id: string
  action: string
  actionLabel: string
  actionGroup: string
  target: string | null
  targetLabel: string | null
  detail: unknown
  /** detail 里出现过的 ID → 房间名 / 玩家名 */
  detailNames?: Record<string, string>
  summary: string
  ip: string | null
  createdAt: string
  operator: {
    id: string
    uid: string
    nickname: string
    role: string
    roleLabel: string
  }
}
export interface LogPage { total: number; page: number; pageSize: number; list: AdminLogItem[] }
