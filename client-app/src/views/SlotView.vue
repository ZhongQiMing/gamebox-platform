<template>
  <div class="page slot-page">
    <div class="slot-header">
      <button class="back-btn" @click="router.back()">‹</button>
      <span class="title">{{ gameName }}</span>
      <span class="balance">{{ walletStore.balance.toLocaleString() }} 分</span>
    </div>

    <!-- 奖项展示区 -->
    <div class="paytable-area">
      <div v-if="payTable.length === 0" class="loading-tip">加载中…</div>
      <div v-else class="prize-grid">
        <div v-for="p in payTable" :key="p.label" class="prize-item"
          :class="{ highlight: lastPrize === p.label }">
          <span class="prize-label">{{ p.label }}</span>
          <span class="prize-mult" v-if="p.multiplier > 0">×{{ p.multiplier }}</span>
          <span class="prize-mult zero" v-else>—</span>
        </div>
      </div>
    </div>

    <!-- 结果展示 -->
    <div class="result-area">
      <transition name="prize-pop">
        <div v-if="lastPrize" class="result-prize" :class="{ big: lastResult?.won }">
          <div class="rp-label">{{ lastPrize }}</div>
          <div class="rp-payout" v-if="lastResult?.payout">
            派彩 +{{ lastResult.payout.toLocaleString() }}
          </div>
          <div class="rp-payout lose" v-else>未中奖</div>
        </div>
        <div v-else class="result-idle">按下旋转试试手气</div>
      </transition>
    </div>

    <!-- 操作区 -->
    <div class="control-area">
      <div class="quick-amounts">
        <button v-for="q in [10, 50, 100, 500, 1000]" :key="q"
          class="quick-btn" :class="{ active: amount === q }" @click="amount = q">{{ q }}</button>
      </div>
      <div class="custom-row">
        <input v-model.number="amount" type="number" min="1" class="amount-input" placeholder="自定义金额">
      </div>
      <button class="spin-btn" :class="{ spinning }" :disabled="spinning" @click="doSpin">
        <span v-if="spinning" class="spin-icon">⟳</span>
        <span v-else>旋 转</span>
      </button>
    </div>

    <!-- 历史 -->
    <div class="history-section">
      <div class="section-title">近期结果</div>
      <div class="history-dots">
        <span v-for="(h, i) in recentHistory" :key="i"
          class="history-dot" :class="{ won: h.won, big: h.big }"
          :title="`${h.label} 派彩${h.payout}`">
          {{ h.label.slice(0, 2) }}
        </span>
      </div>
    </div>

    <div class="page-bottom-spacer" />
    <TabBar />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWalletStore } from '@/stores/wallet'
import { useToast } from '@/composables/useToast'
import { useGameSpinSession } from '@/composables/useGameSpinSession'
import { gamesApi } from '@/api/games'
import TabBar from '@/components/TabBar.vue'

const route = useRoute()
const router = useRouter()
const walletStore = useWalletStore()
const { error: toastError } = useToast()

const gameCode = computed(() => route.params.gameCode as string)

interface PayItem { label: string; multiplier: number }
interface HistoryItem { label: string; payout: number; won: boolean; big: boolean }

const gameName = ref('')
const payTable = ref<PayItem[]>([])
const amount = ref(50)
const spinning = ref(false)
const lastPrize = ref('')
const lastResult = ref<{ payout: number; won: boolean } | null>(null)
const recentHistory = ref<HistoryItem[]>([])
const spinSession = useGameSpinSession('slot')

async function loadGame() {
  try {
    const games = await gamesApi.list()
    const g = games.find(x => x.code === gameCode.value)
    if (!g) return
    gameName.value = g.name
    const pt = g.configs?.[0]?.payTable
    if (Array.isArray(pt)) {
      payTable.value = pt as PayItem[]
    }
  } catch { /* 静默 */ }
}

async function doSpin() {
  if (spinning.value) return
  if (amount.value < 1) { toastError('请输入有效金额'); return }
  spinning.value = true
  try {
    const clientRequestId = spinSession.currentOrNewClientRequestId()
    const res = await gamesApi.spin(gameCode.value, amount.value, clientRequestId)
    spinSession.clearClientRequestId()
    const prize = res.outcome.prize
    lastPrize.value = prize.label
    lastResult.value = { payout: res.bets[0]?.payout ?? 0, won: res.bets[0]?.won ?? false }
    recentHistory.value.unshift({
      label: prize.label,
      payout: res.bets[0]?.payout ?? 0,
      won: res.bets[0]?.won ?? false,
      big: prize.multiplier >= 10,
    })
    if (recentHistory.value.length > 20) recentHistory.value.pop()
    if (typeof res.balance === 'number') walletStore.balance = res.balance
    else walletStore.fetchBalance()
  } catch (e: unknown) {
    toastError((e as Error).message)
  } finally {
    spinning.value = false
  }
}

