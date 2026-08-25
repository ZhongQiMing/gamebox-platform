<template>
  <div class="desk-work live-page">
    <div class="desk-panel">
      <PageHeader title="实时开奖">
        <template #actions>
          <span class="clock" title="上海时间">上海 {{ clock }}</span>
          <el-button :loading="loading && !data" @click="load">刷新</el-button>
        </template>
      </PageHeader>

      <el-alert
        v-if="maintActive"
        type="warning"
        show-icon
        :closable="false"
        class="live-maint-alert"
        :title="maintBanner"
      />

      <div class="rooms-summary">
        <div class="sum-chip">
          <span class="sum-label">在线</span>
          <span class="sum-val">{{ onlineCount }}</span>
        </div>
        <div class="sum-chip hot">
          <span class="sum-label">本期投注</span>
          <span class="sum-val">{{ fmt(periodBet) }}</span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">今日投注</span>
          <span class="sum-val">{{ fmt(todayBet) }}</span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">今日盈亏</span>
          <span class="sum-val" :class="pnlClass(todayPnl)">{{ fmtSigned(todayPnl) }}</span>
        </div>
      </div>

      <div class="panel-toolbar">
        <el-radio-group v-model="catFilter" size="small">
          <el-radio-button label="ALL">全部</el-radio-button>
          <el-radio-button label="SLOT">电子</el-radio-button>
          <el-radio-button label="TABLE">牌桌</el-radio-button>
          <el-radio-button label="LOTTERY">彩票</el-radio-button>
          <el-radio-button label="ARCADE">街机</el-radio-button>
        </el-radio-group>
        <span class="toolbar-note">{{ filtered.length }} 个游戏</span>
      </div>

      <div class="panel-body" v-loading="loading && !data">
        <el-alert
          v-if="loadError"
          type="error"
          show-icon
          :closable="false"
          :title="`加载失败：${loadError}`"
          class="live-alert"
        />
        <el-table
          v-else
          :data="filtered"
          class="live-table"
          stripe
          border
          size="small"
          height="100%"
          empty-text="暂无游戏"
          :row-class-name="rowClass"
        >
          <el-table-column label="游戏" min-width="148" fixed>
            <template #default="{ row }: { row: any }">
              <div class="g-name">{{ row.name }}</div>
              <div class="g-code">{{ row.code }}</div>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="78" align="center">
            <template #default="{ row }: { row: any }">
              <el-tag size="small" effect="plain">{{ catLabel(row.category) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="倒计时" width="118" align="center">
            <template #default="{ row }: { row: any }">
              <template v-if="isMaint(row)">
                <div class="maint-tag">维护中</div>
              </template>
              <span v-else-if="isOffline(row)" class="muted">下架</span>
              <span v-else-if="remainOf(row) > 0" class="remain">{{ fmtRemain(remainOf(row)) }}</span>
              <span v-else class="muted">{{ row.phaseLabel || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="本期" min-width="150">
            <template #default="{ row }: { row: any }">
              <span class="issue">{{ row.issueNo || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="上期开奖" min-width="300">
            <template #default="{ row }: { row: any }">
              <DrawNumbers :game-code="row.code" :draw="row.lastDraw" />
              <div v-if="row.lastIssueNo" class="g-code">{{ row.lastIssueNo }}</div>
            </template>
          </el-table-column>
          <el-table-column label="本期投注" width="132" align="right">
            <template #default="{ row }: { row: any }">
              <div class="amt">{{ fmt(row.currentBetAmount) }}</div>
              <div class="g-code">{{ row.currentBetCount }} 注</div>
            </template>
          </el-table-column>
          <el-table-column label="今日投注" width="132" align="right">
            <template #default="{ row }: { row: any }">
              <div class="amt">{{ fmt(row.todayBetAmount) }}</div>
              <div class="g-code">{{ row.todayBetCount }} 注</div>
            </template>
          </el-table-column>
          <el-table-column label="今日派彩" width="120" align="right">
            <template #default="{ row }: { row: any }">
              <span class="amt">{{ fmt(row.todayPayout) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="今日盈亏" width="120" align="right">
            <template #default="{ row }: { row: any }">
              <span class="amt" :class="pnlClass(row.todayBetAmount - row.todayPayout)">
                {{ fmtSigned(row.todayBetAmount - row.todayPayout) }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import DrawNumbers from '@/components/DrawNumbers.vue'
import { formatMoney, formatSignedMoney } from '@gamebox/shared'
import { consoleApi, type LiveDrawGame, type LiveDrawsPayload } from '@/api/console'

const loading = ref(false)
const loadError = ref('')
const data = ref<LiveDrawsPayload | null>(null)
const catFilter = ref('ALL')
const clock = ref('')
const fetchedAt = ref(0)
const nowMs = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null

const games = computed(() => {
  const list = [...(data.value?.games ?? [])]
  list.sort((a, b) => {
    const sa = Number(a.sortOrder ?? 0)
    const sb = Number(b.sortOrder ?? 0)
    if (sa !== sb) return sa - sb
    return a.code.localeCompare(b.code)
  })
  return list
})
const filtered = computed(() => {
  if (catFilter.value === 'ALL') return games.value
  return games.value.filter((g) => g.category === catFilter.value)
})
const onlineCount = computed(() => games.value.filter((g) => g.status === 'ONLINE').length)
const periodBet = computed(() => games.value.reduce((s, g) => s + Number(g.currentBetAmount || 0), 0))
const todayBet = computed(() => games.value.reduce((s, g) => s + Number(g.todayBetAmount || 0), 0))
const todayPayout = computed(() => games.value.reduce((s, g) => s + Number(g.todayPayout || 0), 0))
const todayPnl = computed(() => todayBet.value - todayPayout.value)
const maintActive = computed(() => {
  if (inShanghaiMaintClock() || data.value?.maint?.windowActive) return true
  return games.value.some((g) => g.status === 'MAINTENANCE' || g.phase === 'MAINTENANCE')
})
const maintBanner = computed(() => {
  const win = data.value?.maint?.window || '04:00 至 06:01'
  if (inShanghaiMaintClock() || data.value?.maint?.windowActive) {
    return `每日维护中（上海 ${win}），开奖已暂停`
  }
  return '部分游戏维护中'
})

function shanghaiClockMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(new Date(nowMs.value))
  let h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  if (h === 24) h = 0
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}
function inShanghaiMaintClock() {
  if (data.value?.maint?.disabled) return false
  const mins = shanghaiClockMinutes()
  return mins >= 4 * 60 && mins < 6 * 60 + 1
}
function isOffline(row: LiveDrawGame) {
  return row.status === 'OFFLINE' || row.phase === 'OFFLINE'
}
function isMaint(row: LiveDrawGame) {
  if (isOffline(row)) return false
  return row.status === 'MAINTENANCE'
    || row.phase === 'MAINTENANCE'
    || !!data.value?.maint?.windowActive
    || inShanghaiMaintClock()
}

function fmt(n: number) {
  return formatMoney(n)
}
function fmtSigned(n: number) {
  return formatSignedMoney(n)
}
function remainOf(row: LiveDrawGame) {
  if (isOffline(row) || isMaint(row)) return 0
  const elapsed = Math.max(0, Math.floor((nowMs.value - fetchedAt.value) / 1000))
  return Math.max(0, Math.floor(row.remainSec) - elapsed)
}
function fmtRemain(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`
}
function pnlClass(n: number) {
  if (n > 0) return 'ok'
  if (n < 0) return 'hot'
  return ''
}
function catLabel(c: string) {
  return ({ LOTTERY: '彩票', TABLE: '牌桌', ARCADE: '街机', SLOT: '电子' } as Record<string, string>)[c] || c
}
function rowClass({ row }: { row: LiveDrawGame }) {
  if (isMaint(row)) return 'is-maint'
  if (isOffline(row) || row.status !== 'ONLINE') return 'is-offline'
  return ''
}
async function load() {
  loading.value = true
  try {
    data.value = await consoleApi.liveDraws()
    fetchedAt.value = Date.now()
    nowMs.value = fetchedAt.value
    loadError.value = ''
  } catch (e: unknown) {
    if (!data.value) loadError.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function tickClock() {
  const d = new Date()
  nowMs.value = d.getTime()
  clock.value = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d)
}

function startPoll() {
  if (timer) return
  timer = setInterval(() => { void load() }, 3000)
}
function stopPoll() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
function onVisibility() {
  if (document.visibilityState === 'hidden') {
    stopPoll()
    return
  }
  void load()
  startPoll()
}

onMounted(() => {
  tickClock()
  clockTimer = setInterval(tickClock, 1000)
  void load()
  startPoll()
  document.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => {
  stopPoll()
  if (clockTimer) clearInterval(clockTimer)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<style scoped>
.live-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
  flex-shrink: 0;
}
.clock {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  padding: 0 4px;
}
.live-maint-alert {
  margin: 0;
  border-radius: 0;
  flex-shrink: 0;
}

.rooms-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  flex-shrink: 0;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.sum-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 48px;
  padding: 0 16px;
  border-right: 1px solid #f1f5f9;
}
.sum-chip:last-child { border-right: none; }
.sum-chip.hot { background: #fff7ed; }
.sum-label { font-size: 12px; color: #64748b; white-space: nowrap; }
.sum-val {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.sum-val.ok { color: #16a34a; }
.sum-val.hot { color: #ef4444; }

.panel-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.toolbar-note {
  margin-left: auto;
  font-size: 12px;
  color: #94a3b8;
}

.panel-body {
  flex: 1;
  min-height: 0;
  padding: 0;
  background: #fff;
}
.live-alert { margin: 12px 16px; }
.panel-body :deep(.el-table) {
  --el-table-header-bg-color: #f1f5f9;
  --el-table-row-hover-bg-color: #eff6ff;
}
.panel-body :deep(.el-table th.el-table__cell) {
  color: #475569;
  font-weight: 600;
  background: #f1f5f9 !important;
}
.live-table { width: 100%; }
.live-table :deep(.el-table__cell) { padding: 8px 10px; }
.live-table :deep(.is-offline) { opacity: 0.48; }
.live-table :deep(.is-maint) td {
  background: #fff7ed !important;
}

.maint-tag {
  font-size: 12px;
  font-weight: 700;
  color: #c2410c;
  line-height: 1.2;
}
.remain.maint {
  margin-top: 2px;
  font-size: 12px;
  font-weight: 650;
  color: #ea580c;
}

.g-name { font-weight: 600; color: #0f172a; line-height: 1.3; }
.g-code { margin-top: 2px; font-size: 12px; color: #64748b; }
.issue { font-variant-numeric: tabular-nums; font-size: 13px; }
.remain {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 15px;
  color: #d97706;
}
.amt { font-variant-numeric: tabular-nums; font-weight: 600; color: #0f172a; }
.amt.ok { color: #16a34a; }
.amt.hot { color: #ef4444; }
.muted { color: #94a3b8; }

@media (max-width: 1280px) {
  .rooms-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sum-chip { border-bottom: 1px solid #f1f5f9; }
}
</style>
