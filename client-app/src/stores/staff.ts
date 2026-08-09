import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UserProfile } from '@/api/auth'

const TOKEN_KEY = 'staff_token'
const KIND_KEY = 'staff_login_kind'
const PLAY_KEY = 'staff_play'

export type StaffLoginKind = 'agent' | 'branch'

export const useStaffStore = defineStore('staff', () => {
  const profile = ref<UserProfile | null>(null)
  const token = ref<string>(localStorage.getItem(TOKEN_KEY) ?? '')
  const loginKind = ref<StaffLoginKind>(
    (localStorage.getItem(KIND_KEY) as StaffLoginKind) || 'agent',
  )
  const playActive = ref(localStorage.getItem(PLAY_KEY) === '1')
  const restored = ref(false)
  let restoreInflight: Promise<void> | null = null
  /** 登录/退出递增，作废进行中的 restore，防止旧 me() 401 或晚到结果写回会话 */
  let sessionEpoch = 0

  const isLoggedIn = computed(() => !!token.value && !!profile.value)
  const role = computed(() => profile.value?.role || '')
  const isBranch = computed(() => role.value === 'BRANCH' || role.value === 'ADMIN')
  const isAgentSide = computed(() => role.value === 'AGENT' || role.value === 'PROXY')
  const isCs = computed(() => role.value === 'CS')
  /** 手机底栏运营端：主代理 / 子账号 / 客服 / 管理员 / 房主 */
  const isMobileOps = computed(() => isAgentSide.value || isCs.value || isBranch.value)

  /** 登录后默认页 */
  function homeRouteName(): string {
    if (isCs.value) return 'staff-fund'
    if (isAgentSide.value) return 'staff-lobby'
    if (isBranch.value) return 'staff-game-rooms'
    return 'staff-home'
  }

  function bumpEpoch() {
    sessionEpoch += 1
    restoreInflight = null
  }

  function setAuth(user: UserProfile, tk: string, kind: StaffLoginKind) {
    bumpEpoch()
    localStorage.removeItem('token')
    localStorage.removeItem(PLAY_KEY)
    playActive.value = false
    profile.value = user
    token.value = tk
    loginKind.value = kind
    localStorage.setItem(TOKEN_KEY, tk)
    localStorage.setItem(KIND_KEY, kind)
    restored.value = true
  }

  /** 进入玩家游戏链路：镜像 token，不退出运营会话 */
  function beginPlay() {
    if (!token.value || !profile.value) return
    playActive.value = true
    localStorage.setItem(PLAY_KEY, '1')
    localStorage.setItem('token', token.value)
  }

  function endPlay() {
    playActive.value = false
    localStorage.removeItem(PLAY_KEY)
    if (token.value && localStorage.getItem('token') === token.value) {
      localStorage.removeItem('token')
    }
  }

  /** 只清本地运营态；玩家刚登录时不要顺带 logout，否则会拆掉新 Cookie */
  function clearLocal() {
    bumpEpoch()
    endPlay()
    profile.value = null
    token.value = ''
    restored.value = true
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(PLAY_KEY)
  }

  function logout() {
    clearLocal()
    // 清 Cookie，避免同域残留会话挡玩家登录 / CSRF
    void import('@/api/auth').then(({ authApi }) => authApi.logout()).catch(() => undefined)
  }

  function restoreSession(): Promise<void> {
    if (restored.value) return Promise.resolve()
    if (restoreInflight) return restoreInflight
    const epoch = sessionEpoch
    const tkAtStart = token.value
    restoreInflight = (async () => {
      try {
        if (!tkAtStart) {
          if (epoch === sessionEpoch) restored.value = true
          return
        }
        if (profile.value) {
          if (epoch === sessionEpoch) restored.value = true
          return
        }
        const { default: staffHttp } = await import('@/api/staffHttp')
        try {
          const me = await staffHttp.get<UserProfile, UserProfile>('/users/me')
          // 登录/退出已发生：丢弃过期结果，绝不能写回或再 logout
          if (epoch !== sessionEpoch || localStorage.getItem(TOKEN_KEY) !== tkAtStart) return
          profile.value = me
          playActive.value = localStorage.getItem(PLAY_KEY) === '1'
          if (playActive.value) {
            localStorage.setItem('token', token.value)
          }
          restored.value = true
        } catch {
          if (epoch !== sessionEpoch || localStorage.getItem(TOKEN_KEY) !== tkAtStart) return
          logout()
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
    loginKind,
    playActive,
    isLoggedIn,
    role,
    isBranch,
    isAgentSide,
    isCs,
    isMobileOps,
    homeRouteName,
    setAuth,
    beginPlay,
    endPlay,
    clearLocal,
    logout,
    restoreSession,
  }
})
