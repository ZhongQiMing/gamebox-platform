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
      <div class="right sc-bar-act" @click="reload">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <!-- 代理端：团队经营报表（不是子账号列表） -->
      <template v-if="isAgentSide">
        <div class="sp-tabs sp-tabs--range" :data-count="ranges.length">
          <button
            v-for="t in ranges"
            :key="t.key"
            type="button"
            :class="{ on: range === t.key }"
            @click="switchRange(t.key)"
          >{{ t.label }}</button>
        </div>

        <div v-if="loading && !summary" class="sp-empty">加载中…</div>
        <template v-else-if="summary">
          <section class="rp-hero">
            <div class="rp-hero-k">玩家盈亏</div>
            <div class="rp-hero-v" :class="pnlClass(summary.playerPnl)">{{ fmtSigned(summary.playerPnl) }}</div>
            <div class="rp-hero-row">
              <div><span class="k">流水</span><span class="v">{{ fmt(summary.betFlow) }}</span></div>
              <div><span class="k">上分</span><span class="v up">{{ fmt(summary.upAmount) }}</span></div>
              <div><span class="k">下分</span><span class="v down">{{ fmt(summary.downAmount) }}</span></div>
            </div>
          </section>

          <div class="sc-sec-title">团队玩家流水</div>
          <div v-if="flowLoading && !flowList.length" class="sp-empty">加载中…</div>
          <div v-else-if="!flowList.length" class="sp-empty">该区间暂无有效流水</div>
          <div v-for="(p, i) in flowList" :key="p.playerId" class="flow-row">
            <span class="flow-rank">{{ i + 1 }}</span>
            <div class="flow-main">
              <b>{{ p.nickname || '—' }}</b>
              <em>{{ p.uid }} · 注单 {{ p.betCount }}</em>
            </div>
            <div class="flow-amt">{{ fmt(p.validFlow) }}</div>
          </div>
        </template>
      </template>

      <!-- 管理/房主：代理账号列表（上下分） -->
      <template v-else>
        <div class="sp-search">
          <input
            v-model="keyword"
            type="search"
            placeholder="搜代理 / 房间"
            @keyup.enter="reloadAgents"
          >
          <button type="button" @click="reloadAgents">搜索</button>
        </div>

        <div class="rm-sum" v-if="!loading && list.length">
          <span>共 {{ total }} 位代理</span>
          <span>本页 {{ list.length }}</span>
        </div>

        <div v-if="loading" class="sp-empty">加载中…</div>
        <div v-else-if="!list.length" class="sp-empty">暂无已绑房代理</div>

        <div v-for="a in list" :key="a.id" class="agent-card">
          <div class="agent-card-hd">
            <div>
              <div class="agent-name">{{ a.nickname }}</div>
              <div class="agent-sub">{{ a.username }} · {{ a.uid }}</div>
            </div>
            <span class="st" :class="isCreditAgent(a) ? 'maintenance' : 'open'">
              {{ isCreditAgent(a) ? 'B·信用' : 'A·现金' }}
            </span>
          </div>
          <div class="room-metrics">
            <div class="m">
              <span class="mk">{{ isCreditAgent(a) ? '剩余信用' : '上盘额度' }}</span>
              <span class="mv">{{ fmt(a.pointsQuota) }}</span>
            </div>
            <div class="m">
              <span class="mk">{{ isCreditAgent(a) ? '佣金账户' : '代理余额' }}</span>
              <span class="mv gold">{{ fmt(a.balance) }}</span>
            </div>
            <div v-if="!isCreditAgent(a)" class="m">
              <span class="mk">上盘可飞</span>
              <span class="mv">{{ fmt(a.flyCover) }}</span>
            </div>
            <div class="m"><span class="mk">房间</span><span class="mv sm">{{ roomText(a) }}</span></div>
          </div>
          <div class="ops">
            <button
              v-if="a.rooms?.[0]?.id"
              type="button"
              class="ghost"
              @click="router.push({ name: 'staff-room-detail', params: { id: a.rooms[0].id } })"
            >进房间</button>
            <template v-if="canFund && !isCreditAgent(a)">
              <button type="button" @click="openFund(a, 'up')">上分</button>
              <button type="button" class="down" @click="openFund(a, 'down')">下分</button>
            </template>
            <span v-else-if="canFund && isCreditAgent(a)" class="credit-hint">信用盘 · 进房调额度</span>
          </div>
        </div>

        <div v-if="list.length < total" class="sp-empty">
          <button type="button" class="sc-logout" :disabled="loading" @click="loadMore">加载更多</button>
        </div>
      </template>
    </div>

    <div v-if="fundVisible" class="sp-sheet" @click.self="fundBusy || (fundVisible = false)">
      <div class="sp-sheet-panel">
        <h3>{{ fundMode === 'up' ? '上分' : '下分' }}</h3>
        <p class="hint">{{ fundTarget?.nickname }} · 额度 {{ fmt(fundTarget?.pointsQuota) }}</p>
        <input v-model.number="fundAmount" type="number" min="1" :max="FUND_MAX" step="1" placeholder="金额">
        <p v-if="fundConfirming" class="hint confirm">
          确认给 {{ fundTarget?.nickname }} {{ fundMode === 'up' ? '上分' : '下分' }}
          {{ fmt(fundAmount) }}？订单号 {{ fundOrderNo }}
        </p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" @click="fundVisible = false">取消</button>
          <button type="button" class="ok" :class="{ warn: fundMode === 'down' }" :disabled="fundBusy" @click="doFund">
            {{ fundConfirming ? '确认无误' : '确认' }}
          </button>
        </div>
      </div>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStaffStore } from '@/stores/staff'
