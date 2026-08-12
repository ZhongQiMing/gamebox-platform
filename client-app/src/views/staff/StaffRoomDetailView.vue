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
      <div class="title">房间管理</div>
      <div class="right sc-bar-act" @click="load">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body" v-if="room">
      <section class="rd-hero">
        <i class="rd-corner tl" aria-hidden="true"></i>
        <i class="rd-corner tr" aria-hidden="true"></i>
        <i class="rd-corner bl" aria-hidden="true"></i>
        <i class="rd-corner br" aria-hidden="true"></i>

        <div class="rd-top">
          <div class="rd-icon-wrap">
            <img
              class="rd-icon"
              :src="room.icon || defaultIcon"
              :alt="room.name"
              loading="lazy"
              @error="onIconError"
            >
          </div>
          <div class="rd-main">
            <div class="rd-hd">
              <div class="rd-name">{{ room.name }}</div>
              <div class="rd-tags">
                <span class="rd-chip">{{ room.bookMode === 'CREDIT' ? 'B·信用' : 'A·现金' }}</span>
                <span class="rd-st" :class="room.status.toLowerCase()">{{ statusLabel(room.status) }}</span>
              </div>
            </div>
            <button type="button" class="rd-code" @click="copyCode">
              <span class="rd-code-k">进房码</span>
              <span class="rd-code-v">{{ room.roomNo }}</span>
              <span class="rd-code-act">复制</span>
            </button>
          </div>
        </div>

        <div class="rd-grid">
          <div class="rd-cell">
            <span class="mk">玩家</span>
            <span class="mv">{{ room.memberCount }}</span>
          </div>
          <div class="rd-cell">
            <span class="mk">对局</span>
            <span class="mv">{{ room.roundCount ?? 0 }}</span>
          </div>
          <div class="rd-cell">
            <span class="mk">月费</span>
            <span class="mv">{{ feeText }}</span>
          </div>
          <div class="rd-cell">
            <span class="mk">游戏</span>
            <span class="mv">{{ enabledGameCount }}/{{ games.length || '—' }}</span>
          </div>
        </div>
      </section>

      <div class="rd-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="tab === 'ops'" :class="{ on: tab === 'ops' }" @click="tab = 'ops'">运营</button>
        <button type="button" role="tab" :aria-selected="tab === 'games'" :class="{ on: tab === 'games' }" @click="tab = 'games'">游戏</button>
        <button type="button" role="tab" :aria-selected="tab === 'agent'" :class="{ on: tab === 'agent' }" @click="tab = 'agent'">代理</button>
      </div>

      <template v-if="tab === 'ops'">
        <section class="rd-panel">
          <div class="rd-panel-hd">房间状态</div>
          <div class="rd-status">
            <button
              v-for="s in statusOptions"
              :key="s.value"
              type="button"
              class="rd-st-btn"
              :class="{ on: room.status === s.value, danger: s.value === 'FROZEN' || s.value === 'CLOSED' }"
              :disabled="!canSetStatus || statusBusy || room.status === s.value"
              @click="setStatus(s.value)"
            >{{ s.label }}</button>
          </div>
          <p v-if="!canSetStatus" class="rd-tip">当前角色不可改房间状态</p>
        </section>

        <section v-if="canPlayerFund" class="rd-panel">
          <div class="rd-panel-hd">快捷入口</div>
          <div class="rd-links">
            <button type="button" class="rd-link" @click="goPlayers">
              <div class="rd-link-txt">
                <span class="lb">本房玩家上下分</span>
                <span class="sub">{{ room.memberCount }} 人</span>
              </div>
              <span class="arrow">›</span>
            </button>
          </div>
        </section>

        <section class="rd-panel">
          <div class="rd-panel-hd">
            <span>经营报表</span>
            <button type="button" class="rd-panel-act" :disabled="reportLoading" @click="loadReport">
              {{ reportLoading ? '…' : '刷新' }}
            </button>
          </div>
          <div class="sp-tabs sp-tabs--range" :data-count="reportRanges.length">
            <button
              v-for="t in reportRanges"
              :key="t.key"
              type="button"
              :class="{ on: reportRange === t.key }"
              @click="switchReportRange(t.key)"
            >{{ t.label }}</button>
          </div>
          <div v-if="reportLoading && !report" class="sp-empty">加载中…</div>
          <template v-else-if="report">
            <div class="rd-rpt-hero">
              <div class="rd-rpt-k">{{ reportHeroLabel }}</div>
              <div class="rd-rpt-v" :class="pnlClass(reportHeroValue)">{{ fmtSigned(reportHeroValue) }}</div>
              <div class="rd-rpt-metrics" :class="{ cols3: reportHeroMetrics.length <= 3 }">
                <div v-for="m in reportHeroMetrics" :key="m.k">
                  <span class="k">{{ m.k }}</span>
                  <span class="v" :class="m.cls || ''">{{ m.v }}</span>
                </div>
              </div>
            </div>
            <div class="rd-rpt-list">
              <div v-for="c in reportRows" :key="c.k" class="rd-rpt-row">
                <span class="k">{{ c.k }}</span>
                <b class="v" :class="c.cls || ''">{{ c.v }}</b>
              </div>
            </div>
            <template v-if="(report.byGame || []).length">
              <div class="rd-rpt-sub">分游戏</div>
              <div v-for="g in report.byGame" :key="g.gameCode" class="rd-rpt-game">
                <div class="rd-rpt-game-hd">
                  <b>{{ g.gameName || g.gameCode }}</b>
                  <span :class="pnlClass(isLandlord ? g.housePnl : -g.housePnl)">
                    {{ fmtSigned(isLandlord ? g.housePnl : -g.housePnl) }}
                  </span>
                </div>
                <div class="rd-rpt-game-m">
                  <span>注单 {{ fmt(g.betCount) }}</span>
                  <span>流水 {{ fmt(g.betFlow) }}</span>
                  <span>派彩 {{ fmt(g.payout) }}</span>
                </div>
              </div>
            </template>
          </template>
          <div v-else class="sp-empty">暂无报表数据</div>
        </section>
      </template>

      <template v-else-if="tab === 'games'">
        <section class="rd-panel">
          <div class="rd-panel-hd">
            <span>房间游戏</span>
            <span class="rd-panel-meta">开 {{ enabledGameCount }} / 共 {{ games.length }}</span>
          </div>
          <div v-if="gamesLoading" class="sp-empty">加载中…</div>
          <div v-else-if="!games.length" class="sp-empty">暂无游戏配置</div>
          <div v-else class="rd-games">
            <div v-for="g in games" :key="g.gameCode" class="rd-game">
              <div class="rd-game-info">
                <div class="rd-game-name">{{ gameLabel(g.gameCode) }}</div>
                <div class="rd-game-code">{{ g.gameCode }}</div>
              </div>
              <label class="rd-switch" :class="{ off: !g.enabled, disabled: !canEditGames || gameBusy === g.gameCode }">
                <input
                  type="checkbox"
                  :checked="g.enabled"
                  :disabled="!canEditGames || gameBusy === g.gameCode"
                  @change="toggleGame(g)"
                >
                <span>{{ g.enabled ? '开' : '关' }}</span>
              </label>
            </div>
          </div>
          <p v-if="!canEditGames" class="rd-tip">子账号仅可查看，不可改游戏开关</p>
        </section>
      </template>

      <template v-else>
        <section v-if="room.ownerAgent" class="rd-panel">
          <div class="rd-panel-hd">绑定代理</div>
          <div class="rd-agent">
            <div class="rd-agent-name">{{ room.ownerAgent.user.nickname }}</div>
            <div class="rd-agent-sub">{{ room.ownerAgent.user.username }} · {{ room.ownerAgent.user.uid }}</div>
          </div>
          <div v-if="room.bookMode === 'CREDIT'" class="rd-grid tight">
            <div class="rd-cell"><span class="mk">合同额度</span><span class="mv">{{ fmt(room.creditLimit) }}</span></div>
            <div class="rd-cell"><span class="mk">剩余信用</span><span class="mv accent">{{ fmt(room.ownerAgent.pointsQuota) }}</span></div>
            <div class="rd-cell"><span class="mk">佣金账户</span><span class="mv">{{ fmt(room.ownerAgent.balance ?? 0) }}</span></div>
            <div class="rd-cell"><span class="mk">玩家持分</span><span class="mv">{{ fmt(room.playerPointsTotal) }}</span></div>
            <div class="rd-cell wide"><span class="mk">占成</span><span class="mv">{{ Math.round(Number(room.agentShareRate || 0) * 1000) / 10 }}%</span></div>
          </div>
          <div v-else class="rd-grid tight">
            <div class="rd-cell"><span class="mk">代理余额</span><span class="mv accent">{{ fmt(room.ownerAgent.balance ?? 0) }}</span></div>
            <div class="rd-cell"><span class="mk">上盘额度</span><span class="mv">{{ fmt(room.ownerAgent.diskPoolRemaining ?? room.ownerAgent.pointsQuota) }}</span></div>
            <div class="rd-cell"><span class="mk">上盘可飞</span><span class="mv">{{ fmt(room.ownerAgent.flyCover) }}</span></div>
            <div class="rd-cell"><span class="mk">玩家持分</span><span class="mv">{{ fmt(room.playerPointsTotal) }}</span></div>
          </div>
        </section>
        <div v-else class="sp-empty">未绑定代理</div>

        <section v-if="canFundAgent && room.ownerAgent && room.bookMode !== 'CREDIT'" class="rd-panel">
          <div class="rd-panel-hd">买飞盘额度</div>
          <div class="rd-actions">
            <button type="button" class="rd-btn" @click="openAgentFund('up')">代理上分</button>
            <button type="button" class="rd-btn warn" @click="openAgentFund('down')">代理下分</button>
          </div>
        </section>
        <section v-else-if="room.bookMode === 'CREDIT' && canFundAgent" class="rd-panel">
          <div class="rd-panel-hd">调整信用额度</div>
          <p class="rd-tip inline">信用盘不能给代理上下分；合同额度与剩余信用同步加减。</p>
          <div class="rd-actions">
            <button type="button" class="rd-btn" @click="openBumpCredit('up')">增加信用</button>
            <button type="button" class="rd-btn warn" @click="openBumpCredit('down')">减少信用</button>
          </div>
        </section>
      </template>
    </div>

    <div v-else class="page-body">
      <div class="sp-empty">{{ loading ? '加载中…' : '房间不存在' }}</div>
    </div>

    <div v-if="fundVisible" class="sp-sheet" @click.self="busy || (fundVisible = false)">
      <div class="sp-sheet-panel">
        <h3>{{ fundMode === 'up' ? '代理上分' : '代理下分' }}</h3>
        <p class="hint">{{ room?.ownerAgent?.user.nickname }}</p>
        <input v-model.number="fundAmount" type="number" min="1" :max="FUND_MAX" step="1" placeholder="金额">
        <p v-if="fundConfirming" class="hint">
          确认{{ fundMode === 'up' ? '上分' : '下分' }} {{ fmt(fundAmount) }}？订单号 {{ fundOrderNo }}
        </p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" @click="fundVisible = false">取消</button>
          <button type="button" class="ok" :class="{ warn: fundMode === 'down' }" :disabled="busy" @click="doAgentFund">
            {{ fundConfirming ? '确认无误' : '确认' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="bumpVisible" class="sp-sheet" @click.self="closeBump">
      <div class="sp-sheet-panel">
        <h3>{{ bumpDir === 'up' ? '增加信用额度' : '减少信用额度' }}</h3>
        <p class="hint">
          合同 {{ fmt(room?.creditLimit) }} · 剩余 {{ fmt(room?.ownerAgent?.pointsQuota) }}
        </p>
        <input v-model.number="bumpAmount" type="number" min="1" placeholder="金额">
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="busy" @click="closeBump">取消</button>
          <button
            type="button"
            class="ok"
            :class="{ warn: bumpDir === 'down' }"
            :disabled="busy"
            @click="doBumpCredit"
          >确认{{ bumpDir === 'up' ? '增加' : '减少' }}</button>
        </div>
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
  type StaffReportSummary,
  type StaffRoomDetail,
  type StaffRoomGameCfg,
} from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { newFundOrderNo } from '@/utils/fundOrderNo'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const GAME_LABEL: Record<string, string> = {
  ffc: '分分彩',
  ssc: '时时彩',
  kuai3: '快三',
  bjsc: '北京赛车',
  'speed-racing': '极速赛车',
  'speed-boat': '极速飞艇',
  lhc: '六合彩',
  baccarat: '百家乐',
  'dragon-tiger': '龙虎斗',
  longhu: '龙虎斗',
  douniu: '斗牛',
  zhajinhua: '炸金花',
  'fruit-machine': '水果机',
  bcbm: '奔驰宝马',
}

const route = useRoute()
const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const defaultIcon = '/images/rooms/default-room.png'
const loading = ref(false)
const busy = ref(false)
const statusBusy = ref(false)
const gamesLoading = ref(false)
const gameBusy = ref('')
const room = ref<StaffRoomDetail | null>(null)
const games = ref<StaffRoomGameCfg[]>([])
const tab = ref<'ops' | 'games' | 'agent'>('ops')

const reportRanges = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'thisweek', label: '本周' },
  { key: 'lastweek', label: '上周' },
  { key: 'thismonth', label: '本月' },
]
const reportRange = ref('today')
const reportLoading = ref(false)
const report = ref<StaffReportSummary | null>(null)

