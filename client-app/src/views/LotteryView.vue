<template>
  <div class="page lottery-page">
    <!-- 顶栏 -->
    <div class="lottery-header">
      <button class="back-btn" @click="router.back()">‹</button>
      <span class="title">{{ gameLabel }}</span>
      <span class="balance">{{ walletStore.balance.toLocaleString() }} 分</span>
    </div>

    <!-- 当前期 -->
    <div class="issue-bar">
      <div class="issue-no">第 <b>{{ current?.issueNo ?? '—' }}</b> 期</div>
      <div class="countdown" :class="{ locked: current?.status === 'LOCKED' }">
        <span v-if="current?.status === 'LOCKED'" class="locked-text">已封盘</span>
        <span v-else>{{ countdown }}</span>
      </div>
      <div class="issue-label">{{ current?.status === 'LOCKED' ? '开奖中' : '距开奖' }}</div>
    </div>

    <!-- 最新开奖 -->
    <div class="last-draw" v-if="history.length">
      <span class="ld-label">上期开奖</span>
      <div class="ld-balls">
        <span v-for="(n, i) in parseNumbers(history[0].drawNumbers)" :key="i" class="ball">{{ n }}</span>
      </div>
      <span class="ld-sum">和 {{ parseNumbers(history[0].drawNumbers).reduce((a,b)=>a+b,0) }}</span>
    </div>

    <!-- 投注区 -->
    <div class="bet-panel">
      <div class="bet-types">
        <button
          v-for="bt in betTypes"
          :key="bt.key"
          class="bet-type-btn"
          :class="{ active: selected === bt.key, locked: isLocked }"
          @click="!isLocked && (selected = bt.key)"
        >
          <span class="bt-label">{{ bt.label }}</span>
          <span class="bt-odds">{{ bt.odds }}x</span>
        </button>
      </div>

      <!-- 选号器（exact: 0-9 / champion·runner: 1-10） -->
      <div v-if="needsValuePick" class="exact-row">
        <span>{{ pickLabel }}：</span>
        <div class="exact-nums">
          <button
            v-for="n in pickOptions"
            :key="n"
            class="exact-num"
            :class="{ active: exactValue === String(n) }"
            @click="exactValue = String(n)"
          >{{ n }}</button>
        </div>
      </div>

      <!-- 金额输入 -->
      <div class="amount-row">
        <span class="amount-label">投注额</span>
        <div class="quick-amounts">
          <button v-for="q in [10, 50, 100, 500]" :key="q"
            class="quick-btn" @click="amount = q">{{ q }}</button>
        </div>
        <input v-model.number="amount" type="number" min="1" class="amount-input" placeholder="自定义">
      </div>

      <button
        class="submit-btn"
        :disabled="isLocked || !selected || loading"
        @click="doBet"
      >
        <span v-if="loading">投注中…</span>
        <span v-else-if="isLocked">封盘中</span>
        <span v-else>确认投注</span>
      </button>
    </div>

    <!-- 历史开奖 -->
    <div class="history-section">
      <div class="section-title">近期开奖</div>
      <div class="history-list">
        <div v-for="h in history" :key="h.issueNo" class="h-row">
          <span class="h-no">{{ h.issueNo }}</span>
          <div class="h-balls">
            <span v-for="(n,i) in parseNumbers(h.drawNumbers)" :key="i" class="ball small">{{ n }}</span>
          </div>
          <span class="h-sum">{{ parseNumbers(h.drawNumbers).reduce((a,b)=>a+b,0) }}</span>
          <span class="h-flag" :class="isBigDraw(h.drawNumbers) ? 'big' : 'small'">
            {{ isBigDraw(h.drawNumbers) ? '大' : '小' }}
          </span>
        </div>
      </div>
    </div>

    <!-- 我的注单 -->
    <div class="my-bets-section">
      <div class="section-title">我的投注</div>
      <div v-for="b in myBets" :key="b.id" class="bet-row">
        <span class="bet-issue">{{ b.issue?.issueNo ?? '—' }}</span>
        <span class="bet-type">{{ b.betType }}</span>
        <span class="bet-amount">-{{ b.amount }}</span>
        <span class="bet-status" :class="b.status.toLowerCase()">
          {{ b.status === 'WON' ? `+${b.payout}` : b.status === 'LOST' ? '未中' : '待开' }}
        </span>
      </div>
    </div>

    <div class="page-bottom-spacer" />
    <TabBar />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWalletStore } from '@/stores/wallet'
