<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div v-if="!isTabOverview" class="back" @click="router.back()">‹</div>
      <div class="title">
        <template v-if="isLandlordOverview">
          <span class="brand-dot"></span>
          <span class="brand-wordmark">经营明细</span>
        </template>
        <template v-else-if="isAgentOverview">
          <span class="brand-dot"></span>
          <span class="brand-wordmark">账单明细</span>
        </template>
        <template v-else>{{ pageTitle }}</template>
      </div>
      <div class="right sc-bar-act" @click="load">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <div
        v-if="view !== 'points'"
        class="sp-tabs sp-tabs--range"
        :data-count="visibleRanges.length"
      >
        <button
          v-for="t in visibleRanges"
          :key="t.key"
          type="button"
          :class="{ on: range === t.key }"
          @click="switchRange(t.key)"
        >{{ t.label }}</button>
      </div>

      <div v-if="loading" class="sp-empty">加载中…</div>
      <template v-else-if="pageReady">
        <!-- 英雄区 -->
        <section class="rp-hero">
          <div class="rp-hero-k">{{ heroLabel }}</div>
          <div class="rp-hero-v" :class="pnlClass(heroValue)">
            {{ view === 'points' ? fmt(heroValue) : fmtSigned(heroValue) }}
          </div>
          <div
            class="rp-hero-row"
            :class="{ 'cols-4': isLandlordOverview, 'cols-2': heroMetrics.length === 2 }"
          >
            <div v-for="m in heroMetrics" :key="m.k">
              <span class="k">{{ m.k }}</span>
              <span class="v" :class="m.cls || ''">{{ m.v }}</span>
            </div>
          </div>
        </section>

        <!-- 管理/房主：详细单行清单；其他角色保留原格子（子报表可无格子） -->
        <div v-if="isLandlordOverview && summaryCells.length" class="rp-detail">
          <div v-for="c in summaryCells" :key="c.k" class="rp-detail-row">
            <span class="k">{{ c.k }}</span>
            <b class="v" :class="c.cls || ''">{{ c.v }}</b>
          </div>
        </div>
        <div v-else-if="summaryCells.length" class="rd-grid">
          <div v-for="c in summaryCells" :key="c.k" class="rd-cell">
            <div class="mk">{{ c.k }}</div>
            <div class="mv" :class="c.cls || ''">{{ c.v }}</div>
          </div>
        </div>

        <!-- 竞猜：分游戏 -->
        <template v-if="view === 'guess'">
          <div class="sc-sec-title">分游戏竞猜</div>
          <div v-if="!(summary?.byGame || []).length" class="sp-empty">该区间暂无已结算注单</div>
          <div v-for="g in summary?.byGame || []" :key="g.gameCode" class="rp-card is-static">
            <div class="rp-card-hd">
              <div class="rp-card-name">
                <b>{{ g.gameName || g.gameCode }}</b>
              </div>
              <div class="rp-card-pnl" :class="pnlClass(isAgentSide ? -g.housePnl : g.housePnl)">
                {{ fmtSigned(isAgentSide ? -g.housePnl : g.housePnl) }}
              </div>
            </div>
            <div class="rp-metrics cols-3">
              <div class="rp-m"><em>注单</em><b>{{ fmt(g.betCount) }}</b></div>
              <div class="rp-m"><em>流水</em><b>{{ fmt(g.betFlow) }}</b></div>
              <div class="rp-m"><em>派彩</em><b>{{ fmt(g.payout) }}</b></div>
            </div>
          </div>
        </template>

        <!-- 积分：玩家持分名单 -->
        <template v-else-if="view === 'points'">
          <div class="sc-sec-title">玩家持分</div>
          <div class="sp-tabs sp-tabs--range" data-count="3">
            <button
              v-for="t in pointsTabs"
              :key="t.key"
              type="button"
              :class="{ on: pointsFilter === t.key }"
              @click="switchPointsFilter(t.key)"
            >{{ t.label }}</button>
          </div>
          <div v-if="pointsLoading && !pointsList.length" class="sp-empty">加载中…</div>
          <div v-else-if="!pointsList.length" class="sp-empty">暂无符合条件的玩家</div>
          <div v-for="row in pointsList" :key="row.id" class="sp-row sf-row">
            <div class="top">
              <div class="name">{{ row.nickname || '—' }}</div>
              <div class="bal" :class="row.balance > 0 ? 'up' : ''">{{ fmt(row.balance) }}</div>
            </div>
            <div class="meta">{{ row.uid || '—' }}</div>
          </div>
          <div v-if="pointsCanMore" class="sp-empty">
            <button type="button" class="sc-logout" :disabled="pointsLoading" @click="loadMorePoints">
              {{ pointsLoading ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </template>

        <!-- 分房间：管理/房主只读；代理端可点进详情 -->
        <template v-else-if="showRoomBreakdown">
          <div class="sc-sec-title">{{ view === 'fund' ? '分房间上下分' : '分房间' }}</div>
          <component
            :is="isLandlordOverview ? 'div' : 'button'"
            v-for="r in roomRows"
            :key="r.roomId"
            v-bind="isLandlordOverview ? {} : { type: 'button' }"
            class="rp-card"
            :class="{ 'is-static': isLandlordOverview }"
            @click="onRoomCardClick(r.roomId)"
          >
            <div class="rp-card-hd">
              <div class="rp-card-name">
                <b>{{ r.name }}</b>
                <span>进房码 {{ r.roomNo }} · 玩家 {{ r.memberCount ?? 0 }}</span>
              </div>
              <div
                class="rp-card-pnl"
                :class="pnlClass(roomPnl(r))"
              >{{ fmtSigned(roomPnl(r)) }}</div>
            </div>
            <div class="rp-line-grid" v-if="isLandlordOverview">
              <div class="rp-line"><span>流水</span><b>{{ fmt(r.betFlow) }}</b></div>
              <div class="rp-line"><span>庄家盈亏</span><b :class="pnlClass(r.housePnl)">{{ fmtSigned(r.housePnl) }}</b></div>
              <div class="rp-line"><span>平台占成</span><b :class="pnlClass(r.platformShareAmount ?? r.housePnl)">{{ fmtSigned(r.platformShareAmount ?? r.housePnl) }}</b></div>
              <div class="rp-line"><span>代理佣金</span><b class="down">{{ fmt(r.commissionAmount) }}</b></div>
              <div class="rp-line"><span>平台净盈</span><b :class="pnlClass(roomNetPnl(r))">{{ fmtSigned(roomNetPnl(r)) }}</b></div>
              <div class="rp-line"><span>注单</span><b>{{ fmt(r.betCount) }}</b></div>
            </div>
            <div v-else-if="view === 'fund'" class="rp-metrics">
              <div class="rp-m"><em>上分</em><b class="up">{{ fmt(r.upAmount) }}</b></div>
              <div class="rp-m"><em>下分</em><b class="down">{{ fmt(r.downAmount) }}</b></div>
            </div>
            <div v-else class="rp-metrics">
              <div class="rp-m"><em>注单</em><b>{{ fmt(r.betCount) }}</b></div>
              <div class="rp-m"><em>流水</em><b>{{ fmt(r.betFlow) }}</b></div>
              <div class="rp-m"><em>上分</em><b class="up">{{ fmt(r.upAmount) }}</b></div>
              <div class="rp-m"><em>下分</em><b class="down">{{ fmt(r.downAmount) }}</b></div>
            </div>
          </component>
        </template>

        <!-- 上下分：区间内明细，全部 / 上分 / 下分 -->
        <template v-if="view === 'fund'">
          <div class="sc-sec-title">上下分明细</div>
          <div class="sp-tabs sp-tabs--range" data-count="3">
            <button
              v-for="t in fundTypeTabs"
              :key="t.key"
              type="button"
              :class="{ on: fundType === t.key }"
              @click="switchFundType(t.key)"
            >{{ t.label }}</button>
          </div>
          <div v-if="fundLoading && !fundList.length" class="sp-empty">加载中…</div>
          <div v-else-if="!fundList.length" class="sp-empty">该区间暂无记录</div>
          <div v-for="row in fundList" :key="row.id" class="sp-row sf-row">
            <div class="top">
              <div class="name">
                <span class="sf-tag" :class="row.type === 'UP' ? 'up' : 'down'">
                  {{ row.type === 'UP' ? '上分' : '下分' }}
                </span>
                {{ row.player?.nickname || '—' }}
              </div>
              <div class="bal" :class="row.type === 'UP' ? 'up' : 'down'">{{ fmt(row.amount) }}</div>
            </div>
            <div class="meta">
              <template v-if="row.orderNo">订单 {{ row.orderNo }} · </template>
              {{ row.player?.uid || '—' }}
              <template v-if="channelLabel(row.channel)"> · {{ channelLabel(row.channel) }}</template>
              · {{ fmtTime(row.reviewedAt || row.createdAt) }}
            </div>
          </div>
          <div v-if="fundCanMore" class="sp-empty">
            <button type="button" class="sc-logout" :disabled="fundLoading" @click="loadMoreFund">
              {{ fundLoading ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </template>
      </template>
    </div>

    <StaffTabBar v-if="isAgentSide || isLandlord" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useStaffStore } from '@/stores/staff'
import {
  staffConsoleApi,
  type StaffFundOrder,
  type StaffPlayerRow,
  type StaffReportByRoomRow,
  type StaffReportSummary,
  type StaffWalletMe,
} from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const route = useRoute()
const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const allRanges = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'thisweek', label: '本周' },
  { key: 'lastweek', label: '上周' },
  { key: 'thismonth', label: '本月' },
]

const range = ref('today')
const loading = ref(false)
const summary = ref<StaffReportSummary | null>(null)
const roomRows = ref<StaffReportByRoomRow[]>([])
const wallet = ref<StaffWalletMe | null>(null)

type FundTypeKey = '' | 'UP' | 'DOWN'
const fundTypeTabs: { key: FundTypeKey; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'UP', label: '上分' },
  { key: 'DOWN', label: '下分' },
]
const fundType = ref<FundTypeKey>('')
const fundList = ref<StaffFundOrder[]>([])
const fundPage = ref(1)
const fundTotal = ref(0)
const fundLoading = ref(false)
const fundCanMore = computed(() => fundList.value.length < fundTotal.value)

