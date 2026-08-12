import http from './http'
import type { LotteryIssue } from './lottery'
import type { TableSnapshot } from './table'

/** 大厅一次聚合：所有彩种的当前期/上期 + 所有牌桌的相位快照 */
export interface LobbySnapshot {
  lottery: Record<
    string,
    {
      current: LotteryIssue | null
      lastDraw: { issueNo: string; drawNumbers: string } | null
    }
  >
  table: Record<string, TableSnapshot | null>
}

export const lobbyApi = {
  /**
   * 传入当前大厅可见的彩种 / 牌桌 code，一个请求拿齐全部卡片状态。
   * 代替原先每游戏 1~2 个请求的轮询风暴。
   */
  snapshot: (lotteryCodes: string[], tableCodes: string[]) => {
    const q = new URLSearchParams()
    if (lotteryCodes.length) q.set('lottery', lotteryCodes.join(','))
    if (tableCodes.length) q.set('table', tableCodes.join(','))
    return http.get<LobbySnapshot, LobbySnapshot>(`/lobby/snapshot?${q.toString()}`)
  },
}
