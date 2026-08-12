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
      <div class="title">风控预警</div>
      <div class="right sc-bar-act" @click="refresh">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <div v-if="summary" class="sc-cards">
        <div class="sc-card"><div class="k">未处理</div><div class="v down">{{ summary.unhandled }}</div></div>
        <div class="sc-card"><div class="k">严重</div><div class="v down">{{ summary.critical }}</div></div>
        <div class="sc-card"><div class="k">警告</div><div class="v">{{ summary.warn }}</div></div>
        <div class="sc-card"><div class="k">今日新增</div><div class="v">{{ summary.todayNew }}</div></div>
      </div>

      <div class="rd-seg">
        <button type="button" :class="{ on: onlyUnhandled }" @click="setUnhandled(true)">待处理</button>
        <button type="button" :class="{ on: !onlyUnhandled }" @click="setUnhandled(false)">全部</button>
      </div>

      <div v-if="loading && !list.length" class="sp-empty">加载中…</div>
      <div v-else-if="!list.length" class="sp-empty">暂无告警</div>

      <div v-for="ev in list" :key="ev.id" class="sp-row">
        <div class="top">
          <div class="name">
            <span class="lvl" :class="ev.level.toLowerCase()">{{ levelLabel(ev.level) }}</span>
            {{ ev.typeLabel }}
          </div>
          <div class="bal t">{{ fmtTime(ev.createdAt) }}</div>
        </div>
        <div class="meta">{{ ev.summary }}</div>
        <div v-if="ev.target" class="meta">
          {{ ev.target.nickname }} · {{ ev.target.uid }}
        </div>
        <div v-if="!ev.handled" class="ops">
          <button type="button" @click="handle(ev.id)">标记已处理</button>
        </div>
        <div v-else class="meta done">已处理</div>
      </div>

      <div v-if="list.length < total" class="sp-empty">
        <button type="button" class="sc-logout" :disabled="loading" @click="loadMore">加载更多</button>
      </div>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  staffConsoleApi,
  type StaffRiskEvent,
  type StaffRiskSummary,
} from '@/api/staffConsole'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const { toast } = useToast()

const summary = ref<StaffRiskSummary | null>(null)
const onlyUnhandled = ref(true)
const loading = ref(false)
const list = ref<StaffRiskEvent[]>([])
const page = ref(1)
const total = ref(0)
const pageSize = 20

function levelLabel(l: string) {
  return ({ CRITICAL: '严重', WARN: '警告', INFO: '提示' } as Record<string, string>)[l] || l
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

async function loadSummary() {
  try {
    summary.value = await staffConsoleApi.riskSummary()
  } catch {
    summary.value = null
  }
}

async function fetchPage(p: number, append: boolean) {
  loading.value = true
  try {
    const res = await staffConsoleApi.riskList({
      page: p,
      pageSize,
      handled: onlyUnhandled.value ? false : undefined,
    })
    total.value = res.total
    page.value = p
    list.value = append ? [...list.value, ...res.list] : res.list
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function setUnhandled(v: boolean) {
  onlyUnhandled.value = v
  void fetchPage(1, false)
}
function loadMore() {
  return fetchPage(page.value + 1, true)
}
async function refresh() {
  await Promise.all([loadSummary(), fetchPage(1, false)])
}

async function handle(id: string) {
  try {
    await staffConsoleApi.riskHandle(id)
    toast('已标记处理')
    await refresh()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '操作失败')
  }
}

onMounted(async () => {
  await loadSummary()
  await fetchPage(1, false)
})
</script>

<style scoped>
.rd-seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  margin-bottom: 12px;
  padding: 3px;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 55, 0.28);
  background: rgba(12, 8, 5, 0.75);
}
.rd-seg button {
  height: 34px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  letter-spacing: 2px;
  cursor: pointer;
}
.rd-seg button.on {
  color: #1a1208;
  font-weight: 700;
  background: linear-gradient(180deg, #f5d36b, #c9a227);
  box-shadow: 0 2px 8px rgba(201, 162, 39, 0.35);
}
.lvl {
  display: inline-block;
  margin-right: 6px;
  padding: 2px 7px;
  font-size: 11px;
  border-radius: 999px;
  border: 1px solid rgba(244, 211, 107, 0.35);
  vertical-align: middle;
}
.lvl.critical {
  color: #fca5a5;
  border-color: rgba(252, 165, 165, 0.5);
  background: rgba(127, 29, 29, 0.25);
}
.lvl.warn {
  color: #f5d36b;
  background: rgba(120, 53, 15, 0.25);
}
.lvl.info {
  color: #93c5fd;
  border-color: rgba(147, 197, 253, 0.4);
}
.bal.t {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
}
.meta.done {
  margin-bottom: 0;
  color: rgba(134, 239, 172, 0.75);
}
</style>