const fundVisible = ref(false)
const fundMode = ref<'up' | 'down'>('up')
const fundAmount = ref(1000)
const fundOrderNo = ref('')
const fundConfirming = ref(false)
const FUND_MAX = 50_000_000

const bumpVisible = ref(false)
const bumpDir = ref<'up' | 'down'>('up')
const bumpAmount = ref(10000)

const canFundAgent = computed(() => staff.role === 'ADMIN' || staff.role === 'BRANCH')
const canPlayerFund = computed(() => staff.role === 'AGENT')
const isLandlord = computed(() => staff.role === 'ADMIN' || staff.role === 'BRANCH')
const canSetStatus = computed(() =>
  staff.role === 'ADMIN' || staff.role === 'BRANCH' || staff.role === 'AGENT',
)
const canEditGames = computed(() => canSetStatus.value)

const reportHeroLabel = computed(() => (isLandlord.value ? '平台净盈亏' : '玩家盈亏'))
const reportHeroValue = computed(() => {
  const s = report.value
  if (!s) return 0
  if (isLandlord.value) {
    if (s.netPnl != null) return Number(s.netPnl)
    return Number(s.platformShareAmount ?? s.housePnl ?? 0) - Number(s.commissionAmount ?? 0)
  }
  return Number(s.playerPnl || 0)
})
const reportHeroMetrics = computed(() => {
  const s = report.value
  if (!s) return [] as { k: string; v: string; cls?: string }[]
  if (isLandlord.value) {
    return [
      { k: '流水', v: fmt(s.betFlow) },
      { k: '派彩', v: fmt(s.payout) },
      { k: '庄家盈亏', v: fmtSigned(s.housePnl), cls: pnlClass(s.housePnl) },
      { k: '平台占成', v: fmtSigned(s.platformShareAmount ?? s.housePnl), cls: pnlClass(s.platformShareAmount ?? s.housePnl) },
    ]
  }
  return [
    { k: '流水', v: fmt(s.betFlow) },
    { k: '派彩', v: fmt(s.payout) },
    { k: '注单', v: fmt(s.betCount) },
  ]
})
const reportRows = computed(() => {
  const s = report.value
  if (!s) return [] as { k: string; v: string; cls?: string }[]
  if (isLandlord.value) {
    const commission = Number(s.commissionAmount || 0)
    return [
      { k: '注单数', v: fmt(s.betCount) },
      { k: '玩家盈亏', v: fmtSigned(s.playerPnl), cls: pnlClass(s.playerPnl) },
      { k: '代理佣金', v: fmt(commission), cls: commission > 0 ? 'down' : '' },
      { k: '佣金笔数', v: String(s.commissionCount ?? 0) },
      { k: '上分合计', v: fmt(s.upAmount), cls: 'up' },
      { k: '下分合计', v: fmt(s.downAmount), cls: 'down' },
      { k: '活跃玩家', v: String(s.activePlayers ?? 0) },
    ]
  }
  return [
    { k: '上分', v: fmt(s.upAmount), cls: 'up' },
    { k: '下分', v: fmt(s.downAmount), cls: 'down' },
    { k: '活跃玩家', v: String(s.activePlayers ?? '—') },
  ]
})
const statusOptions = computed(() => {
  const base = [
    { value: 'OPEN', label: '营业' },
    { value: 'MAINTENANCE', label: '维护' },
    { value: 'FROZEN', label: '冻结' },
  ]
  if (staff.role === 'ADMIN') base.push({ value: 'CLOSED', label: '关闭' })
  return base
})

