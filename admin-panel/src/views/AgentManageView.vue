<template>
  <div class="desk-work agents-page" v-loading="loading">
    <div class="desk-panel">
      <PageHeader :title="title">
        <template #actions>
          <el-button v-if="isAdminOrBranch" :loading="loading" @click="load">刷新</el-button>
          <el-button
            v-if="isAdmin && roleFilter === 'BRANCH'"
            type="primary"
            @click="openCreateBranch"
          >添加房主</el-button>
        </template>
      </PageHeader>

      <section v-if="isAgentUser || isProxyUser" class="staff-gate">
        <el-button type="primary" @click="goOwnAgentDetail">
          {{ isAgentUser ? '进入本房代理页' : '进入所属房间代理页' }}
        </el-button>
      </section>

      <template v-else>
        <div v-if="isAdmin" class="rooms-summary">
          <div class="sum-chip">
            <span class="sum-label">房主</span>
            <span class="sum-val">{{ branchCount }}</span>
          </div>
          <div class="sum-chip">
            <span class="sum-label">绑定代理</span>
            <span class="sum-val">{{ agentCount }}</span>
          </div>
          <div class="sum-chip">
            <span class="sum-label">本页</span>
            <span class="sum-val">{{ list.length }}</span>
          </div>
        </div>

        <div class="panel-toolbar">
          <el-radio-group v-model="roleFilter" size="small" @change="onTabChange">
            <el-radio-button v-if="isAdmin" label="BRANCH">房主</el-radio-button>
            <el-radio-button label="AGENT">绑定代理</el-radio-button>
          </el-radio-group>
          <el-input
            v-model="keyword"
            clearable
            size="small"
            :placeholder="roleFilter === 'BRANCH' ? '搜昵称 / 账号' : '搜昵称 / 账号 / 房间'"
            class="filter-search"
            @clear="reload"
            @keyup.enter="reload"
          />
          <el-button size="small" @click="reload">搜索</el-button>
        </div>
        <p v-if="roleFilter === 'AGENT'" class="agents-hint">
          给代理买额度 / 调信用：点「买额度」进入该房「绑定代理」页操作（现金=上分买盘分，信用=调整信用额度）。
        </p>

        <div class="panel-body">
          <el-table
            :data="list"
            v-loading="loading"
            class="agents-table"
            :empty-text="emptyText"
            stripe
            border
            size="small"
            height="100%"
            table-layout="fixed"
            @row-click="goDetail"
          >
            <el-table-column v-if="roleFilter === 'AGENT'" label="房间" min-width="160">
              <template #default="{ row }: { row: any }">
                <template v-if="row.rooms?.length">
                  <div class="cell-name">{{ roomNames(row) }}</div>
                  <div class="cell-meta">{{ roomNos(row) }} · 玩家 {{ row.memberCount ?? 0 }}</div>
                </template>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="账号" min-width="160">
              <template #default="{ row }: { row: any }">
                <div class="cell-name">{{ row.nickname }}</div>
                <div class="cell-meta mono">{{ row.username }} · {{ row.uid }}</div>
              </template>
            </el-table-column>
            <el-table-column v-if="roleFilter === 'AGENT'" label="子账号" min-width="88" align="center">
              <template #default="{ row }: { row: any }">{{ row.staffCount ?? 0 }}</template>
            </el-table-column>
            <el-table-column v-if="roleFilter === 'AGENT'" label="余额" min-width="108" align="right">
              <template #default="{ row }: { row: any }">
                <span class="gold">{{ fmt(row.balance) }}</span>
              </template>
            </el-table-column>
            <el-table-column v-if="roleFilter === 'AGENT'" label="上盘/剩余信用" min-width="120" align="right">
              <template #default="{ row }: { row: any }">{{ fmt(row.pointsQuota) }}</template>
            </el-table-column>
            <el-table-column v-if="roleFilter === 'BRANCH'" label="可见房间" min-width="100" align="center">
              <template #default="{ row }: { row: any }">{{ row.roomCount ?? row.rooms?.length ?? 0 }}</template>
            </el-table-column>
            <el-table-column label="状态" min-width="88" align="center">
              <template #default="{ row }: { row: any }">
                <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" size="small" effect="plain">
                  {{ row.status === 'ACTIVE' ? '正常' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="最近登录" min-width="128">
              <template #default="{ row }: { row: any }">
                <span :class="{ muted: !row.lastLoginAt }">{{ fmtTime(row.lastLoginAt) }}</span>
              </template>
            </el-table-column>
            <el-table-column
              label="操作"
              :min-width="roleFilter === 'BRANCH' && isAdmin ? 196 : roleFilter === 'AGENT' ? 140 : 88"
              align="right"
            >
              <template #default="{ row }: { row: any }">
                <div class="ops" @click.stop>
                  <el-button link type="primary" @click="goDetail(row)">
                    {{ roleFilter === 'AGENT' ? '买额度' : '详情' }}
                  </el-button>
                  <el-button
                    v-if="roleFilter === 'AGENT' && row.rooms?.[0]?.id"
                    link
                    @click="goRoomOverview(row)"
                  >进房间</el-button>
                  <template v-if="roleFilter === 'BRANCH' && isAdmin">
                    <el-button link type="warning" @click="onResetPwd(row)">重置密码</el-button>
                    <el-button
                      link
                      :type="row.status === 'ACTIVE' ? 'danger' : 'success'"
                      @click="onToggleStatus(row)"
                    >{{ row.status === 'ACTIVE' ? '停用' : '启用' }}</el-button>
                  </template>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="panel-foot">
          <el-pagination
            :total="total"
            :page-size="20"
            :current-page="page"
            layout="total, prev, pager, next"
            background
            small
            @current-change="(p: number) => { page = p; load() }"
          />
        </div>
      </template>
    </div>

    <DeskDialog v-model="createVisible" title="添加房主" width="440px">
      <el-form label-width="88px" class="desk-form">
        <el-form-item label="登录账号" required>
          <div class="row-inline">
            <el-input v-model="createForm.username" placeholder="8-20位小写字母数字" maxlength="20" />
            <el-button @click="regenUsername">随机</el-button>
          </div>
        </el-form-item>
        <el-form-item label="密码" required>
          <div class="row-inline">
            <el-input v-model="createForm.password" type="password" show-password maxlength="32" />
            <el-button @click="regenPassword">随机</el-button>
          </div>
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="createForm.nickname" placeholder="可选" maxlength="24" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="busy" @click="doCreateBranch">确认添加</el-button>
      </template>
    </DeskDialog>

    <DeskDialog
      v-model="showCreds"
      title="房主账号已创建"
      width="420px"
      :close-on-click-modal="false"
    >
      <el-alert type="warning" :closable="false" show-icon class="cred-alert">
        密码仅展示一次，请立即复制交给房主
      </el-alert>
      <div v-if="createdCreds" class="cred-box">
        <div class="cred-row"><span>显示名</span><b>{{ createdCreds.nickname }}</b></div>
        <div class="cred-row"><span>用户名</span><b>{{ createdCreds.username }}</b></div>
        <div class="cred-row"><span>密码</span><b>{{ createdCreds.password }}</b></div>
      </div>
      <template #footer>
        <el-button @click="showCreds = false">我已保存</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" @click="copyCreds">复制账号密码</el-button>
      </template>
    </DeskDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { validateOpsPassword } from '@gamebox/shared'
import PageHeader from '@/components/PageHeader.vue'
import DeskDialog from '@/components/DeskDialog.vue'
import { consoleApi, type AgentPage } from '@/api/console'
import { useAdminStore } from '@/stores/admin'

type Row = AgentPage['list'][number]
type TabRole = 'AGENT' | 'BRANCH'

const store = useAdminStore()
const router = useRouter()
const role = computed(() => store.profile?.role || '')
const isAdmin = computed(() => role.value === 'ADMIN')
const isAdminOrBranch = computed(() => role.value === 'ADMIN' || role.value === 'BRANCH')
const isAgentUser = computed(() => role.value === 'AGENT')
const isProxyUser = computed(() => role.value === 'PROXY')

const title = computed(() => {
  if (isAgentUser.value || isProxyUser.value) return '下级账号'
  return '账号中心'
})
const emptyText = computed(() =>
  roleFilter.value === 'BRANCH' ? '暂无房主' : '暂无绑定代理',
)

const list = ref<Row[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const busy = ref(false)
const roleFilter = ref<TabRole>('BRANCH')
const keyword = ref('')
const branchCount = ref(0)
const agentCount = ref(0)

const createVisible = ref(false)
const createForm = reactive({
  username: '',
  password: '',
  nickname: '',
})
const showCreds = ref(false)
const createdCreds = ref<{ nickname: string; username: string; password: string } | null>(null)

function fmt(n?: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function fmtTime(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}
function roomNames(row: Row) {
  return (row.rooms || []).map((r) => r.name).join('、')
}
function roomNos(row: Row) {
  return (row.rooms || []).map((r) => r.roomNo).join(' / ')
}
function randHex(n: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}
function regenUsername() {
  createForm.username = `branch${randHex(6)}`
}
function regenPassword() {
  createForm.password = `Br${randHex(8)}9`
}
function goRoomAgent(roomId: string) {
  router.push({ name: 'room-detail', params: { id: roomId }, query: { tab: 'agent' } })
}
function goRoomOverview(row: Row) {
  const roomId = row.rooms?.[0]?.id
  if (!roomId) {
    ElMessage.warning('该代理未绑定房间')
    return
  }
  router.push({ name: 'room-detail', params: { id: roomId } })
}
function goDetail(row: Row) {
  if (row.role === 'AGENT' || roleFilter.value === 'AGENT') {
    const roomId = row.rooms?.[0]?.id
    if (roomId) {
      goRoomAgent(roomId)
      return
    }
    ElMessage.warning('该代理未绑定房间')
    router.push({ name: 'rooms' })
    return
  }
  router.push({ name: 'agent-detail', params: { id: row.id } })
}
async function goOwnAgentDetail() {
  loading.value = true
  try {
    const uid = store.profile?.id
    if (!uid) return
    const d = await consoleApi.agentDetail(uid)
    const roomId = d.rooms?.[0]?.id
    if (roomId) {
      goRoomAgent(roomId)
      return
    }
    ElMessage.warning('未绑定房间')
    router.push({ name: 'rooms' })
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}
function onTabChange() {
  reload()
}
function reload() {
  page.value = 1
  load()
}

async function loadCounts() {
  if (!isAdmin.value) return
  try {
    const [b, a] = await Promise.all([
      consoleApi.agents({ page: 1, pageSize: 1, role: 'BRANCH', boundOnly: false }),
      consoleApi.agents({ page: 1, pageSize: 1, role: 'AGENT', boundOnly: true }),
    ])
    branchCount.value = b.total
    agentCount.value = a.total
  } catch {
    /* ignore */
  }
}

async function load() {
  if (!isAdminOrBranch.value) return
  if (!isAdmin.value) roleFilter.value = 'AGENT'
  loading.value = true
  try {
    const res = await consoleApi.agents({
      page: page.value,
      pageSize: 20,
      role: roleFilter.value,
      q: keyword.value.trim() || undefined,
      boundOnly: roleFilter.value === 'AGENT',
    })
    list.value = res.list
    total.value = res.total
    if (roleFilter.value === 'BRANCH') branchCount.value = res.total
    else agentCount.value = res.total
    if (isAdmin.value) void loadCounts()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreateBranch() {
  createForm.nickname = ''
  regenUsername()
  regenPassword()
  createVisible.value = true
}

async function doCreateBranch() {
  if (!/^[a-z0-9]{8,20}$/.test(createForm.username.trim())) {
    ElMessage.warning('账号须 8-20 位小写字母数字')
    return
  }
  const createPwdErr = validateOpsPassword(createForm.password || '')
  if (createPwdErr) {
    ElMessage.warning(createPwdErr)
    return
  }
  busy.value = true
  try {
    const username = createForm.username.trim().toLowerCase()
    const password = createForm.password
    const res = await consoleApi.createAgent({
      role: 'BRANCH',
      username,
      password,
      nickname: createForm.nickname.trim() || undefined,
    }) as { nickname?: string; username?: string; password?: string }
    createVisible.value = false
    createdCreds.value = {
      nickname: res.nickname || createForm.nickname.trim() || username,
      username: res.username || username,
      password: res.password || password,
    }
    showCreds.value = true
    roleFilter.value = 'BRANCH'
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '失败',
    )
  } finally {
    busy.value = false
  }
}

async function copyCreds() {
  if (!createdCreds.value) return
  const t = `用户名 ${createdCreds.value.username}\n密码 ${createdCreds.value.password}`
  try {
    await navigator.clipboard.writeText(t)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

async function onResetPwd(row: Row) {
  try {
    await ElMessageBox.confirm(`重置房主「${row.nickname}」密码？旧登录将失效。`, '重置密码', {
      type: 'warning',
      confirmButtonText: '重置',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    const res = await consoleApi.resetProxyPassword(row.id)
    createdCreds.value = {
      nickname: row.nickname,
      username: res.username,
      password: res.password,
    }
    showCreds.value = true
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '重置失败',
    )
  } finally {
    busy.value = false
  }
}

async function onToggleStatus(row: Row) {
  const next = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  const label = next === 'DISABLED' ? '停用' : '启用'
  try {
    await ElMessageBox.confirm(`确认${label}房主「${row.nickname}」？`, `${label}房主`, {
      type: next === 'DISABLED' ? 'warning' : 'info',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    await consoleApi.setProxyStatus(row.id, next)
    ElMessage.success(`已${label}`)
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '操作失败',
    )
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  if (!isAdmin.value) roleFilter.value = 'AGENT'
  else roleFilter.value = 'BRANCH'
  load()
})
</script>

<style scoped>
.agents-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
  flex-shrink: 0;
}
.rooms-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  flex-shrink: 0;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.sum-chip {
  display: flex;
  align-items: baseline;
  justify-content: flex-start;
  gap: 10px;
  min-height: 44px;
  padding: 10px 18px;
  border-right: 1px solid #f1f5f9;
}
.sum-chip:last-child { border-right: none; }
.sum-label {
  font-size: 13px;
  color: #64748b;
  white-space: nowrap;
  line-height: 1.2;
}
.sum-val {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.panel-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.filter-search { width: 240px; }
.agents-hint {
  margin: 0;
  padding: 8px 14px 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ops-muted, #64748b);
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.panel-body {
  flex: 1;
  min-height: 0;
  padding: 0;
  background: #fff;
}
.panel-body :deep(.el-table) {
  --el-table-header-bg-color: #f1f5f9;
  --el-table-row-hover-bg-color: #eff6ff;
  --el-table-fixed-box-shadow: none;
}
.panel-body :deep(.el-table th.el-table__cell) {
  color: #475569;
  font-weight: 600;
  background: #f1f5f9 !important;
}
.agents-table { width: 100%; }
.agents-table :deep(.el-table__header .cell) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}
.agents-table :deep(.el-table__cell) { padding: 12px 14px; }
.agents-table :deep(.el-table__row) { cursor: pointer; }
.agents-table :deep(.cell-name),
.agents-table :deep(.cell-meta) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  padding: 10px 14px;
  border-top: 1px solid #e2e8f0;
  background: #fff;
}
.staff-gate {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 18px;
}
.cell-name {
  font-size: 14px;
  font-weight: 650;
  color: #0f172a;
  line-height: 1.35;
}
.cell-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.35;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.02em;
}
.gold { color: var(--ops-gold, #f59e0b); font-weight: 600; }
.muted { color: #94a3b8; }
.ops {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}
.ops :deep(.el-button) { margin: 0; padding: 0 2px; }
.row-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.row-inline .el-input { flex: 1; min-width: 0; }
.desk-form :deep(.el-form-item:last-child) { margin-bottom: 0; }
</style>
