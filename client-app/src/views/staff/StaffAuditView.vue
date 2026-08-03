<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">资金流水</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <div v-if="loading" class="sp-empty">加载中…</div>
      <div v-else-if="!list.length" class="sp-empty">暂无记录</div>
      <div v-for="a in list" :key="a.id" class="audit-row">
        <div>
          <div class="a">{{ a.actionLabel }}</div>
          <div class="t">{{ fmtTime(a.createdAt) }} · {{ a.counterparty?.nickname || '—' }}</div>
        </div>
        <div class="amt" :class="amtClass(a)">{{ amtText(a) }}</div>
      </div>
      <div v-if="list.length < total" class="sp-empty">
        <button type="button" class="sc-logout" :disabled="loading" @click="loadMore">加载更多</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStaffStore } from '@/stores/staff'
import { staffConsoleApi, type StaffAuditRow } from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const loading = ref(false)
const list = ref<StaffAuditRow[]>([])
const page = ref(1)
const total = ref(0)
const pageSize = 20

function fmt(n?: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function fmtTime(v?: string) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}
function amtClass(a: StaffAuditRow) {
  if (a.action === 'QUOTA_RECALL' || a.action === 'CONSOLE_DEBIT') return 'down'
  return 'up'
}
function amtText(a: StaffAuditRow) {
  if (a.amount == null) return '—'
  const sign = amtClass(a) === 'down' ? '-' : '+'
  return `${sign}${fmt(Math.abs(a.amount))}`
}

async function fetchPage(p: number, append: boolean) {
  const uid = staff.profile?.id
  if (!uid) return
  loading.value = true
  try {
    const res = await staffConsoleApi.agentAudit(uid, { page: p, pageSize, tab: 'fund' })
    total.value = res.total
    page.value = p
    list.value = append ? [...list.value, ...res.list] : res.list
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function loadMore() {
  return fetchPage(page.value + 1, true)
}

onMounted(() => { void fetchPage(1, false) })
</script>
