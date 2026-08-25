<template>
  <div class="desk-work settle-page" v-loading="loading && view === 'list'">
    <div class="desk-panel">
      <PageHeader :title="headerTitle">
        <template #actions>
          <el-button v-if="view !== 'list' && !(isGeneralUser && view === 'general')" @click="backToList">{{ backLabel }}</el-button>
          <el-button
            v-if="view === 'general' && !isGeneralUser"
            type="primary"
            :loading="exporting"
            @click="exportCurrent"
          >导出工资条</el-button>
          <el-button
            v-if="view === 'room'"
            type="primary"
            :loading="exporting"
            @click="exportCurrent"
          >{{ roomExportLabel }}</el-button>
          <el-button :loading="loading" @click="refresh">刷新</el-button>
        </template>
      </PageHeader>

      <div v-if="view === 'list'" class="rooms-summary">
        <div class="sum-chip">
          <span class="sum-label">总代</span>
          <span class="sum-val">{{ generalRows.length }}</span>
        </div>
        <div class="sum-chip">
          <span class="sum-label">直挂房间</span>
          <span class="sum-val">{{ roomRows.length }}</span>
        </div>
        <div class="sum-period">
          <el-radio-group v-model="period" size="small" @change="onPeriodChange">
            <el-radio-button label="current">本期</el-radio-button>
            <el-radio-button label="last">上期</el-radio-button>
            <el-radio-button label="early">提前结账</el-radio-button>
          </el-radio-group>
        </div>
      </div>

      <div v-else-if="view === 'general'" class="panel-toolbar">
        <el-radio-group v-model="period" size="small" @change="onPeriodChange">
          <el-radio-button label="current">本期</el-radio-button>
          <el-radio-button label="last">上期</el-radio-button>
          <el-radio-button label="early">提前结账</el-radio-button>
        </el-radio-group>
      </div>

      <div class="panel-body" :class="{ 'is-stack': view !== 'list' }">
        <el-table
          v-if="view === 'list'"
          :data="rows"
          class="settle-table"
          stripe
          border
          size="small"
          height="100%"
          empty-text="暂无结算对象"
        >
          <el-table-column label="结算对象" min-width="280">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ row.title }}</div>
              <div class="cell-meta">{{ row.subtitle }}</div>
            </template>
          </el-table-column>
          <el-table-column label="类型" min-width="140" align="center">
            <template #default="{ row }: { row: any }">
              <span class="kind-pill" :class="row.kind">{{ row.kind === 'room' ? '直挂' : '总代' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="明细" min-width="260">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ row.detail }}</div>
              <div v-if="row.detailMeta" class="cell-meta">{{ row.detailMeta }}</div>
            </template>
          </el-table-column>
          <el-table-column label="盘口" min-width="160" align="center">
            <template #default="{ row }: { row: any }">
              <span class="book-pill" :class="row.bookLabel.includes('信用') ? 'credit' : 'cash'">
                {{ row.bookLabel }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" min-width="180" align="center">
            <template #default="{ row }: { row: any }">
              <div class="ops" @click.stop>
                <el-button type="primary" link @click="openRow(row)">
                  {{ row.kind === 'room' ? '去结账' : '拉总表' }}
                </el-button>
                <el-button link :loading="exportingKey === row.key" @click="exportRow(row)">导出</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <GeneralSettleView
          v-else-if="view === 'general' && currentGeneralId"
          ref="generalPanel"
          embedded
          :forced-id="currentGeneralId"
          :period="period"
        />

        <div v-else-if="view === 'room' && currentRoomId" class="room-box">
          <RoomSettlePanel
            ref="roomPanel"
            embedded
            :room-id="currentRoomId"
            :readonly="settleReadonly"
            :initial-period="period"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import GeneralSettleView from '@/views/GeneralSettleView.vue'
import RoomSettlePanel from '@/views/room-detail/RoomSettlePanel.vue'
import {
  consoleApi,
  type ConsoleRoom,
  type SettlePeriod,
} from '@/api/console'
import { isGeneralSide } from '@gamebox/shared'
import { useAdminStore } from '@/stores/admin'

type ViewKind = 'list' | 'general' | 'room'
type SettleRow = {
  key: string
  kind: 'general' | 'room'
  id: string
  title: string
  subtitle: string
  detail: string
  detailMeta: string
  bookLabel: string
}

const route = useRoute()
const router = useRouter()
const store = useAdminStore()
const isGeneralUser = computed(() => isGeneralSide(store.profile?.role, store.profile?.parentRole))
const generalRootId = computed(() =>
  store.profile?.role === 'GENERAL'
    ? (store.profile?.id || '')
    : (store.profile?.parentId || ''),
)
const loading = ref(false)
const exporting = ref(false)
const exportingKey = ref('')
const rooms = ref<ConsoleRoom[]>([])
const generals = ref<{ id: string; nickname: string; username: string; uid?: string }[]>([])
const view = ref<ViewKind>('list')
const currentGeneralId = ref('')
const currentRoomId = ref('')
const period = ref<SettlePeriod>('current')
const generalPanel = ref<{ reload: () => Promise<void> } | null>(null)
const roomPanel = ref<{ reloadAll: () => Promise<void>; onExport: () => Promise<void> } | null>(null)

const settleReadonly = computed(() => {
  const r = store.profile?.role
  if (r === 'ADMIN' || r === 'BRANCH') {
    const room = rooms.value.find((x) => x.id === currentRoomId.value)
    return !!room?.general?.userId
  }
  return !isGeneralUser.value
})

const directRooms = computed(() => rooms.value.filter((r) => !r.general?.userId))

const generalRows = computed<SettleRow[]>(() => {
  const byGeneral = new Map<string, ConsoleRoom[]>()
  for (const r of rooms.value) {
    const gid = r.general?.userId
    if (!gid) continue
    const list = byGeneral.get(gid) ?? []
    list.push(r)
    byGeneral.set(gid, list)
  }
  const seen = new Set<string>()
  const out: SettleRow[] = []
  const pushGeneral = (
    id: string,
    title: string,
    subtitle: string,
    list: ConsoleRoom[],
  ) => {
    if (seen.has(id)) return
    seen.add(id)
    const credit = list.some((r) => r.bookMode === 'CREDIT')
    const cash = list.some((r) => r.bookMode !== 'CREDIT')
    out.push({
      key: `g-${id}`,
      kind: 'general',
      id,
      title,
      subtitle,
      detail: list.length ? `${list.length} 间房` : '暂无房间',
      detailMeta: '名下房间',
      bookLabel: list.length
        ? (credit && cash ? '现金+信用' : credit ? 'B 信用' : 'A 现金')
        : '—',
    })
  }
  for (const g of generals.value) {
    pushGeneral(
      g.id,
      g.nickname || '总代',
      g.username ? `${g.username}${g.uid ? ` · ${g.uid}` : ''}` : g.id,
      byGeneral.get(g.id) ?? [],
    )
  }
  for (const [id, list] of byGeneral) {
    const g = list[0]?.general
    pushGeneral(id, g?.nickname || '总代', g?.username || id, list)
  }
  return out
})

const roomRows = computed<SettleRow[]>(() =>
  [...directRooms.value]
    .sort((a, b) => a.roomNo.localeCompare(b.roomNo))
    .map((r) => ({
      key: `r-${r.id}`,
      kind: 'room' as const,
      id: r.id,
      title: r.name || r.roomNo,
      subtitle: `进房号 ${r.roomNo}`,
      detail: r.agent?.nickname || r.agent?.username || '未绑定代理',
      detailMeta: r.agent?.username
        ? `${r.agent.username}${r.agent.uid ? ` · ${r.agent.uid}` : ''}`
        : '',
      bookLabel: r.bookMode === 'CREDIT' ? 'B 信用' : 'A 现金',
    })),
)

const rows = computed(() => [...generalRows.value, ...roomRows.value])

const headerTitle = computed(() => {
  if (view.value === 'general') return '总代结算总表'
  if (view.value === 'room') {
    const room = rooms.value.find((x) => x.id === currentRoomId.value)
    return room?.general?.userId ? '房间结账' : '房间占成详情'
  }
  return '结算中心'
})
const backLabel = computed(() => {
  if (view.value === 'room' && currentGeneralId.value) return '返回总表'
  return '返回列表'
})
const roomExportLabel = computed(() => {
  const room = rooms.value.find((x) => x.id === currentRoomId.value)
  return room?.general?.userId ? '导出工资条' : '导出对账单'
})

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

function syncQuery() {
  const q: Record<string, string> = { period: period.value }
  if (view.value === 'general' && currentGeneralId.value) q.generalUserId = currentGeneralId.value
  if (view.value === 'room' && currentRoomId.value) {
    q.roomId = currentRoomId.value
    if (currentGeneralId.value) q.generalUserId = currentGeneralId.value
  }
  void router.replace({ query: q })
}

function openRow(row: SettleRow) {
  if (row.kind === 'room') {
    view.value = 'room'
    currentRoomId.value = row.id
    currentGeneralId.value = ''
    syncQuery()
    return
  }
  view.value = 'general'
  currentGeneralId.value = row.id
  currentRoomId.value = ''
  syncQuery()
}

function backToList() {
  if (view.value === 'room' && currentGeneralId.value) {
    view.value = 'general'
    currentRoomId.value = ''
    syncQuery()
    return
  }
  if (isGeneralUser.value) {
    view.value = 'general'
    currentGeneralId.value = generalRootId.value
    currentRoomId.value = ''
    syncQuery()
    return
  }
  view.value = 'list'
  currentGeneralId.value = ''
  currentRoomId.value = ''
  syncQuery()
}

async function exportRow(row: SettleRow) {
  exportingKey.value = row.key
  try {
    const res = row.kind === 'room'
      ? await consoleApi.exportRoomWeekSettle(row.id, { period: period.value })
      : await consoleApi.exportGeneralSettle({
          generalUserId: row.id,
          period: period.value,
        })
    downloadCsv(res)
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '导出失败')
  } finally {
    exportingKey.value = ''
  }
}

