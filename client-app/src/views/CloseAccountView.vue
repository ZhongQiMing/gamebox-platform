<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page close-page has-page-title">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">注 销 账 号</div>
      <div class="right"></div>
    </div>
    <h1 class="page-title">注 销 账 号</h1>

    <div class="page-body">
      <div class="close-card close-warn">
        <div class="close-warn-title">注销后会发生什么</div>
        <ul class="close-list">
          <li>账号立即无法登录，<b>不可恢复</b></li>
          <li>昵称、头像等个人信息会被清除</li>
          <li>账号名 <b>{{ username }}</b> 将被永久占用，不能再次注册</li>
          <li>下注与上下分记录按法规保留，仅用于对账与风控</li>
        </ul>
      </div>

      <div v-if="loading" class="close-card close-tip">正在检查账号状态…</div>

      <div v-else-if="blockers.length" class="close-card close-block">
        <div class="close-block-title">还不能注销，请先处理：</div>
        <ul class="close-list">
          <li v-for="b in blockers" :key="b.code">{{ b.message }}</li>
        </ul>
        <button type="button" class="close-btn close-btn--ghost" @click="reload">重 新 检 查</button>
      </div>

      <template v-else>
        <div v-if="warnings.length" class="close-card close-block">
          <div class="close-block-title">请确认你已知悉：</div>
          <ul class="close-list">
            <li v-for="w in warnings" :key="w.code">{{ w.message }}</li>
          </ul>
        </div>
        <div class="close-card">
          <label class="close-label">请输入登录密码确认</label>
          <input
            v-model="password"
            type="password"
            class="close-input"
            maxlength="32"
            placeholder="登录密码"
            autocomplete="current-password"
          >
        </div>

        <button
          type="button"
          class="close-btn close-btn--danger"
          :disabled="submitting || !password"
          @click="showConfirm = true"
        >
          {{ submitting ? '注 销 中…' : '确 认 注 销' }}
        </button>
      </template>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <AppModal
    :visible="showConfirm"
    title="确认注销账号"
    :message="confirmMessage"
    ok-text="确认注销"
    cancel-text="再想想"
    @ok="doClose"
    @cancel="showConfirm = false"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { formatMoney } from '@gamebox/shared'
import { userApi } from '@/api/user'
import AppModal from '@/components/AppModal.vue'
import '@/assets/close-account.css'

useBodyClass('deco-bg')

const router = useRouter()
const userStore = useUserStore()
const { toast } = useToast()

const loading = ref(true)
const submitting = ref(false)
const showConfirm = ref(false)
const password = ref('')
const blockers = ref<Array<{ code: string; message: string }>>([])
const warnings = ref<Array<{ code: string; message: string }>>([])
const balance = ref(0)

const username = computed(() => userStore.profile?.username ?? '———')

/** 有余额时必须在最后一步再说一次金额，不能只在页面上写 */
const confirmMessage = computed(() =>
  balance.value > 0
    ? `账上还有 ${formatMoney(balance.value)} 积分，注销后立即清零且无法找回。账号也不能再次注册。确定继续吗？`
    : '注销后无法恢复，账号也不能再次注册。确定继续吗？',
)

async function reload() {
  loading.value = true
  try {
    const res = await userApi.closeCheck()
    blockers.value = res.blockers ?? []
    warnings.value = res.warnings ?? []
    balance.value = Number(res.balance) || 0
  } catch (err: any) {
    toast(err?.message || '检查失败，请稍后再试')
    blockers.value = [{ code: 'ERROR', message: '暂时无法检查账号状态' }]
    warnings.value = []
  } finally {
    loading.value = false
  }
}

onMounted(reload)

async function doClose() {
  showConfirm.value = false
  if (submitting.value) return
  submitting.value = true
  try {
    const res = await userApi.closeAccount(password.value)
    toast(`账号已注销，注销单号 ${res.orderNo}`)
    await userStore.logout()
    await router.replace('/login')
  } catch (err: any) {
    toast(err?.message || '注销失败')
    /* 可能是这期间又产生了新的待处理事项，重新拉一次让玩家看到原因 */
    await reload()
  } finally {
    submitting.value = false
  }
}
</script>