const feeText = computed(() => {
  const fee = Number(room.value?.monthlyFee || 0)
  return fee > 0 ? `${Math.floor(fee)}/月` : '不收费'
})

const enabledGameCount = computed(() => games.value.filter((g) => g.enabled).length)

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
function statusLabel(s: string) {
  return ({ OPEN: '营业', CLOSED: '关闭', MAINTENANCE: '维护', FROZEN: '冻结' } as Record<string, string>)[s] || s
}
function gameLabel(code: string) {
  return GAME_LABEL[code] || code
}
function switchReportRange(key: string) {
  if (reportRange.value === key) return
  reportRange.value = key
  void loadReport()
}
async function loadReport() {
  if (!room.value) return
  reportLoading.value = true
  try {
    report.value = await staffConsoleApi.reportSummary({
      range: reportRange.value,
      roomId: room.value.id,
    })
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '报表加载失败')
    report.value = null
  } finally {
    reportLoading.value = false
  }
}
function onIconError(e: Event) {
  const img = e.target as HTMLImageElement | null
  if (img && img.src !== defaultIcon) img.src = defaultIcon
}
async function copyCode() {
  const code = room.value?.roomNo
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
    toast('已复制进房码')
  } catch {
    toast('复制失败，请长按复制')
  }
}
function goPlayers() {
  if (!room.value) return
  router.push({ name: 'staff-players', query: { roomId: room.value.id } })
}
function openAgentFund(mode: 'up' | 'down') {
  fundMode.value = mode
  fundAmount.value = 1000
  /* 订单号在开弹窗时定死，连点复用同一键由服务端去重 */
  fundOrderNo.value = newFundOrderNo(mode)
  fundConfirming.value = false
  fundVisible.value = true
}

