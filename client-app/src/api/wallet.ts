import http from './http'
import type { LedgerItemDTO } from '@gamebox/shared'
import type { TimeRangeKey } from '@/composables/timeRange'

export type LedgerItem = LedgerItemDTO

export interface LedgerSummary {
  count: number
  income: number
  expense: number
  net: number
  incomeCount?: number
  expenseCount?: number
}

export interface LedgerPage {
  total: number
  page: number
  pageSize: number
  summary: LedgerSummary
  list: LedgerItem[]
}

export const walletApi = {
  /** 按当前运营房间查余额（传 roomNo 或 roomId） */
  balance: (room?: { roomNo?: string; roomId?: string }) => {
    const q = new URLSearchParams()
    if (room?.roomId) q.set('roomId', room.roomId)
    else if (room?.roomNo) q.set('roomNo', room.roomNo)
    const qs = q.toString()
    return http.get<{ balance: number }, { balance: number }>(
      `/wallet/balance${qs ? `?${qs}` : ''}`,
    )
  },

  ledger: (
    page = 1,
    pageSize = 50,
    opts?: {
      range?: TimeRangeKey
      from?: number
      to?: number
      bizTypes?: string[]
      roomNo?: string
      roomId?: string
    },
  ) => {
    const q = new URLSearchParams()
    q.set('page', String(page))
    q.set('pageSize', String(pageSize))
    if (opts?.range) q.set('range', opts.range)
    if (opts?.from != null && opts?.to != null) {
      q.set('from', String(opts.from))
      q.set('to', String(opts.to))
    }
    if (opts?.bizTypes?.length) {
      q.set('bizTypes', opts.bizTypes.join(','))
    }
    if (opts?.roomId) q.set('roomId', opts.roomId)
    else if (opts?.roomNo) q.set('roomNo', opts.roomNo)
    return http.get<LedgerPage, LedgerPage>(`/wallet/ledger?${q.toString()}`)
  },
}