onMounted(() => {
  walletStore.fetchBalance()
  loadGame()
})
</script>

<style scoped>
.slot-page { min-height: 100vh; background: #0a0700; color: #fff; padding-bottom: 60px; }

.slot-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: rgba(20,14,4,0.95);
  border-bottom: 1px solid rgba(212,169,60,0.2);
}
.back-btn { background: none; border: none; color: #d4a93c; font-size: 28px; cursor: pointer; }
.title { font-size: 18px; font-weight: 700; color: #e8c032; }
.balance { font-size: 13px; color: #a08040; }

.paytable-area { padding: 16px; }
.loading-tip { text-align: center; color: rgba(255,255,255,0.4); padding: 20px; }
.prize-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
}
.prize-item {
  padding: 10px 6px; border-radius: 8px;
  border: 1px solid rgba(212,169,60,0.2);
  background: rgba(40,28,8,0.6);
  text-align: center;
  transition: all 0.3s;
}
.prize-item.highlight {
  border-color: #d4a93c;
  background: rgba(212,169,60,0.25);
  box-shadow: 0 0 12px rgba(212,169,60,0.5);
}
.prize-label { font-size: 12px; color: rgba(255,255,255,0.8); display: block; margin-bottom: 4px; }
.prize-mult { font-size: 14px; font-weight: 700; color: #e8c032; }
.prize-mult.zero { color: rgba(255,255,255,0.3); }

.result-area {
  min-height: 100px; display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.result-idle { color: rgba(255,255,255,0.3); font-size: 14px; }
.result-prize { text-align: center; }
.rp-label { font-size: 32px; font-weight: 700; color: #e8c032; margin-bottom: 8px; }
.result-prize.big .rp-label { font-size: 40px; color: #ff6b35; text-shadow: 0 0 20px rgba(255,107,53,0.7); }
.rp-payout { font-size: 20px; font-weight: 600; color: #2ecc71; }
.rp-payout.lose { color: rgba(255,255,255,0.4); font-size: 14px; }

.prize-pop-enter-active { animation: pop 0.4s cubic-bezier(0.25,0.46,0.45,0.94); }
@keyframes pop { 0%{opacity:0;transform:scale(0.5)} 70%{transform:scale(1.15)} 100%{opacity:1;transform:scale(1)} }

.control-area { padding: 16px; }
.quick-amounts { display: flex; gap: 8px; margin-bottom: 10px; }
.quick-btn {
  flex: 1; padding: 8px 4px; border-radius: 8px;
  border: 1px solid rgba(212,169,60,0.3); background: rgba(40,28,8,0.8);
  color: #d4a93c; font-size: 13px; cursor: pointer;
  transition: all 0.2s;
}
.quick-btn.active { background: rgba(212,169,60,0.2); border-color: #d4a93c; }
.custom-row { margin-bottom: 14px; }
.amount-input {
  width: 100%; padding: 8px 12px; border-radius: 8px;
  border: 1px solid rgba(212,169,60,0.3); background: rgba(40,28,8,0.8);
  color: #fff; font-size: 14px; outline: none;
}
.spin-btn {
  width: 100%; padding: 16px; border-radius: 12px; border: none; cursor: pointer;
  background: linear-gradient(135deg, #d4a93c, #8a5c10);
  color: #fff; font-size: 18px; font-weight: 700; letter-spacing: 4px;
  transition: all 0.2s;
}
.spin-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.spin-btn.spinning { animation: spin 0.6s linear infinite; }
.spin-icon { display: inline-block; animation: spin 0.6s linear infinite; font-size: 22px; }
@keyframes spin { to { transform: rotate(360deg); } }

.history-section { padding: 0 16px 16px; }
.section-title { font-size: 14px; font-weight: 600; color: #d4a93c; margin: 16px 0 8px; border-left: 3px solid #d4a93c; padding-left: 8px; }
.history-dots { display: flex; flex-wrap: wrap; gap: 6px; }
.history-dot {
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; border: 1px solid rgba(255,255,255,0.15);
  background: rgba(40,28,8,0.6); color: rgba(255,255,255,0.5);
}
.history-dot.won { background: rgba(212,169,60,0.2); border-color: #d4a93c; color: #e8c032; }
.history-dot.big { background: rgba(255,107,53,0.25); border-color: #ff6b35; color: #ff6b35; }
.page-bottom-spacer { height: 80px; }
</style>