function openBumpCredit(dir: 'up' | 'down') {
  bumpDir.value = dir
  bumpAmount.value = 10000
  bumpVisible.value = true
}

function closeBump() {
  if (busy.value) return
  bumpVisible.value = false
}

async function doBumpCredit() {
  if (!room.value) return
  const amount = Number(bumpAmount.value)
  if (!(amount > 0)) return toast('请输入金额')
  busy.value = true
  try {
    const res = await staffConsoleApi.bumpCreditLimit(room.value.id, {
      amount,
      direction: bumpDir.value,
    })
    toast(res.message || (bumpDir.value === 'up' ? '已增加信用' : '已减少信用'))
    bumpVisible.value = false
    await load()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '调整失败')
  } finally {
    busy.value = false
  }
}

async function setStatus(status: string) {
  if (!room.value || !canSetStatus.value || statusBusy.value) return
  /* 冻结/关闭会影响整房玩家，与 admin 端 RoomDetailView 一样要二次确认 */
  if (status === 'FROZEN' || status === 'CLOSED') {
    const ok = window.confirm(
      `确认将房间「${room.value.name || room.value.roomNo}」设为${statusLabel(status)}？房内玩家将无法继续游戏。`,
    )
    if (!ok) return
  }
  statusBusy.value = true
  try {
    await staffConsoleApi.setRoomStatus(room.value.id, status)
    toast(`已设为${statusLabel(status)}`)
    await load()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '改状态失败')
  } finally {
    statusBusy.value = false
  }
}

