<template>
  <div class="login-wrap">
    <div class="login-box">
      <div class="login-logo">♛ <span>运营控制台</span></div>
      <p class="hint">超管 / 房主 / 代理 / 子账号 统一入口</p>
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
    if (!['ADMIN', 'BRANCH', 'AGENT', 'PROXY'].includes(res.user.role)) {
      ElMessage.error('该账号无控制台权限（需超管/房主/代理/子账号）')
      return
    }
    store.setAuth(res.user, res.token)
    ElMessage.success('登录成功')
    router.push('/')
  } catch (e: unknown) {
    ElMessage.error((e as Error).message)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  background: linear-gradient(135deg, #0d111a 0%, #1a1f2e 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-box {
  width: 400px;
  background: #fff;
  border-radius: 12px;
  padding: 40px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.4);
  position: relative;
}
.login-logo {
  font-size: 22px;
  font-weight: 700;
  color: #d4a93c;
  margin-bottom: 6px;
}
.hint {
  font-size: 13px;
  color: #909399;
  margin: 0 0 18px;
}
.env {
  position: absolute;
  top: 16px;
  right: 16px;
}
</style>
