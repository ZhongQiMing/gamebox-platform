<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page br-page">
    <div class="app-bar">
      <div class="back" @click="goBack">‹</div>
      <div class="title">{{ pageTitle }}</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <h1 class="br-title">{{ listHeading }}</h1>

      <div class="time-tabs">
        <button
          v-for="t in TIME_RANGES"
          :key="t.key"
          :class="['tt-item', range === t.key ? 'active' : '']"
          @click="onRangeChange(t.key)"
        >{{ t.label }}</button>
      </div>
      <div class="time-range-hint">{{ rangeDateText }}</div>

      <div class="br-list">
        <div v-if="loading" class="br-empty">
          <div class="br-empty-icon">◇</div>
          <div class="br-empty-text">加 载 中 …</div>
        </div>

        <!-- 单游戏注单：可展开看每注明细 -->
        <template v-else-if="isGameDetail && hasSscGroups">
          <div
            v-for="g in sscGroupsInRange"
            :key="g.issue"
            class="br-fold"
            :class="{ 'is-open': expandedIssue === g.issue }"
          >
            <button
              type="button"
              class="br-fold__head"
              :aria-expanded="expandedIssue === g.issue"
              @click="toggleExpand(g.issue)"
            >
              <span class="ssc-bet-record-issue">{{ g.issue }}</span>
              <span class="br-fold__meta">{{ g.bets.length }} 注 · {{ fmt(g.totalAmount) }}</span>
              <span :class="['br-fold__result', g.settled ? (g.totalProfit >= 0 ? 'pos' : 'neg') : 'wait']">
                {{ g.settled ? fmtProfit(g.totalProfit) : '待开奖' }}
              </span>
              <span class="br-fold__arrow" aria-hidden="true">▼</span>
            </button>

            <div v-show="expandedIssue === g.issue" class="br-fold__body">
              <ul class="br-detail">
                <li v-for="(b, idx) in g.bets" :key="idx" class="br-detail-row">
                  <span class="br-detail-play">{{ b.play }}/{{ b.amount }}</span>
                  <span class="br-detail-mid">{{ betDetailMid(b, g.settled) }}</span>
                  <span :class="['br-detail-profit', detailProfitClass(b, g.settled)]">
                    {{ detailProfitText(b, g.settled) }}
                  </span>
                </li>
              </ul>
              <div v-if="g.settled && g.drawSummary" class="br-draw-line">
                开奖 {{ g.drawSummary }}
              </div>
            </div>
          </div>
        </template>

        <!-- 全游戏竞猜报表：顶部汇总 + 单局列表（不展开明细） -->
        <template v-else-if="isReport">
          <div v-if="!summary && !reportRounds.length" class="br-empty">
            <div class="br-empty-icon">◇</div>
            <div class="br-empty-text">该 时 段 暂 无 记 录</div>
          </div>
          <template v-else>
            <div v-if="summary" class="br-card">
              <div class="br-time">{{ summary.start }}  ~  {{ summary.end }}</div>
              <div class="br-kpi">
                <div class="br-kpi-cell">
                  <span class="br-kpi-num">{{ summary.orders }}</span>
                  <span class="br-kpi-label">总 注 单</span>
                </div>
                <div class="br-kpi-cell">
                  <span class="br-kpi-num">{{ fmt(summary.amount) }}</span>
                  <span class="br-kpi-label">总 金 额</span>
                </div>
                <div class="br-kpi-cell">
                  <span :class="['br-kpi-num', summary.playerSettle >= 0 ? 'pos-num' : 'neg-num']">{{ fmtProfit(summary.playerSettle) }}</span>
                  <span class="br-kpi-label">总 盈 亏</span>
                </div>
              </div>
              <div class="br-summary">
                <div class="br-summary-cell">
                  游戏总结过 <span :class="['br-summary-num', summary.gameSettle >= 0 ? 'pos' : 'neg']">{{ fmt(summary.gameSettle) }}</span>
                </div>
                <div class="br-summary-cell">
                  玩家总结过 <span :class="['br-summary-num', summary.playerSettle >= 0 ? 'pos' : 'neg']">{{ fmt(summary.playerSettle) }}</span>
                </div>
              </div>
            </div>

            <div
              v-for="r in reportRounds"
              :key="r.id"
              class="br-round"
            >
              <div class="br-round__main">
                <span class="br-round__game">{{ r.gameName }}</span>
                <span class="br-round__issue">{{ r.issueLabel }}</span>
              </div>
              <div class="br-round__meta">{{ r.betCount }} 注 · {{ fmt(r.amount) }}</div>
              <span :class="['br-round__profit', r.pending ? 'wait' : (r.profit >= 0 ? 'pos' : 'neg')]">
                {{ r.pending ? '待开奖' : fmtProfit(r.profit) }}
              </span>
            </div>
          </template>
        </template>

        <div v-else class="br-empty">
          <div class="br-empty-icon">◇</div>
          <div class="br-empty-text">该 时 段 暂 无 记 录</div>
        </div>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <TabBar />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import http from '@/api/http'
