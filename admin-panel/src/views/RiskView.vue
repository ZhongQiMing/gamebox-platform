<template>
  <div class="ops-page risk-page">
    <PageHeader title="风控告警" subtitle="自动监测大额中奖、同 IP 多号、刷分与桌台对刷；处理留痕可复盘">
      <template #actions>
        <el-button :loading="loading" @click="refreshAll">刷新</el-button>
        <el-button type="success" :disabled="!selected.length" @click="batchHandle">
          批量处理{{ selected.length ? ` (${selected.length})` : '' }}
        </el-button>
      </template>
    </PageHeader>

    <div class="ops-kpi-row">
      <div
        v-for="k in kpis"
        :key="k.label"
        class="ops-kpi is-clickable"
        :class="k.tone"
        @click="k.onClick?.()"
      >
        <div class="ops-kpi__label">{{ k.label }}</div>
        <div class="ops-kpi__value">{{ k.value }}</div>
        <div v-if="k.hint" class="ops-kpi__hint">{{ k.hint }}</div>
      </div>
    </div>

    <el-card shadow="never" class="monitor-card">
      <div class="monitor-head">
        <span>监测能力</span>
        <el-button text type="primary" size="small" @click="showMonitors = !showMonitors">
          {{ showMonitors ? '收起' : '展开' }}
        </el-button>
      </div>
      <div v-show="showMonitors" class="monitor-grid">
        <div v-for="m in monitors" :key="m.type" class="monitor-item">
          <div class="monitor-title">{{ m.label }}</div>
          <div class="monitor-desc">{{ m.desc }}</div>
          <el-tag size="small" effect="plain">未处理 {{ summary?.byType?.[m.type] ?? 0 }}</el-tag>
        </div>
      </div>
    </el-card>

    <div class="ops-filter">
      <el-radio-group v-model="filter.handled" size="small" @change="onFilterChange">
        <el-radio-button :label="false">未处理</el-radio-button>
        <el-radio-button :label="true">已处理</el-radio-button>
        <el-radio-button label="">全部</el-radio-button>
      </el-radio-group>

      <el-select
        v-model="filter.type"
        clearable
        placeholder="告警类型"
        style="width: 140px"
        @change="onFilterChange"
      >
        <el-option v-for="t in typeOptions" :key="t.value" :label="t.label" :value="t.value" />
      </el-select>

      <el-select
        v-model="filter.level"
        clearable
        placeholder="级别"
        style="width: 110px"
        @change="onFilterChange"
      >
        <el-option label="严重" value="CRITICAL" />
        <el-option label="警告" value="WARN" />
        <el-option label="提示" value="INFO" />
      </el-select>

      <el-input
        v-model="filter.keyword"
        clearable
        placeholder="UID / 昵称 / 账号"
        style="width: 180px"
        @keyup.enter="onFilterChange"
      />

      <el-date-picker
        v-model="dateRange"
        type="datetimerange"
        range-separator="至"
        start-placeholder="开始"
        end-placeholder="结束"
        value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
        style="width: 340px"
        @change="onFilterChange"
      />

      <el-button type="primary" @click="onFilterChange">查询</el-button>
    </div>

    <div class="ops-table-wrap">
      <el-table
        :data="list"
        v-loading="loading"
        stripe
        empty-text="暂无告警 — 系统会在触发规则时自动写入"
        @selection-change="(rows: RiskEvent[]) => (selected = rows)"
        @row-click="openDetail"
      >
        <el-table-column type="selection" width="42" :selectable="(r: RiskEvent) => !r.handled" />
        <el-table-column label="级别" width="88">
          <template #default="{ row }">
            <el-tag :type="levelType(row.level)" size="small" effect="dark">{{ levelLabel(row.level) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="120">
          <template #default="{ row }">
            <el-tooltip :content="row.typeHint || row.type" placement="top">
              <span class="type-label">{{ row.typeLabel || row.type }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="关联玩家" min-width="140">
          <template #default="{ row }">
            <template v-if="row.target">
              <div class="player-main">{{ row.target.nickname }}</div>
              <div class="player-sub">{{ row.target.uid }} · IP {{ row.target.lastLoginIp || '—' }}</div>
            </template>
            <el-text v-else type="info">{{ shortId(row.targetId) }}</el-text>
          </template>
        </el-table-column>
        <el-table-column label="摘要" min-width="260">
          <template #default="{ row }">
            <el-text truncated>{{ row.summary || '—' }}</el-text>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="!row.handled" type="danger" size="small" effect="plain">待处理</el-tag>
            <el-tag v-else type="success" size="small" effect="plain">已处理</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click.stop="openDetail(row)">详情</el-button>
            <el-button
              v-if="!row.handled"
              size="small"
              type="success"
              @click.stop="handleOne(row)"
            >
              处理
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        class="ops-pager"
        :total="total"
        :page-size="filter.pageSize"
        :current-page="filter.page"
        layout="total,prev,pager,next"
        @current-change="(p: number) => { filter.page = p; load() }"
      />
    </div>

    <!-- 详情抽屉 -->
    <el-drawer v-model="drawer" title="告警详情" size="480px" destroy-on-close>
      <template v-if="current">
        <el-descriptions :column="1" border size="small" class="mb16">
          <el-descriptions-item label="级别">
            <el-tag :type="levelType(current.level)" size="small">{{ levelLabel(current.level) }}</el-tag>
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

        <el-card v-if="current.target" shadow="never" class="mb16">
          <template #header>关联玩家</template>
          <div class="player-block">
            <div><b>{{ current.target.nickname }}</b>（{{ current.target.uid }}）</div>
            <div class="hint">账号 {{ current.target.username }} · 状态 {{ current.target.status }}</div>
            <div class="hint">最近登录 IP {{ current.target.lastLoginIp || '—' }}</div>
          </div>
        </el-card>

        <el-card shadow="never" class="mb16">
          <template #header>原始明细</template>
          <pre class="json">{{ pretty(current.detail) }}</pre>
        </el-card>

        <div v-if="!current.handled" class="drawer-actions">
          <el-input
            v-model="handleNote"
            type="textarea"
            :rows="2"
            :placeholder="current.level === 'CRITICAL'
              ? '严重告警必填：核对结论 / 处理动作'
              : '处理备注（可选，如：已核对流水/已联系代理）'"
          />
          <el-button type="success" :loading="opLoading" style="margin-top:12px" @click="confirmHandle">
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
import PageHeader from '@/components/PageHeader.vue'
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
const monitors = ref<RiskMeta['monitors']>([])
const showMonitors = ref(true)
const drawer = ref(false)
const current = ref<RiskEvent | null>(null)
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
    tone: (summary.value?.unhandled ?? 0) > 0 ? 'is-danger' : '',
    hint: '需人工确认',
    onClick: () => {
      filter.handled = false
      onFilterChange()
    },
  },
  {
    label: '严重',
    value: summary.value?.critical ?? 0,
    tone: (summary.value?.critical ?? 0) > 0 ? 'is-danger' : '',
    hint: '优先处理',
    onClick: () => {
      filter.handled = false
      filter.level = 'CRITICAL'
      onFilterChange()
    },
  },
  {
    label: '警告',
    value: summary.value?.warn ?? 0,
    tone: 'is-warn',
    hint: '未处理警告',
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
    hint: '上海自然日',
  },
])