import StaffTabBar from '@/components/StaffTabBar.vue'
import {
  staffConsoleApi,
  type StaffAgentRow,
  type StaffReportSummary,
} from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { newFundOrderNo } from '@/utils/fundOrderNo'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const isAgentSide = computed(() => staff.isAgentSide)
const pageTitle = computed(() => (isAgentSide.value ? '代理报表' : '代理管理'))
const canFund = computed(() => staff.role === 'ADMIN' || staff.role === 'BRANCH')

const ranges = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'thisweek', label: '本周' },
  { key: 'lastweek', label: '上周' },
  { key: 'thismonth', label: '本月' },
]

const range = ref('today')
const loading = ref(false)
const flowLoading = ref(false)
const summary = ref<StaffReportSummary | null>(null)
const flowList = ref<{
  playerId: string
  uid: string
  nickname: string
  avatar: string | null
  validFlow: number
  betCount: number
}[]>([])

const keyword = ref('')
const list = ref<StaffAgentRow[]>([])
const page = ref(1)
const total = ref(0)
const pageSize = 20

const fundVisible = ref(false)
const fundBusy = ref(false)
const fundMode = ref<'up' | 'down'>('up')
const fundAmount = ref(1000)
const fundTarget = ref<StaffAgentRow | null>(null)
const fundOrderNo = ref('')
const fundConfirming = ref(false)
const FUND_MAX = 50_000_000

function fmt(n?: number | null) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
function fmtSigned(n?: number | null) {
  const v = Number(n || 0)
  const s = fmt(Math.abs(v))
  if (v > 0) return `+${s}`
  if (v < 0) return `-${s}`
  return s
}
function pnlClass(n?: number | null) {
  const v = Number(n || 0)
  if (v > 0) return 'up'
  if (v < 0) return 'down'
  return ''
}
function roomText(a: StaffAgentRow) {
  if (!a.rooms?.length) return '—'
  return a.rooms.map((r) => r.name || r.roomNo).join('、')
}
function isCreditAgent(a: StaffAgentRow) {
  return (a.rooms || []).some((r) => r.bookMode === 'CREDIT')
}
function openFund(a: StaffAgentRow, mode: 'up' | 'down') {
  fundTarget.value = a
  fundMode.value = mode
  fundAmount.value = 1000
  /* 订单号在开弹窗时定死：连点复用同一个键被服务端去重，真失败后重开才换新号 */
  fundOrderNo.value = newFundOrderNo(mode)
  fundConfirming.value = false
  fundVisible.value = true
}

