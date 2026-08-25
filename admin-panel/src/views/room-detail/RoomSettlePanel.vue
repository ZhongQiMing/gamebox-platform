<template>
  <div class="sp" v-loading="loading">
    <div class="panel-toolbar">
      <el-radio-group v-model="period" size="small" @change="loadStatement">
        <el-radio-button label="current">本期</el-radio-button>
        <el-radio-button label="last">上期</el-radio-button>
        <el-radio-button label="early">提前结账</el-radio-button>
      </el-radio-group>
      <span class="toolbar-spacer" />
      <template v-if="!embedded">
        <el-button size="small" :loading="loading" @click="reloadAll">刷新</el-button>
        <el-button size="small" :loading="exporting" @click="onExport">
          {{ hasGeneralShare ? '导出工资表' : '导出对账单' }}
        </el-button>
      </template>
    </div>

    <template v-if="stmt">
      <div class="bill">
        <div class="bill-meta">
          <div class="bill-meta-main">
            <span class="meta-item">
              <em>账期状态</em>
              <el-tag
                size="small"
                effect="plain"
                :type="roomPeriodSettled ? 'success' : 'warning'"
              >
                {{ roomPeriodSettled ? '已结清' : '未结' }}
              </el-tag>
            </span>
            <span class="meta-item">
              <em>占成</em>{{ sharePct }}%
            </span>
            <span v-for="c in metaCells" :key="c.key" class="meta-item">
              <em>{{ c.label }}</em>{{ cellText(c) }}
            </span>
          </div>
          <el-button
            v-if="!readonly && !settleLocked"
            type="primary"
            size="small"
            :loading="marking"
            :disabled="!canSettle"
            @click="onSettleClick"
          >
            {{ settleBtnText }}
          </el-button>
        </div>
        <template v-if="hasGeneralShare">
          <div class="hero-row slip">
            <div v-for="c in generalSlipCells" :key="c.key" class="hero-card">
              <span class="hero-label">{{ c.label }}</span>
              <span class="hero-val" :class="cellTone(c)">{{ cellText(c) }}</span>
            </div>
            <div
              v-for="c in resultCells"
              :key="c.key"
              class="result-card"
              :class="[resultTone, { main: c.emphasis }]"
            >
              <span class="hero-label">{{ c.label }}</span>
              <span class="hero-val" :class="cellTone(c)">{{ cellText(c) }}</span>
            </div>
          </div>
        </template>
        <template v-else>
          <section class="hero-row">
            <div v-for="c in opsCells" :key="c.key" class="hero-card">
              <span class="hero-label">{{ c.label }}</span>
              <span class="hero-val" :class="cellTone(c)">{{ cellText(c) }}</span>
            </div>
          </section>

          <div class="bill-grid">
            <section v-if="wageCells.length" class="bill-card">
              <div class="bill-hd">佣金 · 回水</div>
              <div v-for="c in wageCells" :key="c.key" class="kv">
                <span class="kv-k">{{ c.label }}</span>
                <span class="kv-v" :class="cellTone(c)">{{ cellText(c) }}</span>
              </div>
            </section>
            <section v-if="shareCells.length" class="bill-card">
              <div class="bill-hd">占成</div>
              <div v-for="c in shareCells" :key="c.key" class="kv">
                <span class="kv-k">{{ c.label }}</span>
                <span class="kv-v" :class="cellTone(c)">{{ cellText(c) }}</span>
              </div>
            </section>
            <section v-if="fundCells.length" class="bill-card">
              <div class="bill-hd">上下分</div>
              <div v-for="c in fundCells" :key="c.key" class="kv">
                <span class="kv-k">{{ c.label }}</span>
                <span class="kv-v" :class="cellTone(c)">{{ cellText(c) }}</span>
              </div>
            </section>
            <section v-if="creditCells.length" class="bill-card">
              <div class="bill-hd">信用盘面</div>
              <div v-for="c in creditCells" :key="c.key" class="kv">
                <span class="kv-k">{{ c.label }}</span>
                <span class="kv-v" :class="cellTone(c)">{{ cellText(c) }}</span>
              </div>
            </section>
            <section v-if="otherCells.length" class="bill-card">
              <div class="bill-hd">其他</div>
              <div v-for="c in otherCells" :key="c.key" class="kv">
                <span class="kv-k">{{ c.label }}</span>
                <span class="kv-v" :class="cellTone(c)">{{ cellText(c) }}</span>
              </div>
            </section>
          </div>

          <section class="result-row">
            <div
              v-for="c in resultCells"
              :key="c.key"
              class="result-card"
              :class="[resultTone, { main: c.emphasis }]"
            >
              <span class="hero-label">{{ c.label }}</span>
              <span class="hero-val" :class="cellTone(c)">{{ cellText(c) }}</span>
            </div>
          </section>
        </template>
      </div>

      <section v-if="data?.history?.length" class="settle-sec">
        <div class="settle-sec-hd">结清历史</div>
        <el-table :data="data.history" size="small" border stripe class="settle-table">
          <el-table-column label="账期" min-width="180">
            <template #default="{ row }">
              <div class="cell-name">{{ row.fromText }} ～ {{ row.toText }}</div>
              <div class="cell-meta">{{ statusLabel(row.status) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="代理占成" min-width="110" align="right">
            <template #default="{ row }">{{ fmt(row.agentShareAmount) }}</template>
          </el-table-column>
          <el-table-column v-if="hasGeneralShare" label="成数差" min-width="110" align="right">
            <template #default="{ row }">{{ fmt(row.generalShareAmount || 0) }}</template>
          </el-table-column>
          <el-table-column v-if="!hasGeneralShare" label="平占" min-width="110" align="right">
            <template #default="{ row }">{{ fmt(row.platformShareAmount) }}</template>
          </el-table-column>
          <el-table-column label="实付 / 收款" min-width="180" align="right">
            <template #default="{ row }">
              <b>{{ fmt(Math.abs(Number(row.settlePay || 0))) }}</b>
              <div class="cell-meta">
                {{ row.bookMode === 'CREDIT' ? paymentLabel(row.paymentStatus) : '线下交割' }}
              </div>
            </template>
          </el-table-column>
          <el-table-column label="" width="100" align="right">
            <template #default="{ row }: { row: any }">
              <el-button
                v-if="!readonly && !settleLocked && row.bookMode === 'CREDIT' && row.paymentStatus === 'UNPAID'"
                type="warning"
                link
                :loading="payingId === row.id"
                @click="onConfirmPay(row)"
              >确认收款</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </template>

    <div v-else-if="!loading" class="empty-box">暂无结账数据</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  consoleApi,
  type RoomSettleStatement,
  type RoomWeekSettleOverview,
} from '@/api/console'
import { formatMoney, isGeneralSide } from '@gamebox/shared'
import { useAdminStore } from '@/stores/admin'

const props = defineProps<{
  roomId: string
  readonly?: boolean
  embedded?: boolean
  initialPeriod?: 'current' | 'last' | 'early'
}>()

const store = useAdminStore()
const loading = ref(false)
const marking = ref(false)
const exporting = ref(false)
const payingId = ref<string | null>(null)
const data = ref<RoomWeekSettleOverview | null>(null)
const stmt = ref<RoomSettleStatement | null>(null)
const period = ref<'current' | 'last' | 'early'>(props.initialPeriod || 'current')

const houseParty = computed(() => (stmt.value?.room.generalUserId ? '总代' : '平台'))
const resultTone = computed(() => {
  const d = stmt.value?.settlement.netDirection
  if (d === 'PLATFORM_PAYS_AGENT') return 'to-agent'
  if (d === 'AGENT_PAYS_PLATFORM') return 'to-platform'
  return 'even'
})
const hasGeneralShare = computed(() =>
  (data.value?.history ?? []).some((row) => Number(row.generalShareAmount || 0) !== 0)
    || !!stmt.value?.room.generalUserId,
)

type SlipCell = RoomSettleStatement['sheet']['payslip'][number]

const META_KEYS = new Set(['roomName', 'roomNo', 'agent', 'general', 'book', 'period'])
const OPS_KEYS = new Set(['betFlow', 'payout', 'housePnl'])
const FUND_KEYS = new Set(['upAmount', 'downAmount', 'monthlyFee'])
const WAGE_KEYS = new Set(['wageCount', 'generalWage', 'generalKeep', 'wageAmount', 'playerRebate', 'upline'])
const CREDIT_KEYS = new Set([
  'creditQuota', 'creditPlayers', 'creditCs', 'creditExcess', 'agentPocket',
])
const SHARE_KEYS = new Set(['generalShare', 'agentShare'])
const RESULT_KEYS = new Set(['platformNet', 'generalPnl', 'agentNet'])
/** 总代↔代理：和总表同一套顺序，不列平台 */
const GENERAL_SLIP_KEYS = [
  'betFlow', 'payout', 'housePnl',
  'upAmount', 'downAmount', 'monthlyFee',
  'generalWage', 'generalKeep', 'wageAmount',
  'generalShare', 'agentShare',
  'sharePay', 'creditCommission', 'issueDebtLeft', 'quotaRestore', 'quotaDeduct',
]

function slipOf(...sets: Set<string>[]) {
  const keys = new Set(sets.flatMap((s) => [...s]))
  return (stmt.value?.sheet.payslip ?? []).filter((c) => keys.has(c.key))
}

const metaCells = computed(() => slipOf(META_KEYS))
const opsCells = computed(() => slipOf(OPS_KEYS))
const fundCells = computed(() => slipOf(FUND_KEYS))
const wageCells = computed(() => slipOf(WAGE_KEYS))
const creditCells = computed(() => slipOf(CREDIT_KEYS))
const shareCells = computed(() => slipOf(SHARE_KEYS))
const resultCells = computed(() =>
  slipOf(RESULT_KEYS).filter((c) => !(hasGeneralShare.value && c.key === 'platformNet')),
)
const generalSlipCells = computed(() => {
  const byKey = new Map((stmt.value?.sheet.payslip ?? []).map((c) => [c.key, c]))
  return GENERAL_SLIP_KEYS.map((k) => byKey.get(k)).filter(Boolean) as SlipCell[]
})
const otherCells = computed(() => {
  const known = new Set([
    ...META_KEYS, ...OPS_KEYS, ...FUND_KEYS, ...WAGE_KEYS, ...CREDIT_KEYS, ...SHARE_KEYS, ...RESULT_KEYS,
  ])
  return (stmt.value?.sheet.payslip ?? []).filter((c) => !known.has(c.key))
})

function cellText(c: SlipCell) {
  if (c.kind === 'text') return c.text ?? '—'
  if (c.kind === 'count') return String(c.amount ?? 0)
  return fmt(c.amount ?? 0)
}

/** 金额才分红绿；笔数、房间名这些染色只会干扰 */
function cellTone(c: SlipCell) {
  return c.kind === 'money' ? tone(c.amount ?? 0) : ''
}

function tone(n: number) {
  if (n > 0) return 'num-up'
  if (n < 0) return 'num-down'
  return ''
}

/** 挂了总代的房是总代跟代理结，管理不代清 */
const settleLocked = computed(() => {
  if (!hasGeneralShare.value) return false
  return !isGeneralSide(store.profile?.role, store.profile?.parentRole)
})

const canSettle = computed(() => {
  if (props.readonly || settleLocked.value || !data.value) return false
  if (period.value === 'last') return !!data.value.lastWeek.canMarkSettled
  if (period.value === 'early' || period.value === 'current') {
    return !!data.value.canEarlySettle
  }
  return false
})

const sharePct = computed(() => {
  const fromStmt = stmt.value?.room.agentSharePct
  if (fromStmt != null) return fromStmt
  return data.value?.contract.agentSharePct ?? 0
})

const settleBtnText = computed(() => {
  if (period.value === 'last') return '结清本期'
  return '提前清账'
})

const roomPeriodSettled = computed(() => {
  if (stmt.value?.period?.settled) return true
  if (period.value !== 'last' || !data.value) return false
  return data.value.lastWeek.status === 'SETTLED' || !!data.value.lastWeek.settledAt
})

function fmt(n: number) {
  return formatMoney(n)
}

function statusLabel(s: string) {
  return ({ OPEN: '进行中', CLOSED: '已关账', SETTLED: '已结清' } as Record<string, string>)[s] || s
}

function resultConfirmText() {
  const s = stmt.value?.settlement
  if (resultTone.value === 'to-agent') {
    return `${houseParty.value}应付 ${fmt(Number(s?.platformToAgent || 0))}`
  }
  if (resultTone.value === 'to-platform') {
    return `代理应付 ${fmt(Number(s?.agentToPlatform || 0))}`
  }
  return '互不找补'
}

function paymentLabel(s?: string) {
  return ({ UNPAID: '待收款', PAID: '已收款', EVEN: '互不找补', NONE: '—' } as Record<string, string>)[s || ''] || s || '—'
}

function settleHint() {
  if (resultTone.value === 'even') return ''
  return '线下交清后，到「结清历史」点确认收款。'
}

function settleConfirmHtml(lead: string) {
  return [lead, resultConfirmText(), settleHint()]
    .filter(Boolean)
    .map((t) => `<p style="margin:0 0 8px">${t}</p>`)
    .join('')
}

async function loadOverview() {
  if (!props.roomId) return
  data.value = await consoleApi.roomWeekSettle(props.roomId)
}

async function loadStatement() {
  if (!props.roomId) return
  stmt.value = await consoleApi.roomWeekSettleStatement(props.roomId, {
    period: period.value,
    weekStart: period.value === 'last' ? data.value?.lastWeek.weekStart : undefined,
  })
}

async function reloadAll() {
  loading.value = true
  try {
    await loadOverview()
    await loadStatement()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function onExport() {
  if (!props.roomId) return
  exporting.value = true
  try {
    const res = await consoleApi.exportRoomWeekSettle(props.roomId, {
      period: period.value,
      weekStart: period.value === 'last' ? data.value?.lastWeek.weekStart : undefined,
    })
    const body = res.csv.startsWith('\uFEFF') ? res.csv : `\uFEFF${res.csv}`
    const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = res.filename || '对账单.csv'
    a.click()
    URL.revokeObjectURL(a.href)
    ElMessage.success('对账单已导出')
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '导出失败')
  } finally {
    exporting.value = false
  }
}

async function onSettleClick() {
  if (period.value === 'last') await onMark()
  else await onEarly()
}

async function onMark() {
  if (!data.value) return
  period.value = 'last'
  try {
    await loadStatement()
  } catch { /* ignore */ }
  try {
    await ElMessageBox.confirm(
      settleConfirmHtml('确认结清上期？'),
      '确认清账',
      { type: 'warning', confirmButtonText: '确认清账', dangerouslyUseHTMLString: true },
    )
  } catch {
    return
  }
  marking.value = true
  try {
    await consoleApi.markRoomWeekSettle(props.roomId, {
      weekStart: data.value.lastWeek.weekStart,
    })
    ElMessage.success('已结清')
    await reloadAll()
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '操作失败')
  } finally {
    marking.value = false
  }
}

async function onEarly() {
  if (!data.value) return
  if (period.value !== 'early') period.value = 'early'
  try {
    await loadStatement()
  } catch { /* ignore */ }
  try {
    await ElMessageBox.confirm(
      settleConfirmHtml('确认提前清账？'),
      '提前清账',
      { type: 'warning', confirmButtonText: '确认清账', dangerouslyUseHTMLString: true },
    )
  } catch {
    return
  }
  marking.value = true
  try {
    await consoleApi.markRoomWeekSettle(props.roomId, { early: true })
    ElMessage.success('已提前清账')
    period.value = 'current'
    await reloadAll()
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '操作失败')
  } finally {
    marking.value = false
  }
}

