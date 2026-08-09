import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface AdminProfile {
  id: string; uid: string; username: string; nickname: string; role: string
}

/**
 * 后台登录态。
 *
 * 真正的凭证是服务端下发的 HttpOnly Cookie，**这里拿不到、也不该拿到**——
 * 那正是它的意义：页面上任何 JS（包括万一被注入的恶意脚本）都读不走管理员身份。
 *
 * 所以本地只留两样东西：
 *   profile —— 显示用的账号信息
 *   sessionFlag —— 一个「上次登录过」的标记，用来在刷新后决定是先拉资料还是直接去登录页，
 *                  它不是凭证，伪造它没有任何用，服务端认的只有 Cookie。
 */
const SESSION_FLAG = 'admin_session'

export const useAdminStore = defineStore('admin', () => {
  const profile = ref<AdminProfile | null>(null)
  const hadSession = ref(localStorage.getItem(SESSION_FLAG) === '1')

  const isLoggedIn = computed(() => !!profile.value)

  function setAuth(user: AdminProfile) {
    profile.value = user
    hadSession.value = true
    localStorage.setItem(SESSION_FLAG, '1')
  }

  function logout() {
    profile.value = null
    hadSession.value = false
    localStorage.removeItem(SESSION_FLAG)
    /* 迁移期清理：老版本把 token 明文存在这里 */
    localStorage.removeItem('admin_token')
  }

  return { profile, hadSession, isLoggedIn, setAuth, logout }
})