async function doFund() {
  if (!fundTarget.value || fundBusy.value) return
  const amount = Number(fundAmount.value)
  if (!Number.isInteger(amount) || amount <= 0) return toast('金额须为正整数')
  if (amount > FUND_MAX) return toast(`单笔不超过 ${fmt(FUND_MAX)}`)
  if (!fundConfirming.value) {
    fundConfirming.value = true
    return
  }
  fundBusy.value = true
  try {
    const orderNo = fundOrderNo.value
    if (fundMode.value === 'up') await staffConsoleApi.issue(fundTarget.value.id, amount, orderNo)
    else await staffConsoleApi.recall(fundTarget.value.id, amount, orderNo)
    toast(fundMode.value === 'up' ? '已上分' : '已下分')
    fundVisible.value = false
    await reloadAgents()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '失败')
    fundConfirming.value = false
  } finally {
    fundBusy.value = false
  }
}

async function loadReport() {
  loading.value = true
  flowLoading.value = true
  try {
    const [s, flow] = await Promise.all([
      staffConsoleApi.reportSummary({ range: range.value }),
      staffConsoleApi.playerFlow({ range: range.value, limit: 50 }).catch(() => ({ list: [] })),
    ])
    summary.value = s
    flowList.value = flow.list || []
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
    flowLoading.value = false
  }
}

function switchRange(key: string) {
  range.value = key
  void loadReport()
}

async function fetchAgents(p: number, append: boolean) {
  loading.value = true
  try {
    const res = await staffConsoleApi.agents({
      page: p,
      pageSize,
      role: 'AGENT',
      q: keyword.value.trim() || undefined,
      boundOnly: true,
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

function reloadAgents() { return fetchAgents(1, false) }
function loadMore() { return fetchAgents(page.value + 1, true) }

function reload() {
  return isAgentSide.value ? loadReport() : reloadAgents()
}

onMounted(() => { void reload() })
</script>

<style scoped>
.rp-hero {
  margin-bottom: 12px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(244, 211, 107, 0.35);
  background:
    radial-gradient(120% 80% at 100% 0%, rgba(245, 158, 11, 0.16), transparent 55%),
    linear-gradient(160deg, rgba(52, 36, 18, 0.96) 0%, rgba(22, 14, 8, 0.98) 100%);
}
.rp-hero-k {
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(255, 244, 194, 0.72);
  margin-bottom: 4px;
}
.rp-hero-v {
  font-size: 30px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  font-family: 'Noto Serif SC', serif;
  margin-bottom: 12px;
}
.rp-hero-v.up { color: #86efac; }
.rp-hero-v.down { color: #fca5a5; }
.rp-hero-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(244, 211, 107, 0.14);
}
.rp-hero-row .k {
  display: block;
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 3px;
}
.rp-hero-row .v {
  font-size: 14px;
  font-weight: 650;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
}
.rp-hero-row .v.up { color: #86efac; }
.rp-hero-row .v.down { color: #fca5a5; }

.flow-row {
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  margin-bottom: 8px;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 55, 0.22);
  background: rgba(16, 12, 8, 0.88);
}
.flow-rank {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  color: #1a1208;
  background: linear-gradient(160deg, #f5d76e, #c9a227);
}
.flow-main b {
  display: block;
  font-size: 14px;
  color: #fff4c2;
  margin-bottom: 2px;
}
.flow-main em {
  font-style: normal;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.5);
}
.flow-amt {
  font-size: 15px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
}

.ops button.ghost {
  border-color: rgba(148, 163, 184, 0.35);
  color: #cbd5e1;
  background: rgba(71, 85, 105, 0.2);
}
.credit-hint {
  flex: 1;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.65);
  letter-spacing: 0.5px;
  text-align: right;
  line-height: 1.3;
}
</style>
