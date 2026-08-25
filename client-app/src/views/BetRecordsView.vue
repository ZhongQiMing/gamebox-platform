<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page br-page has-page-title">
    <div class="app-bar">
      <div class="back" @click="goBack">‹</div>
      <div class="title">{{ pageTitle }}</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <h1 class="page-title">{{ listHeading }}</h1>

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
                  <span class="br-kpi-label">投 注 金 额</span>
                </div>
                <div class="br-kpi-cell">
                  <span :class="['br-kpi-num', summary.playerSettle >= 0 ? 'pos-num' : 'neg-num']">{{ fmtProfit(summary.playerSettle) }}</span>
                  <span class="br-kpi-label">玩 家 盈 亏</span>
                </div>
              </div>
              <div class="br-summary">
                <div class="br-summary-cell">
                  有效流水 <span class="br-summary-num pos">{{ fmt(summary.validFlow) }}</span>
                </div>
                <div class="br-summary-cell">
                  庄家盈亏 <span :class="['br-summary-num', summary.houseSettle >= 0 ? 'pos' : 'neg']">{{ fmtProfit(summary.houseSettle) }}</span>
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
import { ref, computed, onActivated, onDeactivated, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import http from '@/api/http'
import { lotteryApi, type LotteryBet } from '@/api/lottery'
import {
  BCBM_AWARD_LABELS,
  FRUIT_AWARD_LABELS,
  FRUIT_BET_SYMBOLS,
  FRUIT_RING,
  bcbmBetSlot,
  isBcbmBetId,
  type BcbmAwardType,
  type FruitAwardType,
  formatMoney,
  formatSignedMoney,
} from '@gamebox/shared'
import { useBodyClass } from '@/composables/useBodyClass'
import { leaveGameToLobby } from '@/composables/lobbyAfterGame'
import { TIME_RANGES, rangeBounds, formatRangeDateText, formatDay, type TimeRangeKey } from '@/composables/timeRange'
import TabBar from '@/components/TabBar.vue'
import '@/assets/bet-records.css'

useBodyClass('deco-bg')

const route = useRoute()
const router = useRouter()

/** 聊天彩票：注单以服务端为准 */
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
}

/** 牌桌类：走 /bet/history（与街机同一套服务端注单） */
const TABLE_BET_GAMES: Record<string, { title: string; serverCode: string }> = {
  zhajinhua: { title: '炸金花注单', serverCode: 'zhajinhua' },
  douniu: { title: '斗牛注单', serverCode: 'douniu' },
  baccarat: { title: '百家乐注单', serverCode: 'baccarat' },
  longhu: { title: '龙虎斗注单', serverCode: 'dragon-tiger' },
}

/** 街机类：走 /bet/history，UI 与聊天室注单页同一套 */
const ARCADE_BET_GAMES: Record<string, { title: string }> = {
  'fruit-machine': { title: '水果机注单' },
  bcbm: { title: '奔驰宝马注单' },
}

const activeGameCode = computed(() => {
  const g = route.query.game
  return typeof g === 'string' ? g : ''
})

const activeLotteryGame = computed(() => {
  const g = activeGameCode.value
  return g ? LOTTERY_BET_GAMES[g] : undefined
})

const activeArcadeGame = computed(() => {
  const g = activeGameCode.value
  return g ? ARCADE_BET_GAMES[g] : undefined
})

