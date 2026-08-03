<template>
  <div class="ops-page page" v-loading="loading">
    <PageHeader :title="title" :subtitle="subtitle" />

    <!-- 代理 / 子账号：进所属房间「绑定代理」操作 -->
    <section v-if="isAgentUser || isProxyUser" class="block staff-gate">
      <p>子账号请在房间「绑定代理」中查看与开通。</p>
      <el-button type="primary" @click="goOwnAgentDetail">
        {{ isAgentUser ? '进入本房代理页' : '进入所属房间代理页' }}
      </el-button>
    </section>

    <section v-else class="block">
      <el-tabs v-model="roleFilter" @tab-change="onTabChange">
        <el-tab-pane label="绑定代理" name="AGENT" />
        <el-tab-pane v-if="isAdmin" label="房主" name="BRANCH" />
      </el-tabs>

      <div class="filters">
        <el-input
          v-model="keyword"
          clearable
          :placeholder="roleFilter === 'BRANCH' ? '昵称 / 账号' : '昵称 / 账号 / 房间'"
          style="width: 240px"
          @clear="reload"
          @keyup.enter="reload"
        />
        <el-button v-if="isAdmin && roleFilter === 'BRANCH'" type="primary" @click="openCreateBranch">
          添加房主
        </el-button>
      </div>

      <el-table :data="list" stripe :empty-text="emptyText" @row-click="goDetail">
        <el-table-column v-if="roleFilter === 'AGENT'" label="房间" min-width="150">
          <template #default="{ row }">
            <template v-if="row.rooms?.length">
              <div class="name">{{ roomNames(row) }}</div>
              <div class="meta">
                {{ roomNos(row) }}
                · 玩家 {{ row.memberCount ?? 0 }}
              </div>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="账号" min-width="160">
          <template #default="{ row }">
            <div class="name">{{ row.nickname }}</div>
            <div class="meta">{{ row.username }} · {{ row.uid }}</div>
          </template>
        </el-table-column>
        <el-table-column v-if="roleFilter === 'AGENT'" label="子账号" width="80" align="center">
          <template #default="{ row }">{{ row.staffCount ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="余额" width="110">
          <template #default="{ row }">
            <span class="gold">{{ fmt(row.balance) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="额度" width="110">
          <template #default="{ row }">{{ fmt(row.pointsQuota) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" size="small" effect="plain">
              {{ row.status === 'ACTIVE' ? '正常' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近登录" width="120">
          <template #default="{ row }">
            <span :class="{ muted: !row.lastLoginAt }">{{ fmtTime(row.lastLoginAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="goDetail(row)">
              {{ roleFilter === 'AGENT' ? '进房间' : '详情' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        class="pager"
        :total="total"
        :page-size="20"
        :current-page="page"
        layout="total, prev, pager, next"
        @current-change="(p: number) => { page = p; load() }"
      />
    </section>

    <el-dialog v-model="createVisible" title="添加房主" width="420px" destroy-on-close>
      <p class="dialog-hint">房主可查看运营全部房间；游戏赔率与控奖仍由超管配置。</p>
      <el-form label-width="88px">
        <el-form-item label="登录账号" required>
          <el-input v-model="createForm.username" placeholder="8-20位小写字母数字" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input v-model="createForm.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="createForm.nickname" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="doCreateBranch">确认添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
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
const subtitle = computed(() => {
  if (isAgentUser.value || isProxyUser.value) return '子账号在房间「绑定代理」中管理'
  return '房主在此管理；代理请在房间内操作，此处可查找并进入房间'
})
const emptyText = computed(() =>
  roleFilter.value === 'BRANCH'
    ? '暂无房主'
    : '暂无绑定代理（请先在房间中心创建房间）',
)

const list = ref<Row[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const busy = ref(false)
const roleFilter = ref<TabRole>('AGENT')
const keyword = ref('')

const createVisible = ref(false)
const createForm = reactive({
  username: '',
  password: '',
  nickname: '',
})

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
function goRoomAgent(roomId: string) {
  router.push({ name: 'room-detail', params: { id: roomId }, query: { tab: 'agent' } })
}
function goDetail(row: Row) {
  if (row.role === 'AGENT' || roleFilter.value === 'AGENT') {
    const roomId = row.rooms?.[0]?.id
    if (roomId) {
      goRoomAgent(roomId)
      return
    }
    ElMessage.warning('该代理未绑定房间，请先在房间中心创建房间')
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

async function load() {
  if (!isAdminOrBranch.value) return
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
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}

function openCreateBranch() {
  createForm.username = ''
  createForm.password = ''
  createForm.nickname = ''
  createVisible.value = true
}

async function doCreateBranch() {
  if (!/^[a-z0-9]{8,20}$/.test(createForm.username.trim())) {
    ElMessage.warning('账号须 8-20 位小写字母数字')
    return
  }
  if ((createForm.password || '').length < 6) {
    ElMessage.warning('密码至少 6 位')
    return
  }
  busy.value = true
  try {
    await consoleApi.createAgent({
      role: 'BRANCH',
      username: createForm.username.trim().toLowerCase(),
      password: createForm.password,
      nickname: createForm.nickname.trim() || undefined,
    })
    ElMessage.success('已添加房主')
    createVisible.value = false
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

onMounted(() => {
  if (isAdmin.value) roleFilter.value = 'BRANCH'
  load()
})
</script>

<style scoped>
.page { width: 100%; }
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
}
h2 { margin: 0; font-size: 18px; }
.sub { margin: 6px 0 0; font-size: 13px; color: #909399; }
.block {
  padding: 8px 18px 16px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 10px;
}
.staff-gate {
  padding: 28px 18px;
  text-align: center;
}
.staff-gate p {
  margin: 0 0 16px;
  font-size: 14px;
  color: #606266;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.dialog-hint {
  margin: 0 0 16px;
  font-size: 13px;
  color: #909399;
  line-height: 1.5;
}
.name { font-weight: 600; }
.meta { margin-top: 2px; font-size: 12px; color: #909399; }
.gold { color: #d4a93c; font-weight: 600; }
.muted { color: #c0c4cc; }
.pager { margin-top: 14px; display: flex; justify-content: flex-end; }
:deep(.el-table__row) { cursor: pointer; }
:deep(.el-tabs__header) { margin-bottom: 12px; }
</style>
