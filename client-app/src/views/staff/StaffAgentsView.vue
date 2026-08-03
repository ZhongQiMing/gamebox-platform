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
      <div class="title">{{ pageTitle }}</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <p class="page-hint">此处只做{{ listRole === 'PROXY' ? '子账号' : '代理' }}上下分；玩家上下分请从「玩家上下分」或房间详情进入。</p>

      <div class="sp-search">
        <input
          v-model="keyword"
          type="search"
          :placeholder="listRole === 'PROXY' ? '搜子账号' : '搜代理 / 房间'"
          @keyup.enter="reload"
        >
        <button type="button" @click="reload">搜索</button>
      </div>

      <div v-if="loading" class="sp-empty">加载中…</div>
      <div v-else-if="!list.length" class="sp-empty">暂无数据</div>

      <div v-for="a in list" :key="a.id" class="agent-card">
        <div class="agent-card-hd">
          <div>
            <div class="agent-name">{{ a.nickname }}</div>
            <div class="agent-sub">{{ a.username }} · {{ a.uid }}</div>
          </div>
          <div class="agent-quota">
            <div class="mk">额度</div>
            <div class="mv">{{ fmt(a.pointsQuota) }}</div>
          </div>
        </div>
        <div class="room-metrics">
          <div class="m"><span class="mk">余额</span><span class="mv gold">{{ fmt(a.balance) }}</span></div>
          <div class="m"><span class="mk">占用</span><span class="mv">{{ fmt(a.flyCover) }}</span></div>
          <div class="m"><span class="mk">房间</span><span class="mv sm">{{ roomText(a) }}</span></div>
        </div>
        <div v-if="canFund" class="ops">
          <button type="button" @click="openFund(a, 'up')">上分</button>
          <button type="button" class="down" @click="openFund(a, 'down')">下分</button>
        </div>
      </div>

      <div v-if="list.length < total" class="sp-empty">
        <button type="button" class="sc-logout" :disabled="loading" @click="loadMore">加载更多</button>
      </div>
    </div>

    <div v-if="fundVisible" class="sp-sheet" @click.self="fundVisible = false">
      <div class="sp-sheet-panel">
        <h3>{{ fundMode === 'up' ? '上分' : '下分' }}</h3>
        <p class="hint">{{ fundTarget?.nickname }} · 额度 {{ fmt(fundTarget?.pointsQuota) }}</p>
        <input v-model.number="fundAmount" type="number" min="1" placeholder="金额">
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" @click="fundVisible = false">取消</button>
          <button type="button" class="ok" :class="{ warn: fundMode === 'down' }" :disabled="fundBusy" @click="doFund">确认</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStaffStore } from '@/stores/staff'
import { staffConsoleApi, type StaffAgentRow } from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const listRole = computed(() => (staff.isAgentSide ? 'PROXY' : 'AGENT'))
const pageTitle = computed(() => (listRole.value === 'PROXY' ? '子账号' : '代理'))
const canFund = computed(() =>
  staff.role === 'ADMIN' || staff.role === 'BRANCH' || staff.role === 'AGENT',
)

const keyword = ref('')
const loading = ref(false)
const list = ref<StaffAgentRow[]>([])
const page = ref(1)
const total = ref(0)
const pageSize = 20

const fundVisible = ref(false)
const fundBusy = ref(false)
const fundMode = ref<'up' | 'down'>('up')
const fundAmount = ref(1000)
const fundTarget = ref<StaffAgentRow | null>(null)

function fmt(n?: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function roomText(a: StaffAgentRow) {
  if (!a.rooms?.length) return '—'
  return a.rooms.map((r) => r.name || r.roomNo).join('、')
}
function openFund(a: StaffAgentRow, mode: 'up' | 'down') {
  fundTarget.value = a
  fundMode.value = mode
  fundAmount.value = 1000
  fundVisible.value = true
}

async function doFund() {
  if (!fundTarget.value) return
  const amount = Number(fundAmount.value)
  if (!(amount > 0)) return toast('请输入金额')
  fundBusy.value = true
  try {
    if (fundMode.value === 'up') await staffConsoleApi.issue(fundTarget.value.id, amount)
    else await staffConsoleApi.recall(fundTarget.value.id, amount)
    toast(fundMode.value === 'up' ? '已上分' : '已下分')
    fundVisible.value = false
    await reload()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '失败')
  } finally {
    fundBusy.value = false
  }
}

async function fetchPage(p: number, append: boolean) {
  loading.value = true
  try {
    const res = await staffConsoleApi.agents({
      page: p,
      pageSize,
      role: listRole.value,
      q: keyword.value.trim() || undefined,
      boundOnly: listRole.value === 'AGENT',
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

function reload() { return fetchPage(1, false) }
function loadMore() { return fetchPage(page.value + 1, true) }

onMounted(() => { void reload() })
</script>
