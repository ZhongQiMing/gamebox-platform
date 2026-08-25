<template>
  <!-- 客服：简洁顶栏工作台 -->
  <div v-if="isCs" class="desk-root cs-mode">
    <header class="desk-titlebar">
      <div class="titlebar-left">
        <span class="app-mark">♛</span>
        <span class="app-name">客服工作台</span>
        <el-tag v-if="envTag" size="small" :type="envTag.type" effect="dark">{{ envTag.label }}</el-tag>
      </div>
      <div class="titlebar-right">
        <el-tag size="small" effect="plain">{{ roleLabel }}</el-tag>
        <span v-if="showWalletBalance" class="stat-chip gold">客服额度 {{ balanceText }}</span>
        <span v-if="displayName" class="nick">{{ displayName }}</span>
        <button type="button" class="tb-link" @click="pwdVisible = true">改密码</button>
        <button type="button" class="tb-link danger" @click="doLogout">退出</button>
      </div>
    </header>
    <main class="desk-main">
      <RouterView />
    </main>
    <footer class="desk-status">
      <span>客服会话</span>
      <span class="sep">|</span>
      <span>{{ nowText }}</span>
    </footer>
  </div>

  <!-- 管理端：exe 风格顶栏工具带 -->
  <div v-else class="desk-root">
    <header class="desk-titlebar">
      <div class="titlebar-left">
        <span class="app-mark">♛</span>
        <span class="app-name">Gamebox 运营控制台</span>
        <span class="app-ver">Desktop</span>
        <el-tag v-if="envTag" size="small" :type="envTag.type" effect="dark">{{ envTag.label }}</el-tag>
      </div>
      <div class="titlebar-right">
        <el-tag size="small" effect="plain">{{ roleLabel }}</el-tag>
        <!-- 余额=手上的盘分；额度=合同/剩余信用。两个词不许混用 -->
        <span v-if="isGeneralUser" class="stat-chip gold">总代余额 {{ agentBalanceText }}</span>
        <span v-if="isGeneralUser" class="stat-chip" :title="roomBalanceHint">房间余额 {{ roomBalanceText }}</span>
        <span v-if="isGeneralUser" class="stat-chip">上盘可飞 {{ coverText || '0.00' }}</span>
        <!-- 现金/信用同一套：代理余额 / 客服额度 / 上盘可飞 / 玩家持分 -->
        <span v-if="isAgent" class="stat-chip gold">代理余额 {{ agentBalanceText }}</span>
        <span v-if="isAgent" class="stat-chip">客服额度 {{ csBalancesText }}</span>
        <span v-if="isAgent" class="stat-chip">上盘可飞 {{ coverText || '0.00' }}</span>
        <span v-if="isAgent && playersText" class="stat-chip">玩家持分 {{ playersText }}</span>
        <span v-if="displayName" class="nick">{{ displayName }}</span>
        <button type="button" class="tb-link" @click="pwdVisible = true">改密码</button>
        <button type="button" class="tb-link danger" @click="doLogout">退出</button>
      </div>
    </header>

    <!-- 主项：每个页面入口（大号工具按钮） -->
    <nav class="desk-mainnav" aria-label="页面主项">
      <div class="mainnav-pages">
        <template v-for="(g, gi) in menuGroups" :key="g.id">
          <span v-if="gi > 0" class="mainnav-split" aria-hidden="true" />
          <button
            v-for="m in g.items"
            :key="m.name"
            type="button"
            class="main-btn"
            :class="{
              active: activeMenu === m.name,
              alert:
                (m.name === 'risk' && riskCritical > 0)
                || (m.name === 'recharge' && rechargePending > 0),
            }"
            @click="router.push({ name: m.name })"
          >
            <el-icon :size="24"><component :is="m.icon" /></el-icon>
            <span class="main-btn-text">{{ m.title }}</span>
            <el-badge
              v-if="m.name === 'risk' && riskUnhandled > 0"
              :value="riskUnhandled"
              :max="99"
              class="main-badge"
            />
            <el-badge
              v-else-if="m.name === 'recharge' && rechargePending > 0"
              :value="rechargePending"
              :max="99"
              class="main-badge"
            />
          </button>
        </template>
      </div>
      <div class="mainnav-utils">
        <button
          v-if="canGlobalSearch"
          type="button"
          class="main-util"
          title="全局检索 (Ctrl+K)"
          @click="openSearch"
        >
          <span class="main-util-k">检索</span>
          <span class="main-util-hint">⌘K</span>
        </button>
        <button
          v-if="showWalletBalance"
          type="button"
          class="main-util"
          @click="onRefreshBalance"
        >
          <span class="main-util-k">刷新余额</span>
        </button>
      </div>
    </nav>

    <main class="desk-main">
      <RouterView />
    </main>

    <footer class="desk-status">
      <span>就绪</span>
      <span class="sep">|</span>
      <span>{{ roleLabel }} · {{ store.profile?.nickname || '—' }} · {{ store.profile?.username || '' }}</span>
      <span class="sep">|</span>
      <span>当前：{{ activeTitle }}</span>
      <span class="status-grow" />
      <span>{{ nowText }}</span>
    </footer>
  </div>

  <DeskDialog v-model="pwdVisible" title="修改登录密码" width="420px" @closed="resetPwdForm">
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="当前密码">
        <el-input v-model="pwdForm.oldPassword" type="password" show-password autocomplete="current-password" />
      </el-form-item>
      <el-form-item :label="`新密码（${OPS_PASSWORD_HINT}）`">
        <el-input v-model="pwdForm.newPassword" type="password" show-password autocomplete="new-password" />
      </el-form-item>
      <el-form-item label="确认新密码">
        <el-input v-model="pwdForm.confirm" type="password" show-password autocomplete="new-password" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="pwdVisible = false">取消</el-button>
      <span class="win-footer-grow" />
      <el-button type="primary" :loading="pwdSaving" @click="submitPassword">保存</el-button>
    </template>
  </DeskDialog>

  <DeskDialog v-model="searchVisible" title="全局检索" width="560px" @opened="focusSearch">
    <el-input
      ref="searchInputRef"
      v-model="searchQ"
      clearable
      placeholder="登录账号 / 昵称 / UID / 房间名"
      @keyup.enter="runSearch"
    >
      <template #append>
        <el-button :loading="searchLoading" @click="runSearch">搜索</el-button>
      </template>
    </el-input>
    <div v-if="searchDone" class="search-body">
      <div class="search-sec">
        <div class="search-h">玩家（{{ searchPlayers.length }}）</div>
        <div v-if="!searchPlayers.length" class="search-empty">无匹配</div>
        <button
          v-for="p in searchPlayers"
          :key="p.id"
          type="button"
          class="search-item"
          @click="goPlayer(p)"
        >
          <b>{{ p.nickname }}</b>
          <span>{{ p.username }} · {{ p.uid }}</span>
          <span v-if="p.roomLabel" class="search-room">{{ p.roomLabel }}</span>
        </button>
      </div>
      <div class="search-sec">
        <div class="search-h">账号（{{ searchAgents.length }}）</div>
        <div v-if="!searchAgents.length" class="search-empty">无匹配</div>
        <button
          v-for="a in searchAgents"
          :key="a.id"
          type="button"
          class="search-item"
          @click="goAgent(a)"
        >
          <b>{{ a.nickname }}</b>
          <span>{{ staffRoleLabel(a.role) }} · {{ a.username }} · {{ a.uid }}</span>
        </button>
      </div>
    </div>
  </DeskDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, markRaw, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { formatMoney, isGeneralSide, OPS_PASSWORD_HINT, staffMatchesRoles, staffRoleLabel, validateOpsPassword } from '@gamebox/shared'