type PointsFilterKey = '' | 'positive' | 'zero'
const pointsTabs: { key: PointsFilterKey; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'positive', label: '有持分' },
  { key: 'zero', label: '零持分' },
]
const pointsFilter = ref<PointsFilterKey>('')
const pointsList = ref<StaffPlayerRow[]>([])
const pointsPage = ref(1)
const pointsTotal = ref(0)
const pointsLoading = ref(false)
/** wallet 失败时仍展示列表 */
const pointsBooted = ref(false)
const pointsCanMore = computed(() => pointsList.value.length < pointsTotal.value)
let fundReqSeq = 0
let pointsReqSeq = 0

const view = computed(() => {
  const v = String(route.query.view || '')
  if (v === 'guess' || v === 'points' || v === 'fund') return v
  return ''
})

const isAgentSide = computed(() => staff.isAgentSide)
const isLandlord = computed(() => staff.role === 'ADMIN' || staff.role === 'BRANCH')
/** 底栏「明细」总览：无 view；从「我的」进子报表时显示返回 */
const isAgentOverview = computed(() => isAgentSide.value && !view.value)
const isLandlordOverview = computed(() => isLandlord.value && !view.value)
const isTabOverview = computed(() => isAgentOverview.value || isLandlordOverview.value)
/** 今日 / 昨日 / 本周 / 上周 / 本月 */
const visibleRanges = computed(() => allRanges)

