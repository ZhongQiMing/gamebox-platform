<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="crown-deco" src="/images/crown-emblem.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page welcome-page">
    <div class="brand-bar">
      <div class="brand">
        <span class="back-btn" @click="goBack" aria-label="返回">‹</span>
        <span class="brand-dot"></span>
        <span class="brand-wordmark">GOLD&nbsp;HUB</span>
      </div>
      <div class="menu-btn" @click.stop="menuOpen = !menuOpen" aria-label="菜单">
        <span></span><span></span><span></span>
      </div>
    </div>

    <div :class="['menu-popover', menuOpen ? 'show' : '']" @click.stop>
      <div class="menu-item" @click="goPlayerLogin">
        <span class="ic">♟</span><span class="lb">返回玩家登录</span><span class="arrow">›</span>
      </div>
      <div v-if="kind === 'branch'" class="menu-item" @click="goOtherLogin">
        <span class="ic">⚜</span><span class="lb">代理 / 总代 / 客服</span><span class="arrow">›</span>
      </div>
      <div v-else class="menu-item" @click="goOtherLogin">
        <span class="ic">♛</span><span class="lb">总监登录</span><span class="arrow">›</span>
      </div>
      <div class="menu-item" @click="toast('关于：金御汇 v1.0'); menuOpen = false">
        <span class="ic">ⓘ</span><span class="lb">关于</span><span class="arrow">›</span>
      </div>
    </div>

    <div class="welcome-body" @click="menuOpen = false">
      <div class="welcome-hero">
        <div class="hero-medal" aria-hidden="true">
          <span class="hero-medal-ring"></span>
          <img class="hero-medal-img" src="/images/splash-medal.webp" alt="">
        </div>
        <h1 class="hero-title" aria-label="金御汇">
          <span>金</span><span>御</span><span>汇</span>
        </h1>
        <div class="luxe-divider hero-divider"><span></span>◆<span></span></div>
        <div class="hero-en">{{ kind === 'branch' ? '总 监 登 录' : '代 理 · 总 代 · 客 服' }}</div>
      </div>

      <form class="welcome-form" @submit.prevent>
        <div class="field-luxe">
          <span class="ic" aria-hidden="true"><img src="/images/icon-user.svg" alt=""></span>
          <input
            v-model="account"
            type="text"
            class="field"
            :placeholder="kind === 'branch' ? '总监 / 管理账号' : '代理 / 总代 / 子账号 / 客服'"
            maxlength="20"
            autocomplete="username"
          >
        </div>
        <div class="field-luxe">
          <span class="ic" aria-hidden="true"><img src="/images/icon-lock.svg" alt=""></span>
          <input
            v-model="password"
            type="password"
            class="field"
            placeholder="密码"
            maxlength="30"
            autocomplete="current-password"
          >
        </div>
        <div class="welcome-options">
          <label class="remember-row">
            <input v-model="rememberMe" type="checkbox">
            <span class="remember-box" aria-hidden="true"></span>
            <span class="remember-label">记 住 账 号</span>
          </label>
        </div>
        <div class="welcome-actions">
          <button class="btn btn-primary btn-block" :disabled="loading" @click="doLogin">
            <span class="ruby ruby-l"></span>
            <span class="btn-text">{{ loading ? '登录中...' : '登 录' }}</span>
            <span class="ruby ruby-r"></span>
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
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { authApi } from '@/api/auth'
import { useStaffStore, type StaffLoginKind } from '@/stores/staff'
import { useUserStore } from '@/stores/user'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { acceptLoginRole } from '@/utils/loginRoleGuard'
import '@/assets/welcome.css'

useBodyClass('deco-bg', 'welcome-login')

const route = useRoute()
const router = useRouter()
const staff = useStaffStore()
const userStore = useUserStore()
const { toast, error: toastError } = useToast()

const kind = computed<StaffLoginKind>(() =>
  route.name === 'staff-login-branch' ? 'branch' : 'agent',
)

const account = ref('')
const password = ref('')
const rememberMe = ref(false)
const menuOpen = ref(false)
const loading = ref(false)

function rememberKey() {
  return kind.value === 'branch' ? 'gamebox_remember_staff_branch' : 'gamebox_remember_staff_agent'
}

function restoreRemember() {
  try {
    const raw = localStorage.getItem(rememberKey())
    if (!raw) return
    const saved = JSON.parse(raw) as { acc?: string; pwd?: string }
    if (saved?.acc) {
      account.value = saved.acc
      rememberMe.value = true
    }
    if (saved?.pwd) {
      localStorage.setItem(rememberKey(), JSON.stringify({ acc: saved.acc }))
    }
  } catch {
    /* ignore */
  }
}

onMounted(restoreRemember)
watch(kind, () => {
  account.value = ''
  password.value = ''
  rememberMe.value = false
  restoreRemember()
})

async function goBack() {
  // 固定回玩家登录，不用 history.back（否则会在房主/代理登录之间来回串）
  menuOpen.value = false
  const writes = [userStore.clearLocal()]
  if (staff.isLoggedIn) writes.push(staff.logout())
  await Promise.all(writes)
  await router.replace({ name: 'login' })
}
async function goPlayerLogin() {
  menuOpen.value = false
  const writes = [userStore.clearLocal()]
  if (staff.isLoggedIn) writes.push(staff.logout())
  await Promise.all(writes)
  await router.replace({ name: 'login' })
}
function goOtherLogin() {
  menuOpen.value = false
  router.replace({
    name: kind.value === 'branch' ? 'staff-login-agent' : 'staff-login-branch',
  })
}

async function doLogin() {
  if (!account.value.trim()) {
    toastError(kind.value === 'branch' ? '请输入总监账号' : '请输入账号')
    return
  }
  if (!password.value) {
    toastError('请输入密码')
    return
  }
  loading.value = true
  try {
    const res = await authApi.login({
      username: account.value.trim(),
      password: password.value,
    })
    const role = res.user.role
    const accepted = await acceptLoginRole(
      role,
      kind.value === 'branch'
        ? (candidate) => candidate === 'BRANCH' || candidate === 'ADMIN'
        : (candidate) => candidate === 'AGENT' || candidate === 'GENERAL' || candidate === 'PROXY' || candidate === 'CS',
      authApi.logout,
    )
    if (!accepted) {
      toastError('账号不存在')
      return
    }
    // 只清本地玩家态：勿调 userStore.logout()/auth logout，否则会拆掉刚登录下发的 Cookie，
    // 且并发的玩家 me() 401 曾会误把运营会话整页踢回登录页。
    userStore.clearLocal()
    staff.setAuth(res.user, res.token, kind.value)
    try {
      if (rememberMe.value) {
        localStorage.setItem(rememberKey(), JSON.stringify({ acc: account.value.trim() }))
      } else {
        localStorage.removeItem(rememberKey())
      }
    } catch {
      /* ignore */
    }
    toast(`欢迎 ${res.user.nickname}`)
    await router.replace({ name: staff.homeRouteName() })
  } catch (e: unknown) {
    toastError(e instanceof Error ? e.message : '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-right: 2px;
  font-size: 28px;
  line-height: 1;
  color: var(--gold-bright);
  cursor: pointer;
}
.staff-login-tip {
  margin: 16px 8px 0;
  text-align: center;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-muted);
  line-height: 1.6;
}
</style>
