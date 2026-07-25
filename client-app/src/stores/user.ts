import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi, type UserProfile } from '@/api/auth'
import { useWalletStore } from '@/stores/wallet'
import { useRoomStore } from '@/stores/room'

export const useUserStore = defineStore('user', () => {
  const profile = ref<UserProfile | null>(null)
  const token = ref<string>(localStorage.getItem('token') ?? '')
  const restored = ref(false)

  const isLoggedIn = computed(() => !!token.value && !!profile.value)

  function setAuth(user: UserProfile, tk: string) {
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
    localStorage.removeItem('token')
    useWalletStore().reset()
    useRoomStore().clearCurrent()
  }

  /** 刷新页面后用已存 token 恢复 profile（只执行一次，由路由守卫等待） */
  async function restoreSession() {
    if (restored.value) return
    restored.value = true
    if (!token.value || profile.value) return
    try {
      profile.value = await authApi.me()
    } catch {
      logout()
    }
  }

  return { profile, token, isLoggedIn, setAuth, logout, restoreSession }
})
