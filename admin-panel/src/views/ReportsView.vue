<template>
  <div class="ops-page reports" v-loading="loading">
    <PageHeader title="报表中心" subtitle="勾选房间 · 选时间 · 汇总算账">
      <template #actions>
        <el-button :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :loading="exporting" @click="onExport">导出 CSV</el-button>
      </template>
    </PageHeader>

    <!-- 筛选 -->
    <section class="ops-panel filter-card">
      <div class="filter-top">
        <div class="filter-item">
          <span class="filter-label">时间</span>
          <el-radio-group v-model="rangeKey" size="small" @change="onRangePreset">
            <el-radio-button label="today">今日</el-radio-button>
            <el-radio-button label="yesterday">昨日</el-radio-button>
            <el-radio-button label="thisweek">本周</el-radio-button>
            <el-radio-button label="lastweek">上周</el-radio-button>
            <el-radio-button label="thismonth">本月</el-radio-button>
            <el-radio-button label="custom">自定义</el-radio-button>
          </el-radio-group>
        </div>
        <div class="filter-item">
          <span class="filter-label">算账房间</span>
          <el-button size="small" @click="openRoomDlg">
            已选 {{ selectedRoomIds.length }} / {{ rooms.length }} 房 · 点击选择
          </el-button>
        </div>
        <el-button type="primary" size="small" :loading="loading" @click="load">查询</el-button>
      </div>

      <div v-if="rangeKey === 'custom'" class="custom-box">
        <el-date-picker
          v-model="customRange"
          type="datetimerange"
          unlink-panels
          clearable
          :editable="false"
          :shortcuts="customShortcuts"
          :default-time="customDefaultTime"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          format="YYYY-MM-DD HH:mm"
          time-format="HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss+08:00"
          class="custom-picker"
          @change="onCustomRangeChange"
        />
        <span class="tip">上海时间 · 左闭右开</span>
      </div>

      <div class="range-bar" v-if="summary?.range">
        <span>
          统计区间
          <b>{{ summary.range.fromText || formatDt(summary.range.from) }}</b>
          ～
          <b>{{ summary.range.toText || formatDt(summary.range.to) }}</b>
        </span>
        <span class="muted">已选 {{ selectedRoomIds.length }} 房 · 上海时间</span>
      </div>
    </section>

    <el-dialog
      v-model="showRoomDlg"
      title="选择算账房间"
      width="640px"
      append-to-body
      destroy-on-close
    >
      <div class="dlg-room-hd">
        <span>已选 {{ dlgRoomIds.length }} / {{ rooms.length }}</span>
        <div class="dlg-room-actions">
          <el-button link type="primary" @click="dlgSelectAll">全选</el-button>
          <el-button link type="primary" @click="dlgInvert">反选</el-button>
          <el-button link @click="dlgRoomIds = []">清空</el-button>
        </div>
      </div>
      <el-checkbox-group v-model="dlgRoomIds" class="room-checks">
        <el-checkbox
          v-for="r in rooms"
          :key="r.id"
          :value="r.id"
          border
          class="room-check"
        >
          <span class="rc-no">{{ r.roomNo }}</span>
          <span class="rc-name">{{ r.name }}</span>
        </el-checkbox>
      </el-checkbox-group>
      <div v-if="!rooms.length" class="room-empty">暂无可选房间</div>
      <template #footer>
        <el-button @click="showRoomDlg = false">取消</el-button>
        <el-button type="primary" @click="confirmRoomDlg">确定</el-button>
      </template>
    </el-dialog>

    <!-- 输赢 -->
    <section class="block">
      <div class="block-hd">
        <h4>输赢汇总</h4>
        <span class="block-sub">净盈亏 = 庄家盈亏 − 代理佣金</span>
      </div>
      <div class="ov-pnl">
        <div class="kpi hero">
          <div class="kpi-k">净盈亏</div>
          <div class="kpi-v" :style="{ color: pnlColor(netPnl) }">{{ fmt(netPnl) }}</div>
        </div>
        <div class="kpi-row cols-5">
          <div class="kpi" v-for="k in pnlKpis" :key="k.label">
            <div class="kpi-k">{{ k.label }}</div>
            <div class="kpi-v" :style="{ color: k.color || undefined }">{{ k.value }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 活跃 -->
    <section class="block">
      <div class="block-hd">
        <h4>活跃概况</h4>
      </div>
      <div class="kpi-row cols-4">
        <div class="kpi" v-for="k in activeKpis" :key="k.label">
          <div class="kpi-k">{{ k.label }}</div>
          <div class="kpi-v" :style="{ color: k.color || undefined }">{{ k.value }}</div>
        </div>
      </div>
    </section>

    <!-- 分房间 -->
    <section class="block">
      <div class="block-hd">
        <h4>分房间明细</h4>
        <div class="block-tools">
          <el-checkbox v-model="hideIdleRooms">隐藏无数据房间</el-checkbox>
          <span class="block-sub">点击房号进详情</span>
        </div>
      </div>
      <el-table
        :data="displayRoomList"
        stripe
        empty-text="该区间暂无房间数据"
        size="small"
        show-summary
        :summary-method="roomSummary"
      >
        <el-table-column label="房间" min-width="150" fixed>
          <template #default="{ row }">
            <el-button link type="primary" @click="goRoom(row.roomId)">{{ row.roomNo }}</el-button>
            <div class="room-name">{{ row.name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="72">
          <template #default="{ row }">
            <el-tag size="small" :type="roomStatusType(row.status)" effect="plain">
              {{ roomStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="代理" min-width="100">
          <template #default="{ row }">{{ row.agentNickname || row.agentUsername || '—' }}</template>
        </el-table-column>
        <el-table-column label="流水" min-width="108" sortable :sort-method="(a: ReportByRoomRow, b: ReportByRoomRow) => a.betFlow - b.betFlow">
          <template #default="{ row }">{{ fmt(row.betFlow) }}</template>
        </el-table-column>
        <el-table-column label="派彩" min-width="108">
          <template #default="{ row }">{{ fmt(row.payout) }}</template>
        </el-table-column>
        <el-table-column label="庄家盈亏" min-width="108" sortable :sort-method="(a: ReportByRoomRow, b: ReportByRoomRow) => a.housePnl - b.housePnl">
          <template #default="{ row }">
            <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="玩家盈亏" min-width="108">
          <template #default="{ row }">
            <span :style="{ color: pnlColor(row.playerPnl) }">{{ fmt(row.playerPnl) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="代理佣金" min-width="100">
          <template #default="{ row }">
            <span style="color:#e6a23c">{{ fmt(row.commissionAmount) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="净盈亏" min-width="108" sortable :sort-method="(a: ReportByRoomRow, b: ReportByRoomRow) => a.netPnl - b.netPnl">
          <template #default="{ row }">
            <span :style="{ color: pnlColor(row.netPnl) }">{{ fmt(row.netPnl) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="betCount" label="注单" width="80" />
        <el-table-column prop="activePlayers" label="活跃" width="72" />
        <el-table-column prop="memberCount" label="成员" width="72" />
      </el-table>
    </section>

    <!-- 游戏 -->
    <section class="block">
      <div class="block-hd">
        <h4>游戏明细</h4>
        <span class="block-sub">勾选房间合计 · 按流水排序</span>
      </div>
      <el-table
        :data="summary?.byGame || []"
        stripe
        empty-text="该区间暂无注单"
        size="small"
        show-summary
        :summary-method="gameSummary"
      >
        <el-table-column label="游戏" min-width="140">
          <template #default="{ row }">{{ row.gameName || row.gameCode }}</template>
        </el-table-column>
        <el-table-column prop="betCount" label="注单" width="90" />
        <el-table-column label="流水" min-width="120">
          <template #default="{ row }">{{ fmt(row.betFlow) }}</template>
        </el-table-column>
        <el-table-column label="派彩" min-width="120">
          <template #default="{ row }">{{ fmt(row.payout) }}</template>
        </el-table-column>
        <el-table-column label="庄家盈亏" min-width="120">
          <template #default="{ row }">
            <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="玩家盈亏" min-width="120">
          <template #default="{ row }">
            <span :style="{ color: pnlColor(-(row.housePnl || 0)) }">{{ fmt(-(row.housePnl || 0)) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import {
  consoleApi,
  type ConsoleRoom,
  type ReportByRoomRow,
  type ReportSummary,
} from '@/api/console'

const router = useRouter()
const loading = ref(false)
const exporting = ref(false)
const summary = ref<ReportSummary | null>(null)
const byRoomList = ref<ReportByRoomRow[]>([])
const rooms = ref<ConsoleRoom[]>([])
const rangeKey = ref('today')
const selectedRoomIds = ref<string[]>([])
const customRange = ref<[string, string] | null>(null)
const showRoomDlg = ref(false)
const dlgRoomIds = ref<string[]>([])
const hideIdleRooms = ref(false)

const customDefaultTime: [Date, Date] = [
  new Date(2000, 0, 1, 0, 0, 0),
  new Date(2000, 0, 1, 0, 0, 0),
]

const SH_MS = 8 * 3600 * 1000
const DAY_MS = 86400000

function pad2(n: number) {
  return String(n).padStart(2, '0')
}
function toShanghaiOffsetIso(date: Date): string {
  const u = new Date(date.getTime() + SH_MS)
  return `${u.getUTCFullYear()}-${pad2(u.getUTCMonth() + 1)}-${pad2(u.getUTCDate())}T${pad2(u.getUTCHours())}:${pad2(u.getUTCMinutes())}:${pad2(u.getUTCSeconds())}+08:00`
}
function shanghaiDay0(offsetDays = 0): Date {
  const sh = new Date(Date.now() + SH_MS)
  const y = sh.getUTCFullYear()
  const m = sh.getUTCMonth()
  const d = sh.getUTCDate()
  return new Date(Date.UTC(y, m, d) - SH_MS + offsetDays * DAY_MS)
}
function shanghaiBoundPair(fromDayOffset: number, toDayOffset: number): [string, string] {
  return [
    toShanghaiOffsetIso(shanghaiDay0(fromDayOffset)),
    toShanghaiOffsetIso(shanghaiDay0(toDayOffset)),
  ]
}

const customShortcuts = [
  { text: '今日', value: () => [shanghaiDay0(0), shanghaiDay0(1)] },
  { text: '昨日', value: () => [shanghaiDay0(-1), shanghaiDay0(0)] },
  { text: '近 7 天', value: () => [shanghaiDay0(-6), shanghaiDay0(1)] },
  { text: '近 30 天', value: () => [shanghaiDay0(-29), shanghaiDay0(1)] },
  {
    text: '本月',
    value: () => {
      const sh = new Date(Date.now() + SH_MS)
      const month0 = new Date(Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), 1) - SH_MS)
      return [month0, shanghaiDay0(1)]
    },
  },
]

function fmt(n?: number | null) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
}
function pnlColor(n?: number | null) {
  if (n == null) return '#303133'
  return n >= 0 ? '#67c23a' : '#f56c6c'
}
function formatDt(v?: string | null) {
  if (!v) return '—'
  return String(v).replace('T', ' ').slice(0, 19)
}
function roomStatusText(s: string) {
  const map: Record<string, string> = {
    OPEN: '营业',
    MAINTENANCE: '维护',
    FROZEN: '冻结',
    CLOSED: '关闭',
  }
  return map[s] || s || '—'
}
function roomStatusType(s: string) {
  if (s === 'OPEN') return 'success'
  if (s === 'FROZEN') return 'danger'
  if (s === 'MAINTENANCE') return 'warning'
  return 'info'
}

const netPnl = computed(() => {
  if (summary.value?.netPnl != null) return summary.value.netPnl
  const house = summary.value?.housePnl
  const commission = summary.value?.commissionAmount
  if (house == null && commission == null) return null
  return Number(house ?? 0) - Number(commission ?? 0)
})

const pnlKpis = computed(() => [
  { label: '庄家盈亏', value: fmt(summary.value?.housePnl), color: pnlColor(summary.value?.housePnl) },
  { label: '玩家盈亏', value: fmt(summary.value?.playerPnl), color: pnlColor(summary.value?.playerPnl) },
  { label: '流水合计', value: fmt(summary.value?.betFlow) },
  { label: '派彩合计', value: fmt(summary.value?.payout) },
  { label: '代理佣金', value: fmt(summary.value?.commissionAmount), color: '#e6a23c' },
])

const activeKpis = computed((): Array<{ label: string; value: string; color?: string }> => [
  { label: '注单数', value: String(summary.value?.betCount ?? '—') },
  { label: '活跃玩家', value: String(summary.value?.activePlayers ?? '—') },
  { label: '房间成员', value: String(summary.value?.playerCount ?? '—') },
  {
    label: '有流水房间',
    value: String(byRoomList.value.filter((r) => r.betFlow > 0 || r.commissionAmount > 0).length),
  },
])

const displayRoomList = computed(() => {
  if (!hideIdleRooms.value) return byRoomList.value
  return byRoomList.value.filter((r) => r.betCount > 0 || r.commissionAmount > 0)
})

function sumField(list: ReportByRoomRow[], key: keyof ReportByRoomRow) {
  return list.reduce((acc, r) => acc + Number(r[key] || 0), 0)
}

function roomSummary({ columns }: { columns: { property?: string }[] }) {
  const list = displayRoomList.value
  // 列序：房间/状态/代理/流水/派彩/庄家/玩家/佣金/净盈亏/注单/活跃/成员
  const moneyIdx: Record<number, keyof ReportByRoomRow> = {
    3: 'betFlow',
    4: 'payout',
    5: 'housePnl',
    6: 'playerPnl',
    7: 'commissionAmount',
    8: 'netPnl',
    9: 'betCount',
    10: 'activePlayers',
    11: 'memberCount',
  }
  return columns.map((_col, i) => {
    if (i === 0) return '合计'
    const key = moneyIdx[i]
    if (!key) return ''
    const n = sumField(list, key)
    if (key === 'betCount' || key === 'activePlayers' || key === 'memberCount') return String(n)
    return fmt(n)
  })
}

function gameSummary({ columns, data }: { columns: unknown[]; data: ReportSummary['byGame'] }) {
  const list = data || []
  const flow = list.reduce((a, r) => a + Number(r.betFlow || 0), 0)
  const pay = list.reduce((a, r) => a + Number(r.payout || 0), 0)
  const house = list.reduce((a, r) => a + Number(r.housePnl || 0), 0)
  const bets = list.reduce((a, r) => a + Number(r.betCount || 0), 0)
  void columns
  return ['合计', String(bets), fmt(flow), fmt(pay), fmt(house), fmt(-house)]
}

function queryParams() {
  if (!selectedRoomIds.value.length) {
    ElMessage.warning('请至少勾选一个房间')
    return null
  }
  const params: { roomIds: string; range?: string; from?: string; to?: string } = {
    roomIds: selectedRoomIds.value.join(','),
  }
  if (rangeKey.value === 'custom') {
    if (!customRange.value?.[0] || !customRange.value?.[1]) {
      ElMessage.warning('请选择自定义起止时间')
      return null
    }
    params.from = customRange.value[0]
    params.to = customRange.value[1]
  } else {
    params.range = rangeKey.value
  }
  return params
}

function openRoomDlg() {
  dlgRoomIds.value = [...selectedRoomIds.value]
  showRoomDlg.value = true
}
function dlgSelectAll() {
  dlgRoomIds.value = rooms.value.map((r) => r.id)
}
function dlgInvert() {
  const set = new Set(dlgRoomIds.value)
  dlgRoomIds.value = rooms.value.map((r) => r.id).filter((id) => !set.has(id))
}
function confirmRoomDlg() {
  if (!dlgRoomIds.value.length) {
    ElMessage.warning('请至少勾选一个房间')
    return
  }
  selectedRoomIds.value = [...dlgRoomIds.value]
  showRoomDlg.value = false
  load()
}

async function load() {
  const params = queryParams()
  if (!params) return
  loading.value = true
  try {
    const [s, byRoom] = await Promise.all([
      consoleApi.reportSummary(params),
      consoleApi.reportByRoom(params),
    ])
    summary.value = s
    byRoomList.value = byRoom.list
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '加载报表失败',
    )
  } finally {
    loading.value = false
  }
}

function onCustomRangeChange(val: [string, string] | null) {
  if (val?.[0] && val?.[1]) load()
}

function onRangePreset() {
  if (rangeKey.value === 'custom') {
    if (!customRange.value?.[0] || !customRange.value?.[1]) {
      customRange.value = shanghaiBoundPair(0, 1)
    }
  }
  load()
}

function goRoom(id: string) {
  router.push({ name: 'room-detail', params: { id } })
}

async function onExport() {
  const params = queryParams()
  if (!params) return
  exporting.value = true
  try {
    const res = await consoleApi.exportReport(params)
    const body = res.csv.startsWith('\uFEFF') ? res.csv : `\uFEFF${res.csv}`
    const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = res.filename || '报表.csv'
    a.click()
    URL.revokeObjectURL(a.href)
    ElMessage.success('已导出，可用 Excel 打开')
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  try {
    rooms.value = await consoleApi.rooms({ includeClosed: true })
    selectedRoomIds.value = rooms.value.map((r) => r.id)
  } catch {
    rooms.value = []
    selectedRoomIds.value = []
  }
  await load()
})
</script>

<style scoped>
.reports { width: 100%; max-width: none; }
.filter-card { margin-bottom: 14px; }
.filter-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
}
.filter-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.filter-label {
  font-size: 13px;
  color: #909399;
  white-space: nowrap;
}
.custom-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f2f5;
}
.custom-picker {
  flex: 1 1 420px;
  min-width: 300px;
  max-width: 560px;
}
.custom-picker :deep(.el-input__wrapper) { width: 100%; }
.tip { font-size: 12px; color: #909399; }

.dlg-room-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 13px;
  color: #606266;
}
.dlg-room-actions { display: flex; gap: 4px 8px; }
.room-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 360px;
  overflow: auto;
}
.room-check {
  margin: 0 !important;
  height: auto !important;
  padding: 7px 10px !important;
}
.room-check .rc-no {
  font-weight: 600;
  color: #303133;
  margin-right: 6px;
}
.room-check .rc-name {
  color: #909399;
  font-size: 12px;
}
.room-empty { font-size: 13px; color: #c0c4cc; }

.range-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 16px;
  margin-top: 12px;
  padding: 10px 12px;
  background: #fafafa;
  border-radius: 8px;
  font-size: 13px;
  color: #606266;
}
.range-bar b { margin: 0 4px; color: #303133; font-weight: 600; }
.muted { color: #c0c4cc; }

.block {
  margin-bottom: 14px;
  padding: 16px 18px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
}
.block-hd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  margin-bottom: 14px;
}
.block-hd h4 { margin: 0; font-size: 14px; font-weight: 600; color: #303133; }
.block-sub { font-size: 12px; color: #909399; }
.block-tools {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ov-pnl {
  display: grid;
  grid-template-columns: minmax(150px, 200px) minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
}
.kpi-row {
  display: grid;
  gap: 10px;
}
.kpi-row.cols-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.kpi-row.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.kpi {
  min-height: 74px;
  padding: 12px 14px;
  background: #fafafa;
  border: 1px solid #f0f2f5;
  border-radius: 8px;
}
.kpi.hero {
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: linear-gradient(180deg, #fffdf6 0%, #faf6ea 100%);
  border-color: #f0e2b8;
}
.kpi.hero .kpi-v { margin-top: 8px; font-size: 26px; }
.kpi-k { font-size: 12px; color: #909399; }
.kpi-v {
  margin-top: 6px;
  font-size: 17px;
  font-weight: 600;
  color: #303133;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.room-name {
  margin-top: 2px;
  font-size: 12px;
  color: #909399;
}

@media (max-width: 1200px) {
  .ov-pnl { grid-template-columns: 1fr; }
  .kpi-row.cols-5,
  .kpi-row.cols-4 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .kpi-row.cols-5,
  .kpi-row.cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
