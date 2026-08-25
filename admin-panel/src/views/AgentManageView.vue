<template>
  <div class="desk-work agents-page" v-loading="loading">
    <div class="desk-panel">
      <PageHeader :title="title">
        <template #actions>
          <el-button v-if="isAdminOrBranch" :loading="loading" @click="load">刷新</el-button>
          <el-button
            v-if="isAdmin && (isChainView || roleFilter === 'BRANCH')"
            type="primary"
            @click="openCreateBranch"
          >添加总监</el-button>
          <el-button
            v-if="canCreateGeneral && (isChainView || roleFilter === 'GENERAL')"
            type="primary"
            @click="openCreateGeneral"
          >添加总代</el-button>
          <template v-if="isGeneralUser">
            <el-button :loading="loading" @click="load">刷新</el-button>
            <el-button type="primary" @click="openCreateProxy">添加子账号</el-button>
          </template>
        </template>
      </PageHeader>

      <section v-if="isAgentUser || isProxyUser" class="staff-gate">
        <el-button type="primary" @click="goOwnAgentDetail">
          {{ isAgentUser ? '进入本房代理页' : '进入所属房间代理页' }}
        </el-button>
      </section>

      <template v-else>
        <template v-if="isChainView">
        <div class="rooms-summary chain-summary">
          <div class="sum-chip" v-if="isAdmin">
            <span class="sum-label">总监</span>
            <span class="sum-val">{{ chainCounts.branch }}</span>
          </div>
          <div class="sum-chip" v-if="!isGeneralUser">
            <span class="sum-label">总代</span>
            <span class="sum-val">{{ chainCounts.general }}</span>
          </div>
          <div class="sum-chip">
            <span class="sum-label">总代名下代理</span>
            <span class="sum-val">{{ chainCounts.underGeneral }}</span>
          </div>
          <div class="sum-chip" v-if="!isGeneralUser">
            <span class="sum-label">直挂代理</span>
            <span class="sum-val">{{ chainCounts.direct }}</span>
          </div>
          <div class="sum-chip">
            <span class="sum-label">子账号</span>
            <span class="sum-val">{{ isGeneralUser ? chainCounts.ownStaff : chainCounts.staff }}</span>
          </div>
          <div class="sum-chip">
            <span class="sum-label">客服</span>
            <span class="sum-val">{{ chainCounts.cs }}</span>
          </div>
        </div>

        <div class="panel-toolbar">
          <el-input
            v-model="keyword"
            clearable
            size="small"
            placeholder="搜登录账号 / 昵称 / UID / 房间"
            class="filter-search"
          />
        </div>
        <p v-if="!autoExpandChain" class="agents-hint agents-hint--warn">
          共 {{ chainRowTotal }} 行，账号较多已默认收起，点大项那一行展开。数据是全的，没有被截断。
        </p>

        <div class="panel-body">
        <el-table
          ref="chainTableRef"
          :data="chainTree"
            v-loading="loading"
            class="agents-table chain-table"
            :key="`chain-${chainCounts.branch}-${chainCounts.general}-${chainCounts.underGeneral}-${chainCounts.direct}`"
            row-key="key"
            :tree-props="{ children: 'children' }"
            :indent="8"
            :default-expand-all="autoExpandChain"
            border
            size="small"
            height="100%"
            empty-text="暂无账号"
            :row-class-name="chainRowClass"
            @row-click="onChainRowClick"
          >
            <el-table-column label="链路" min-width="200">
              <template #default="{ row }: { row: any }">
                <div class="cell-name">{{ row.title }}</div>
                <div class="cell-meta">{{ row.chain }}</div>
              </template>
            </el-table-column>
            <el-table-column label="登录账号" min-width="168">
              <template #default="{ row }: { row: any }">
                <template v-if="row.username || row.uid">
                  <div class="cell-name mono">{{ row.username || '—' }}</div>
                  <div class="cell-meta">{{ row.uid || '' }}</div>
                </template>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="下级" min-width="200">
              <template #default="{ row }: { row: any }">
                <span class="count-line">{{ countText(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="88" align="center">
              <template #default="{ row }: { row: any }">
                <el-tag
                  v-if="row.status"
                  :type="row.status === 'ACTIVE' ? 'success' : 'info'"
                  size="small"
                  effect="plain"
                >{{ row.status === 'ACTIVE' ? '正常' : '停用' }}</el-tag>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="最近登录" min-width="128">
              <template #default="{ row }: { row: any }">
                <span v-if="row.lastLoginAt !== undefined" :class="{ muted: !row.lastLoginAt }">
                  {{ fmtTime(row.lastLoginAt) }}
                </span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="280" align="right">
              <template #default="{ row }: { row: any }">
                <div v-if="row.kind !== 'group'" class="ops" @click.stop>
                  <template v-if="row.kind === 'general' && row.status === 'ACTIVE'">
                    <template v-if="isAdminOrBranch">
                      <el-button link type="primary" @click="openFund(row.raw!, 'up')">上分</el-button>
                      <el-button link type="warning" @click="openFund(row.raw!, 'down')">下分</el-button>
                    </template>
                    <el-button
                      v-if="row.status === 'ACTIVE'"
                      link
                      type="primary"
                      @click="openCreateGeneralProxy(row)"
                    >添加子账号</el-button>
                  </template>
                  <template v-if="isGeneralUser && row.kind === 'agent' && row.raw && row.roomId">
                    <el-button link type="primary" @click="goDetail(row.raw)">买额度</el-button>
                  </template>
                  <el-button link type="primary" @click="onChainClick(row)">
                    {{ chainActionLabel(row) }}
                  </el-button>
                  <template v-if="isGeneralUser && row.kind === 'proxy' && isOwnGeneralStaff(row) && row.raw">
                    <el-button link type="warning" @click="onResetPwd(row.raw)">重置密码</el-button>
                    <el-button
                      link
                      :type="row.raw.status === 'ACTIVE' ? 'danger' : 'success'"
                      @click="onToggleStatus(row.raw)"
                    >{{ row.raw.status === 'ACTIVE' ? '停用' : '启用' }}</el-button>
                  </template>
                  <template v-if="isAdmin && (row.kind === 'branch' || row.kind === 'general') && row.raw">
                    <el-button link type="warning" @click="onResetPwd(row.raw)">重置密码</el-button>
                    <el-button
                      link
                      :type="row.raw.status === 'ACTIVE' ? 'danger' : 'success'"
                      @click="onToggleStatus(row.raw)"
                    >{{ row.raw.status === 'ACTIVE' ? '停用' : '启用' }}</el-button>
                  </template>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
        </template>

        <template v-else>
        <div class="panel-toolbar">
          <el-radio-group v-model="roleFilter" size="small" @change="onTabChange">
            <el-radio-button v-if="isAdmin" label="BRANCH">总监</el-radio-button>
            <el-radio-button v-if="isAdminOrBranch" label="GENERAL">总代</el-radio-button>
            <el-radio-button v-if="isGeneralUser" label="GENERAL">我的子账号</el-radio-button>
            <el-radio-button v-if="isGeneralUser" label="AGENT">名下代理</el-radio-button>
          </el-radio-group>
          <el-input
            v-model="keyword"
            clearable
            size="small"
            :placeholder="roleFilter === 'AGENT' ? '搜昵称 / 账号 / 房间' : '搜昵称 / 账号'"
            class="filter-search"
            @clear="reload"
            @keyup.enter="reload"
          />
          <el-button size="small" @click="reload">搜索</el-button>
        </div>
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
          >
            <el-table-column v-if="roleFilter === 'AGENT'" label="房间" min-width="160">
              <template #default="{ row }: { row: any }">
                <template v-if="operatingRooms(row.rooms).length">
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
            <el-table-column v-if="roleFilter === 'AGENT'" label="代理余额" min-width="108" align="right">
              <template #default="{ row }: { row: any }">
                <span class="gold">{{ fmt(row.balance) }}</span>
              </template>
            </el-table-column>
            <!-- 绑的是 pointsQuota（额度），不是 flyCover；旧列名「上盘/剩余信用」会跟「上盘可飞」混 -->
            <el-table-column v-if="roleFilter === 'AGENT'" label="剩余信用/可用额度" min-width="130" align="right">
              <template #default="{ row }: { row: any }">{{ fmt(row.pointsQuota) }}</template>
            </el-table-column>
            <el-table-column v-if="roleFilter === 'GENERAL'" label="名下房间" min-width="160">
              <template #default="{ row }: { row: any }">
                <div class="cell-name">{{ row.roomCount ?? operatingRooms(row.rooms).length }} 间</div>
                <div class="cell-meta">流水 {{ pct(row.flowRate) }}% · 占成 {{ pct(row.shareRate) }}%</div>
              </template>
            </el-table-column>
            <el-table-column v-if="roleFilter === 'GENERAL'" label="与平台" min-width="150">
              <template #default="{ row }: { row: any }">
                <el-tag :type="row.bookMode === 'CREDIT' ? 'warning' : 'success'" size="small" effect="plain">
                  {{ row.bookMode === 'CREDIT' ? 'B · 信用盘' : 'A · 现金盘' }}
                </el-tag>
                <div class="cell-meta">
                  {{ row.bookMode === 'CREDIT' ? `合同额度 ${fmt(row.creditLimit)} · ` : '' }}{{ cycleLabel(row.settleCycle) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column v-if="roleFilter === 'GENERAL'" label="可用额度" min-width="120" align="right">
              <template #default="{ row }: { row: any }">
                <template v-if="Number(row.pointsQuota) < 0">
                  <span class="over-issue">超发 {{ fmt(-Number(row.pointsQuota)) }}</span>
                </template>
                <template v-else>{{ fmt(row.pointsQuota) }}</template>
              </template>
            </el-table-column>
            <el-table-column v-if="roleFilter === 'BRANCH'" label="可见房间" min-width="100" align="center">
              <template #default="{ row }: { row: any }">{{ row.roomCount ?? operatingRooms(row.rooms).length }}</template>
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
              :min-width="opsColWidth"
              align="right"
            >
              <template #default="{ row }: { row: any }">
                <div class="ops" @click.stop>
                  <template v-if="roleFilter === 'GENERAL' && isAdminOrBranch && !isGeneralUser && row.status === 'ACTIVE'">
                    <el-button link type="primary" @click="openFund(row, 'up')">上分</el-button>
                    <el-button link type="warning" @click="openFund(row, 'down')">下分</el-button>
                  </template>
                  <el-button link type="primary" @click="goDetail(row)">
                    {{ roleFilter === 'AGENT' ? '买额度' : '详情' }}
                  </el-button>
                  <el-button
                    v-if="roleFilter === 'AGENT' && operatingRooms<any>(row.rooms)[0]?.id"
                    link
                    @click="goRoomOverview(row)"
                  >进房间</el-button>
                  <template v-if="isGeneralUser && roleFilter === 'GENERAL'">
                    <el-button link type="warning" @click="onResetPwd(row)">重置密码</el-button>
                    <el-button
                      link
                      :type="row.status === 'ACTIVE' ? 'danger' : 'success'"
                      @click="onToggleStatus(row)"
                    >{{ row.status === 'ACTIVE' ? '停用' : '启用' }}</el-button>
                  </template>
                  <template v-if="(roleFilter === 'BRANCH' || roleFilter === 'GENERAL') && isAdmin">
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
      </template>
    </div>

    <DeskDialog v-model="createVisible" :title="createDialogTitle" width="480px">
      <el-form label-width="100px" class="desk-form">
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
        <p v-if="createKind === 'PROXY' && proxyParentName" class="unit-hint" style="margin:-4px 0 12px 100px">
          挂在总代「{{ proxyParentName }}」下面，与总代共用权限，帮管名下房间。
        </p>
        <template v-if="createKind === 'GENERAL'">
          <el-form-item label="流水整包">
            <el-input-number v-model="createForm.flowPct" :min="generalFlowMin" :max="generalFlowMax" :step="0.1" :precision="1" controls-position="right" />
            <span class="unit-hint">%</span>
          </el-form-item>
          <el-form-item label="占成">
            <el-input-number v-model="createForm.sharePct" :min="0" :max="70" :step="1" controls-position="right" />
            <span class="unit-hint">%</span>
          </el-form-item>
          <el-form-item label="与平台盘口">
            <el-radio-group v-model="createForm.bookMode">
              <el-radio-button label="CASH">A · 现金盘</el-radio-button>
              <el-radio-button label="CREDIT">B · 信用盘</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item v-if="createForm.bookMode === 'CREDIT'" label="信用额度" required>
            <el-input-number v-model="createForm.creditLimit" :min="1" :step="10000" :precision="0" controls-position="right" />
          </el-form-item>
          <el-form-item label="结算周期">
            <el-select v-model="createForm.settleCycle" style="width:180px">
              <el-option label="每周一" value="WEEKLY_MON" />
              <el-option label="每月 1 号" value="MONTHLY_1" />
              <el-option label="每月 15 号与月末" value="MONTHLY_15_30" />
            </el-select>
          </el-form-item>
          <el-form-item label="房间月费">
            <el-input-number
              v-model="createForm.roomMonthlyFee"
              :min="0"
              :step="100"
              :precision="0"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item v-if="isAdmin && branchOptions.length" label="可见总监">
            <div class="grant-pick">
              <el-checkbox-group v-model="createForm.ownerUserIds">
                <el-checkbox
                  v-for="b in branchOptions"
                  :key="b.id"
                  :label="b.id"
                >{{ b.nickname }}（{{ b.uid }}）</el-checkbox>
              </el-checkbox-group>
            </div>
          </el-form-item>
        </template>
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
        密码仅展示一次，请立即复制交给对方
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

    <DeskDialog
      v-model="fundVisible"
      :title="fundMode === 'up' ? `上分 · ${fundTarget?.nickname || ''}` : `下分 · ${fundTarget?.nickname || ''}`"
      width="400px"
    >
      <el-form label-width="72px">
        <el-form-item label="金额">
          <el-input-number v-model="fundAmount" :min="1" :max="10000000" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fundVisible = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button :type="fundMode === 'up' ? 'primary' : 'warning'" :loading="fundBusy" @click="doFund">
          确认{{ fundMode === 'up' ? '上分' : '下分' }}
        </el-button>
      </template>
    </DeskDialog>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { formatMoney, isGeneralSide, validateOpsPassword } from '@gamebox/shared'
import PageHeader from '@/components/PageHeader.vue'
import DeskDialog from '@/components/DeskDialog.vue'
import { consoleApi, type AgentPage, type CsStaffRow } from '@/api/console'
import { useAdminStore } from '@/stores/admin'
import { newFundOrderNo } from '@/utils/fundOrderNo'

type Row = AgentPage['list'][number]
type TabRole = 'AGENT' | 'BRANCH' | 'GENERAL'
type CreateKind = 'BRANCH' | 'GENERAL' | 'PROXY'

const store = useAdminStore()
const router = useRouter()
const chainTableRef = ref<{ toggleRowExpansion: (row: unknown) => void } | null>(null)
const role = computed(() => store.profile?.role || '')
const isAdmin = computed(() => role.value === 'ADMIN')
const isAdminOrBranch = computed(() => role.value === 'ADMIN' || role.value === 'BRANCH')
const canCreateGeneral = computed(() => isAdminOrBranch.value)
const isAgentUser = computed(() => role.value === 'AGENT')
const isProxyUser = computed(() =>
  role.value === 'PROXY' && !isGeneralSide(role.value, store.profile?.parentRole),
)
const isGeneralUser = computed(() => isGeneralSide(role.value, store.profile?.parentRole))
const isChainView = computed(() => isAdminOrBranch.value || isGeneralUser.value)
const generalRootId = computed(() =>
  role.value === 'GENERAL'
    ? (store.profile?.id || '')
    : (store.profile?.parentId || ''),
)

type ChainKind = 'group' | 'branch' | 'general' | 'agent' | 'proxy' | 'cs'
type ChainRow = {
  key: string
  kind: ChainKind
  title: string
  chain: string
  username?: string
  uid?: string
  id?: string
  roomId?: string
  roomCount: number
  agentCount: number
  staffCount: number
  csCount: number
  status?: string
  lastLoginAt?: string | null
  bookMode?: string
  children?: ChainRow[]
  raw?: Row
}

const title = computed(() => {
  if (isAgentUser.value || isProxyUser.value) return '下级账号'
  if (isGeneralUser.value) return '我的账号'
  return '账号中心'
})
const emptyText = computed(() => {
  if (roleFilter.value === 'BRANCH') return '暂无总监'
  if (roleFilter.value === 'GENERAL') return isGeneralUser.value ? '暂无子账号' : '暂无总代'
  return isGeneralUser.value ? '名下暂无房间代理' : '暂无代理房间'
})

const list = ref<Row[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const busy = ref(false)
const roleFilter = ref<TabRole>('GENERAL')
const keyword = ref('')
const branchCount = ref(0)
const generalCount = ref(0)
const branchList = ref<Row[]>([])
const generalList = ref<Row[]>([])
const agentList = ref<Row[]>([])
const proxyList = ref<Row[]>([])
const csList = ref<CsStaffRow[]>([])

function groupByParent(rows: Row[]) {
  const map = new Map<string, Row[]>()
  for (const r of rows) {
    const pid = r.parentId || ''
    if (!pid) continue
    const arr = map.get(pid) ?? []
    arr.push(r)
    map.set(pid, arr)
  }
  return map
}

function leafRow(
  kind: 'proxy' | 'cs' | 'branch',
  row: { id: string; nickname: string; username: string; uid?: string; status: string; lastLoginAt?: string | null },
  chain: string,
  roomId?: string,
): ChainRow {
  const tag = kind === 'cs' ? '客服' : kind === 'proxy' ? '子账号' : '总监'
  return {
    key: `${kind}-${row.id}`,
    kind,
    title: `${tag} · ${row.nickname || row.username}`,
    chain,
    username: row.username,
    uid: row.uid,
    id: row.id,
    roomId,
    roomCount: 0,
    agentCount: 0,
    staffCount: 0,
    csCount: 0,
    status: row.status,
    lastLoginAt: row.lastLoginAt ?? null,
    raw: kind === 'cs' ? undefined : (row as Row),
  }
}

function operatingRooms<T extends { status?: string }>(rooms?: T[] | null): T[] {
  return (rooms || []).filter((r) => r.status !== 'CLOSED')
}

function agentBranch(a: Row): ChainRow {
  const room = operatingRooms(a.rooms)[0]
  const roomName = room?.name || '未绑定'
  const proxies = (proxyByParent.value.get(a.id) || []).map((p) =>
    leafRow('proxy', p, `代理${a.nickname}`, room?.id),
  )
  const css = (csByParent.value.get(a.id) || []).map((c) =>
    leafRow(
      'cs',
      { id: c.id, nickname: c.nickname, username: c.username, uid: c.uid, status: c.status },
      `代理${a.nickname}`,
      room?.id,
    ),
  )
  return {
    key: `a-${a.id}`,
    kind: 'agent',
    title: `代理 · ${a.nickname || a.username}`,
    chain: roomName + (room?.roomNo ? ` · ${room.roomNo}` : ''),
    username: a.username,
    uid: a.uid,
    id: a.id,
    roomId: room?.id,
    roomCount: operatingRooms(a.rooms).length,
    agentCount: 1,
    staffCount: proxies.length,
    csCount: css.length,
    status: a.status,
    lastLoginAt: a.lastLoginAt,
    raw: a,
    children: [...proxies, ...css],
  }
}

const proxyByParent = computed(() => groupByParent(proxyList.value))
const csByParent = computed(() => {
  const map = new Map<string, CsStaffRow[]>()
  for (const c of csList.value) {
    const pid = c.parentAgentUserId || ''
    if (!pid) continue
    const arr = map.get(pid) ?? []
    arr.push(c)
    map.set(pid, arr)
  }
  return map
})

function filterChain(rows: ChainRow[], q: string): ChainRow[] {
  if (!q) return rows
  const hit = (r: ChainRow) =>
    `${r.title} ${r.chain} ${r.username || ''} ${r.uid || ''} ${r.raw?.username || ''} ${r.raw?.uid || ''}`.toLowerCase().includes(q)
  const walk = (list: ChainRow[]): ChainRow[] => {
    const out: ChainRow[] = []
    for (const r of list) {
      const kids = r.children ? walk(r.children) : []
      if (hit(r) || kids.length) {
        out.push(kids.length ? { ...r, children: kids } : r)
      }
    }
    return out
  }
  return walk(rows)
}

const chainTree = computed<ChainRow[]>(() => {
  const under = new Map<string, Row[]>()
  const direct: Row[] = []
  const selfId = isGeneralUser.value ? generalRootId.value : ''
  for (const a of agentList.value) {
    /* 关房后房间被滤掉会变成「未绑定」，这种代理不能再挂在总代树上 */
    if (!operatingRooms(a.rooms).length) continue
    const gid = operatingRooms(a.rooms)[0]?.generalUserId || (selfId || '')
    if (gid) {
      const arr = under.get(gid) ?? []
      arr.push(a)
      under.set(gid, arr)
    } else {
      direct.push(a)
    }
  }
  const roots: ChainRow[] = []
  if (isAdmin.value) {
    roots.push({
      key: 'grp-branch',
      kind: 'group',
      title: `总监（${branchList.value.length}）`,
      chain: '',
      roomCount: 0,
      agentCount: branchList.value.length,
      staffCount: 0,
      csCount: 0,
      children: branchList.value.map((b) => ({
        key: `b-${b.id}`,
        kind: 'branch' as const,
        title: `总监 · ${b.nickname || b.username}`,
        chain: `平台 → 总监${b.nickname || b.username}`,
        username: b.username,
        uid: b.uid,
        id: b.id,
        roomCount: b.roomCount ?? 0,
        agentCount: 0,
        staffCount: 0,
        csCount: 0,
        status: b.status,
        lastLoginAt: b.lastLoginAt,
        raw: b,
      })),
    })
  }
  const shownGeneralIds = new Set<string>()
  for (const g of generalList.value) {
    const name = g.nickname || g.username
    shownGeneralIds.add(g.id)
    const kids = under.get(g.id) ?? []
    const ownStaff = (proxyByParent.value.get(g.id) || []).map((p) =>
      leafRow('proxy', p, '总代子账号'),
    )
    const agentRows = kids.map((a) => agentBranch(a))
    if (isGeneralUser.value) {
      roots.push(...ownStaff, ...agentRows)
      continue
    }
    roots.push({
      key: `g-${g.id}`,
      kind: 'general',
      title: `总代 · ${name}`,
      chain: `平台 → 总代${name}${g.bookMode === 'CREDIT' ? ' · 信用盘' : ' · 现金盘'}`,
      username: g.username,
      uid: g.uid,
      id: g.id,
      roomCount: g.roomCount ?? kids.length,
      agentCount: kids.length,
      staffCount: ownStaff.length + agentRows.reduce((s, r) => s + r.staffCount, 0),
      csCount: agentRows.reduce((s, r) => s + r.csCount, 0),
      status: g.status,
      lastLoginAt: g.lastLoginAt,
      bookMode: g.bookMode,
      raw: g,
      children: [...ownStaff, ...agentRows],
    })
  }
  /*
   * 代理挂着某个总代、但那个总代不在 generalList 里（被停用、超出可见范围、或列表没取全）。
   * 这些代理原先既不进总代那棵树、也不进「直挂平台」，等于在页面上凭空消失，
   * 而他名下的房间和玩家还在正常经营。宁可单列一组让人看见，也不能让它们无声蒸发。
   */
  const orphans: Row[] = []
  for (const [gid, kids] of under) {
    if (!shownGeneralIds.has(gid)) orphans.push(...kids)
  }
  if (!isGeneralUser.value && orphans.length) {
    roots.push({
      key: 'grp-orphan',
      kind: 'group',
      title: `未归属总代（${orphans.length}）`,
      chain: '',
      roomCount: orphans.length,
      agentCount: orphans.length,
      staffCount: orphans.reduce((s, a) => s + (proxyByParent.value.get(a.id)?.length ?? 0), 0),
      csCount: orphans.reduce((s, a) => s + (csByParent.value.get(a.id)?.length ?? 0), 0),
      children: orphans.map((a) => agentBranch(a)),
    })
  }
  if (!isGeneralUser.value) {
    roots.push({
      key: 'grp-direct',
      kind: 'group',
      title: `直挂平台（${direct.length}）`,
      chain: '',
      roomCount: direct.length,
      agentCount: direct.length,
      staffCount: direct.reduce((s, a) => s + (proxyByParent.value.get(a.id)?.length ?? 0), 0),
      csCount: direct.reduce((s, a) => s + (csByParent.value.get(a.id)?.length ?? 0), 0),
      children: direct.map((a) => agentBranch(a)),
    })
  }
  return filterChain(roots, keyword.value.trim().toLowerCase())
})

/**
 * 账号数一多，整棵树默认展开会让页面卡住。
 * 树本身要拿全量数据才能连得起父子，不能服务端分页，所以改成大树默认收起。
 */
const CHAIN_AUTO_EXPAND_MAX = 200

function countChainRows(rows: ChainRow[]): number {
  return rows.reduce(
    (sum, r) => sum + 1 + (r.children?.length ? countChainRows(r.children) : 0),
    0,
  )
}

const chainRowTotal = computed(() => countChainRows(chainTree.value))
const autoExpandChain = computed(() => chainRowTotal.value <= CHAIN_AUTO_EXPAND_MAX)

const chainCounts = computed(() => {
  const underGeneral = agentList.value.filter((a) => operatingRooms(a.rooms)[0]?.generalUserId || isGeneralUser.value).length
  const ownStaff = generalRootId.value
    ? (proxyByParent.value.get(generalRootId.value)?.length ?? 0)
    : 0
  return {
    branch: branchList.value.length,
    general: generalList.value.length,
    underGeneral,
    direct: isGeneralUser.value ? 0 : agentList.value.length - agentList.value.filter((a) => operatingRooms(a.rooms)[0]?.generalUserId).length,
    staff: proxyList.value.length,
    ownStaff,
    cs: csList.value.length,
  }
})

function countText(row: ChainRow) {
  if (row.kind === 'proxy' || row.kind === 'cs') return '—'
  if (row.kind === 'branch') return `可见房间 ${row.roomCount}`
  if (row.kind === 'group' && row.key === 'grp-branch') return `账号 ${row.agentCount}`
  if (row.kind === 'agent') return `子账号 ${row.staffCount} · 客服 ${row.csCount}`
  if (row.kind === 'general') {
    const own = row.children?.filter((c) => c.kind === 'proxy').length ?? 0
    return `子账号 ${own} · 代理 ${row.agentCount} · 客服 ${row.csCount}`
  }
  if (row.key === 'grp-direct') {
    return `代理 ${row.agentCount} · 子账号 ${row.staffCount} · 客服 ${row.csCount}`
  }
  const parts: string[] = []
  if (row.staffCount) parts.push(`子账号 ${row.staffCount}`)
  if (row.csCount) parts.push(`客服 ${row.csCount}`)
  return parts.join(' · ') || '—'
}

function chainRowClass({ row }: { row: ChainRow }) {
  if (row.kind === 'group') return 'is-group is-fold'
  if (row.kind === 'general') return 'is-general is-fold'
  if (row.kind === 'agent') return row.children?.length ? 'is-child is-fold' : 'is-child'
  if (row.kind === 'branch') return 'is-child'
  return 'is-leaf'
}
function onChainRowClick(row: ChainRow, _col: unknown, ev: Event) {
  if ((ev.target as HTMLElement | null)?.closest?.('.el-table__expand-icon, .ops, button, a')) return
  if (!row.children?.length) return
  chainTableRef.value?.toggleRowExpansion(row)
}
function isOwnGeneralStaff(row: ChainRow) {
  return row.kind === 'proxy' && !!row.raw?.parentId && row.raw.parentId === generalRootId.value
}
function chainActionLabel(row: ChainRow) {
  if (row.kind === 'agent' || row.kind === 'cs') return '进房间'
  if (row.kind === 'proxy') return row.roomId ? '进房间' : '详情'
  return '详情'
}
function onChainClick(row: ChainRow) {
  if (row.kind === 'group') return
  if (row.kind === 'agent' || row.kind === 'proxy' || row.kind === 'cs') {
    if (row.kind === 'proxy' && !row.roomId && row.raw?.parentId) {
      const parent = generalList.value.find((g) => g.id === row.raw?.parentId)
      if (parent) {
        router.push({ name: 'general-detail', params: { id: parent.id }, query: { from: 'agents', tab: 'basic' } })
        return
      }
    }
    if (row.roomId) {
      router.push({
        name: 'room-detail',
        params: { id: row.roomId },
        query: {
          tab: 'agent',
          ...(row.kind === 'proxy' && row.id ? { agentId: row.id } : {}),
        },
      })
      return
    }
    if (row.kind !== 'proxy') ElMessage.warning('该账号未绑定房间')
    return
  }
  if (row.kind === 'general' && row.id) {
    router.push({ name: 'general-detail', params: { id: row.id }, query: { from: 'agents', tab: 'basic' } })
    return
  }
  if (row.kind === 'branch' && row.id) {
    router.push({ name: 'agent-detail', params: { id: row.id } })
  }
}

const opsColWidth = computed(() => {
  if (roleFilter.value === 'GENERAL' && isAdminOrBranch.value && !isGeneralUser.value) {
    return isAdmin.value ? 280 : 168
  }
  if (isGeneralUser.value && roleFilter.value === 'GENERAL') return 196
  if ((roleFilter.value === 'BRANCH' || roleFilter.value === 'GENERAL') && isAdmin.value) return 196
  if (roleFilter.value === 'AGENT') return 140
  return 88
})

const fundVisible = ref(false)
const fundBusy = ref(false)
const fundMode = ref<'up' | 'down'>('up')
const fundAmount = ref(10000)
const fundTarget = ref<Row | null>(null)

const createVisible = ref(false)
const createKind = ref<CreateKind>('BRANCH')
/** 管理/总监给指定总代开子账号时填写；总代给自己开则留空 */
const proxyParentId = ref('')
const proxyParentName = ref('')
const createForm = reactive({
  username: '',
  password: '',
  nickname: '',
  flowPct: 7,
  sharePct: 50,
  bookMode: 'CASH' as 'CASH' | 'CREDIT',
  creditLimit: 100000,
  settleCycle: 'WEEKLY_MON',
  /** 总代每开一间房、每月缴给平台的月费单价 */
  roomMonthlyFee: 0,
  /** 建总代时勾选哪些总监可见；空数组=只有管理直管 */
  ownerUserIds: [] as string[],
})
/** 可勾选的总监名单（仅管理需要） */
const branchOptions = ref<{ id: string; uid: string; nickname: string }[]>([])
const generalFlowMin = ref(1.8)
const generalFlowMax = ref(10)
const generalFlowDefault = ref(7)
const showCreds = ref(false)
const createdCreds = ref<{ nickname: string; username: string; password: string } | null>(null)
const createDialogTitle = computed(() => {
  if (createKind.value === 'GENERAL') return '添加总代'
  if (createKind.value === 'PROXY') {
    return proxyParentName.value ? `添加总代子账号 · ${proxyParentName.value}` : '添加子账号'
  }
  return '添加总监'
})

function pct(n?: number | null) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  const x = v > 1 ? v : v * 100
  return Number(x.toFixed(1))
}
function fmt(n?: number) {
  return formatMoney(n ?? 0)
}
function cycleLabel(c?: string) {
  if (c === 'MONTHLY_1') return '每月 1 号结'
  if (c === 'MONTHLY_15_30') return '每月 15 号与月末结'
  return '每周一结'
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
  return operatingRooms(row.rooms).map((r) => r.name).join('、')
}
function roomNos(row: Row) {
  return operatingRooms(row.rooms).map((r) => r.roomNo).join(' / ')
}
function randHex(n: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}
function regenUsername() {
  const prefix = createKind.value === 'GENERAL' ? 'general' : createKind.value === 'PROXY' ? 'proxy' : 'branch'
  createForm.username = `${prefix}${randHex(6)}`
}
function regenPassword() {
  const prefix = createKind.value === 'GENERAL' ? 'Ge' : createKind.value === 'PROXY' ? 'Px' : 'Br'
  createForm.password = `${prefix}${randHex(8)}9`
}
function goRoomAgent(roomId: string) {
  router.push({ name: 'room-detail', params: { id: roomId }, query: { tab: 'agent' } })
}
function goRoomOverview(row: Row) {
  const roomId = operatingRooms(row.rooms)[0]?.id
  if (!roomId) {
    ElMessage.warning('该代理未绑定房间')
    return
  }
  router.push({ name: 'room-detail', params: { id: roomId } })
}
function goDetail(row: Row) {
  if (row.role === 'AGENT' || roleFilter.value === 'AGENT') {
    const roomId = operatingRooms(row.rooms)[0]?.id
    if (roomId) {
      goRoomAgent(roomId)
      return
    }
    ElMessage.warning('该代理未绑定房间')
    router.push({ name: 'rooms' })
    return
  }
  if (row.role === 'GENERAL') {
    router.push({ name: 'general-detail', params: { id: row.id }, query: { from: 'agents', tab: 'basic' } })
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
    const roomId = operatingRooms(d.rooms)[0]?.id
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
    const [b, g] = await Promise.all([
      consoleApi.agents({ page: 1, pageSize: 1, role: 'BRANCH', boundOnly: false }),
      consoleApi.agents({ page: 1, pageSize: 1, role: 'GENERAL', boundOnly: false }),
    ])
    branchCount.value = b.total
    generalCount.value = g.total
  } catch {
    /* ignore */
  }
}

async function load() {
  if (!isAdminOrBranch.value && !isGeneralUser.value) return
  if (!isAdmin.value && roleFilter.value === 'BRANCH') roleFilter.value = 'GENERAL'
  loading.value = true
  try {
    if (isChainView.value) {
      if (isGeneralUser.value) {
        const [g, a, p, cs] = await Promise.all([
          consoleApi.agentsAll({ role: 'GENERAL', boundOnly: false }),
          consoleApi.agentsAll({ role: 'AGENT', boundOnly: true }),
          consoleApi.agentsAll({ role: 'PROXY', boundOnly: false }),
          consoleApi.csStaffList().catch(() => [] as CsStaffRow[]),
        ])
        branchList.value = []
        generalList.value = g.list.filter((x) => x.role === 'GENERAL')
        if (!generalList.value.length && generalRootId.value) {
          const me = store.profile
          generalList.value = [{
            id: generalRootId.value,
            uid: me?.uid || '',
            nickname: me?.nickname || '总代',
            username: me?.username || '',
            role: 'GENERAL',
            status: 'ACTIVE',
            roomCount: a.list.length,
            lastLoginAt: null,
          } as Row]
        }
        agentList.value = a.list
        proxyList.value = p.list
        csList.value = cs
        generalCount.value = generalList.value.length
        return
      }
      const [b, g, a, p, cs] = await Promise.all([
        isAdmin.value
          ? consoleApi.agentsAll({ role: 'BRANCH', boundOnly: false })
          : Promise.resolve({ list: [] as Row[], total: 0 }),
        consoleApi.agentsAll({ role: 'GENERAL', boundOnly: false }),
        consoleApi.agentsAll({ role: 'AGENT', boundOnly: true }),
        consoleApi.agentsAll({ role: 'PROXY', boundOnly: false }),
        consoleApi.csStaffList().catch(() => [] as CsStaffRow[]),
      ])
      branchList.value = b.list
      generalList.value = g.list
      agentList.value = a.list
      proxyList.value = p.list
      csList.value = cs
      branchCount.value = b.total
      generalCount.value = g.total
      return
    }
    const res = await consoleApi.agents({
      page: page.value,
      pageSize: 20,
      role: roleFilter.value,
      q: keyword.value.trim() || undefined,
      boundOnly: !isGeneralUser.value && roleFilter.value === 'AGENT',
    })
    list.value = res.list
    total.value = res.total
    if (roleFilter.value === 'BRANCH') branchCount.value = res.total
    else if (roleFilter.value === 'GENERAL') generalCount.value = res.total
    if (isAdmin.value) void loadCounts()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    loading.value = false
  }
}

function clearProxyParent() {
  proxyParentId.value = ''
  proxyParentName.value = ''
}
async function loadGeneralFlowBounds() {
  try {
    const p = await consoleApi.rebatePolicy()
    const plat = p.chain?.platform
    generalFlowMin.value = Number((((plat?.generalMin ?? p.generalMinRate ?? 0.018) * 100)).toFixed(1))
    generalFlowMax.value = Number((((plat?.generalMax ?? p.generalMaxRate ?? 0.1) * 100)).toFixed(1))
    generalFlowDefault.value = Number((((plat?.generalDefault ?? p.generalDefaultRate ?? 0.07) * 100)).toFixed(1))
  } catch {
    /* keep defaults */
  }
}
function openCreateBranch() {
  createKind.value = 'BRANCH'
  clearProxyParent()
  createForm.nickname = ''
  createForm.flowPct = 7
  createForm.sharePct = 50
  regenUsername()
  regenPassword()
  createVisible.value = true
}
function openCreateGeneral() {
  createKind.value = 'GENERAL'
  clearProxyParent()
  createForm.nickname = ''
  createForm.sharePct = 50
  void loadGeneralFlowBounds().then(() => {
    createForm.flowPct = generalFlowDefault.value
  })
  /* 默认全勾：不选就等于沿用升级前「总代全平台可见」，要收紧才动手取消 */
  void loadBranchOptions().then(() => {
    createForm.ownerUserIds = branchOptions.value.map((b) => b.id)
  })
  regenUsername()
  regenPassword()
  createVisible.value = true
}

/** 拉总监名单给「可见总监」勾选用；只有管理能定这个 */
async function loadBranchOptions() {
  if (!isAdmin.value) {
    branchOptions.value = []
    return
  }
  try {
    const res = await consoleApi.agentsAll({ role: 'BRANCH', boundOnly: false })
    branchOptions.value = (res.list || [])
      .filter((x) => x.role === 'BRANCH' && x.status === 'ACTIVE')
      .map((x) => ({ id: x.id, uid: x.uid, nickname: x.nickname || x.username || x.uid }))
  } catch {
    branchOptions.value = []
  }
}
/** 总代给自己开助手：只填账号密码，权限跟着总代走 */
function openCreateProxy() {
  createKind.value = 'PROXY'
  clearProxyParent()
  createForm.nickname = ''
  regenUsername()
  regenPassword()
  createVisible.value = true
}
/** 管理/总监给指定总代开子账号 */
function openCreateGeneralProxy(row: ChainRow) {
  if (!row.id) return
  createKind.value = 'PROXY'
  proxyParentId.value = row.id
  proxyParentName.value = row.raw?.nickname || row.raw?.username || ''
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
  if (createKind.value === 'GENERAL') {
    if (createForm.flowPct < generalFlowMin.value - 1e-9 || createForm.flowPct > generalFlowMax.value + 1e-9) {
      ElMessage.warning('总代流水整包须在 1.8%～10%')
      return
    }
    if (createForm.sharePct < 0 || createForm.sharePct > 70) {
      ElMessage.warning('总代占成须在 0%～70%')
      return
    }
    if (createForm.bookMode === 'CREDIT' && !(createForm.creditLimit > 0)) {
      ElMessage.warning('信用盘总代须设置合同额度')
      return
    }
  }
  busy.value = true
  try {
    const username = createForm.username.trim().toLowerCase()
    const password = createForm.password
    const res = await consoleApi.createAgent({
      role: createKind.value,
      username,
      password,
      nickname: createForm.nickname.trim() || undefined,
      ...(createKind.value === 'PROXY' && proxyParentId.value
        ? { parentAgentUserId: proxyParentId.value }
        : {}),
      ...(createKind.value === 'GENERAL'
        ? {
            flowRate: createForm.flowPct / 100,
            shareRate: createForm.sharePct / 100,
            bookMode: createForm.bookMode,
            settleCycle: createForm.settleCycle,
            roomMonthlyFee: createForm.roomMonthlyFee,
            /* 只有管理能定可见范围；总监开的总代由服务端一律全员可见 */
            ...(isAdmin.value ? { ownerUserIds: [...createForm.ownerUserIds] } : {}),
            ...(createForm.bookMode === 'CREDIT'
              ? { creditLimit: createForm.creditLimit }
              : {}),
          }
        : {}),
    }) as { nickname?: string; username?: string; password?: string }
    createVisible.value = false
    createdCreds.value = {
      nickname: res.nickname || createForm.nickname.trim() || username,
      username: res.username || username,
      password: res.password || password,
    }
    showCreds.value = true
    /* 总代开的子账号列在「我的子账号」那个 Tab 下 */
    roleFilter.value = createKind.value === 'PROXY' ? 'GENERAL' : createKind.value
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
    const who = roleFilter.value === 'GENERAL' ? '总代' : '总监'
    await ElMessageBox.confirm(`重置${who}「${row.nickname}」密码？旧登录将失效。`, '重置密码', {
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
    const who = roleFilter.value === 'GENERAL' ? '总代' : '总监'
    await ElMessageBox.confirm(`确认${label}${who}「${row.nickname}」？`, `${label}${who}`, {
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

function openFund(row: Row, mode: 'up' | 'down') {
  if (row.status !== 'ACTIVE') {
    ElMessage.warning('账号已停用，请先启用')
    return
  }
  fundTarget.value = row
  fundMode.value = mode
  fundAmount.value = 10000
  fundVisible.value = true
}
async function doFund() {
  const row = fundTarget.value
  const amount = Number(fundAmount.value)
  if (!row || !(amount > 0)) return
  const orderNo = newFundOrderNo(fundMode.value)
  try {
    await ElMessageBox.confirm(
      `确认给总代「${row.nickname}」${fundMode.value === 'up' ? '上分' : '下分回收'} ${formatMoney(amount)}？订单号 ${orderNo}`,
      fundMode.value === 'up' ? '总代上分' : '总代下分',
      { type: fundMode.value === 'up' ? 'info' : 'warning' },
    )
  } catch {
    return
  }
  fundBusy.value = true
  try {
    if (fundMode.value === 'up') await consoleApi.issue(row.id, amount, orderNo)
    else await consoleApi.recall(row.id, amount, orderNo)
    ElMessage.success(fundMode.value === 'up' ? '已上分' : '已下分回收')
    fundVisible.value = false
    await load()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '操作失败')
  } finally {
    fundBusy.value = false
  }
}

onMounted(() => {
  roleFilter.value = 'GENERAL'
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
.chain-summary {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
.count-line {
  font-size: 13px;
  color: #334155;
  font-variant-numeric: tabular-nums;
}
.chain-table :deep(.is-group td) {
  background: #f8fafc !important;
}
.chain-table :deep(.el-table__body .el-table__row > td) {
  border-bottom: 8px solid #e8edf3 !important;
}
.chain-table :deep(.el-table__row--level-1 > td:first-child) {
  border-left: 22px solid #e8edf3 !important;
}
.chain-table :deep(.el-table__row--level-2 > td:first-child) {
  border-left: 44px solid #e8edf3 !important;
}
.chain-table :deep(.el-table__row--level-3 > td:first-child) {
  border-left: 66px solid #e8edf3 !important;
}
.chain-table :deep(.is-general td) {
  background: #e8eef6 !important;
  font-weight: 650;
}
.chain-table :deep(.is-child td) {
  background: #f0f7ff !important;
}
.chain-table :deep(.is-child td:first-child) {
  box-shadow: inset 3px 0 0 #38bdf8;
}
.chain-table :deep(.is-leaf td) {
  background: #f5f3ff !important;
}
.chain-table :deep(.is-leaf td:first-child) {
  box-shadow: inset 3px 0 0 #8b5cf6;
}
.chain-table :deep(.is-child .cell-name),
.chain-table :deep(.is-leaf .cell-name) {
  font-size: 13px;
  font-weight: 600;
}
.chain-table :deep(.is-child:hover td) {
  background: #e0f2fe !important;
}
.chain-table :deep(.is-leaf:hover td) {
  background: #ede9fe !important;
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
.sum-chip.clickable { cursor: pointer; }
.sum-chip.clickable:hover { background: #eff6ff; }
.sum-chip.active { background: #eff6ff; }
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
.agents-hint--warn {
  color: #b45309;
  background: rgba(245, 158, 11, 0.08);
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
.agents-table :deep(.el-table__row) { cursor: default; }
.agents-table :deep(.el-table__expand-icon) { cursor: pointer; }
.chain-table :deep(.is-fold) { cursor: pointer; }
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
/* 额度发超了不是错误状态，只是欠着，用暖色提示而非报警红 */
.over-issue { color: #d97706; font-weight: 600; }
.fund-tip-text {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
}
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
.unit-hint {
  margin-left: 8px;
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
}

/* 可见总监：勾选框换行排布，说明文字要能折行 */
.grant-pick {
  width: 100%;
}
.grant-pick :deep(.el-checkbox-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}
.grant-tip {
  margin: 6px 0 0;
  margin-left: 0;
  line-height: 1.6;
  white-space: normal;
}
</style>
