<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page detail-page">

    <div class="app-bar">
      <div class="back" @click="goBack">‹</div>
      <div class="title">明 细</div>
      <div class="right"></div>
    </div>

    <div class="page-body">

      <h1 class="detail-title">明 细</h1>

      <div class="detail-tabs">
        <button type="button" :class="['dt-tab', tab === 'settled' ? 'active' : '']" @click="switchTab('settled')">今 日 已 结</button>
        <button type="button" :class="['dt-tab', tab === 'unsettled' ? 'active' : '']" @click="switchTab('unsettled')">未 结 明 细</button>
      </div>

      <div class="detail-table">
        <div class="dt-head">
          <div class="dt-col col-issue">期 号</div>
          <div class="dt-col col-game">游戏类型</div>
          <div class="dt-col col-stake">下注金额</div>
          <div class="dt-col col-result">结 果</div>
        </div>
        <div class="dt-body">
          <div v-if="loading" class="dt-empty">
            <div class="empty-icon">◇</div>
            <div class="empty-text">加 载 中 …</div>
          </div>
          <div v-else-if="!rows.length" class="dt-empty">
            <div class="empty-icon">◇</div>
            <div class="empty-text">暂 无 数 据</div>
          </div>
          <template v-else>
            <div v-for="r in rows" :key="r.id" class="dt-row">
              <div class="dt-col col-issue">{{ r.issue }}</div>
              <div class="dt-col col-game">{{ r.game }}</div>
              <div class="dt-col col-stake">{{ fmt(r.stake) }}</div>
              <div class="dt-col col-result">
                <span v-if="r.result === null" class="dt-pending">待 开 奖</span>
                <span v-else :class="['dt-result', r.result >= 0 ? 'pos' : 'neg']">{{ r.result >= 0 ? '+' : '' }}{{ fmt(r.result) }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <TabBar />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import http from '@/api/http'
import { useBodyClass } from '@/composables/useBodyClass'
import { isInRange, rangeBounds } from '@/composables/timeRange'
import TabBar from '@/components/TabBar.vue'
import '@/assets/flow.css'

useBodyClass('deco-bg')

const router = useRouter()

interface BetRecord {
  id: string
  betNo: string
  amount: number
  payout: number
  status: 'PENDING' | 'WON' | 'LOST' | 'CANCELLED'
  createdAt: string
  settledAt?: string | null
  game: { name: string; code: string }
}

const tab = ref<'settled' | 'unsettled'>('settled')
const loading = ref(true)
const records = ref<BetRecord[]>([])

const rows = computed(() => {
  const src = tab.value === 'settled'
    ? records.value.filter((b) => {
        if (b.status === 'PENDING' || b.status === 'CANCELLED') return false
        const t = b.settledAt || b.createdAt
        return isInRange(t, 'today')
      })
    : records.value.filter((b) => b.status === 'PENDING')
  return src.map((b) => ({
    id: b.id,
    issue: b.betNo,
    game: b.game.name.replace(/\s+/g, ''),
    stake: b.amount,
    result: b.status === 'PENDING' ? null : b.payout - b.amount,
  }))
})

function fmt(n: number) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function loadRecords() {
  loading.value = true
  try {
    if (tab.value === 'settled') {
      const [from, to] = rangeBounds('today')
      records.value = await http.get<BetRecord[], BetRecord[]>(
        `/bet/history?range=today&from=${from}&to=${to}`,
      )
    } else {
      /* 未结：拉最近注单再筛 PENDING（不限今日） */
      records.value = await http.get<BetRecord[], BetRecord[]>('/bet/history')
    }
  } catch {
    records.value = []
  } finally {
    loading.value = false
  }
}

async function switchTab(next: 'settled' | 'unsettled') {
  if (tab.value === next) return
  tab.value = next
  await loadRecords()
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/lobby')
}

onMounted(() => { void loadRecords() })
</script>
