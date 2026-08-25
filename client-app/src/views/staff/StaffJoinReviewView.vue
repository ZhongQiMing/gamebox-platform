<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">进房审核</div>
      <div class="right sc-bar-act" @click="reload">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <div class="sf-head">
        <span>待审 {{ list.length }} 人</span>
      </div>

      <div v-if="loading && !list.length" class="sp-empty">加载中…</div>
      <div v-else-if="!list.length" class="sp-empty">暂无进房申请</div>

      <div v-for="row in list" :key="row.id" class="sp-row">
        <div class="top">
          <div class="name">{{ row.player?.nickname || '—' }}</div>
          <div class="bal t">{{ fmtTime(row.updatedAt || row.createdAt) }}</div>
        </div>
        <div class="meta">
          {{ row.player?.uid || '—' }} · {{ row.room?.name || '房间' }}
          （{{ row.room?.roomNo }}）
        </div>
        <div class="ops">
          <button type="button" :disabled="busyId === row.id" @click="askApprove(row)">通过</button>
          <button
            type="button"
            class="down"
            :disabled="busyId === row.id"
            @click="askReject(row)"
          >拒绝</button>
        </div>
      </div>
    </div>

    <AppModal
      :visible="confirmVisible"
      :title="confirmTitle"
      :message="confirmMessage"
      :ok-text="confirmOkText"
      cancel-text="取消"
      @ok="doConfirm"
      @cancel="closeConfirm"
    />

    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { formatDateTime } from '@gamebox/shared'
import { staffConsoleApi, type StaffJoinRow } from '@/api/staffConsole'
import AppModal from '@/components/AppModal.vue'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const { toast } = useToast()

const loading = ref(false)
const list = ref<StaffJoinRow[]>([])
const busyId = ref<string | null>(null)

function fmtTime(iso?: string) {
  return iso ? formatDateTime(iso) : ''
}

async function reload() {
  loading.value = true
  try {
    const res = await staffConsoleApi.joinPending()
    list.value = res.list || []
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

/* 通过和拒绝都一点就生效，误触没法撤回，统一走确认弹窗 */
type ConfirmMode = 'approve' | 'reject'
const confirmVisible = ref(false)
const confirmMode = ref<ConfirmMode>('approve')
const confirmTarget = ref<StaffJoinRow | null>(null)

const confirmTitle = computed(() =>
  confirmMode.value === 'approve' ? '确认通过' : '确认拒绝',
)
const confirmOkText = computed(() =>
  confirmMode.value === 'approve' ? '确认通过' : '确认拒绝',
)
const confirmMessage = computed(() => {
  const row = confirmTarget.value
  if (!row) return ''
  const who = row.player?.nickname || row.player?.uid || '该玩家'
  const room = row.room?.name ? `${row.room.name}（${row.room.roomNo}）` : '本房间'
  return confirmMode.value === 'approve'
    ? `通过「${who}」进入 ${room}？\n通过后立即进房，并按默认挂靠归属。`
    : `拒绝「${who}」进入 ${room}？`
})

function askApprove(row: StaffJoinRow) {
  if (busyId.value) return
  confirmMode.value = 'approve'
  confirmTarget.value = row
  confirmVisible.value = true
}

function askReject(row: StaffJoinRow) {
  if (busyId.value) return
  confirmMode.value = 'reject'
  confirmTarget.value = row
  confirmVisible.value = true
}

function closeConfirm() {
  if (busyId.value) return
  confirmVisible.value = false
  confirmTarget.value = null
}

async function doConfirm() {
  const row = confirmTarget.value
  if (!row || busyId.value) return
  const approving = confirmMode.value === 'approve'
  confirmVisible.value = false
  busyId.value = row.id
  try {
    if (approving) await staffConsoleApi.joinApprove(row.id)
    else await staffConsoleApi.joinReject(row.id)
    toast(approving ? '已通过' : '已拒绝')
    list.value = list.value.filter((x) => x.id !== row.id)
    confirmTarget.value = null
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    busyId.value = null
  }
}

onMounted(() => { void reload() })
</script>

<style scoped>
.sf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 2px 12px;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.55);
}
.sp-row .bal.t {
  font-size: 11px;
  color: rgba(244, 211, 107, 0.45);
}
</style>
