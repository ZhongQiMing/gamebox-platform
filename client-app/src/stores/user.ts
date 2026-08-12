import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi, type UserProfile } from '@/api/auth'
import { useWalletStore } from '@/stores/wallet'
import { useRoomStore } from '@/stores/room'
import { useStaffStore } from '@/stores/staff'
import {
  PLAYER_TOKEN_KEY, clearSessionMark, isNativeApp, loadToken, markSession,
  removeToken, saveToken, sessionKind,
} from '@/api/session'
import { publicMediaUrl } from '@/utils/publicMediaUrl'

const OPS_ROLES = ['ADMIN', 'BRANCH', 'AGENT', 'PROXY', 'CS'] as const

function withPublicAvatar(user: UserProfile): UserProfile {
  return { ...user, avatar: publicMediaUrl(user.avatar) || null }
}

export const useUserStore = defineStore('user', () => {
  const profile = ref<UserProfile | null>(null)
  /* 网页版恒为空：凭证在 HttpOnly Cookie 里，JS 读不到（见 api/session.ts） */
  const token = ref<string>(loadToken(PLAYER_TOKEN_KEY))
  const restored = ref(false)
  let restoreInflight: Promise<void> | null = null
  const sessionEpoch = ref(0)

  const isLoggedIn = computed(() =>
    !!profile.value && (isNativeApp() ? !!token.value : sessionKind() !== null))

  function bumpEpoch() {
    sessionEpoch.value += 1
    restoreInflight = null
  }

  function setAuth(user: UserProfile, tk: string) {
    // 运营角色不得写入玩家会话（应走 /staff/login/*）
    if ((OPS_ROLES as readonly string[]).includes(user.role)) {
      throw new Error('账号不存在')
    }
    bumpEpoch()
    // 与运营态互斥（本地清干净，避免路由仍当成运营已登录）
    useStaffStore().clearLocal()
    profile.value = withPublicAvatar(user)
    token.value = tk
    saveToken(PLAYER_TOKEN_KEY, tk)
    markSession('player')
    restored.value = true
    // 每次登录都重新选房，避免串到别人的代理房间
    useRoomStore().clearCurrent()
  }

  /**
   * 代理进游戏大厅：挂玩家会话壳，不踢 staff。
   * 底下用的还是运营那张票（Cookie 或 Bearer 都是同一个身份），所以不打会话标记。
   * 递增 epoch 是为了作废正在飞的玩家 restore——它的结果已经是上一个会话的了。
   */
  function attachStaffPlay(user: UserProfile, tk: string) {
    bumpEpoch()
    profile.value = withPublicAvatar(user)
    token.value = tk
    saveToken(PLAYER_TOKEN_KEY, tk)
    restored.value = true
  }

  function clearStaffPlay(): Promise<void> {
    bumpEpoch()
    profile.value = null
    token.value = ''
    restored.value = true
    const removed = removeToken(PLAYER_TOKEN_KEY)
    useWalletStore().reset()
    return removed
  }

  /** 只清本地玩家态，不打 /auth/logout（运营登录后勿清刚下发的 Cookie） */
  function clearLocal(): Promise<void> {
    bumpEpoch()
    profile.value = null
    token.value = ''
    restored.value = true
    const removed = removeToken(PLAYER_TOKEN_KEY)
    /* 传 'player'：运营登录时也会走这里，不能把刚打上的 staff 标记抹掉 */
    clearSessionMark('player')
    useWalletStore().reset()
    useRoomStore().clearCurrent()
    return removed
  }

  async function logout(): Promise<void> {
    const staff = useStaffStore()
    if (staff.playActive) {
      const removals = [staff.endPlay(), clearStaffPlay()]
      useRoomStore().clearCurrent()
      await Promise.all(removals)
      return
    }
    bumpEpoch()
    profile.value = null
    token.value = ''
    restored.value = true
    const removed = removeToken(PLAYER_TOKEN_KEY)
    clearSessionMark('player')
    useWalletStore().reset()
    useRoomStore().clearCurrent()
    await Promise.all([
      removed.catch(() => undefined),
      authApi.logout().catch(() => undefined),
    ])
  }

  /**
   * 刷新页面后恢复 profile（并发调用共享同一次 me()）。
   * App 看本地 token，网页版看会话标记——Cookie 读不到，只能问一次 /users/me。
   */
  function restoreSession(): Promise<void> {
    if (restored.value) return Promise.resolve()
    if (restoreInflight) return restoreInflight
    const epoch = sessionEpoch.value
    const tkAtStart = token.value
    restoreInflight = (async () => {
      try {
        // 运营工作台（非进游戏）期间不跑玩家 me，避免旧会话 401 误踢运营
        const staffPlay = localStorage.getItem('staff_play') === '1'
        if (sessionKind() === 'staff' && !staffPlay) {
          if (epoch !== sessionEpoch.value) return
          token.value = ''
          profile.value = null
          removeToken(PLAYER_TOKEN_KEY)
          restored.value = true
          return
        }
        const hasSession = isNativeApp() ? !!tkAtStart : sessionKind() !== null
        if (!hasSession || profile.value) {
          if (epoch === sessionEpoch.value) restored.value = true
          return
        }
        try {
          const me = await authApi.me()
          // 期间发生过登录/退出/挂 play 壳：epoch 已变，这个结果是上一个会话的
          if (epoch !== sessionEpoch.value) return
          profile.value = withPublicAvatar(me)
          restored.value = true
        } catch {
          if (epoch !== sessionEpoch.value) return
          clearLocal()
        }
      } finally {
        if (epoch === sessionEpoch.value) restoreInflight = null
      }
    })()
    return restoreInflight
  }

  return {
    profile,
    token,
    sessionEpoch,
    isLoggedIn,
    setAuth,
    attachStaffPlay,
    clearStaffPlay,
    clearLocal,
    logout,
    restoreSession,
  }
})
