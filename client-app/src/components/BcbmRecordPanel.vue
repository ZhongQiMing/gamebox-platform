<template>
  <!--
    官方移动端 YoPlayCreditRecordPage / YoPlayBetRecordPage（480×715）
    额度：日期(+tradeno交易号) | 类别(游戏名+类型) | 交易金额 | 交易后余额
    下注：日期（订单号） | 总投注 | 派彩 | 有效投注；右侧展开详情（结果+玩法明细）
    筛选：今天 / 近3天 / 近7天
  -->
  <div class="rec-root" @click.self="emit('close')">
    <div class="rec-panel">
      <div class="border-outer" aria-hidden="true" />

      <button type="button" class="back" aria-label="返回" @click="emit('close')">
        <img
          src="/images/games/bcbm/benz/main/yben_btn_back.png"
          alt=""
          draggable="false"
        />
      </button>

      <h2 class="title">{{ title }}</h2>

      <div class="filters">
        <button
          v-for="f in FILTERS"
          :key="f.key"
          type="button"
          class="filter"
          :class="{ on: filter === f.key }"
          @click="filter = f.key"
        >
          {{ f.label }}
        </button>
      </div>

      <div class="thead" :class="mode">
        <template v-if="mode === 'credit'">
          <span class="col date">日期</span>
          <i class="sep" />
          <span class="col type">类别</span>
          <i class="sep" />
          <span class="col amt">交易金额</span>
          <i class="sep" />
          <span class="col bal">交易后余额</span>
        </template>
        <template v-else>
          <span class="col date">日期（订单号）</span>
          <i class="sep" />
          <span class="col amt">总投注</span>
          <i class="sep" />
          <span class="col pay">派彩</span>
          <i class="sep" />
          <span class="col valid">有效投注</span>
          <span class="col toggle" />
        </template>
      </div>

      <div class="list">
        <div v-if="loading" class="empty">加载中…</div>
        <div v-else-if="mode === 'credit' ? !creditFiltered.length : !betFiltered.length" class="empty">暂无记录</div>

        <template v-if="mode === 'credit'">
          <div
            v-for="r in creditFiltered"
            :key="r.id"
            class="row credit"
          >
            <span class="col date">
              <span class="d1">{{ r.date }}</span>
              <span class="d2">({{ r.tradeNo }})</span>
            </span>
            <span class="col type">
              <template v-if="r.gameName">
                <span class="t1">{{ r.gameName }}</span>
                <span class="t2">{{ r.type }}</span>
              </template>
              <template v-else>{{ r.type }}</template>
            </span>
            <span
              class="col amt"
              :class="{ pos: r.amount > 0, neg: r.amount < 0 }"
            >
              {{ fmtSigned(r.amount) }}
            </span>
            <span class="col bal">{{ fmtNum(r.balance) }}</span>
          </div>
        </template>

        <template v-else>
          <div v-for="r in betFiltered" :key="r.id" class="bet-block">
            <button
              type="button"
              class="row bet"
              :class="{ open: expandedId === r.id }"
              @click="toggleExpand(r.id)"
            >
              <span class="col date">
                <span class="d1">{{ r.date }}</span>
                <span class="d2">({{ r.billNo }})</span>
              </span>
              <span class="col amt">{{ fmtNum(r.bet) }}</span>
              <span
                class="col pay"
                :class="{ pos: r.payout > 0 }"
              >
                {{ fmtNum(r.payout) }}
              </span>
              <span class="col valid">{{ fmtNum(r.validBet) }}</span>
              <span class="col toggle" aria-hidden="true">
                <span class="detail-btn">
                  <i /><i /><i />
                </span>
              </span>
            </button>

            <!-- 官网 BetRecordDetail：结果 + 玩法/下注/派彩 -->
            <div v-if="expandedId === r.id" class="detail">
              <div class="detail-head">
                <span class="dh result">结果</span>
                <span class="dh play">玩法</span>
                <span class="dh bet">下注</span>
                <span class="dh pay">派彩</span>
              </div>
              <div class="detail-body">
                <div class="result-col">
                  <template v-if="r.resultMain">
                    <img
                      class="result-main"
                      :src="r.resultMain"
                      alt=""
                      draggable="false"
                    />
                    <div v-if="r.resultSmall" class="result-small">
                      <img
                        class="circle"
                        src="/images/games/bcbm/benz/spin/yben_bg_history_blk_circle.png"
                        alt=""
                      />
                      <img class="car" :src="r.resultSmall" alt="" />
                    </div>
                  </template>
                  <span v-else class="result-empty">—</span>
                </div>
                <div class="plays">
                  <div
                    v-for="(d, i) in r.details"
                    :key="i"
                    class="play-row"
                  >
                    <div class="play-cell">
                      <img
                        v-if="d.icon"
                        class="play-icon"
                        :src="d.icon"
                        alt=""
                        draggable="false"
                      />
                      <span class="play-odds">x{{ d.mult }}</span>
                    </div>
                    <div class="play-bet">{{ fmtNum(d.amount) }}</div>
                    <div
                      class="play-pay"
                      :class="{ pos: d.payout > 0 }"
                    >
                      {{ fmtNum(d.payout) }}
                    </div>
                  </div>
                  <div v-if="!r.details.length" class="play-empty">无明细</div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { walletApi } from '@/api/wallet'
