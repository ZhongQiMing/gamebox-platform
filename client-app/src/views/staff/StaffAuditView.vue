<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div v-if="!isCs" class="back" @click="router.back()">‹</div>
      <div v-else class="back"></div>
      <div class="title">{{ pageTitle }}</div>
      <div class="right sc-bar-act" @click="reload">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <div v-if="showTabs" class="sp-tabs sf-tabs" :data-count="3">
        <button type="button" :class="{ on: tab === 'balance' }" @click="switchTab('balance')">余额</button>
        <button type="button" :class="{ on: tab === 'fund' }" @click="switchTab('fund')">上下分</button>
        <button type="button" :class="{ on: tab === 'wage' }" @click="switchTab('wage')">佣金</button>
      </div>

      <div class="rm-sum" v-if="!loading && list.length">
        <span>共 {{ total }} 条</span>
        <span>本页 {{ list.length }}</span>
      </div>

      <div v-if="loading && !list.length" class="sp-empty">加载中…</div>
      <div v-else-if="!list.length" class="sp-empty">{{ emptyText }}</div>

      <div v-for="a in list" :key="a.id" class="audit-row">
        <div>
          <div class="a">{{ a.title }}</div>
          <div class="t">{{ a.sub }}</div>
        </div>
        <div v-if="a.amountText" class="amt" :class="a.amountClass">{{ a.amountText }}</div>
      </div>

      <div v-if="list.length < total" class="sp-empty">
        <button type="button" class="sc-logout" :disabled="loading" @click="loadMore">加载更多</button>
      </div>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStaffStore } from '@/stores/staff'
import StaffTabBar from '@/components/StaffTabBar.vue'
import {
  staffConsoleApi,
  type StaffAdminLogItem,
  type StaffAuditRow,
} from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

type Row = {
  id: string
  title: string
  sub: string
  amountText?: string
  amountClass?: string
}

type AuditTab = 'balance' | 'fund' | 'wage'

const route = useRoute()
const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const isLandlord = computed(() => staff.role === 'ADMIN' || staff.role === 'BRANCH')
const isCs = computed(() => staff.isCs)
const showTabs = computed(() => isCs.value)
const pageTitle = computed(() => {
  if (isLandlord.value) return '流水日志'
  if (isCs.value) return '明 细'
  return '资金流水'
})
const emptyText = computed(() => {
  if (isLandlord.value) return '暂无最近操作'
  if (tab.value === 'balance') return '暂无余额流水'
  if (tab.value === 'wage') return '暂无佣金入账'
  if (tab.value === 'fund') return '暂无上下分记录'
  return '暂无资金流水'
})

const tab = ref<AuditTab>('balance')
const loading = ref(false)
const list = ref<Row[]>([])
const page = ref(1)
const total = ref(0)
const pageSize = computed(() => (isLandlord.value ? 10 : 20))

function fmt(n?: number | null) {
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

function mapAdminLog(a: StaffAdminLogItem): Row {
  return {
    id: a.id,
    title: a.actionLabel || a.action,
    sub: `${fmtTime(a.createdAt)} · ${a.operator?.nickname || '—'}${a.summary ? ` · ${a.summary}` : ''}`,
  }
}

function csFundTitle(action: string, label: string) {
  if (action === 'CS_STAFF_ALLOC') return '代理划入额度'
  if (action === 'CS_STAFF_RECALL') return '代理收回额度'
  if (action === 'CONSOLE_CREDIT') return '给玩家上分'
  if (action === 'CONSOLE_DEBIT') return '给玩家下分'
  return label
}

function csFundDown(action: string) {
  return action === 'CONSOLE_CREDIT' || action === 'CS_STAFF_RECALL' || action === 'QUOTA_RECALL'
}

function mapFundRow(a: StaffAuditRow): Row {
  const method =
    a.method ||
    (a.action === 'CONSOLE_CREDIT' ? '上分' : a.action === 'CONSOLE_DEBIT' ? '下分' : '')
  const title = method || (isCs.value ? csFundTitle(a.action, a.actionLabel) : a.actionLabel)
  const down = isCs.value
    ? csFundDown(a.action)
    : a.action === 'QUOTA_RECALL' || a.action === 'CONSOLE_DEBIT' || a.action === 'CS_STAFF_RECALL'
  const orderPart = a.orderNo ? `订单 ${a.orderNo} · ` : ''
  const who = a.counterparty?.nickname || a.operator?.nickname || '—'
  return {
    id: a.id,
    title,
    sub: `${orderPart}${fmtTime(a.createdAt)} · ${who}`,
    amountText: a.amount == null ? undefined : `${down ? '-' : '+'}${fmt(Math.abs(a.amount))}`,
    amountClass: down ? 'down' : 'up',
  }
}

function mapBalanceRow(a: StaffAuditRow): Row {
  const amt = Number(a.amount || 0)
  const down = amt < 0
  return {
    id: a.id,
    title: a.actionLabel || a.action,
    sub: `${fmtTime(a.createdAt)}${a.remark && !String(a.actionLabel || '').includes('佣金') ? ` · ${a.remark}` : ''}${a.operator?.nickname ? ` · ${a.operator.nickname}` : ''}`,
    amountText: `${down ? '-' : '+'}${fmt(Math.abs(amt))}`,
    amountClass: down ? 'down' : 'up',
  }
}

function switchTab(next: AuditTab) {
  if (tab.value === next) return
  tab.value = next
  void fetchPage(1, false)
}

async function fetchPage(p: number, append: boolean) {
  loading.value = true
  try {
    if (isLandlord.value) {
      const res = await staffConsoleApi.adminLogs({ page: p, pageSize: pageSize.value })
      total.value = res.total
      page.value = p
      const rows = (res.list || []).map(mapAdminLog)
      list.value = append ? [...list.value, ...rows] : rows
    } else {
      const uid = staff.profile?.id
      if (!uid) {
        toast('未登录')
        return
      }
      const auditTab = isCs.value ? tab.value : 'fund'
      const res = await staffConsoleApi.agentAudit(uid, {
        page: p,
        pageSize: pageSize.value,
        tab: auditTab,
      })
      total.value = res.total
      page.value = p
      const rows = (res.list || []).map((a) =>
        auditTab === 'fund' ? mapFundRow(a) : mapBalanceRow(a),
      )
      list.value = append ? [...list.value, ...rows] : rows
    }
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function reload() {
  return fetchPage(1, false)
}
function loadMore() {
  return fetchPage(page.value + 1, true)
}

function syncTabFromQuery() {
  const q = String(route.query.tab || '')
  if (q === 'balance' || q === 'fund' || q === 'wage') tab.value = q
}

onMounted(() => {
  if (isCs.value) {
    syncTabFromQuery()
    if (!route.query.tab) tab.value = 'balance'
  }
  void fetchPage(1, false)
})

watch(
  () => route.query.tab,
  () => {
    if (!isCs.value) return
    const prev = tab.value
    syncTabFromQuery()
    if (tab.value !== prev) void fetchPage(1, false)
  },
)
</script>

<style scoped>
.sf-tabs {
  margin-bottom: 10px;
}
</style>
