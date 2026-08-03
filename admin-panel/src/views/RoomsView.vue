<template>
  <div class="ops-page rooms-page">
    <PageHeader title="房间中心" :subtitle="`${filteredList.length} 间房间 · 进房码 / 额度 / 月费`">
      <template #actions>
        <el-button :loading="loading" @click="load">刷新</el-button>
        <el-button v-if="canCreate" type="primary" @click="openCreate">创建房间</el-button>
      </template>
    </PageHeader>

    <div class="ops-filter">
      <el-input
        v-model="keyword"
        clearable
        placeholder="搜进房码 / 房间名 / 代理"
        class="filter-search"
      />
      <el-select v-model="statusFilter" clearable placeholder="全部状态" class="filter-status">
        <el-option label="营业中" value="OPEN" />
        <el-option label="维护中" value="MAINTENANCE" />
        <el-option label="已冻结" value="FROZEN" />
        <el-option v-if="includeClosed" label="已关闭" value="CLOSED" />
      </el-select>
      <el-checkbox v-if="isAdminOrBranch" v-model="includeClosed" @change="load">显示已关闭</el-checkbox>
    </div>

    <div class="ops-table-wrap">
    <el-table
      :data="filteredList"
      v-loading="loading"
      class="rooms-table"
      empty-text="暂无房间"
      @row-click="(row: ConsoleRoom) => goDetail(row.id)"
    >
      <el-table-column label="房间" min-width="200">
        <template #default="{ row }">
          <div class="room-cell">
            <div class="room-name">{{ row.name }}</div>
            <div class="room-code">
              <span class="mono">{{ row.roomNo }}</span>
              <button type="button" class="copy-chip" @click.stop="copyText(row.roomNo)">复制</button>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="状态" min-width="120">
        <template #default="{ row }">
          <div class="status-cell">
            <el-tag size="small" :type="roomStatusTagType(row.status)" effect="light">
              {{ roomStatusLabel(row.status) }}
            </el-tag>
            <div v-if="roomAlerts(row).length" class="alert-row">
              <el-tag
                v-for="a in roomAlerts(row).slice(0, 2)"
                :key="a.text"
                size="small"
                :type="a.type"
                effect="plain"
              >{{ a.text }}</el-tag>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="代理" min-width="140">
        <template #default="{ row }">
          <template v-if="row.agent">
            <div class="agent-name">{{ row.agent.nickname }}</div>
            <div class="sub">{{ row.agent.username }}</div>
          </template>
          <span v-else class="muted">未绑定</span>
        </template>
      </el-table-column>
      <el-table-column label="额度" min-width="110" align="right">
        <template #default="{ row }">
          <span v-if="row.agent" class="num" :class="quotaClass(row.agent.pointsQuota)">
            {{ fmtMoney(row.agent.pointsQuota) }}
          </span>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="占用" min-width="100" align="right">
        <template #default="{ row }">
          <span v-if="row.agent" class="num" :class="flyClass(row.agent)">
            {{ fmtMoney(row.agent.flyCover) }}
          </span>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="余额" min-width="110" align="right">
        <template #default="{ row }">
          <span v-if="row.agent" class="num gold">{{ fmtMoney(row.agent.balance) }}</span>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="memberCount" label="成员" min-width="72" align="center" />
      <el-table-column label="月费" min-width="128">
        <template #default="{ row }">
          <template v-if="row.monthlyFee > 0">
            <div :class="billDueSoon(row) ? 'warn-text' : 'fee'">{{ Math.floor(row.monthlyFee) }}/月</div>
            <div class="sub">{{ formatDate(row.nextBillAt) }}</div>
          </template>
          <span v-else class="muted">不收费</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" min-width="168" align="right">
        <template #default="{ row }">
          <div class="ops" @click.stop>
            <el-button link type="primary" @click="goDetail(row.id)">详情</el-button>
            <el-dropdown v-if="canStatus" trigger="click" @command="(s: string) => onStatus(row.id, s)">
              <el-button link>状态</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="OPEN">营业中</el-dropdown-item>
                  <el-dropdown-item command="MAINTENANCE">维护中</el-dropdown-item>
                  <el-dropdown-item command="FROZEN">已冻结</el-dropdown-item>
                  <el-dropdown-item v-if="isAdmin" command="CLOSED">已关闭</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button
              v-if="canDelete && row.status !== 'CLOSED'"
              link
              type="danger"
              @click="onDelete(row)"
            >删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <el-dialog
      v-model="showCreate"
      title="创建房间"
      width="720px"
      align-center
      destroy-on-close
      class="create-room-dialog"
    >
      <el-form label-width="96px" class="create-form" size="default">
        <div class="section-title">基本信息</div>
        <div class="form-row2">
          <el-form-item label="进房码" required>
            <div class="row-inline">
              <el-input
                v-model="form.roomNo"
                placeholder="6 位数字进房码"
                maxlength="6"
                inputmode="numeric"
                @input="onRoomNoInput"
              />
              <el-button @click="regenRoomNo">随机</el-button>
            </div>
            <div class="hint" style="margin-left:0;margin-top:4px">创建时可改，创建后固定不可换</div>
          </el-form-item>
          <el-form-item label="房间名称" required>
            <el-input
              v-model="form.name"
              placeholder="例如：一号厅"
              maxlength="40"
              @blur="suggestAgentUsername"
            />
          </el-form-item>
        </div>
        <el-form-item label="初始状态">
          <el-radio-group v-model="form.status">
            <el-radio-button label="OPEN">营业中</el-radio-button>
            <el-radio-button label="MAINTENANCE">维护中</el-radio-button>
            <el-radio-button label="FROZEN">已冻结</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <div class="section-title">
          绑定代理
          <span class="section-hint">创建专属账号，仅管本房</span>
        </div>
        <div class="form-row2">
          <el-form-item label="用户名" required>
            <div class="row-inline">
              <el-input v-model="form.agentUsername" placeholder="8-20 位小写字母数字" maxlength="20" />
              <el-button @click="regenUsername">随机</el-button>
            </div>
          </el-form-item>
          <el-form-item label="密码" required>
            <div class="row-inline">
              <el-input v-model="form.agentPassword" placeholder="至少 6 位" maxlength="32" show-password />
              <el-button @click="regenPassword">随机</el-button>
            </div>
          </el-form-item>
        </div>
        <el-form-item label="昵称">
          <el-input v-model="form.agentNickname" placeholder="默认：房间名+代理" maxlength="24" style="max-width:280px" />
        </el-form-item>

        <template v-if="isAdmin">
          <div class="section-title">
            可见房主
            <span class="section-hint">勾选才能看见本房；去掉后该房主看不见</span>
          </div>
          <el-form-item label="授权房主">
            <el-checkbox-group v-if="branchList.length" v-model="form.ownerUserIds" class="check-grid">
              <el-checkbox v-for="a in branchList" :key="a.id" :value="a.id">
                {{ a.nickname }}
              </el-checkbox>
            </el-checkbox-group>
            <span v-else class="muted">暂无房主账号</span>
          </el-form-item>
        </template>
        <div v-else class="branch-tip">房主创建的房间：默认全部房主可见（超管始终可见全部）</div>

        <div class="section-title">
          游戏与机器人
          <span class="section-hint">默认全开；各游戏机器人名/头像互不重复</span>
        </div>
        <el-form-item label="开通游戏" required>
          <el-checkbox-group v-model="form.enabledGames" class="check-grid">
            <el-checkbox v-for="g in GAME_OPTIONS" :key="g.value" :value="g.value">
              {{ g.label }}
            </el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="机器人">
          <el-input-number v-model="form.robotCount" :min="0" :max="50" />
          <span class="hint">每个游戏初始人数</span>
        </el-form-item>

        <div class="section-title">
          月费账单
          <span class="section-hint">到期扣代理账户；余额不足自动冻结</span>
        </div>
        <div class="form-row2">
          <el-form-item label="月费金额">
            <el-input-number v-model="form.monthlyFee" :min="0" :max="10000000" :precision="0" :step="1" />
            <span class="hint">0 不收费</span>
          </el-form-item>
          <el-form-item label="起始日期">
            <el-date-picker
              v-model="form.billStartDate"
              type="date"
              placeholder="选择日期"
              value-format="YYYY-MM-DD"
              style="width: 160px"
              @change="onBillStartChange"
            />
            <span class="hint">上海时间当日 0 点起算</span>
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onCreate">创建房间</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showCreds" title="代理账号已创建" width="440px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon class="cred-alert">
        密码仅展示一次，请立即复制交给代理
      </el-alert>
      <div class="cred-box" v-if="createdCreds">
        <div class="cred-row"><span>房间</span><b>{{ createdCreds.roomName }}</b></div>
        <div class="cred-row"><span>进房码</span><b>{{ createdCreds.roomNo }}</b></div>
        <div class="cred-row"><span>用户名</span><b>{{ createdCreds.username }}</b></div>
        <div class="cred-row"><span>密码</span><b>{{ createdCreds.password }}</b></div>
      </div>
      <template #footer>
        <el-button type="primary" @click="copyCreds">复制账号密码</el-button>
        <el-button @click="showCreds = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import { consoleApi, type ConsoleRoom } from '@/api/console'
