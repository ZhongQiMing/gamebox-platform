<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="crown-deco" src="/images/crown-emblem.png" alt="">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page register-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">
        <span class="brand-dot"></span>
        <span class="brand-wordmark">GOLD&nbsp;HUB</span>
      </div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <div class="welcome-hero register-hero">
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

      <form class="register-form" @submit.prevent>
        <div class="field-luxe">
          <span class="ic" aria-hidden="true"><img src="/images/icon-user.svg" alt=""></span>
          <input v-model="account" type="text" class="field" placeholder="账号（8 位以上，英文+数字）" maxlength="20" autocomplete="username">
        </div>

        <div class="field-luxe">
          <span class="ic" aria-hidden="true"><img src="/images/icon-lock.svg" alt=""></span>
          <input v-model="password" type="password" class="field" placeholder="设置密码（6 位以上）" maxlength="30" autocomplete="new-password">
        </div>

        <div class="field-luxe">
          <span class="ic" aria-hidden="true"><img src="/images/icon-lock.svg" alt=""></span>
          <input v-model="password2" type="password" class="field" placeholder="再次输入密码" maxlength="30" autocomplete="new-password">
        </div>

        <div class="register-actions">
          <button class="btn btn-primary btn-block" :disabled="loading" @click="doRegister">
            <span class="ruby ruby-l"></span>
            <span class="btn-text">{{ loading ? '注册中...' : '立 即 注 册' }}</span>
            <span class="ruby ruby-r"></span>
          </button>
        </div>

        <div class="register-extra">
          已有账号？<a @click.prevent="router.push('/login')">直接登录 →</a>
        </div>

        <div class="register-extra">
          注册即表示同意<a @click.prevent="router.push('/privacy')">《隐私政策》</a>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { validateAccount, validatePassword } from '@gamebox/shared'
import { useUserStore } from '@/stores/user'
import { authApi } from '@/api/auth'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/welcome.css'
import '@/assets/register.css'

useBodyClass('deco-bg')

const router = useRouter()
const userStore = useUserStore()
const { toast } = useToast()

const account = ref('')
const password = ref('')
const password2 = ref('')
const loading = ref(false)

async function doRegister() {
  const acc = account.value.trim()
  // 复用 @gamebox/shared 权威校验，与后端规则同源（后端仍会独立再校验）
  const accErr = validateAccount(acc)
  if (accErr) { toast(accErr); return }
  const pwdErr = validatePassword(password.value)
  if (pwdErr) { toast(pwdErr); return }
  if (password.value !== password2.value) { toast('两次密码不一致'); return }
  loading.value = true
  try {
    const res = await authApi.register({
      username: acc,
      password: password.value,
    })
    userStore.setAuth(res.user, res.token)
    toast('注册成功，欢迎加入！')
    setTimeout(() => router.push('/room'), 800)
  } catch (e: any) {
    toast(e.message ?? '注册失败')
  } finally {
    loading.value = false
  }
}
</script>