const pageTitle = computed(() => {
  if (isLandlordOverview.value) return '经营明细'
  if (isLandlord.value) return '报表摘要'
  if (view.value === 'guess') return '竞猜报表'
  if (view.value === 'points') return '积分报表'
  if (view.value === 'fund') return '上下分报表'
  if (isAgentSide.value) return '账单明细'
  return '经营报表'
})

/** 管理/房主总览始终展示分房；代理端单房不重复拆；竞猜/积分不拆房 */
const showRoomBreakdown = computed(() => {
  if (view.value === 'guess' || view.value === 'points') return false
  if (isLandlordOverview.value) return roomRows.value.length > 0
  return roomRows.value.length > 1
})

const pageReady = computed(() => {
  if (view.value === 'points') return pointsBooted.value
  return !!summary.value
})

const heroLabel = computed(() => {
  if (view.value === 'points') return '玩家持分合计'
  if (view.value === 'fund') return '本期净上下分'
  if (isLandlordOverview.value) return '平台净盈亏'
  return isAgentSide.value ? '玩家盈亏' : '庄家盈亏'
})

const heroValue = computed(() => {
  if (view.value === 'points') return Number(wallet.value?.playerPointsTotal || 0)
  if (view.value === 'fund') {
    return Number(summary.value?.upAmount || 0) - Number(summary.value?.downAmount || 0)
  }
  if (isLandlordOverview.value) {
    const s = summary.value
    if (s?.netPnl != null) return Number(s.netPnl)
    return Number(s?.platformShareAmount ?? s?.housePnl ?? 0) - Number(s?.commissionAmount ?? 0)
  }
  return isAgentSide.value
    ? Number(summary.value?.playerPnl || 0)
    : Number(summary.value?.housePnl || 0)
})