async function toggleGame(g: StaffRoomGameCfg) {
  if (!room.value || !canEditGames.value) return
  gameBusy.value = g.gameCode
  try {
    await staffConsoleApi.patchRoomGame(room.value.id, g.gameCode, { enabled: !g.enabled })
    g.enabled = !g.enabled
    toast(`${gameLabel(g.gameCode)}已${g.enabled ? '开启' : '关闭'}`)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '更新失败')
  } finally {
    gameBusy.value = ''
  }
}

async function doAgentFund() {
  const uid = room.value?.ownerAgent?.userId
  if (!uid || busy.value) return
  const amount = Number(fundAmount.value)
  if (!Number.isInteger(amount) || amount <= 0) return toast('金额须为正整数')
  if (amount > FUND_MAX) return toast(`单笔不超过 ${fmt(FUND_MAX)}`)
  if (!fundConfirming.value) {
    fundConfirming.value = true
    return
  }
  busy.value = true
  try {
    const orderNo = fundOrderNo.value
    if (fundMode.value === 'up') await staffConsoleApi.issue(uid, amount, orderNo)
    else await staffConsoleApi.recall(uid, amount, orderNo)
    toast(fundMode.value === 'up' ? '已上分' : '已下分')
    fundVisible.value = false
    await load()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '失败')
    fundConfirming.value = false
  } finally {
    busy.value = false
  }
}

