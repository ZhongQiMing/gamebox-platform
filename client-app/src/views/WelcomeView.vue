<template>
  <!-- 屏幕级装饰层：皇冠铺底 + 四角卷草（与原型一致，依赖 body.deco-bg 的 fixed 定位） -->
  <div class="screen-deco" aria-hidden="true">
    <img class="crown-deco" src="/images/crown-emblem.png" alt="">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page welcome-page">

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
        <span class="ic">♛</span><span class="lb">房主登录</span><span class="arrow">›</span>
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
          <img class="hero-medal-img" src="/images/splash-medal.png" alt="">
        </div>
        <h1 class="hero-title" aria-label="金御汇">
          <span>金</span><span>御</span><span>汇</span>
        </h1>
        <div class="luxe-divider hero-divider"><span></span>◆<span></span></div>
        <div class="hero-en">G O L D &nbsp;·&nbsp; H U B</div>
      </div>

      <form class="welcome-form" @submit.prevent>

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
          <button class="btn btn-primary btn-block" :disabled="loading" @click="doLogin">
            <span class="ruby ruby-l"></span>
            <span class="btn-text">{{ loading ? '登录中...' : '登 录' }}</span>
            <span class="ruby ruby-r"></span>
          </button>
          <button class="btn btn-secondary btn-block" @click="router.push('/register')">
            注 册 账 号
          </button>
        </div>

      </form>
    </div>

    <div class="welcome-footer">
      <div class="footer-mark">
        <span>GOLDHUB</span><span class="sep">·</span><span>EST·2026</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useStaffStore } from '@/stores/staff'
import { authApi } from '@/api/auth'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/welcome.css'

useBodyClass('deco-bg', 'welcome-login')

const router = useRouter()
const userStore = useUserStore()
const staffStore = useStaffStore()
const { toast } = useToast()

const account = ref('')
const password = ref('')
const rememberMe = ref(false)
const menuOpen = ref(false)
const loading = ref(false)

const REMEMBER_KEY = 'gamebox_remember_player'

onMounted(() => {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as { acc?: string; pwd?: string }
    if (saved?.acc) {
      account.value = saved.acc
      rememberMe.value = true
    }
    // 历史版本曾明文存密码，发现即清除
    if (saved?.pwd) {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ acc: saved.acc }))
    }
  } catch {
    /* ignore */
  }
})

function goStaffLogin(kind: 'agent' | 'branch') {
  menuOpen.value = false
  router.push({ name: kind === 'branch' ? 'staff-login-branch' : 'staff-login-agent' })
}

async function doLogin() {
  if (!account.value.trim()) { toast('请输入账号'); return }
  if (!password.value) { toast('请输入密码'); return }
  loading.value = true
  try {
    const res = await authApi.login({ username: account.value.trim(), password: password.value })
    const role = res.user.role
    // 运营账号：写入 staff 会话并进手机工作台（勿进玩家房间号页）
    if (role === 'ADMIN' || role === 'BRANCH') {
      staffStore.setAuth(res.user, res.token, 'branch')
      userStore.logout()
      toast(`欢迎 ${res.user.nickname}`)
      await router.replace({ name: 'staff-home' })
      return
    }
    if (role === 'AGENT' || role === 'PROXY') {
      staffStore.setAuth(res.user, res.token, 'agent')
      userStore.logout()
      toast(`欢迎 ${res.user.nickname}`)
      await router.replace({ name: 'staff-home' })
      return
    }
    userStore.setAuth(res.user, res.token)
    try {
      if (rememberMe.value) {
        localStorage.setItem(REMEMBER_KEY, JSON.stringify({ acc: account.value.trim() }))
      } else {
        localStorage.removeItem(REMEMBER_KEY)
      }
    } catch {
      /* ignore */
    }
    toast(`欢迎 ${res.user.nickname}`)
    await router.replace({ name: 'room' })
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '登录失败')
  } finally {
    loading.value = false
  }
}
</script>
