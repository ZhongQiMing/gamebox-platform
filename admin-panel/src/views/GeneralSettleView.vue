<template>
  <div class="gs-page" :class="{ embedded }" v-loading="loading">
    <PageHeader v-if="!embedded" title="总代结算">
      <template #extra>
        <div class="gs-tools">
          <el-select
            v-if="canPickGeneral && !props.forcedId"
            v-model="generalUserId"
            placeholder="选择总代"
            filterable
            style="width: 220px"
            @change="reload"
          >
            <el-option
              v-for="g in generalList"
              :key="g.id"
              :label="`${g.nickname}（${g.username}）`"
              :value="g.id"
            />
          </el-select>
          <el-radio-group v-model="period" @change="reload">
            <el-radio-button label="current">本期</el-radio-button>
            <el-radio-button label="last">上期</el-radio-button>
            <el-radio-button label="early">提前结账</el-radio-button>
          </el-radio-group>
          <el-button :loading="loading" @click="reload">刷新</el-button>
          <el-button type="primary" :loading="exporting" @click="onExport">导出工资条</el-button>
        </div>
      </template>
    </PageHeader>

    <el-alert
      v-if="!loading && !stmt"
      type="info"
      :closable="false"
      show-icon
      class="gs-alert"
      title="还没有总代，或该总代名下暂无房间"
    />

    <template v-if="stmt">
      <div class="bill">
        <div class="bill-meta">
          <div class="bill-meta-main">
            <span class="meta-item">
              <em>账期状态</em>
              <el-tag
                size="small"
                effect="plain"
                :type="stmt.period.status === 'SETTLED' ? 'success' : 'warning'"
              >
                {{ stmt.period.status === 'SETTLED' ? '已结清' : '未结' }}
              </el-tag>
            </span>
            <span class="meta-item">
              <em>总代</em>{{ stmt.general.nickname }} / {{ stmt.general.username }}
            </span>
            <span class="meta-item">
              <em>盘口</em>{{ isCredit ? 'B 信用盘' : 'A 现金盘' }}
            </span>
            <span class="meta-item">
              <em>账单时间</em>{{ fmtYmd(stmt.period.periodStart) }} ～ {{ fmtYmd(stmt.period.periodEnd) }}
            </span>
            <span class="meta-item">
              <em>房间数</em>{{ stmt.totals.roomCount }}
            </span>
            <span class="meta-item">
              <em>占成</em>{{ pct(stmt.general.shareRate) }}%
            </span>
          </div>
          <el-button
            v-if="stmt.canSettle && stmt.period.status !== 'SETTLED'"
            type="primary"
            size="small"
            :loading="settling"
            @click="doSettle"
          >{{ settleBtnText }}</el-button>
        </div>
        <div class="hero-row slip">
          <div class="hero-card">
            <span class="hero-label">结账投注额</span>
            <span class="hero-val">{{ fmt(stmt.totals.betFlow) }}</span>
          </div>
          <div class="hero-card">
            <span class="hero-label">派彩</span>
            <span class="hero-val">{{ fmt(stmt.totals.payout) }}</span>
          </div>
          <div class="hero-card">
            <span class="hero-label">庄家盈亏</span>
            <span class="hero-val" :class="tone(stmt.totals.housePnl)">{{ fmt(stmt.totals.housePnl) }}</span>
          </div>
          <div class="hero-card">
            <span class="hero-label">上分</span>
            <span class="hero-val">{{ fmt(stmt.totals.upAmount) }}</span>
          </div>
          <div class="hero-card">
            <span class="hero-label">下分</span>
            <span class="hero-val">{{ fmt(stmt.totals.downAmount) }}</span>
          </div>
          <div class="hero-card">
            <span class="hero-label">房间月费</span>
            <span class="hero-val">{{ fmt(stmt.totals.roomFee) }}</span>
          </div>
          <div class="hero-card">
            <span class="hero-label">整包佣金</span>
            <span class="hero-val" :class="tone(generalPkgGross)">{{ fmt(generalPkgGross) }}</span>
          </div>
          <template v-if="isAdminBill">
            <div class="hero-card">
              <span class="hero-label">总代占成 {{ generalSharePct }}%</span>
              <span class="hero-val" :class="tone(generalShareToPay)">{{ fmt(generalShareToPay) }}</span>
            </div>
            <div class="hero-card">
              <span class="hero-label">平台占成 {{ platformSharePct }}%</span>
              <span class="hero-val" :class="tone(stmt.totals.platformShareAmount)">
                {{ fmt(stmt.totals.platformShareAmount) }}
              </span>
            </div>
          </template>
          <template v-else>
            <div class="hero-card">
              <span class="hero-label">总代佣金</span>
              <span class="hero-val" :class="tone(stmt.totals.generalWageKeep)">
                {{ fmt(stmt.totals.generalWageKeep) }}
              </span>
            </div>
            <div class="hero-card">
              <span class="hero-label">代理佣金</span>
              <span class="hero-val" :class="tone(stmt.totals.agentWageAmount)">
                {{ fmt(stmt.totals.agentWageAmount) }}
              </span>
            </div>
            <div class="hero-card">
              <span class="hero-label">总代占成</span>
              <span class="hero-val" :class="tone(stmt.totals.generalShareAmount)">
                {{ fmt(stmt.totals.generalShareAmount) }}
              </span>
            </div>
            <div class="hero-card">
              <span class="hero-label">代理占成</span>
              <span class="hero-val" :class="tone(stmt.totals.agentShareAmount)">
                {{ fmt(stmt.totals.agentShareAmount) }}
              </span>
            </div>
          </template>
          <template v-if="isCredit">
            <div class="hero-card">
              <span class="hero-label">往来·未结上分</span>
              <span class="hero-val">{{ fmt(stmt.totals.unsettledIssueDebt ?? 0) }}</span>
            </div>
          </template>
          <div class="result-card">
            <span class="hero-label">{{ settlePayWho }}</span>
            <span class="hero-val" :class="tone(-payAmount(stmt.totals))">{{ fmt(settlePayAbs) }}</span>
          </div>
        </div>
      </div>

      <el-alert
        v-if="isCredit"
        type="info"
        :closable="false"
        show-icon
        class="gs-alert"
      >
        <template #title>
          合同额度 {{ fmt(stmt.general.creditLimit) }} · 剩余信用 {{ fmt(stmt.general.pointsQuota) }}
        </template>
      </el-alert>

      <section class="settle-sec">
        <div class="settle-sec-hd">
          <span>名下房间明细</span>
        </div>
        <el-table
          :data="stmt.rooms"
          size="small"
          border
          stripe
          class="settle-table"
          empty-text="本期名下没有房间"
          show-summary
          :summary-method="roomSummary"
        >
          <el-table-column label="房间" min-width="148">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ row.name }}</div>
              <div class="cell-meta">{{ row.roomNo }} · {{ row.bookMode === 'CREDIT' ? '信用' : '现金' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="代理" min-width="122">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ row.agentNickname || '—' }}</div>
              <div class="cell-meta">{{ row.agentUsername || '—' }} · 占成 {{ pct(row.agentShareRate) }}%</div>
            </template>
          </el-table-column>
          <el-table-column prop="betFlow" label="结账投注额" min-width="104" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.betFlow) }}</template>
          </el-table-column>
          <el-table-column prop="payout" label="派彩" min-width="88" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.payout) }}</template>
          </el-table-column>
          <el-table-column prop="housePnl" label="庄家盈亏" min-width="104" align="right">
            <template #default="{ row }: { row: any }">
              <span :class="tone(row.housePnl)">{{ fmt(row.housePnl) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="upAmount" label="上分" min-width="88" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.upAmount) }}</template>
          </el-table-column>
          <el-table-column prop="downAmount" label="下分" min-width="88" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.downAmount) }}</template>
          </el-table-column>
          <el-table-column prop="roomFee" label="月费" min-width="88" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(roomFeeOf(row.roomId)) }}</template>
          </el-table-column>
          <el-table-column label="整包佣金" min-width="104" align="right">
            <template #default="{ row }: { row: any }">
              {{ fmt((row.generalWageAmount || 0) + (row.playerRebate || 0)) }}
            </template>
          </el-table-column>
          <el-table-column prop="generalWageKeep" label="总代佣金" min-width="104" align="right">
            <template #default="{ row }: { row: any }">
              <span :class="tone(row.generalWageKeep)">{{ fmt(row.generalWageKeep) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="agentWageAmount" label="代理佣金" min-width="104" align="right">
            <template #default="{ row }: { row: any }">
              <span :class="tone(row.agentWageAmount)">{{ fmt(row.agentWageAmount) }}</span>
            </template>
          </el-table-column>
          <!-- 与 hero 卡片同一字段，必须同名，不能一处叫「成数差」一处叫「总代占成」 -->
          <el-table-column prop="generalShareAmount" label="总代占成" min-width="104" align="right">
            <template #default="{ row }: { row: any }">
              <span :class="tone(row.generalShareAmount)">{{ fmt(row.generalShareAmount) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="agentShareAmount" label="代理占成" min-width="104" align="right">
            <template #default="{ row }: { row: any }">
              <span :class="tone(row.agentShareAmount)">{{ fmt(row.agentShareAmount) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="payToPlatform" label="与平台" min-width="120" align="right">
            <template #default="{ row }: { row: any }">
              <b :class="tone(row.payToPlatform)">{{ fmt(Math.abs(Number(row.payToPlatform || 0))) }}</b>
              <div class="cell-meta">{{ payWho(Number(row.payToPlatform || 0)) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="与代理" min-width="100" align="center">
            <template #default="{ row }: { row: any }">
              <el-tag
                size="small"
                effect="plain"
                :type="row.agentSettleStatus === 'SETTLED' ? 'success' : 'warning'"
              >
                {{ row.agentSettleStatus === 'SETTLED' ? '已结' : '未结' }}
              </el-tag>
              <div class="cell-meta">{{ row.settleLabel }}结</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="72" align="right" fixed="right">
            <template #default="{ row }: { row: any }">
              <el-button link type="primary" @click="goRoom(row.roomId)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section v-if="history.length" class="settle-sec">
        <div class="settle-sec-hd">历史账期</div>
        <el-table :data="history" size="small" border stripe class="settle-table">
          <el-table-column label="账期" min-width="180">
            <template #default="{ row }: { row: any }">
              {{ fmtDay(row.periodStart) }} ～ {{ fmtDay(row.periodEnd) }}
            </template>
          </el-table-column>
          <el-table-column label="房间数" min-width="80" align="center">
            <template #default="{ row }: { row: any }">{{ row.roomCount }}</template>
          </el-table-column>
          <el-table-column label="庄家盈亏" min-width="110" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.housePnl) }}</template>
          </el-table-column>
          <!-- 合并值，与单列的「总代占成」不是同一个数，必须换名 -->
          <el-table-column v-if="isAdminBill" label="总代侧占成合计" min-width="120" align="right">
            <template #default="{ row }: { row: any }">
              {{ fmt(Number(row.generalShareAmount || 0) + Number(row.agentShareAmount || 0)) }}
            </template>
          </el-table-column>
          <el-table-column v-if="isAdminBill" label="平台占成" min-width="110" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.platformShareAmount) }}</template>
          </el-table-column>
          <el-table-column v-if="!isAdminBill" label="总代占成" min-width="110" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.generalShareAmount) }}</template>
          </el-table-column>
          <el-table-column v-if="!isAdminBill" label="代理占成" min-width="110" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.agentShareAmount) }}</template>
          </el-table-column>
          <el-table-column label="与平台交割" min-width="140" align="right">
            <template #default="{ row }: { row: any }">
              <b :class="tone(row.settlePay)">{{ fmt(Math.abs(Number(row.settlePay || 0))) }}</b>
              <div class="cell-meta">{{ payWho(Number(row.settlePay || 0)) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" min-width="90" align="center">
            <template #default="{ row }: { row: any }">
              <el-tag size="small" effect="plain" :type="row.status === 'SETTLED' ? 'success' : 'info'">
                {{ row.status === 'SETTLED' ? '已结清' : '未结' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="结清时间" min-width="140">
            <template #default="{ row }: { row: any }">{{ fmtTime(row.settledAt) }}</template>
          </el-table-column>
        </el-table>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import {
  consoleApi,
  type GeneralSettleHistoryRow,
  type GeneralSettleStatement,
  type SettlePeriod,
} from '@/api/console'
import { formatMoney } from '@gamebox/shared'
import { useAdminStore } from '@/stores/admin'

const props = defineProps<{
  embedded?: boolean
  forcedId?: string
  period?: SettlePeriod
}>()

type HistoryRow = GeneralSettleHistoryRow

const store = useAdminStore()
const router = useRouter()

const loading = ref(false)
const settling = ref(false)
const exporting = ref(false)
const stmt = ref<GeneralSettleStatement | null>(null)
const history = ref<HistoryRow[]>([])
const period = ref<SettlePeriod>(props.period || 'current')

const settleBtnText = computed(() => (period.value === 'last' ? '结清上期' : '提前清账'))
const generalUserId = ref('')
const generalList = ref<{ id: string; nickname: string; username: string }[]>([])

const canPickGeneral = computed(
  () => store.profile?.role === 'ADMIN' || store.profile?.role === 'BRANCH',
)
/** 管理/总监跟总代结：只看平台↔总代。总代自己看的是拆开的佣金和代理占成。 */
const isAdminBill = computed(() => canPickGeneral.value)
const isCredit = computed(() => stmt.value?.general.bookMode === 'CREDIT')
/** 总代整包佣金 = 实发总代 + 玩家回水 */
const generalPkgGross = computed(() =>
  Number(stmt.value?.totals.generalWageAmount || 0) + Number(stmt.value?.totals.playerRebate || 0),
)
/** 总表跟总代结：下家占成并进总代 */
const generalShareToPay = computed(() =>
  Number(stmt.value?.totals.generalShareAmount || 0) + Number(stmt.value?.totals.agentShareAmount || 0),
)
const generalSharePct = computed(() => pct(stmt.value?.general.shareRate))
const platformSharePct = computed(() =>
  Math.round((1000 - generalSharePct.value * 10)) / 10,
)
/** 交割净额：正=总代应付平台，负=平台应付总代 */
function payAmount(totals?: { payToPlatform?: number; platformShareAmount?: number }) {
  return Number(totals?.payToPlatform ?? totals?.platformShareAmount ?? 0)
}
function payWho(n: number) {
  if (n > 0) return '总代付平台'
  if (n < 0) return '平台付总代'
  return '互不找补'
}
const settlePayAbs = computed(() => Math.abs(payAmount(stmt.value?.totals)))
const settlePayWho = computed(() => `本期交割 · ${payWho(payAmount(stmt.value?.totals))}`)

function fmt(n?: number) {
  return formatMoney(n ?? 0)
}
function pct(n?: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round((v > 1 ? v : v * 100) * 10) / 10
}
function tone(n?: number) {
  const v = Number(n || 0)
  if (v > 0) return 'num-up'
  if (v < 0) return 'num-down'
  return ''
}
function fmtDay(v?: string) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getMonth() + 1}-${d.getDate()}`
}
/* 提前结账的账期不落在整日上，这时要把时分显示出来，否则两段看着是同一天 */
function fmtYmd(v?: string) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const midnight = d.getHours() === 0 && d.getMinutes() === 0
  return midnight ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function fmtTime(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

function goRoom(id: string) {
  if (props.embedded) {
    void router.replace({
      name: 'settle',
      query: {
        roomId: id,
        period: period.value,
        ...(generalUserId.value ? { generalUserId: generalUserId.value } : {}),
      },
    })
    return
  }
  router.push({ name: 'room-detail', params: { id } })
}

function roomFeeOf(roomId: string) {
  const line = stmt.value?.roomFee?.lines?.find((l) => l.roomId === roomId)
  return Number(line?.amount || 0)
}

function roomSummary({ columns }: { columns: Array<{ property?: string }> }) {
  const t = stmt.value?.totals
  return columns.map((col, i) => {
    if (i === 0) return '合计'
    const key = col.property
    if (!t || !key || !(key in t)) return ''
    const v = (t as Record<string, unknown>)[key]
    return typeof v === 'number' ? fmt(v) : ''
  })
}

function downloadCsv(res: { filename: string; csv: string }) {
  const body = res.csv.startsWith('\uFEFF') ? res.csv : `\uFEFF${res.csv}`
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = res.filename || '工资条.csv'
  a.click()
  URL.revokeObjectURL(a.href)
  ElMessage.success('已导出，可用 Excel 打开')
}

async function onExport() {
  exporting.value = true
  try {
    const res = await consoleApi.exportGeneralSettle({
      period: period.value,
      ...(canPickGeneral.value ? { generalUserId: generalUserId.value } : {}),
    })
    downloadCsv(res)
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '导出失败')
  } finally {
    exporting.value = false
  }
}

async function loadGenerals() {
  if (props.forcedId) {
    generalUserId.value = props.forcedId
    return
  }
  if (!canPickGeneral.value) return
  try {
    const res = await consoleApi.agentsAll({
      role: 'GENERAL', boundOnly: false,
    })
    generalList.value = res.list.map((a) => ({
      id: a.id, nickname: a.nickname, username: a.username || '',
    }))
    if (!generalUserId.value && generalList.value.length) {
      generalUserId.value = generalList.value[0].id
    }
  } catch {
    generalList.value = []
  }
}

async function reload() {
  if (canPickGeneral.value && !generalUserId.value) {
    stmt.value = null
    return
  }
  loading.value = true
  try {
    const params = {
      period: period.value,
      ...(canPickGeneral.value ? { generalUserId: generalUserId.value } : {}),
    }
    const [s, h] = await Promise.all([
      consoleApi.generalSettleStatement(params),
      consoleApi
        .generalSettleHistory(canPickGeneral.value ? { generalUserId: generalUserId.value } : {})
        .catch(() => ({ list: [] as HistoryRow[] })),
    ])
    stmt.value = s
    history.value = h.list
  } catch (e: unknown) {
    stmt.value = null
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || '加载失败',
    )
  } finally {
    loading.value = false
  }
}

async function doSettle() {
  if (!stmt.value) return
  const v = payAmount(stmt.value.totals)
  const who = v > 0 ? `总代应付平台 ${fmt(v)}` : v < 0 ? `平台应付总代 ${fmt(-v)}` : '互不找补'
  try {
    await ElMessageBox.confirm(
      `确认${period.value === 'last' ? '结清' : '提前结清'} `
      + `${fmtYmd(stmt.value.period.periodStart)} ～ ${fmtYmd(stmt.value.period.periodEnd)} 这一期？`
      + `\n名下 ${stmt.value.totals.roomCount} 间房，${who}。结清后这一期数字定格，不再随后续改档变动。`,
      '结清总代账期',
      { type: 'warning', confirmButtonText: '确认结清' },
    )
  } catch {
    return
  }
  settling.value = true
  try {
    const res = await consoleApi.settleGeneralPeriod(stmt.value.general.userId, {
      period: period.value,
    }) as { message?: string }
    ElMessage.success(res.message || '已结清')
    /* 结完跳回本期：这里是刚封那一段之后新起的余量，一眼能看出确实结掉了 */
    period.value = 'current'
    await reload()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || '结清失败',
    )
  } finally {
    settling.value = false
  }
}

watch(
  () => props.forcedId,
  async (id) => {
    if (!id) return
    generalUserId.value = id
    await reload()
  },
)
watch(
  () => props.period,
  async (p) => {
    if (!p || p === period.value) return
    period.value = p
    await reload()
  },
)

onMounted(async () => {
  await loadGenerals()
  await reload()
})

defineExpose({ reload })
</script>

<style scoped>
.gs-page {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.gs-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.bill {
  padding: 16px 16px 8px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.bill-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  margin-bottom: 14px;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.bill-meta-main {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
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
.bill-block { margin-bottom: 14px; }
.bill-hd {
  margin-bottom: 8px;
  padding: 0 2px;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
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
}
.hero-row.slip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.hero-row.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.hero-row.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.hero-sub {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #94a3b8;
}
.result-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 8px;
}
.result-row.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.hero-card,
.result-card {
  padding: 16px 18px 14px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.result-card.main {
  border-color: #bfdbfe;
  background: #eff6ff;
}
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

.gs-alert {
  margin: 0;
  border-radius: 0;
  border-left: 0;
  border-right: 0;
}
.gs-alert + .gs-alert { border-top: 0; }

.settle-sec { background: #fff; }
.settle-sec + .settle-sec { border-top: 1px solid #e2e8f0; }
.settle-sec-hd {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.settle-sec-tip { font-size: 12px; font-weight: 600; color: #2563eb; }
.settle-foot {
  padding: 10px 14px 12px;
  font-size: 13px;
  color: #64748b;
  border-top: 1px solid #f1f5f9;
  background: #fff;
}
.settle-foot b {
  font-size: 15px;
  color: #ef4444;
  font-variant-numeric: tabular-nums;
}
.settle-table { width: 100%; }
.settle-table :deep(.el-table__header th) {
  color: #475569;
  font-weight: 600;
  background: #f1f5f9 !important;
}
.cell-name { font-weight: 650; }
.cell-meta { margin-top: 2px; font-size: 12px; color: #64748b; }
.num-up { color: #16a34a; }
.num-down { color: #ef4444; }
</style>
