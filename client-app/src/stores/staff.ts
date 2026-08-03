import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UserProfile } from '@/api/auth'

const TOKEN_KEY = 'staff_token'
const KIND_KEY = 'staff_login_kind'

export type StaffLoginKind = 'agent' | 'branch'

export const useStaffStore = defineStore('staff', () => {
  const profile = ref<UserProfile | null>(null)
  const token = ref<string>(localStorage.getItem(TOKEN_KEY) ?? '')
  const loginKind = ref<StaffLoginKind>(
    (localStorage.getItem(KIND_KEY) as StaffLoginKind) || 'agent',
  )
  const restored = ref(false)
  let restoreInflight: Promise<void> | null = null

  const isLoggedIn = computed(() => !!token.value && !!profile.value)
  const role = computed(() => profile.value?.role || '')
  const isBranch = computed(() => role.value === 'BRANCH' || role.value === 'ADMIN')
  const isAgentSide = computed(() => role.value === 'AGENT' || role.value === 'PROXY')

  function setAuth(user: UserProfile, tk: string, kind: StaffLoginKind) {
    // 与玩家态互斥（清 token；完整 logout 由登录页再调 userStore）
    localStorage.removeItem('token')
    profile.value = user
    token.value = tk
    loginKind.value = kind
    localStorage.setItem(TOKEN_KEY, tk)
    localStorage.setItem(KIND_KEY, kind)
    restored.value = true
  }

  function logout() {
    profile.value = null
    token.value = ''
    restored.value = false
    restoreInflight = null
    localStorage.removeItem(TOKEN_KEY)
  }

  function restoreSession(): Promise<void> {
    if (restored.value) return Promise.resolve()
    if (restoreInflight) return restoreInflight
    restoreInflight = (async () => {
      try {
        if (!token.value) {
          restored.value = true
          return
        }
        if (profile.value) {
          restored.value = true
          return
        }
        // 临时写入 player token 槽位不可行；用 staffHttp 的 me 更干净
        // 这里直接用 auth me + staff token：见 staffHttp
        const { default: staffHttp } = await import('@/api/staffHttp')
        try {
          profile.value = await staffHttp.get<UserProfile, UserProfile>('/users/me')
          restored.value = true
        } catch {
          logout()
          restored.value = true
        }
      } finally {
        restoreInflight = null
      }
    })()
    return restoreInflight
  }

  return {
    profile,
    token,
    loginKind,
    isLoggedIn,
    role,
    isBranch,
    isAgentSide,
    setAuth,
    logout,
    restoreSession,
  }
})
