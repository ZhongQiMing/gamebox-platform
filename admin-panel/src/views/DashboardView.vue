<template>
  <div class="ops-page" v-loading="loading">
    <PageHeader title="工作台" :subtitle="rangeText ? `今日 ${rangeText}` : '今日经营概览'">
      <template #actions>
        <el-button @click="load">刷新</el-button>
        <template v-if="isAgent">
          <el-button type="primary" @click="$router.push('/players')">玩家上下分</el-button>
          <el-button v-if="canReview" type="warning" @click="$router.push('/recharge')">
            去审核{{ pendingTotal ? ` (${pendingTotal})` : '' }}
          </el-button>
          <el-button @click="$router.push('/rooms')">房间中心</el-button>
        </template>
        <template v-else-if="isAdmin">
          <el-button type="primary" @click="$router.push('/rooms')">房间中心</el-button>
          <el-button type="danger" plain @click="$router.push('/risk')">
            风控{{ riskUnhandled ? ` (${riskUnhandled})` : '' }}
          </el-button>
          <el-button @click="$router.push('/control')">控奖</el-button>
          <el-button @click="$router.push('/agents')">账号中心</el-button>
          <el-button @click="$router.push('/games')">游戏管理</el-button>
        </template>
        <template v-else>
          <el-button type="primary" @click="$router.push('/rooms')">房间中心</el-button>
          <el-button v-if="isBranch" type="danger" plain @click="$router.push('/risk')">
            风控{{ riskUnhandled ? ` (${riskUnhandled})` : '' }}
          </el-button>
        </template>
      </template>
    </PageHeader>

    <el-alert
      v-if="loadError"
      type="error"
      show-icon
      :closable="false"
      class="mb"
      :title="`工作台加载失败：${loadError}`"
    >
      <el-button size="small" type="danger" style="margin-top:8px" @click="load">重试</el-button>
    </el-alert>

    <!-- 超管 / 房主：今日必办 -->
    <div v-if="(isAdmin || isBranch) && !loadError" class="todo-row mb">
      <button
        type="button"
        class="todo-card"
        :class="{ danger: riskUnhandled > 0 }"
        @click="$router.push('/risk')"
      >
        <div class="todo-k">未处理风控</div>
        <div class="todo-v">{{ riskUnhandled }}</div>
        <div class="todo-h">含严重 {{ riskCritical }} · 点进处理</div>
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="todo-card"
        :class="{ warn: controlActive > 0 }"
        @click="$router.push('/control')"
      >
        <div class="todo-k">生效中控奖</div>
        <div class="todo-v">{{ controlActive }}</div>
        <div class="todo-h">已启用 {{ controlEnabled }} · 点进管理</div>
      </button>
      <button type="button" class="todo-card" @click="$router.push('/rooms')">
        <div class="todo-k">代理房间</div>
        <div class="todo-v">{{ s?.agentRoomCount ?? s?.roomCount ?? '—' }}</div>
        <div class="todo-h">今日活跃 {{ s?.activePlayers ?? '—' }} 人</div>
      </button>
      <button
        v-if="isAdmin"
        type="button"
        class="todo-card"
        @click="$router.push('/agents')"
      >
        <div class="todo-k">账号中心</div>
        <div class="todo-v">→</div>
        <div class="todo-h">房主 / 查找代理进房间</div>
      </button>
    </div>

    <div class="ops-kpi-row">
      <div v-for="k in row1" :key="k.label" class="ops-kpi">
        <div class="ops-kpi__label">{{ k.label }}</div>
        <div class="ops-kpi__value" :style="{ color: k.color }">{{ k.value }}</div>
      </div>
    </div>

    <div class="ops-kpi-row">
      <div v-for="k in row2" :key="k.label" class="ops-kpi">
        <div class="ops-kpi__label">{{ k.label }}</div>
        <div class="ops-kpi__value" :style="{ color: k.color }">{{ k.value }}</div>
      </div>
    </div>

    <div v-if="isAgent" class="ops-kpi-row">
      <div v-for="k in agentWallet" :key="k.label" class="ops-kpi">
        <div class="ops-kpi__label">{{ k.label }}</div>
        <div class="ops-kpi__value" :style="{ color: k.color }">{{ k.value }}</div>
      </div>
    </div>

    <el-card v-if="isAgent" shadow="never" class="mb">
      <template #header><span>待审申请</span></template>
      <el-descriptions :column="4" border size="small">
        <el-descriptions-item label="待审上分">
          <el-badge :value="s?.pendingUp ?? 0" :type="(s?.pendingUp ?? 0) > 0 ? 'danger' : 'info'" />
        </el-descriptions-item>
        <el-descriptions-item label="待审下分">
          <el-badge :value="s?.pendingDown ?? 0" :type="(s?.pendingDown ?? 0) > 0 ? 'warning' : 'info'" />
        </el-descriptions-item>
        <el-descriptions-item label="操作">
          <el-button type="primary" size="small" @click="$router.push('/recharge')">进入审核</el-button>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 超管：近 7 日趋势 -->
    <el-card v-if="isAdmin && trend.length" shadow="never" class="mb">
      <template #header>
        <div class="card-head">
          <span>近 7 日流水 / 盈亏</span>
          <span class="ops-muted">平台账本口径</span>
        </div>
      </template>
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
    </el-card>

    <el-row :gutter="14">
      <el-col :md="14">
        <el-card shadow="never">
          <template #header><span>今日游戏流水 TOP</span></template>
          <el-table :data="byGame" size="small" stripe empty-text="今日暂无注单">
            <el-table-column label="游戏" width="140">
              <template #default="{ row }">{{ row.gameName || row.gameCode }}</template>
            </el-table-column>
            <el-table-column prop="betCount" label="注单" width="80" />
            <el-table-column label="流水" min-width="110">
              <template #default="{ row }">{{ fmt(row.betFlow) }}</template>
            </el-table-column>
            <el-table-column label="派彩" min-width="110">
              <template #default="{ row }">{{ fmt(row.payout) }}</template>
            </el-table-column>
            <el-table-column label="庄家盈亏" min-width="110">
              <template #default="{ row }">
                <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :md="10">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <span>最近操作</span>
              <el-button link type="primary" @click="$router.push('/logs')">全部日志</el-button>
            </div>
          </template>
          <el-timeline v-if="logs.length">
            <el-timeline-item
              v-for="l in logs"
              :key="l.id"
              :timestamp="fmtTime(l.createdAt)"
              placement="top"
            >
              <div class="log-line">
                <b>{{ l.operator }}</b>
                <span class="ops-muted"> {{ actionLabel(l.action) }}</span>
                <span v-if="l.target" class="ops-muted"> · {{ shortTarget(l.target) }}</span>
              </div>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else description="暂无操作记录" :image-size="64" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import { consoleApi, type DashboardData, type ReportSummary } from '@/api/console'