import { lotteryApi, type LotteryBet } from '@/api/lottery'
import { useBodyClass } from '@/composables/useBodyClass'
import { TIME_RANGES, rangeBounds, formatRangeDateText, formatDay, type TimeRangeKey } from '@/composables/timeRange'
import TabBar from '@/components/TabBar.vue'
import '@/assets/bet-records.css'

useBodyClass('deco-bg')

const route = useRoute()
const router = useRouter()

/** 聊天彩票：注单以大脑为准；牌桌仍读本地日志 */
const SERVER_LOTTERY_CODES = new Set([
  'ssc', 'ffc', 'speed-racing', 'speed-boat', 'bjsc', 'kuai3', 'lhc',
])

const LOTTERY_BET_GAMES: Record<string, { title: string; storagePrefix: string; eventName: string }> = {
  ssc: { title: '快乐时时彩注单', storagePrefix: 'ssc_bet_log_', eventName: 'ssc-bet-log-updated' },
  ffc: { title: '1分时时彩注单', storagePrefix: 'ffc_bet_log_', eventName: 'ffc-bet-log-updated' },
  'speed-racing': { title: '极速赛车注单', storagePrefix: 'jsr_bet_log_', eventName: 'jsr-bet-log-updated' },
  'speed-boat': { title: '幸运飞艇注单', storagePrefix: 'jsb_bet_log_', eventName: 'jsb-bet-log-updated' },
  bjsc: { title: '北京赛车注单', storagePrefix: 'bjsc_bet_log_', eventName: 'bjsc-bet-log-updated' },
  kuai3: { title: '1分快三注单', storagePrefix: 'k3_bet_log_', eventName: 'k3-bet-log-updated' },
  lhc: { title: '幸运六合彩注单', storagePrefix: 'lhc_bet_log_', eventName: 'lhc-bet-log-updated' },
  zhajinhua: { title: '炸金花注单', storagePrefix: 'zjh_bet_log_', eventName: 'zjh-bet-log-updated' },
  douniu: { title: '斗牛注单', storagePrefix: 'dn_bet_log_', eventName: 'dn-bet-log-updated' },
  baccarat: { title: '百家乐注单', storagePrefix: 'bjl_bet_log_', eventName: 'bjl-bet-log-updated' },
  longhu: { title: '龙虎斗注单', storagePrefix: 'lhd_bet_log_', eventName: 'lhd-bet-log-updated' },
}

const activeGameCode = computed(() => {
  const g = route.query.game
  return typeof g === 'string' ? g : ''
})

const activeLotteryGame = computed(() => {
  const g = activeGameCode.value
  return g ? LOTTERY_BET_GAMES[g] : undefined
})

interface BetRecord {
  id: string
  betNo?: string
  amount: number
  payout: number
  betCount?: number
  status: 'PENDING' | 'WON' | 'LOST' | 'CANCELLED' | string
  createdAt: string
  settledAt?: string | null
  game?: { name: string; code: string }
  roundNo?: string | null
  issueNo?: string | null
}

interface SscBetItem {
  play: string
  amount: number
  status: string
  profit: number
  winAmount: number
  hit: string
}

interface SscBetGroup {
  game: string
  issue: string
  createdAt: string
  settledAt?: string
  settled: boolean
  drawSummary?: string
  bets: SscBetItem[]
  totalAmount: number
  totalProfit: number
}

const range = ref<TimeRangeKey>('today')
const rangeDateText = computed(() => formatRangeDateText(range.value))
const loading = ref(true)
const records = ref<BetRecord[]>([])
const sscLog = ref<SscBetGroup[]>([])
const expandedIssue = ref<string | null>(null)
let lotteryPollTimer: ReturnType<typeof setInterval> | null = null
let loadSeq = 0

