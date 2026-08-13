import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UserProfile } from '@/api/auth'
import {
  PLAYER_TOKEN_KEY, STAFF_TOKEN_KEY, clearSessionMark, isNativeApp, loadToken,
  markSession, removeToken, saveToken, sessionKind,
} from '@/api/session'
import { publicMediaUrl } from '@/utils/publicMediaUrl'

const TOKEN_KEY = STAFF_TOKEN_KEY
const KIND_KEY = 'staff_login_kind'
const PLAY_KEY = 'staff_play'

export type StaffLoginKind = 'agent' | 'branch'

function withPublicAvatar(user: UserProfile): UserProfile {
  return { ...user, avatar: publicMediaUrl(user.avatar) || null }
}

export const useStaffStore = defineStore('staff', () => {
  const profile = ref<UserProfile | null>(null)
  /* 网页版恒为空：凭证在 HttpOnly Cookie 里（见 api/session.ts） */
  const token = ref<string>(loadToken(TOKEN_KEY))
  const loginKind = ref<StaffLoginKind>(
    (localStorage.getItem(KIND_KEY) as StaffLoginKind) || 'agent',
  )
  const playActive = ref(localStorage.getItem(PLAY_KEY) === '1')
  const restored = ref(false)
  let restoreInflight: Promise<void> | null = null
  /** 登录/退出递增，作废进行中的 restore，防止旧 me() 401 或晚到结果写回会话 */
  let sessionEpoch = 0

  const isLoggedIn = computed(() =>
    !!profile.value && (isNativeApp() ? !!token.value : sessionKind() === 'staff'))
  const role = computed(() => profile.value?.role || '')
  const isBranch = computed(() => role.value === 'BRANCH' || role.value === 'ADMIN')
  const isGeneral = computed(() => role.value === 'GENERAL')
  const isAgentSide = computed(() => role.value === 'AGENT' || role.value === 'PROXY')
  const isCs = computed(() => role.value === 'CS')
  /** 手机底栏运营端：主代理 / 总代 / 子账号 / 客服 / 管理 / 总监 */
  const isMobileOps = computed(() => isAgentSide.value || isCs.value || isBranch.value || isGeneral.value)

  /** 登录后默认页 */
  function homeRouteName(): string {
    if (isCs.value) return 'staff-fund'
    if (isAgentSide.value) return 'staff-lobby'
    if (isGeneral.value || isBranch.value) return 'staff-game-rooms'
    return 'staff-home'
  }

  function bumpEpoch() {
    sessionEpoch += 1
    restoreInflight = null
  }

  function setAuth(user: UserProfile, tk: string, kind: StaffLoginKind) {
    bumpEpoch()
    removeToken(PLAYER_TOKEN_KEY)
    localStorage.removeItem(PLAY_KEY)
    playActive.value = false
    profile.value = withPublicAvatar(user)
    token.value = tk
    loginKind.value = kind
    saveToken(TOKEN_KEY, tk)
    markSession('staff')
    localStorage.setItem(KIND_KEY, kind)
    restored.value = true
  }

  /**
   * 进入玩家游戏链路：不退出运营会话。
   * App 把票镜像一份给玩家端用；网页版两边本来就是同一个 Cookie，不用镜像。
   * 所以这里只能判 profile，判 token 会让网页版永远进不去游戏。
   */
  function beginPlay() {
    if (!profile.value) return
    playActive.value = true
    localStorage.setItem(PLAY_KEY, '1')
    saveToken(PLAYER_TOKEN_KEY, token.value)
  }

  function endPlay(): Promise<void> {
    playActive.value = false
    localStorage.removeItem(PLAY_KEY)
    if (token.value && loadToken(PLAYER_TOKEN_KEY) === token.value) {
      return removeToken(PLAYER_TOKEN_KEY)
    }
    return Promise.resolve()
  }

  /** 只清本地运营态；玩家刚登录时不要顺带 logout，否则会拆掉新 Cookie */
  function clearLocal(): Promise<void> {
    bumpEpoch()
    const playRemoved = endPlay()
    profile.value = null
    token.value = ''
    restored.value = true
    const staffRemoved = removeToken(TOKEN_KEY)
    clearSessionMark('staff')
    localStorage.removeItem(PLAY_KEY)
    return Promise.all([playRemoved, staffRemoved]).then(() => undefined)
  }

  async function logout(): Promise<void> {
    const removed = clearLocal()
    // 清 Cookie，避免同域残留会话挡玩家登录 / CSRF
    const remote = import('@/api/auth')
      .then(({ authApi }) => authApi.logout())
      .catch(() => undefined)
    await Promise.all([removed.catch(() => undefined), remote])
  }

  function restoreSession(): Promise<void> {
    if (restored.value) return Promise.resolve()
    if (restoreInflight) return restoreInflight
    const epoch = sessionEpoch
    const tkAtStart = token.value
    restoreInflight = (async () => {
      try {
        const hasSession = isNativeApp() ? !!tkAtStart : sessionKind() === 'staff'
        if (!hasSession) {
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
          if (epoch !== sessionEpoch) return
          profile.value = withPublicAvatar(me)
          playActive.value = localStorage.getItem(PLAY_KEY) === '1'
          if (playActive.value) {
            saveToken(PLAYER_TOKEN_KEY, token.value)
          }
          restored.value = true
        } catch {
          if (epoch !== sessionEpoch) return
          void logout()
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
    isGeneral,
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