import { useToast } from '@/composables/useToast'
import { lotteryApi, type LotteryIssue, type DrawHistory, type LotteryBet } from '@/api/lottery'
import TabBar from '@/components/TabBar.vue'

const route = useRoute()
const router = useRouter()
const walletStore = useWalletStore()
const { success: toastSuccess, error: toastError } = useToast()

const gameCode = computed(() => route.params.gameCode as string)

const GAME_LABELS: Record<string, string> = {
  ffc: '1分时时彩', ssc: '快乐时时彩', kuai3: '1分快三',
  bjsc: '北京赛车', 'speed-racing': '极速赛车', 'speed-boat': '幸运飞艇',
}

const BET_TYPES: Record<string, Array<{ key: string; label: string; odds: number }>> = {
  ffc: [
    { key: 'big',   label: '大',    odds: 1.98 },
    { key: 'small', label: '小',    odds: 1.98 },
    { key: 'odd',   label: '单',    odds: 1.98 },
    { key: 'even',  label: '双',    odds: 1.98 },
    { key: 'exact', label: '猜个位', odds: 9.00 },
  ],
  ssc: [
    { key: 'big',   label: '大',    odds: 1.98 },
    { key: 'small', label: '小',    odds: 1.98 },
    { key: 'odd',   label: '单',    odds: 1.98 },
    { key: 'even',  label: '双',    odds: 1.98 },
    { key: 'exact', label: '猜个位', odds: 9.00 },
  ],
  kuai3: [
    { key: 'big',     label: '大',     odds: 1.98 },
    { key: 'small',   label: '小',     odds: 1.98 },
    { key: 'odd',     label: '单',     odds: 1.98 },
    { key: 'even',    label: '双',     odds: 1.98 },
    { key: 'triplet', label: '豹子',   odds: 24.00 },
    { key: 'sum',     label: '猜总和', odds: 6.50 },
  ],
  bjsc: [
    { key: 'top2big',   label: '冠亚大',   odds: 1.98 },
    { key: 'top2small', label: '冠亚小',   odds: 1.98 },
    { key: 'top2odd',   label: '冠亚单',   odds: 1.98 },
    { key: 'top2even',  label: '冠亚双',   odds: 1.98 },
    { key: 'champion',  label: '冠军号',   odds: 9.00 },
    { key: 'runner',    label: '亚军号',   odds: 9.00 },
  ],
}
GAME_LABELS['speed-racing'] = '极速赛车'
BET_TYPES['speed-racing'] = BET_TYPES['bjsc']
GAME_LABELS['speed-boat'] = '幸运飞艇'
BET_TYPES['speed-boat'] = BET_TYPES['bjsc']

const gameLabel = computed(() => GAME_LABELS[gameCode.value] ?? gameCode.value)
const betTypes  = computed(() => BET_TYPES[gameCode.value] ?? BET_TYPES['ffc'])

const current   = ref<LotteryIssue | null>(null)
const history   = ref<DrawHistory[]>([])
const myBets    = ref<LotteryBet[]>([])
const selected  = ref('')
const exactValue = ref('0')
const amount    = ref(50)
const loading   = ref(false)
const countdown = ref('--:--')

const isLocked = computed(() => !current.value || current.value.status === 'LOCKED')

/** 需要额外选号的玩法 */
const VALUE_PICK_TYPES = ['exact', 'champion', 'runner', 'sum']
const needsValuePick = computed(() => VALUE_PICK_TYPES.includes(selected.value))
const pickLabel = computed(() => {
  if (selected.value === 'exact') return '猜个位数'
  if (selected.value === 'champion') return '猜冠军号'
  if (selected.value === 'runner') return '猜亚军号'
  if (selected.value === 'sum') return '猜总和'
  return '选号'
})
const pickOptions = computed<number[]>(() => {
  if (selected.value === 'exact') return Array.from({ length: 10 }, (_, i) => i)        // 0-9
  if (selected.value === 'champion' || selected.value === 'runner')
    return Array.from({ length: 10 }, (_, i) => i + 1)                                   // 1-10
  if (selected.value === 'sum') return Array.from({ length: 14 }, (_, i) => i + 4)       // 4-17
  return []
})

