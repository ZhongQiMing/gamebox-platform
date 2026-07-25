import http from './http'

export type TablePhase = 'BETTING' | 'DRAWING' | 'SETTLED' | 'PAUSED'

export interface TableSnapshot {
  roomId: string
  gameCode: string
  phase: TablePhase
  roundNo: string
  secondsLeft: number
  outcome?: Record<string, unknown>
  betSummary: Record<string, number>
  history: Array<{
    roundNo: string
    outcome: Record<string, unknown>
    createdAt: string
    serverSeedHash?: string
    serverSeed?: string
    nonce?: number
  }>
  serverSeedHash?: string
  serverSeed?: string
  nonce?: number
}

/** 大厅 key → 服务端 gameCode */
export const TABLE_SERVER_CODE: Record<string, string> = {
  longhu: 'dragon-tiger',
  baccarat: 'baccarat',
  zhajinhua: 'zhajinhua',
  douniu: 'douniu',
}

export const tableApi = {
  snapshot: (gameCode: string) =>
    http.get<TableSnapshot, TableSnapshot>(`/table/${encodeURIComponent(gameCode)}/snapshot`),
  payTable: (gameCode: string) =>
    http.get(`/table/${encodeURIComponent(gameCode)}/pay-table`),
  verify: (gameCode: string, roundNo?: string) =>
    http.get(
      `/table/${encodeURIComponent(gameCode)}/verify${
        roundNo ? `?roundNo=${encodeURIComponent(roundNo)}` : ''
      }`,
    ),
}
