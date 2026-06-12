import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi, type UserProfile } from '@/api/auth'

export const useUserStore = defineStore('user', () => {
  const profile = ref<UserProfile | null>(null)
  const token = ref<string>(localStorage.getItem('token') ?? '')
  const restored = ref(false)

  const isLoggedIn = computed(() => !!token.value && !!profile.value)

  function setAuth(user: UserProfile, tk: string) {
    profile.value = user
    token.value = tk
    localStorage.setItem('token', tk)
  }

  function logout() {
    profile.value = null
    token.value = ''
    localStorage.removeItem('token')
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
