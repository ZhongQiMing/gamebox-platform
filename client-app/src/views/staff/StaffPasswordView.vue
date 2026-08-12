<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">修改密码</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <section class="sc-panel pwd-panel">
        <p class="pwd-tip">{{ staff.profile?.nickname }} · {{ staff.profile?.username }}</p>
        <label class="pwd-label">当前密码</label>
        <input v-model="oldPwd" class="pwd-input" type="password" maxlength="32" autocomplete="current-password">
        <label class="pwd-label">新密码</label>
        <input v-model="newPwd" class="pwd-input" type="password" maxlength="32" autocomplete="new-password" placeholder="至少 6 位">
        <label class="pwd-label">确认新密码</label>
        <input v-model="newPwd2" class="pwd-input" type="password" maxlength="32" autocomplete="new-password">
        <button type="button" class="pwd-submit" :disabled="busy" @click="submit">
          {{ busy ? '提交中…' : '确认修改' }}
        </button>
      </section>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import staffHttp from '@/api/staffHttp'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useStaffStore } from '@/stores/staff'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { validateOpsPassword } from '@gamebox/shared'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const oldPwd = ref('')
const newPwd = ref('')
const newPwd2 = ref('')
const busy = ref(false)

async function submit() {
  if (busy.value) return
  if (!oldPwd.value) return toast('请输入当前密码')
  const pwdErr = validateOpsPassword(newPwd.value, '新密码')
  if (pwdErr) return toast(pwdErr)
  if (newPwd.value !== newPwd2.value) return toast('两次新密码不一致')
  busy.value = true
  try {
    await staffHttp.patch('/users/me/password', {
      oldPassword: oldPwd.value,
      newPassword: newPwd.value,
    })
    toast('密码已修改，请重新登录')
    const kind = staff.loginKind
    await staff.logout()
    await router.replace({ name: kind === 'branch' ? 'staff-login-branch' : 'staff-login-agent' })
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '修改失败')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.pwd-panel {
  padding: 18px 16px 20px;
}
.pwd-tip {
  margin: 0 0 16px;
  font-size: 12px;
  color: rgba(244, 211, 107, 0.55);
  letter-spacing: 1px;
}
.pwd-label {
  display: block;
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(255, 244, 194, 0.6);
}
.pwd-input {
  width: 100%;
  height: 44px;
  margin-bottom: 14px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(212, 175, 55, 0.35);
  background: rgba(0, 0, 0, 0.35);
  color: #fff4c2;
  box-sizing: border-box;
}
.pwd-submit {
  width: 100%;
  height: 48px;
  margin-top: 8px;
  border-radius: 12px;
  border: 0;
  background: linear-gradient(180deg, #f5d36b, #c9a227);
  color: #1a1208;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 4px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(201, 162, 39, 0.35);
}
.pwd-submit:disabled { opacity: 0.6; }
</style>