// 切换玩法时把选号重置为该玩法的第一个合法值
watch(selected, () => {
  if (needsValuePick.value && !pickOptions.value.includes(Number(exactValue.value))) {
    exactValue.value = String(pickOptions.value[0] ?? 0)
  }
})

function parseNumbers(s: string | null): number[] {
  try { return JSON.parse(s ?? '[]') } catch { return [] }
}

/** 各游戏的"大"阈值：ffc/ssc 总和≥23；kuai3 ≥11；赛车冠亚和≥12 */
function isBigDraw(s: string | null): boolean {
  const nums = parseNumbers(s)
  if (gameCode.value === 'kuai3') return nums.reduce((a, b) => a + b, 0) >= 11
  if (gameCode.value === 'bjsc' || gameCode.value === 'speed-racing' || gameCode.value === 'speed-boat') return (nums[0] ?? 0) + (nums[1] ?? 0) >= 12
  return nums.reduce((a, b) => a + b, 0) >= 23
}

function updateCountdown() {
  if (!current.value || current.value.status === 'LOCKED') { countdown.value = '--:--'; return }
  const rem = Math.max(0, new Date(current.value.openAt).getTime() - Date.now())
  const m = Math.floor(rem / 60000).toString().padStart(2, '0')
  const s = Math.floor((rem % 60000) / 1000).toString().padStart(2, '0')
  countdown.value = `${m}:${s}`
}

async function reload() {
  const [cur, hist, bets] = await Promise.all([
    lotteryApi.currentIssue(gameCode.value),
    lotteryApi.history(gameCode.value, 10),
    lotteryApi.myBets(gameCode.value),
  ])
  current.value = cur
  history.value = hist
  myBets.value = bets.list
}

