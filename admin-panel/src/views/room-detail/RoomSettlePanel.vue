<template>
  <div class="sp" v-loading="loading">
    <div class="sp-head">
      <div class="sp-head-left">
        <el-radio-group v-model="period" size="small" @change="loadStatement">
          <el-radio-button label="current">本期</el-radio-button>
          <el-radio-button label="last">上期</el-radio-button>
          <el-radio-button v-if="data?.contract.bookMode === 'CREDIT'" label="early">
            提前结账
          </el-radio-button>
        </el-radio-group>
        <template v-if="stmt">
          <span class="sp-range">{{ stmt.period.fromText }} ～ {{ stmt.period.toText }}</span>
          <span v-if="stmt.room.agent" class="sp-agent">{{ stmt.room.agent.nickname }}</span>
          <span class="chip">{{ stmt.room.bookLabel }}</span>
          <span class="chip">代 {{ data?.contract.agentSharePct ?? stmt.room.agentSharePct }}%</span>
          <span class="chip">平 {{ data?.contract.platformSharePct ?? stmt.room.platformSharePct }}%</span>
        </template>
      </div>
      <el-button size="small" :loading="loading" @click="reloadAll">刷新</el-button>
    </div>

    <template v-if="stmt">
      <div class="sp-grid">
        <section v-for="group in infoGroups" :key="group.key" class="bill">
          <div class="bill-hd">{{ group.title }}</div>
          <div
            v-for="row in group.rows"
            :key="row.key"
            class="bill-row"
            :class="rowTone(row)"
          >
            <span class="bill-label">{{ row.label }}</span>
            <span class="bill-amt">{{ fmt(row.amount) }}</span>
          </div>
        </section>

        <!-- 第5格：可连减算式 → 得出第6格实付 -->
        <section class="bill bill--calc">
          <div class="bill-hd">占成</div>
          <div class="bill-row" :class="tone(calc.base)">
            <span class="bill-label">交割基数</span>
            <span class="bill-amt">{{ fmt(calc.base) }}</span>
          </div>
          <div class="bill-row" :class="tone(calc.agentShare)">
            <span class="bill-label">代理份额</span>
            <span class="bill-amt">{{ fmt(calc.agentShare) }}</span>
          </div>
          <div class="bill-row settle-amt">
            <span class="bill-label">{{ calc.balanceLabel }}</span>
            <span class="bill-amt">{{ calc.balanceText }}</span>
          </div>
          <div v-if="calc.fee > 0" class="bill-row settle-amt">
            <span class="bill-label">减：本期月费</span>
            <span class="bill-amt">−{{ fmt(calc.fee) }}</span>
          </div>
          <div class="bill-row bill-row--total">
            <span class="bill-label">实付 · {{ calc.netDir }}</span>
            <span class="bill-amt">{{ fmt(calc.netAbs) }}</span>
          </div>
        </section>

        <section class="bill bill--action" :class="resultTone">
          <div class="bill-hd">交割</div>
          <div class="action-body">
            <div class="action-sum">
              <span class="result-tag">{{ resultTag }}</span>
              <b class="result-amt">{{ fmt(resultAmount) }}</b>
            </div>
            <div class="action-btns">
              <el-button class="act-btn" :loading="exporting" @click="onExport">
                导出对账单
              </el-button>
              <el-button
                v-if="!readonly"
                type="primary"
                class="act-btn"
                :loading="marking"
                :disabled="!canSettle"
                @click="onSettleClick"
              >
                {{ settleBtnText }}
              </el-button>
            </div>
          </div>
        </section>
      </div>

      <section v-if="data?.history?.length" class="hist-sec">
        <div class="bill-hd">结清历史</div>
        <div
          v-for="row in data.history"
          :key="row.weekStart"
          class="hist-row"
        >
          <div class="hist-left">
            <span class="hist-range">{{ row.fromText }} ～ {{ row.toText }}</span>
            <em class="hist-tag" :class="{ ok: row.status === 'SETTLED' }">
              {{ statusLabel(row.status) }}
            </em>
          </div>
          <div class="hist-right">
            <span>代占 {{ fmt(row.agentShareAmount) }}</span>
            <span class="hist-plat">平占 {{ fmt(row.platformShareAmount) }}</span>
            <span v-if="row.bookMode === 'CREDIT'" class="hist-plat">
              实付 {{ fmt(Math.abs(Number(row.settlePay || 0))) }}
              · {{ paymentLabel(row.paymentStatus) }}
            </span>
            <el-button
              v-if="!readonly && row.bookMode === 'CREDIT' && row.paymentStatus === 'UNPAID'"
              size="small"
              type="warning"
              :loading="payingId === row.id"
              @click="onConfirmPay(row)"
            >确认收款</el-button>
          </div>
        </div>
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
  type RoomSettleStatementLine,
  type RoomWeekSettleOverview,
} from '@/api/console'

