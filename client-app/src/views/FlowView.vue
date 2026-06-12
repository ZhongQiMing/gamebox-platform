<template>
  <div class="page flow-page deco-bg">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title"><span class="brand-dot"></span><span class="brand-wordmark">明 细</span></div>
      <div class="right"></div>
    </div>

    <div class="page-body" style="padding:16px;padding-bottom:70px">

      <div v-if="loading && !list.length" class="fl-empty">加载中...</div>
      <div v-else-if="!list.length" class="fl-empty">暂无流水记录</div>

      <div v-for="item in list" :key="item.id" class="flow-card">
        <div class="fc-left">
          <span class="fc-type">{{ bizTypeText(item.bizType) }}</span>
          <span class="fc-time">{{ new Date(item.createdAt).toLocaleString() }}</span>
        </div>
        <div :class="['fc-amount', item.amount > 0 ? 'pos' : 'neg']">
          {{ item.amount > 0 ? '+' : '' }}{{ item.amount.toLocaleString() }}
        </div>
      </div>

      <div v-if="hasMore" class="fl-more">
        <button @click="loadMore" :disabled="loading">{{ loading ? '加载中...' : '加载更多' }}</button>
      </div>
    </div>
  </div>
  <TabBar />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { walletApi, type LedgerItem } from '@/api/wallet'
import TabBar from '@/components/TabBar.vue'

const router = useRouter()
const list = ref<LedgerItem[]>([])
const loading = ref(false)
const page = ref(1)
const total = ref(0)
const pageSize = 20
const hasMore = ref(false)

onMounted(() => load())

async function load() {
  loading.value = true
  try {
    const res = await walletApi.ledger(1, pageSize)
    list.value = res.list
    total.value = res.total
    page.value = 1
    hasMore.value = res.list.length < res.total
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  loading.value = true
  try {
    const res = await walletApi.ledger(page.value + 1, pageSize)
    list.value.push(...res.list)
    page.value++
    hasMore.value = list.value.length < total.value
  } finally {
    loading.value = false
  }
}

const BIZ_TYPES: Record<string, string> = {
  RECHARGE: '上分', WITHDRAW: '下分',
  BET: '下注', WIN: '中奖', FEE: '手续费',
  COMMISSION: '佣金', REBATE: '回水', ACTIVITY: '活动',
  TRANSFER_IN: '转入', TRANSFER_OUT: '转出', ADJUST: '调整',
}
function bizTypeText(t: string) { return BIZ_TYPES[t] ?? t }
</script>

<style scoped>
.flow-page { min-height: 100vh; }
.flow-card {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(200,160,40,.12);
}
.fc-left { display: flex; flex-direction: column; gap: 4px; }
.fc-type { color: rgba(255,255,255,.8); font-size: 14px; }
.fc-time { color: rgba(255,255,255,.35); font-size: 12px; }
.fc-amount { font-size: 18px; font-weight: 700; }
.fc-amount.pos { color: #4caf50; }
.fc-amount.neg { color: #f06060; }
.fl-empty { text-align: center; color: rgba(255,255,255,.3); padding: 60px 0; }
.fl-more { text-align: center; padding: 16px; }
.fl-more button {
  background: rgba(200,160,40,.15); border: 1px solid rgba(200,160,40,.4);
  color: #e8c032; padding: 10px 32px; border-radius: 8px; font-size: 14px; cursor: pointer;
}
</style>
