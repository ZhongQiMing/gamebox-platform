import http from './http'

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

export const rechargeApi = {
  apply: (amount: number, channel?: string) =>
    http.post<RechargeOrder, RechargeOrder>('/recharge/apply', { amount, channel }),

  withdraw: (amount: number) =>
    http.post<RechargeOrder, RechargeOrder>('/recharge/withdraw', { amount }),

  myOrders: (page = 1, pageSize = 20) =>
    http.get<{ total: number; list: RechargeOrder[] }, { total: number; list: RechargeOrder[] }>(
      '/recharge/my', { params: { page, pageSize } }
    ),
}