import {
  DataAnalysis, Wallet, Warning, Document, Finished,
  Trophy, OfficeBuilding, TrendCharts, Aim, Coin, Avatar, Headset, Tickets, Monitor, User,
} from '@element-plus/icons-vue'
import { consoleApi } from '@/api/console'
import { riskApi, reviewApi } from '@/api/admin'
import { useAdminStore } from '@/stores/admin'
import http from '@/api/http'
import DeskDialog from '@/components/DeskDialog.vue'

const router = useRouter()
const route = useRoute()
const store = useAdminStore()
const balance = ref<number | null>(null)
const pointsQuota = ref<number | null>(null)
const csBalances = ref<number | null>(null)
const flyCover = ref<number | null>(null)
const roomBalance = ref<number | null>(null)
const playerPointsTotal = ref<number | null>(null)
const overIssueUsed = ref<number | null>(null)
const fakeExposure = ref<number | null>(null)
const bookMode = ref<'CASH' | 'CREDIT' | string | null>(null)
const riskUnhandled = ref(0)
/** 只有严重告警才让主项闪红；警告级别给个安静的角标就够 */
const riskCritical = ref(0)
const rechargePending = ref(0)
let riskTimer: ReturnType<typeof setInterval> | null = null
let rechargeTimer: ReturnType<typeof setInterval> | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null
const nowText = ref('')

