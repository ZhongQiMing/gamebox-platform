<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page pl-page">
    <div class="app-bar">
      <div class="back" @click="goBack">‹</div>
      <div class="title">账变明细</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <h1 class="pl-title">积 分 账 变</h1>

      <div class="time-tabs">
        <button
          v-for="t in TIME_RANGES"
          :key="t.key"
          type="button"
          :class="['tt-item', range === t.key ? 'active' : '']"
          @click="range = t.key"
        >{{ t.label }}</button>
      </div>
      <div class="time-range-hint">{{ rangeDateText }}</div>

      <div class="pl-filter-row">
        <div class="pl-filter-label">{{ FILTERS[filterIdx].label }}</div>
        <button class="pl-filter-btn" type="button" @click="sheetOpen = true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 5h18l-7 8v6l-4 2v-8z"/>
          </svg>
          筛 选
        </button>
      </div>

      <div class="pl-list">
        <div v-if="loading" class="pl-empty">
          <div class="pl-empty-icon">◇</div>
          <div class="pl-empty-text">加 载 中 …</div>
        </div>
        <div v-else-if="!filtered.length" class="pl-empty">
          <div class="pl-empty-icon">◇</div>
          <div class="pl-empty-text">暂 无 记 录</div>
        </div>
        <template v-else>
          <div v-for="r in filtered" :key="r.id" class="pl-row">
            <span class="pl-kind">{{ kindText(r.bizType) }}</span>
            <span :class="['pl-amount', r.amount >= 0 ? 'pos' : 'neg']">{{ fmtSigned(r.amount) }}</span>
            <span class="pl-time">{{ fmtTime(r.createdAt) }}</span>
            <span class="pl-balance">余额 {{ fmtBal(r.balanceAfter) }}</span>
          </div>
        </template>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <!-- 筛选 sheet（底部上拉） -->
  <div :class="['pl-sheet-mask', sheetOpen ? '' : 'hidden']" @click="sheetOpen = false"></div>
  <div :class="['pl-sheet', sheetOpen ? '' : 'hidden']">
    <div class="pl-sheet-head">
      <span class="pl-sheet-title">筛 选 类 型</span>
      <button class="pl-sheet-close" type="button" @click="sheetOpen = false">×</button>
    </div>
    <div class="pl-sheet-grid">
      <button
        v-for="(f, i) in FILTERS"
        :key="f.label"
        type="button"
        :class="['pl-opt', i === filterIdx ? 'active' : '']"
        @click="pickFilter(i)"
      >{{ f.label }}</button>
    </div>
  </div>

  <TabBar />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { walletApi, type LedgerItem } from '@/api/wallet'
import { useBodyClass } from '@/composables/useBodyClass'
import { TIME_RANGES, rangeBounds, formatRangeDateText, type TimeRangeKey } from '@/composables/timeRange'
import TabBar from '@/components/TabBar.vue'
import '@/assets/points-log.css'

useBodyClass('deco-bg')

const router = useRouter()

/* 后端 bizType → 原型筛选类型映射 */
const FILTERS: { label: string; types: string[] | null }[] = [
  { label: '全 部',   types: null },
  { label: '存 款',   types: ['RECHARGE'] },
  { label: '取 款',   types: ['WITHDRAW'] },
  { label: '存 取 款', types: ['RECHARGE', 'WITHDRAW'] },
  { label: '下 注',   types: ['BET'] },
  { label: '结 算',   types: ['WIN'] },
  { label: '回 水',   types: ['REBATE'] },
  { label: '活 动',   types: ['ACTIVITY'] },
  { label: '转 账',   types: ['TRANSFER_IN', 'TRANSFER_OUT'] },
  { label: '佣 金',   types: ['COMMISSION'] },
]

const KIND_TEXT: Record<string, string> = {
  RECHARGE: '存 款', WITHDRAW: '取 款',
  BET: '游戏下注', WIN: '游戏结算', FEE: '手续费',
  COMMISSION: '佣 金', REBATE: '回 水', ACTIVITY: '活动奖励',
  TRANSFER_IN: '转 入', TRANSFER_OUT: '转 出', ADJUST: '调 整',
}

const range = ref<TimeRangeKey>('today')
const filterIdx = ref(0)
const sheetOpen = ref(false)
const loading = ref(false)
const list = ref<LedgerItem[]>([])

const rangeDateText = computed(() => formatRangeDateText(range.value))

const filtered = computed(() => {
  const [from, to] = rangeBounds(range.value)
  const types = FILTERS[filterIdx.value].types
  return list.value.filter(r => {
    const t = new Date(r.createdAt).getTime()
    if (t < from || t >= to) return false
    if (types && !types.includes(r.bizType)) return false
    return true
  })
})

function pickFilter(i: number) {
  filterIdx.value = i
  sheetOpen.value = false
}

function kindText(t: string) { return KIND_TEXT[t] ?? t }
function fmtSigned(n: number) {
  return (n >= 0 ? '+' : '-') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtBal(n: number) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/settings')
}

onMounted(async () => {
  loading.value = true
  try {
    const res = await walletApi.ledger(1, 200)
    list.value = res.list
  } finally {
    loading.value = false
  }
})
</script>
