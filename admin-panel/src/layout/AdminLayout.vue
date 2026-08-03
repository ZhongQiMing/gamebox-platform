<template>
  <el-container class="admin-root">
    <el-aside :width="collapsed ? '64px' : '220px'" class="aside">
      <div class="logo" @click="router.push('/dashboard')">
        <span class="logo-icon">♛</span>
        <span v-if="!collapsed" class="logo-text">运营控制台</span>
      </div>
      <el-menu
        :key="activeMenu"
        :default-active="activeMenu"
        :collapse="collapsed"
        :collapse-transition="false"
        background-color="#181c27"
        text-color="#a0a8c0"
        active-text-color="#d4a93c"
        @select="(name: string) => router.push({ name })"
      >
        <el-menu-item v-for="m in menus" :key="m.name" :index="m.name">
          <el-icon><component :is="m.icon" /></el-icon>
          <template #title>
            <span>{{ m.title }}</span>
            <el-badge
              v-if="m.name === 'risk' && riskUnhandled > 0"
              :value="riskUnhandled"
              :max="99"
              class="menu-badge"
            />
          </template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-button :icon="collapsed ? Expand : Fold" text @click="collapsed = !collapsed" />
          <el-tag v-if="envTag" size="small" :type="envTag.type" effect="dark">{{ envTag.label }}</el-tag>
          <el-button
            v-if="canGlobalSearch"
            text
            type="primary"
            @click="openSearch"
          >全局检索</el-button>
        </div>
        <div class="header-right">
          <el-tag size="small" effect="plain">{{ roleLabel }}</el-tag>
          <!-- 超管/房主只看经营统计；账户余额仅代理日常要用 -->
          <span v-if="showWalletBalance" class="bal">余额 {{ balanceText }}</span>
          <span v-if="isAgent && quotaText" class="bal dim">真分 {{ quotaText }}</span>
          <span v-if="isAgent && coverText" class="bal dim">飞盘 {{ coverText }}</span>
          <span v-if="isAgent && playersText" class="bal dim">玩家 {{ playersText }}</span>
          <span v-if="isAgent && fakeText" class="bal dim">假分 {{ fakeText }}</span>
          <span class="nick">{{ store.profile?.nickname }}</span>
          <el-button text size="small" @click="pwdVisible = true">改密码</el-button>
          <el-button type="danger" text size="small" @click="doLogout">退出</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <RouterView />
      </el-main>
    </el-container>

    <!-- 改自己密码 -->
    <el-dialog v-model="pwdVisible" title="修改登录密码" width="420px" destroy-on-close @closed="resetPwdForm">
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
        <el-button type="primary" :loading="pwdSaving" @click="submitPassword">保存</el-button>
      </template>
    </el-dialog>

    <!-- 超管全局检索：玩家 / 代理 / 房主 -->
    <el-dialog v-model="searchVisible" title="全局检索" width="560px" destroy-on-close @opened="focusSearch">
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
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, markRaw } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAdminStore } from '@/stores/admin'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  DataAnalysis, Wallet, Warning, Document, Expand, Fold, Trophy,
  OfficeBuilding, User, TrendCharts, Aim, Coin, Avatar,
} from '@element-plus/icons-vue'
import { consoleApi } from '@/api/console'
import { riskApi } from '@/api/admin'
import http from '@/api/http'

const router = useRouter()
const route = useRoute()
const store = useAdminStore()
const collapsed = ref(false)
const balance = ref<number | null>(null)
const pointsQuota = ref<number | null>(null)
const flyCover = ref<number | null>(null)
const playerPointsTotal = ref<number | null>(null)
const fakeExposure = ref<number | null>(null)
const riskUnhandled = ref(0)
let riskTimer: ReturnType<typeof setInterval> | null = null

const pwdVisible = ref(false)
const pwdSaving = ref(false)
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' })

const searchVisible = ref(false)
const searchLoading = ref(false)
const searchDone = ref(false)
const searchQ = ref('')
const searchInputRef = ref<{ focus?: () => void } | null>(null)
const searchPlayers = ref<Array<{
  id: string; nickname: string; username: string; uid: string
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
  if (r === 'ADMIN') return '超级管理员'
  if (r === 'BRANCH') return '房主'
  if (r === 'AGENT') return '代理'
  if (r === 'PROXY') return '子账号'
  return r || ''
})

const isAgent = computed(() => store.profile?.role === 'AGENT' || store.profile?.role === 'PROXY')
const showWalletBalance = computed(() => store.profile?.role === 'AGENT')
const canGlobalSearch = computed(() => store.profile?.role === 'ADMIN')

const envTag = computed(() => {
  const mode = String(import.meta.env.MODE || '')
  if (mode === 'production') return null
  if (mode === 'development' || import.meta.env.DEV) {
    return { label: '开发环境', type: 'warning' as const }
  }
  return { label: mode || '非生产', type: 'info' as const }
})

/** 详情页高亮父级菜单 */
const activeMenu = computed(() => {
  const name = String(route.name || '')
  if (name === 'room-detail') return 'rooms'
  if (name === 'agent-detail') return 'agents'
  return name
})

function fmtBal(n: number | null) {
  return n == null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2 })
}
const balanceText = computed(() => (balance.value == null ? '—' : fmtBal(balance.value)))
const quotaText = computed(() => fmtBal(pointsQuota.value))
const coverText = computed(() => fmtBal(flyCover.value))
const playersText = computed(() => fmtBal(playerPointsTotal.value))
const fakeText = computed(() => fmtBal(fakeExposure.value))