const pwdVisible = ref(false)
const pwdSaving = ref(false)
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' })

const searchVisible = ref(false)
const searchLoading = ref(false)
const searchDone = ref(false)
const searchQ = ref('')
const searchInputRef = ref<{ focus?: () => void } | null>(null)
const searchPlayers = ref<Array<{
  id: string
  nickname: string
  username: string
  uid: string
  roomId?: string | null
  roomLabel?: string
}>>([])
const searchAgents = ref<Array<{
  id: string
  nickname: string
  username: string
  uid: string
  role: string
  roomId?: string
}>>([])

const roleLabel = computed(() =>
  staffRoleLabel(store.profile?.role, store.profile?.parentRole),
)

/** 昵称若与角色标签相同（如 seed 的「管理员」），改显示账号，避免顶栏两个一样的字 */
const displayName = computed(() => {
  const nick = (store.profile?.nickname || '').trim()
  const user = (store.profile?.username || '').trim()
  if (nick && nick !== roleLabel.value) return nick
  return user || ''
})

const isCs = computed(() => store.profile?.role === 'CS')
const isGeneralUser = computed(() => isGeneralSide(store.profile?.role, store.profile?.parentRole))
const isAgent = computed(() => {
  if (isGeneralUser.value) return false
  const r = store.profile?.role
  return r === 'AGENT' || r === 'PROXY'
})
/** 仅代理/客服有余额 chip；管理员/房主无个人余额 */
const showWalletBalance = computed(() => {
  const r = store.profile?.role
  return r === 'AGENT' || r === 'GENERAL' || r === 'CS' || isGeneralSide(r, store.profile?.parentRole)
})
const canGlobalSearch = computed(() => {
  const r = store.profile?.role
  return r === 'ADMIN' || r === 'BRANCH' || isGeneralSide(r, store.profile?.parentRole)
})

const envTag = computed(() => {
  const mode = String(import.meta.env.MODE || '')
  if (mode === 'production') return null
  if (mode === 'development' || import.meta.env.DEV) {
    return { label: '开发环境', type: 'warning' as const }
  }
  return { label: mode || '非生产', type: 'info' as const }
})

const activeMenu = computed(() => {
  const name = String(route.name || '')
  if (name === 'general-detail') return route.query.from === 'agents' ? 'agents' : 'rooms'
  if (name === 'agent-detail') return 'agents'
  if (name === 'general-settle') return 'settle'
  return name
})

function fmtBal(n: number | null) {
  return n == null ? '' : formatMoney(n)
}
const balanceText = computed(() => (balance.value == null ? '—' : fmtBal(balance.value)))
const coverText = computed(() => fmtBal(flyCover.value))
const roomBalanceText = computed(() => fmtBal(roomBalance.value ?? 0))
const playersText = computed(() => fmtBal(playerPointsTotal.value))
const roomBalanceHint = computed(() => {
  const room = Number(roomBalance.value ?? 0)
  const players = Number(playerPointsTotal.value ?? 0)
  const hands = Math.round((room - players) * 100) / 100
  return `代理手上 ${fmtBal(hands)} + 玩家持分 ${fmtBal(players)}`
})
/** 客服额度合计；为 0 时也显示便于对账 */
const csBalancesText = computed(() => fmtBal(csBalances.value ?? 0))
const agentBalance = ref<number | null>(null)
const agentBalanceText = computed(() => {
  if (agentBalance.value != null) return fmtBal(agentBalance.value)
  return fmtBal(Number(balance.value ?? 0))
})

type MenuGroup = 'ops' | 'money' | 'look' | 'game' | 'audit'
type MenuItem = { name: string; title: string; icon: unknown; roles: string[]; group: MenuGroup }

const MENU_GROUP_ORDER: MenuGroup[] = ['ops', 'money', 'look', 'game', 'audit']

/*
 * 主项按业务链排，一组一事：
 * 经营：看今日、管房、管人
 * 账务：占成结账、资金对账（只在这里结，不在房间里再做一份）
 * 盘面：报表、开奖
 * 玩法：游戏、控奖、回水
 * 合规：风控、日志
 */