import { dashboardApi, riskApi, type TrendPoint } from '@/api/admin'
import { useAdminStore } from '@/stores/admin'

const ACTION_ZH: Record<string, string> = {
  QUOTA_SELL: '出售额度',
  QUOTA_RECALL: '回收额度',
  CONSOLE_CREDIT: '玩家上分',
  CONSOLE_DEBIT: '玩家下分',
  GAME_STATUS_CHANGE: '游戏状态变更',
  GAME_DAY_CUT: '游戏日切',
  GAME_REORDER: '调整游戏排序',
  GAME_BASICS_UPDATE: '游戏基础信息',
  ROOM_CREATE: '创建房间',
  ROOM_STATUS: '房间状态变更',
  REBATE_POLICY: '回水规则',
  RISK_EVENT_HANDLE: '处理风控',
  RECHARGE_APPROVE: '通过上下分',
  RECHARGE_REJECT: '拒绝上下分',
}

const store = useAdminStore()
const loading = ref(false)
const loadError = ref('')
const data = ref<DashboardData | null>(null)
const wallet = ref<Awaited<ReturnType<typeof consoleApi.walletMe>> | null>(null)
const trend = ref<TrendPoint[]>([])
const riskUnhandled = ref(0)
const riskCritical = ref(0)
const controlActive = ref(0)
const controlEnabled = ref(0)