async function loadGames() {
  if (!room.value) return
  gamesLoading.value = true
  try {
    games.value = await staffConsoleApi.roomGames(room.value.id)
  } catch {
    games.value = []
  } finally {
    gamesLoading.value = false
  }
}

async function load() {
  const id = String(route.params.id || '')
  if (!id) return
  loading.value = true
  try {
    room.value = await staffConsoleApi.room(id)
    await Promise.all([loadGames(), loadReport()])
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
    room.value = null
  } finally {
    loading.value = false
  }
}

watch(tab, (t) => {
  if (t === 'ops' && room.value && !report.value && !reportLoading.value) void loadReport()
})

onMounted(() => { void load() })
</script>

<style scoped>
.rd-hero {
  position: relative;
  margin-bottom: 12px;
  padding: 16px 14px 12px;
  border-radius: 14px;
  border: 2px solid transparent;
  background:
    radial-gradient(120% 90% at 100% 0%, rgba(245, 158, 11, 0.16), transparent 55%),
    linear-gradient(165deg, rgba(48, 34, 18, 0.98) 0%, rgba(16, 11, 7, 0.99) 100%) padding-box,
    linear-gradient(
      135deg,
      #f5e2a0 0%,
      #c9a227 18%,
      #8a6818 38%,
      #e8c96a 55%,
      #a8801e 72%,
      #6b4f1a 88%,
      #f0d878 100%
    ) border-box;
  box-shadow:
    0 0 0 1px rgba(244, 211, 107, 0.22),
    0 0 18px rgba(212, 160, 64, 0.18),
    0 8px 22px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 244, 194, 0.16);
  overflow: hidden;
}
.rd-hero::before {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 11px;
  border: 1px solid rgba(244, 211, 107, 0.28);
  pointer-events: none;
}

