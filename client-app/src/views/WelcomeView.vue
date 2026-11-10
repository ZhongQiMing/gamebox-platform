<template>
  <!-- 屏幕级装饰层：皇冠铺底 + 四角卷草（与原型一致，依赖 body.deco-bg 的 fixed 定位） -->
  <div class="screen-deco" aria-hidden="true">
    <img class="crown-deco" src="/images/crown-emblem.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div :ref="pageEl" class="page welcome-page">

    <!-- 顶部品牌栏 -->
    <div class="brand-bar">
      <div class="brand">
        <span class="brand-dot"></span>
        <span class="brand-wordmark">GOLD&nbsp;HUB</span>
      </div>
      <div class="menu-btn" @click.stop="menuOpen = !menuOpen" aria-label="菜单">
        <span></span><span></span><span></span>
      </div>
    </div>

    <!-- 右上角弹出菜单 -->
    <div :class="['menu-popover', menuOpen ? 'show' : '']" @click.stop>
      <div class="menu-item" @click="goStaffLogin('agent')">
        <span class="ic">⚜</span><span class="lb">代理登录</span><span class="arrow">›</span>
      </div>
      <div class="menu-item" @click="goStaffLogin('branch')">
        <span class="ic">♛</span><span class="lb">总监登录</span><span class="arrow">›</span>
      </div>
      <div class="menu-item" @click="toast('关于：金御汇 v1.0'); menuOpen=false">
        <span class="ic">ⓘ</span><span class="lb">关于</span><span class="arrow">›</span>
      </div>
    </div>

    <!-- 主体 -->
    <div class="welcome-body" @click="menuOpen=false">
      <div class="welcome-hero">
        <div class="hero-medal" aria-hidden="true">
          <span class="hero-medal-ring"></span>
          <img class="hero-medal-img" src="/images/splash-medal.webp" alt="">
        </div>
        <h1 class="hero-title" aria-label="金御汇">
          <span>金</span><span>御</span><span>汇</span>
        </h1>
        <div class="luxe-divider hero-divider"><span></span>◆<span></span></div>
        <div class="hero-en">G O L D &nbsp;·&nbsp; H U B</div>
      </div>

      <form class="welcome-form" @submit.prevent="doLogin">

        <div class="field-luxe">
          <span class="ic" aria-hidden="true"><img src="/images/icon-user.svg" alt=""></span>
          <input v-model="account" type="text" class="field" placeholder="账号" maxlength="20" autocomplete="username">
        </div>

        <div class="field-luxe">
          <span class="ic" aria-hidden="true"><img src="/images/icon-lock.svg" alt=""></span>
          <input v-model="password" type="password" class="field" placeholder="密码" maxlength="30" autocomplete="current-password">
        </div>

        <div class="welcome-options">
          <label class="remember-row">
            <input v-model="rememberMe" type="checkbox">
            <span class="remember-box" aria-hidden="true"></span>
            <span class="remember-label">记 住 密 码</span>
          </label>
        </div>

        <div class="welcome-actions">
          <button type="submit" class="btn btn-primary btn-block" :disabled="loading">
            <span class="ruby ruby-l"></span>
            <span class="btn-text">{{ loading ? '登录中...' : '登 录' }}</span>
            <span class="ruby ruby-r"></span>
          </button>
          <button type="button" class="btn btn-secondary btn-block" @click="router.push('/register')">
            注 册 账 号
          </button>
        </div>

      </form>
    </div>

    <div class="welcome-footer">
      <div class="footer-mark">
        <span>金御汇</span><span class="sep">·</span><span>2026</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { authApi } from '@/api/auth'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { useScreenFit } from '@/composables/useScreenFit'
import { acceptLoginRole } from '@/utils/loginRoleGuard'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { isNativeApp } from '@/api/session'
import '@/assets/welcome.css'

useBodyClass('deco-bg', 'welcome-login')
const pageEl = useScreenFit()

const router = useRouter()
const userStore = useUserStore()
const { toast, error: toastError } = useToast()

const account = ref('')
const password = ref('')
const rememberMe = ref(false)
const menuOpen = ref(false)
const loading = ref(false)

const REMEMBER_KEY = 'gamebox_remember_player'
const REMEMBER_PWD_KEY = 'player_login_pwd'

async function readSavedPassword(): Promise<string> {
  try {
    if (!isNativeApp()) {
      await SecureStorage.setKeyPrefix('gamebox_')
    }
    const value = await SecureStorage.getItem(REMEMBER_PWD_KEY)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

async function writeSavedPassword(pwd: string) {
  try {
    if (!isNativeApp()) {
      await SecureStorage.setKeyPrefix('gamebox_')
    }
    if (pwd) await SecureStorage.setItem(REMEMBER_PWD_KEY, pwd)
    else await SecureStorage.removeItem(REMEMBER_PWD_KEY)
  } catch {
    /* 安全存储不可用时不打断登录 */
  }
}

onMounted(() => {
  void (async () => {
    try {
      const raw = localStorage.getItem(REMEMBER_KEY)
      const saved = raw ? (JSON.parse(raw) as { acc?: string; pwd?: string }) : null
      if (saved?.acc) {
        account.value = saved.acc
        rememberMe.value = true
      }
      const legacyPwd = saved?.pwd || ''
      if (saved?.pwd) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ acc: saved.acc }))
      }
      const stored = (await readSavedPassword()) || legacyPwd
      if (stored && rememberMe.value) {
        password.value = stored
        if (legacyPwd) await writeSavedPassword(legacyPwd)
      }
    } catch {
      /* ignore */
    }
  })()
})

function goStaffLogin(kind: 'agent' | 'branch') {
  menuOpen.value = false
  // replace：三个登录口不互相堆历史，避免返回键来回串页
  router.replace({ name: kind === 'branch' ? 'staff-login-branch' : 'staff-login-agent' })
}

async function doLogin() {
  if (!account.value.trim()) { toastError('请输入账号'); return }
  if (!password.value) { toastError('请输入密码'); return }
  loading.value = true
  try {
    const res = await authApi.login({ username: account.value.trim(), password: password.value })
    const role = res.user.role
    // 玩家入口只收玩家；运营账号一律当「不存在」，不暴露另有入口
    const accepted = await acceptLoginRole(
      role,
      (candidate) => !['ADMIN', 'BRANCH', 'AGENT', 'PROXY', 'CS'].includes(candidate),
      authApi.logout,
    )
    if (!accepted) {
      toastError('账号不存在')
      return
    }
    userStore.setAuth(res.user, res.token)
    try {
      if (rememberMe.value) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ acc: account.value.trim() }))
        await writeSavedPassword(password.value)
      } else {
        localStorage.removeItem(REMEMBER_KEY)
        await writeSavedPassword('')
      }
    } catch {
      /* ignore */
    }
    toast(`欢迎 ${res.user.nickname}`)
    await router.replace({ name: 'room' })
  } catch (e: unknown) {
    toastError(e instanceof Error ? e.message : '登录失败')
  } finally {
    loading.value = false
  }
}
</script>