const activeTableGame = computed(() => {
  const g = activeGameCode.value
  return g ? TABLE_BET_GAMES[g] : undefined
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
  outcome?: unknown
  details?: Array<{
    position: string
    amount: number
    payout: number
    multiplier: number
    won: boolean
  }>
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

interface ReportSummary {
  start: string
  end: string
  orders: number
  amount: number
  validFlow: number
  playerSettle: number
  houseSettle: number
}

const range = ref<TimeRangeKey>('today')
const rangeDateText = computed(() => formatRangeDateText(range.value))
const loading = ref(true)
const records = ref<BetRecord[]>([])
const sscLog = ref<SscBetGroup[]>([])
const expandedIssue = ref<string | null>(null)
/** 报表顶部全量汇总（与下方列表条数上限无关） */
const reportSummary = ref<ReportSummary | null>(null)
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
  if (t === 'alldiff') {
    if (!value || value === 'any') return '三不同号'
    const digits = String(value).replace(/\D/g, '').split('').filter((c) => '123456'.includes(c))
    const sorted = [...new Set(digits)].sort().join('')
    return sorted.length === 3 ? '三不同' + sorted : '三不同号'
  }
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
    /*
     * 金额一律先归一成数字再算：接口若把 Decimal 回成字符串，
     * `sum += amount` 会变成字符串拼接，汇总金额会越滚越长。
     */
    const amount = Number(b.amount) || 0
    const payout = Number(b.payout) || 0
    const profit = pending ? 0 : payout - amount
    g.bets.push({
      play: formatServerPlay(b.betType, b.payload, gameCode),
      amount,
      status: b.status,
      profit,
      winAmount: payout,
      hit: b.status === 'WON' ? '中奖' : '',
    })
    g.totalAmount += amount
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

function formatFruitPlay(outcome: unknown): string {
  const o = (outcome ?? {}) as {
    awardType?: string
    choice?: string
    result?: string
  }
  if (o.choice === 'big' || o.choice === 'small') {
    if (o.result === 'win') return '猜大小·赢'
    if (o.result === 'lose') return '猜大小·输'
    return '猜大小·和'
  }
  if (o.awardType && o.awardType in FRUIT_AWARD_LABELS) {
    return FRUIT_AWARD_LABELS[o.awardType as FruitAwardType]
  }
  if (o.awardType === 'bar') return '天门'
  if (o.awardType === 'normal') return '普通中奖'
  return o.awardType || '投注'
}

/** 水果机押注仓位 → 图案名；再赌局的仓位是 GAMBLE_BIG / GAMBLE_SMALL */
const FRUIT_SYMBOL_LABELS: Record<string, string> = Object.fromEntries(
  FRUIT_BET_SYMBOLS.map((s) => [s.id, s.label]),
)

function formatFruitPosition(pos: string): string {
  if (pos === 'GAMBLE_BIG') return '再赌·押大'
  if (pos === 'GAMBLE_SMALL') return '再赌·押小'
  return FRUIT_SYMBOL_LABELS[pos] || pos || '仓位'
}

/**
 * 水果机开奖摘要：转盘停在哪一格 + 奖型。
 * 原先注单只显示奖型（如「普通中奖」），看不出押了什么、开出什么。
 */
function formatFruitDraw(outcome: unknown): string {
  const o = (outcome ?? {}) as {
    awardType?: string
    stopIndex?: number
    choice?: string
    result?: string
    roll?: number
  }
  if (o.choice === 'big' || o.choice === 'small') {
    const pick = o.choice === 'big' ? '押大' : '押小'
    const res = o.result === 'win' ? '赢' : o.result === 'lose' ? '输' : '和'
    const roll = typeof o.roll === 'number' ? `开 ${o.roll} · ` : ''
    return `${pick} · ${roll}${res}`
  }
  const cell = typeof o.stopIndex === 'number' ? FRUIT_RING[o.stopIndex] : undefined
  const stop = cell ? `停在 ${cell.label}${cell.mult > 0 ? ` ×${cell.mult}` : ''}` : ''
  const award =
    o.awardType && o.awardType in FRUIT_AWARD_LABELS
      ? FRUIT_AWARD_LABELS[o.awardType as FruitAwardType]
      : ''
  /* 普通中奖已由「停在 X」表达，不再重复；特殊奖型才值得单独点出来 */
  if (stop && award && o.awardType !== 'normal') return `${stop} · ${award}`
  return stop || award || '开奖'
}

function formatBcbmPlay(outcome: unknown): string {
  const o = (outcome ?? {}) as { awardType?: string }
  if (o.awardType && o.awardType in BCBM_AWARD_LABELS) {
    return BCBM_AWARD_LABELS[o.awardType as BcbmAwardType]
  }
  if (o.awardType === 'normal') return '普通中奖'
  return o.awardType || '投注'
}

function formatBcbmPosition(pos: string): string {
  if (isBcbmBetId(pos)) return bcbmBetSlot(pos).label
  return pos || '仓位'
}

function formatArcadePlay(gameCode: string, outcome: unknown): string {
  if (gameCode === 'fruit-machine') return formatFruitPlay(outcome)
  if (gameCode === 'bcbm') return formatBcbmPlay(outcome)
  return '投注'
}

function formatArcadeIssue(r: BetRecord): string {
  // 展开 key 需唯一；优先单号，否则用时间+短 id
  if (r.betNo) return String(r.betNo)
  if (r.roundNo) return String(r.roundNo)
  const d = new Date(r.createdAt)
  if (Number.isNaN(d.getTime())) return r.id.slice(0, 10)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}:${ss}`
}

function groupsFromArcadeRecords(gameCode: string, list: BetRecord[]): SscBetGroup[] {
  return list
    .filter((r) => r.game?.code === gameCode && r.status !== 'CANCELLED')
    .map((r) => {
      const pending = r.status === 'PENDING'
      const profit = pending ? 0 : r.payout - r.amount
      const play = formatArcadePlay(gameCode, r.outcome)
      /**
       * 奔驰宝马与水果机都是「一局押多个仓位」，展开逐仓位明细，
       * 开奖结果放 drawSummary —— 否则只看到一个奖型名，既不知道押了什么，
       * 也不知道开出什么。
       */
      const perPosition = gameCode === 'bcbm' || gameCode === 'fruit-machine'
      const bets: SscBetItem[] =
        perPosition && r.details?.length
          ? r.details.map((d) => {
              const dProfit = pending ? 0 : d.payout - d.amount
              return {
                play:
                  gameCode === 'bcbm'
                    ? formatBcbmPosition(d.position)
                    : formatFruitPosition(d.position),
                amount: d.amount,
                status: d.won ? 'WON' : 'LOST',
                profit: dProfit,
                winAmount: d.payout,
                hit: d.won ? (d.multiplier > 0 ? `中 ×${d.multiplier}` : '中奖') : '',
              }
            })
          : [
              {
                play,
                amount: r.amount,
                status: r.status,
                profit,
                winAmount: r.payout,
                hit: r.status === 'WON' ? '中奖' : '',
              },
            ]
      const drawSummary = pending
        ? undefined
        : gameCode === 'bcbm'
          ? play
          : gameCode === 'fruit-machine'
            ? formatFruitDraw(r.outcome)
            : undefined
      return {
        game: gameCode,
        issue: formatArcadeIssue(r),
        createdAt: r.createdAt,
        settledAt: r.settledAt || undefined,
        settled: !pending,
        drawSummary,
        bets,
        totalAmount: r.amount,
        totalProfit: profit,
      }
    })
    .sort(
      (a, b) =>
        new Date(b.settledAt || b.createdAt).getTime() -
        new Date(a.settledAt || a.createdAt).getTime(),
    )
}

const TABLE_PLAY_LABELS: Record<string, string> = {
  banker: '庄',
  player: '闲',
  tie: '和',
  bankerPair: '庄对',
  playerPair: '闲对',
  shunjin: '顺金',
  baozi: '豹子',
  san2: '散牌',
  san3: '对子',
  san6: '顺子',
  san7: '金花',
  small: '小牛牛',
  niuniu: '牛牛',
  niu79: '牛7-牛9',
  niu06: '无牛-牛6',
  flower: '五花牛',
  dragon: '龙',
  tiger: '虎',
  DRAGON: '龙',
  TIGER: '虎',
  TIE: '和',
}

function formatTablePlay(position: string): string {
  const key = String(position || '')
  return TABLE_PLAY_LABELS[key] || key || '投注'
}

function formatTableDrawSummary(outcome: unknown): string | undefined {
  const o = (outcome ?? {}) as {
    result?: string
    winner?: string
    bankerType?: { label?: string }
    playerType?: { label?: string }
  }
  const resultRaw = String(o.result || o.winner || '').toLowerCase()
  const resultCn: Record<string, string> = {
    banker: '庄赢',
    player: '闲赢',
    tie: '和',
    dragon: '龙赢',
    tiger: '虎赢',
  }
  const result = resultCn[resultRaw] || (resultRaw ? resultRaw : '')
  const bt = o.bankerType?.label
  const pt = o.playerType?.label
  if (bt && pt && result) return `庄 ${bt} · 闲 ${pt} · ${result}`
  if (bt && pt) return `庄 ${bt} · 闲 ${pt}`
  return result || undefined
}

function groupsFromTableRecords(serverCode: string, list: BetRecord[]): SscBetGroup[] {
  return list
    .filter((r) => r.game?.code === serverCode && r.status !== 'CANCELLED')
    .map((r) => {
      const pending = r.status === 'PENDING'
      const profit = pending ? 0 : r.payout - r.amount
      const bets: SscBetItem[] = (r.details?.length
        ? r.details
        : [{ position: '投注', amount: r.amount, payout: r.payout, multiplier: 0, won: r.payout > 0 }]
      ).map((d) => {
        const dPending = pending
        const dProfit = dPending ? 0 : d.payout - d.amount
        return {
          play: formatTablePlay(d.position),
          amount: d.amount,
          status: dPending ? 'PENDING' : d.won ? 'WON' : 'LOST',
          profit: dProfit,
          winAmount: d.payout,
          hit: !dPending && d.won ? '中奖' : '',
        }
      })
      return {
        game: serverCode,
        issue: String(r.roundNo || r.betNo || r.id.slice(0, 10)),
        createdAt: r.createdAt,
        settledAt: r.settledAt || undefined,
        settled: !pending,
        drawSummary: formatTableDrawSummary(r.outcome),
        bets,
        totalAmount: r.amount,
        totalProfit: profit,
      }
    })
    .sort(
      (a, b) =>
        new Date(b.settledAt || b.createdAt).getTime() -
        new Date(a.settledAt || a.createdAt).getTime(),
    )
}

async function loadBetHistoryForRange() {
  const [from, to] = rangeBounds(range.value)
  try {
    records.value = await http.get<BetRecord[], BetRecord[]>(
      `/bet/history?range=${range.value}&from=${from}&to=${to}`,
    )
  } catch {
    records.value = []
  }
}

async function loadLotteryBetLog() {
  const code = activeGameCode.value
  if (ARCADE_BET_GAMES[code]) {
    const seq = ++loadSeq
    await loadBetHistoryForRange()
    if (seq !== loadSeq) return
    sscLog.value = groupsFromArcadeRecords(code, records.value)
    return
  }
  if (TABLE_BET_GAMES[code]) {
    const seq = ++loadSeq
    await loadBetHistoryForRange()
    if (seq !== loadSeq) return
    sscLog.value = groupsFromTableRecords(TABLE_BET_GAMES[code].serverCode, records.value)
    return
  }
  const cfg = activeLotteryGame.value
  if (!cfg || !code) {
    sscLog.value = []
    return
  }
  if (SERVER_LOTTERY_CODES.has(code)) {
    const seq = ++loadSeq
    try {
      const [from, to] = rangeBounds(range.value)
      const pageSize = 200
      const all: LotteryBet[] = []
      let page = 1
      let total = Infinity
      while (all.length < total && page <= 20) {
        const res = await lotteryApi.myBets(code, page, pageSize, undefined, {
          range: range.value,
          from,
          to,
        })
        if (seq !== loadSeq) return
        const list = res.list || []
        total = Number(res.total) || 0
        all.push(...list)
        if (list.length < pageSize) break
        page += 1
      }
      if (seq !== loadSeq) return
      sscLog.value = groupsFromServerBets(code, all)
    } catch {
      if (seq !== loadSeq) return
      loadLocalLotteryBetLog()
    }
    return
  }
  loadLocalLotteryBetLog()
}

/* keep-alive 挂起后组件还活着，监听也还在；不判激活态就会替看不见的页拉数据 */
let pageActive = true

function onLotteryLogStorage(e: StorageEvent) {
  if (!pageActive) return
  const code = activeGameCode.value
  if (SERVER_LOTTERY_CODES.has(code) || TABLE_BET_GAMES[code] || ARCADE_BET_GAMES[code]) return
  const key = lotteryBetLogStorageKey()
  if (key && e.key && e.key !== key) return
  void loadLotteryBetLog()
}

function onLotteryLogVisible() {
  if (!pageActive) return
  if (document.visibilityState === 'visible') void loadLotteryBetLog()
}

function startLotteryPollIfNeeded() {
  const needsPoll = !!(activeLotteryGame.value || activeTableGame.value || activeArcadeGame.value)
  if (lotteryPollTimer || !needsPoll) return
  lotteryPollTimer = setInterval(() => {
    if (document.visibilityState === 'hidden') return
    if (!(activeLotteryGame.value || activeTableGame.value || activeArcadeGame.value)) return
    if (sscLog.value.some(g => !g.settled)) void loadLotteryBetLog()
  }, 2000)
}

function stopLotteryPoll() {
  if (!lotteryPollTimer) return
  clearInterval(lotteryPollTimer)
  lotteryPollTimer = null
}

const pageTitle = computed(
  () =>
    activeLotteryGame.value?.title
    ?? activeTableGame.value?.title
    ?? activeArcadeGame.value?.title
    ?? '竞猜报表',
)

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
  return reportSummary.value
})

async function loadReportSummary() {
  if (activeGameCode.value) {
    reportSummary.value = null
    return
  }
  const [from, to] = rangeBounds(range.value)
  const endTs = Math.min(to - 1, Date.now())
  try {
    const data = await http.get<{
      orders: number
      amount: number
      validFlow: number
      playerSettle: number
      houseSettle: number
    }, {
      orders: number
      amount: number
      validFlow: number
      playerSettle: number
      houseSettle: number
    }>(`/bet/report-summary?range=${range.value}&from=${from}&to=${to}`)
    reportSummary.value = {
      start: formatDay(from),
      end: formatDay(endTs),
      orders: data.orders,
      amount: data.amount,
      validFlow: data.validFlow,
      playerSettle: data.playerSettle,
      houseSettle: data.houseSettle,
    }
  } catch {
    reportSummary.value = null
  }
}

function fmt(n: number) {
  return formatMoney(n)
}

function fmtProfit(n: number) {
  return formatSignedMoney(n)
}

function toggleExpand(issue: string) {
  expandedIssue.value = expandedIssue.value === issue ? null : issue
}

async function onRangeChange(key: TimeRangeKey) {
  range.value = key
  expandedIssue.value = null
  await Promise.all([loadBetHistoryForRange(), loadReportSummary()])
  if (activeArcadeGame.value || activeTableGame.value || activeLotteryGame.value) {
    await loadLotteryBetLog()
  }
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
  else void leaveGameToLobby(router, 'push')
}

watch(activeGameCode, () => {
  void loadLotteryBetLog()
})

/* H5 写完本地注单会广播，各游戏一个事件名；用具名回调才能在卸载时摘干净 */
const BET_LOG_EVENTS = [
  'ssc-bet-log-updated',
  'ffc-bet-log-updated',
  'jsr-bet-log-updated',
  'jsb-bet-log-updated',
  'bjsc-bet-log-updated',
  'k3-bet-log-updated',
  'lhc-bet-log-updated',
]

function onBetLogEvent() {
  if (!pageActive) return
  void loadLotteryBetLog()
}

onMounted(async () => {
  await loadBetHistoryForRange()
  await Promise.all([loadLotteryBetLog(), loadReportSummary()])
  startLotteryPollIfNeeded()
  window.addEventListener('storage', onLotteryLogStorage)
  for (const name of BET_LOG_EVENTS) window.addEventListener(name, onBetLogEvent)
  document.addEventListener('visibilitychange', onLotteryLogVisible)
  loading.value = false
})

/* 被 keep-alive 挂起时组件不卸载，得靠 activated/deactivated 收停轮询 */
let skipFirstActivate = true
onActivated(() => {
  pageActive = true
  if (skipFirstActivate) {
    skipFirstActivate = false
    return
  }
  /* 报表与注单同期刷新，否则回到缓存页看到的是上次的汇总 */
  void loadBetHistoryForRange().then(() => loadReportSummary())
  void loadLotteryBetLog()
  startLotteryPollIfNeeded()
})

onDeactivated(() => {
  pageActive = false
  stopLotteryPoll()
})

onUnmounted(() => {
  pageActive = false
  stopLotteryPoll()
  window.removeEventListener('storage', onLotteryLogStorage)
  for (const name of BET_LOG_EVENTS) window.removeEventListener(name, onBetLogEvent)
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