async function exportCurrent() {
  exporting.value = true
  try {
    if (view.value === 'room') {
      await roomPanel.value?.onExport()
      return
    }
    if (view.value === 'general' && currentGeneralId.value) {
      downloadCsv(await consoleApi.exportGeneralSettle({
        generalUserId: currentGeneralId.value,
        period: period.value,
      }))
    }
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '导出失败')
  } finally {
    exporting.value = false
  }
}

function onPeriodChange() {
  syncQuery()
}

async function loadRooms() {
  loading.value = true
  try {
    const roomList = await consoleApi.rooms({ includeClosed: false })
    rooms.value = roomList
    if (isGeneralUser.value) {
      generals.value = []
      return
    }
    const agentPage = await consoleApi.agentsAll({ role: 'GENERAL', boundOnly: false }).catch(() => ({ list: [] as Array<{
      id: string; nickname: string; username: string; uid?: string
    }> }))
    generals.value = (agentPage.list || []).map((a) => ({
      id: a.id,
      nickname: a.nickname,
      username: a.username || '',
      uid: a.uid,
    }))
  } finally {
    loading.value = false
  }
}

async function refresh() {
  await loadRooms()
  if (view.value === 'general') await generalPanel.value?.reload()
  if (view.value === 'room') await roomPanel.value?.reloadAll()
}

