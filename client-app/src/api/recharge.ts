import http from './http'
import type { TimeRangeKey } from '@/composables/timeRange'

export interface RechargeOrder {
  id: string
  orderNo: string
  type: 'UP' | 'DOWN'
  amount: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  channel: string | null
  rejectReason: string | null
  createdAt: string
}

export interface RechargeOrderSummary {
  upCount: number
  upAmount: number
  downCount: number
  downAmount: number
  pendingCount: number
  approvedCount: number
  rejectedCount: number
}

export interface RechargeOrderPage {
  total: number
  page: number
  pageSize: number
  summary: RechargeOrderSummary
  list: RechargeOrder[]
}

export const rechargeApi = {
  apply: (amount: number, channel?: string) =>
    http.post<RechargeOrder, RechargeOrder>('/recharge/apply', { amount, channel }),

  withdraw: (amount: number) =>
    http.post<RechargeOrder, RechargeOrder>('/recharge/withdraw', { amount }),

  myOrders: (
    page = 1,
    pageSize = 50,
    opts?: { range?: TimeRangeKey; from?: number; to?: number },
  ) => {
    const q = new URLSearchParams()
    q.set('page', String(page))
    q.set('pageSize', String(pageSize))
    if (opts?.range) q.set('range', opts.range)
    if (opts?.from != null && opts?.to != null) {
      q.set('from', String(opts.from))
      q.set('to', String(opts.to))
    }
    return http.get<RechargeOrderPage, RechargeOrderPage>(`/recharge/my?${q.toString()}`)
  },
}
