<template>
  <div class="login-wrap">
    <div class="login-bg" aria-hidden="true" />
    <div class="login-vignette" aria-hidden="true" />

    <el-tag v-if="envLabel" size="small" type="warning" effect="dark" class="env">{{ envLabel }}</el-tag>

    <div class="login-stage">
      <section class="brand">
        <h1 class="brand-title" data-text="金御汇">金御汇</h1>
        <div class="brand-divider" aria-hidden="true"><i /><b>◆</b><i /></div>
        <p class="brand-en">GOLD · HUB</p>
        <p class="brand-sub">运 营 管 理</p>
      </section>

      <section class="login-card">
        <h2 class="card-title">系统登录</h2>
        <el-form :model="form" :rules="rules" ref="formRef" label-position="top" class="login-form" @submit.prevent="doLogin">
          <el-form-item label="账号" prop="username">
            <el-input
              v-model="form.username"
              placeholder="请输入账号"
              size="large"
              autocomplete="username"
              @keyup.enter="doLogin"
            />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input
              v-model="form.password"
              type="password"
              placeholder="请输入密码"
              size="large"
              show-password
              autocomplete="current-password"
              @keyup.enter="doLogin"
            />
          </el-form-item>
          <el-button class="login-btn" native-type="submit" size="large" :loading="loading">
            登 录
          </el-button>
        </el-form>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { useAdminStore } from '@/stores/admin'
import http from '@/api/http'

const router = useRouter()
const store = useAdminStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const form = ref({ username: '', password: '' })

const envLabel = computed(() => {
  if (import.meta.env.PROD && import.meta.env.MODE === 'production') return ''
  if (import.meta.env.DEV) return '当前为开发环境'
  return `当前环境：${import.meta.env.MODE || 'unknown'}`
})

const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

interface AuthResult { user: { id: string; uid: string; username: string; nickname: string; role: string }; token: string }

