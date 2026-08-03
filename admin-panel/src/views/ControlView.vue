<template>
  <div class="ops-page control-page">
    <PageHeader title="控奖中心" subtitle="彩票 / 牌桌 / 电玩 · 按房间设留存%与目标回血金额">
      <template #actions>
        <el-button :loading="loading" @click="refresh">刷新</el-button>
        <el-button type="primary" @click="openCreate()">新建调控</el-button>
      </template>
    </PageHeader>

    <div class="ops-kpi-row">
      <div
        v-for="k in kpiItems"
        :key="k.key"
        class="ops-kpi is-clickable"
        :class="[k.tone, { 'is-active': viewFilter === k.key }]"
        @click="viewFilter = k.key"
      >
        <div class="ops-kpi__label">{{ k.label }}</div>
        <div class="ops-kpi__value">{{ k.value }}</div>
      </div>
    </div>

    <el-card shadow="never" class="hint-card">
      <div class="hint-row">
        <div class="hint-pills">
          <span class="pill">本局总下注 × 留存% ≈ 庄家留下</span>
          <span class="pill">到目标金额自动停</span>
          <span class="pill">一人一注也控</span>
          <span class="pill muted">可执行：彩票 · 牌桌 · 电玩</span>
        </div>
        <el-button text type="primary" size="small" @click="showHelp = !showHelp">
          {{ showHelp ? '收起说明' : '说明' }}
        </el-button>
      </div>
      <ul v-show="showHelp" class="hint-list">
        <li>总下注 = 该房、该游戏、这一期真人注单合计，不是整天流水。</li>
        <li>目标金额 = 启用后庄家净赢（下注 − 派彩）累计；另有最长 30 天安全截止。</li>
        <li>回血进度优先计带房间标记的已结算注单；无标记的旧单按该房成员兜底计入。</li>
        <li>彩票/牌桌全站同一开奖；多房同时开时会折中挑号。电玩按单人单局控。赔率离散，只能尽量靠近。</li>
        <li>机器人聊天注单不进真金结算，不影响控奖计算。</li>
      </ul>
    </el-card>

    <div class="ops-filter">
      <el-radio-group v-model="viewFilter" size="small">
        <el-radio-button label="all">全部</el-radio-button>
        <el-radio-button label="effective">正在生效</el-radio-button>
        <el-radio-button label="ACTIVE">已启用</el-radio-button>
        <el-radio-button label="EXHAUSTED">已达成</el-radio-button>
        <el-radio-button label="HALTED">已停止</el-radio-button>
        <el-radio-button label="DRAFT">草稿</el-radio-button>
      </el-radio-group>
      <el-select v-model="roomFilter" clearable filterable placeholder="筛选房间" style="width: 220px">
        <el-option v-for="r in rooms" :key="r.id" :label="`${r.name}（${r.roomNo}）`" :value="r.id" />
      </el-select>
    </div>

    <div class="ops-table-wrap">
      <el-table :data="filtered" v-loading="loading" stripe empty-text="暂无调控，点右上角新建">
        <el-table-column label="调控" min-width="150">
          <template #default="{ row }">
            <div class="name">{{ row.name }}</div>
            <div v-if="row.remark" class="sub">{{ row.remark }}</div>
          </template>
        </el-table-column>
        <el-table-column label="房间 / 游戏" min-width="160">
          <template #default="{ row }">
            <div>{{ row.room ? `${row.room.name}` : '—' }}</div>
            <div class="sub">
              <template v-if="row.room">{{ row.room.roomNo }} · </template>{{ gameLabelOrAll(row.gameCode) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="留存" width="100" align="center">
          <template #default="{ row }">
            <span class="hold-num">{{ pct(row.holdRatio ?? row.targetValue) }}%</span>
          </template>
        </el-table-column>
        <el-table-column label="目标回血" min-width="200">
          <template #default="{ row }">
            <template v-if="row.goalAmount != null">
              <div class="goal-line">
                <b>{{ fmtMoney(row.recoveredAmount ?? 0) }}</b>
                <span class="sub"> / {{ fmtMoney(row.goalAmount) }}</span>
              </div>
              <el-progress
                :percentage="Math.min(100, row.progressPct ?? 0)"
                :stroke-width="7"
                :show-text="false"
                :status="row.status === 'EXHAUSTED' ? 'success' : undefined"
                class="goal-bar"
              />
            </template>
            <el-tag v-else type="danger" size="small" effect="plain">旧配置无效</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="108">
          <template #default="{ row }">
            <el-tag v-if="row.legacyInvalid" type="danger" size="small" effect="plain">无效</el-tag>
            <el-tag v-else-if="row.status === 'EXHAUSTED'" type="success" size="small" effect="plain">已达成</el-tag>
            <el-tag v-else-if="row.effective" type="success" size="small" effect="dark">生效中</el-tag>
            <el-tag v-else-if="row.status === 'ACTIVE' && row.windowState === 'ENDED'" type="info" size="small">已超时</el-tag>
            <el-tag v-else :type="statusTag(row.status)" size="small" effect="plain">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="168" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'ACTIVE'" link type="danger" @click="halt(row)">停止</el-button>
            <el-button
              v-else-if="!row.legacyInvalid && row.status !== 'EXHAUSTED'"
              link
              type="primary"
              @click="activate(row)"
            >启用</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog
      v-model="dlg"
      width="560px"
      destroy-on-close
      align-center
      class="control-dlg"
      :show-close="true"
    >
      <template #header>
        <div class="dlg-head">
          <div class="dlg-title">新建房间调控</div>
          <div class="dlg-sub">选房间与游戏，设留存%和目标金额即可</div>
        </div>
      </template>

      <div class="dlg-body">
        <div class="preview">
          <div class="preview-title">效果预览</div>
          <div class="preview-grid">
            <div>
              <div class="preview-label">本局下注 1000</div>
              <div class="preview-val">
                留 <b>{{ previewKeep }}</b>
                <span class="dot">·</span>
                派约 <b>{{ previewPay }}</b>
              </div>
            </div>
            <div>
              <div class="preview-label">目标回血</div>
              <div class="preview-val"><b>{{ fmtMoney(form.goalAmount) }}</b> 后自动停</div>
            </div>
          </div>
        </div>

        <el-form label-position="top" class="form">
          <div class="form-row">
            <el-form-item label="房间" required class="grow">
              <el-select v-model="form.roomId" filterable placeholder="选择房间" style="width:100%">
                <el-option v-for="r in rooms" :key="r.id" :label="`${r.name}（${r.roomNo}）`" :value="r.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="游戏" required class="grow">
              <el-select v-model="form.gameCode" placeholder="选择游戏" style="width:100%">
                <el-option label="全部已接入（该房）" value="__ALL__" />
                <el-option-group label="彩票">
                  <el-option v-for="g in lotteryGames" :key="g.value" :label="g.label" :value="g.value" />
                </el-option-group>
                <el-option-group label="牌桌">
                  <el-option v-for="g in tableGames" :key="g.value" :label="g.label" :value="g.value" />
                </el-option-group>
                <el-option-group label="电玩">
                  <el-option v-for="g in arcadeGames" :key="g.value" :label="g.label" :value="g.value" />
                </el-option-group>
              </el-select>
            </el-form-item>
          </div>

          <el-form-item label="名称" required>
            <el-input v-model="form.name" maxlength="40" placeholder="可自动生成，也可手改" @focus="nameTouched = true" />
          </el-form-item>

          <el-form-item label="庄家留存" required>
            <div class="chip-row">
              <button
                v-for="p in holdPresets"
                :key="p"
                type="button"
                class="chip"
                :class="{ on: form.holdRatioPct === p }"
                @click="form.holdRatioPct = p"
              >{{ holdPresetLabel(p) }} {{ p }}%</button>
              <div class="chip-input">
                <el-input-number v-model="form.holdRatioPct" :min="1" :max="90" :step="1" controls-position="right" />
                <span class="unit">%</span>
              </div>
            </div>
          </el-form-item>

          <el-form-item label="目标回血金额" required>
            <div class="chip-row">
              <button
                v-for="g in goalPresets"
                :key="g"
                type="button"
                class="chip"
                :class="{ on: form.goalAmount === g }"
                @click="form.goalAmount = g"
              >{{ fmtMoney(g) }}</button>
              <div class="chip-input">
                <el-input-number
                  v-model="form.goalAmount"
                  :min="1"
                  :max="100000000"
                  :step="100"
                  controls-position="right"
                />
              </div>
            </div>
            <div class="field-tip">庄家净赢累计到此数自动结束，无需猜时长（最长 30 天）</div>
          </el-form-item>

          <div class="form-row bottom">
            <el-form-item label="备注" class="grow">
              <el-input v-model="form.remark" maxlength="80" placeholder="可选，如：算账前拉回" />
            </el-form-item>
            <el-form-item label="立即启用" class="switch-item">
              <el-switch v-model="form.activate" />
            </el-form-item>
          </div>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onCreate">
          {{ form.activate ? '创建并启用' : '保存草稿' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import { consoleApi, type ConsoleRoom, type ControlPolicy } from '@/api/console'
import { GAME_OPTIONS, gameLabel } from '@/utils/labels'

const LOTTERY = new Set(['ffc', 'ssc', 'kuai3', 'bjsc', 'speed-racing', 'speed-boat', 'lhc'])
const TABLE = new Set(['baccarat', 'dragon-tiger', 'longhu', 'douniu', 'zhajinhua'])
const ARCADE = new Set(['fruit-machine', 'bcbm'])
const lotteryGames = GAME_OPTIONS.filter((g) => LOTTERY.has(g.value))
const tableGames = GAME_OPTIONS.filter((g) => TABLE.has(g.value) && g.value !== 'longhu')
const arcadeGames = GAME_OPTIONS.filter((g) => ARCADE.has(g.value))
const holdPresets = [15, 30, 45]
const goalPresets = [1000, 5000, 10000, 50000]

type Row = ControlPolicy & {
  room?: { id: string; name: string; roomNo: string } | null
  holdRatio?: number
  recoveredAmount?: number
  progressPct?: number | null
}

const list = ref<Row[]>([])
const rooms = ref<ConsoleRoom[]>([])
const loading = ref(false)
const dlg = ref(false)
const saving = ref(false)
const showHelp = ref(false)
const viewFilter = ref('all')
const roomFilter = ref('')
const nameTouched = ref(false)

const form = reactive({
  name: '',
  roomId: '',
  gameCode: '__ALL__',
  holdRatioPct: 30,
  goalAmount: 5000,
  remark: '',
  activate: true,
})

const previewKeep = computed(() => Math.round(1000 * form.holdRatioPct / 100))
const previewPay = computed(() => Math.round(1000 * (1 - form.holdRatioPct / 100)))

const counts = computed(() => {
  let effective = 0, active = 0, draft = 0, halted = 0, exhausted = 0
  for (const r of list.value) {
    if (r.effective) effective++
    if (r.status === 'ACTIVE') active++
    else if (r.status === 'DRAFT') draft++
    else if (r.status === 'HALTED') halted++
    else if (r.status === 'EXHAUSTED') exhausted++
  }
  return { effective, active, draft, halted, exhausted, all: list.value.length }
})

const kpiItems = computed(() => [
  { key: 'effective', label: '正在生效', value: counts.value.effective, tone: 'is-ok' },
  { key: 'ACTIVE', label: '已启用', value: counts.value.active, tone: '' },
  { key: 'EXHAUSTED', label: '已达成', value: counts.value.exhausted, tone: 'is-gold' },
  { key: 'HALTED', label: '已停止', value: counts.value.halted, tone: 'is-danger' },
  { key: 'all', label: '全部', value: counts.value.all, tone: '' },
])

const filtered = computed(() => list.value.filter((r) => {
  if (viewFilter.value === 'effective' && !r.effective) return false
  if (['ACTIVE', 'DRAFT', 'HALTED', 'EXHAUSTED'].includes(viewFilter.value) && r.status !== viewFilter.value) return false
  if (roomFilter.value && r.roomId !== roomFilter.value) return false
  return true
}))

function pct(v: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return Math.round((n <= 1 ? n * 100 : n))
}
function fmtMoney(n: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function gameLabelOrAll(code?: string | null) {
  if (!code || code === '__ALL__') return '全部已接入'
  return gameLabel(code)
}
function holdPresetLabel(p: number) {
  return ({ 15: '轻', 30: '中', 45: '重' } as Record<number, string>)[p] || ''
}
function statusLabel(s: string) {
  return ({
    DRAFT: '草稿',
    ACTIVE: '已启用',
    HALTED: '已停止',
    EXHAUSTED: '已达成',
  } as Record<string, string>)[s] || s
}
function statusTag(s: string): 'success' | 'warning' | 'danger' | 'info' {
  if (s === 'ACTIVE' || s === 'EXHAUSTED') return 'success'
  if (s === 'HALTED') return 'danger'
  return 'info'
}

function suggestName() {
  const room = rooms.value.find((r) => r.id === form.roomId)
  const game = gameLabelOrAll(form.gameCode)
  const roomPart = room ? room.name : '房间'
  return `${roomPart}${game}回血`
}

watch(
  () => [form.roomId, form.gameCode],
  () => {
    if (!dlg.value || nameTouched.value) return
    form.name = suggestName()
  },
)

function openCreate() {
  nameTouched.value = false
  form.roomId = rooms.value[0]?.id || ''
  form.gameCode = '__ALL__'
  form.holdRatioPct = 30
  form.goalAmount = 5000
  form.remark = ''
  form.activate = true
  form.name = suggestName()
  dlg.value = true
}

async function refresh() {
  loading.value = true
  try {
    const [rows, roomList] = await Promise.all([
      consoleApi.controlList() as Promise<Row[]>,
      consoleApi.rooms().catch(() => [] as ConsoleRoom[]),
    ])
    list.value = rows
    rooms.value = roomList
  } catch {
    ElMessage.error('无权或加载失败')
  } finally {
    loading.value = false
  }
}

async function onCreate() {
  if (!form.roomId) return ElMessage.warning('请选择房间')
  if (!form.gameCode) return ElMessage.warning('请选择游戏')
  if (!(form.goalAmount > 0)) return ElMessage.warning('请填写目标回血金额')
  if (!form.name.trim()) form.name = suggestName()

  if (form.activate) {
    try {
      await ElMessageBox.confirm(
        `将立即对该房「${gameLabelOrAll(form.gameCode === '__ALL__' ? null : form.gameCode)}」启用控奖（留存 ${form.holdRatioPct}%）。确认创建并启用？`,
        '启用控奖',
        { type: 'warning', confirmButtonText: '创建并启用' },
      )
    } catch {
      return
    }
  }

  saving.value = true
  try {
    await consoleApi.controlCreate({
      name: form.name.trim(),
      roomId: form.roomId,
      gameCode: form.gameCode === '__ALL__' ? null : form.gameCode,
      holdRatioPct: form.holdRatioPct,
      goalAmount: form.goalAmount,
      remark: form.remark || undefined,
      activate: form.activate,
    })
    ElMessage.success(form.activate ? '已创建并启用' : '已保存草稿')
    dlg.value = false
    await refresh()
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '创建失败')
  } finally {
    saving.value = false
  }
}

async function setStatus(id: string, status: string) {
  try {
    await consoleApi.controlStatus(id, status)
    ElMessage.success('已更新')
    await refresh()
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '失败')
  }
}

async function activate(row: Row) {
  try {
    await ElMessageBox.confirm(
      `确认启用「${row.name}」？启用后将按留存目标影响开奖挑号。`,
      '启用控奖',
      { type: 'warning', confirmButtonText: '确认启用' },
    )
    await setStatus(row.id, 'ACTIVE')
  } catch { /* cancel */ }
}

async function halt(row: Row) {
  try {
    await ElMessageBox.confirm(`停止「${row.name}」后，下一期起不再按留存目标挑号。`, '停止调控', {
      type: 'warning',
      confirmButtonText: '确认停止',
    })
    await setStatus(row.id, 'HALTED')
  } catch { /* cancel */ }
}

async function remove(row: Row) {
  try {
    await ElMessageBox.confirm(
      row.legacyInvalid
        ? `「${row.name}」是旧配置、已无效，确认删除？`
        : `确认删除「${row.name}」？删除后不可恢复。`,
      '删除调控',
      { type: 'warning', confirmButtonText: '确认删除' },
    )
  } catch {
    return
  }
  try {
    await consoleApi.controlDelete(row.id)
    ElMessage.success('已删除')
    await refresh()
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '删除失败')
  }
}

onMounted(refresh)
</script>

<style scoped>
.control-page { max-width: none; }

.ops-kpi.is-active {
  border-color: var(--ops-gold);
  box-shadow: 0 0 0 1px rgba(212, 169, 60, 0.25);
}

.hint-card {
  margin-bottom: 14px;
  border-radius: var(--ops-radius);
}
.hint-card :deep(.el-card__body) { padding: 12px 16px; }
.hint-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.hint-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pill {
  font-size: 12px;
  color: var(--ops-text-2);
  background: #f7f8fa;
  border: 1px solid var(--ops-border-soft);
  border-radius: 999px;
  padding: 4px 10px;
  line-height: 1.4;
}
.pill.muted { color: var(--ops-muted); }
.hint-list {
  margin: 10px 0 0;
  padding-left: 18px;
  color: var(--ops-text-2);
  font-size: 12px;
  line-height: 1.7;
}

.name { font-weight: 600; }
.sub { margin-top: 2px; font-size: 12px; color: var(--ops-muted); }
.hold-num {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ops-text);
}
.goal-line {
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}
.goal-bar { margin-top: 6px; max-width: 180px; }

.dlg-head { padding-right: 24px; }
.dlg-title { font-size: 16px; font-weight: 650; color: var(--ops-text); }
.dlg-sub { margin-top: 4px; font-size: 12px; color: var(--ops-muted); }

.dlg-body { display: flex; flex-direction: column; gap: 14px; }

.preview {
  padding: 12px 14px;
  border-radius: 10px;
  background: linear-gradient(135deg, #fcf8ef 0%, #f7f8fa 100%);
  border: 1px solid var(--ops-border-soft);
}
.preview-title {
  font-size: 12px;
  color: var(--ops-muted);
  margin-bottom: 8px;
}
.preview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.preview-label { font-size: 12px; color: var(--ops-muted); }
.preview-val {
  margin-top: 4px;
  font-size: 14px;
  color: var(--ops-text);
  font-variant-numeric: tabular-nums;
}
.preview-val b { color: var(--ops-gold); font-weight: 700; }
.dot { margin: 0 4px; color: var(--ops-muted); }

.form :deep(.el-form-item) { margin-bottom: 14px; }
.form :deep(.el-form-item__label) {
  margin-bottom: 4px !important;
  font-weight: 500;
  color: var(--ops-text-2);
}
.form-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.form-row .grow { flex: 1; min-width: 0; }
.form-row.bottom { align-items: flex-end; }
.switch-item { width: 88px; flex-shrink: 0; }

.chip-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.chip {
  border: 1px solid var(--ops-border);
  background: #fff;
  color: var(--ops-text-2);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color .15s, background .15s, color .15s;
}
.chip:hover { border-color: var(--ops-gold); color: var(--ops-text); }
.chip.on {
  border-color: var(--ops-gold);
  background: var(--el-color-primary-light-9);
  color: #8a6a1a;
  font-weight: 600;
}
.chip-input {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.unit { color: var(--ops-muted); font-size: 13px; }
.field-tip {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ops-muted);
  line-height: 1.45;
}

@media (max-width: 560px) {
  .preview-grid { grid-template-columns: 1fr; }
  .form-row { flex-direction: column; }
  .chip-input { margin-left: 0; width: 100%; }
}
</style>

<style>
.control-dlg.el-dialog {
  border-radius: 12px;
  overflow: hidden;
}
.control-dlg .el-dialog__header {
  margin: 0;
  padding: 18px 20px 0;
}
.control-dlg .el-dialog__body {
  padding: 14px 20px 6px;
}
.control-dlg .el-dialog__footer {
  padding: 12px 20px 18px;
}
</style>
