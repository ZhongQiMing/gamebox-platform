import http from './http'

/* 旧 /admin/dashboard/* 已由 /console/dashboard 替代，前端不再封装。 */

// ─── Recharge / Withdraw review ──────────────────────────────
export const reviewApi = {
  list: (params?: {
    status?: string
    type?: string
    playerId?: string
    page?: number
    pageSize?: number
  }) => http.get<ReviewPage, ReviewPage>('/admin/recharge', { params }),
  approve: (id: string) => http.patch<{ ok: boolean }, { ok: boolean }>(`/recharge/${id}/approve`),
  reject: (id: string, reason: string) =>
    http.patch<{ ok: boolean }, { ok: boolean }>(`/recharge/${id}/reject`, { reason }),
}
export interface ReviewOrder {
  id: string; orderNo: string; type: string; amount: number; status: string
  channel: string; rejectReason: string | null; createdAt: string; reviewedAt: string | null
  playerId?: string
  player: { uid: string; nickname: string }
}
export interface ReviewPage { total: number; page: number; pageSize: number; list: ReviewOrder[] }

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
  }) =>
    http.patch<{ ok: boolean }, { ok: boolean }>(`/admin/games/${code}`, data),
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
  last: () => http.get<{ report: ReconReport | null }, { report: ReconReport | null }>(
    '/admin/fund-recon',
  ),
  run: () => http.post<{ report: ReconReport }, { report: ReconReport }>('/admin/fund-recon/run'),
  /* 补记等于人工承认一笔差额，服务端要求二次验密 */
  fixPoints: (id: string, reason: string, adminPassword: string) =>
    http.post<ReconFixResult, ReconFixResult>(
      '/admin/fund-recon/fix-points', { id, reason, adminPassword },
    ),
  fixQuota: (id: string, reason: string, adminPassword: string) =>
    http.post<ReconFixResult, ReconFixResult>(
      '/admin/fund-recon/fix-quota', { id, reason, adminPassword },
    ),
}
export interface ReconFixResult {
  ok: boolean
  drift: number
  balance?: number
  pointsQuota?: number
}
export interface ReconRow {
  scope: 'ACCOUNT' | 'AGENT' | 'NONE'
  id: string
  label: string
  actual: number
  expected: number
  drift: number
}
export interface ReconCheck {
  key: 'points_sum' | 'quota_sum' | 'frozen_orders' | 'negative_balance'
  label: string
  hint: string
  bad: number
  rows: ReconRow[]
  fixable: boolean
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
