<template>
  <div class="page recharge-page deco-bg">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title"><span class="brand-dot"></span><span class="brand-wordmark">充 值</span></div>
      <div class="right"></div>
    </div>

    <div class="page-body" style="padding:16px">

      <!-- 余额展示 -->
      <div class="balance-card">
        <span class="bc-label">当前余额</span>
        <span class="bc-value">{{ walletStore.balance.toLocaleString() }}</span>
        <span class="bc-unit">积分</span>
      </div>

      <!-- Tab 切换 -->
      <div class="rc-tabs">
        <div :class="['rc-tab', tab==='up' ? 'active' : '']" @click="tab='up'">上 分</div>
        <div :class="['rc-tab', tab==='down' ? 'active' : '']" @click="tab='down'">下 分</div>
        <div :class="['rc-tab', tab==='records' ? 'active' : '']" @click="tab='records'; loadOrders()">记 录</div>
      </div>

      <!-- 上分 / 下分 表单 -->
      <div v-if="tab !== 'records'" class="rc-form">
        <div class="field-luxe">
          <span class="ic">¥</span>
          <input v-model.number="amount" type="number" class="field" :placeholder="`${tab==='up'?'上':'下'}分金额（积分）`" min="1">
        </div>
        <div class="rc-presets">
          <button v-for="n in [100,500,1000,5000]" :key="n" class="preset-btn" @click="amount=n">{{ n }}</button>
        </div>
        <button class="btn btn-primary btn-block" :disabled="loading" @click="submit">
          <span class="ruby ruby-l"></span>
          <span class="btn-text">{{ loading ? '提交中...' : (tab==='up' ? '提交上分申请' : '提交下分申请') }}</span>
          <span class="ruby ruby-r"></span>
        </button>
        <p class="rc-note">申请提交后，请等待代理/客服审核。审核通过后积分自动到账。</p>
      </div>

      <!-- 记录 -->
      <div v-else>
        <div v-if="ordersLoading" class="rc-empty">加载中...</div>
        <div v-else-if="!orders.length" class="rc-empty">暂无记录</div>
        <div v-for="o in orders" :key="o.id" class="order-card">
          <div class="oc-row">
            <span class="oc-type">{{ o.type === 'UP' ? '上分' : '下分' }}</span>
            <span :class="['oc-status', o.status.toLowerCase()]">{{ statusText(o.status) }}</span>
          </div>
          <div class="oc-amount">{{ o.amount.toLocaleString() }} 积分</div>
          <div class="oc-time">{{ new Date(o.createdAt).toLocaleString() }}</div>
          <div v-if="o.rejectReason" class="oc-reason">拒绝原因：{{ o.rejectReason }}</div>
        </div>
      </div>

    </div>
  </div>
  <TabBar />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWalletStore } from '@/stores/wallet'
import { rechargeApi, type RechargeOrder } from '@/api/recharge'
import { useToast } from '@/composables/useToast'
import TabBar from '@/components/TabBar.vue'

const router = useRouter()
const walletStore = useWalletStore()
const { toast } = useToast()

const tab = ref<'up' | 'down' | 'records'>('up')
const amount = ref<number | ''>('')
const loading = ref(false)
const orders = ref<RechargeOrder[]>([])
const ordersLoading = ref(false)

onMounted(() => walletStore.fetchBalance())

async function submit() {
  if (!amount.value || amount.value < 1) { toast('请输入有效金额'); return }
  loading.value = true
  try {
    if (tab.value === 'up') {
      await rechargeApi.apply(Number(amount.value))
      toast('上分申请已提交，等待审核')
    } else {
      await rechargeApi.withdraw(Number(amount.value))
      await walletStore.fetchBalance()
      toast('下分申请已提交，等待审核')
    }
    amount.value = ''
  } catch (e: any) {
    toast(e.message ?? '提交失败')
  } finally {
    loading.value = false
  }
}

async function loadOrders() {
  ordersLoading.value = true
  try {
    const res = await rechargeApi.myOrders()
    orders.value = res.list
  } finally {
    ordersLoading.value = false
  }
}

function statusText(s: string) {
  return { PENDING: '审核中', APPROVED: '已通过', REJECTED: '已拒绝' }[s] ?? s
}
</script>

<style scoped>
.recharge-page { min-height: 100vh; padding-bottom: 70px; }
.balance-card {
  display: flex; align-items: baseline; gap: 8px;
  background: linear-gradient(135deg, rgba(40,28,8,.9), rgba(20,14,4,.95));
  border: 1px solid rgba(200,160,40,.35); border-radius: 14px;
  padding: 16px 20px; margin-bottom: 20px;
}
.bc-label { color: rgba(255,255,255,.5); font-size: 13px; }
.bc-value { color: #e8c032; font-size: 28px; font-weight: 700; flex: 1; text-align: right; }
.bc-unit  { color: rgba(255,255,255,.4); font-size: 12px; }
.rc-tabs  { display: flex; gap: 8px; margin-bottom: 20px; }
.rc-tab {
  flex: 1; padding: 10px 0; text-align: center; border-radius: 10px; font-size: 14px;
  border: 1px solid rgba(200,160,40,.3); color: rgba(255,255,255,.5); cursor: pointer;
}
.rc-tab.active { background: rgba(200,160,40,.15); color: #e8c032; border-color: rgba(200,160,40,.6); }
.rc-form { display: flex; flex-direction: column; gap: 16px; }
.rc-presets { display: flex; gap: 8px; }
.preset-btn {
  flex: 1; padding: 8px 0; border-radius: 8px; font-size: 13px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(200,160,40,.3);
  color: rgba(200,160,40,.9); cursor: pointer;
}
.rc-note { color: rgba(255,255,255,.35); font-size: 12px; text-align: center; line-height: 1.6; }
.order-card {
  background: rgba(255,255,255,.04); border: 1px solid rgba(200,160,40,.2);
  border-radius: 10px; padding: 14px 16px; margin-bottom: 10px;
}
.oc-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
.oc-type { color: rgba(255,255,255,.7); font-size: 14px; }
.oc-status { font-size: 13px; font-weight: 600; }
.oc-status.pending  { color: #e8c032; }
.oc-status.approved { color: #4caf50; }
.oc-status.rejected { color: #f06060; }
.oc-amount { color: #e8c032; font-size: 18px; font-weight: 700; margin-bottom: 4px; }
.oc-time   { color: rgba(255,255,255,.35); font-size: 12px; }
.oc-reason { color: #f06060; font-size: 12px; margin-top: 6px; }
.rc-empty  { text-align: center; color: rgba(255,255,255,.3); padding: 40px 0; }
</style>
