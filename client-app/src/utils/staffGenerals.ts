import { staffConsoleApi, type StaffAgentRow } from '@/api/staffConsole'
import { formatMoney } from '@gamebox/shared'

export type StaffGeneralRow = StaffAgentRow

export function pctOfRate(rate?: number) {
  const n = Number(rate)
  if (!Number.isFinite(n)) return '—'
  const pct = n > 1 ? n : n * 100
  return String(Math.round(pct * 10) / 10)
}

/** 总代名下各代理的可飞额度相加，再加上总代自己那一支 */
export function treeFly(ownFly: number, downline: number[]) {
  return ownFly + downline.reduce((sum, n) => sum + (Number(n) || 0), 0)
}

export async function loadStaffGenerals() {
  const page = await staffConsoleApi.agents({
    role: 'GENERAL',
    page: 1,
    pageSize: 500,
    boundOnly: false,
  })
  const map: Record<string, StaffGeneralRow> = {}
  for (const row of page?.list || []) {
    if (row?.id) map[row.id] = row
  }
  return map
}

export function moneyOrDash(row: StaffGeneralRow | undefined, n?: number | null) {
  return row ? formatMoney(n ?? 0) : '—'
}