const props = defineProps<{
  roomId: string
  readonly?: boolean
}>()

const loading = ref(false)
const marking = ref(false)
const exporting = ref(false)
const payingId = ref<string | null>(null)
const data = ref<RoomWeekSettleOverview | null>(null)
const stmt = ref<RoomSettleStatement | null>(null)
const period = ref<'current' | 'last' | 'early'>('current')

const winAmount = computed(() => Number(stmt.value?.settlement.platformToAgent || 0))
const loseAmount = computed(() => Number(stmt.value?.settlement.agentToPlatform || 0))

const resultTone = computed(() => {
  const d = stmt.value?.settlement.netDirection
  if (d === 'PLATFORM_PAYS_AGENT') return 'to-agent'
  if (d === 'AGENT_PAYS_PLATFORM') return 'to-platform'
  return 'even'
})
const resultTag = computed(() => {
  if (resultTone.value === 'to-agent') return '平台应付'
  if (resultTone.value === 'to-platform') return '代理应付'
  return '无需交割'
})
const resultAmount = computed(() => {
  if (resultTone.value === 'to-agent') return winAmount.value
  if (resultTone.value === 'to-platform') return loseAmount.value
  return 0
})

type BillRow = RoomSettleStatementLine
type BillGroup = { key: string; title: string; rows: BillRow[] }

const INFO_GROUPS = ['经营', '上下分', '返水', '信用']

const infoGroups = computed((): BillGroup[] => {
  const s = stmt.value
  if (!s) return []
  const map = new Map<string, BillGroup>()
  for (const line of s.lines || []) {
    if (!INFO_GROUPS.includes(line.group)) continue
    let g = map.get(line.group)
    if (!g) {
      g = { key: line.group, title: line.group, rows: [] }
      map.set(line.group, g)
    }
    g.rows.push(line)
  }
  return INFO_GROUPS.map((name) => map.get(name)).filter(Boolean) as BillGroup[]
})

/** 第5格：占成应付 + 代理余额 − 本期月费 = 实付（与第6格一致） */
const calc = computed(() => {
  const s = stmt.value
  const net = Number(s?.settlement.netAmount ?? 0)
  /** 佣金账户：实付 = 占成应付 + 佣金 − 月费 */
  const pocketLine = (s?.lines || []).find((l) => l.key === 'agentPocket')
  const bal = Number(
    s?.settlement.agentBalanceOffset ?? pocketLine?.amount ?? 0,
  )
  const fee = Number(s?.settlement.monthlyFeePeriod ?? s?.fees?.monthlyFeePeriod ?? 0)
  const dir = (n: number) =>
    n > 1e-9 ? '平台应付' : n < -1e-9 ? '代理应付' : '互不找补'
  const isCreditBook = s?.room.bookMode === 'CREDIT' && s.creditBook
  const balAbs = Math.abs(bal)
  return {
    base: isCreditBook
      ? Number(s!.creditBook!.excess || 0)
      : Number(s?.share?.housePnl ?? s?.ops?.housePnl ?? 0),
    agentShare: Number(s?.share?.agentShareAmount ?? 0),
    balance: bal,
    balanceLabel: bal >= 0 ? '加：佣金账户' : '减：佣金欠款',
    balanceText: bal >= 0 ? `+${fmt(balAbs)}` : `−${fmt(balAbs)}`,
    fee: Math.max(0, fee),
    netAbs: Math.abs(net),
    netDir: dir(net),
  }
})

function tone(n: number) {
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return ''
}

const canSettle = computed(() => {
  if (props.readonly || !data.value) return false
  if (period.value === 'last') return !!data.value.lastWeek.canMarkSettled
  if (period.value === 'early' || period.value === 'current') {
    return !!data.value.canEarlySettle
  }
  return false
})

const settleBtnText = computed(() => {
  if (period.value === 'last') return '确认结账'
  return '提前结账'
})

