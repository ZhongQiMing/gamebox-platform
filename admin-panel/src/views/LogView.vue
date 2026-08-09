<template>
  <div class="desk-work log-page">
    <div class="desk-panel">
      <PageHeader title="操作日志">
        <template #actions>
          <el-button :loading="loading" @click="load">刷新</el-button>
        </template>
      </PageHeader>

      <div class="panel-toolbar">
        <el-select
          v-model="filter.action"
          clearable
          filterable
          size="small"
          placeholder="操作类型"
          class="filter-action"
          @change="onFilterChange"
        >
          <el-option-group v-for="g in actionGroups" :key="g.name" :label="g.name">
            <el-option v-for="a in g.items" :key="a.value" :label="a.label" :value="a.value" />
          </el-option-group>
        </el-select>

        <el-input
          v-model="filter.keyword"
          clearable
          size="small"
          placeholder="操作人 / 目标 / UID / 房间号"
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
          class="log-table"
          stripe
          border
          size="small"
          height="100%"
          empty-text="暂无操作记录"
          @row-click="openDetail"
        >
          <el-table-column label="时间" width="160">
            <template #default="{ row }: { row: any }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作人" width="140">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ row.operator.nickname }}</div>
              <div class="cell-meta">{{ row.operator.roleLabel || row.operator.role }}</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140">
            <template #default="{ row }: { row: any }">
              <el-tag size="small" effect="plain" type="info">{{ row.actionLabel || row.action }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="对象" min-width="150">
            <template #default="{ row }: { row: any }">
              <span>{{ row.targetLabel || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="260">
            <template #default="{ row }: { row: any }">
              <el-text truncated>{{ row.summary || '—' }}</el-text>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="72" fixed="right" align="right">
            <template #default="{ row }: { row: any }">
              <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
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

    <el-drawer v-model="drawer" class="desk-drawer" title="日志详情" size="460px" destroy-on-close>
      <template v-if="current">
        <el-descriptions :column="1" border size="small" class="mb16">
          <el-descriptions-item label="时间">{{ fmtTime(current.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="操作人">
            {{ current.operator.nickname }}
            <span class="hint"> · {{ current.operator.roleLabel }} · {{ current.operator.uid }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="操作">
            {{ current.actionLabel }}
            <span class="hint">（{{ current.actionGroup }} · {{ current.action }}）</span>
          </el-descriptions-item>
          <el-descriptions-item label="对象">{{ current.targetLabel || '—' }}</el-descriptions-item>
          <el-descriptions-item label="说明">{{ current.summary }}</el-descriptions-item>
          <el-descriptions-item v-if="current.ip" label="IP">{{ current.ip }}</el-descriptions-item>
        </el-descriptions>

        <div class="detail-block">
          <div class="detail-title">技术明细</div>
          <div v-if="current.target" class="hint mb8">原始目标 ID：{{ current.target }}</div>
          <pre class="json">{{ pretty(current.detail) }}</pre>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import { adminLogApi, type AdminLogItem, type LogActionOption } from '@/api/admin'

const list = ref<AdminLogItem[]>([])
const total = ref(0)
const loading = ref(false)
const actions = ref<LogActionOption[]>([])
const dateRange = ref<[string, string] | null>(null)
const drawer = ref(false)
const current = ref<AdminLogItem | null>(null)

const filter = reactive({
  action: '',
  keyword: '',
  page: 1,
  pageSize: 20,
})

const actionGroups = computed(() => {
  const map = new Map<string, LogActionOption[]>()
  for (const a of actions.value) {
    const g = a.group || '其他'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(a)
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }))
})

async function loadMeta() {
  try {
    const m = await adminLogApi.meta()
    actions.value = m.actions
  } catch {
    /* ignore */
  }
}

async function load() {
  loading.value = true
  try {
    const res = await adminLogApi.list({
      action: filter.action || undefined,
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

function onFilterChange() {
  filter.page = 1
  void load()
}

function openDetail(row: AdminLogItem) {
  current.value = row
  drawer.value = true
}

function fmtTime(s: string) {
  return new Date(s).toLocaleString('zh-CN', { hour12: false })
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
  await load()
})
</script>

<style scoped>
.log-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
  flex-shrink: 0;
}
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
.filter-action { width: 180px; }
.filter-search { width: 220px; }
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
.log-table { width: 100%; }
.log-table :deep(.el-table__row) { cursor: pointer; }
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
.hint { font-size: 12px; color: #64748b; }
.mb8 { margin-bottom: 8px; }
.mb16 { margin-bottom: 16px; }
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
.json {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  color: #475569;
  max-height: 320px;
  overflow: auto;
}
</style>
