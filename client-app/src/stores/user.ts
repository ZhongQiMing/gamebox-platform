import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi, type UserProfile } from '@/api/auth'
import { useWalletStore } from '@/stores/wallet'
import { useRoomStore } from '@/stores/room'
import { useStaffStore } from '@/stores/staff'

const OPS_ROLES = ['ADMIN', 'BRANCH', 'AGENT', 'PROXY', 'CS'] as const

export const useUserStore = defineStore('user', () => {
  const profile = ref<UserProfile | null>(null)
  const token = ref<string>(localStorage.getItem('token') ?? '')
  const restored = ref(false)
  let restoreInflight: Promise<void> | null = null
  let sessionEpoch = 0

  const isLoggedIn = computed(() => !!token.value && !!profile.value)

  function bumpEpoch() {
    sessionEpoch += 1
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
    profile.value = user
    token.value = tk
    localStorage.setItem('token', tk)
    restored.value = true
    // 每次登录都重新选房，避免串到别人的代理房间
    useRoomStore().clearCurrent()
  }

  /** 代理进游戏大厅：挂玩家会话壳，不踢 staff */
  function attachStaffPlay(user: UserProfile, tk: string) {
    profile.value = user
    token.value = tk
    localStorage.setItem('token', tk)
    restored.value = true
  }

  function clearStaffPlay() {
    bumpEpoch()
    profile.value = null
    token.value = ''
    restored.value = true
    localStorage.removeItem('token')
    useWalletStore().reset()
  }

  /** 只清本地玩家态，不打 /auth/logout（运营登录后勿清刚下发的 Cookie） */
  function clearLocal() {
    bumpEpoch()
    profile.value = null
    token.value = ''
    restored.value = true
    localStorage.removeItem('token')
    useWalletStore().reset()
    useRoomStore().clearCurrent()
  }

  function logout() {
    const staff = useStaffStore()
    if (staff.playActive) {
      staff.endPlay()
      clearStaffPlay()
      useRoomStore().clearCurrent()
      return
    }
    bumpEpoch()
    profile.value = null
    token.value = ''
    restored.value = true
    localStorage.removeItem('token')
    useWalletStore().reset()
    useRoomStore().clearCurrent()
    void authApi.logout().catch(() => undefined)
  }

  /** 刷新页面后用已存 token 恢复 profile（并发调用共享同一次 me()） */
  function restoreSession(): Promise<void> {
    if (restored.value) return Promise.resolve()
    if (restoreInflight) return restoreInflight
    const epoch = sessionEpoch
    const tkAtStart = token.value
    restoreInflight = (async () => {
      try {
        // 运营工作台（非进游戏）期间不跑玩家 me，避免旧 token 401 误踢运营会话
        const staffTok = localStorage.getItem('staff_token')
        const staffPlay = localStorage.getItem('staff_play') === '1'
        if (staffTok && !staffPlay) {
          if (epoch !== sessionEpoch) return
          token.value = ''
          profile.value = null
          localStorage.removeItem('token')
          restored.value = true
          return
        }
        if (!tkAtStart || profile.value) {
          if (epoch === sessionEpoch) restored.value = true
          return
        }
        try {
          const me = await authApi.me()
          if (epoch !== sessionEpoch || localStorage.getItem('token') !== tkAtStart) return
          profile.value = me
          restored.value = true
        } catch {
          if (epoch !== sessionEpoch || localStorage.getItem('token') !== tkAtStart) return
          clearLocal()
        }
      } finally {
        if (epoch === sessionEpoch) restoreInflight = null
      }
    })()
    return restoreInflight
  }

  return {
    profile,
    token,
    isLoggedIn,
    setAuth,
    attachStaffPlay,
    clearStaffPlay,
    clearLocal,
    logout,
    restoreSession,
  }
})