function applyQuery() {
  const p = route.query.period
  if (p === 'current' || p === 'last' || p === 'early') period.value = p
  const gid = typeof route.query.generalUserId === 'string' ? route.query.generalUserId : ''
  const rid = typeof route.query.roomId === 'string' ? route.query.roomId : ''
  if (rid) {
    view.value = 'room'
    currentRoomId.value = rid
    currentGeneralId.value = gid || (isGeneralUser.value ? generalRootId.value : '')
    return
  }
  if (isGeneralUser.value) {
    view.value = 'general'
    currentGeneralId.value = generalRootId.value
    currentRoomId.value = ''
    return
  }
  if (gid) {
    view.value = 'general'
    currentGeneralId.value = gid
    currentRoomId.value = ''
    return
  }
  view.value = 'list'
  currentGeneralId.value = ''
  currentRoomId.value = ''
}

onMounted(async () => {
  applyQuery()
  await loadRooms()
})

watch(
  () => [
    String(route.query.roomId || ''),
    String(route.query.generalUserId || ''),
    String(route.query.period || ''),
  ],
  () => {
    applyQuery()
  },
)
</script>

<style scoped>
.settle-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
  flex-shrink: 0;
}
.rooms-summary {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0;
  flex-shrink: 0;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.sum-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  min-height: 52px;
  padding: 0 20px;
  border-right: 1px solid #f1f5f9;
}
.sum-period {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  padding: 0 20px;
}
.sum-label { font-size: 12px; color: #64748b; white-space: nowrap; }
.sum-val {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.panel-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
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
  overflow: hidden;
}
.panel-body.is-stack {
  overflow: auto;
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
.settle-table { width: 100%; }
.settle-table :deep(.el-table__inner-wrapper),
.settle-table :deep(.el-table__header),
.settle-table :deep(.el-table__body) { width: 100% !important; }
.settle-table :deep(.el-table__row) { cursor: default; }
.settle-table :deep(.el-table__cell) { padding: 14px 20px; }
.cell-name { font-weight: 650; color: #0f172a; line-height: 1.35; }
.cell-meta { margin-top: 3px; font-size: 12px; color: #64748b; line-height: 1.35; }
.kind-pill,
.book-pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}
.kind-pill.general { background: #fff7ed; color: #c2410c; }
.kind-pill.room { background: #f0fdf4; color: #15803d; }
.book-pill.cash { background: #eff6ff; color: #1d4ed8; }
.book-pill.credit { background: #fffbeb; color: #b45309; }
.ops { display: inline-flex; gap: 2px; }
.room-box {
  min-height: 100%;
}
</style>