import { gamesApi } from '@/api/games'
import {
  bcbmBetIconUrl,
  bcbmRingIndexToCarPos,
  type BcbmAwardType,
} from '@/games/bcbm'
import {
  BCBM_PLAYTYPE_META,
} from '@/games/bcbm/bcbmSpinMath'
import { historyPanelIcons } from '@/games/bcbm/bcbmHistoryRoad'

const props = defineProps<{
  mode: 'credit' | 'bet'
}>()

const emit = defineEmits<{ close: [] }>()

const title = computed(() =>
  props.mode === 'credit' ? '额度记录' : '奔驰宝马',
)

type FilterKey = 'today' | 'd3' | 'd7'
const FILTERS: { key: FilterKey; label: string; days: number }[] = [
  { key: 'today', label: '今天', days: 1 },
  { key: 'd3', label: '近3天', days: 3 },
  { key: 'd7', label: '近7天', days: 7 },
]
const filter = ref<FilterKey>('today')
const expandedId = ref<string | null>(null)

const BIZ: Record<string, string> = {
  BET: '投注',
  WIN: '派彩',
  REBATE: '返水',
  RECHARGE: '充值',
  WITHDRAW: '提现',
  ACTIVITY: '活动',
  ADJUST: '调整',
  COMMISSION: '佣金',
}

type CreditRow = {
  id: string
  ts: number
  date: string
  tradeNo: string
  gameName: string
  type: string
  amount: number
  balance: number
}

type BetDetailLine = {
  position: string
  amount: number
  payout: number
  mult: number
  icon: string
}

type BetRow = {
  id: string
  ts: number
  date: string
  billNo: string
  bet: number
  payout: number
  validBet: number
  resultMain: string | null
  resultSmall: string | null
  details: BetDetailLine[]
}

const loading = ref(true)
const creditRows = ref<CreditRow[]>([])
const betRows = ref<BetRow[]>([])

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function fmtDateTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { ts: 0, date: iso, d: null as Date | null }
  return {
    ts: d.getTime(),
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    d,
  }
}
function fmtTradeNo(id: string, when: Date | null) {
  const base = when ?? new Date()
  const head = `${String(base.getFullYear()).slice(2)}${pad(base.getMonth() + 1)}${pad(base.getDate())}`
  let n = 0
  for (let i = 0; i < id.length; i++) n = (Math.imul(n, 31) + id.charCodeAt(i)) >>> 0
  return `${head}${String(n % 1e9).padStart(9, '0')}`
}
function parseGameName(remark: string | null | undefined) {
  if (!remark) return ''
  return remark.replace(/\s*(押注|命中|注资|游戏回水|派彩).*$/u, '').trim()
}
function fmtNum(n: number) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtSigned(n: number) {
  const s = fmtNum(Math.abs(n))
  if (n > 0) return `+${s}`
  if (n < 0) return `-${s}`
  return s
}

function dayStart(offsetDays: number) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - offsetDays)
  return d.getTime()
}

const creditFiltered = computed(() => {
  const days = FILTERS.find((f) => f.key === filter.value)?.days ?? 1
  const from = dayStart(days - 1)
  return creditRows.value.filter((r) => r.ts >= from)
})
const betFiltered = computed(() => {
  const days = FILTERS.find((f) => f.key === filter.value)?.days ?? 1
  const from = dayStart(days - 1)
  return betRows.value.filter((r) => r.ts >= from)
})

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

function metaByPosition(pos: string) {
  const hit = Object.values(BCBM_PLAYTYPE_META).find((m) => m.betId === pos)
  if (hit) return hit
  const [brandRaw, color] = pos.split('_')
  if (!brandRaw || !color) return null
  const brand =
    brandRaw === 'vw'
      ? 'volkswagen'
      : brandRaw === 'benz'
        ? 'benz'
        : brandRaw
  return { brand, color, mult: 0, betId: pos }
}