const allMenus: MenuItem[] = [
  { name: 'dashboard', title: '工作台', icon: markRaw(DataAnalysis), roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'], group: 'ops' },
  { name: 'rooms', title: '房间中心', icon: markRaw(OfficeBuilding), roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'], group: 'ops' },
  { name: 'agents', title: '账号中心', icon: markRaw(Avatar), roles: ['ADMIN', 'BRANCH', 'GENERAL'], group: 'ops' },
  { name: 'players', title: '玩家中心', icon: markRaw(User), roles: ['ADMIN', 'BRANCH'], group: 'ops' },
  { name: 'recharge', title: '客服上下分', icon: markRaw(Wallet), roles: ['AGENT', 'CS'], group: 'ops' },
  { name: 'cs-staff', title: '客服账号', icon: markRaw(Headset), roles: ['AGENT'], group: 'ops' },
  { name: 'settle', title: '结算中心', icon: markRaw(Tickets), roles: ['ADMIN', 'BRANCH', 'GENERAL'], group: 'money' },
  { name: 'fund-recon', title: '资金对账', icon: markRaw(Finished), roles: ['ADMIN'], group: 'money' },
  { name: 'reports', title: '报表中心', icon: markRaw(TrendCharts), roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'], group: 'look' },
  { name: 'live', title: '实时开奖', icon: markRaw(Monitor), roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'], group: 'look' },
  { name: 'games', title: '游戏管理', icon: markRaw(Trophy), roles: ['ADMIN'], group: 'game' },
  { name: 'control', title: '控奖中心', icon: markRaw(Aim), roles: ['ADMIN'], group: 'game' },
  { name: 'rebate', title: '回水规则', icon: markRaw(Coin), roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'], group: 'game' },
  { name: 'risk', title: '风控告警', icon: markRaw(Warning), roles: ['ADMIN', 'BRANCH'], group: 'audit' },
  { name: 'logs', title: '操作日志', icon: markRaw(Document), roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'], group: 'audit' },
]

const menus = computed(() => {
  const role = store.profile?.role || ''
  const parentRole = store.profile?.parentRole
  return allMenus.filter((m) => staffMatchesRoles(role, m.roles, parentRole))
})

const menuGroups = computed(() =>
  MENU_GROUP_ORDER
    .map((id) => ({ id, items: menus.value.filter((m) => m.group === id) }))
    .filter((g) => g.items.length > 0),
)

const activeTitle = computed(() => {
  const m = menus.value.find((x) => x.name === activeMenu.value)
  return m?.title || String(route.name || '—')
})

function tickClock() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  nowText.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

async function refreshBalance() {
  if (!showWalletBalance.value && !isAgent.value) {
    balance.value = null
    pointsQuota.value = null
    csBalances.value = null
    agentBalance.value = null
    flyCover.value = null
    roomBalance.value = null
    playerPointsTotal.value = null
    overIssueUsed.value = null
    fakeExposure.value = null
    bookMode.value = null
    return false
  }
  try {
    const w = await consoleApi.walletMe()
    balance.value = w.balance
    pointsQuota.value = w.pointsQuota ?? null
    csBalances.value = w.csBalances ?? 0
    agentBalance.value = w.agentBalance ?? null
    flyCover.value = w.flyCover ?? null
    roomBalance.value = w.roomBalance ?? null
    playerPointsTotal.value = w.playerPointsTotal ?? null
    overIssueUsed.value = w.overIssueUsed ?? w.fakeExposure ?? null
    fakeExposure.value = w.fakeExposure ?? null
    bookMode.value = w.bookMode ?? null
    if (isCs.value) {
      try {
        const me = await consoleApi.csStaffMe()
        balance.value = me.balance
      } catch {
        /* ignore */
      }
    }
    return true
  } catch {
    balance.value = null
    pointsQuota.value = null
    csBalances.value = null
    agentBalance.value = null
    bookMode.value = null
    flyCover.value = null
    roomBalance.value = null
    playerPointsTotal.value = null
    overIssueUsed.value = null
    fakeExposure.value = null
    return false
  }
}

async function onRefreshBalance() {
  const ok = await refreshBalance()
  if (ok) ElMessage.success('余额已刷新')
  else ElMessage.error('刷新失败')
}

async function doLogout() {
  try {
    await ElMessageBox.confirm('确认退出运营控制台？', '提示', { type: 'warning' })
  } catch {
    return
  }
  /* 先让服务端清掉 HttpOnly Cookie——本地清不掉它，那正是它的意义 */
  try {
    await http.post('/auth/logout')
  } catch {
    /* 网络失败也要放人走：Cookie 到期自然失效 */
  }
  store.logout()
  router.push('/login')
}

async function refreshRiskBadge() {
  const role = store.profile?.role
  if (role !== 'ADMIN' && role !== 'BRANCH') {
    riskUnhandled.value = 0
    riskCritical.value = 0
    return
  }
  try {
    const s = await riskApi.summary()
    riskUnhandled.value = s.actionable ?? s.critical + s.warn
    riskCritical.value = s.critical
  } catch {
    /* ignore */
  }
}

async function refreshRechargeBadge() {
  const role = store.profile?.role
  if (role !== 'AGENT' && role !== 'CS') {
    rechargePending.value = 0
    return
  }
  try {
    /* 与客服上下分列表同口径，避免角标有数、列表为空 */
    const res = await reviewApi.list({ status: 'PENDING', page: 1, pageSize: 1 })
    rechargePending.value = res.total || 0
  } catch {
    /* ignore */
  }
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (!canGlobalSearch.value) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    openSearch()
  }
}

function resetPwdForm() {
  pwdForm.oldPassword = ''
  pwdForm.newPassword = ''
  pwdForm.confirm = ''
}

async function submitPassword() {
  if (!pwdForm.oldPassword) return ElMessage.warning('请填写当前密码')
  const newPwdErr = validateOpsPassword(pwdForm.newPassword, '新密码')
  if (newPwdErr) return ElMessage.warning(newPwdErr)
  if (pwdForm.newPassword !== pwdForm.confirm) return ElMessage.warning('两次新密码不一致')
  pwdSaving.value = true
  try {
    await http.patch('/users/me/password', {
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword,
    })
    ElMessage.success('密码已更新')
    pwdVisible.value = false
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
    ElMessage.error(msg || '修改失败')
  } finally {
    pwdSaving.value = false
  }
}

function openSearch() {
  searchVisible.value = true
  searchDone.value = false
  searchQ.value = ''
  searchPlayers.value = []
  searchAgents.value = []
}

function focusSearch() {
  void nextTick(() => searchInputRef.value?.focus?.())
}

async function runSearch() {
  const q = searchQ.value.trim()
  if (!q) return ElMessage.warning('请输入关键词')
  searchLoading.value = true
  searchDone.value = false
  try {
    const isAdmin = store.profile?.role === 'ADMIN'
    const isLandlord = isAdmin || store.profile?.role === 'BRANCH'
    const generalSide = isGeneralSide(store.profile?.role, store.profile?.parentRole)
    type AgentHit = {
      id: string; nickname: string; username: string; uid: string; role: string
      rooms?: Array<{ id: string }>
    }
    const emptyAgents = Promise.resolve({ list: [] as AgentHit[] })
    const [players, agents, generals, branches, proxies] = await Promise.all([
      consoleApi.players({ page: 1, pageSize: 8, q }),
      consoleApi.agents({ page: 1, pageSize: 8, role: 'AGENT', q, boundOnly: false }),
      isLandlord || generalSide
        ? consoleApi.agents({ page: 1, pageSize: 8, role: 'GENERAL', q, boundOnly: false })
        : emptyAgents,
      isAdmin
        ? consoleApi.agents({ page: 1, pageSize: 8, role: 'BRANCH', q, boundOnly: false })
        : emptyAgents,
      isLandlord || generalSide
        ? consoleApi.agents({ page: 1, pageSize: 8, role: 'PROXY', q, boundOnly: false })
        : emptyAgents,
    ])
    const base = (players.list || []).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      username: p.username,
      uid: p.uid,
      roomId: null as string | null | undefined,
      roomLabel: undefined as string | undefined,
    }))
    // 补房间信息，便于直达房间「玩家」副项
    const details = await Promise.all(
      base.slice(0, 8).map(async (p) => {
        try {
          const d = await consoleApi.playerDetail(p.id)
          return {
            ...p,
            roomId: d.roomId ?? d.room?.id ?? null,
            roomLabel: d.room
              ? `${d.room.name || d.room.roomNo || ''}`.trim() || undefined
              : undefined,
          }
        } catch {
          return p
        }
      }),
    )
    searchPlayers.value = details
    const ag = [...(agents.list || []), ...(generals.list || []), ...(branches.list || []), ...(proxies.list || [])]
    const seen = new Set<string>()
    searchAgents.value = ag
      .filter((a) => {
        if (seen.has(a.id)) return false
        seen.add(a.id)
        return true
      })
      .slice(0, 12)
      .map((a) => ({
        id: a.id,
        nickname: a.nickname,
        username: a.username,
        uid: a.uid,
        role: a.role,
        roomId: a.rooms?.[0]?.id,
      }))
    searchDone.value = true
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '搜索失败')
  } finally {
    searchLoading.value = false
  }
}

function goPlayer(p: {
  id: string
  uid: string
  nickname: string
  roomId?: string | null
}) {
  searchVisible.value = false
  if (p.roomId) {
    router.push({
      name: 'room-detail',
      params: { id: p.roomId },
      query: { tab: 'players', q: p.uid },
    })
    return
  }
  router.push({ name: 'rooms' })
  ElMessage.info(`玩家 ${p.nickname}（${p.uid}）未绑定房间，请从房间中心进入`)
}

function goAgent(a: { id: string; role: string; roomId?: string; nickname: string }) {
  searchVisible.value = false
  if (a.role === 'GENERAL') {
    router.push({ name: 'general-detail', params: { id: a.id }, query: { tab: 'basic' } })
    return
  }
  if (a.role === 'BRANCH') {
    router.push({ name: 'agent-detail', params: { id: a.id } })
    return
  }
  if (a.roomId) {
    router.push({ name: 'room-detail', params: { id: a.roomId }, query: { tab: 'agent' } })
    return
  }
  router.push({ name: 'rooms' })
}

watch(
  () => String(route.name || ''),
  () => {
    void refreshRechargeBadge()
    void refreshRiskBadge()
  },
)

/*
 * 后台常年挂在浏览器标签里不关。风控 / 充值角标和秒表原来不管标签是否可见都在跑，
 * 一台机器一天就是几千次没人看的请求。切回来时立刻补一次，角标不会是旧的。
 */
function onVisibilityChange() {
  if (document.hidden) return
  tickClock()
  void refreshRiskBadge()
  void refreshRechargeBadge()
}

onMounted(() => {
  tickClock()
  clockTimer = setInterval(() => {
    if (!document.hidden) tickClock()
  }, 1000)
  void refreshBalance()
  void refreshRiskBadge()
  void refreshRechargeBadge()
  riskTimer = setInterval(() => {
    if (!document.hidden) void refreshRiskBadge()
  }, 60_000)
  rechargeTimer = setInterval(() => {
    if (!document.hidden) void refreshRechargeBadge()
  }, 30_000)
  window.addEventListener('keydown', onGlobalKeydown)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  if (riskTimer) clearInterval(riskTimer)
  if (rechargeTimer) clearInterval(rechargeTimer)
  if (clockTimer) clearInterval(clockTimer)
  window.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<style scoped>
.desk-root {
  height: 100vh;
  display: flex;
  flex-direction: column;
  color: #e2e8f0;
  overflow: hidden;
  background:
    radial-gradient(900px 420px at 12% -10%, rgba(56, 189, 248, 0.18), transparent 55%),
    radial-gradient(700px 360px at 90% 0%, rgba(129, 140, 248, 0.16), transparent 50%),
    linear-gradient(180deg, #070b14 0%, #0f172a 42%, #111827 100%);
}

/* 标题栏 */
.desk-titlebar {
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  background: rgba(8, 12, 22, 0.72);
  color: #e2e8f0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  backdrop-filter: blur(14px);
  user-select: none;
}
.titlebar-left,
.titlebar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.app-mark {
  color: #38bdf8;
  font-size: 15px;
  line-height: 1;
  text-shadow: 0 0 12px rgba(56, 189, 248, 0.55);
}
.app-name { font-size: 13px; font-weight: 700; letter-spacing: 0.02em; }
.app-ver {
  font-size: 10px;
  color: #7dd3fc;
  padding: 2px 7px;
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.1);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.nick { font-size: 12px; color: #94a3b8; }
.stat-chip {
  font-size: 11px;
  color: #cbd5e1;
  background: rgba(148, 163, 184, 0.1);
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 999px;
  padding: 2px 8px;
}
.stat-chip.gold { color: #fbbf24; border-color: rgba(251, 191, 36, 0.35); }
.tb-link {
  border: 0;
  background: transparent;
  color: #94a3b8;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
}
.tb-link:hover { color: #e2e8f0; }
.tb-link.danger:hover { color: #fca5a5; }

/* 主项：大号页面入口（上图标下文案） */
.desk-mainnav {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  gap: 12px;
  min-height: 78px;
  padding: 8px 12px 10px;
  background: rgba(8, 12, 22, 0.62);
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  backdrop-filter: blur(12px);
}
.mainnav-pages,
.mainnav-utils {
  display: flex;
  align-items: stretch;
  gap: 8px;
}
/*
 * 横向滚动只挂在页面按钮这一段，右边的检索/时钟单独占位、永不压缩。
 * 原先滚动挂在整条导航上，按钮一多就顶穿容器，直接盖到检索按钮上面。
 */
.mainnav-pages {
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
}
.mainnav-pages::-webkit-scrollbar { height: 6px; }
.mainnav-pages::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.3);
}
.mainnav-utils {
  flex: 0 0 auto;
  margin-left: auto;
}
.mainnav-split {
  width: 1px;
  align-self: stretch;
  margin: 8px 4px;
  background: rgba(148, 163, 184, 0.28);
  flex-shrink: 0;
}
.main-btn {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 72px;
  padding: 8px 10px 6px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: #cbd5e1;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
}
.main-btn:hover {
  color: #f8fafc;
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.28);
}
.main-btn.active {
  color: #fff;
  border-color: rgba(56, 189, 248, 0.5);
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.32), rgba(56, 189, 248, 0.14));
  box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.12), 0 8px 20px rgba(37, 99, 235, 0.16);
}
.main-btn.alert {
  color: #fff;
  border-color: rgba(239, 68, 68, 0.75);
  background: linear-gradient(180deg, rgba(239, 68, 68, 0.55), rgba(185, 28, 28, 0.42));
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.25), 0 0 18px rgba(239, 68, 68, 0.35);
  animation: risk-pulse 1.6s ease-in-out infinite;
}
.main-btn.alert.active {
  border-color: #ef4444;
  background: linear-gradient(180deg, rgba(248, 113, 113, 0.7), rgba(220, 38, 38, 0.55));
}
.main-btn-text {
  font-size: 12px;
  font-weight: 650;
  line-height: 1.2;
  white-space: nowrap;
}
.main-badge {
  position: absolute;
  top: 4px;
  right: 6px;
}
@keyframes risk-pulse {
  0%, 100% { box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.25), 0 0 12px rgba(239, 68, 68, 0.28); }
  50% { box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.45), 0 0 22px rgba(239, 68, 68, 0.5); }
}
.main-util {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 72px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  color: #94a3b8;
  cursor: pointer;
  padding: 8px 10px;
}
.main-util:hover {
  color: #e2e8f0;
  border-color: rgba(148, 163, 184, 0.35);
  background: rgba(148, 163, 184, 0.1);
}
.main-util-k {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.main-util-hint {
  margin-top: 2px;
  font-size: 10px;
  font-weight: 500;
  color: #94a3b8;
  letter-spacing: 0.02em;
}

.desk-main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 10px 12px 12px;
  background:
    linear-gradient(rgba(148, 163, 184, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.035) 1px, transparent 1px);
  background-size: 28px 28px;
  background-color: transparent;
}
.desk-status {
  flex-shrink: 0;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  font-size: 11px;
  color: #94a3b8;
  background: rgba(8, 12, 22, 0.88);
  border-top: 1px solid rgba(148, 163, 184, 0.14);
}
.desk-status .sep { color: #475569; }
.status-grow { flex: 1; }

.cs-mode .desk-main {
  padding: 12px 14px 14px;
  overflow: hidden;
}

.search-body { margin-top: 16px; display: grid; gap: 14px; }
.search-h { font-size: 12px; color: #64748b; margin-bottom: 6px; }
.search-empty { font-size: 13px; color: #94a3b8; padding: 6px 0; }
.search-item {
  width: 100%;
  text-align: left;
  border: 1px solid #e2e8f0;
  background: #fff;
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.search-item:hover { border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12); }
.search-item span { font-size: 12px; color: #64748b; }
.search-item .search-room {
  display: block;
  margin-top: 2px;
  color: #0f172a;
  font-weight: 500;
}
</style>
