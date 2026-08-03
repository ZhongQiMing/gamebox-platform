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
      <div class="title">风控告警</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <div v-if="summary" class="sc-cards">
        <div class="sc-card"><div class="k">未处理</div><div class="v down">{{ summary.unhandled }}</div></div>
        <div class="sc-card"><div class="k">严重</div><div class="v down">{{ summary.critical }}</div></div>
        <div class="sc-card"><div class="k">警告</div><div class="v">{{ summary.warn }}</div></div>
        <div class="sc-card"><div class="k">今日新增</div><div class="v">{{ summary.todayNew }}</div></div>
      </div>

      <div class="sp-tabs">
        <button type="button" :class="{ on: onlyUnhandled }" @click="setUnhandled(true)">待处理</button>
        <button type="button" :class="{ on: !onlyUnhandled }" @click="setUnhandled(false)">全部</button>
      </div>

      <div v-if="loading" class="sp-empty">加载中…</div>
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
        <div v-else class="meta">已处理</div>
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
import {
  staffConsoleApi,
  type StaffRiskEvent,
  type StaffRiskSummary,
} from '@/api/staffConsole'
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

async function handle(id: string) {
  try {
    await staffConsoleApi.riskHandle(id)
    toast('已标记处理')
    await Promise.all([loadSummary(), fetchPage(1, false)])
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
.lvl {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid rgba(244, 211, 107, 0.35);
}
.lvl.critical {
  color: #e8a080;
  border-color: rgba(220, 120, 80, 0.55);
}
.lvl.warn {
  color: #f5d36b;
}
.bal.t {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
}
</style>
