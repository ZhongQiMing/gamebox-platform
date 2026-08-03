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
      <div class="title">房间详情</div>
      <div class="right"></div>
    </div>

    <div class="page-body" v-if="room">
      <div class="rd-hero">
        <div class="rd-name">{{ room.name }}</div>
        <span class="st" :class="room.status.toLowerCase()">{{ statusLabel(room.status) }}</span>
        <div class="rd-code">进房码 <b>{{ room.roomNo }}</b></div>
      </div>

      <div class="rd-grid">
        <div class="rd-cell">
          <div class="mk">房间彩池</div>
          <div class="mv gold">{{ fmt(poolBalance) }}</div>
        </div>
        <div class="rd-cell">
          <div class="mk">成员 / 对局</div>
          <div class="mv">{{ room.memberCount }} / {{ room.roundCount ?? 0 }}</div>
        </div>
        <div class="rd-cell">
          <div class="mk">月费</div>
          <div class="mv">{{ feeText }}</div>
        </div>
        <div class="rd-cell">
          <div class="mk">绑定代理</div>
          <div class="mv sm">{{ agentBrief }}</div>
        </div>
      </div>

      <template v-if="room.ownerAgent">
        <div class="sc-sec-title">代理额度</div>
        <div class="rd-grid">
          <div class="rd-cell">
            <div class="mk">额度</div>
            <div class="mv">{{ fmt(room.ownerAgent.pointsQuota) }}</div>
          </div>
          <div class="rd-cell">
            <div class="mk">占用</div>
            <div class="mv">{{ fmt(room.ownerAgent.flyCover) }}</div>
          </div>
          <div class="rd-cell">
            <div class="mk">余额</div>
            <div class="mv gold">{{ fmt(room.ownerAgent.balance ?? 0) }}</div>
          </div>
          <div class="rd-cell">
            <div class="mk">已发</div>
            <div class="mv">{{ fmt(room.ownerAgent.pointsUsed) }}</div>
          </div>
        </div>
      </template>

      <div class="sc-sec-title">操作</div>
      <div class="rd-actions">
        <button type="button" class="rd-btn" @click="goPlayers">玩家上下分</button>
        <button
          v-if="canFundAgent && room.ownerAgent"
          type="button"
          class="rd-btn"
          @click="openAgentFund('up')"
        >代理上分</button>
        <button
          v-if="canFundAgent && room.ownerAgent"
          type="button"
          class="rd-btn warn"
          @click="openAgentFund('down')"
        >代理下分</button>
        <button
          v-if="canPool"
          type="button"
          class="rd-btn"
          @click="openPool"
        >彩池注资</button>
        <button
          v-if="room.ownerAgent"
          type="button"
          class="rd-btn ghost"
          @click="router.push({ name: 'staff-agents' })"
        >去代理列表</button>
      </div>
    </div>
    <div v-else class="page-body">
      <div class="sp-empty">{{ loading ? '加载中…' : '房间不存在' }}</div>
    </div>

    <div v-if="fundVisible" class="sp-sheet" @click.self="fundVisible = false">
      <div class="sp-sheet-panel">
        <h3>{{ fundMode === 'up' ? '代理上分' : '代理下分' }}</h3>
        <p class="hint">{{ room?.ownerAgent?.user.nickname }}</p>
        <input v-model.number="fundAmount" type="number" min="1" placeholder="金额">
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" @click="fundVisible = false">取消</button>
          <button type="button" class="ok" :class="{ warn: fundMode === 'down' }" :disabled="busy" @click="doAgentFund">确认</button>
        </div>
      </div>
    </div>

    <div v-if="poolVisible" class="sp-sheet" @click.self="poolVisible = false">
      <div class="sp-sheet-panel">
        <h3>房间彩池注资</h3>
        <p class="hint">当前彩池 {{ fmt(poolBalance) }} · 从你的账户转入</p>
        <input v-model.number="poolAmount" type="number" min="1" placeholder="金额">
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" @click="poolVisible = false">取消</button>
          <button type="button" class="ok" :disabled="busy" @click="doPoolFund">确认注资</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStaffStore } from '@/stores/staff'
import { staffConsoleApi, type StaffRoomDetail } from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const route = useRoute()
const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const loading = ref(false)
const busy = ref(false)
const room = ref<StaffRoomDetail | null>(null)
const poolBalance = ref(0)

const fundVisible = ref(false)
const fundMode = ref<'up' | 'down'>('up')
const fundAmount = ref(1000)
const poolVisible = ref(false)
const poolAmount = ref(1000)

const canFundAgent = computed(() => staff.role === 'ADMIN' || staff.role === 'BRANCH')
const canPool = computed(() => staff.role === 'ADMIN' || staff.role === 'BRANCH')

const agentBrief = computed(() => {
  const a = room.value?.ownerAgent
  if (!a) return '未绑定'
  return `${a.user.nickname}（${a.user.username}）`
})
const feeText = computed(() => {
  const fee = Number(room.value?.monthlyFee || 0)
  return fee > 0 ? `${Math.floor(fee)}/月` : '不收费'
})

function fmt(n?: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function statusLabel(s: string) {
  return ({ OPEN: '营业', CLOSED: '关闭', MAINTENANCE: '维护', FROZEN: '冻结' } as Record<string, string>)[s] || s
}
function goPlayers() {
  if (!room.value) return
  router.push({ name: 'staff-players', query: { roomId: room.value.id } })
}
function openAgentFund(mode: 'up' | 'down') {
  fundMode.value = mode
  fundAmount.value = 1000
  fundVisible.value = true
}
function openPool() {
  poolAmount.value = 1000
  poolVisible.value = true
}

async function doAgentFund() {
  const uid = room.value?.ownerAgent?.userId
  if (!uid) return
  const amount = Number(fundAmount.value)
  if (!(amount > 0)) return toast('请输入金额')
  busy.value = true
  try {
    if (fundMode.value === 'up') await staffConsoleApi.issue(uid, amount)
    else await staffConsoleApi.recall(uid, amount)
    toast(fundMode.value === 'up' ? '已上分' : '已下分')
    fundVisible.value = false
    await load()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '失败')
  } finally {
    busy.value = false
  }
}

async function doPoolFund() {
  if (!room.value) return
  const amount = Number(poolAmount.value)
  if (!(amount > 0)) return toast('请输入金额')
  busy.value = true
  try {
    const res = await staffConsoleApi.fundRoom(room.value.id, amount)
    poolBalance.value = Number(res.poolBalance ?? poolBalance.value)
    toast('已注资')
    poolVisible.value = false
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '失败')
  } finally {
    busy.value = false
  }
}

async function load() {
  const id = String(route.params.id || '')
  if (!id) return
  loading.value = true
  try {
    const [d, p] = await Promise.all([
      staffConsoleApi.room(id),
      staffConsoleApi.roomPool(id).catch(() => ({ balance: 0 })),
    ])
    room.value = d
    poolBalance.value = Number(p.balance || 0)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
    room.value = null
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
</script>