function lotteryBetLogStorageKey() {
  const cfg = activeLotteryGame.value
  if (!cfg) return null
  try {
    const raw = localStorage.getItem('gamebox_user')
    if (!raw) return null
    const u = JSON.parse(raw)
    return u?.uid ? cfg.storagePrefix + u.uid : null
  } catch {
    return null
  }
}

function carLabel(n: number | string) {
  const num = Number(n)
  if (!Number.isFinite(num)) return String(n)
  return num === 10 ? '0' : String(num)
}

function trackLabel(pos: number) {
  return pos === 9 ? '0' : String(pos + 1)
}

function formatServerPlay(betType: string | null | undefined, payload: LotteryBet['payload'], gameCode?: string): string {
  const value = payload?.value != null ? String(payload.value) : ''
  const t = betType || ''
  const isDigit5 = gameCode === 'ssc' || gameCode === 'ffc'
  const digit5Pos = ['万', '千', '百', '十', '个']
  const fixed: Record<string, string> = {
    top2big: '冠亚大', top2small: '冠亚小', top2odd: '冠亚单', top2even: '冠亚双',
    big: '大', small: '小', odd: '单', even: '双',
  }
  if (fixed[t]) return fixed[t]
  if (t === 'champion') return `1/${carLabel(value)}`
  if (t === 'runner') return `2/${carLabel(value)}`
  if (t === 'dice') return `三军${value}`
  if (t === 'pair') return `二同${value}`
  if (t === 'triplet') return '三同'
  if (t === 'tripletN') return `三同${value}`
  if (t === 'straight') return value && value !== 'any' ? `三连${value}` : '三连号'
  if (t === 'alldiff') return '三不同'
  if (t === 'long' && value.includes(':')) {
    const [a, b] = value.split(':')
    return `长牌${a}${b}`
  }
  if (t === 'sum') return `和${value}`
  if (t === 'ballSide' && value.includes(':')) {
    const [pos, side] = value.split(':')
    const sideCn: Record<string, string> = { big: '大', small: '小', odd: '单', even: '双' }
    return `${digit5Pos[Number(pos)] || pos}${sideCn[side] || side}`
  }
  if (t === 'position' && value.includes(':')) {
    const [pos, num] = value.split(':')
    if (isDigit5) return `${digit5Pos[Number(pos)] || pos}${num}`
    return `${trackLabel(Number(pos))}/${carLabel(num)}`
  }
  if (t === 'posSide' && value.includes(':')) {
    const [pos, side] = value.split(':')
    const sideCn: Record<string, string> = { big: '大', small: '小', odd: '单', even: '双' }
    return `${trackLabel(Number(pos))}${sideCn[side] || side}`
  }
  if (t === 'gySum' || t.startsWith('gySum_')) {
    return `冠亚和${t.startsWith('gySum_') ? t.slice(6) : value}`
  }
  if (t === 'lhh') {
    if (isDigit5 || !value.includes(':')) return value || '龙虎'
    const [a, b, pick] = value.split(':')
    const pairs = [[0, 9], [1, 8], [2, 7], [3, 6], [4, 5]]
    const idx = pairs.findIndex(([x, y]) => x === Number(a) && y === Number(b))
    return `${idx >= 0 ? idx + 1 : Number(a) + 1}${pick || ''}`
  }
  if (t === 'anyDigit') {
    if (value.includes(':')) {
      const [seg, digit] = value.split(':')
      return `${seg}${digit}`
    }
    return `不定位${value}`
  }
  if (t === 'group3' && value.includes(':')) {
    const [seg, rest] = value.split(':')
    return `${seg}组三${(rest || '').replace(/,/g, '')}`
  }
  if (t === 'group6' && value.includes(':')) {
    const [seg, rest] = value.split(':')
    return `${seg}组六${(rest || '').replace(/,/g, '')}`
  }
  if (t === 'niu') {
    const n = Number(value)
    if (n === -1) return '无牛'
    if (n === 10) return '牛牛'
    if (Number.isFinite(n) && n >= 1 && n <= 9) return `牛${n}`
    return value ? `牛${value}` : '牛'
  }
  if (t === 'niuSide') return value ? `牛${value}` : '牛两面'
  if (t === 'shape' && value.includes(':')) {
    const [seg, shape] = value.split(':')
    return `${seg}${shape}`
  }
  if (value) return `${t}:${value}`
  return t || '—'
}