.rd-corner {
  position: absolute;
  width: 14px;
  height: 14px;
  pointer-events: none;
  z-index: 1;
}
.rd-corner::before,
.rd-corner::after {
  content: '';
  position: absolute;
  background: linear-gradient(90deg, #f5e2a0, #c9a227);
}
.rd-corner::before { width: 14px; height: 1.5px; }
.rd-corner::after { width: 1.5px; height: 14px; }
.rd-corner.tl { top: 7px; left: 7px; }
.rd-corner.tr { top: 7px; right: 7px; transform: scaleX(-1); }
.rd-corner.bl { bottom: 7px; left: 7px; transform: scaleY(-1); }
.rd-corner.br { bottom: 7px; right: 7px; transform: scale(-1); }

.rd-top {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}
.rd-icon-wrap {
  width: 74px;
  height: 74px;
  flex-shrink: 0;
  padding: 3px;
  border-radius: 14px;
  background:
    linear-gradient(#1a1208, #1a1208) padding-box,
    linear-gradient(160deg, #fff4c2, #d4a832 40%, #8a6818 70%, #f0d878) border-box;
  border: 2px solid transparent;
}
.rd-icon {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 10px;
  object-fit: cover;
  background: rgba(0, 0, 0, 0.35);
}
.rd-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
}
.rd-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rd-name {
  min-width: 0;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: #f5d36b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rd-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.rd-chip {
  font-size: 10px;
  letter-spacing: 0.5px;
  color: #d4af37;
  border: 1px solid rgba(212, 175, 55, 0.4);
  border-radius: 4px;
  padding: 2px 6px;
}
.rd-st {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(212, 175, 55, 0.35);
  color: #f5d36b;
}
.rd-st.open { color: #86efac; border-color: rgba(134, 239, 172, 0.45); }
.rd-st.closed,
.rd-st.frozen { color: #fca5a5; border-color: rgba(252, 165, 165, 0.45); }
.rd-st.maintenance { color: #f5d36b; }

.rd-code {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(212, 175, 55, 0.22);
  background: rgba(0, 0, 0, 0.32);
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.rd-code:active { opacity: 0.88; }
.rd-code-k {
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-muted);
}
.rd-code-v {
  flex: 1;
  text-align: left;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 2px;
  font-variant-numeric: tabular-nums;
  color: #fff4c2;
  font-family: 'Roboto Mono', 'SF Mono', Menlo, Consolas, ui-monospace, monospace;
}
.rd-code-act {
  flex-shrink: 0;
  font-size: 11px;
  letter-spacing: 1px;
  color: #f5d36b;
}

.rd-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.rd-grid.tight { margin-top: 4px; }
.rd-cell {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-height: 40px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.26);
  border: 1px solid rgba(212, 175, 55, 0.14);
}
.rd-cell.wide { grid-column: 1 / -1; }
.rd-cell .mk {
  flex-shrink: 0;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text-muted);
}
.rd-cell .mv {
  min-width: 0;
  text-align: right;
  font-size: 15px;
  font-weight: 800;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rd-cell .mv.accent { color: var(--gold-bright, #f5d36b); }

.rd-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  margin-bottom: 12px;
  padding: 3px;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 55, 0.28);
  background: rgba(12, 8, 5, 0.75);
}
.rd-tabs button {
  height: 34px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  letter-spacing: 2px;
  cursor: pointer;
}
.rd-tabs button.on {
  color: #1a1208;
  font-weight: 700;
  background: linear-gradient(180deg, #f5d36b, #c9a227);
  box-shadow: 0 2px 8px rgba(201, 162, 39, 0.35);
}

.rd-panel {
  margin-bottom: 12px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.26);
  background: rgba(20, 14, 8, 0.88);
}
.rd-panel-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 2px 10px;
  font-size: 12px;
  letter-spacing: 3px;
  color: var(--text-muted);
}
.rd-panel-meta {
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.65);
}
.rd-panel-act {
  border: 0;
  background: transparent;
  color: #f5d36b;
  font-size: 11px;
  letter-spacing: 1px;
  cursor: pointer;
  padding: 0;
}
.rd-panel-act:disabled { opacity: 0.5; cursor: default; }

.rd-rpt-hero {
  margin-top: 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 55, 0.18);
  background:
    radial-gradient(120% 80% at 100% 0%, rgba(245, 158, 11, 0.12), transparent 55%),
    rgba(0, 0, 0, 0.28);
}
.rd-rpt-k {
  font-size: 11px;
  letter-spacing: 2px;
  color: rgba(255, 244, 194, 0.72);
  margin-bottom: 4px;
}
.rd-rpt-v {
  font-size: 28px;
  font-weight: 800;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  margin-bottom: 10px;
}
.rd-rpt-v.up { color: #86efac; }
.rd-rpt-v.down { color: #fca5a5; }
.rd-rpt-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid rgba(244, 211, 107, 0.12);
}
.rd-rpt-metrics.cols3 { grid-template-columns: repeat(3, 1fr); }
.rd-rpt-metrics .k {
  display: block;
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 3px;
  letter-spacing: 0.5px;
}
.rd-rpt-metrics .v {
  font-size: 12px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}
.rd-rpt-metrics .v.up { color: #86efac; }
.rd-rpt-metrics .v.down { color: #fca5a5; }

.rd-rpt-list {
  margin-top: 10px;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 55, 0.14);
  background: rgba(0, 0, 0, 0.22);
  overflow: hidden;
}
.rd-rpt-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 12px;
  border-bottom: 1px solid rgba(244, 211, 107, 0.08);
}
.rd-rpt-row:last-child { border-bottom: 0; }
.rd-rpt-row .k {
  font-size: 13px;
  color: var(--text-muted);
  letter-spacing: 1px;
}
.rd-rpt-row .v {
  font-size: 14px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
}
.rd-rpt-row .v.up { color: #86efac; }
.rd-rpt-row .v.down { color: #fca5a5; }

.rd-rpt-sub {
  margin: 14px 2px 8px;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--text-muted);
}
.rd-rpt-game {
  margin-bottom: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(212, 175, 55, 0.14);
  background: rgba(0, 0, 0, 0.22);
}
.rd-rpt-game:last-child { margin-bottom: 0; }
.rd-rpt-game-hd {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.rd-rpt-game-hd b {
  font-size: 14px;
  color: #fff4c2;
  letter-spacing: 1px;
}
.rd-rpt-game-hd span {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff4c2;
}
.rd-rpt-game-hd span.up { color: #86efac; }
.rd-rpt-game-hd span.down { color: #fca5a5; }
.rd-rpt-game-m {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  font-size: 11px;
  color: var(--text-muted);
}

@media (max-width: 360px) {
  .rd-rpt-metrics { grid-template-columns: repeat(2, 1fr); }
}

.rd-status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(64px, 1fr));
  gap: 8px;
}
.rd-st-btn {
  height: 36px;
  border-radius: 10px;
  border: 1px solid rgba(244, 211, 107, 0.28);
  background: rgba(0, 0, 0, 0.28);
  color: var(--text-dim, #a89b84);
  font-size: 13px;
  letter-spacing: 1px;
  cursor: pointer;
}
.rd-st-btn.on {
  color: #1a1208;
  font-weight: 700;
  border-color: transparent;
  background: linear-gradient(180deg, #f5d36b, #c9a227);
}
.rd-st-btn.danger:not(.on) {
  border-color: rgba(252, 165, 165, 0.28);
  color: #fca5a5;
}
.rd-st-btn:disabled:not(.on) { opacity: 0.4; cursor: not-allowed; }

.rd-tip {
  margin: 10px 2px 0;
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}
.rd-tip.inline { margin: 0 2px 10px; }

.rd-links { display: flex; flex-direction: column; gap: 8px; }
.rd-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 12px 12px;
  border-radius: 10px;
  border: 1px solid rgba(212, 175, 55, 0.16);
  background: rgba(0, 0, 0, 0.22);
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.rd-link:active { opacity: 0.9; }
.rd-link-txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.rd-link .lb {
  font-size: 15px;
  color: #fff4c2;
  letter-spacing: 1px;
}
.rd-link .sub {
  font-size: 11px;
  color: var(--text-muted);
}
.rd-link .arrow {
  color: #f5d36b;
  font-size: 20px;
  line-height: 1;
}

.rd-games { display: flex; flex-direction: column; gap: 8px; }
.rd-game {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(212, 175, 55, 0.14);
  background: rgba(0, 0, 0, 0.22);
}
.rd-game-name {
  font-size: 14px;
  color: #fff4c2;
  letter-spacing: 1px;
}
.rd-game-code {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
}
.rd-switch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(34, 197, 94, 0.45);
  background: rgba(34, 197, 94, 0.18);
  color: #86efac;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
}
.rd-switch.off {
  border-color: rgba(148, 163, 184, 0.35);
  background: rgba(71, 85, 105, 0.25);
  color: #94a3b8;
}
.rd-switch.disabled { opacity: 0.5; cursor: not-allowed; }
.rd-switch input { display: none; }

.rd-agent { margin: 0 2px 10px; }
.rd-agent-name {
  font-size: 16px;
  font-weight: 700;
  color: #fff4c2;
  letter-spacing: 1px;
}
.rd-agent-sub {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.rd-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.rd-btn {
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(212, 175, 55, 0.4);
  background: linear-gradient(180deg, rgba(245, 211, 107, 0.22), rgba(201, 162, 39, 0.12));
  color: #fff4c2;
  font-size: 14px;
  letter-spacing: 1px;
  cursor: pointer;
}
.rd-btn.warn {
  border-color: rgba(252, 165, 165, 0.4);
  background: linear-gradient(180deg, rgba(252, 165, 165, 0.18), rgba(185, 28, 28, 0.12));
  color: #fecaca;
}
</style>