async function doLogin() {
  if (!await formRef.value?.validate().catch(() => false)) return
  loading.value = true
  try {
    const res = await http.post<AuthResult, AuthResult>('/auth/login', {
      ...form.value,
      persist: false,
    })
    if (!['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY', 'CS'].includes(res.user.role)) {
      ElMessage.error('该账号无管理后台权限（需管理/总监/总代/代理/子账号/客服）')
      return
    }
    store.setAuth(res.user)
    ElMessage.success('登录成功')
    router.push(res.user.role === 'CS' ? '/recharge' : '/')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : ''
    ElMessage.error(msg && msg !== 'AUTH_EXPIRED' ? msg : '登录失败，请重试')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  color: #f5ecd6;
  background: #0d0a08;
}
.login-bg {
  position: absolute;
  inset: 0;
  background: url('/login-bg.png') center 42% / cover no-repeat;
}
.login-vignette {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 70% 80% at 50% 45%, transparent 0%, rgba(8, 6, 4, 0.18) 58%, rgba(8, 6, 4, 0.55) 100%),
    linear-gradient(180deg, rgba(8, 6, 4, 0.28) 0%, transparent 22%, transparent 78%, rgba(8, 6, 4, 0.42) 100%);
  pointer-events: none;
}
.env {
  position: absolute;
  top: 22px;
  left: 28px;
  z-index: 2;
}
.login-stage {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8vh 8vw;
  box-sizing: border-box;
}
.brand {
  max-width: 560px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.brand-title {
  position: relative;
  margin: 0 0 20px;
  padding-left: 0.22em;
  font-family: 'STZhongsong', 'STSong', 'Noto Serif SC', 'Songti SC', 'SimSun', serif;
  font-size: clamp(72px, 8vw, 108px);
  font-weight: 500;
  letter-spacing: 0.22em;
  line-height: 1.08;
  background: linear-gradient(180deg, #fff8d6 8%, #f6d56f 36%, #d4af37 68%, #8a6a1c 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: #d4af37;
}
.brand-title::before {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  padding: inherit;
  letter-spacing: inherit;
  background: none;
  -webkit-text-fill-color: transparent;
  color: transparent;
  text-shadow:
    0 1px 0 rgba(255, 244, 194, 0.28),
    0 4px 0 rgba(72, 48, 10, 0.55),
    0 10px 28px rgba(0, 0, 0, 0.45),
    0 0 28px rgba(244, 211, 107, 0.32);
  z-index: -1;
  pointer-events: none;
}
.brand-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(280px, 80%);
  margin: 0 auto 12px;
  color: #f4d36b;
}
.brand-divider i {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, #f4d36b, transparent);
}
.brand-divider b {
  font-weight: 400;
  font-size: 11px;
}
.brand-en {
  margin: 0 0 8px;
  padding-left: 0.42em;
  font-family: ui-monospace, 'SF Mono', 'JetBrains Mono', Consolas, monospace;
  font-size: 14px;
  letter-spacing: 0.42em;
  color: #f4d36b;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.55);
}
.brand-sub {
  margin: 0;
  padding-left: 0.46em;
  font-size: 16px;
  letter-spacing: 0.46em;
  color: #f5ecd6;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
}
.login-card {
  width: min(380px, 100%);
  padding: 32px 32px 28px;
  border-radius: 18px;
  background: rgba(13, 10, 8, 0.42);
  border: 1px solid rgba(244, 211, 107, 0.38);
  box-shadow:
    0 24px 56px rgba(0, 0, 0, 0.38),
    0 0 28px rgba(212, 175, 55, 0.1),
    inset 0 1px 0 rgba(255, 244, 194, 0.14);
  backdrop-filter: blur(18px) saturate(1.15);
  -webkit-backdrop-filter: blur(18px) saturate(1.15);
}
.card-title {
  margin: 0 0 18px;
  font-family: 'Noto Serif SC', 'Songti SC', 'STZhongsong', 'SimSun', serif;
  font-size: 22px;
  font-weight: 700;
  color: #fff4c2;
  letter-spacing: 0.2em;
  text-align: center;
}
.login-form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.login-form :deep(.el-form-item__label) {
  color: #f5ecd6;
  font-weight: 600;
  letter-spacing: 0.1em;
  margin-bottom: 4px;
}
.login-form :deep(.el-input__wrapper) {
  background: rgba(245, 236, 214, 0.14);
  box-shadow: none;
  border: 1px solid rgba(244, 211, 107, 0.32);
  border-radius: 8px;
}
.login-form :deep(.el-input__wrapper.is-focus) {
  border-color: #f4d36b;
  background: rgba(245, 236, 214, 0.2);
  box-shadow: 0 0 0 1px rgba(244, 211, 107, 0.22);
}
.login-form :deep(.el-input__inner) {
  color: #fff8d6;
}
.login-form :deep(.el-input__inner::placeholder) {
  color: rgba(201, 184, 144, 0.7);
}
.login-form :deep(.el-input__password) {
  color: #f4d36b;
}
.login-form :deep(.el-form-item__error) {
  color: #f0b4b4;
}
.login-btn {
  width: 100%;
  height: 44px;
  margin-top: 4px;
  font-size: 16px;
  letter-spacing: 0.28em;
  color: #2b2014;
  background: linear-gradient(180deg, #fff5c8 0%, #f4d36b 35%, #d4af37 65%, #8a6f1f 100%);
  border: 0;
}
.login-btn:hover,
.login-btn:focus {
  color: #2b2014;
  background: linear-gradient(180deg, #fff8d6 0%, #f7de86 40%, #e0be4a 100%);
}

@media (max-width: 900px) {
  .login-stage {
    flex-direction: column;
    justify-content: center;
    gap: 28px;
    padding: 72px 20px 40px;
    text-align: center;
  }
  .brand {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .brand-title {
    font-size: 64px;
    letter-spacing: 0.16em;
  }
  .brand-divider {
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