function parseDrawNums(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(Number) : null
  } catch {
    return null
  }
}

function groupsFromServerBets(gameCode: string, list: LotteryBet[]): SscBetGroup[] {
  const map = new Map<string, SscBetGroup>()
  for (const b of list) {
    if (b.status === 'CANCELLED') continue
    const issueNo = b.issue?.issueNo || '—'
    let g = map.get(issueNo)
    if (!g) {
      const nums = parseDrawNums(b.issue?.drawNumbers)
      g = {
        game: gameCode,
        issue: issueNo,
        createdAt: b.createdAt,
        settledAt: b.settledAt || undefined,
        settled: false,
        drawSummary: nums ? nums.join(' ') : undefined,
        bets: [],
        totalAmount: 0,
        totalProfit: 0,
      }
      map.set(issueNo, g)
    }
    const pending = b.status === 'PENDING'
    const profit = pending ? 0 : b.payout - b.amount
    g.bets.push({
      play: formatServerPlay(b.betType, b.payload, gameCode),
      amount: b.amount,
      status: b.status,
      profit,
      winAmount: b.payout,
      hit: b.status === 'WON' ? '中奖' : '',
    })
    g.totalAmount += b.amount
    g.totalProfit += profit
    if (b.settledAt && (!g.settledAt || b.settledAt > g.settledAt)) g.settledAt = b.settledAt
    if (new Date(b.createdAt).getTime() < new Date(g.createdAt).getTime()) g.createdAt = b.createdAt
  }
  for (const g of map.values()) {
    g.settled = g.bets.length > 0 && g.bets.every(x => x.status !== 'PENDING')
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.settledAt || b.createdAt).getTime() - new Date(a.settledAt || a.createdAt).getTime(),
  )
}

function loadLocalLotteryBetLog() {
  const key = lotteryBetLogStorageKey()
  if (!key) {
    sscLog.value = []
    return
  }
  try {
    const logRaw = localStorage.getItem(key)
    sscLog.value = logRaw ? JSON.parse(logRaw) : []
  } catch {
    sscLog.value = []
  }
}

async function loadLotteryBetLog() {
  const code = activeGameCode.value
  const cfg = activeLotteryGame.value
  if (!cfg || !code) {
    sscLog.value = []
    return
  }
  if (SERVER_LOTTERY_CODES.has(code)) {
    const seq = ++loadSeq
    try {
      const res = await lotteryApi.myBets(code, 1, 200)
      if (seq !== loadSeq) return
      sscLog.value = groupsFromServerBets(code, res.list || [])
    } catch {
      if (seq !== loadSeq) return
      loadLocalLotteryBetLog()
    }
    return
  }
  loadLocalLotteryBetLog()
}

function onLotteryLogStorage(e: StorageEvent) {
  const code = activeGameCode.value
  if (SERVER_LOTTERY_CODES.has(code)) return
  const key = lotteryBetLogStorageKey()
  if (key && e.key && e.key !== key) return
  void loadLotteryBetLog()
}

function onLotteryLogVisible() {
  if (document.visibilityState === 'visible') void loadLotteryBetLog()
}

function startLotteryPollIfNeeded() {
  if (lotteryPollTimer || !activeLotteryGame.value) return
  lotteryPollTimer = setInterval(() => {
    if (!activeLotteryGame.value) return
    if (sscLog.value.some(g => !g.settled)) void loadLotteryBetLog()
  }, 2000)
}

function stopLotteryPoll() {
  if (!lotteryPollTimer) return
  clearInterval(lotteryPollTimer)
  lotteryPollTimer = null
}

const pageTitle = computed(() => activeLotteryGame.value?.title ?? '竞猜报表')

const listHeading = computed(() => (activeGameCode.value ? '竞 猜 记 录' : '竞 猜 报 表'))

const isGameDetail = computed(() => !!activeGameCode.value)
const isReport = computed(() => !activeGameCode.value)

function groupInRange(g: SscBetGroup, from: number, to: number) {
  const t = new Date(g.settledAt || g.createdAt).getTime()
  return t >= from && t < to
}

const sscGroupsInRange = computed(() => {
  const [from, to] = rangeBounds(range.value)
  return sscLog.value.filter(g => groupInRange(g, from, to))
})

