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
  balance: () => http.get<{ balance: number }, { balance: number }>('/wallet/balance'),

  ledger: (
    page = 1,
    pageSize = 50,
    opts?: { range?: TimeRangeKey; from?: number; to?: number; bizTypes?: string[] },
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
    return http.get<LedgerPage, LedgerPage>(`/wallet/ledger?${q.toString()}`)
  },
}