function brandFileKey(brand: string) {
  if (brand === 'volkswagen') return 'vw'
  return brand
}

function detailIcon(pos: string) {
  const m = metaByPosition(pos)
  if (!m) return ''
  return bcbmBetIconUrl(brandFileKey(m.brand), m.color)
}

function resultFromOutcome(outcome: unknown): {
  main: string | null
  small: string | null
} {
  if (!outcome || typeof outcome !== 'object') return { main: null, small: null }
  const o = outcome as {
    awardType?: string
    stopIndex?: number
    kind?: string
  }
  const stop = Number(o.stopIndex)
  if (!Number.isFinite(stop)) return { main: null, small: null }
  const carPos = bcbmRingIndexToCarPos(stop, o.kind)
  const icons = historyPanelIcons({
    carPos,
    award: (o.awardType || 'none') as BcbmAwardType,
  })
  return { main: icons.mainUrl, small: icons.smallUrl }
}

async function load() {
  loading.value = true
  creditRows.value = []
  betRows.value = []
  expandedId.value = null
  try {
    if (props.mode === 'credit') {
      const res = await walletApi.ledger(1, 80)
      creditRows.value = (res.list ?? []).map((x) => {
        const { ts, date, d } = fmtDateTime(x.createdAt)
        return {
          id: x.id,
          ts,
          date,
          tradeNo: fmtTradeNo(x.id, d),
          gameName: parseGameName(x.remark),
          type: BIZ[x.bizType] || x.bizType || '账变',
          amount: Number(x.amount || 0),
          balance: Number(x.balanceAfter || 0),
        }
      })
    } else {
      const list = await gamesApi.betHistory()
      const arr = Array.isArray(list) ? list : []
      betRows.value = arr
        .filter((x: { game?: { code?: string } }) => {
          const code = x.game?.code || ''
          return !code || code === 'bcbm'
        })
        .map(
          (x: {
            id: string
            betNo?: string
            amount: number
            payout: number
            validBet?: number
            createdAt: string
            roundId?: string | null
            roundNo?: string | null
            outcome?: unknown
            details?: Array<{
              position: string
              amount: number
              payout: number
              multiplier?: number
            }>
          }) => {
            const { ts, date } = fmtDateTime(x.createdAt)
            const bet = Number(x.amount || 0)
            const payout = Number(x.payout || 0)
            const billRaw = String(x.betNo || x.roundNo || x.id || '')
            const result = resultFromOutcome(x.outcome)
            const details: BetDetailLine[] = (x.details ?? [])
              .filter((d) => d.position && d.amount > 0)
              .map((d) => {
                const meta = metaByPosition(d.position)
                return {
                  position: d.position,
                  amount: Number(d.amount || 0),
                  payout: Number(d.payout || 0),
                  mult:
                    Number(d.multiplier || 0) ||
                    meta?.mult ||
                    0,
                  icon: detailIcon(d.position),
                }
              })
            return {
              id: x.id,
              ts,
              date,
              billNo: billRaw.replace(/[()]/g, ''),
              bet,
              payout,
              validBet: Number(x.validBet ?? bet),
              resultMain: result.main,
              resultSmall: result.small,
              details,
            }
          },
        )
    }
  } catch {
    creditRows.value = []
    betRows.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => props.mode,
  () => {
    filter.value = 'today'
    void load()
  },
)

onMounted(() => {
  void load()
})
</script>

<style scoped>
.rec-root {
  position: absolute;
  inset: 0;
  z-index: 42;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: stretch;
  justify-content: center;
}
.rec-panel {
  position: relative;
  width: 480px;
  height: 715px;
  color: #fff;
  overflow: hidden;
}
.border-outer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-style: solid;
  border-width: 48px 59px 73px 52px;
  border-image-source: url('/images/games/bcbm/benz/main/yben_ui_geniric_border.png');
  border-image-slice: 48 59 73 52 fill;
  border-image-repeat: stretch;
  background: #061828;
}
.back {
  position: absolute;
  left: 12px;
  top: 14px;
  z-index: 3;
  width: 44px;
  height: 44px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.back img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: screen;
}
.title {
  position: relative;
  z-index: 2;
  margin: 22px 0 0;
  text-align: center;
  font-size: 22px;
  font-weight: 700;
  color: #7ad7ff;
  letter-spacing: 3px;
}
.filters {
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 16px 24px 12px;
}
.filter {
  min-width: 72px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #3a6a8e;
  border-radius: 4px;
  background: rgba(0, 20, 40, 0.45);
  color: #9ec4e0;
  font-size: 13px;
  cursor: pointer;
}
.filter.on {
  background: #2a7a4a;
  border-color: #3db06d;
  color: #fff;
}
.thead {
  position: relative;
  z-index: 2;
  margin: 0 28px;
  height: 34px;
  display: flex;
  align-items: center;
  background: #e3d6ae;
  color: #1a1208;
  font-size: 13px;
  font-weight: 700;
  box-sizing: border-box;
}
.thead .col {
  text-align: center;
  line-height: 34px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.thead .sep {
  flex: 0 0 2px;
  width: 2px;
  height: 22px;
  background: #fff;
  opacity: 0.85;
}
.thead.credit .date,
.row.credit .date {
  flex: 1.35;
}
.thead.credit .type,
.row.credit .type {
  flex: 0.85;
}
.thead.credit .amt,
.row.credit .amt {
  flex: 1.1;
}
.thead.credit .bal,
.row.credit .bal {
  flex: 1.1;
}
.thead.bet .date,
.row.bet .date {
  flex: 1.45;
}
.thead.bet .amt,
.row.bet .amt,
.thead.bet .pay,
.row.bet .pay,
.thead.bet .valid,
.row.bet .valid {
  flex: 0.85;
}
.thead.bet .toggle,
.row.bet .toggle {
  flex: 0 0 28px;
}
.list {
  position: relative;
  z-index: 2;
  margin: 0 28px 70px;
  height: 500px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.row {
  display: flex;
  align-items: center;
  min-height: 50px;
  width: 100%;
  border: 0;
  border-bottom: 1px solid rgba(160, 200, 230, 0.18);
  padding: 0;
  background: transparent;
  font-size: 12px;
  color: #e8f4ff;
  cursor: default;
}
.row.bet {
  cursor: pointer;
  text-align: left;
}
.row.bet.open {
  background: rgba(0, 80, 120, 0.18);
}
.row .col {
  text-align: center;
  padding: 6px 2px;
  box-sizing: border-box;
  word-break: break-all;
}
.row .date .d1 {
  display: block;
  font-size: 12px;
}
.row .date .d2 {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: #8ab4d8;
}
.row .type .t1,
.row .type .t2 {
  display: block;
  line-height: 1.25;
}
.row .type .t2 {
  margin-top: 2px;
  color: #b7d6ef;
}
.amt.pos,
.pay.pos,
.play-pay.pos {
  color: #6dff9a;
}
.amt.neg,
.pay.neg {
  color: #ff8a8a;
}
/* 官网 detailButtonGrp：右侧竖条三点 */
.detail-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 17px;
  height: 29px;
  margin: 0 auto;
  border: 1px solid #fff;
  border-radius: 5px;
  background: #009bb2;
  box-sizing: border-box;
}
.detail-btn i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 2px #00f9ff;
}
.bet-block {
  border-bottom: 1px solid rgba(160, 200, 230, 0.12);
}
.detail {
  background: rgba(8, 12, 16, 0.92);
  border-bottom: 1px solid rgba(255, 255, 255, 0.35);
  padding: 8px 4px 12px;
}
.detail-head {
  display: grid;
  grid-template-columns: 88px 1fr 88px 88px;
  align-items: center;
  height: 26px;
  margin: 0 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.85);
  font-size: 13px;
  color: #fff;
}
.detail-head .dh {
  text-align: center;
  border-left: 1px solid rgba(255, 255, 255, 0.85);
  line-height: 24px;
}
.detail-head .dh:first-child {
  border-left: 0;
}
.detail-body {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 4px;
  min-height: 64px;
}
.result-col {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 4px;
}
.result-main {
  width: 48px;
  height: 48px;
  object-fit: contain;
}
.result-small {
  position: absolute;
  left: 14px;
  top: 2px;
  width: 18px;
  height: 18px;
}
.result-small .circle,
.result-small .car {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
}
.result-empty {
  color: #8ab4d8;
  font-size: 14px;
  margin-top: 16px;
}
.plays {
  border-left: 1px solid rgba(255, 255, 255, 0.35);
}
.play-row {
  display: grid;
  grid-template-columns: 1fr 88px 88px;
  align-items: center;
  min-height: 36px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}
.play-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 4px 0;
}
.play-icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
}
.play-odds {
  font-size: 13px;
  color: #e8f4ff;
}
.play-bet,
.play-pay {
  text-align: center;
  font-size: 13px;
  border-left: 1px solid rgba(255, 255, 255, 0.25);
  line-height: 36px;
}
.play-empty {
  padding: 16px;
  text-align: center;
  color: #8ab4d8;
  font-size: 13px;
}
.empty {
  padding: 56px 0;
  text-align: center;
  color: #8ab4d8;
  font-size: 15px;
}
</style>