function fmt(n: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function rowTone(row: BillRow) {
  if (row.kind === 'settle') return 'settle-amt'
  if (row.amount > 0) return 'up'
  if (row.amount < 0) return 'down'
  return ''
}

function statusLabel(s: string) {
  return ({ OPEN: '进行中', CLOSED: '已关账', SETTLED: '已结清' } as Record<string, string>)[s] || s
}

function resultConfirmText() {
  if (resultTone.value === 'to-agent') return `平台应付 ${fmt(winAmount.value)}`
  if (resultTone.value === 'to-platform') return `代理应付 ${fmt(loseAmount.value)}`
  return '互不找补'
}

function paymentLabel(s?: string) {
  return ({ UNPAID: '待收款', PAID: '已收款', EVEN: '互不找补', NONE: '—' } as Record<string, string>)[s || ''] || s || '—'
}

function creditSettleWarn() {
  const isCredit = data.value?.contract.bookMode === 'CREDIT' || stmt.value?.room.bookMode === 'CREDIT'
  if (!isCredit) return ''
  return (
    '\n\n【重要】\n'
    + '1. 结账只校准剩余信用并清零佣金账户，不等于钱已到账\n'
    + '2. 上列实付须线下交割，交割后请在「结清历史」点「确认收款」\n'
    + '3. 佣金账户=飞盘平台付的流水工资，结清后变为 0'
  )
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
      `确认结清上期？\n${resultConfirmText()}\n\n请确认已与代理核对完毕。${creditSettleWarn()}`,
      '确认结账',
      { type: 'warning', confirmButtonText: '确认结账（账本关账）' },
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
      `确认提前结账？将按当前账本轧差并校准额度。\n${resultConfirmText()}${creditSettleWarn()}`,
      '提前结账',
      { type: 'warning', confirmButtonText: '确认结账（账本关账）' },
    )
  } catch {
    return
  }
  marking.value = true
  try {
    await consoleApi.markRoomWeekSettle(props.roomId, { early: true })
    ElMessage.success('已提前结账')
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
  const dir = pay > 0 ? '平台应付代理' : pay < 0 ? '代理应付平台' : '互不找补'
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
  period.value = 'current'
  void reloadAll()
})
onMounted(() => void reloadAll())
</script>

<style scoped>
.sp {
  width: 100%;
  min-width: 0;
}

.sp-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.sp-head-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  min-width: 0;
}
.sp-range, .sp-agent {
  font-size: 12px;
  color: #64748b;
}
.chip {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  background: #f1f5f9;
  border-radius: 999px;
}

.sp-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  align-items: stretch;
}

.bill {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.bill-hd {
  padding: 10px 14px 8px;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  background: #f8fafc;
  border-bottom: 1px solid #f1f5f9;
}
.bill-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-top: 1px solid #f1f5f9;
}
.bill > .bill-row:first-of-type { border-top: none; }
.bill-label {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.bill-amt {
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #0f172a;
  text-align: right;
}
.bill-row.up .bill-amt { color: #16a34a; }
.bill-row.down .bill-amt { color: #ef4444; }
.bill-row.settle-amt .bill-amt { color: #d97706; }
.bill--calc {
  border-color: rgba(14, 165, 233, 0.28);
  box-shadow: inset 3px 0 0 var(--desk-accent, #38bdf8);
}
.bill--calc .bill-hd {
  color: #0369a1;
  background: rgba(14, 165, 233, 0.06);
}
.bill-row--total {
  margin-top: auto;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0 !important;
}
.bill-row--total .bill-label,
.bill-row--total .bill-amt {
  font-weight: 800;
  color: #0f172a;
}

.bill--action.to-agent {
  border-color: rgba(22, 163, 74, 0.28);
  background: linear-gradient(180deg, rgba(22, 163, 74, 0.08), #fff 48%);
}
.bill--action.to-platform {
  border-color: rgba(217, 119, 6, 0.28);
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.1), #fff 48%);
}
.bill--action.even { background: #f8fafc; }
.bill--action .bill-hd {
  background: transparent;
  border-bottom-color: transparent;
}
.bill--action.to-agent .bill-hd { color: #15803d; }
.bill--action.to-platform .bill-hd { color: #b45309; }

.action-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 14px 14px;
}
.action-sum {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.result-tag {
  font-size: 13px;
  font-weight: 700;
}
.bill--action.to-agent .result-tag { color: #15803d; }
.bill--action.to-platform .result-tag { color: #b45309; }
.bill--action.even .result-tag { color: #64748b; }
.result-amt {
  font-size: 28px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.bill--action.to-agent .result-amt { color: #16a34a; }
.bill--action.to-platform .result-amt { color: #d97706; }
.bill--action.even .result-amt { color: #64748b; }
.action-btns {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.act-btn {
  width: 100%;
  margin: 0 !important;
  font-weight: 650;
}

.hist-sec {
  margin-top: 18px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}
.hist-sec .bill-hd { border-bottom: 1px solid #f1f5f9; }
.hist-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 16px;
  border-top: 1px solid #f1f5f9;
}
.hist-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.hist-range {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.hist-tag {
  display: inline-block;
  padding: 0 6px;
  font-style: normal;
  font-size: 10px;
  font-weight: 650;
  color: #64748b;
  background: #f1f5f9;
  border-radius: 3px;
  line-height: 18px;
}
.hist-tag.ok { color: #15803d; background: rgba(22, 163, 74, 0.12); }
.hist-right {
  display: flex;
  gap: 14px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #475569;
}
.hist-plat { color: #94a3b8; }

.empty-box {
  padding: 48px 16px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  background: #fff;
  border: 1px dashed #e2e8f0;
  border-radius: 12px;
}

@media (max-width: 1200px) {
  .sp-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .sp-grid { grid-template-columns: 1fr; }
  .result-amt { font-size: 24px; }
}
</style>