type MenuItem = { name: string; title: string; icon: unknown; roles: string[] }

const allMenus: MenuItem[] = [
  { name: 'dashboard', title: '工作台', icon: markRaw(DataAnalysis), roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
  { name: 'rooms', title: '房间中心', icon: markRaw(OfficeBuilding), roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
  { name: 'players', title: '玩家上下分', icon: markRaw(User), roles: ['AGENT', 'PROXY'] },
  { name: 'reports', title: '报表中心', icon: markRaw(TrendCharts), roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
  { name: 'recharge', title: '上下分审核', icon: markRaw(Wallet), roles: ['AGENT', 'PROXY'] },
  { name: 'games', title: '游戏管理', icon: markRaw(Trophy), roles: ['ADMIN'] },
  { name: 'control', title: '控奖中心', icon: markRaw(Aim), roles: ['ADMIN'] },
  { name: 'agents', title: '账号中心', icon: markRaw(Avatar), roles: ['ADMIN'] },
  { name: 'rebate', title: '回水规则', icon: markRaw(Coin), roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
  { name: 'risk', title: '风控告警', icon: markRaw(Warning), roles: ['ADMIN', 'BRANCH'] },
  { name: 'logs', title: '操作日志', icon: markRaw(Document), roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
]

const menus = computed(() => {
  const role = store.profile?.role || ''
  return allMenus.filter((m) => m.roles.includes(role))
})

async function refreshBalance() {
  try {
    const w = await consoleApi.walletMe()
    balance.value = w.balance
    pointsQuota.value = w.pointsQuota ?? null
    flyCover.value = w.flyCover ?? null
    playerPointsTotal.value = w.playerPointsTotal ?? null
    fakeExposure.value = w.fakeExposure ?? null
  } catch {
    balance.value = null
    pointsQuota.value = null
    flyCover.value = null
    playerPointsTotal.value = null
    fakeExposure.value = null
  }
}

async function doLogout() {
  await ElMessageBox.confirm('确认退出运营控制台？', '提示', { type: 'warning' })
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

function resetPwdForm() {
  pwdForm.oldPassword = ''
  pwdForm.newPassword = ''
  pwdForm.confirm = ''
}

async function submitPassword() {
  if (!pwdForm.oldPassword) return ElMessage.warning('请填写当前密码')
  if (pwdForm.newPassword.length < 6) return ElMessage.warning('新密码至少 6 位')
  if (pwdForm.newPassword !== pwdForm.confirm) return ElMessage.warning('两次新密码不一致')
  pwdSaving.value = true
  try {
    await http.patch('/users/me/password', {
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword,
    })
    ElMessage.success('密码已修改，请牢记新密码')
    pwdVisible.value = false
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '修改失败',
    )
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

async function focusSearch() {
  await nextTick()
  searchInputRef.value?.focus?.()
}

async function runSearch() {
  const q = searchQ.value.trim()
  if (!q) return ElMessage.warning('请输入关键词')
  searchLoading.value = true
  searchDone.value = false
  try {
    const [players, agents, branches] = await Promise.all([
      consoleApi.players({ page: 1, pageSize: 8, q }),
      consoleApi.agents({ page: 1, pageSize: 8, role: 'AGENT', q, boundOnly: false }),
      consoleApi.agents({ page: 1, pageSize: 8, role: 'BRANCH', q, boundOnly: false }),
    ])
    searchPlayers.value = (players.list || []).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      username: p.username,
      uid: p.uid,
    }))
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

function goPlayer(p: { uid: string; nickname: string }) {
  searchVisible.value = false
  router.push({ name: 'rooms' })
  ElMessage.info(`玩家 ${p.nickname}（${p.uid}）：请进入所属房间「玩家」页查看；也可在风控里按 UID 搜`)
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
  ElMessage.warning(`「${a.nickname}」未绑定房间，请先在房间中心创建`)
  router.push({ name: 'rooms' })
}

onMounted(() => {
  void refreshBalance()
  void refreshRiskBadge()
  riskTimer = setInterval(() => void refreshRiskBadge(), 60_000)
})
onUnmounted(() => {
  if (riskTimer) clearInterval(riskTimer)
})
</script>

<style scoped>
.admin-root { height: 100vh; }
.menu-badge {
  margin-left: 8px;
  vertical-align: middle;
}
:deep(.menu-badge .el-badge__content) {
  transform: translateY(-1px);
}
.aside {
  background: #181c27;
  transition: width 0.25s;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.logo-icon { font-size: 24px; color: #d4a93c; }
.logo-text { font-size: 15px; font-weight: 700; color: #fff; white-space: nowrap; }
.el-menu { border-right: none; flex: 1; }
.header {
  height: 60px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}
.header-left { display: flex; align-items: center; gap: 8px; }
.header-right { display: flex; align-items: center; gap: 12px; }
.nick { font-size: 13px; color: #606266; }
.bal { font-size: 13px; color: #d4a93c; font-weight: 600; }
.bal.dim { color: #909399; font-weight: 500; }
.main {
  background: var(--ops-bg, #f3f4f7);
  padding: 20px 22px 28px;
  overflow-y: auto;
}
.search-body { margin-top: 16px; display: grid; gap: 14px; }
.search-h { font-size: 12px; color: #909399; margin-bottom: 6px; }
.search-empty { font-size: 13px; color: #c0c4cc; padding: 6px 0; }
.search-item {
  width: 100%;
  text-align: left;
  border: 1px solid #ebeef5;
  background: #fff;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.search-item:hover { border-color: #d4a93c; }
.search-item span { font-size: 12px; color: #909399; }
</style>
