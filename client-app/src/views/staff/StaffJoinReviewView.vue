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
          <button type="button" :disabled="busyId === row.id" @click="approve(row)">通过</button>
          <button
            type="button"
            class="down"
            :disabled="busyId === row.id"
            @click="reject(row)"
          >拒绝</button>
        </div>
      </div>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { staffConsoleApi, type StaffJoinRow } from '@/api/staffConsole'
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
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
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

async function approve(row: StaffJoinRow) {
  if (busyId.value) return
  busyId.value = row.id
  try {
    await staffConsoleApi.joinApprove(row.id)
    toast('已通过')
    list.value = list.value.filter((x) => x.id !== row.id)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    busyId.value = null
  }
}

async function reject(row: StaffJoinRow) {
  if (busyId.value) return
  busyId.value = row.id
  try {
    await staffConsoleApi.joinReject(row.id)
    toast('已拒绝')
    list.value = list.value.filter((x) => x.id !== row.id)
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
