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
          @click="onRangeChange(t.key)"
        >{{ t.label }}</button>
      </div>
      <div class="time-range-hint">{{ rangeDateText }}</div>

      <div v-if="displaySummary" class="pl-summary">
        <div class="pl-kpi">
          <span class="pl-kpi-num pos">+{{ fmtBal(displaySummary.income) }}</span>
          <span class="pl-kpi-label">收入合计</span>
        </div>
        <div class="pl-kpi">
          <span class="pl-kpi-num neg">-{{ fmtBal(displaySummary.expense) }}</span>
          <span class="pl-kpi-label">支出合计</span>
        </div>
        <div class="pl-kpi">
          <span :class="['pl-kpi-num', displaySummary.net >= 0 ? 'pos' : 'neg']">{{ fmtSigned(displaySummary.net) }}</span>
          <span class="pl-kpi-label">净变动</span>
        </div>
        <div class="pl-summary-meta">共 {{ total }} 笔账变</div>
      </div>

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
        <div v-else-if="!displayList.length" class="pl-empty">
          <div class="pl-empty-icon">◇</div>
          <div class="pl-empty-text">暂 无 记 录</div>
        </div>
        <template v-else>
          <div v-for="r in displayList" :key="r.id" class="pl-row">
            <span class="pl-kind">{{ rowMethod(r) }}</span>
            <span :class="['pl-amount', r.amount >= 0 ? 'pos' : 'neg']">{{ fmtSigned(r.amount) }}</span>
            <span class="pl-time">{{ fmtTime(r.createdAt) }}</span>
            <span class="pl-balance">
              <template v-if="r.orderNo">订单 {{ r.orderNo }} · </template>
              余额 {{ fmtBal(r.balanceAfter) }}
            </span>
          </div>
          <div v-if="hasMore" class="pl-more">
            <button type="button" class="pl-more-btn" :disabled="loadingMore" @click="loadMore">
              {{ loadingMore ? '加载中…' : `加载更多（已显示 ${list.length}/${total}）` }}
            </button>
          </div>
        </template>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

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
import { walletApi, type LedgerItem, type LedgerSummary } from '@/api/wallet'
import { useRoomStore } from '@/stores/room'
import { useBodyClass } from '@/composables/useBodyClass'
import { TIME_RANGES, rangeBounds, formatRangeDateText, type TimeRangeKey } from '@/composables/timeRange'
import TabBar from '@/components/TabBar.vue'
import '@/assets/points-log.css'

useBodyClass('deco-bg')

const router = useRouter()
const roomStore = useRoomStore()

const FILTERS: { label: string; types: string[] | null }[] = [
  { label: '全 部', types: null },
  { label: '存 款', types: ['RECHARGE'] },
  { label: '取 款', types: ['WITHDRAW'] },
  { label: '存 取 款', types: ['RECHARGE', 'WITHDRAW'] },
  { label: '下 注', types: ['BET'] },
  { label: '结 算', types: ['WIN'] },
  { label: '回 水', types: ['REBATE'] },
  { label: '活 动', types: ['ACTIVITY'] },
  { label: '佣 金', types: ['COMMISSION'] },
]

const KIND_TEXT: Record<string, string> = {
  RECHARGE: '存 款',
  WITHDRAW: '取 款',
  BET: '游戏下注',
  WIN: '游戏结算',
  FEE: '手续费',
  COMMISSION: '佣 金',
  REBATE: '回 水',
  ACTIVITY: '活动奖励',
  TRANSFER_IN: '转 入',
  TRANSFER_OUT: '转 出',
  ADJUST: '调 整',
}

const PAGE_SIZE = 50

const range = ref<TimeRangeKey>('today')
const filterIdx = ref(0)
const sheetOpen = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const list = ref<LedgerItem[]>([])
const summary = ref<LedgerSummary | null>(null)
const total = ref(0)
const page = ref(1)

const rangeDateText = computed(() => formatRangeDateText(range.value))
const activeTypes = computed(() => FILTERS[filterIdx.value]?.types ?? null)

function rowInCurrentRange(iso: string) {
  const [from, to] = rangeBounds(range.value)
  const t = new Date(iso).getTime()
  return t >= from && t < to
}

/** 日期 + 类型双过滤，避免 Tab 只改标题、列表仍是全量 */
const displayList = computed(() => {
  const types = activeTypes.value
  return list.value.filter((r) => {
    if (!rowInCurrentRange(r.createdAt)) return false
    if (types?.length && !types.includes(r.bizType)) return false
    return true
  })
})

/**
 * 收支汇总一律用服务端全量（与 total 同口径）。
 * 笔数展示用 total，勿用当前页 list.length，避免「共 50 笔」误导。
 */
const displaySummary = computed(() => {
  const server = summary.value
  if (server) {
    return {
      income: server.income,
      expense: server.expense,
      net: server.net,
      count: total.value || server.count || 0,
    }
  }
  return { income: 0, expense: 0, net: 0, count: total.value }
})

const hasMore = computed(() => list.value.length < total.value)

function kindText(t: string) { return KIND_TEXT[t] ?? t }
function rowMethod(r: LedgerItem) {
  if (r.method) return r.method
  if (r.bizType === 'RECHARGE' || r.bizType === 'TRANSFER_IN') return '上分'
  if (r.bizType === 'WITHDRAW' || r.bizType === 'TRANSFER_OUT') return '下分'
  return kindText(r.bizType)
}
function fmtSigned(n: number) {
  const v = Number(n) || 0
  return (v >= 0 ? '+' : '-') + Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
function fmtBal(n: number) {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
function fmtTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function fetchPage(p: number, append: boolean) {
  const [from, to] = rangeBounds(range.value)
  const types = activeTypes.value
  const roomNo = String(roomStore.roomNo || '').trim()
  const res = await walletApi.ledger(p, PAGE_SIZE, {
    range: range.value,
    from,
    to,
    ...(types?.length ? { bizTypes: [...types] } : {}),
    ...(roomNo ? { roomNo } : {}),
  })
  const rows = res.list ?? []
  /* 日期 + 类型本地兜底，防止后端未过滤时 Tab 无效 */
  const matched = rows.filter((r) => {
    if (!rowInCurrentRange(r.createdAt)) return false
    if (types?.length && !types.includes(r.bizType)) return false
    return true
  })
  const fullTotal = Number(res.total ?? res.summary?.count ?? 0) || 0
  summary.value = res.summary
    ? { ...res.summary, count: fullTotal }
    : { count: fullTotal, income: 0, expense: 0, net: 0 }
  total.value = fullTotal
  page.value = p
  list.value = append ? [...list.value, ...matched] : matched
}

async function loadLedger() {
  loading.value = true
  list.value = []
  try {
    await fetchPage(1, false)
  } catch {
    list.value = []
    summary.value = { count: 0, income: 0, expense: 0, net: 0 }
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  try {
    await fetchPage(page.value + 1, true)
  } finally {
    loadingMore.value = false
  }
}

async function onRangeChange(key: TimeRangeKey) {
  if (range.value === key) return
  range.value = key
  await loadLedger()
}

async function pickFilter(i: number) {
  filterIdx.value = i
  sheetOpen.value = false
  await loadLedger()
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/settings')
}

onMounted(() => { void loadLedger() })
</script>
