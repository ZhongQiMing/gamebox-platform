<template>
  <div class="gs-page">
    <PageHeader title="总代结算">
      <template #extra>
        <el-select
          v-if="canPickGeneral"
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
          <el-radio-button label="last">上一期</el-radio-button>
          <el-radio-button label="current">本期</el-radio-button>
        </el-radio-group>
        <el-button :loading="loading" @click="reload">刷新</el-button>
      </template>
    </PageHeader>

    <el-alert
      v-if="!loading && !stmt"
      type="info"
      :closable="false"
      show-icon
      title="还没有总代，或该总代名下暂无房间"
    />

    <template v-if="stmt">
      <!-- 第一行：总代跟平台的账 -->
      <section class="gs-head" :class="payTone">
        <div class="gs-head-main">
          <div class="gs-who">
            <span class="gs-name">{{ stmt.general.nickname }}</span>
            <el-tag size="small" effect="plain" :type="isCredit ? 'warning' : 'success'">
              {{ isCredit ? 'B · 信用盘' : 'A · 现金盘' }}
            </el-tag>
            <span class="gs-meta">占成 {{ pct(stmt.general.shareRate) }}% · {{ stmt.general.settleLabel }}结</span>
          </div>
          <div class="gs-range">
            {{ fmtDay(stmt.period.periodStart) }} ～ {{ fmtDay(stmt.period.periodEnd) }}
            <el-tag
              size="small"
              effect="plain"
              :type="stmt.period.status === 'SETTLED' ? 'success' : 'info'"
            >
              {{ stmt.period.status === 'SETTLED' ? '已结清' : '未结' }}
            </el-tag>
          </div>
        </div>

        <div class="gs-kpis">
          <div class="gs-kpi">
            <span class="k">名下房间</span>
            <b>{{ stmt.totals.roomCount }}</b>
          </div>
          <div class="gs-kpi">
            <span class="k">有效流水</span>
            <b>{{ fmt(stmt.totals.betFlow) }}</b>
          </div>
          <div class="gs-kpi">
            <span class="k">庄家盈亏</span>
            <b :class="tone(stmt.totals.housePnl)">{{ fmt(stmt.totals.housePnl) }}</b>
          </div>
          <div class="gs-kpi">
            <span class="k">总代成数差</span>
            <b :class="tone(stmt.totals.generalShareAmount)">{{ fmt(stmt.totals.generalShareAmount) }}</b>
          </div>
          <div class="gs-kpi main">
            <span class="k">{{ payLabel }}</span>
            <b :class="payTone">{{ fmt(Math.abs(stmt.totals.platformShareAmount)) }}</b>
          </div>
        </div>

        <div v-if="stmt.pendingFromAgents !== 0" class="gs-pending">
          其中 <b>{{ fmt(stmt.pendingFromAgents) }}</b> 还没跟代理结清（下表标「未结」的房），由总代先垫给平台
        </div>

        <div v-if="isCredit" class="gs-credit">
          合同额度 {{ fmt(stmt.general.creditLimit) }} · 当前剩余 {{ fmt(stmt.general.pointsQuota) }}
          <span class="gs-credit-tip">
            结清后按「当前剩余 + 本期已结」补额度，封账之后的输赢自动留到下一期
          </span>
        </div>

        <div v-if="stmt.canSettle && stmt.period.status !== 'SETTLED'" class="gs-actions">
          <el-button type="primary" :loading="settling" @click="doSettle">结清本期</el-button>
        </div>
      </section>

      <!-- 下面每行：总代跟各房代理的账 -->
      <section class="gs-rooms">
        <div class="gs-rooms-hd">名下房间明细（总代与代理之间的账，按各房自己的周期各结各的）</div>
        <el-table :data="stmt.rooms" size="small" empty-text="本期名下没有房间">
          <el-table-column label="房间" min-width="170">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ row.name }}</div>
              <div class="cell-meta">{{ row.roomNo }} · {{ row.bookMode === 'CREDIT' ? '信用' : '现金' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="代理" min-width="140">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ row.agentNickname || '—' }}</div>
              <div class="cell-meta">占成 {{ pct(row.agentShareRate) }}%</div>
            </template>
          </el-table-column>
          <el-table-column label="有效流水" min-width="110" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.betFlow) }}</template>
          </el-table-column>
          <el-table-column label="派彩" min-width="110" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.payout) }}</template>
          </el-table-column>
          <el-table-column label="庄家盈亏" min-width="110" align="right">
            <template #default="{ row }: { row: any }">
              <span :class="tone(row.housePnl)">{{ fmt(row.housePnl) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="代理占成" min-width="110" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.agentShareAmount) }}</template>
          </el-table-column>
          <el-table-column label="总代成数差" min-width="110" align="right">
            <template #default="{ row }: { row: any }">
              <span :class="tone(row.generalShareAmount)">{{ fmt(row.generalShareAmount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="平台应得" min-width="110" align="right">
            <template #default="{ row }: { row: any }">
              <b :class="tone(row.platformShareAmount)">{{ fmt(row.platformShareAmount) }}</b>
            </template>
          </el-table-column>
          <el-table-column label="与代理" min-width="150">
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
          <el-table-column label="" width="72" align="right">
            <template #default="{ row }: { row: any }">
              <el-button link type="primary" @click="goRoom(row.roomId)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section v-if="history.length" class="gs-history">
        <div class="gs-rooms-hd">历史账期</div>
        <el-table :data="history" size="small">
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
          <el-table-column label="总代成数差" min-width="110" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.generalShareAmount) }}</template>
          </el-table-column>
          <el-table-column label="平台应得" min-width="110" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.platformShareAmount) }}</template>
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
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import {
  consoleApi,
  type GeneralSettleHistoryRow,
  type GeneralSettleStatement,
} from '@/api/console'
import { useAdminStore } from '@/stores/admin'

