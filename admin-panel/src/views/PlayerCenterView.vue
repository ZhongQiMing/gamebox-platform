<template>
  <div class="desk-work players-page" v-loading="loading">
    <div class="desk-panel">
      <PageHeader title="玩家中心">
        <template #actions>
          <el-button :loading="loading" @click="load">刷新</el-button>
        </template>
      </PageHeader>

      <div class="pc-summary">
        <div class="sum-chip">
          <span class="sum-label">玩家总数</span>
          <span class="sum-val">{{ total }}</span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">本页</span>
          <span class="sum-val">{{ rows.length }}</span>
        </div>
        <div class="sum-chip" :class="{ hot: disabledCount > 0 }">
          <span class="sum-label">本页停用</span>
          <span class="sum-val" :class="{ hot: disabledCount > 0 }">{{ disabledCount }}</span>
        </div>
      </div>

      <div class="panel-toolbar">
        <el-input
          v-model="keyword"
          placeholder="UID / 昵称 / 账号"
          size="small"
          clearable
          class="pc-search"
          @keyup.enter="onSearch"
          @clear="onSearch"
        />
        <el-select
          v-model="roomId"
          size="small"
          clearable
          placeholder="全部房间"
          class="pc-room"
          @change="onSearch"
        >
          <el-option
            v-for="r in rooms"
            :key="r.id"
            :label="`${r.name}（${r.roomNo}）`"
            :value="r.id"
          />
        </el-select>
        <el-select
          v-model="points"
          size="small"
          clearable
          placeholder="持分不限"
          class="pc-points"
          @change="onSearch"
        >
          <el-option label="有持分" value="positive" />
          <el-option label="持分为 0" value="zero" />
        </el-select>
        <span class="toolbar-grow" />
        <el-button type="primary" size="small" :loading="loading" @click="onSearch">查询</el-button>
      </div>

      <div class="panel-body">
        <el-table
          :data="rows"
          v-loading="loading"
          class="pc-table"
          stripe
          border
          size="small"
          height="100%"
          empty-text="没有符合条件的玩家"
          :row-class-name="rowClass"
        >
          <el-table-column label="玩家" min-width="200">
            <template #default="{ row }: { row: any }">
              <div class="pc-name">{{ row.nickname }}</div>
              <div class="pc-uid">{{ row.uid }}</div>
            </template>
          </el-table-column>
          <el-table-column label="账号" min-width="150">
            <template #default="{ row }: { row: any }">
              <span class="pc-mono">{{ row.username }}</span>
            </template>
          </el-table-column>
          <el-table-column label="IP" min-width="150">
            <template #default="{ row }: { row: any }">
              <span v-if="row.lastLoginIp" class="pc-mono">{{ row.lastLoginIp }}</span>
              <span v-else class="pc-muted">未登录过</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110" align="center">
            <template #default="{ row }: { row: any }">
              <el-tag size="small" effect="plain" :type="row.status === 'ACTIVE' ? 'success' : 'info'">
                {{ row.status === 'ACTIVE' ? '正常' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" align="center">
            <template #default="{ row }: { row: any }">
              <el-button type="primary" size="small" plain @click="openProfile(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel-foot">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="load"
        />
      </div>
    </div>

    <PlayerProfileDialog v-model="profileOpen" :player-id="profileId" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import PlayerProfileDialog from '@/components/PlayerProfileDialog.vue'
import { consoleApi, type ConsoleRoom, type PlayerPage } from '@/api/console'

type PlayerRow = PlayerPage['list'][number]

const loading = ref(false)
const rows = ref<PlayerRow[]>([])
const rooms = ref<ConsoleRoom[]>([])
const keyword = ref('')
const roomId = ref('')
const points = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)

const profileOpen = ref(false)
const profileId = ref('')

const disabledCount = computed(() => rows.value.filter((r) => r.status !== 'ACTIVE').length)

function rowClass({ row }: { row: PlayerRow }) {
  return row.status === 'ACTIVE' ? '' : 'is-off'
}

function openProfile(row: PlayerRow) {
  profileId.value = row.id
  profileOpen.value = true
}

function onSearch() {
  page.value = 1
  void load()
}

async function load() {
  loading.value = true
  try {
    const res = await consoleApi.players({
      page: page.value,
      pageSize: pageSize.value,
      q: keyword.value.trim() || undefined,
      roomId: roomId.value || undefined,
      points: points.value || undefined,
    })
    rows.value = res.list
    total.value = res.total
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    rooms.value = await consoleApi.rooms()
  } catch {
    /* 房间筛选拉不到不影响列表 */
  }
  await load()
})
</script>

<style scoped>
/* 与其他页面同一套：标题栏复位到面板内边距，不吃全局的负 margin */
.players-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
  flex-shrink: 0;
}
.pc-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
  padding: 0 18px;
  border-right: 1px solid #f1f5f9;
}
.sum-chip:last-child { border-right: none; }
.sum-chip.hot { background: #fff7f7; }
.sum-label { font-size: 12px; color: #64748b; white-space: nowrap; }
.sum-val {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.sum-val.hot { color: #ef4444; }

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
.panel-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  padding: 10px 14px;
  border-top: 1px solid #e2e8f0;
  background: #fff;
}
.toolbar-grow { flex: 1; }
.pc-search { width: 220px; }
.pc-room { width: 210px; }
.pc-points { width: 140px; }

.pc-table { width: 100%; }
.pc-name {
  font-weight: 600;
  color: #0f172a;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pc-uid {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
.pc-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: #334155;
}
.pc-muted { font-size: 12px; color: #cbd5e1; }
.pc-table :deep(.is-off) { opacity: 0.6; }
</style>
