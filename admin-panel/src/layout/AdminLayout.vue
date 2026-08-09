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
        <!-- 信用盘：佣金账户 / 代理桌额度 / 客服 / 剩余信用(=代理+客服) / 玩家 -->
        <span v-if="isAgent && isCreditBook" class="stat-chip gold">佣金账户 {{ balanceText }}</span>
        <span v-if="isAgent && isCreditBook" class="stat-chip gold">代理额度 {{ agentDeskText }}</span>
        <span v-if="isAgent && isCreditBook" class="stat-chip">客服额度 {{ csBalancesText }}</span>
        <span v-if="isAgent && isCreditBook" class="stat-chip">剩余信用 {{ creditUnusedText }}</span>
        <!-- 现金盘：余额=代理桌盘分；客服额度分开；可飞=余额+客服 -->
        <span v-if="isAgent && !isCreditBook" class="stat-chip gold">代理余额 {{ balanceText }}</span>
        <span v-if="isAgent && !isCreditBook" class="stat-chip">客服额度 {{ csBalancesText }}</span>
        <span v-if="isAgent && !isCreditBook" class="stat-chip">上盘可飞 {{ coverText || '0.00' }}</span>
        <span v-if="isAgent && playersText" class="stat-chip">玩家持分 {{ playersText }}</span>
        <span v-if="displayName" class="nick">{{ displayName }}</span>
        <button type="button" class="tb-link" @click="pwdVisible = true">改密码</button>
        <button type="button" class="tb-link danger" @click="doLogout">退出</button>
      </div>
    </header>

    <!-- 主项：每个页面入口（大号工具按钮） -->
    <nav class="desk-mainnav" aria-label="页面主项">
      <div class="mainnav-pages">
        <button
          v-for="m in menus"
          :key="m.name"
          type="button"
          class="main-btn"
          :class="{
            active: activeMenu === m.name,
            alert:
              (m.name === 'risk' && riskUnhandled > 0)
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
      <span>{{ roleLabel }} · {{ store.profile?.nickname || '—' }}</span>
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
      <el-form-item label="新密码（至少 6 位）">
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
      placeholder="昵称 / 账号 / UID / 房间名"
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
          <span>{{ a.role }} · {{ a.username }} · {{ a.uid }}</span>
        </button>
      </div>
    </div>
  </DeskDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, markRaw, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAdminStore } from '@/stores/admin'
import { ElMessage, ElMessageBox } from 'element-plus'
import { validateOpsPassword } from '@gamebox/shared'
import {
  DataAnalysis, Wallet, Warning, Document, Finished,
  Trophy, OfficeBuilding, TrendCharts, Aim, Coin, Avatar, Headset,
} from '@element-plus/icons-vue'
import { consoleApi } from '@/api/console'
import { riskApi, reviewApi } from '@/api/admin'
import http from '@/api/http'
import DeskDialog from '@/components/DeskDialog.vue'

const router = useRouter()
const route = useRoute()
const store = useAdminStore()
const balance = ref<number | null>(null)
const pointsQuota = ref<number | null>(null)
const csBalances = ref<number | null>(null)
const flyCover = ref<number | null>(null)
const playerPointsTotal = ref<number | null>(null)
const overIssueUsed = ref<number | null>(null)
const fakeExposure = ref<number | null>(null)
const bookMode = ref<'CASH' | 'CREDIT' | string | null>(null)
const riskUnhandled = ref(0)
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

const roleLabel = computed(() => {
  const r = store.profile?.role
  if (r === 'ADMIN') return '管理员'
  if (r === 'BRANCH') return '房主'
  if (r === 'AGENT') return '代理'
  if (r === 'PROXY') return '子账号'
  if (r === 'CS') return '客服'
  return r || ''
})

/** 昵称若与角色标签相同（如 seed 的「管理员」），改显示账号，避免顶栏两个一样的字 */
const displayName = computed(() => {
  const nick = (store.profile?.nickname || '').trim()
  const user = (store.profile?.username || '').trim()
  if (nick && nick !== roleLabel.value) return nick
  return user || ''
})

const isCs = computed(() => store.profile?.role === 'CS')
const isAgent = computed(() => store.profile?.role === 'AGENT' || store.profile?.role === 'PROXY')
/** 仅代理/客服有余额 chip（信用=佣金账户）；管理员/房主无个人余额 */
const showWalletBalance = computed(() => {
  const r = store.profile?.role
  return r === 'AGENT' || r === 'CS'
})
const canGlobalSearch = computed(() => {
  const r = store.profile?.role
  return r === 'ADMIN' || r === 'BRANCH'
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
  if (name === 'room-detail') return 'rooms'
  if (name === 'agent-detail') return 'agents'
  return name
})