let timer: ReturnType<typeof setInterval> | null = null

async function loadMeta() {
  try {
    const m = await riskApi.meta()
    typeOptions.value = m.types
    monitors.value = m.monitors
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
  return new Date(s).toLocaleString('zh-CN', { hour12: false })
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

onMounted(async () => {
  await loadMeta()
  await refreshAll()
  timer = setInterval(() => {
    void loadSummary()
    if (filter.handled === false) void load()
  }, 60_000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.risk-page { max-width: none; }
.monitor-card { margin-bottom: 14px; }
.monitor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 8px;
}
.monitor-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
@media (max-width: 1100px) {
  .monitor-grid { grid-template-columns: repeat(2, 1fr); }
}
.monitor-item {
  padding: 10px 12px;
  background: #fafbfc;
  border-radius: 8px;
  border: 1px solid var(--ops-border-soft);
}
.monitor-title { font-size: 13px; font-weight: 600; color: var(--ops-text); }
.monitor-desc { margin: 4px 0 8px; font-size: 12px; color: var(--ops-muted); line-height: 1.4; }
.type-label { font-weight: 500; cursor: help; }
.player-main { font-weight: 500; }
.player-sub { font-size: 11px; color: var(--ops-muted); margin-top: 2px; }
.hint { font-size: 12px; color: var(--ops-muted); margin-top: 4px; }
.json {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  color: #606266;
  max-height: 280px;
  overflow: auto;
}
.drawer-actions { margin-top: 8px; }
.player-block { font-size: 13px; line-height: 1.6; }
</style>
