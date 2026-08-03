<template>
  <div class="ops-page log-page">
    <PageHeader title="操作日志" subtitle="谁在什么时候做了什么——白话展示，点行可看明细">
      <template #actions>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </template>
    </PageHeader>

    <div class="ops-filter">
      <el-select
        v-model="filter.action"
        clearable
        filterable
        placeholder="操作类型"
        style="width: 180px"
        @change="onFilterChange"
      >
        <el-option-group v-for="g in actionGroups" :key="g.name" :label="g.name">
          <el-option v-for="a in g.items" :key="a.value" :label="a.label" :value="a.value" />
        </el-option-group>
      </el-select>

      <el-input
        v-model="filter.keyword"
        clearable
        placeholder="操作人 / 目标 / UID / 房间号"
        style="width: 220px"
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
        empty-text="暂无操作记录"
        @row-click="openDetail"
      >
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作人" width="130">
          <template #default="{ row }">
            <div class="op-name">{{ row.operator.nickname }}</div>
            <div class="op-sub">{{ row.operator.roleLabel || row.operator.role }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" type="info">{{ row.actionLabel || row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="对象" min-width="150">
          <template #default="{ row }">
            <span>{{ row.targetLabel || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="280">
          <template #default="{ row }">
            <el-text truncated>{{ row.summary || '—' }}</el-text>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="72" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click.stop="openDetail(row)">详情</el-button>
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

    <el-drawer v-model="drawer" title="日志详情" size="460px" destroy-on-close>
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

        <el-card shadow="never">
          <template #header>技术明细（排查用）</template>
          <div v-if="current.target" class="hint mb8">原始目标 ID：{{ current.target }}</div>
          <pre class="json">{{ pretty(current.detail) }}</pre>
        </el-card>
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
.log-page { max-width: none; }
.op-name { font-weight: 500; }
.op-sub { font-size: 11px; color: var(--ops-muted); margin-top: 2px; }
.hint { font-size: 12px; color: var(--ops-muted); }
.json {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  color: #606266;
  max-height: 320px;
  overflow: auto;
}
</style>
