<template>
  <div class="join-panel" v-loading="loading">
    <div class="join-toolbar">
      <span class="join-meta">待审 {{ rows.length }} 人</span>
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
    </div>
    <p v-if="readonly" class="join-hint">子账号只读查看；通过/拒绝请主代理操作。</p>
    <el-table :data="rows" stripe border size="small" empty-text="暂无进房申请" class="join-table">
      <el-table-column label="玩家" min-width="160">
        <template #default="{ row }: { row: any }">
          <div class="cell-name">{{ row.player?.nickname || '—' }}</div>
          <div class="cell-meta">{{ row.player?.uid }} · {{ row.player?.username }}</div>
        </template>
      </el-table-column>
      <el-table-column v-if="!roomId" label="房间" min-width="140">
        <template #default="{ row }: { row: any }">
          <div class="cell-name">{{ row.room?.name || '—' }}</div>
          <div class="cell-meta">{{ row.room?.roomNo }}</div>
        </template>
      </el-table-column>
      <el-table-column label="申请时间" width="148">
        <template #default="{ row }: { row: any }">{{ fmtTime(row.updatedAt || row.createdAt) }}</template>
      </el-table-column>
      <el-table-column v-if="!readonly" label="操作" width="140" align="right">
        <template #default="{ row }: { row: any }">
          <el-button
            link
            type="primary"
            :loading="busyId === row.id"
            @click="approve(row)"
          >通过</el-button>
          <el-button
            link
            type="danger"
            :loading="busyId === row.id"
            @click="reject(row)"
          >拒绝</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { consoleApi, type JoinPendingRow } from '@/api/console'

const props = defineProps<{
  /** 传入则只显示该房申请 */
  roomId?: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  changed: []
  /** 当前筛选后的待审人数（供父级高亮「进房审核」） */
  pending: [count: number]
}>()

const loading = ref(false)
const list = ref<JoinPendingRow[]>([])
const busyId = ref<string | null>(null)

const rows = ref<JoinPendingRow[]>([])

function applyFilter() {
  const all = list.value
  rows.value = props.roomId
    ? all.filter((r) => r.roomId === props.roomId)
    : all
  emit('pending', rows.value.length)
}

function fmtTime(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    const res = await consoleApi.joinPending()
    list.value = res.list || []
    applyFilter()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}

async function approve(row: JoinPendingRow) {
  if (props.readonly || busyId.value) return
  busyId.value = row.id
  try {
    await consoleApi.joinApprove(row.id)
    ElMessage.success('已通过')
    list.value = list.value.filter((x) => x.id !== row.id)
    applyFilter()
    emit('changed')
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '操作失败')
  } finally {
    busyId.value = null
  }
}

async function reject(row: JoinPendingRow) {
  if (props.readonly || busyId.value) return
  try {
    await ElMessageBox.confirm(
      `拒绝「${row.player?.nickname || row.player?.uid}」的进房申请？`,
      '拒绝进房',
      { type: 'warning', confirmButtonText: '拒绝' },
    )
  } catch {
    return
  }
  busyId.value = row.id
  try {
    await consoleApi.joinReject(row.id)
    ElMessage.success('已拒绝')
    list.value = list.value.filter((x) => x.id !== row.id)
    applyFilter()
    emit('changed')
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '操作失败')
  } finally {
    busyId.value = null
  }
}

watch(() => props.roomId, applyFilter)
onMounted(() => { void load() })

defineExpose({ load })
</script>

<style scoped>
.join-panel { display: flex; flex-direction: column; gap: 10px; }
.join-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.join-meta {
  font-size: 13px;
  color: var(--ops-muted, #64748b);
}
.join-hint {
  margin: 0;
  font-size: 12px;
  color: var(--ops-muted, #64748b);
}
.join-table { width: 100%; }
.cell-name { font-weight: 600; color: #0f172a; }
.cell-meta { margin-top: 2px; font-size: 12px; color: #64748b; }
</style>