const heroMetrics = computed(() => {
  const s = summary.value
  if (view.value === 'points') {
    const credit = wallet.value?.bookMode === 'CREDIT'
    return credit
      ? [
          { k: '剩余信用', v: fmt(wallet.value?.pointsQuota) },
          { k: '佣金账户', v: fmt(wallet.value?.balance) },
        ]
      : [
          { k: '上盘额度', v: fmt(wallet.value?.pointsQuota) },
          { k: '代理余额', v: fmt(wallet.value?.balance) },
          { k: '上盘可飞', v: fmt(wallet.value?.flyCover) },
        ]
  }
  if (!s) return []
  if (view.value === 'fund') {
    return [
      { k: '上分', v: fmt(s.upAmount), cls: 'up' },
      { k: '下分', v: fmt(s.downAmount), cls: 'down' },
      { k: '待审', v: `${s.pendingUp ?? 0}/${s.pendingDown ?? 0}` },
    ]
  }
  if (view.value === 'guess') {
    return [
      { k: '流水', v: fmt(s.betFlow) },
      { k: '派彩', v: fmt(s.payout) },
      { k: '注单', v: fmt(s.betCount) },
    ]
  }
  if (isLandlordOverview.value) {
    return [
      { k: '流水', v: fmt(s.betFlow) },
      { k: '派彩', v: fmt(s.payout) },
      { k: '庄家盈亏', v: fmtSigned(s.housePnl), cls: pnlClass(s.housePnl) },
      { k: '平台占成', v: fmtSigned(s.platformShareAmount ?? s.housePnl), cls: pnlClass(s.platformShareAmount ?? s.housePnl) },
    ]
  }
  /* 明细总览 */
  return [
    { k: '流水', v: fmt(s.betFlow) },
    { k: '派彩', v: fmt(s.payout) },
    { k: '注单', v: fmt(s.betCount) },
  ]
})

const summaryCells = computed(() => {
  const s = summary.value
  if (!s) return []
  /* 子报表不再叠交叉格子 */
  if (view.value === 'points' || view.value === 'fund' || view.value === 'guess') return []
  // 管理/房主：平台视角（盈利 / 流水 / 佣金），不含代理待审
  if (isLandlordOverview.value) {
    const commission = Number(s.commissionAmount || 0)
    return [
      { k: '注单数', v: fmt(s.betCount) },
      { k: '玩家盈亏', v: fmtSigned(s.playerPnl), cls: pnlClass(s.playerPnl) },
      { k: '代理佣金', v: fmt(commission), cls: commission > 0 ? 'down' : '' },
      { k: '佣金笔数', v: String(s.commissionCount ?? 0) },
      { k: '上分合计', v: fmt(s.upAmount), cls: 'up' },
      { k: '下分合计', v: fmt(s.downAmount), cls: 'down' },
      { k: '活跃玩家', v: String(s.activePlayers ?? 0) },
      { k: '房间数', v: String(s.roomCount ?? 0) },
    ]
  }
  return [
    { k: '上分', v: fmt(s.upAmount), cls: 'up' },
    { k: '下分', v: fmt(s.downAmount), cls: 'down' },
    { k: '活跃玩家', v: String(s.activePlayers ?? '—') },
    { k: '房间数', v: String(s.roomCount) },
  ]
})

function onRoomCardClick(roomId: string) {
  if (isLandlordOverview.value) return
  void router.push({ name: 'staff-room-detail', params: { id: roomId } })
}

function roomPnl(r: StaffReportByRoomRow) {
  if (view.value === 'fund') {
    return Number(r.upAmount || 0) - Number(r.downAmount || 0)
  }
  if (isLandlordOverview.value) return roomNetPnl(r)
  return isAgentSide.value ? Number(r.playerPnl || 0) : Number(r.housePnl || 0)
}
function roomNetPnl(r: StaffReportByRoomRow) {
  if (r.netPnl != null) return Number(r.netPnl)
  return Number(r.platformShareAmount ?? r.housePnl ?? 0) - Number(r.commissionAmount ?? 0)
}