import { useAdminStore } from '@/stores/admin'
import {
  GAME_OPTIONS, roomStatusLabel, roomStatusTagType,
} from '@/utils/labels'

type StaffOpt = { id: string; uid: string; nickname: string; role: string }

const store = useAdminStore()
const router = useRouter()
const list = ref<ConsoleRoom[]>([])
const staffList = ref<StaffOpt[]>([])
const loading = ref(false)
const showCreate = ref(false)
const showCreds = ref(false)
const saving = ref(false)
const keyword = ref('')
const statusFilter = ref('')
const includeClosed = ref(false)
const createdCreds = ref<{
  roomName: string; roomNo: string; username: string; password: string
} | null>(null)

const allGameCodes = GAME_OPTIONS.map((g) => g.value)

const form = reactive({
  roomNo: '',
  name: '',
  agentUsername: '',
  agentPassword: '',
  agentNickname: '',
  ownerUserIds: [] as string[],
  enabledGames: [...allGameCodes] as string[],
  robotCount: 10,
  status: 'OPEN',
  monthlyFee: 0,
  billingDay: 1,
  billStartDate: '' as string,
})

const isAdmin = computed(() => store.profile?.role === 'ADMIN')
const isAdminOrBranch = computed(() => {
  const r = store.profile?.role
  return r === 'ADMIN' || r === 'BRANCH'
})
const canCreate = computed(() => isAdminOrBranch.value)
const canDelete = computed(() => isAdmin.value)
/** 改状态：超管/房主/代理；子账号不可改 */
const canStatus = computed(() => {
  const r = store.profile?.role
  return r === 'ADMIN' || r === 'BRANCH' || r === 'AGENT'
})

