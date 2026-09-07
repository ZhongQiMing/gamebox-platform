import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface AdminProfile {
  id: string; uid: string; username: string; nickname: string; role: string
  parentId?: string | null
  parentRole?: string | null
}

/**
 * 后台登录态。
 *
 * 真正的凭证是服务端下发的 HttpOnly Cookie，**这里拿不到、也不该拿到**——
 * 那正是它的意义：页面上任何 JS（包括万一被注入的恶意脚本）都读不走管理员身份。
 *
 * 本地只留两样东西：
 *   profile —— 显示用的账号信息
 *   sessionFlag —— 「这个标签页里登录过」的标记，用来在刷新后决定是先拉资料还是去登录页。
 *                  它不是凭证，伪造它没用，服务端认的只有 Cookie。
 *
 * 标记放 sessionStorage、不放 localStorage：关标签 / 关窗口再开必须重新登录；
 * 同一标签里刷新仍在，运营改个配置不会被踢出去。
 */
const SESSION_FLAG = 'admin_session'

function readSessionFlag(): boolean {
  try {
    return sessionStorage.getItem(SESSION_FLAG) === '1'
  } catch {
    return false
  }
}

function writeSessionFlag() {
  try {
    sessionStorage.setItem(SESSION_FLAG, '1')
  } catch {
    /* 隐私模式等写不了也不挡登录，刷新后会回到登录页 */
  }
  /* 旧版写在 localStorage，关浏览器也还在，一律清掉 */
  try {
    localStorage.removeItem(SESSION_FLAG)
    localStorage.removeItem('admin_token')
  } catch {
    /* ignore */
  }
}

function clearSessionFlag() {
  try {
    sessionStorage.removeItem(SESSION_FLAG)
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(SESSION_FLAG)
    localStorage.removeItem('admin_token')
  } catch {
    /* ignore */
  }
}

export const useAdminStore = defineStore('admin', () => {
  /* 旧版标记在 localStorage，关页再开还会自动恢复；升上来先抹掉 */
  try {
    localStorage.removeItem(SESSION_FLAG)
    localStorage.removeItem('admin_token')
  } catch {
    /* ignore */
  }

  const profile = ref<AdminProfile | null>(null)
  const hadSession = ref(readSessionFlag())

  const isLoggedIn = computed(() => !!profile.value)

  function setAuth(user: AdminProfile) {
    profile.value = user
    hadSession.value = true
    writeSessionFlag()
  }

  function logout() {
    profile.value = null
    hadSession.value = false
    clearSessionFlag()
  }

  return { profile, hadSession, isLoggedIn, setAuth, logout }
})
