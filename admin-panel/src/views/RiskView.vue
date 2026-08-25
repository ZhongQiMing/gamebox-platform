<template>
  <div class="desk-work risk-page">
    <div class="desk-panel">
      <PageHeader title="风控告警">
        <template #actions>
          <el-button :loading="loading" @click="refreshAll">刷新</el-button>
          <el-button type="primary" :disabled="!selected.length" @click="batchHandle">
            批量处理{{ selected.length ? ` (${selected.length})` : '' }}
          </el-button>
        </template>
      </PageHeader>

      <div class="rooms-summary">
        <div
          v-for="k in kpis"
          :key="k.label"
          class="sum-chip"
          :class="[{ clickable: !!k.onClick }, k.tone]"
          @click="k.onClick?.()"
        >
          <span class="sum-label">{{ k.label }}</span>
          <span class="sum-val" :class="k.tone">{{ k.value }}</span>
        </div>
      </div>

      <div class="panel-toolbar">
        <el-radio-group v-model="filter.handled" size="small" @change="onFilterChange">
          <el-radio-button :label="false">未处理</el-radio-button>
          <el-radio-button :label="true">已处理</el-radio-button>
          <el-radio-button label="">全部</el-radio-button>
        </el-radio-group>

        <el-select
          v-model="filter.type"
          clearable
          size="small"
          placeholder="告警类型"
          class="filter-type"
          @change="onFilterChange"
        >
          <el-option v-for="t in typeOptions" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>

        <el-select
          v-model="filter.level"
          clearable
          size="small"
          placeholder="级别"
          class="filter-level"
          @change="onFilterChange"
        >
          <el-option label="严重" value="CRITICAL" />
          <el-option label="警告" value="WARN" />
          <el-option label="提示" value="INFO" />
        </el-select>

        <el-input
          v-model="filter.keyword"
          clearable
          size="small"
          placeholder="搜登录账号 / 昵称 / UID"
          class="filter-search"
          @keyup.enter="onFilterChange"
        />

        <el-date-picker
          v-model="dateRange"
          type="datetimerange"
          size="small"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
          class="filter-date"
          @change="onFilterChange"
        />

        <el-button type="primary" size="small" @click="onFilterChange">查询</el-button>
      </div>

      <div class="panel-body">
        <el-table
          :data="list"
          v-loading="loading"
          class="risk-table"
          stripe
          border
          size="small"
          height="100%"
          empty-text="暂无告警"
          @selection-change="(rows: RiskEvent[]) => (selected = rows)"
        >
          <el-table-column type="selection" width="42" :selectable="(r: RiskEvent) => !r.handled" />
          <el-table-column label="级别" width="88">
            <template #default="{ row }: { row: any }">
              <el-tag :type="levelType(row.level)" size="small" effect="plain">{{ levelLabel(row.level) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="120">
            <template #default="{ row }: { row: any }">
              <el-tooltip :content="row.typeHint || row.type" placement="top">
                <span class="type-label">{{ row.typeLabel || row.type }}</span>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="关联玩家" min-width="140">
            <template #default="{ row }: { row: any }">
              <template v-if="row.target">
                <div class="cell-name">{{ row.target.nickname }}</div>
                <div class="cell-meta">{{ row.target.username || '—' }} · {{ row.target.uid }}</div>
              </template>
              <span v-else class="muted">{{ shortId(row.targetId) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="摘要" min-width="240">
            <template #default="{ row }: { row: any }">
              <el-text truncated>{{ row.summary || '—' }}</el-text>
            </template>
          </el-table-column>
          <el-table-column label="时间" width="160">
            <template #default="{ row }: { row: any }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="96">
            <template #default="{ row }: { row: any }">
              <el-tag v-if="!row.handled" type="danger" size="small" effect="plain">待处理</el-tag>
              <el-tag v-else type="success" size="small" effect="plain">已处理</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right" align="right">
            <template #default="{ row }: { row: any }">
              <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
              <el-button
                v-if="!row.handled"
                link
                type="success"
                @click.stop="handleOne(row)"
              >处理</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel-foot">
        <el-pagination
          :total="total"
          :page-size="filter.pageSize"
          :current-page="filter.page"
          layout="total, prev, pager, next"
          @current-change="(p: number) => { filter.page = p; load() }"
        />
      </div>
    </div>

    <el-drawer v-model="drawer" class="desk-drawer" title="告警详情" size="480px" destroy-on-close>
      <template v-if="current">
        <el-descriptions :column="1" border size="small" class="mb16">
          <el-descriptions-item label="级别">
            <el-tag :type="levelType(current.level)" size="small" effect="plain">{{ levelLabel(current.level) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="类型">
            {{ current.typeLabel }}
            <div class="hint">{{ current.typeHint }}</div>
          </el-descriptions-item>
          <el-descriptions-item label="摘要">{{ current.summary }}</el-descriptions-item>
          <el-descriptions-item label="时间">{{ fmtTime(current.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <template v-if="current.handled">
              已处理
              <span v-if="current.handler"> · {{ current.handler.nickname }}</span>
              <span v-if="current.handledAt"> · {{ fmtTime(current.handledAt) }}</span>
              <div v-if="current.handleNote" class="hint">备注：{{ current.handleNote }}</div>
            </template>
            <span v-else>待处理</span>
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="current.target" class="detail-block mb16">
          <div class="detail-title">关联玩家</div>
          <div class="player-block">
            <div><b>{{ current.target.nickname }}</b>（{{ current.target.username }} · {{ current.target.uid }}）</div>
            <div class="hint">账号 {{ current.target.username }} · 状态 {{ current.target.status }}</div>
            <div class="hint">最近登录 IP {{ current.target.lastLoginIp || '—' }}</div>
          </div>
        </div>

        <div v-if="detailRows.length" class="detail-block mb16">
          <div class="detail-title">判定依据</div>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item v-for="r in detailRows" :key="r.key" :label="r.label">
              <span :class="{ mono: r.raw }">{{ r.value }}</span>
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <el-collapse class="raw-collapse mb16">
          <el-collapse-item name="raw">
            <template #title><span class="raw-title">原始数据</span></template>
            <pre class="json">{{ pretty(current.detail) }}</pre>
          </el-collapse-item>
        </el-collapse>

        <div v-if="!current.handled" class="drawer-actions">
          <el-input
            v-model="handleNote"
            type="textarea"
            :rows="2"
            :placeholder="current.level === 'CRITICAL'
              ? '严重告警必填：核对结论 / 处理动作'
              : '处理备注（可选）'"
          />
          <el-button type="primary" :loading="opLoading" class="mt12" @click="confirmHandle">
            标记已处理
          </el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { formatDateTime } from '@gamebox/shared'
import PageHeader from '@/components/PageHeader.vue'
import { toDetailRows } from '@/utils/detailFields'
import {
  riskApi,
  type RiskEvent,
  type RiskMeta,
  type RiskSummary,
} from '@/api/admin'

const list = ref<RiskEvent[]>([])
const total = ref(0)
const loading = ref(false)
const opLoading = ref(false)
const selected = ref<RiskEvent[]>([])
const summary = ref<RiskSummary | null>(null)
const typeOptions = ref<RiskMeta['types']>([])
const drawer = ref(false)
const current = ref<RiskEvent | null>(null)
/* 判定依据里已经有的字段不必再重复一遍 */
const detailRows = computed(() =>
  toDetailRows(current.value?.detail).filter((r) => r.key !== 'summary'),
)
const handleNote = ref('')
const dateRange = ref<[string, string] | null>(null)

const filter = reactive<{
  handled: boolean | ''
  type: string
  level: string
  keyword: string
  page: number
  pageSize: number
}>({
  handled: false,
  type: '',
  level: '',
  keyword: '',
  page: 1,
  pageSize: 20,
})

const kpis = computed(() => [
  {
    label: '未处理',
    value: summary.value?.unhandled ?? 0,
    tone: (summary.value?.unhandled ?? 0) > 0 ? 'hot' : '',
    onClick: () => {
      filter.handled = false
      onFilterChange()
    },
  },
  {
    label: '严重',
    value: summary.value?.critical ?? 0,
    tone: (summary.value?.critical ?? 0) > 0 ? 'hot' : '',
    onClick: () => {
      filter.handled = false
      filter.level = 'CRITICAL'
      onFilterChange()
    },
  },
  {
    label: '警告',
    value: summary.value?.warn ?? 0,
    tone: 'warn',
    onClick: () => {
      filter.handled = false
      filter.level = 'WARN'
      onFilterChange()
    },
  },
  {
    label: '今日新增',
    value: summary.value?.todayNew ?? 0,
    tone: '',
  },
])

let timer: ReturnType<typeof setInterval> | null = null

async function loadMeta() {
  try {
    const m = await riskApi.meta()
    typeOptions.value = m.types
  } catch {
    /* ignore */
  }
}

async function loadSummary() {
  try {
    summary.value = await riskApi.summary()
  } catch {
    /* ignore */
  }
}

async function load() {
  loading.value = true
  try {
    const res = await riskApi.list({
      handled: filter.handled === '' ? undefined : filter.handled,
      type: filter.type || undefined,
      level: filter.level || undefined,
      keyword: filter.keyword.trim() || undefined,
      from: dateRange.value?.[0],
      to: dateRange.value?.[1],
      page: filter.page,
      pageSize: filter.pageSize,
    })
    list.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}

async function refreshAll() {
  await Promise.all([loadSummary(), load()])
}

function onFilterChange() {
  filter.page = 1
  void load()
  void loadSummary()
}

function openDetail(row: RiskEvent) {
  current.value = row
  handleNote.value = ''
  drawer.value = true
}

async function handleOne(row: RiskEvent) {
  current.value = row
  handleNote.value = ''
  const critical = row.level === 'CRITICAL'
  try {
    const { value } = await ElMessageBox.prompt(
      critical ? '严重告警必须填写处理备注' : '可选填写处理备注',
      '标记已处理',
      {
        confirmButtonText: '确认处理',
        cancelButtonText: '取消',
        inputPlaceholder: critical ? '必填：核对结论 / 处理动作' : '如：已核对，无异常',
        inputValue: '',
        inputValidator: (v) => {
          if (critical && !String(v || '').trim()) return '严重告警必须填写备注'
          return true
        },
      },
    )
    await riskApi.handle(row.id, String(value || '').trim() || undefined)
    ElMessage.success('已标记处理')
    row.handled = true
    await refreshAll()
  } catch (e: unknown) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error((e as Error).message || '处理失败')
  }
}

async function confirmHandle() {
  if (!current.value) return
  if (current.value.level === 'CRITICAL' && !handleNote.value.trim()) {
    return ElMessage.warning('严重告警必须填写处理备注')
  }
  opLoading.value = true
  try {
    await riskApi.handle(current.value.id, handleNote.value.trim() || undefined)
    ElMessage.success('已标记处理')
    current.value.handled = true
    drawer.value = false
    await refreshAll()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '处理失败')
  } finally {
    opLoading.value = false
  }
}

async function batchHandle() {
  const rows = selected.value.filter((r) => !r.handled)
  const ids = rows.map((r) => r.id)
  if (!ids.length) return
  const hasCritical = rows.some((r) => r.level === 'CRITICAL')
  try {
    const { value } = await ElMessageBox.prompt(
      hasCritical
        ? `将处理 ${ids.length} 条告警（含严重），必须填写统一备注`
        : `将处理 ${ids.length} 条告警`,
      '批量处理',
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        inputPlaceholder: hasCritical ? '必填：统一处理备注' : '统一备注（可选）',
        inputValidator: (v) => {
          if (hasCritical && !String(v || '').trim()) return '含严重告警时必须填写备注'
          return true
        },
      },
    )
    const res = await riskApi.handleBatch(ids, String(value || '').trim() || undefined)
    ElMessage.success(`已处理 ${res.count} 条`)
    selected.value = []
    await refreshAll()
  } catch (e: unknown) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error((e as Error).message || '批量处理失败')
  }
}

function levelType(l: string) {
  return l === 'CRITICAL' ? 'danger' : l === 'WARN' ? 'warning' : 'info'
}
function levelLabel(l: string) {
  return l === 'CRITICAL' ? '严重' : l === 'WARN' ? '警告' : l === 'INFO' ? '提示' : l
}
function fmtTime(s: string) {
  return formatDateTime(s)
}
function shortId(id: string | null) {
  if (!id) return '—'
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}
function pretty(d: unknown) {
  try {
    return JSON.stringify(d, null, 2)
  } catch {
    return String(d)
  }
}

/* 标签页不可见时没人看这张表，切回来补一次即可 */
function pollOnce() {
  void loadSummary()
  if (filter.handled === false) void load()
}

function onVisibilityChange() {
  if (!document.hidden) pollOnce()
}

onMounted(async () => {
  await loadMeta()
  await refreshAll()
  timer = setInterval(() => {
    if (!document.hidden) pollOnce()
  }, 60_000)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<style scoped>
.risk-page :deep(.ops-header) {
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
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 48px;
  padding: 0 16px;
  border-right: 1px solid #f1f5f9;
}
.sum-chip:last-child { border-right: none; }
.sum-chip.clickable { cursor: pointer; }
.sum-chip.clickable:hover { background: #eff6ff; }
.sum-chip.hot { background: #fff7f7; }
.sum-label { font-size: 12px; color: #64748b; white-space: nowrap; }
.sum-val {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.sum-val.hot { color: #ef4444; }
.sum-val.warn { color: #f59e0b; }
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
.filter-type { width: 140px; }
.filter-level { width: 110px; }
.filter-search { width: 180px; }
.filter-date { width: 340px; }
.panel-body {
  flex: 1;
  min-height: 0;
  padding: 0;
  background: #fff;
}
.panel-body :deep(.el-table) {
  --el-table-header-bg-color: #f1f5f9;
  --el-table-row-hover-bg-color: #eff6ff;
}
.panel-body :deep(.el-table th.el-table__cell) {
  color: #475569;
  font-weight: 600;
  background: #f1f5f9 !important;
}
.risk-table { width: 100%; }
.risk-table :deep(.el-table__row) { cursor: default; }
.panel-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  padding: 10px 14px;
  border-top: 1px solid #e2e8f0;
  background: #fff;
}
.cell-name {
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
  line-height: 1.35;
}
.cell-meta {
  margin-top: 3px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.3;
}
.type-label { font-weight: 600; color: #0f172a; cursor: help; }
.muted { color: #94a3b8; }
.hint { font-size: 12px; color: #64748b; margin-top: 4px; }
.mb16 { margin-bottom: 16px; }
.mt12 { margin-top: 12px; }
.detail-block {
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.detail-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
}
.player-block { font-size: 13px; line-height: 1.6; color: #0f172a; }
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  word-break: break-all;
}
.raw-collapse { margin-top: 12px; }
.raw-title { font-size: 12px; color: #94a3b8; }
.json {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  color: #475569;
  max-height: 280px;
  overflow: auto;
}
.drawer-actions { margin-top: 8px; }
</style>
