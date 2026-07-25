<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page ar-page">
    <div class="app-bar">
      <div class="back" @click="goBack">‹</div>
      <div class="title">申请记录</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <h1 class="ar-title">申 请 记 录</h1>

      <!-- 5 时间 tab -->
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

      <div class="ar-list">
        <div v-if="loading" class="ar-empty">
          <div class="ar-empty-icon">◇</div>
          <div class="ar-empty-text">加 载 中 …</div>
        </div>
        <div v-else-if="!filtered.length" class="ar-empty">
          <div class="ar-empty-icon">◇</div>
          <div class="ar-empty-text">该 时 段 暂 无 记 录</div>
        </div>
        <template v-else>
          <div v-for="o in filtered" :key="o.id" class="ar-card">
            <div :class="['ar-badge', o.type === 'UP' ? 'up' : 'down']">{{ o.type === 'UP' ? '上分' : '下分' }}</div>
            <div class="ar-body">
              <div class="ar-row1">
                <span class="ar-kind">{{ o.type === 'UP' ? '上 分' : '下 分' }}</span>
                <span :class="['ar-status', statusClass(o.status)]">{{ statusLabel(o.status) }}</span>
              </div>
              <div class="ar-time">{{ fmtTime(o.createdAt) }}</div>
            </div>
            <div :class="['ar-amount', o.type === 'UP' ? 'pos' : 'neg']">
              {{ o.type === 'UP' ? '+' : '-' }}{{ fmtAmount(o.amount) }}
            </div>
          </div>
        </template>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <TabBar />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { rechargeApi, type RechargeOrder } from '@/api/recharge'
import { useBodyClass } from '@/composables/useBodyClass'
import { TIME_RANGES, rangeBounds, formatRangeDateText, type TimeRangeKey } from '@/composables/timeRange'
import TabBar from '@/components/TabBar.vue'
import '@/assets/apply-records.css'

useBodyClass('deco-bg')

const router = useRouter()

const range = ref<TimeRangeKey>('today')
const orders = ref<RechargeOrder[]>([])
const loading = ref(false)

const rangeDateText = computed(() => formatRangeDateText(range.value))

const filtered = computed(() => {
  const [from, to] = rangeBounds(range.value)
  return orders.value.filter(o => {
    const t = new Date(o.createdAt).getTime()
    return t >= from && t < to
  })
})

function statusClass(s: RechargeOrder['status']) {
  return { PENDING: 'pending', APPROVED: 'success', REJECTED: 'reject' }[s] ?? 'pending'
}
function statusLabel(s: RechargeOrder['status']) {
  return { PENDING: '审核中', APPROVED: '已通过', REJECTED: '失败' }[s] ?? s
}
function fmtAmount(n: number) {
  return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/settings')
}

onMounted(async () => {
  loading.value = true
  try {
    const res = await rechargeApi.myOrders(1, 100)
    orders.value = res.list
  } finally {
    loading.value = false
  }
})
</script>
