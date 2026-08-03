import http from './http'

// ─── Dashboard ───────────────────────────────────────────────
export const dashboardApi = {
  stats: () => http.get<DashboardStats, DashboardStats>('/admin/dashboard/stats'),
  trend: (days = 7) => http.get<TrendPoint[], TrendPoint[]>(`/admin/dashboard/trend?days=${days}`),
}

export interface DashboardStats {
  totalPlayers: number
  todayNew: number
  activeToday: number
  platformBalance: number
  todayBetFlow: number
  todayPnl: number
  pendingRecharge: number
  pendingWithdraw: number
}
export interface TrendPoint { date: string; betFlow: number; pnl: number; newUsers: number }

// ─── Recharge / Withdraw review ──────────────────────────────
export const reviewApi = {
  list: (params?: { status?: string; type?: string; page?: number; pageSize?: number }) =>
    http.get<ReviewPage, ReviewPage>('/admin/recharge', { params }),
  approve: (id: string) => http.patch<{ ok: boolean }, { ok: boolean }>(`/recharge/${id}/approve`),
  reject: (id: string, reason: string) =>
    http.patch<{ ok: boolean }, { ok: boolean }>(`/recharge/${id}/reject`, { reason }),
}
export interface ReviewOrder {
  id: string; orderNo: string; type: string; amount: number; status: string
  channel: string; rejectReason: string | null; createdAt: string; reviewedAt: string | null
  player: { uid: string; nickname: string }
}
export interface ReviewPage { total: number; page: number; pageSize: number; list: ReviewOrder[] }

// ─── Games management ────────────────────────────────────────
export const gameAdminApi = {
  list: () => http.get<GameAdmin[], GameAdmin[]>('/admin/games'),
  opsSchedule: () => http.get<GameOpsSchedule, GameOpsSchedule>('/admin/games/ops-schedule'),
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

/* 多级代理树 / V1–V5 下发：前端已改走 /console/agents 与房间「绑定代理」。
 * 旧 /admin/agents/* 接口仍保留在服务端，供脚本或以后树形页使用，此处不再封装死代码。 */

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
