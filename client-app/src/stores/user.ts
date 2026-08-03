import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi, type UserProfile } from '@/api/auth'
import { useWalletStore } from '@/stores/wallet'
import { useRoomStore } from '@/stores/room'
import { useStaffStore } from '@/stores/staff'

export const useUserStore = defineStore('user', () => {
  const profile = ref<UserProfile | null>(null)
  const token = ref<string>(localStorage.getItem('token') ?? '')
  const restored = ref(false)
  let restoreInflight: Promise<void> | null = null

  const isLoggedIn = computed(() => !!token.value && !!profile.value)

  function setAuth(user: UserProfile, tk: string) {
    // 运营角色不得写入玩家会话（应走 /staff/login/*）
    if (['ADMIN', 'BRANCH', 'AGENT', 'PROXY'].includes(user.role)) {
      throw new Error('请使用代理/房主登录入口')
    }
    // 与运营态互斥
    useStaffStore().logout()
    profile.value = user
    token.value = tk
    localStorage.setItem('token', tk)
    // 每次登录都重新选房，避免串到别人的代理房间
    useRoomStore().clearCurrent()
  }

  function logout() {
    profile.value = null
    token.value = ''
    restored.value = false   // 重置，让下次进入应用时重新走 restoreSession
    restoreInflight = null
    localStorage.removeItem('token')
    useWalletStore().reset()
    useRoomStore().clearCurrent()
  }

  /** 刷新页面后用已存 token 恢复 profile（并发调用共享同一次 me()） */
  function restoreSession(): Promise<void> {
    if (restored.value) return Promise.resolve()
    if (restoreInflight) return restoreInflight
    restoreInflight = (async () => {
      try {
        if (!token.value || profile.value) {
          restored.value = true
          return
        }
        try {
          profile.value = await authApi.me()
          restored.value = true
        } catch {
          logout()
        }
      } finally {
        restoreInflight = null
      }
    })()
    return restoreInflight
  }

  return { profile, token, isLoggedIn, setAuth, logout, restoreSession }
})