const hasSscGroups = computed(() => sscGroupsInRange.value.length > 0)

const recordsInRange = computed(() => {
  const [from, to] = rangeBounds(range.value)
  return records.value.filter(r => {
    const t = new Date(r.settledAt || r.createdAt).getTime()
    return t >= from && t < to && r.status !== 'CANCELLED'
  })
})

const reportRounds = computed(() => {
  return recordsInRange.value.map(r => {
    const pending = r.status === 'PENDING'
    const profit = pending ? 0 : r.payout - r.amount
    const issueLabel = r.issueNo || r.roundNo || r.betNo || r.id.slice(0, 8)
    return {
      id: r.id,
      gameName: r.game?.name || r.game?.code || '游戏',
      issueLabel,
      betCount: r.betCount || 1,
      amount: r.amount,
      profit,
      pending,
    }
  })
})

const summary = computed(() => {
  if (isGameDetail.value) return null
  const list = recordsInRange.value
  if (!list.length) return null
  const amount = list.reduce((s, r) => s + r.amount, 0)
  const pendingAmount = list
    .filter(r => r.status === 'PENDING')
    .reduce((s, r) => s + r.amount, 0)
  const settledPayout = list
    .filter(r => r.status !== 'PENDING')
    .reduce((s, r) => s + r.payout, 0)
  const settledAmount = amount - pendingAmount
  const orders = list.reduce((s, r) => s + (r.betCount || 1), 0)
  const [from, to] = rangeBounds(range.value)
  const endTs = Math.min(to - 1, Date.now())
  return {
    start: formatDay(from),
    end: formatDay(endTs),
    orders,
    amount,
    gameSettle: settledAmount - settledPayout,
    playerSettle: settledPayout - settledAmount,
  }
})

function fmt(n: number) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function fmtProfit(n: number) {
  return (n >= 0 ? '+' : '') + fmt(n)
}

function toggleExpand(issue: string) {
  expandedIssue.value = expandedIssue.value === issue ? null : issue
}

function onRangeChange(key: TimeRangeKey) {
  range.value = key
  expandedIssue.value = null
}

function betDetailMid(b: SscBetItem, settled: boolean) {
  if (!settled) return '待开'
  if (b.status === 'WON') return b.hit || '中奖'
  return '未中'
}

function detailProfitText(b: SscBetItem, settled: boolean) {
  if (!settled) return '—'
  return fmtProfit(b.profit)
}

function detailProfitClass(b: SscBetItem, settled: boolean) {
  if (!settled) return ''
  return b.profit >= 0 ? 'pos' : 'neg'
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/lobby')
}

watch(activeGameCode, () => {
  void loadLotteryBetLog()
})

onMounted(async () => {
  await loadLotteryBetLog()
  startLotteryPollIfNeeded()
  window.addEventListener('storage', onLotteryLogStorage)
  window.addEventListener('ssc-bet-log-updated', () => { void loadLotteryBetLog() })
  window.addEventListener('ffc-bet-log-updated', () => { void loadLotteryBetLog() })
  window.addEventListener('jsr-bet-log-updated', () => { void loadLotteryBetLog() })
  window.addEventListener('jsb-bet-log-updated', () => { void loadLotteryBetLog() })
  window.addEventListener('bjsc-bet-log-updated', () => { void loadLotteryBetLog() })
  window.addEventListener('k3-bet-log-updated', () => { void loadLotteryBetLog() })
  window.addEventListener('lhc-bet-log-updated', () => { void loadLotteryBetLog() })
  window.addEventListener('zjh-bet-log-updated', () => { void loadLotteryBetLog() })
  document.addEventListener('visibilitychange', onLotteryLogVisible)
  try {
    records.value = await http.get<BetRecord[], BetRecord[]>('/bet/history')
  } catch { /* 静默 */ } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  stopLotteryPoll()
  window.removeEventListener('storage', onLotteryLogStorage)
  document.removeEventListener('visibilitychange', onLotteryLogVisible)
})
</script>

<style scoped>
/* 快乐时时彩注单 · 期号（独立样式，不共用 br-fold__issue） */
.ssc-bet-record-issue {
  font-size: 12px;
  font-weight: 600;
  font-family: ui-monospace, Consolas, monospace;
  color: #f4d36b;
  letter-spacing: -0.3px;
  white-space: nowrap;
}
</style>
