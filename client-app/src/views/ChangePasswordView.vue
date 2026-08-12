<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page password-page">

    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">修 改 密 码</div>
      <div class="right"></div>
    </div>

    <div class="page-body">

      <!-- 当前账号信息卡片 -->
      <div class="pwd-account-card">
        <div class="pac-avatar"><img :src="avatarSrc" alt=""></div>
        <div class="pac-info">
          <div class="pac-name">{{ userStore.profile?.nickname ?? '———' }}</div>
          <div class="pac-meta">
            <span class="pac-label">账号</span>
            <span class="pac-account">{{ userStore.profile?.username ?? '———' }}</span>
          </div>
        </div>
      </div>

      <!-- 表单卡片 -->
      <div class="pwd-form-card">
        <div class="pwd-row">
          <label class="pwd-label">当 前 密 码</label>
          <div class="pwd-input-wrap">
            <input
              v-model="oldPwd"
              :type="show.old ? 'text' : 'password'"
              placeholder="请输入当前密码"
              maxlength="32"
              autocomplete="current-password"
            >
            <button type="button" class="pwd-eye" aria-label="显示/隐藏密码" @click="show.old = !show.old">
              <svg v-if="!show.old" viewBox="0 0 24 24" class="eye-close" aria-hidden="true">
                <path d="M3 3l18 18"/>
                <path d="M10.6 6.1A11 11 0 0 1 12 6c5 0 9 4 10 6-.4.8-1.4 2.5-3 4M6.5 7.7C4 9.2 2.4 11.3 2 12c1 2 5 6 10 6 1.7 0 3.3-.5 4.7-1.3"/>
                <path d="M9.9 9.9A3 3 0 0 0 14.1 14.1"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" class="eye-open" aria-hidden="true">
                <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="pwd-row">
          <label class="pwd-label">新 密 码</label>
          <div class="pwd-input-wrap">
            <input
              v-model="newPwd"
              :type="show.new1 ? 'text' : 'password'"
              placeholder="6 位以上"
              maxlength="32"
              autocomplete="new-password"
            >
            <button type="button" class="pwd-eye" aria-label="显示/隐藏密码" @click="show.new1 = !show.new1">
              <svg v-if="!show.new1" viewBox="0 0 24 24" class="eye-close" aria-hidden="true">
                <path d="M3 3l18 18"/>
                <path d="M10.6 6.1A11 11 0 0 1 12 6c5 0 9 4 10 6-.4.8-1.4 2.5-3 4M6.5 7.7C4 9.2 2.4 11.3 2 12c1 2 5 6 10 6 1.7 0 3.3-.5 4.7-1.3"/>
                <path d="M9.9 9.9A3 3 0 0 0 14.1 14.1"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" class="eye-open" aria-hidden="true">
                <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
          <div class="pwd-strength">
            <div class="ps-bar"><div class="ps-fill" :class="strength.cls"></div></div>
            <span class="ps-text">{{ strength.text }}</span>
          </div>
        </div>

        <div class="pwd-row">
          <label class="pwd-label">确 认 新 密 码</label>
          <div class="pwd-input-wrap">
            <input
              v-model="newPwd2"
              :type="show.new2 ? 'text' : 'password'"
              placeholder="再次输入新密码"
              maxlength="32"
              autocomplete="new-password"
            >
            <button type="button" class="pwd-eye" aria-label="显示/隐藏密码" @click="show.new2 = !show.new2">
              <svg v-if="!show.new2" viewBox="0 0 24 24" class="eye-close" aria-hidden="true">
                <path d="M3 3l18 18"/>
                <path d="M10.6 6.1A11 11 0 0 1 12 6c5 0 9 4 10 6-.4.8-1.4 2.5-3 4M6.5 7.7C4 9.2 2.4 11.3 2 12c1 2 5 6 10 6 1.7 0 3.3-.5 4.7-1.3"/>
                <path d="M9.9 9.9A3 3 0 0 0 14.1 14.1"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" class="eye-open" aria-hidden="true">
                <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 规则提示 -->
      <ul class="pwd-rules">
        <li>密 码 长 度 6 位 以 上</li>
        <li>新 密 码 不 能 与 当 前 密 码 相 同</li>
        <li>建 议 包 含 字 母 + 数 字 以 增 强 安 全</li>
      </ul>

      <button type="button" class="pwd-submit" :disabled="submitting" @click="doSubmit">
        <span class="ps-glow"></span>
        <span class="ps-text">{{ submitting ? '提 交 中 …' : '确 认 修 改' }}</span>
      </button>

    </div>
  </div>

  <TabBar />
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { validatePassword } from '@gamebox/shared'
import http from '@/api/http'
import TabBar from '@/components/TabBar.vue'
import '@/assets/password.css'

useBodyClass('deco-bg')

const router = useRouter()
const userStore = useUserStore()
const { toast } = useToast()

const avatarSrc = computed(() => userStore.profile?.avatar || '/images/avatars/001.jpg')

const oldPwd = ref('')
const newPwd = ref('')
const newPwd2 = ref('')
const show = reactive({ old: false, new1: false, new2: false })
const submitting = ref(false)

/* 密码强度：长度 + 字符种类粗略评分 */
const strength = computed(() => {
  const p = newPwd.value
  if (!p) return { cls: '', text: '—' }
  let score = 0
  if (p.length >= 6) score++
  if (p.length >= 10) score++
  if (/[a-zA-Z]/.test(p) && /\d/.test(p)) score++
  if (/[^a-zA-Z0-9]/.test(p)) score++
  if (score <= 1) return { cls: 'lv-1', text: '弱' }
  if (score <= 2) return { cls: 'lv-2', text: '中' }
  return { cls: 'lv-3', text: '强' }
})

async function doSubmit() {
  if (!oldPwd.value) { toast('请输入当前密码'); return }
  const pwdErr = validatePassword(newPwd.value)
  if (pwdErr) { toast(pwdErr.replace('密码', '新密码')); return }
  if (newPwd.value === oldPwd.value) { toast('新密码不能与当前密码相同'); return }
  if (newPwd.value !== newPwd2.value) { toast('两次输入的新密码不一致'); return }

  submitting.value = true
  try {
    await http.patch('/users/me/password', {
      oldPassword: oldPwd.value,
      newPassword: newPwd.value,
    })
    toast('密码已修改，请重新登录')
    setTimeout(async () => {
      await userStore.logout()
      await router.push('/login')
    }, 1200)
  } catch (e: unknown) {
    toast((e as Error).message ?? '修改失败')
    submitting.value = false
  }
}
</script>