function fmtBal(n: number | null) {
  return n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2 })
}
const isCreditBook = computed(() => bookMode.value === 'CREDIT')
const balanceText = computed(() => (balance.value == null ? '—' : fmtBal(balance.value)))
const coverText = computed(() => fmtBal(flyCover.value))
const playersText = computed(() => fmtBal(playerPointsTotal.value))
/** 客服额度合计；为 0 时也显示便于对账 */
const csBalancesText = computed(() => fmtBal(csBalances.value ?? 0))
/** 信用：代理桌剩余额度（pointsQuota） */
const agentDeskText = computed(() => fmtBal(pointsQuota.value))
/** 信用未发总额（代理桌+客服）；兼容旧字段 */
const creditUnused = ref<number | null>(null)
const creditUnusedText = computed(() => {
  if (creditUnused.value != null) return fmtBal(creditUnused.value)
  const desk = Number(pointsQuota.value ?? 0)
  const cs = Number(csBalances.value ?? 0)
  return fmtBal(desk + cs)
})

type MenuItem = { name: string; title: string; icon: unknown; roles: string[] }

const allMenus: MenuItem[] = [
  { name: 'dashboard', title: '工作台', icon: markRaw(DataAnalysis), roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
  { name: 'rooms', title: '房间中心', icon: markRaw(OfficeBuilding), roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
  { name: 'reports', title: '报表中心', icon: markRaw(TrendCharts), roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
  { name: 'recharge', title: '客服上下分', icon: markRaw(Wallet), roles: ['AGENT', 'CS'] },
  { name: 'cs-staff', title: '客服账号', icon: markRaw(Headset), roles: ['AGENT'] },
  { name: 'games', title: '游戏管理', icon: markRaw(Trophy), roles: ['ADMIN'] },
  { name: 'control', title: '控奖中心', icon: markRaw(Aim), roles: ['ADMIN'] },
  { name: 'agents', title: '账号中心', icon: markRaw(Avatar), roles: ['ADMIN'] },
  { name: 'rebate', title: '回水规则', icon: markRaw(Coin), roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
  { name: 'risk', title: '风控告警', icon: markRaw(Warning), roles: ['ADMIN', 'BRANCH'] },
  { name: 'fund-recon', title: '资金对账', icon: markRaw(Finished), roles: ['ADMIN'] },
  { name: 'logs', title: '操作日志', icon: markRaw(Document), roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
]

const menus = computed(() => {
  const role = store.profile?.role || ''
  const agentSide = role === 'AGENT' || role === 'PROXY'
  return allMenus
    .filter((m) => m.roles.includes(role))
    .map((m) => (m.name === 'rooms' && agentSide ? { ...m, title: '我的房间' } : m))
})

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
    creditUnused.value = null
    flyCover.value = null
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
    creditUnused.value = w.creditUnused ?? w.diskPoolRemaining ?? null
    flyCover.value = w.flyCover ?? null
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
    creditUnused.value = null
    bookMode.value = null
    flyCover.value = null
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
    return
  }
  try {
    const s = await riskApi.summary()
    riskUnhandled.value = s.unhandled
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
    const [players, agents, branches] = await Promise.all([
      consoleApi.players({ page: 1, pageSize: 8, q }),
      consoleApi.agents({ page: 1, pageSize: 8, role: 'AGENT', q, boundOnly: false }),
      // 房主检索只查玩家/代理；房主账号列表仍仅管理员
      isAdmin
        ? consoleApi.agents({ page: 1, pageSize: 8, role: 'BRANCH', q, boundOnly: false })
        : Promise.resolve({ list: [] as Array<{
            id: string; nickname: string; username: string; uid: string; role: string
            rooms?: Array<{ id: string }>
          }> }),
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
    const ag = [...(agents.list || []), ...(branches.list || [])]
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

onMounted(() => {
  tickClock()
  clockTimer = setInterval(tickClock, 1000)
  void refreshBalance()
  void refreshRiskBadge()
  void refreshRechargeBadge()
  riskTimer = setInterval(() => void refreshRiskBadge(), 60_000)
  rechargeTimer = setInterval(() => void refreshRechargeBadge(), 30_000)
  window.addEventListener('keydown', onGlobalKeydown)
})
onUnmounted(() => {
  if (riskTimer) clearInterval(riskTimer)
  if (rechargeTimer) clearInterval(rechargeTimer)
  if (clockTimer) clearInterval(clockTimer)
  window.removeEventListener('keydown', onGlobalKeydown)
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
  justify-content: space-between;
  gap: 12px;
  min-height: 78px;
  padding: 8px 12px 10px;
  background: rgba(8, 12, 22, 0.62);
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  backdrop-filter: blur(12px);
  overflow-x: auto;
}
.mainnav-pages,
.mainnav-utils {
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}
.main-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 78px;
  padding: 8px 12px 6px;
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