function fmt(n?: number | null) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
function fmtSigned(n?: number | null) {
  const v = Number(n || 0)
  const s = fmt(Math.abs(v))
  if (v > 0) return `+${s}`
  if (v < 0) return `-${s}`
  return s
}
function pnlClass(n?: number | null) {
  const v = Number(n || 0)
  if (v > 0) return 'up'
  if (v < 0) return 'down'
  return ''
}

async function loadFund(page = 1, append = false) {
  if (view.value !== 'fund') return
  const seq = ++fundReqSeq
  fundLoading.value = true
  try {
    const res = await staffConsoleApi.fundHistory(page, {
      status: 'APPROVED',
      range: range.value,
      ...(fundType.value ? { type: fundType.value } : {}),
    })
    if (seq !== fundReqSeq) return
    fundPage.value = res.page
    fundTotal.value = res.total
    fundList.value = append ? [...fundList.value, ...(res.list || [])] : (res.list || [])
  } catch (e: unknown) {
    if (seq !== fundReqSeq) return
    if (!append) fundList.value = []
    toast(e instanceof Error ? e.message : '流水加载失败')
  } finally {
    if (seq === fundReqSeq) fundLoading.value = false
  }
}

function switchFundType(key: FundTypeKey) {
  if (fundType.value === key) return
  fundType.value = key
  void loadFund(1, false)
}

function loadMoreFund() {
  if (!fundCanMore.value || fundLoading.value) return
  void loadFund(fundPage.value + 1, true)
}

async function loadPoints(page = 1, append = false) {
  if (view.value !== 'points') return
  const seq = ++pointsReqSeq
  pointsLoading.value = true
  try {
    const res = await staffConsoleApi.players({
      page,
      pageSize: 30,
      ...(pointsFilter.value ? { points: pointsFilter.value } : {}),
    })
    if (seq !== pointsReqSeq) return
    pointsPage.value = res.page
    pointsTotal.value = res.total
    pointsList.value = append ? [...pointsList.value, ...(res.list || [])] : (res.list || [])
  } catch (e: unknown) {
    if (seq !== pointsReqSeq) return
    if (!append) pointsList.value = []
    toast(e instanceof Error ? e.message : '玩家列表加载失败')
  } finally {
    if (seq === pointsReqSeq) pointsLoading.value = false
  }
}

function switchPointsFilter(key: PointsFilterKey) {
  if (pointsFilter.value === key) return
  pointsFilter.value = key
  void loadPoints(1, false)
}

function loadMorePoints() {
  if (!pointsCanMore.value || pointsLoading.value) return
  void loadPoints(pointsPage.value + 1, true)
}

