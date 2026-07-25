<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page rb-page">
    <div class="app-bar">
      <div class="back" @click="goBack">‹</div>
      <div class="title">自助回水</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <h1 class="rb-title">自 助 回 水</h1>

      <div v-if="loading" class="rb-empty">
        <div class="rb-empty-icon">◇</div>
        <div class="rb-empty-text">加 载 中 …</div>
      </div>

      <template v-else>
        <!-- 待领：完整卡片 + 领取；已领：左文案右金额 -->
        <div v-if="primaryClaim" class="rb-pending">
          <div class="rb-pending-head">
            <span class="rb-pending-date">{{ primaryClaim.date }} 待领</span>
            <span class="rb-pending-tag">可提前领取</span>
          </div>
          <div class="rb-kpi-row">
            <div class="rb-kpi">
              <span class="rb-kpi-num">{{ fmtInt(primaryClaim.validFlow) }}</span>
              <span class="rb-kpi-label">有效流水</span>
            </div>
            <div class="rb-kpi">
              <span class="rb-kpi-num">{{ fmtMoney(primaryClaim.amount) }}</span>
              <span class="rb-kpi-label">可领积分</span>
            </div>
            <div class="rb-kpi">
              <span class="rb-kpi-num">{{ fmtMoney(status.claimableTotal) }}</span>
              <span class="rb-kpi-label">合计可领</span>
            </div>
          </div>
          <button
            type="button"
            class="rb-claim-btn"
            :disabled="!!claimingDate"
            @click="onClaim(primaryClaim.date)"
          >
            {{ claimingDate === primaryClaim.date ? '领取中…' : '立即领取' }}
          </button>
        </div>

        <div v-else class="rb-status-bar">
          <span class="rb-status-label">昨日回水已领取</span>
          <span class="rb-status-amount">{{ fmtMoney(status.claimableTotal) }}</span>
        </div>

        <!-- 今日累计：三栏原样 -->
        <div class="rb-today">
          <div class="rb-today-title">今日累计（明日结算）</div>
          <div class="rb-kpi-row">
            <div class="rb-kpi">
              <span class="rb-kpi-num">{{ fmtInt(status.today.validFlow) }}</span>
              <span class="rb-kpi-label">有效流水</span>
            </div>
            <div class="rb-kpi">
              <span class="rb-kpi-num">{{ fmtMoney(status.today.estimatedRebate) }}</span>
              <span class="rb-kpi-label">预计回水</span>
            </div>
            <div class="rb-kpi">
              <span class="rb-kpi-num">06:00</span>
              <span class="rb-kpi-label">自动发放</span>
            </div>
          </div>
        </div>

        <div v-if="extraClaims.length" class="rb-claim-list">
          <div v-for="item in extraClaims" :key="item.date" class="rb-claim-item">
            <div class="rb-claim-info">
              <div class="rb-claim-date">{{ item.date }}</div>
              <div class="rb-claim-meta">
                流水 {{ fmtInt(item.validFlow) }} · 可领 {{ fmtMoney(item.amount) }}
              </div>
            </div>
            <button
              type="button"
              class="rb-claim-btn rb-claim-btn--sm"
              :disabled="claimingDate === item.date"
              @click="onClaim(item.date)"
            >
              {{ claimingDate === item.date ? '…' : '领取' }}
            </button>
          </div>
        </div>

        <h2 class="rb-section-title">回 水 记 录</h2>
        <div class="time-tabs">
          <button
            v-for="t in TIME_RANGES"
            :key="t.key"
            type="button"
            :class="['tt-item', range === t.key ? 'active' : '']"
            @click="onRangeChange(t.key)"
          >{{ t.label }}</button>
        </div>
        <div class="time-range-hint">{{ rangeDateText }}</div>

        <div v-if="historyLoading" class="rb-empty rb-empty--sm">
          <div class="rb-empty-text">加 载 中 …</div>
        </div>
        <div v-else-if="!filteredHistory.length" class="rb-empty rb-empty--sm">
          <div class="rb-empty-icon">◇</div>
          <div class="rb-empty-text">该 时 段 暂 无 记 录</div>
        </div>
        <div v-else class="rb-list">
          <div v-for="item in filteredHistory" :key="item.id" class="rb-card">
            <span class="rb-card-date">{{ item.date }}</span>
            <span class="rb-card-meta">
              流水 {{ fmtInt(item.validFlow) }} · {{ item.claimType === 'AUTO' ? '自动' : '手动' }} · {{ fmtDate(item.claimedAt) }}
            </span>
            <span class="rb-card-amount">+{{ fmtMoney(item.amount) }}</span>
          </div>
        </div>
      </template>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <div v-if="toastMsg" class="rb-toast">{{ toastMsg }}</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { rebateApi, type RebateStatus, type RebateRange } from '@/api/rebate'
import { useBodyClass } from '@/composables/useBodyClass'
import { TIME_RANGES, formatRangeDateText } from '@/composables/timeRange'
import { useWalletStore } from '@/stores/wallet'
import '@/assets/rebate.css'

useBodyClass('deco-bg')

const router = useRouter()
const walletStore = useWalletStore()

const EMPTY_STATUS: RebateStatus = {
  claimableTotal: 0,
  today: { date: '', validFlow: 0, estimatedRebate: 0, games: [] },
  claimable: [],
  history: [],
}

const loading = ref(true)
const historyLoading = ref(false)
const claimingDate = ref('')
const status = ref<RebateStatus>({ ...EMPTY_STATUS })
const range = ref<RebateRange>('today')
const toastMsg = ref('')

const rangeDateText = computed(() => formatRangeDateText(range.value))
const filteredHistory = computed(() => status.value.history ?? [])
const primaryClaim = computed(() => {
  const list = status.value.claimable ?? []
  return list.find(i => i.amount > 0) ?? null
})
const extraClaims = computed(() => {
  const primary = primaryClaim.value
  return (status.value.claimable ?? []).filter(
    i => i.amount > 0 && i.date !== primary?.date,
  )
})

function fmtInt(n: number) {
  return Math.round(n || 0).toLocaleString('en-US')
}

function fmtMoney(n: number) {
  return `¥${(n || 0).toFixed(2)}`
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function showToast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2200)
}

async function loadStatus(keepHistory = false) {
  if (!keepHistory) loading.value = true
  else historyLoading.value = true
  try {
    status.value = await rebateApi.status(range.value)
  } catch (e) {
    if (!keepHistory) status.value = { ...EMPTY_STATUS }
    showToast((e as Error).message || '加载失败')
  } finally {
    loading.value = false
    historyLoading.value = false
  }
}

async function onRangeChange(key: RebateRange) {
  if (range.value === key) return
  range.value = key
  await loadStatus(true)
}

async function onClaim(date: string) {
  if (claimingDate.value) return
  claimingDate.value = date
  try {
    const res = await rebateApi.claim(date)
    showToast(res.message)
    await walletStore.fetchBalance()
    await loadStatus(true)
  } catch (e) {
    showToast((e as Error).message || '领取失败')
  } finally {
    claimingDate.value = ''
  }
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/lobby')
}

onMounted(() => { void loadStatus() })
</script>