const branchList = computed(() => staffList.value.filter((a) => a.role === 'BRANCH'))

const filteredList = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  const st = statusFilter.value
  return list.value.filter((r) => {
    if (st && r.status !== st) return false
    if (!q) return true
    const hay = [
      r.roomNo, r.name,
      r.agent?.nickname, r.agent?.username, r.agent?.uid,
    ].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
})

function fmtMoney(n?: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function formatDate(v?: string | null) {
  if (!v) return '—'
  const s = String(v)
  if (s.length >= 16) return `${s.slice(0, 10)} ${s.slice(11, 16)}`
  return s.slice(0, 10)
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择')
  }
}

type AlertTag = { text: string; type: 'danger' | 'warning' | 'info' }

function billDueSoon(row: ConsoleRoom) {
  const fee = Number(row.monthlyFee || 0)
  if (fee <= 0 || !row.nextBillAt) return false
  const next = new Date(row.nextBillAt).getTime()
  if (Number.isNaN(next)) return false
  return (next - Date.now()) / 86400000 <= 3
}

function roomAlerts(row: ConsoleRoom): AlertTag[] {
  const tags: AlertTag[] = []
  const a = row.agent
  if (a) {
    const quota = Number(a.pointsQuota || 0)
    const cover = Number(a.flyCover || 0)
    const bal = Number(a.balance || 0)
    if (quota <= 0) tags.push({ text: '额度空', type: 'danger' })
    else if (quota < 100) tags.push({ text: '额度低', type: 'warning' })
    if (cover > 0 && quota <= 0) tags.push({ text: '占用未回', type: 'warning' })
    else if (cover >= Math.max(quota * 3, 1000) && cover > 0) {
      tags.push({ text: '占用偏高', type: 'info' })
    }
    if (bal < Number(row.monthlyFee || 0) && Number(row.monthlyFee || 0) > 0) {
      tags.push({ text: '余额不够月费', type: 'danger' })
    }
  }
  if (billDueSoon(row)) tags.push({ text: '将扣月费', type: 'warning' })
  return tags.slice(0, 3)
}

function quotaClass(n?: number) {
  const v = Number(n || 0)
  if (v <= 0) return 'num-danger'
  if (v < 100) return 'num-warn'
  return ''
}

function flyClass(a: NonNullable<ConsoleRoom['agent']>) {
  const cover = Number(a.flyCover || 0)
  const quota = Number(a.pointsQuota || 0)
  if (cover > 0 && quota <= 0) return 'num-warn'
  if (cover >= Math.max(quota * 3, 1000) && cover > 0) return 'num-info'
  return ''
}

