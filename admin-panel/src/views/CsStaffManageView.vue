<template>
  <div class="desk-work cs-staff-page" v-loading="loading">
    <div class="desk-panel">
      <PageHeader title="客服账号">
        <template #actions>
          <el-button size="small" :loading="loading" @click="reloadAll">刷新</el-button>
        </template>
      </PageHeader>

      <div class="rooms-summary">
        <div class="sum-chip">
          <span class="sum-label">客服人数</span>
          <span class="sum-val">{{ list.length }}</span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">接单中</span>
          <span class="sum-val ok">{{ idleCount }}</span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">客服额度合计</span>
          <span class="sum-val gold">{{ fmt(totalCsBalance) }}</span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">{{ isCreditBook ? '剩余信用' : '我的余额' }}</span>
          <span class="sum-val gold">{{ agentSpendable == null ? '—' : fmt(agentSpendable) }}</span>
        </div>
      </div>

      <div class="panel-toolbar">
        <el-input
          v-model="keyword"
          clearable
          size="small"
          placeholder="搜昵称 / 账号"
          class="filter-search"
        />
        <span class="toolbar-grow" />
        <el-button
          size="small"
          :disabled="!list.length"
          @click="openWeight()"
        >接单占比</el-button>
      </div>

      <div class="panel-body">
        <el-table
          :data="filteredList"
          class="cs-staff-table"
          :empty-text="emptyText"
          stripe
          border
          size="small"
          height="100%"
          table-layout="fixed"
        >
          <el-table-column label="客服" min-width="168">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ row.nickname }}</div>
              <div class="cell-meta mono">{{ row.username }} · {{ row.uid }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" min-width="96" align="center">
            <template #default="{ row }: { row: any }">
              <el-tag
                v-if="row.status === 'DISABLED'"
                size="small"
                type="info"
                effect="plain"
              >停用</el-tag>
              <el-tag
                v-else
                size="small"
                :type="row.workStatus === 'IDLE' ? 'success' : 'info'"
                effect="plain"
              >{{ row.workStatus === 'IDLE' ? '接单中' : '休息' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="余额/额度" min-width="112" align="right">
            <template #default="{ row }: { row: any }">
              <span class="gold">{{ fmt(row.balance) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="佣金占比" min-width="88" align="center">
            <template #default="{ row }: { row: any }">{{ wageLabel(row.wageRate) }}</template>
          </el-table-column>
          <el-table-column label="未结佣金" min-width="108" align="right">
            <template #default="{ row }: { row: any }">
              <span v-if="Number(row.pendingWage || 0) > 0" class="pending-wage">
                {{ fmt(row.pendingWage) }}
                <span class="pending-cnt">{{ row.pendingWageCount || 0 }}笔</span>
              </span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="接单相关" min-width="148" align="center">
            <template #default="{ row }: { row: any }">
              <div class="order-cell">
                <span class="share-pct">{{ sharePct(row) }}%</span>
                <el-switch
                  :model-value="row.workStatus === 'IDLE'"
                  inline-prompt
                  active-text="接单"
                  inactive-text="休息"
                  size="small"
                  :disabled="row.status === 'DISABLED'"
                  :loading="togglingId === row.id"
                  @change="(v: string | number | boolean) => toggleWork(row, !!v)"
                />
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" min-width="240" align="right">
            <template #default="{ row }: { row: any }">
              <div class="ops">
                <el-button link type="primary" @click="openMoney(row, 'up')">划额度</el-button>
                <el-button
                  link
                  type="warning"
                  :disabled="row.balance <= 0"
                  @click="openMoney(row, 'down')"
                >收回</el-button>
                <el-button link @click="openWage(row)">佣金</el-button>
                <el-button
                  v-if="Number(row.pendingWage || 0) > 0"
                  link
                  type="danger"
                  :loading="settlingId === row.id"
                  @click="settleWage(row)"
                >结清佣金</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 划额 / 收回 -->
    <DeskDialog
      v-model="moneyVisible"
      :title="moneyMode === 'up' ? '划额度给客服' : '从客服收回额度'"
      width="480px"
    >
      <div v-if="moneyTarget" class="money-body">
        <div class="who">
          <div class="avatar sm">{{ (moneyTarget.nickname || '?').slice(0, 1) }}</div>
          <div>
            <div class="who-name">{{ moneyTarget.nickname }}</div>
            <div class="who-meta mono">{{ moneyTarget.username }}</div>
            <div class="who-meta">
              {{ moneyMode === 'up' ? '划额度：我 → 客服' : '收回：客服 → 我' }}
            </div>
          </div>
        </div>

        <div class="bal-pair">
          <div class="bal-box">
            <div class="k">{{ isCreditBook ? '剩余信用' : '我的余额' }}</div>
            <div class="v gold">{{ agentSpendable == null ? '—' : fmt(agentSpendable) }}</div>
          </div>
          <div class="bal-arrow">{{ moneyMode === 'up' ? '→' : '←' }}</div>
          <div class="bal-box">
            <div class="k">客服额度</div>
            <div class="v">{{ fmt(moneyTarget.balance) }}</div>
          </div>
        </div>

        <div class="amt-block">
          <div class="amt-label">金额</div>
          <el-input-number
            v-model="moneyAmount"
            :min="1"
            :max="moneyMax"
            :precision="0"
            controls-position="right"
            class="amt-input"
          />
          <div class="chips">
            <button
              v-for="n in moneyChips"
              :key="n"
              type="button"
              class="chip"
              :class="{ on: moneyAmount === n }"
              @click="moneyAmount = n"
            >
              {{ n >= 10000 ? `${n / 10000}万` : n }}
            </button>
            <button type="button" class="chip" @click="moneyAmount = moneyMax">全部</button>
          </div>
        </div>

        <div class="preview" :class="{ warn: !moneyPreview.ok }">
          <template v-if="moneyPreview.ok">
            确认后：{{ isCreditBook ? '剩余信用' : '我的余额' }}
            <b>{{ fmt(moneyPreview.agentAfter) }}</b>
            · 客服额度 <b>{{ fmt(moneyPreview.csAfter) }}</b>
          </template>
          <template v-else>{{ moneyPreview.msg }}</template>
        </div>
      </div>

      <template #footer>
        <el-button @click="moneyVisible = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="busy" :disabled="!moneyPreview.ok" @click="doMoney">
          {{ moneyMode === 'up' ? '确认划额度' : '确认收回' }}
        </el-button>
      </template>
    </DeskDialog>

    <!-- 佣金（单独） -->
    <DeskDialog v-model="wageVisible" title="佣金比例" width="460px">
      <div v-if="wageTarget" class="set-body">
        <div class="who">
          <div class="avatar sm">{{ (wageForm.nickname || wageTarget.nickname || '?').slice(0, 1) }}</div>
          <div>
            <div class="who-name">{{ wageTarget.username }}</div>
            <div class="who-meta">当前额度 {{ fmt(wageTarget.balance) }}</div>
          </div>
        </div>

        <el-form label-position="top" class="dlg-form">
          <el-form-item label="显示名">
            <el-input v-model="wageForm.nickname" maxlength="20" />
          </el-form-item>
          <el-form-item>
            <template #label>
              <div class="wage-label-row">
                <span>佣金比例</span>
                <span class="wage-label-right">
                  <span class="label-val">{{ Number(wageForm.wagePct || 0).toFixed(1) }}%</span>
                  <span class="wage-note">
                    10000 →
                    <el-input-number
                      v-model="wagePerWan"
                      :min="0"
                      :max="1000"
                      :step="1"
                      :controls="false"
                      size="small"
                      class="wage-per-wan"
                      @change="onWagePerWanChange"
                    />
                  </span>
                </span>
              </div>
            </template>
            <el-slider
              v-model="wageForm.wagePct"
              :min="0"
              :max="10"
              :step="0.1"
              :format-tooltip="(v: number) => `${Number(v).toFixed(1)}%`"
              @input="syncWagePerWanFromPct"
            />
            <div class="wage-tip">右边填「每流水 10000 抽多少」；例如填 50 → 比例 0.5%</div>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="wageVisible = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="busy" @click="doWage">保存佣金</el-button>
      </template>
    </DeskDialog>

    <!-- 权重百分比（单独，全体一起调） -->
    <DeskDialog v-model="weightVisible" title="接单占比" width="520px">
      <div class="weight-list">
        <div v-for="row in weightRows" :key="row.id" class="weight-row">
          <div class="weight-hd">
            <div class="weight-who">
              <div class="avatar xs">{{ (row.nickname || '?').slice(0, 1) }}</div>
              <div>
                <div class="who-name">{{ row.nickname }}</div>
                <div class="who-meta">
                  {{ row.workStatus === 'IDLE' ? '接单中' : '休息中' }}
                </div>
              </div>
            </div>
            <span class="label-val">{{ Math.floor(Number(row.pct) || 0) }}%</span>
          </div>
          <el-slider
            v-model="row.pct"
            :min="0"
            :max="100"
            :step="1"
            :show-tooltip="true"
            :format-tooltip="(v: number) => `${Math.floor(Number(v) || 0)}%`"
            @input="() => onWeightChange(row.id)"
          />
        </div>
      </div>

      <div class="weight-sum" :class="{ ok: weightSum === 100, bad: weightSum !== 100 }">
        合计 <b>{{ weightSum }}%</b>
        <span v-if="weightSum === 100">· 可以保存</span>
        <span v-else>· 还需调整 {{ 100 - weightSum > 0 ? `+${100 - weightSum}` : 100 - weightSum }}%</span>
        <el-button link type="primary" @click="evenWeights">均分</el-button>
      </div>

      <template #footer>
        <el-button @click="weightVisible = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="busy" :disabled="weightSum !== 100" @click="doWeights">
          保存占比
        </el-button>
      </template>
    </DeskDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import DeskDialog from '@/components/DeskDialog.vue'
import { consoleApi, type CsStaffRow } from '@/api/console'
import { newFundOrderNo } from '@/utils/fundOrderNo'

type MoneyMode = 'up' | 'down'
type WeightRow = { id: string; nickname: string; workStatus: string; pct: number }

const loading = ref(false)
const busy = ref(false)
const togglingId = ref('')
const settlingId = ref('')
const list = ref<CsStaffRow[]>([])
/** 现金盘：代理余额；信用盘：剩余信用（pointsQuota） */
const agentSpendable = ref<number | null>(null)
const isCreditBook = ref(false)
const keyword = ref('')

const moneyVisible = ref(false)
const moneyMode = ref<MoneyMode>('up')
const moneyTarget = ref<CsStaffRow | null>(null)
const moneyAmount = ref(1000)
const moneyOrderNo = ref('')

const wageVisible = ref(false)
const wageTarget = ref<CsStaffRow | null>(null)
const wageForm = reactive({ nickname: '', wagePct: 0 })
/** 每流水 10000 对应佣金金额；与比例联动：比例% = 金额 / 100 */
const wagePerWan = ref(0)

function syncWagePerWanFromPct() {
  wagePerWan.value = Math.round(Number(wageForm.wagePct || 0) * 100)
}

function onWagePerWanChange(v: number | undefined) {
  const n = Math.max(0, Math.min(1000, Math.round(Number(v) || 0)))
  wagePerWan.value = n
  // 50 → 0.5%；上限滑条 10% → 每万最多 1000
  wageForm.wagePct = Math.min(10, Math.round((n / 100) * 10) / 10)
}

const weightVisible = ref(false)
const weightRows = ref<WeightRow[]>([])
/** 最近手动改过的 id，均分剩余时优先不动他 */
const weightFocusId = ref('')

const idleCount = computed(() => list.value.filter((r) => r.workStatus === 'IDLE').length)
const totalCsBalance = computed(() => list.value.reduce((s, r) => s + Number(r.balance || 0), 0))

const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter(
    (r) =>
      r.nickname.toLowerCase().includes(kw)
      || r.username.toLowerCase().includes(kw)
      || r.uid.toLowerCase().includes(kw),
  )
})

const emptyText = computed(() => {
  if (loading.value) return '加载中…'
  if (!list.value.length) {
    return '暂无客服，请前往「房间详情」页开通客服账号'
  }
  if (!filteredList.value.length) return '没有匹配的客服'
  return '暂无数据'
})

const moneyMax = computed(() => {
  if (moneyMode.value === 'up') {
    return Math.max(1, Math.floor(Number(agentSpendable.value ?? 0)))
  }
  return Math.max(1, Math.floor(Number(moneyTarget.value?.balance ?? 0)))
})

const moneyChips = computed(() => {
  const max = moneyMax.value
  return [1000, 5000, 10000, 50000].filter((n) => n <= max)
})

const moneyPreview = computed(() => {
  const target = moneyTarget.value
  const amount = Number(moneyAmount.value)
  const my = Number(agentSpendable.value ?? 0)
  const cs = Number(target?.balance ?? 0)
  const poolName = isCreditBook.value ? '剩余信用' : '余额'
  if (!target || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, msg: '请输入有效金额', agentAfter: my, csAfter: cs }
  }
  if (moneyMode.value === 'up') {
    if (amount > my + 1e-9) {
      return { ok: false, msg: `${poolName}不足（可用 ${fmt(my)}）`, agentAfter: my, csAfter: cs }
    }
    return { ok: true, msg: '', agentAfter: my - amount, csAfter: cs + amount }
  }
  if (amount > cs + 1e-9) {
    return { ok: false, msg: `客服额度不足（可用 ${fmt(cs)}）`, agentAfter: my, csAfter: cs }
  }
  return { ok: true, msg: '', agentAfter: my + amount, csAfter: cs - amount }
})

const weightSum = computed(() =>
  weightRows.value.reduce((s, r) => s + Math.max(0, Math.floor(Number(r.pct) || 0)), 0),
)

function fmt(n: number) {
  return Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function wageLabel(rate: number) {
  const pct = Number(rate || 0) * 100
  return pct <= 0 ? '无' : `${pct.toFixed(1)}%`
}

/** 相对权重 → 展示百分比 */
function sharePct(row: CsStaffRow) {
  const total = list.value.reduce((s, r) => s + Math.max(0, Number(r.idleWeight) || 0), 0)
  if (total <= 0) {
    return list.value.length ? Math.round(100 / list.value.length) : 0
  }
  return Math.round((Math.max(0, Number(row.idleWeight) || 0) / total) * 100)
}

/** 把相对权重规范化成合计 100 的整数百分比 */
function toPercentRows(rows: CsStaffRow[]): WeightRow[] {
  const weights = rows.map((r) => Math.max(0, Number(r.idleWeight) || 0))
  const total = weights.reduce((s, w) => s + w, 0)
  if (!rows.length) return []
  if (total <= 0) {
    const base = Math.floor(100 / rows.length)
    let left = 100 - base * rows.length
    return rows.map((r, i) => ({
      id: r.id,
      nickname: r.nickname,
      workStatus: r.workStatus,
      pct: base + (i < left ? 1 : 0),
    }))
  }
  const raw = weights.map((w) => (w / total) * 100)
  const floors = raw.map((p) => Math.floor(p))
  let rem = 100 - floors.reduce((s, n) => s + n, 0)
  const order = raw
    .map((p, i) => ({ i, frac: p - floors[i]! }))
    .sort((a, b) => b.frac - a.frac)
  const pcts = [...floors]
  for (let k = 0; k < rem; k++) {
    const idx = order[k % order.length]!.i
    pcts[idx] = (pcts[idx] ?? 0) + 1
  }
  return rows.map((r, i) => ({
    id: r.id,
    nickname: r.nickname,
    workStatus: r.workStatus,
    pct: pcts[i] ?? 0,
  }))
}

async function loadList() {
  list.value = await consoleApi.csStaffList()
}

async function loadWallet() {
  try {
    const w = await consoleApi.walletMe()
    isCreditBook.value = w.bookMode === 'CREDIT'
    // 信用盘从剩余信用划给客服；现金盘从代理余额划
    agentSpendable.value = isCreditBook.value
      ? Number(w.pointsQuota ?? 0)
      : Number(w.balance ?? 0)
  } catch {
    agentSpendable.value = null
    isCreditBook.value = false
  }
}

async function reloadAll() {
  loading.value = true
  try {
    await Promise.all([loadList(), loadWallet()])
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openMoney(row: CsStaffRow, mode: MoneyMode) {
  moneyMode.value = mode
  moneyTarget.value = row
  /* 订单号在开弹窗时定死，连点复用同一键由服务端去重 */
  moneyOrderNo.value = newFundOrderNo(mode)
  void loadWallet().then(() => syncMoneyAmount(mode, row))
  syncMoneyAmount(mode, row)
  moneyVisible.value = true
}

function syncMoneyAmount(mode: MoneyMode, row: CsStaffRow) {
  if (mode === 'up') {
    const avail = Math.floor(Number(agentSpendable.value ?? 0))
    moneyAmount.value = Math.min(1000, Math.max(1, avail || 1))
  } else {
    moneyAmount.value = Math.max(1, Math.floor(row.balance) || 1)
  }
}

async function doMoney() {
  if (!moneyTarget.value || !moneyPreview.value.ok) return
  const amount = Number(moneyAmount.value)
  busy.value = true
  try {
    const orderNo = moneyOrderNo.value || newFundOrderNo(moneyMode.value)
    if (moneyMode.value === 'up') {
      const res = await consoleApi.csStaffAllocate(moneyTarget.value.id, amount, orderNo)
      ElMessage.success(`划额度成功 · 订单 ${res?.orderNo || orderNo}`)
    } else {
      const res = await consoleApi.csStaffRecall(moneyTarget.value.id, amount, orderNo)
      ElMessage.success(`收回成功 · 订单 ${res?.orderNo || orderNo}`)
    }
    moneyVisible.value = false
    await reloadAll()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '操作失败')
  } finally {
    busy.value = false
  }
}

function openWage(row: CsStaffRow) {
  wageTarget.value = row
  wageForm.nickname = row.nickname
  wageForm.wagePct = Number((row.wageRate * 100).toFixed(1))
  syncWagePerWanFromPct()
  wageVisible.value = true
}

async function settleWage(row: CsStaffRow) {
  const pending = Number(row.pendingWage || 0)
  if (pending <= 0) return
  const source = isCreditBook.value ? '剩余信用' : '盘分'
  try {
    await ElMessageBox.confirm(
      `确认结清「${row.nickname}」未付佣金 ${fmt(pending)}（${row.pendingWageCount || 0} 笔）？将从${source}扣出并入账客服。`,
      '结清佣金',
      { type: 'warning', confirmButtonText: '结清', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  settlingId.value = row.id
  try {
    const res = await consoleApi.csWageSettle({ csUserId: row.id })
    ElMessage.success(res.message || `已结清 ${res.settledCount} 笔`)
    await reloadAll()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '结清失败')
  } finally {
    settlingId.value = ''
  }
}

async function doWage() {
  if (!wageTarget.value) return
  busy.value = true
  try {
    await consoleApi.csStaffPatch(wageTarget.value.id, {
      nickname: wageForm.nickname.trim(),
      wageRate: Number(wageForm.wagePct) / 100,
    })
    ElMessage.success('佣金已保存')
    wageVisible.value = false
    await loadList()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '保存失败')
  } finally {
    busy.value = false
  }
}

function openWeight() {
  weightRows.value = toPercentRows(list.value)
  weightFocusId.value = ''
  weightVisible.value = true
}

function evenWeights() {
  const n = weightRows.value.length
  if (!n) return
  const base = Math.floor(100 / n)
  let left = 100 - base * n
  weightRows.value = weightRows.value.map((r, i) => ({
    ...r,
    pct: base + (i < left ? 1 : 0),
  }))
  weightFocusId.value = ''
}

function onWeightChange(id: string) {
  weightFocusId.value = id
  const rows = weightRows.value
  const focused = rows.find((r) => r.id === id)
  if (!focused) return
  focused.pct = Math.min(100, Math.max(0, Math.floor(Number(focused.pct) || 0)))
  const others = rows.filter((r) => r.id !== id)
  if (!others.length) {
    focused.pct = 100
    return
  }
  const remain = 100 - focused.pct
  if (remain < 0) {
    focused.pct = 100
    others.forEach((r) => {
      r.pct = 0
    })
    return
  }
  const otherSum = others.reduce((s, r) => s + Math.max(0, r.pct), 0)
  if (otherSum <= 0) {
    const base = Math.floor(remain / others.length)
    let left = remain - base * others.length
    others.forEach((r, i) => {
      r.pct = base + (i < left ? 1 : 0)
    })
    return
  }
  let allocated = 0
  others.forEach((r, i) => {
    if (i === others.length - 1) {
      r.pct = Math.max(0, remain - allocated)
    } else {
      const next = Math.floor((Math.max(0, r.pct) / otherSum) * remain)
      r.pct = next
      allocated += next
    }
  })
}

async function doWeights() {
  if (weightSum.value !== 100) {
    ElMessage.warning('占比合计须为 100%')
    return
  }
  busy.value = true
  try {
    await Promise.all(
      weightRows.value.map((r) =>
        consoleApi.csStaffPatch(r.id, { idleWeight: Math.max(0, Math.floor(r.pct)) }),
      ),
    )
    ElMessage.success('接单占比已保存')
    weightVisible.value = false
    await loadList()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '保存失败')
  } finally {
    busy.value = false
  }
}

async function toggleWork(row: CsStaffRow, idle: boolean) {
  const next = idle ? 'IDLE' : 'REST'
  if (row.workStatus === next) return
  togglingId.value = row.id
  try {
    await consoleApi.csStaffPatch(row.id, { workStatus: next })
    ElMessage.success(next === 'IDLE' ? '已开始接单' : '已设为休息')
    await loadList()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '操作失败')
  } finally {
    togglingId.value = ''
  }
}

onMounted(() => {
  void reloadAll()
})
</script>

<style scoped>
.cs-staff-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
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
  align-items: baseline;
  justify-content: flex-start;
  gap: 10px;
  min-height: 44px;
  padding: 10px 18px;
  border-right: 1px solid #f1f5f9;
}
.sum-chip:last-child { border-right: none; }
.sum-label {
  font-size: 13px;
  color: #64748b;
  white-space: nowrap;
  line-height: 1.2;
}
.sum-val {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.sum-val.ok { color: #16a34a; }
.sum-val.gold { color: #f59e0b; }

.panel-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.filter-search { width: 240px; }
.toolbar-grow { flex: 1; min-width: 8px; }

.panel-body {
  flex: 1;
  min-height: 0;
  padding: 0;
  background: #fff;
}
.panel-body :deep(.el-table) {
  --el-table-header-bg-color: #f1f5f9;
  --el-table-row-hover-bg-color: #eff6ff;
  --el-table-fixed-box-shadow: none;
}
.panel-body :deep(.el-table th.el-table__cell) {
  color: #475569;
  font-weight: 600;
  background: #f1f5f9 !important;
}
.cs-staff-table { width: 100%; }
.cs-staff-table :deep(.el-table__header .cell) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}
.cs-staff-table :deep(.el-table__cell) { padding: 12px 14px; }
.cs-staff-table :deep(.cell-name),
.cs-staff-table :deep(.cell-meta) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-name {
  font-size: 14px;
  font-weight: 650;
  color: #0f172a;
  line-height: 1.35;
}
.cell-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.35;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.02em;
}
.gold { color: #f59e0b; font-weight: 600; }
.muted { color: #94a3b8; }
.pending-wage {
  color: #c2410c;
  font-weight: 650;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.25;
}
.pending-cnt {
  font-size: 11px;
  font-weight: 500;
  color: #ea580c;
  opacity: 0.85;
}

.order-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.share-pct {
  min-width: 36px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}

.ops {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}
.ops :deep(.el-button) { margin: 0; padding: 0 2px; }

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #e2e8f0;
  color: #475569;
  display: grid;
  place-items: center;
  font-weight: 600;
  flex-shrink: 0;
  font-size: 14px;
}
.avatar.sm {
  width: 36px;
  height: 36px;
}
.avatar.xs {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  font-size: 13px;
}

.dlg-form :deep(.el-form-item) { margin-bottom: 14px; }

.who {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.who-name { font-weight: 650; color: #0f172a; }
.who-meta { font-size: 12px; color: #64748b; margin-top: 2px; }

.bal-pair {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 10px;
  align-items: center;
  margin-bottom: 16px;
}
.bal-box {
  background: #f8fafc;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
  border: 1px solid #e2e8f0;
}
.bal-box .k {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 4px;
}
.bal-box .v {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
}
.bal-box .v.gold { color: #f59e0b; }
.bal-arrow {
  color: #64748b;
  font-size: 18px;
  font-weight: 600;
}

.amt-block { margin-bottom: 12px; }
.amt-label {
  font-size: 13px;
  color: #475569;
  margin-bottom: 8px;
}
.amt-input { width: 100%; }
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.chip {
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.chip:hover { border-color: #f59e0b; color: #f59e0b; }
.chip.on {
  background: #fffbeb;
  border-color: #f59e0b;
  color: #f59e0b;
  font-weight: 600;
}

.preview {
  padding: 10px 12px;
  border-radius: 8px;
  background: #f0fdf4;
  color: #16a34a;
  font-size: 13px;
  line-height: 1.5;
}
.preview.warn {
  background: #fef2f2;
  color: #dc2626;
}

.label-val {
  color: #f59e0b;
  font-weight: 650;
}
.wage-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.wage-label-right {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.wage-note {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
}
.wage-per-wan {
  width: 72px;
}
.wage-per-wan :deep(.el-input__inner) {
  text-align: center;
  font-weight: 650;
  color: #0f172a;
}
.wage-tip {
  margin-top: 6px;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}

.weight-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 14px;
}
.weight-row {
  padding: 12px 14px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}
.weight-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.weight-who {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.weight-row :deep(.el-slider) {
  margin: 0 8px;
}

.weight-sum {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #475569;
}
.weight-sum.ok { color: #16a34a; }
.weight-sum.bad { color: #dc2626; }

@media (max-width: 900px) {
  .rooms-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sum-chip:nth-child(2) { border-right: none; }
}
@media (max-width: 560px) {
  .rooms-summary { grid-template-columns: 1fr; }
  .sum-chip { border-right: none; }
  .bal-pair { grid-template-columns: 1fr; }
  .bal-arrow { display: none; }
}
</style>
