<template>
  <div class="desk-work agent-detail-page" v-loading="loading">
    <div class="desk-panel">
    <template v-if="unboundAgent">
      <PageHeader title="未绑定房间">
        <template #actions>
          <el-button @click="router.push({ name: 'agents' })">返回账号中心</el-button>
          <el-button type="primary" @click="router.push({ name: 'rooms' })">去房间中心</el-button>
        </template>
      </PageHeader>
      <div class="empty-box">暂未绑定房间</div>
    </template>

    <template v-else-if="detail && (detail.role === 'BRANCH' || detail.role === 'GENERAL')">
      <PageHeader :title="detail.nickname || (detail.role === 'GENERAL' ? '总代详情' : '总监详情')">
        <template #actions>
          <el-button @click="goBack">返回</el-button>
          <el-button v-if="isAdmin" type="warning" :loading="busy" @click="onResetPwd">重置密码</el-button>
          <el-button
            v-if="isAdmin"
            :type="detail.status === 'ACTIVE' ? 'danger' : 'success'"
            :loading="busy"
            @click="onToggleStatus"
          >{{ detail.status === 'ACTIVE' ? '停用' : '启用' }}</el-button>
        </template>
      </PageHeader>
      <div class="desk-panel__scroll">

      <div class="profile-line">
        <el-tag size="small" :type="detail.status === 'ACTIVE' ? 'success' : 'info'" effect="plain">
          {{ detail.status === 'ACTIVE' ? '正常' : '停用' }}
        </el-tag>
        <span class="meta">{{ detail.username }} · {{ detail.uid }}</span>
        <span class="meta">最近登录 {{ fmtTime(detail.lastLoginAt) }}</span>
        <span class="meta">创建于 {{ fmtTime(detail.createdAt) }}</span>
      </div>

      <div class="cards">
        <div class="card">
          <div class="k">{{ detail.role === 'GENERAL' ? '名下房间' : '授权可见房间' }}</div>
          <div class="v">{{ detail.roomTotal ?? detail.rooms.length }}</div>
        </div>
        <div class="card">
          <div class="k">给代理上分合计</div>
          <div class="v gold">{{ fmt(summary?.quotaOut) }}</div>
        </div>
        <div class="card">
          <div class="k">从代理回收合计</div>
          <div class="v">{{ fmt(summary?.quotaIn) }}</div>
        </div>
      </div>

      <section class="block">
        <div class="hd">
          <div class="hd-title">可见房间</div>
          <span class="hd-count">共 {{ detail.roomTotal ?? detail.rooms.length }} 间</span>
        </div>
        <el-table v-if="detail.rooms.length" :data="detail.rooms" stripe border size="small">
          <el-table-column label="房间" min-width="140">
            <template #default="{ row }: { row: any }">
              <div class="name">{{ row.name }}</div>
              <div class="meta">{{ row.roomNo }}</div>
            </template>
          </el-table-column>
          <el-table-column label="玩家" width="80" align="center">
            <template #default="{ row }: { row: any }">{{ row.memberCount ?? 0 }}</template>
          </el-table-column>
          <el-table-column label="游戏" width="80" align="center">
            <template #default="{ row }: { row: any }">{{ row.openGames ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }: { row: any }">{{ statusLabel(row.status) }}</template>
          </el-table-column>
          <el-table-column label="月费" width="100">
            <template #default="{ row }: { row: any }">{{ fmt(row.monthlyFee) }}</template>
          </el-table-column>
          <el-table-column label="" width="90">
            <template #default="{ row }: { row: any }">
              <el-button link type="primary" @click="router.push({ name: 'room-detail', params: { id: row.id } })">打开</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-else class="empty">暂无可见房间</div>
      </section>

      <section class="block">
        <div class="hd">
          <div class="hd-title">操作与资金记录</div>
        </div>
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="fund-tip"
          title="现金盘代理用「上下分」；信用盘代理请在对应房间「调整信用额度」（本列表含信用调整记录）。名下若有信用房，不能再用上下分加款。"
        />
        <el-tabs v-model="auditTab" @tab-change="onAuditTab">
          <el-tab-pane label="额度往来" name="fund" />
          <el-tab-pane label="全部操作" name="ops" />
        </el-tabs>
        <el-table v-loading="auditLoading" :data="auditRows" stripe border size="small" empty-text="暂无记录">
          <el-table-column label="时间" width="156">
            <template #default="{ row }: { row: any }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="动作" min-width="140">
            <template #default="{ row }: { row: any }">{{ row.actionLabel }}</template>
          </el-table-column>
          <el-table-column label="对象" min-width="140">
            <template #default="{ row }: { row: any }">
              <template v-if="row.counterparty">
                <div class="name">{{ row.counterparty.nickname }}</div>
                <div class="meta">{{ roleShort(row.counterparty.role) }} · {{ row.counterparty.username }}</div>
              </template>
              <span v-else class="muted">{{ targetHint(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="金额" width="110" align="right">
            <template #default="{ row }: { row: any }">
              <span v-if="row.amount != null" :class="amountClass(row)">{{ amountText(row) }}</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="120" show-overflow-tooltip>
            <template #default="{ row }: { row: any }">{{ row.remark || '—' }}</template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-if="auditTotal > auditPageSize"
          class="pager"
          layout="total, prev, pager, next"
          :total="auditTotal"
          :page-size="auditPageSize"
          :current-page="auditPage"
          @current-change="onAuditPage"
        />
      </section>

      <DeskDialog
        v-model="showCreds"
        title="密码已重置"
        width="420px"
        :close-on-click-modal="false"
      >
        <el-alert type="warning" :closable="false" show-icon class="cred-alert">
          密码仅展示一次，请立即复制交给对方
        </el-alert>
        <div v-if="creds" class="cred-box">
          <div class="cred-row"><span>用户名</span><b>{{ creds.username }}</b></div>
          <div class="cred-row"><span>新密码</span><b>{{ creds.password }}</b></div>
        </div>
        <template #footer>
          <el-button @click="showCreds = false">我已保存</el-button>
          <span class="win-footer-grow" />
          <el-button type="primary" @click="copyCreds">复制</el-button>
        </template>
      </DeskDialog>
      </div>
    </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import DeskDialog from '@/components/DeskDialog.vue'
import {
  consoleApi,
  type AgentAuditPage,
  type AgentAuditRow,
  type AgentDetail,
} from '@/api/console'
import { staffRoleLabel } from '@gamebox/shared'
import { useAdminStore } from '@/stores/admin'

const route = useRoute()
const router = useRouter()
const store = useAdminStore()
const isAdmin = computed(() => store.profile?.role === 'ADMIN')

const loading = ref(false)
const busy = ref(false)
const detail = ref<AgentDetail | null>(null)
const unboundAgent = ref(false)
const showCreds = ref(false)
const creds = ref<{ username: string; password: string } | null>(null)

const auditTab = ref<'fund' | 'ops'>('fund')
const auditLoading = ref(false)
const auditRows = ref<AgentAuditRow[]>([])
const auditTotal = ref(0)
const auditPage = ref(1)
const auditPageSize = 20
const summary = ref<AgentAuditPage['summary'] | null>(null)

function goBack() {
  router.push({ name: 'agents' })
}
function statusLabel(s: string) {
  return ({ OPEN: '营业', CLOSED: '关闭', MAINTENANCE: '维护', FROZEN: '冻结' } as Record<string, string>)[s] || s
}
function roleShort(r?: string) {
  return staffRoleLabel(r) || r || ''
}
function fmt(n?: number | null) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function fmtTime(s?: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function amountClass(row: AgentAuditRow) {
  if (row.action === 'QUOTA_RECALL' || row.action === 'CONSOLE_DEBIT') return 'down'
  if (row.amount != null && row.amount < 0) return 'down'
  return 'up'
}
function amountText(row: AgentAuditRow) {
  if (row.amount == null) return '—'
  const n = Number(row.amount)
  const sign = row.action === 'QUOTA_RECALL' ? '-' : n < 0 ? '' : '+'
  return `${sign}${Math.abs(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}
function targetHint(row: AgentAuditRow) {
  const t = row.detail?.roomId || row.detail?.roomNo || row.action
  if (row.action?.startsWith('ROOM_') && typeof row.detail?.roomNo === 'string') {
    return String(row.detail.roomNo)
  }
  if (typeof t === 'string' && t.length < 40) return t
  return '—'
}

async function loadAudit() {
  const id = detail.value?.id
  if (!id) return
  auditLoading.value = true
  try {
    const page = await consoleApi.agentAudit(id, {
      page: auditPage.value,
      pageSize: auditPageSize,
      tab: auditTab.value,
    })
    summary.value = page.summary
    auditRows.value = page.list || []
    auditTotal.value = page.total || 0
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载操作记录失败')
  } finally {
    auditLoading.value = false
  }
}

function onAuditTab() {
  auditPage.value = 1
  void loadAudit()
}
function onAuditPage(p: number) {
  auditPage.value = p
  void loadAudit()
}

async function load() {
  const id = String(route.params.id || '')
  if (!id) return
  loading.value = true
  unboundAgent.value = false
  detail.value = null
  summary.value = null
  auditRows.value = []
  try {
    const d = await consoleApi.agentDetail(id)
    if (d.role === 'AGENT' || d.role === 'PROXY') {
      const roomId = d.rooms?.[0]?.id
      if (roomId) {
        await router.replace({
          name: 'room-detail',
          params: { id: roomId },
          query: {
            tab: 'agent',
            ...(d.role === 'PROXY' ? { agentId: id } : {}),
          },
        })
        return
      }
      unboundAgent.value = true
      detail.value = d
      return
    }
    detail.value = d
    auditPage.value = 1
    await loadAudit()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '加载失败',
    )
  } finally {
    loading.value = false
  }
}

async function onResetPwd() {
  if (!detail.value) return
  try {
    const who = detail.value.role === 'GENERAL' ? '总代' : '总监'
    await ElMessageBox.confirm(`重置${who}「${detail.value.nickname}」密码？`, '重置密码', {
      type: 'warning',
      confirmButtonText: '重置',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    const res = await consoleApi.resetProxyPassword(detail.value.id)
    creds.value = { username: res.username, password: res.password }
    showCreds.value = true
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '重置失败')
  } finally {
    busy.value = false
  }
}

async function onToggleStatus() {
  if (!detail.value) return
  const next = detail.value.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  const label = next === 'DISABLED' ? '停用' : '启用'
  try {
    const who = detail.value.role === 'GENERAL' ? '总代' : '总监'
    await ElMessageBox.confirm(`确认${label}${who}「${detail.value.nickname}」？`, `${label}${who}`, {
      type: next === 'DISABLED' ? 'warning' : 'info',
    })
  } catch {
    return
  }
  busy.value = true
  try {
    const u = await consoleApi.setProxyStatus(detail.value.id, next)
    detail.value = { ...detail.value, status: u.status }
    ElMessage.success(`已${label}`)
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '操作失败')
  } finally {
    busy.value = false
  }
}

async function copyCreds() {
  if (!creds.value) return
  try {
    await navigator.clipboard.writeText(`用户名 ${creds.value.username}\n密码 ${creds.value.password}`)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

watch(() => route.params.id, () => { void load() })
onMounted(() => { void load() })
</script>

<style scoped>
.agent-detail-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
  flex-shrink: 0;
}
.profile-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin: 0 0 14px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 12px 14px;
}
.card .k { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 6px; }
.card .v { font-size: 18px; font-weight: 600; }
.card .v.gold { color: var(--ops-gold, #f59e0b); }
.card-tip { margin-top: 6px; font-size: 11px; color: var(--el-text-color-secondary); line-height: 1.35; }
.block {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 14px;
}
.fund-tip {
  margin-bottom: 12px;
}
.fund-tip {
  margin-bottom: 12px;
}
.hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.hd-title { font-weight: 600; }
.hd-count { font-size: 12px; color: var(--el-text-color-secondary); }
.name { font-weight: 500; }
.meta { font-size: 12px; color: var(--el-text-color-secondary); }
.muted { color: #c0c4cc; }
.up { color: var(--ops-gold, #f59e0b); font-weight: 600; }
.down { color: #f56c6c; font-weight: 600; }
.pager { margin-top: 12px; justify-content: flex-end; }
.empty, .empty-box {
  padding: 24px 8px;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}
.empty-box {
  margin-top: 12px;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  text-align: center;
}
</style>
