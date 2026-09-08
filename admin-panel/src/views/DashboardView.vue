<template>
  <div class="desk-work dash-page" v-loading="loading">
    <div class="desk-panel">
      <PageHeader title="工作台">
        <template #actions>
          <el-button :loading="loading" @click="load">刷新</el-button>
        </template>
      </PageHeader>

      <div class="desk-panel__scroll dash-body">
        <el-alert
          v-if="loadError"
          type="error"
          show-icon
          :closable="false"
          class="dash-alert"
          :title="`工作台加载失败：${loadError}`"
        >
          <el-button size="small" type="danger" style="margin-top:8px" @click="load">重试</el-button>
        </el-alert>

        <!-- 代理 / 子账号：统计条对齐房间中心 sum-chip -->
        <template v-if="isAgent">
          <section class="dash-sec">
            <div class="dash-sec__head">
              <h3 class="dash-sec__title">
                {{ isCreditBook
                  ? (isProxy ? '信用额度（共用主代理）' : '信用额度')
                  : (isProxy ? '额度与账户（共用主代理）' : '额度与账户') }}
              </h3>
              <div class="dash-sec__actions">
                <el-button
                  v-if="!isProxy"
                  type="primary"
                  size="small"
                  @click="$router.push('/recharge')"
                >进入审核</el-button>
                <el-button
                  v-if="!isProxy"
                  size="small"
                  :type="pendingJoin > 0 ? 'warning' : 'default'"
                  @click="goJoinReview"
                >进房审核{{ pendingJoin > 0 ? ` (${pendingJoin})` : '' }}</el-button>
                <el-button
                  v-if="isCreditBook"
                  size="small"
                  plain
                  @click="goOwnRoomSettle"
                >查看对账</el-button>
              </div>
            </div>
            <div class="dash-summary" :style="summaryCols(agentWallet.length)">
              <div
                v-for="k in agentWallet"
                :key="k.label"
                class="sum-chip"
                :class="{ hot: k.hot }"
              >
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color }">{{ k.value }}</span>
              </div>
            </div>
            <p v-if="isCreditBook && creditLow" class="dash-hint warn">
              剩余信用偏低，请联系管理员/房主对账结清后恢复额度。
            </p>
          </section>

          <section class="dash-sec">
            <h3 class="dash-sec__title">待办</h3>
            <!-- 子账号只读查账：不展示无法进入的待审上下分 -->
            <div v-if="isProxy" class="dash-summary cols-1">
              <div class="sum-chip" :class="{ hot: lastWeekPending > 0 }">
                <span class="sum-label">上周待结（只读）</span>
                <span class="sum-val" :class="{ warn: lastWeekPending > 0 }">{{ lastWeekPending }}</span>
              </div>
            </div>
            <div v-else class="dash-summary cols-3">
              <div class="sum-chip" :class="{ hot: (s?.pendingUp ?? 0) > 0 }">
                <span class="sum-label">待审上分</span>
                <span class="sum-val" :class="{ hot: (s?.pendingUp ?? 0) > 0 }">{{ s?.pendingUp ?? 0 }}</span>
              </div>
              <div class="sum-chip" :class="{ hot: (s?.pendingDown ?? 0) > 0 }">
                <span class="sum-label">待审下分</span>
                <span class="sum-val" :class="{ warn: (s?.pendingDown ?? 0) > 0 }">{{ s?.pendingDown ?? 0 }}</span>
              </div>
              <div
                class="sum-chip"
                :class="{ hot: pendingJoin > 0 }"
                style="cursor:pointer"
                @click="goJoinReview"
              >
                <span class="sum-label">待审进房</span>
                <span class="sum-val" :class="{ warn: pendingJoin > 0 }">{{ pendingJoin }}</span>
              </div>
            </div>
          </section>

          <section class="dash-sec">
            <h3 class="dash-sec__title">{{ todayTitle }}</h3>
            <div class="dash-summary" :style="summaryCols(todayCore.length)">
              <div v-for="k in todayCore" :key="k.label" class="sum-chip" :class="{ hot: k.hot }">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section class="dash-sec">
            <h3 class="dash-sec__title">今日上下分</h3>
            <div class="dash-summary" :style="summaryCols(todayFund.length)">
              <div v-for="k in todayFund" :key="k.label" class="sum-chip">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section class="dash-sec">
            <h3 class="dash-sec__title">{{ agentShareTitle }}</h3>
            <div class="dash-summary" :style="summaryCols(agentShareRow.length)">
              <div
                v-for="k in agentShareRow"
                :key="k.label"
                class="sum-chip"
                :class="{ hot: k.hot }"
              >
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color }">{{ k.value }}</span>
              </div>
            </div>
          </section>
        </template>

        <!-- 管理员 / 房主：与代理同一套统计条 -->
        <template v-else>
          <section class="dash-sec">
            <div class="dash-sec__head">
              <h3 class="dash-sec__title">待办</h3>
              <div class="dash-sec__actions">
                <el-button
                  size="small"
                  :type="lastWeekPending > 0 ? 'danger' : 'default'"
                  :disabled="lastWeekPending <= 0"
                  @click="openSettlePending"
                >去结账</el-button>
              </div>
            </div>
            <div
              class="dash-summary cols-1"
              :class="{ hot: lastWeekPending > 0, clickable: lastWeekPending > 0 }"
              role="button"
              tabindex="0"
              @click="openSettlePending"
              @keydown.enter="openSettlePending"
            >
              <div class="sum-chip" :class="{ hot: lastWeekPending > 0 }">
                <span class="sum-label">上周未结账房间</span>
                <span class="sum-val" :class="{ hot: lastWeekPending > 0 }">{{ lastWeekPending }}</span>
              </div>
            </div>
          </section>

          <section class="dash-sec">
            <h3 class="dash-sec__title">{{ todayTitle }}</h3>
            <div class="dash-summary" :style="summaryCols(todayCore.length)">
              <div v-for="k in todayCore" :key="k.label" class="sum-chip" :class="{ hot: k.hot }">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section class="dash-sec">
            <h3 class="dash-sec__title">今日上下分</h3>
            <div class="dash-summary" :style="summaryCols(todayFund.length)">
              <div v-for="k in todayFund" :key="k.label" class="sum-chip">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section class="dash-sec">
            <h3 class="dash-sec__title">盘口概况</h3>
            <div class="dash-summary" :style="summaryCols(landlordMeta.length)">
              <div v-for="k in landlordMeta" :key="k.label" class="sum-chip">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section v-if="trend.length" class="dash-sec">
            <div class="dash-sec__head">
              <h3 class="dash-sec__title">近 7 日流水 / 盈亏</h3>
              <div class="trend-legend">
                <span class="leg flow">流水</span>
                <span class="leg pnl">盈亏+</span>
                <span class="leg pnl-neg">盈亏−</span>
              </div>
            </div>
            <div class="panel-block">
              <div class="trend">
                <div v-for="t in trend" :key="t.date" class="trend-row">
                  <div class="trend-date">{{ t.date.slice(5) }}</div>
                  <div class="trend-bars">
                    <div class="bar-track">
                      <div
                        class="bar flow"
                        :style="{ width: barPct(t.betFlow, maxTrendFlow) }"
                        :title="`流水 ${fmt(t.betFlow)}`"
                      />
                    </div>
                    <div class="bar-track">
                      <div
                        class="bar pnl"
                        :class="{ neg: t.pnl < 0 }"
                        :style="{ width: barPct(Math.abs(t.pnl), maxTrendPnl) }"
                        :title="`盈亏 ${fmt(t.pnl)}`"
                      />
                    </div>
                  </div>
                  <div class="trend-nums">
                    <span>流水 {{ fmt(t.betFlow) }}</span>
                    <span :style="{ color: pnlColor(t.pnl) }">盈亏 {{ fmt(t.pnl) }}</span>
                    <span class="ops-muted">新客 {{ t.newUsers }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </template>

        <!-- 共用：游戏明细 + 最近操作 -->
        <div class="dash-split">
          <section class="dash-sec grow">
            <h3 class="dash-sec__title">今日注单明细（按游戏）</h3>
            <div class="panel-block">
              <el-table :data="byGame" size="small" stripe empty-text="今日暂无注单">
                <el-table-column label="游戏" width="140">
                  <template #default="{ row }">{{ row.gameName || row.gameCode }}</template>
                </el-table-column>
                <el-table-column prop="betCount" label="注单" width="80" />
                <el-table-column label="流水" min-width="110">
                  <template #default="{ row }">{{ fmt(row.betFlow) }}</template>
                </el-table-column>
                <el-table-column label="派彩" min-width="100">
                  <template #default="{ row }">{{ fmt(row.payout) }}</template>
                </el-table-column>
                <el-table-column label="玩家盈亏" min-width="110">
                  <template #default="{ row }">
                    <span :style="{ color: pnlColor(-(row.housePnl ?? 0)) }">{{ fmt(-(row.housePnl ?? 0)) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="庄家盈亏" min-width="110">
                  <template #default="{ row }">
                    <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </section>

          <section class="dash-sec side">
            <div class="dash-sec__head">
              <h3 class="dash-sec__title">最近操作</h3>
              <el-button link type="primary" @click="$router.push('/logs')">全部日志</el-button>
            </div>
            <div class="panel-block logs-panel">
              <el-timeline v-if="logs.length">
                <el-timeline-item
                  v-for="l in logs"
                  :key="l.id"
                  :timestamp="fmtTime(l.createdAt)"
                  placement="top"
                >
                  <div class="log-line">
                    <b>{{ l.operator }}</b>
                    <span class="ops-muted"> {{ l.actionLabel || l.action }}</span>
                    <span v-if="l.target" class="ops-muted"> · {{ shortTarget(l.target) }}</span>
                  </div>
                </el-timeline-item>
              </el-timeline>
              <el-empty v-else description="暂无操作记录" :image-size="56" />
            </div>
          </section>
        </div>
      </div>
    </div>

    <DeskDialog v-model="settlePendingVisible" title="上周未结账房间" width="520px">
      <el-table :data="pendingSettleRooms" size="small" stripe empty-text="暂无待结房间">
        <el-table-column label="房间" min-width="160">
          <template #default="{ row }">
            <div>{{ row.name }}</div>
            <div class="ops-muted">{{ row.roomNo }}</div>
          </template>
        </el-table-column>
        <el-table-column label="盘口" width="100">
          <template #default="{ row }">
            {{ row.bookMode === 'CREDIT' ? 'B · 信用' : 'A · 现金' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="goRoomSettle(row.id)">去结账</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <span class="win-footer-grow" />
        <el-button @click="settlePendingVisible = false">关闭</el-button>
      </template>
    </DeskDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import DeskDialog from '@/components/DeskDialog.vue'
import { consoleApi, type DashboardData, type ReportSummary } from '@/api/console'
import { useAdminStore } from '@/stores/admin'
import { CLOSED_FLOW_COLOR } from '@/utils/labels'
import { formatMoney, formatShanghaiDateTimeShort, isGeneralSide } from '@gamebox/shared'

type TrendPoint = { date: string; betFlow: number; pnl: number; newUsers: number }
type Kpi = { label: string; value: string; color: string; hot?: boolean }

function summaryCols(n: number) {
  const cols = Math.max(1, Math.min(6, n || 1))
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
}

const store = useAdminStore()
const router = useRouter()
const loading = ref(false)
const loadError = ref('')
const data = ref<DashboardData | null>(null)
const wallet = ref<Awaited<ReturnType<typeof consoleApi.walletMe>> | null>(null)
const trend = ref<TrendPoint[]>([])
const settlePendingVisible = ref(false)
const pendingJoin = ref(0)
const joinRoomId = ref<string | null>(null)

const s = computed(() => data.value?.summary as ReportSummary | undefined)
const byGame = computed(() => data.value?.byGame ?? [])
const logs = computed(() => data.value?.recentLogs ?? [])
const isAgent = computed(() => {
  const r = store.profile?.role
  if (isGeneralSide(r, store.profile?.parentRole)) return false
  return r === 'AGENT' || r === 'PROXY'
})
const isAdmin = computed(() => store.profile?.role === 'ADMIN')
const isBranch = computed(() => store.profile?.role === 'BRANCH')
const isLandlord = computed(() => isAdmin.value || isBranch.value)
const isGeneralUser = computed(() => isGeneralSide(store.profile?.role, store.profile?.parentRole))
const isProxy = computed(() =>
  store.profile?.role === 'PROXY' && !isGeneralSide(store.profile?.role, store.profile?.parentRole),
)
const lastWeekPending = computed(() => data.value?.settle?.lastWeekPending ?? 0)
const pendingSettleRooms = computed(() => data.value?.settle?.pendingRooms ?? [])
function openSettlePending() {
  if (lastWeekPending.value <= 0) {
    ElMessage.info('上周房间均已结账')
    return
  }
  const list = pendingSettleRooms.value
  if (list.length === 1) {
    goRoomSettle(list[0].id)
    return
  }
  settlePendingVisible.value = true
}

function goRoomSettle(roomId: string) {
  settlePendingVisible.value = false
  void router.push({ name: 'settle', query: { roomId, period: 'last' } })
}

function goOwnRoomSettle() {
  const rid = joinRoomId.value || wallet.value?.primaryRoomId
  if (rid) {
    void router.push({ path: `/rooms/${rid}`, query: { tab: 'settle' } })
    return
  }
  void router.push({ path: '/rooms' })
}

function goJoinReview() {
  const rid = joinRoomId.value || wallet.value?.primaryRoomId
  if (rid) {
    void router.push({ path: `/rooms/${rid}`, query: { tab: 'join' } })
    return
  }
  void router.push({ path: '/rooms' })
}

const maxTrendFlow = computed(() => Math.max(1, ...trend.value.map((t) => Number(t.betFlow) || 0)))
const maxTrendPnl = computed(() => Math.max(1, ...trend.value.map((t) => Math.abs(Number(t.pnl) || 0))))

function displayFlownFlow(s?: ReportSummary | null) {
  if (isGeneralUser.value) return Number(s?.flownBetFlowLive ?? s?.flownBetFlow ?? 0)
  return Number(s?.agentFlyBetFlowLive ?? s?.agentFlyBetFlow ?? s?.flownBetFlow ?? 0)
}
function stakeFlow(s?: ReportSummary | null) {
  return Number(s?.betFlow || 0) + Number(s?.pendingBetFlow || 0)
}

function fmt(n?: number | null) {
  if (n == null) return '—'
  return formatMoney(n)
}
function pnlColor(n?: number | null) {
  if (n == null) return 'var(--ops-muted)'
  return n >= 0 ? '#16a34a' : '#ef4444'
}
function barPct(v: number, max: number) {
  const p = Math.min(100, Math.round((Math.max(0, v) / max) * 100))
  return `${Math.max(p, v > 0 ? 4 : 0)}%`
}
function fmtTime(iso: string) {
  return formatShanghaiDateTimeShort(iso)
}
function shortTarget(t: string) {
  if (!t) return ''
  if (t.includes(',')) return t.split(',').slice(0, 3).join('、') + (t.split(',').length > 3 ? '…' : '')
  return t.length > 18 ? `${t.slice(0, 10)}…` : t
}

/**
 * 三方共用的今日六格：管理、总代、代理打开工作台看到的格子数、名字、顺序完全一致，
 * 只有取数范围按各自账本不同（后端 summary 已按角色算好，前端不再自己拼）。
 */
const todayCore = computed<Kpi[]>(() => {
  const v = s.value
  return [
    { label: '今日流水', value: fmt(stakeFlow(v)), color: 'var(--desk-accent, #38bdf8)' },
    { label: '飞盘', value: fmt(displayFlownFlow(v)), color: 'var(--desk-accent, #38bdf8)' },
    { label: '关盘', value: fmt(v?.closedBetFlow), color: CLOSED_FLOW_COLOR },
    { label: '庄家盈亏', value: fmt(v?.satHousePnl), color: pnlColor(v?.satHousePnl) },
    {
      label: isLandlord.value ? '平台占成' : '占成盈亏',
      value: fmt(v?.myShareAmount),
      color: pnlColor(v?.myShareAmount),
    },
    {
      label: '今日盈亏',
      value: fmt(v?.myNetEarning),
      color: pnlColor(v?.myNetEarning),
      hot: true,
    },
  ]
})

/** 上下分：管理/总代看额度进出，代理看对玩家的 */
const todayFund = computed<Kpi[]>(() => {
  const q = data.value?.agentQuota
  if (isLandlord.value) {
    return [
      { label: '今日上分', value: fmt(q?.issueAmount), color: 'var(--ops-gold)' },
      { label: '今日下分', value: fmt(q?.recallAmount), color: '#ef4444' },
    ]
  }
  if (isGeneralUser.value) {
    return [
      { label: '给代理上分', value: fmt(q?.issueAmount), color: 'var(--ops-gold)' },
      { label: '收回代理', value: fmt(q?.recallAmount), color: '#ef4444' },
    ]
  }
  return [
    { label: '给玩家上分', value: fmt(s.value?.upAmount), color: 'var(--ops-gold)' },
    { label: '玩家下分', value: fmt(s.value?.downAmount), color: '#ef4444' },
  ]
})

/** 管理员/房主：盘口次级概况 */
const landlordMeta = computed<Kpi[]>(() => [
  { label: '房间数', value: String(data.value?.books?.roomCount ?? s.value?.roomCount ?? '—'), color: '#0f172a' },
  { label: '现金盘', value: String(data.value?.books?.cashRooms ?? '—'), color: '#16a34a' },
  { label: '信用盘', value: String(data.value?.books?.creditRooms ?? '—'), color: 'var(--ops-gold)' },
  { label: '今日活跃', value: String(s.value?.activePlayers ?? '—'), color: '#0f172a' },
  { label: '注单数', value: String(s.value?.betCount ?? '—'), color: '#0f172a' },
])

const isCreditBook = computed(() => wallet.value?.bookMode === 'CREDIT')

const creditLow = computed(() => {
  if (!isCreditBook.value) return false
  const left = Number(
    wallet.value?.creditUnused
    ?? wallet.value?.diskPoolRemaining
    ?? (Number(wallet.value?.pointsQuota ?? 0) + Number(wallet.value?.csBalances ?? 0)),
  )
  const cap = Number(wallet.value?.creditLimit ?? 0)
  if (cap > 0) return left <= cap * 0.05
  return left <= 0
})

const todayTitle = '今日经营'


const agentShareRow = computed<Kpi[]>(() => {
  const sh = data.value?.share
  const pct = sh?.ratePct
  return [
    { label: '占成比例', value: pct == null ? '—' : `${pct}%`, color: 'var(--ops-gold)' },
    { label: '本周结账流水', value: fmt(sh?.weekBetFlow), color: 'var(--desk-accent, #38bdf8)' },
    { label: '本周盈亏', value: fmt(sh?.weekHousePnl), color: pnlColor(sh?.weekHousePnl) },
    { label: '占成盈亏', value: fmt(sh?.weekAgentShare), color: pnlColor(sh?.weekAgentShare) },
    /* 代理看的是「要上缴多少」，不是平台内部那份账 */
    { label: '应上缴上家', value: fmt(sh?.weekPlatformShare), color: pnlColor(sh?.weekPlatformShare) },
    {
      label: '上周未结账',
      value: String(lastWeekPending.value),
      color: lastWeekPending.value > 0 ? '#ef4444' : '#16a34a',
      hot: lastWeekPending.value > 0,
    },
  ]
})

const agentShareTitle = '本周占成'

const agentWallet = computed<Kpi[]>(() => {
  /* 现金/信用同一本盘分，后端已算好 */
  const merged =
    wallet.value?.agentBalance
    ?? (isCreditBook.value
      ? Number(wallet.value?.pointsQuota ?? 0) + Number(wallet.value?.balance ?? 0)
      : Number(wallet.value?.balance ?? 0))
  return [
    {
      label: '代理余额',
      value: fmt(merged),
      color: isCreditBook.value && creditLow.value ? '#ef4444' : 'var(--ops-gold)',
      hot: !!(isCreditBook.value && creditLow.value),
    },
    {
      label: '客服额度',
      value: fmt(wallet.value?.csBalances ?? 0),
      color: 'var(--desk-accent, #38bdf8)',
    },
    {
      label: '上盘可飞',
      value: fmt(wallet.value?.flyCover ?? wallet.value?.flyAvailable),
      color: 'var(--desk-accent, #38bdf8)',
    },
    {
      label: '玩家持分',
      value: fmt(wallet.value?.playerPointsTotal),
      color: '#0f172a',
    },
  ]
})

async function loadAdminExtras() {
  if (!isLandlord.value) return
  try {
    trend.value = (await consoleApi.dashboardTrend(7)) || []
  } catch {
    trend.value = []
  }
}

async function loadJoinPending() {
  if (isProxy.value || !isAgent.value) {
    pendingJoin.value = 0
    joinRoomId.value = null
    return
  }
  try {
    const res = await consoleApi.joinPending()
    const list = res.list || []
    pendingJoin.value = list.length
    joinRoomId.value = list[0]?.roomId || wallet.value?.primaryRoomId || null
  } catch {
    pendingJoin.value = 0
    joinRoomId.value = null
  }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [dash, w] = await Promise.all([
      consoleApi.dashboard(),
      // 仅代理/子账号有个人钱包；管理员/房主走平台池，不拉余额
      isAgent.value ? consoleApi.walletMe().catch(() => null) : Promise.resolve(null),
    ])
    data.value = dash
    wallet.value = w
    await Promise.all([loadAdminExtras(), loadJoinPending()])
  } catch (e: unknown) {
    data.value = null
    trend.value = []
    const msg =
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error)?.message
      || '请检查网络后重试'
    loadError.value = msg
    ElMessage.error(`工作台加载失败：${msg}`)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.dash-page {
  max-width: none;
}
.dash-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 0;
  flex-shrink: 0;
}
.dash-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 8px;
}
.dash-alert { margin-bottom: 0; }
.ops-muted { color: var(--ops-muted); font-size: 12px; }
.log-line { font-size: 13px; color: var(--ops-text); }

.dash-sec { display: flex; flex-direction: column; gap: 10px; }
.dash-sec__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  min-height: 28px;
}
.dash-sec__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dash-sec__title {
  margin: 0;
  padding-left: 10px;
  border-left: 3px solid var(--desk-accent);
  font-size: 14px;
  font-weight: 600;
  color: var(--ops-text);
  line-height: 1.2;
}

/* 代理统计条：对齐房间中心 rooms-summary */
.dash-summary {
  display: grid;
  gap: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.dash-summary.cols-1 { grid-template-columns: 1fr; }
.dash-summary.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.dash-summary.clickable {
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.dash-summary.clickable:hover {
  border-color: rgba(56, 189, 248, 0.45);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.08);
}
.dash-summary.clickable.hot {
  border-color: rgba(239, 68, 68, 0.35);
  background: linear-gradient(90deg, #fff7f7 0%, #ffffff 55%);
}
.dash-summary .sum-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 52px;
  padding: 0 16px;
  border-right: 1px solid #f1f5f9;
}
.dash-summary .sum-chip:last-child { border-right: none; }
.dash-summary .sum-chip.hot { background: #fff7f7; }
.dash-summary .sum-label {
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
}
.dash-summary .sum-val {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.dash-summary .sum-val.ok { color: #16a34a; }
.dash-summary .sum-val.warn { color: #f59e0b; }
.dash-summary .sum-val.hot { color: #ef4444; }

.kpi-grid {
  display: grid;
  gap: 12px;
}
.kpi-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.kpi-grid.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.kpi-grid.cols-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.kpi-grid.cols-6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.dash-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ops-muted);
}
.dash-hint.warn {
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  padding: 8px 12px;
}

.kpi-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 84px;
  padding: 14px 16px;
  background: linear-gradient(180deg, #ffffff 0%, var(--desk-surface-soft) 100%);
  border: 1px solid var(--ops-border);
  border-radius: var(--ops-radius);
  box-shadow: var(--ops-shadow);
  position: relative;
  overflow: hidden;
}
.kpi-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--desk-accent);
  opacity: 0.85;
}
.kpi-card.hero-card { min-height: 104px; }
.kpi-card.meta-card {
  min-height: 72px;
  background: #fff;
  box-shadow: none;
}
.kpi-card.meta-card::before { background: #94a3b8; opacity: 0.55; }

.kpi-card__label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ops-muted);
  line-height: 1.3;
}
.kpi-card__value {
  margin-top: 10px;
  font-size: 22px;
  font-weight: 700;
  color: var(--ops-text);
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  letter-spacing: -0.02em;
}
.kpi-card__value.lg { font-size: 26px; }
.kpi-card__value.sm { font-size: 18px; margin-top: 8px; }

.tip-q {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--ops-border);
  color: #94a3b8;
  font-size: 10px;
  cursor: help;
  line-height: 1;
  flex-shrink: 0;
}

.todo-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  background: #fff;
  border: 1px solid var(--ops-border);
  border-radius: var(--ops-radius);
  overflow: hidden;
  box-shadow: var(--ops-shadow);
}
.todo-bar.landlord-todo {
  grid-template-columns: 1fr auto;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.todo-bar.landlord-todo:hover {
  border-color: rgba(56, 189, 248, 0.45);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.08);
}
.todo-bar.landlord-todo.active {
  border-color: rgba(239, 68, 68, 0.35);
  background: linear-gradient(90deg, #fff7f7 0%, #ffffff 55%);
}
.todo-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  padding: 0 18px;
  border-right: 1px solid var(--ops-border-soft);
}
.todo-cell:last-child { border-right: none; }
.todo-cell.grow {
  justify-content: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.todo-label {
  font-size: 13px;
  color: var(--ops-text-2);
  white-space: nowrap;
}
.todo-num {
  font-size: 20px;
  font-weight: 700;
  color: var(--ops-text);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.todo-num.hot { color: #ef4444; }
.todo-num.warn { color: #d97706; }
.todo-hint {
  font-size: 12px;
  color: var(--ops-muted);
}
.todo-action { justify-content: flex-end; }

.panel-block {
  background: #fff;
  border: 1px solid var(--ops-border);
  border-radius: var(--ops-radius);
  padding: 12px 14px;
  box-shadow: var(--ops-shadow);
}
.logs-panel { min-height: 220px; }

.dash-split {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(280px, 1fr);
  gap: 14px;
  align-items: start;
}
.dash-sec.grow { min-width: 0; }
.dash-sec.side { min-width: 0; }

.trend-legend {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.leg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ops-muted);
}
.leg::before {
  content: '';
  width: 12px;
  height: 6px;
  border-radius: 3px;
}
.leg.flow::before { background: #7c3aed; }
.leg.pnl::before { background: #16a34a; }
.leg.pnl-neg::before { background: #ef4444; }

.trend-row {
  display: grid;
  grid-template-columns: 48px 1fr minmax(220px, auto);
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--ops-border-soft);
}
.trend-row:last-child { border-bottom: none; }
.trend-date {
  font-size: 12px;
  color: var(--ops-text-2);
  font-variant-numeric: tabular-nums;
}
.trend-bars { display: flex; flex-direction: column; gap: 4px; }
.bar-track {
  height: 8px;
  background: #f1f5f9;
  border-radius: 4px;
  overflow: hidden;
}
.bar { height: 100%; border-radius: 4px; min-width: 0; }
.bar.flow { background: #7c3aed; }
.bar.pnl { background: #16a34a; }
.bar.pnl.neg { background: #ef4444; }
.trend-nums {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--ops-text-2);
  justify-content: flex-end;
}

@media (max-width: 1280px) {
  .kpi-grid.cols-6 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .kpi-grid.cols-5 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .dash-summary { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
  .dash-summary .sum-chip:nth-child(3n) { border-right: none; }
  .dash-summary .sum-chip { border-bottom: 1px solid #f1f5f9; }
  .dash-split { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
  .kpi-grid.cols-4,
  .kpi-grid.cols-5,
  .kpi-grid.cols-6 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dash-summary,
  .dash-summary.cols-3 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .dash-summary .sum-chip:nth-child(3n) { border-right: 1px solid #f1f5f9; }
  .dash-summary .sum-chip:nth-child(2n) { border-right: none; }
  .todo-bar { grid-template-columns: 1fr; }
  .todo-bar.landlord-todo { grid-template-columns: 1fr; }
  .todo-cell { border-right: none; border-bottom: 1px solid var(--ops-border-soft); }
  .todo-cell:last-child { border-bottom: none; }
  .trend-row { grid-template-columns: 1fr; }
  .trend-nums { justify-content: flex-start; }
}
</style>
