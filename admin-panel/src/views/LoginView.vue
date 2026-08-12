<template>
  <div class="login-wrap">
    <div class="login-glow" aria-hidden="true" />
    <div class="login-box">
      <div class="login-logo">♛ <span>运营控制台</span></div>
      <el-tag v-if="envLabel" size="small" type="warning" effect="plain" class="env">{{ envLabel }}</el-tag>
      <el-form :model="form" :rules="rules" ref="formRef" label-position="top">
        <el-form-item label="用户名" prop="username">
          <el-input
            v-model="form.username"
            placeholder="请输入用户名"
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
        <el-button type="primary" size="large" :loading="loading" @click="doLogin" style="width:100%;margin-top:8px">
          登 录
        </el-button>
      </el-form>
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
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

interface AuthResult { user: { id: string; uid: string; username: string; nickname: string; role: string }; token: string }

async function doLogin() {
  if (!await formRef.value?.validate().catch(() => false)) return
  loading.value = true
  try {
    const res = await http.post<AuthResult, AuthResult>('/auth/login', form.value)
    if (!['ADMIN', 'BRANCH', 'AGENT', 'PROXY', 'CS'].includes(res.user.role)) {
      ElMessage.error('该账号无控制台权限（需管理员/房主/代理/子账号/客服）')
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
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(900px 420px at 18% 10%, rgba(56, 189, 248, 0.22), transparent 55%),
    radial-gradient(700px 380px at 88% 20%, rgba(129, 140, 248, 0.18), transparent 50%),
    linear-gradient(180deg, #070b14 0%, #0f172a 55%, #111827 100%);
}
.login-glow {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(rgba(148, 163, 184, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.04) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: radial-gradient(circle at 50% 45%, #000 20%, transparent 72%);
  pointer-events: none;
}
.login-box {
  width: 400px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 16px;
  padding: 40px;
  border: 1px solid rgba(56, 189, 248, 0.25);
  box-shadow: 0 24px 64px rgba(2, 8, 23, 0.45), 0 0 0 1px rgba(255,255,255,0.05) inset;
  position: relative;
  z-index: 1;
}
.login-logo {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 6px;
}
.login-logo span {
  background: linear-gradient(90deg, #38bdf8, #3b82f6);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hint {
  font-size: 13px;
  color: #64748b;
  margin: 0 0 18px;
}
.env {
  position: absolute;
  top: 16px;
  right: 16px;
}
</style>
