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
      <div class="title">玩家上下分</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <div class="sp-search">
        <input
          v-model="keyword"
          type="search"
          placeholder="昵称 / 账号 / UID"
          @keyup.enter="reload"
        >
        <button type="button" @click="reload">搜索</button>
      </div>

      <div v-if="loading" class="sp-empty">加载中…</div>
      <div v-else-if="!list.length" class="sp-empty">暂无玩家</div>
      <div v-for="p in list" :key="p.id" class="sp-row">
        <div class="top">
          <div class="name">{{ p.nickname }}</div>
          <div class="bal">{{ fmt(p.balance) }}</div>
        </div>
        <div class="meta">{{ p.username }} · {{ p.uid }} · {{ p.status === 'ACTIVE' ? '正常' : '停用' }}</div>
        <div class="ops">
          <button type="button" @click="openFund(p, 'up')">上分</button>
          <button type="button" class="down" @click="openFund(p, 'down')">下分</button>
        </div>
      </div>

      <div v-if="total > list.length" class="sp-empty">
        <button type="button" class="sc-logout" :disabled="loading" @click="loadMore">加载更多</button>
      </div>
    </div>

    <div v-if="fundVisible" class="sp-sheet" @click.self="closeFund">
      <div class="sp-sheet-panel">
        <h3>{{ fundMode === 'up' ? '玩家上分' : '玩家下分' }}</h3>
        <p class="hint">{{ fundTarget?.nickname }} · 当前 {{ fmt(fundTarget?.balance) }}</p>
        <input v-model.number="fundAmount" type="number" min="1" placeholder="金额">
        <input v-model="fundRemark" type="text" maxlength="40" placeholder="备注（可选）">
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" @click="closeFund">取消</button>
          <button
            type="button"
            class="ok"
            :class="{ warn: fundMode === 'down' }"
            :disabled="fundBusy"
            @click="askFundConfirm"
          >确认</button>
        </div>
      </div>
    </div>

    <div v-if="confirmVisible" class="sp-sheet" @click.self="confirmVisible = false">
      <div class="sp-sheet-panel">
        <h3>确认{{ fundMode === 'up' ? '上分' : '下分' }}</h3>
        <p class="hint">
          是否确认给 {{ fundTarget?.nickname }}
          {{ fundMode === 'up' ? '上分' : '下分' }} {{ fmt(fundAmount) }}？
        </p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="fundBusy" @click="confirmVisible = false">取消</button>
          <button
            type="button"
            class="ok"
            :class="{ warn: fundMode === 'down' }"
            :disabled="fundBusy"
            @click="doFund"
          >确认{{ fundMode === 'up' ? '上分' : '下分' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { staffConsoleApi, type StaffPlayerRow } from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { PLAYER_DOWN_MIN, PLAYER_FUND_MAX, PLAYER_UP_MIN } from '@gamebox/shared'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const route = useRoute()
const router = useRouter()
const { toast } = useToast()

const keyword = ref('')
const loading = ref(false)
const list = ref<StaffPlayerRow[]>([])
const page = ref(1)
const total = ref(0)
const pageSize = 20

const fundVisible = ref(false)
const confirmVisible = ref(false)
const fundBusy = ref(false)
const fundMode = ref<'up' | 'down'>('up')
const fundAmount = ref(100)
const fundRemark = ref('')
const fundTarget = ref<StaffPlayerRow | null>(null)

function fmt(n?: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function newRequestId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function closeFund() {
  if (fundBusy.value) return
  fundVisible.value = false
  confirmVisible.value = false
}

function openFund(p: StaffPlayerRow, mode: 'up' | 'down') {
  fundTarget.value = p
  fundMode.value = mode
  fundAmount.value = mode === 'up' ? PLAYER_UP_MIN : PLAYER_DOWN_MIN
  fundRemark.value = ''
  confirmVisible.value = false
  fundVisible.value = true
}

function validateFundAmount(amount: number) {
  if (!amount || amount <= 0) {
    toast('请输入金额')
    return false
  }
  if (fundMode.value === 'up') {
    if (amount < PLAYER_UP_MIN) { toast(`上分最低 ${PLAYER_UP_MIN}`); return false }
    if (amount > PLAYER_FUND_MAX) { toast(`单笔上分不超过 ${PLAYER_FUND_MAX}`); return false }
  } else {
    if (amount < PLAYER_DOWN_MIN) { toast(`下分最低 ${PLAYER_DOWN_MIN}`); return false }
    if (amount > PLAYER_FUND_MAX) { toast(`单笔下分不超过 ${PLAYER_FUND_MAX}`); return false }
  }
  return true
}

function askFundConfirm() {
  if (!fundTarget.value) return
  const amount = Number(fundAmount.value)
  if (!validateFundAmount(amount)) return
  confirmVisible.value = true
}

async function doFund() {
  if (!fundTarget.value) return
  const amount = Number(fundAmount.value)
  if (!validateFundAmount(amount)) return
  fundBusy.value = true
  const rid = newRequestId()
  try {
    if (fundMode.value === 'up') {
      await staffConsoleApi.creditPlayer(
        fundTarget.value.id,
        amount,
        fundRemark.value || undefined,
        rid,
      )
      toast('已上分')
    } else {
      await staffConsoleApi.debitPlayer(
        fundTarget.value.id,
        amount,
        fundRemark.value || undefined,
        rid,
      )
      toast('已下分')
    }
    fundVisible.value = false
    confirmVisible.value = false
    await reload()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    fundBusy.value = false
  }
}

async function fetchPage(p: number, append: boolean) {
  loading.value = true
  try {
    const roomId = typeof route.query.roomId === 'string' ? route.query.roomId : undefined
    const res = await staffConsoleApi.players({
      page: p,
      pageSize,
      q: keyword.value.trim() || undefined,
      roomId,
    })
    total.value = res.total
    page.value = res.page
    list.value = append ? [...list.value, ...res.list] : res.list
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

onMounted(() => { void reload() })
</script>
