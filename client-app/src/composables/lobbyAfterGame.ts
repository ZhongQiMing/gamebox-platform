/**
 * 从游戏（或游戏内的记录 / 上下分 / 回水等子页）返回大厅。
 *
 * 玩家回玩家大厅即可；运营试玩不能直接推 /lobby——路由守卫会按角色把运营
 * 踢回默认首页，管理 / 总监 / 总代还会连带丢掉进游戏前选好的房间，
 * 得重新走一遍房间列表。所以这里按会话类型分流，回到刚才那间房的游戏列表。
 */
import type { Router } from 'vue-router'
import { useStaffStore } from '@/stores/staff'

export async function leaveGameToLobby(
  router: Router,
  mode: 'replace' | 'push' = 'replace',
): Promise<void> {
  const staff = useStaffStore()

  if (staff.isLoggedIn) {
    const roomId = staff.playRoomId
    if (staff.playActive && roomId) {
      await router[mode]({ name: 'staff-lobby', query: { roomId } })
      return
    }
    await router[mode]({ name: staff.homeRouteName() })
    return
  }

  await router[mode]({ name: 'lobby' })
}