async function onConfirmPay(row: { id: string; settlePay?: number; weekStart: string }) {
  const pay = Number(row.settlePay || 0)
  const dir = pay > 0
    ? `${houseParty.value}应付代理`
    : pay < 0
      ? `代理应付${houseParty.value}`
      : '互不找补'
  try {
    await ElMessageBox.confirm(
      `确认已完成线下交割？\n${dir} ${fmt(Math.abs(pay))}\n确认后标记为「已收款」。`,
      '确认收款',
      { type: 'warning', confirmButtonText: '已收款' },
    )
  } catch {
    return
  }
  payingId.value = row.id
  try {
    await consoleApi.confirmRoomWeekSettlePayment(props.roomId, { settleId: row.id })
    ElMessage.success('已确认收款')
    await reloadAll()
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '操作失败')
  } finally {
    payingId.value = null
  }
}

watch(() => props.roomId, () => {
  period.value = props.initialPeriod || 'current'
  void reloadAll()
})
watch(() => props.initialPeriod, (p) => {
  if (!p || p === period.value) return
  period.value = p
  void loadStatement()
})
onMounted(() => void reloadAll())

defineExpose({ reloadAll, onExport })
</script>

<style scoped>
.sp {
  width: 100%;
  min-width: 0;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

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
.toolbar-spacer { flex: 1; min-width: 8px; }

.bill {
  flex: 1;
  min-width: 0;
  padding: 16px 16px 8px;
  background: #f8fafc;
}
.bill-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  margin-bottom: 14px;
  padding: 10px 14px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.bill-meta-main {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  flex: 1;
  min-width: 0;
}
.meta-item {
  font-size: 13px;
  color: #0f172a;
  font-weight: 650;
}
.meta-item em {
  margin-right: 6px;
  font-style: normal;
  font-weight: 500;
  color: #94a3b8;
}
.sp-alert {
  margin: -6px 0 14px;
  border-radius: 8px;
}
.period-tip {
  margin: -6px 0 14px;
  padding: 8px 14px;
  font-size: 12px;
  line-height: 1.55;
  color: #64748b;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
}
.hero-row,
.result-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.hero-row.slip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.result-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.hero-card,
.result-card {
  padding: 16px 18px 14px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.result-card.main { border-color: #bfdbfe; background: #eff6ff; }
.result-card.to-agent { border-color: #bbf7d0; background: #f0fdf4; }
.result-card.to-platform { border-color: #fde68a; background: #fffbeb; }
.hero-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #64748b;
}
.hero-val {
  display: block;
  font-size: 26px;
  font-weight: 750;
  letter-spacing: -0.02em;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.hero-val.num-up { color: #16a34a; }
.hero-val.num-down { color: #ef4444; }
.bill-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.bill-card {
  padding: 4px 0 8px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}
.bill-hd {
  padding: 10px 16px 8px;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}
.kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
}
.kv + .kv { border-top: 1px solid #f1f5f9; }
.kv-k { font-size: 13px; color: #64748b; }
.kv-v {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.kv-v.num-up { color: #16a34a; }
.kv-v.num-down { color: #ef4444; }

@media (max-width: 900px) {
  .hero-row,
  .bill-grid,
  .result-row { grid-template-columns: 1fr; }
}

.settle-sec { background: #fff; }
.settle-sec-hd {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.settle-table { width: 100%; }
.settle-table :deep(.el-table__header th) {
  color: #475569;
  font-weight: 600;
  background: #f1f5f9 !important;
}
.cell-name { font-weight: 650; }
.cell-meta { margin-top: 2px; font-size: 12px; color: #64748b; }

.empty-box {
  margin: 24px 14px;
  padding: 48px 16px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  background: #fff;
  border: 1px dashed #e2e8f0;
}
</style>