function randHex(n: number) {
  const arr = new Uint8Array(n)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

function regenRoomNo() {
  const n = 100000 + Math.floor(Math.random() * 900000)
  form.roomNo = String(n)
}

function onRoomNoInput(v: string) {
  form.roomNo = String(v ?? '').replace(/\D/g, '').slice(0, 6)
}

function regenUsername() {
  const base = form.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'agent'
  form.agentUsername = `${base}${randHex(3)}`.slice(0, 20)
}

function regenPassword() {
  form.agentPassword = `Ag${randHex(4)}9`
}

function suggestAgentUsername() {
  if (!form.agentUsername.trim()) regenUsername()
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** 默认起始：下月今日（≤28） */
function defaultBillStart() {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  const day = Math.min(28, d.getDate())
  form.billingDay = day
  form.billStartDate = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(day)}`
}

function onBillStartChange(v: string | null) {
  if (!v) return
  const day = Number(v.slice(8, 10))
  form.billingDay = day >= 1 && day <= 28 ? day : 28
}

async function load() {
  loading.value = true
  try {
    list.value = await consoleApi.rooms({ includeClosed: includeClosed.value })
  } catch {
    ElMessage.error('加载房间失败')
  } finally {
    loading.value = false
  }
}

async function loadStaff() {
  if (!isAdmin.value) return
  try {
    const res = await consoleApi.agents({ page: 1, pageSize: 200, role: 'BRANCH', boundOnly: false })
    staffList.value = res.list.map((a) => ({
      id: a.id, uid: a.uid, nickname: a.nickname, role: a.role,
    }))
  } catch {
    staffList.value = []
  }
}

function goDetail(id: string) { router.push({ name: 'room-detail', params: { id } }) }

async function openCreate() {
  form.name = ''
  form.agentNickname = ''
  form.enabledGames = [...allGameCodes]
  form.robotCount = 10
  form.status = 'OPEN'
  form.monthlyFee = 0
  defaultBillStart()
  regenRoomNo()
  regenUsername()
  regenPassword()
  showCreate.value = true
  if (isAdmin.value) {
    await loadStaff()
    form.ownerUserIds = branchList.value.map((b) => b.id)
  } else {
    form.ownerUserIds = []
  }
}

async function onCreate() {
  if (!/^\d{6}$/.test(form.roomNo.trim())) {
    return ElMessage.warning('房间号须为 6 位数字')
  }
  if (!form.name.trim()) return ElMessage.warning('请输入房间名称')
  if (!/^[a-z0-9]{8,20}$/.test(form.agentUsername.trim())) {
    return ElMessage.warning('代理用户名须 8-20 位小写字母数字')
  }
  if (form.agentPassword.trim().length < 6) return ElMessage.warning('代理密码至少 6 位')
  if (!form.enabledGames.length) return ElMessage.warning('请至少开通一个游戏')
  if (form.monthlyFee > 0 && !form.billStartDate) {
    return ElMessage.warning('请选择月费起始日期')
  }
  saving.value = true
  try {
    // 起始日上海时间 00:00 作为首次扣费点
    const nextBillAt = form.billStartDate
      ? `${form.billStartDate}T00:00:00+08:00`
      : undefined
    const res = await consoleApi.createRoom({
      name: form.name.trim(),
      roomNo: form.roomNo.trim(),
      agentUsername: form.agentUsername.trim(),
      agentPassword: form.agentPassword.trim(),
      agentNickname: form.agentNickname.trim() || undefined,
      ownerUserIds: isAdmin.value ? form.ownerUserIds : undefined,
      enabledGames: form.enabledGames,
      robotCount: form.robotCount,
      status: form.status,
      monthlyFee: form.monthlyFee,
      billingDay: form.billingDay,
      nextBillAt: form.monthlyFee > 0 ? nextBillAt : undefined,
    }) as {
      roomNo: string
      name: string
      agent?: { username: string; password: string }
    }
    ElMessage.success('房间已创建')
    showCreate.value = false
    if (res?.agent?.username && res?.agent?.password) {
      createdCreds.value = {
        roomName: res.name,
        roomNo: res.roomNo,
        username: res.agent.username,
        password: res.agent.password,
      }
      showCreds.value = true
    }
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '创建失败',
    )
  } finally { saving.value = false }
}

async function copyCreds() {
  if (!createdCreds.value) return
  const t = `房间：${createdCreds.value.roomName}\n进房码：${createdCreds.value.roomNo}\n用户名：${createdCreds.value.username}\n密码：${createdCreds.value.password}`
  try {
    await navigator.clipboard.writeText(t)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择')
  }
}

async function onStatus(id: string, status: string) {
  const label: Record<string, string> = {
    OPEN: '营业中',
    MAINTENANCE: '维护中',
    FROZEN: '已冻结',
    CLOSED: '已关闭',
  }
  const tip =
    status === 'FROZEN' || status === 'CLOSED'
      ? `确认将房间设为「${label[status] || status}」？玩家将无法正常进入/游戏。`
      : `确认将房间状态改为「${label[status] || status}」？`
  try {
    await ElMessageBox.confirm(tip, '变更房间状态', {
      type: status === 'FROZEN' || status === 'CLOSED' ? 'warning' : 'info',
      confirmButtonText: '确认变更',
    })
  } catch {
    return
  }
  try {
    await consoleApi.setRoomStatus(id, status)
    ElMessage.success('状态已更新')
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '状态更新失败',
    )
  }
}

async function onDelete(row: ConsoleRoom) {
  try {
    await ElMessageBox.confirm(
      `确定删除房间「${row.name}」？\n无成员、无对局将彻底删除；已有数据则关闭并从列表隐藏。`,
      '删除房间',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    const res = await consoleApi.deleteRoom(row.id)
    ElMessage.success(res.message || '已处理')
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '删除失败',
    )
  }
}

onMounted(async () => {
  await load()
  await loadStaff()
})
</script>

<style scoped>
.rooms-page { width: 100%; max-width: none; }
.filter-search { width: 240px; }
.filter-status { width: 120px; }
.rooms-table { width: 100%; }
.rooms-table :deep(.el-table__cell) { padding: 14px 16px; }
.rooms-table :deep(.el-table__row) { cursor: pointer; }
.room-cell { min-height: 40px; display: flex; flex-direction: column; justify-content: center; }
.room-name {
  font-size: 14px;
  font-weight: 600;
  color: #1f2329;
  line-height: 1.35;
}
.room-code {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.status-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.alert-row { display: flex; flex-wrap: wrap; gap: 4px; }
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: #8f959e;
  letter-spacing: 0.04em;
}
.copy-chip {
  border: none;
  background: #f2f3f5;
  color: #8f959e;
  font-size: 11px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 4px;
  cursor: pointer;
}
.copy-chip:hover { background: #ebecef; color: #606266; }
.agent-name { font-size: 13px; color: #303133; line-height: 1.35; }
.num {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: #303133;
  padding-right: 4px;
}
.fee { font-size: 13px; color: #303133; }
.ops {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  white-space: nowrap;
  padding-right: 4px;
}
.ops :deep(.el-button) { margin: 0; padding: 0 2px; }
.muted { color: #c0c4cc; }
.sub { font-size: 12px; color: #909399; line-height: 1.35; margin-top: 2px; }
.gold { color: #d4a93c; font-weight: 600; }
.num-danger { color: #f56c6c; font-weight: 600; }
.num-warn { color: #e6a23c; font-weight: 600; }
.num-info { color: #409eff; font-weight: 600; }
.warn-text { color: #e6a23c; font-weight: 600; font-size: 13px; }
.hint { margin-left: 8px; color: #909399; font-size: 12px; white-space: nowrap; }
.section-title {
  margin: 4px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #ebeef5;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.section-hint {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: #909399;
}
.row-inline { display: flex; gap: 8px; width: 100%; }
.row-inline .el-input { flex: 1; }
.form-row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}
.check-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 2px 8px;
  width: 100%;
}
.check-grid :deep(.el-checkbox) {
  margin-right: 0;
  height: 28px;
}
.branch-tip {
  margin: 0 0 8px 96px;
  padding: 6px 10px;
  background: #f4f4f5;
  border-radius: 6px;
  font-size: 12px;
  color: #606266;
}
.cred-alert { margin-bottom: 14px; }
.cred-box {
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px 16px;
}
.cred-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed #ebeef5;
  font-size: 14px;
}
.cred-row:last-child { border-bottom: none; }
.cred-row span { color: #909399; }
.cred-row b { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.create-form :deep(.el-form-item) { margin-bottom: 10px; }
</style>

<style>
/* dialog 挂到 body，需非 scoped；压高度避免内部滚动条 */
.create-room-dialog.el-dialog {
  margin-top: 0 !important;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
}
.create-room-dialog .el-dialog__header {
  padding: 14px 20px 8px;
}
.create-room-dialog .el-dialog__body {
  padding: 8px 20px 4px;
  overflow: visible;
}
.create-room-dialog .el-dialog__footer {
  padding: 8px 20px 14px;
}
</style>