async function doBet() {
  if (!selected.value || loading.value) return
  if (amount.value < 1) { toastError('投注额须 ≥ 1'); return }
  loading.value = true
  try {
    const betValue = needsValuePick.value ? exactValue.value : undefined
    if (needsValuePick.value && !pickOptions.value.includes(Number(exactValue.value))) {
      toastError(`请先${pickLabel.value}`)
      loading.value = false
      return
    }
    const clientRequestId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `lot_${crypto.randomUUID()}`
        : `lot_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const res = await lotteryApi.bet(gameCode.value, {
      betType: selected.value,
      betValue,
      amount: amount.value,
      clientRequestId,
    })
    toastSuccess(`已投注 ${selected.value}，期号 ${res.issueNo}`)
    walletStore.fetchBalance()
    await reload()
  } catch (e: unknown) {
    toastError((e as Error).message)
  } finally { loading.value = false }
}

let timer: ReturnType<typeof setInterval>

onMounted(async () => {
  walletStore.fetchBalance()
  await reload()
  updateCountdown()
  timer = setInterval(() => {
    updateCountdown()
    if (countdown.value === '00:00') reload()
  }, 1000)
})

onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.lottery-page { min-height: 100vh; background: #0a0700; color: #fff; padding-bottom: 60px; }

.lottery-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: rgba(20,14,4,0.95);
  border-bottom: 1px solid rgba(212,169,60,0.2);
}
.back-btn { background: none; border: none; color: #d4a93c; font-size: 28px; cursor: pointer; }
.title { font-size: 18px; font-weight: 700; color: #e8c032; }
.balance { font-size: 13px; color: #a08040; }

.issue-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; background: rgba(40,28,8,0.8);
  border-bottom: 1px solid rgba(212,169,60,0.15);
}
.issue-no { font-size: 13px; color: rgba(255,255,255,0.6); }
.issue-no b { color: #e8c032; }
.countdown { font-size: 28px; font-weight: 700; color: #e8c032; letter-spacing: 2px; }
.countdown.locked { color: #f56c6c; }
.locked-text { font-size: 16px; }
.issue-label { font-size: 12px; color: rgba(255,255,255,0.4); }

.last-draw {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; background: rgba(20,14,4,0.6);
  border-bottom: 1px solid rgba(212,169,60,0.1);
}
.ld-label { font-size: 12px; color: rgba(255,255,255,0.5); }
.ld-balls { display: flex; gap: 6px; }
.ld-sum { font-size: 13px; color: #e8c032; margin-left: 4px; }

.ball {
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #c8a028, #8a5c10);
  font-size: 13px; font-weight: 700; color: #fff;
}
.ball.small { width: 24px; height: 24px; font-size: 11px; }

.bet-panel { padding: 16px; }
.bet-types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
.bet-type-btn {
  padding: 12px 6px; border-radius: 8px;
  border: 1px solid rgba(212,169,60,0.3);
  background: rgba(40,28,8,0.8); cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  transition: all 0.2s;
}
.bet-type-btn.active { border-color: #d4a93c; background: rgba(212,169,60,0.2); }
.bet-type-btn.locked { opacity: 0.4; cursor: not-allowed; }
.bt-label { font-size: 15px; font-weight: 600; color: #fff; }
.bt-odds { font-size: 11px; color: #d4a93c; }

.exact-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; font-size: 13px; color: rgba(255,255,255,0.6); }
.exact-nums { display: flex; gap: 6px; flex-wrap: wrap; }
.exact-num {
  width: 30px; height: 30px; border-radius: 50%;
  border: 1px solid rgba(212,169,60,0.3); background: rgba(40,28,8,0.8);
  color: #fff; font-size: 13px; cursor: pointer;
}
.exact-num.active { background: #d4a93c; border-color: #d4a93c; color: #000; }

.amount-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.amount-label { font-size: 13px; color: rgba(255,255,255,0.6); }
.quick-amounts { display: flex; gap: 6px; }
.quick-btn {
  padding: 5px 10px; border-radius: 6px;
  border: 1px solid rgba(212,169,60,0.3); background: rgba(40,28,8,0.8);
  color: #d4a93c; font-size: 13px; cursor: pointer;
}
.amount-input {
  width: 90px; padding: 5px 10px; border-radius: 6px;
  border: 1px solid rgba(212,169,60,0.3); background: rgba(40,28,8,0.8);
  color: #fff; font-size: 13px; outline: none;
}

.submit-btn {
  width: 100%; padding: 14px; border-radius: 10px;
  border: none; cursor: pointer; font-size: 16px; font-weight: 700;
  background: linear-gradient(135deg, #d4a93c, #8a5c10);
  color: #fff; letter-spacing: 2px;
}
.submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.history-section, .my-bets-section { padding: 0 16px 16px; }
.section-title { font-size: 14px; font-weight: 600; color: #d4a93c; margin: 16px 0 8px; border-left: 3px solid #d4a93c; padding-left: 8px; }

.h-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.h-no { font-size: 11px; color: rgba(255,255,255,0.4); width: 100px; }
.h-balls { display: flex; gap: 4px; flex: 1; }
.h-sum { font-size: 13px; color: rgba(255,255,255,0.6); width: 30px; text-align: center; }
.h-flag { font-size: 12px; font-weight: 700; padding: 2px 6px; border-radius: 4px; }
.h-flag.big { background: rgba(231,76,60,0.2); color: #e74c3c; }
.h-flag.small { background: rgba(46,204,113,0.2); color: #2ecc71; }

.bet-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.bet-issue { font-size: 11px; color: rgba(255,255,255,0.4); flex: 1; }
.bet-type { font-size: 13px; color: #fff; width: 60px; }
.bet-amount { font-size: 13px; color: #f56c6c; }
.bet-status { font-size: 13px; font-weight: 700; }
.bet-status.won { color: #2ecc71; }
.bet-status.lost { color: #909399; }
.bet-status.pending { color: #e8c032; }
.page-bottom-spacer { height: 80px; }
</style>