function fmtTime(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

function channelLabel(ch?: string | null) {
  if (!ch) return ''
  const map: Record<string, string> = {
    wechat: '微信',
    alipay: '支付宝',
    bank: '银行卡',
    cs: '客服',
  }
  return map[ch] || ch
}

async function load() {
  loading.value = true
  try {
    const tasks: Promise<unknown>[] = []
    if (view.value === 'points') {
      pointsBooted.value = false
      tasks.push(
        staffConsoleApi.walletMe().then((w) => { wallet.value = w }).catch(() => { wallet.value = null }),
        loadPoints(1, false),
      )
      roomRows.value = []
      fundList.value = []
      fundTotal.value = 0
    } else {
      tasks.push(
        staffConsoleApi.reportSummary({ range: range.value }).then((s) => { summary.value = s }),
      )
      if (view.value !== 'guess') {
        tasks.push(
          staffConsoleApi.reportByRoom({ range: range.value })
            .then((byRoom) => { roomRows.value = byRoom.list || [] })
            .catch(() => { roomRows.value = [] }),
        )
      } else {
        roomRows.value = []
      }
      if (!view.value) {
        tasks.push(
          staffConsoleApi.walletMe().then((w) => { wallet.value = w }).catch(() => { wallet.value = null }),
        )
      }
      if (view.value === 'fund') {
        tasks.push(loadFund(1, false))
      } else {
        fundList.value = []
        fundTotal.value = 0
      }
      pointsList.value = []
      pointsTotal.value = 0
    }
    await Promise.all(tasks)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    if (view.value === 'points') pointsBooted.value = true
    loading.value = false
  }
}

function switchRange(key: string) {
  range.value = key
  void load()
}

watch(view, () => { void load() })
onMounted(() => { void load() })
</script>

<style scoped>
.rp-hero {
  margin-bottom: 12px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(244, 211, 107, 0.35);
  background:
    radial-gradient(120% 80% at 100% 0%, rgba(245, 158, 11, 0.16), transparent 55%),
    linear-gradient(160deg, rgba(52, 36, 18, 0.96) 0%, rgba(22, 14, 8, 0.98) 100%);
}
.rp-hero-k {
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(255, 244, 194, 0.72);
  margin-bottom: 4px;
}
.rp-hero-v {
  font-size: 30px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  font-family: 'Noto Serif SC', serif;
  margin-bottom: 12px;
}
.rp-hero-v.up { color: #86efac; }
.rp-hero-v.down { color: #fca5a5; }
.rp-hero-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(244, 211, 107, 0.14);
}
.rp-hero-row.cols-4 {
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.rp-hero-row.cols-2 {
  grid-template-columns: repeat(2, 1fr);
}
.rp-hero-row .k {
  display: block;
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 3px;
}
.rp-hero-row .v {
  font-size: 14px;
  font-weight: 650;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}
.rp-hero-row.cols-4 .v { font-size: 12px; }
.rp-hero-row .v.up { color: #86efac; }
.rp-hero-row .v.down { color: #fca5a5; }

.rp-detail {
  margin-bottom: 14px;
  padding: 4px 12px;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.28);
  background: rgba(20, 14, 8, 0.88);
}
.rp-detail-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 2px;
  border-bottom: 1px solid rgba(244, 211, 107, 0.1);
}
.rp-detail-row:last-child { border-bottom: none; }
.rp-detail-row .k {
  flex-shrink: 0;
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--text-muted);
}
.rp-detail-row .v {
  min-width: 0;
  text-align: right;
  font-size: 15px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
}
.rp-detail-row .v.up { color: #86efac; }
.rp-detail-row .v.down { color: #fca5a5; }

.rp-card {
  display: block;
  width: 100%;
  margin-bottom: 10px;
  padding: 12px 14px;
  text-align: left;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.28);
  background: rgba(20, 14, 8, 0.88);
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.rp-card.is-static {
  cursor: default;
}
.rp-card:not(.is-static):active { background: rgba(244, 211, 107, 0.06); }

.rp-line-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(244, 211, 107, 0.1);
}
.rp-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.rp-line span {
  flex-shrink: 0;
  font-size: 11px;
  letter-spacing: 0.5px;
  color: rgba(244, 211, 107, 0.48);
}
.rp-line b {
  min-width: 0;
  text-align: right;
  font-size: 13px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-line b.up { color: #86efac; }
.rp-line b.down { color: #fca5a5; }
.rp-link {
  display: block;
  width: 100%;
  margin: 8px 0 0;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.28);
  background: rgba(16, 12, 8, 0.85);
  color: #fff4c2;
  font-size: 14px;
  letter-spacing: 1px;
  text-align: left;
  cursor: pointer;
}

.rp-card-hd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.rp-card-name {
  min-width: 0;
  flex: 1;
}
.rp-card-name b {
  display: block;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 1px;
  color: #fff4c2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-card-name span {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.5);
  letter-spacing: 0.5px;
}
.rp-card-pnl {
  flex-shrink: 0;
  max-width: 42%;
  text-align: right;
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff4c2;
  word-break: break-all;
  line-height: 1.2;
}
.rp-card-pnl.up { color: #86efac; }
.rp-card-pnl.down { color: #fca5a5; }

.rp-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(244, 211, 107, 0.1);
}
.rp-metrics.cols-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.rp-m {
  min-width: 0;
}
.rp-m em {
  display: block;
  font-style: normal;
  font-size: 10px;
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.48);
  margin-bottom: 3px;
}
.rp-m b {
  display: block;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff4c2;
  word-break: break-all;
  line-height: 1.2;
}
.rp-m b.up { color: #86efac; }
.rp-m b.down { color: #fca5a5; }

.sf-tag {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 1px;
  vertical-align: 1px;
}
.sf-tag.up {
  color: #86efac;
  background: rgba(22, 101, 52, 0.35);
  border: 1px solid rgba(134, 239, 172, 0.35);
}
.sf-tag.down {
  color: #fca5a5;
  background: rgba(127, 29, 29, 0.35);
  border: 1px solid rgba(252, 165, 165, 0.35);
}
.sf-row .bal.up { color: #86efac; }
.sf-row .bal.down { color: #fca5a5; }
</style>
