<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="onLogout">‹</div>
      <div class="title">{{ title }}</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <div class="sc-welcome">
        <p class="sc-role">G O L D &nbsp;·&nbsp; H U B</p>
        <h1 class="sc-greet">欢迎，<em>{{ staff.profile?.nickname || '—' }}</em></h1>
        <p class="sc-meta">{{ roleLabel }} · {{ staff.profile?.username }}</p>
        <p v-if="walletLine" class="sc-wallet-line">{{ walletLine }}</p>
      </div>

      <div class="sc-menu">
        <button type="button" class="sc-item" @click="router.push({ name: 'staff-report' })">
          <span class="sc-ic">📊</span>
          <span class="sc-lb">经营报表</span>
          <span class="sc-arrow">›</span>
        </button>

        <button type="button" class="sc-item" @click="router.push({ name: 'staff-rooms' })">
          <span class="sc-ic">🏠</span>
          <span class="sc-lb">房间（含盘口池）</span>
          <span class="sc-arrow">›</span>
        </button>

        <button type="button" class="sc-item" @click="router.push({ name: 'staff-agents' })">
          <span class="sc-ic">⚜</span>
          <span class="sc-lb">{{ staff.isAgentSide ? '子账号上下分' : '代理上下分' }}</span>
          <span class="sc-arrow">›</span>
        </button>

        <button type="button" class="sc-item" @click="router.push({ name: 'staff-players' })">
          <span class="sc-ic">💎</span>
          <span class="sc-lb">玩家上下分</span>
          <span class="sc-arrow">›</span>
        </button>

        <button
          v-if="canRisk"
          type="button"
          class="sc-item"
          @click="router.push({ name: 'staff-risk' })"
        >
          <span class="sc-ic">⚠</span>
          <span class="sc-lb">
            风控告警
            <span v-if="riskUnhandled > 0" class="sc-badge">{{ riskUnhandled > 99 ? '99+' : riskUnhandled }}</span>
          </span>
          <span class="sc-arrow">›</span>
        </button>

        <button type="button" class="sc-item" @click="router.push({ name: 'staff-audit' })">
          <span class="sc-ic">📋</span>
          <span class="sc-lb">资金流水</span>
          <span class="sc-arrow">›</span>
        </button>
      </div>

      <button type="button" class="sc-logout" @click="onLogout">退 出 登 录</button>
      <p class="sc-tip">控奖、赔率细则等复杂配置请用电脑运营控制台</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStaffStore } from '@/stores/staff'
import { staffConsoleApi, type StaffWalletMe } from '@/api/staffConsole'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const wallet = ref<StaffWalletMe | null>(null)
const riskUnhandled = ref(0)

const canRisk = computed(() => staff.role === 'ADMIN' || staff.role === 'BRANCH')

const title = computed(() => {
  if (staff.role === 'ADMIN') return '运营控制台'
  if (staff.isBranch) return '房主控制台'
  return '代理控制台'
})

const roleLabel = computed(() => {
  const r = staff.role
  if (r === 'ADMIN') return '超管'
  if (r === 'BRANCH') return '房主'
  if (r === 'AGENT') return '代理'
  if (r === 'PROXY') return '子账号'
  return r
})

const walletLine = computed(() => {
  if (!wallet.value) return ''
  // 超管平台账户数字易误解，手机首页不展示
  if (staff.role === 'ADMIN') return ''
  const bal = Number(wallet.value.balance || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  if (staff.role === 'BRANCH') return `余额 ${bal}`
  const q = Number(wallet.value.pointsQuota || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  return `余额 ${bal} · 额度 ${q}`
})

function onLogout() {
  const kind = staff.loginKind
  staff.logout()
  router.replace({
    name: kind === 'branch' ? 'staff-login-branch' : 'staff-login-agent',
  })
}

onMounted(async () => {
  try {
    wallet.value = await staffConsoleApi.walletMe()
  } catch {
    wallet.value = null
  }
  if (canRisk.value) {
    try {
      const s = await staffConsoleApi.riskSummary()
      riskUnhandled.value = s.unhandled || 0
    } catch {
      riskUnhandled.value = 0
    }
  }
})
</script>

<style scoped>
.sc-wallet-line {
  margin: 10px 0 0;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--gold-bright);
  opacity: 0.9;
}
</style>