const s = computed(() => data.value?.summary as ReportSummary | undefined)
const cash = computed(() => data.value?.cashflow)
const byGame = computed(() => data.value?.byGame ?? [])
const logs = computed(() => data.value?.recentLogs ?? [])
const canReview = computed(() => {
  const r = store.profile?.role
  return r === 'AGENT' || r === 'PROXY' || !!data.value?.canReviewRecharge
})
const isAgent = computed(() => {
  const r = store.profile?.role
  return r === 'AGENT' || r === 'PROXY'
})
const isAdmin = computed(() => store.profile?.role === 'ADMIN')
const isBranch = computed(() => store.profile?.role === 'BRANCH')
const pendingTotal = computed(() => (s.value?.pendingUp ?? 0) + (s.value?.pendingDown ?? 0))

const maxTrendFlow = computed(() => Math.max(1, ...trend.value.map((t) => Number(t.betFlow) || 0)))
const maxTrendPnl = computed(() => Math.max(1, ...trend.value.map((t) => Math.abs(Number(t.pnl) || 0))))

const rangeText = computed(() => {
  const r = s.value?.range
  if (!r?.from) return ''
  const d = new Date(r.from)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

function fmt(n?: number | null) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function pnlColor(n?: number | null) {
  if (n == null) return '#606266'
  return n >= 0 ? '#67c23a' : '#f56c6c'
}
function barPct(v: number, max: number) {
  const p = Math.min(100, Math.round((Math.max(0, v) / max) * 100))
  return `${Math.max(p, v > 0 ? 4 : 0)}%`
}
function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function actionLabel(a: string) {
  return ACTION_ZH[a] || a
}
function shortTarget(t: string) {
  if (!t) return ''
  if (t.includes(',')) return t.split(',').slice(0, 3).join('、') + (t.split(',').length > 3 ? '…' : '')
  return t.length > 18 ? `${t.slice(0, 10)}…` : t
}

const row1 = computed(() => {
  if (isAgent.value) {
    return [
      { label: '今日流水', value: fmt(s.value?.betFlow), color: '#9b59b6' },
      { label: '上分', value: fmt(s.value?.upAmount), color: '#d4a93c' },
      { label: '下分', value: fmt(s.value?.downAmount), color: '#f56c6c' },
      { label: '本组玩家积分', value: fmt(wallet.value?.playerPointsTotal), color: '#606266' },
      { label: '今日活跃', value: String(s.value?.activePlayers ?? '—'), color: '#409eff' },
      { label: '注单数', value: String(s.value?.betCount ?? '—'), color: '#909399' },
    ]
  }
  return [
    { label: '代理房间', value: String(s.value?.agentRoomCount ?? s.value?.roomCount ?? '—'), color: '#409eff' },
    { label: '玩家总数', value: String(s.value?.playerCount ?? '—'), color: '#606266' },
    { label: '玩家余额', value: fmt(cash.value?.playerBalance), color: '#909399' },
    { label: '今日流水', value: fmt(s.value?.betFlow), color: '#9b59b6' },
    { label: '上分', value: fmt(s.value?.upAmount), color: '#d4a93c' },
    { label: '下分', value: fmt(s.value?.downAmount), color: '#f56c6c' },
  ]
})

const row2 = computed(() => {
  if (isAgent.value) {
    return [
      { label: '庄家盈亏', value: fmt(s.value?.housePnl), color: pnlColor(s.value?.housePnl) },
      { label: '玩家盈亏', value: fmt(s.value?.playerPnl), color: pnlColor(s.value?.playerPnl) },
      { label: '派彩', value: fmt(s.value?.payout), color: '#409eff' },
      { label: '代理佣金', value: fmt(s.value?.commissionAmount), color: '#e6a23c' },
      { label: '今日活跃', value: String(s.value?.activePlayers ?? '—'), color: '#409eff' },
      {
        label: '待审笔数',
        value: String(pendingTotal.value),
        color: pendingTotal.value > 0 ? '#f56c6c' : '#909399',
      },
    ]
  }
  return [
    { label: '庄家盈亏', value: fmt(s.value?.housePnl), color: pnlColor(s.value?.housePnl) },
    { label: '玩家盈亏', value: fmt(s.value?.playerPnl), color: pnlColor(s.value?.playerPnl) },
    { label: '派彩', value: fmt(s.value?.payout), color: '#409eff' },
    { label: '代理佣金', value: fmt(s.value?.commissionAmount), color: '#e6a23c' },
    { label: '今日活跃', value: String(s.value?.activePlayers ?? '—'), color: '#409eff' },
    { label: '注单数', value: String(s.value?.betCount ?? '—'), color: '#909399' },
  ]
})

const agentWallet = computed(() => [
  { label: '账户余额', value: fmt(wallet.value?.balance), color: '#d4a93c' },
  { label: '真分库存', value: fmt(wallet.value?.pointsQuota), color: '#409eff' },
  { label: '飞盘覆盖', value: fmt(wallet.value?.flyCover), color: '#9b59b6' },
  { label: '假分暴露', value: fmt(wallet.value?.fakeExposure), color: '#e6a23c' },
])

async function loadAdminExtras() {
  if (!isAdmin.value && !isBranch.value) return
  const tasks: Promise<void>[] = []
  tasks.push(
    riskApi.summary().then((r) => {
      riskUnhandled.value = r.unhandled ?? 0
      riskCritical.value = r.critical ?? 0
    }).catch(() => {
      riskUnhandled.value = 0
      riskCritical.value = 0
    }),
  )
  if (isAdmin.value) {
    tasks.push(
      consoleApi.controlList().then((list) => {
        const rows = list || []
        controlEnabled.value = rows.filter((r) => r.status === 'ACTIVE').length
        controlActive.value = rows.filter((r) => r.effective).length
      }).catch(() => {
        controlActive.value = 0
        controlEnabled.value = 0
      }),
    )
    tasks.push(
      dashboardApi.trend(7).then((t) => {
        trend.value = t || []
      }).catch(() => {
        trend.value = []
      }),
    )
  }
  await Promise.all(tasks)
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [dash, w] = await Promise.all([
      consoleApi.dashboard(),
      consoleApi.walletMe().catch(() => null),
    ])
    data.value = dash
    wallet.value = w
    await loadAdminExtras()
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
.card-head { display: flex; justify-content: space-between; align-items: center; }
.log-line { font-size: 13px; }
.mb { margin-bottom: 14px; }
.ops-muted { color: #909399; font-size: 12px; }

.todo-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.todo-card {
  text-align: left;
  border: 1px solid #e4e7ed;
  background: #fff;
  border-radius: 10px;
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.todo-card:hover {
  border-color: #d4a93c;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
}
.todo-card.danger { border-color: #f56c6c; background: #fff7f7; }
.todo-card.warn { border-color: #e6a23c; background: #fffbf0; }
.todo-k { font-size: 12px; color: #909399; }
.todo-v { font-size: 26px; font-weight: 700; color: #303133; margin: 4px 0; line-height: 1.2; }
.todo-card.danger .todo-v { color: #f56c6c; }
.todo-card.warn .todo-v { color: #e6a23c; }
.todo-h { font-size: 12px; color: #a8abb2; }

.trend-row {
  display: grid;
  grid-template-columns: 48px 1fr minmax(220px, auto);
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f0f2f5;
}
.trend-row:last-child { border-bottom: none; }
.trend-date { font-size: 12px; color: #606266; font-variant-numeric: tabular-nums; }
.trend-bars { display: flex; flex-direction: column; gap: 4px; }
.bar-track {
  height: 8px;
  background: #f0f2f5;
  border-radius: 4px;
  overflow: hidden;
}
.bar { height: 100%; border-radius: 4px; min-width: 0; }
.bar.flow { background: #9b59b6; }
.bar.pnl { background: #67c23a; }
.bar.pnl.neg { background: #f56c6c; }
.trend-nums {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: #606266;
  justify-content: flex-end;
}
@media (max-width: 900px) {
  .trend-row { grid-template-columns: 1fr; }
  .trend-nums { justify-content: flex-start; }
}
</style>