type HistoryRow = GeneralSettleHistoryRow

const store = useAdminStore()
const router = useRouter()

const loading = ref(false)
const settling = ref(false)
const stmt = ref<GeneralSettleStatement | null>(null)
const history = ref<HistoryRow[]>([])
const period = ref<'current' | 'last'>('last')
const generalUserId = ref('')
const generalList = ref<{ id: string; nickname: string; username: string }[]>([])

const canPickGeneral = computed(
  () => store.profile?.role === 'ADMIN' || store.profile?.role === 'BRANCH',
)
const isCredit = computed(() => stmt.value?.general.bookMode === 'CREDIT')
/** 平台应得为正=总代要付平台 */
const payLabel = computed(() => {
  const v = stmt.value?.totals.platformShareAmount ?? 0
  if (v > 0) return '总代应付平台'
  if (v < 0) return '平台应付总代'
  return '互不找补'
})
const payTone = computed(() => {
  const v = stmt.value?.totals.platformShareAmount ?? 0
  if (v > 0) return 'is-in'
  if (v < 0) return 'is-out'
  return ''
})

function fmt(n?: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
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
  router.push({ name: 'room-detail', params: { id } })
}

async function loadGenerals() {
  if (!canPickGeneral.value) return
  try {
    const res = await consoleApi.agents({
      page: 1, pageSize: 200, role: 'GENERAL', boundOnly: false,
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
  const v = stmt.value.totals.platformShareAmount
  const who = v > 0 ? `总代应付平台 ${fmt(v)}` : v < 0 ? `平台应付总代 ${fmt(-v)}` : '互不找补'
  try {
    await ElMessageBox.confirm(
      `确认结清 ${fmtDay(stmt.value.period.periodStart)} ～ ${fmtDay(stmt.value.period.periodEnd)} 这一期？`
      + `\n名下 ${stmt.value.totals.roomCount} 间房，${who}。结清后本期数字定格，不再随后续改档变动。`,
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

onMounted(async () => {
  await loadGenerals()
  await reload()
})
</script>

<style scoped>
.gs-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.gs-head {
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 16px 18px;
  background: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.gs-head.is-in { border-left: 4px solid var(--el-color-success); }
.gs-head.is-out { border-left: 4px solid var(--el-color-danger); }

.gs-head-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.gs-who { display: flex; align-items: center; gap: 10px; }
.gs-name { font-size: 17px; font-weight: 700; }
.gs-meta { color: var(--el-text-color-secondary); font-size: 13px; }
.gs-range { color: var(--el-text-color-secondary); font-size: 13px; display: flex; align-items: center; gap: 8px; }

.gs-kpis {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.gs-kpi {
  min-width: 128px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.gs-kpi .k { font-size: 12px; color: var(--el-text-color-secondary); }
.gs-kpi b { font-size: 17px; }
.gs-kpi.main { background: var(--el-color-primary-light-9); min-width: 160px; }

.gs-pending,
.gs-credit {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
  padding: 8px 10px;
}
.gs-credit-tip { display: block; margin-top: 4px; opacity: 0.85; }
.gs-actions { display: flex; justify-content: flex-end; }

.gs-rooms,
.gs-history {
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--el-bg-color);
}
.gs-rooms-hd {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}
.cell-name { font-weight: 600; }
.cell-meta { font-size: 12px; color: var(--el-text-color-secondary); }
.num-up { color: var(--el-color-success); }
.num-down { color: var(--el-color-danger); }
</style>
