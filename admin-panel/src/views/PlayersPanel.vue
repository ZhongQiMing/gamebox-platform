<template>
  <div class="players-panel">
    <div class="panel-toolbar">
      <el-input
        v-model="q"
        placeholder="搜登录账号 / 昵称 / UID"
        clearable
        size="small"
        class="filter-search"
        @keyup.enter="load"
      />
      <el-button type="primary" size="small" @click="load">查询</el-button>
    </div>

    <div class="panel-body">
      <el-table
        :data="list"
        v-loading="loading"
        class="players-table"
        stripe
        border
        size="small"
        height="100%"
        empty-text="暂无玩家"
      >
        <el-table-column prop="uid" label="UID" min-width="120" class-name="col-block">
          <template #default="{ row }: { row: any }">
            <div class="cell-block">
              <span class="mono">{{ row.uid }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="登录账号" min-width="140" class-name="col-block">
          <template #default="{ row }: { row: any }">
            <div class="cell-block">
              <span class="mono">{{ row.username || '—' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="nickname" label="昵称" min-width="120" class-name="col-block">
          <template #default="{ row }: { row: any }">
            <div class="cell-block">
              <span class="nick">{{ row.nickname || '—' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="余额" min-width="110" class-name="col-block">
          <template #default="{ row }: { row: any }">
            <div class="cell-block">
              <span class="bal">{{ fmt(row.balance) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="最近 IP" min-width="128" class-name="col-block">
          <template #default="{ row }: { row: any }">
            <div class="cell-block">
              <span class="mono ip-cell" :title="row.lastLoginIp || ''">{{ row.lastLoginIp || '—' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="飞盘"
          min-width="80"
          class-name="col-block"
        >
          <template #default="{ row }: { row: any }">
            <div class="cell-block">
              <div
                class="fly-pill"
                :class="row.flyEnabled ? 'on' : 'off'"
                :title="row.flyEnabled ? '跟平台飞盘' : (isCreditBook ? '跟代理·关盘' : '关盘·只动玩家分')"
              >
                {{ row.flyEnabled ? '开' : '关' }}
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="回水" min-width="96" class-name="col-block">
          <template #default="{ row }: { row: any }">
            <div class="cell-block">
              <button
                v-if="canWritePlayer"
                type="button"
                class="rebate-cell"
                :class="{ custom: row.playerRebateRate != null }"
                @click="editRebate(row)"
              >
                {{ rebateCellText(row.playerRebateRate) }}
              </button>
              <span
                v-else
                class="rebate-cell static"
                :class="{ custom: row.playerRebateRate != null }"
              >{{ rebateCellText(row.playerRebateRate) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="上级" min-width="100" class-name="col-block">
          <template #default="{ row }: { row: any }">
            <div class="cell-block">
              <span
                v-if="row.parent"
                class="hang-name"
                :title="`UID ${row.parent.uid}`"
              >{{ row.parent.nickname || row.parent.uid }}</span>
              <span v-else class="muted">—</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="下级" min-width="72" class-name="col-block">
          <template #default="{ row }: { row: any }">
            <div class="cell-block">
              <span class="hang-count" :class="{ strong: (row.childCount || 0) > 0 }">
                {{ row.childCount || 0 }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="88" class-name="col-block">
          <template #default="{ row }: { row: any }">
            <div class="cell-block">
              <el-tag
                v-if="row.loginLocked"
                type="danger"
                size="small"
                effect="plain"
              >冻结</el-tag>
              <el-tag
                v-else
                :type="row.status === 'ACTIVE' ? 'success' : 'info'"
                size="small"
                effect="plain"
              >{{ statusLabel(row.status) }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" min-width="240" class-name="col-block col-ops">
          <template #default="{ row }: { row: any }">
            <div class="cell-block">
              <div class="row-ops">
                <el-button link type="primary" @click="openDetail(row)">详情</el-button>
                <el-button v-if="canFundPlayer" link type="primary" @click="openCredit(row)">上分</el-button>
                <el-button v-if="canFundPlayer" link type="warning" @click="openDebit(row)">下分</el-button>
                <el-button
                  v-if="canResetPlayerPwd"
                  link
                  type="warning"
                  @click="onResetPlayerPwd(row)"
                >重置密码</el-button>
                <el-dropdown
                  v-if="canWritePlayer || canHang"
                  trigger="click"
                  @command="(cmd: string) => onMoreCommand(cmd, row)"
                >
                  <el-button link class="more-btn">更多</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-if="canHang" command="hang">挂靠下级</el-dropdown-item>
                      <el-dropdown-item v-if="canWritePlayer" command="fly">
                        {{ row.flyEnabled ? '关闭飞盘（关盘）' : '开启飞盘' }}
                      </el-dropdown-item>
                      <el-dropdown-item v-if="canWritePlayer" command="rebate">设置回水</el-dropdown-item>
                      <el-dropdown-item
                        v-if="canWritePlayer && row.status !== 'CLOSED'"
                        command="status"
                        divided
                        :class="row.status === 'ACTIVE' ? 'danger-item' : ''"
                      >
                        {{ row.status === 'ACTIVE' ? '停用玩家' : '启用玩家' }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="panel-foot">
      <el-pagination
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        layout="total, prev, pager, next"
        background
        small
        @current-change="(p: number) => { page = p; load() }"
      />
    </div>

    <DeskDialog v-model="dlg" :title="dlgTitle" width="440px">
      <el-form label-position="top">
        <el-form-item label="订单号">
          <el-input :model-value="clientRequestId" readonly />
        </el-form-item>
        <el-form-item label="金额" required>
          <el-input-number
            v-model="amount"
            :min="mode === 'up' ? PLAYER_UP_MIN : PLAYER_DOWN_MIN"
            :max="PLAYER_FUND_MAX"
            :precision="0"
            style="width:100%"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="remark" maxlength="40" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="saving" @click="submitMoney">
          {{ mode === 'up' ? '确认上分' : '确认下分' }}
        </el-button>
      </template>
    </DeskDialog>

    <DeskDialog v-model="pwdCredsVisible" title="新密码（请立即告知玩家）" width="420px">
      <div v-if="pwdCreds" class="pwd-creds">
        <div><span class="k">昵称</span>{{ pwdCreds.nickname }}</div>
        <div><span class="k">账号</span><code>{{ pwdCreds.username }}</code></div>
        <div><span class="k">新密码</span><code class="pwd">{{ pwdCreds.password }}</code></div>
        <p class="hint">关闭后将无法再次查看，请先复制保存。</p>
      </div>
      <template #footer>
        <el-button
          type="primary"
          @click="copyPwdCreds"
        >复制账号密码</el-button>
        <el-button @click="pwdCredsVisible = false">关闭</el-button>
      </template>
    </DeskDialog>

    <DeskDialog
      v-model="rebateDlg"
      title="设置玩家回水"
      width="460px"
      dialog-class="rebate-dlg"
    >
      <div class="rb-player">
        <div class="rb-name">{{ rebateTarget?.nickname || '—' }}</div>
        <div class="rb-meta">
          <span v-if="rebateTarget?.uid">UID {{ rebateTarget.uid }}</span>
          <span v-if="rebateTarget?.username">{{ rebateTarget.username }}</span>
        </div>
      </div>

      <div class="rb-metrics">
        <div class="rb-card">
          <div class="rb-k">代理整包 T</div>
          <div class="rb-v">{{ pctText(rebateTotal) }}%</div>
        </div>
        <div class="rb-card main">
          <div class="rb-k">玩家 P</div>
          <div class="rb-edit">
            <el-input-number
              v-model="rebatePct"
              :min="rebateMinPct"
              :max="rebateMaxPct"
              :step="0.1"
              :precision="2"
              controls-position="right"
              size="default"
            />
            <span class="rb-unit">%</span>
          </div>
          <div class="rb-range">允许 {{ rebateMinPct }}% ~ {{ rebateMaxPct }}%</div>
        </div>
        <div class="rb-card">
          <div class="rb-k">代理 A</div>
          <div class="rb-v gold">{{ agentSharePct }}%</div>
        </div>
      </div>

      <div class="rb-bar" aria-hidden="true">
        <div class="rb-bar-p" :style="{ width: playerBarWidth }" />
        <div class="rb-bar-a" :style="{ width: agentBarWidth }" />
      </div>
      <div class="rb-legend">
        <span><i class="dot p" />玩家 {{ Number(rebatePct || 0).toFixed(2) }}%</span>
        <span><i class="dot a" />代理 {{ agentSharePct }}%</span>
      </div>

      <div class="rb-example">
        <span class="rb-ex-label">举例（流水 10,000）</span>
        <span>玩家 <b>{{ examplePlayer }}</b></span>
        <span>代理 <b>{{ exampleAgent }}</b></span>
      </div>

      <template #footer>
        <el-button @click="rebateDlg = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="rebateSaving" @click="submitRebate">保存</el-button>
      </template>
    </DeskDialog>

    <!-- 玩家详情：资料 + 注单 -->
    <el-drawer
      v-model="detailOpen"
      class="desk-drawer"
      :title="detail?.nickname ? `玩家 · ${detail.nickname}` : '玩家详情'"
      size="560px"
      destroy-on-close
      @closed="onDetailClosed"
    >
      <div v-loading="detailLoading" class="detail-body">
        <el-tabs v-model="detailTab" @tab-change="onDetailTabChange">
          <el-tab-pane label="资料" name="info">
            <template v-if="detail">
              <div class="kv-grid">
                <div class="kv"><span class="k">UID</span><span class="v mono">{{ detail.uid }}</span></div>
                <div class="kv"><span class="k">账号</span><span class="v">{{ detail.username || '—' }}</span></div>
                <div class="kv"><span class="k">余额</span><span class="v">{{ fmt(detail.balance) }}</span></div>
                <div class="kv">
                  <span class="k">状态</span>
                  <span class="v">{{ statusLabel(detail.status) }}</span>
                </div>
                <div class="kv">
                  <span class="k">最近 IP</span>
                  <span class="v mono">{{ detail.lastLoginIp || '—' }}</span>
                </div>
                <div class="kv">
                  <span class="k">最近登录</span>
                  <span class="v">{{ detail.lastLoginAt ? fmtDt(detail.lastLoginAt) : '—' }}</span>
                </div>
                <div class="kv">
                  <span class="k">飞盘</span>
                  <span class="v">{{ detail.flyEnabled ? '已开（跟平台）' : (isCreditBook ? '已关（跟代理）' : '已关（只动玩家分）') }}</span>
                </div>
                <div class="kv">
                  <span class="k">回水</span>
                  <span class="v">
                    {{
                      detail.playerRebateRate != null
                        ? `${pctText(detail.playerRebateRate)}%`
                        : '默认'
                    }}
                  </span>
                </div>
                <div class="kv">
                  <span class="k">上级</span>
                  <span class="v">
                    <template v-if="detail.parent">
                      {{ detail.parent.nickname }}
                      <span class="sub">UID {{ detail.parent.uid }}</span>
                    </template>
                    <template v-else>—</template>
                  </span>
                </div>
                <div class="kv">
                  <span class="k">房间</span>
                  <span class="v">
                    {{ detail.room ? `${detail.room.name}（${detail.room.roomNo}）` : '—' }}
                  </span>
                </div>
              </div>

              <div class="sec-hd">直属下级（{{ detail.childCount }}）</div>
              <el-table
                v-if="detail.children.length"
                :data="detail.children"
                size="small"
                stripe
                empty-text="暂无下级"
              >
                <el-table-column prop="uid" label="UID" width="110" />
                <el-table-column prop="nickname" label="昵称" min-width="90" />
                <el-table-column label="余额" width="100">
                  <template #default="{ row }: { row: any }">{{ fmt(row.balance) }}</template>
                </el-table-column>
                <el-table-column label="状态" width="72">
                  <template #default="{ row }: { row: any }">
                    {{ statusLabel(row.status) }}
                  </template>
                </el-table-column>
              </el-table>
              <div v-else class="empty-soft">暂无挂靠下级</div>
            </template>
          </el-tab-pane>

          <el-tab-pane label="注单" name="bets">
            <div class="bet-toolbar">
              <el-radio-group v-model="betRange" size="small" @change="onBetRangeChange">
                <el-radio-button label="today">今日</el-radio-button>
                <el-radio-button label="yesterday">昨日</el-radio-button>
                <el-radio-button label="thisweek">本周</el-radio-button>
              </el-radio-group>
              <el-button size="small" :loading="betLoading" @click="loadBets">刷新</el-button>
            </div>
            <el-table
              :data="betRows"
              v-loading="betLoading"
              size="small"
              stripe
              empty-text="该时段暂无注单"
            >
              <el-table-column prop="betNo" label="单号" min-width="120" show-overflow-tooltip />
              <el-table-column label="游戏" min-width="88">
                <template #default="{ row }: { row: any }">{{ row.gameName || gameLabel(row.gameCode) }}</template>
              </el-table-column>
              <el-table-column label="投注" width="88">
                <template #default="{ row }: { row: any }">{{ fmt(row.amount) }}</template>
              </el-table-column>
              <el-table-column label="派彩" width="88">
                <template #default="{ row }: { row: any }">{{ fmt(row.payout) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="72">
                <template #default="{ row }: { row: any }">
                  <el-tag size="small" :type="betStatusType(row.status)" effect="plain">
                    {{ betStatusLabel(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="时间" width="140">
                <template #default="{ row }: { row: any }">{{ fmtDt(row.createdAt) }}</template>
              </el-table-column>
            </el-table>
            <el-pagination
              v-if="betTotal > betPageSize"
              class="pager"
              background
              layout="prev, pager, next, total"
              :total="betTotal"
              v-model:current-page="betPage"
              :page-size="betPageSize"
              @current-change="loadBets"
            />
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-drawer>

    <!-- 挂靠下级：把某人挂到当前玩家名下 -->
    <DeskDialog v-model="hangDlg" title="挂靠下级" width="440px">
      <el-form label-position="top">
        <el-form-item label="推荐人（当前玩家）">
          <el-input :model-value="hangUnder?.uid || ''" disabled />
        </el-form-item>
        <el-form-item label="下级玩家 UID" required>
          <el-input
            v-model="hangFriendUid"
            maxlength="12"
            placeholder="输入要挂靠的本房玩家 UID"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="hangDlg = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="hangSaving" @click="submitHang">确认挂靠</el-button>
      </template>
    </DeskDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { formatMoney, isGeneralSide, PLAYER_DOWN_MIN, PLAYER_FUND_MAX, PLAYER_UP_MIN } from '@gamebox/shared'
import DeskDialog from '@/components/DeskDialog.vue'
import {
  consoleApi,
  type PlayerDetail,
  type PlayerParentBrief,
  type ReportRoomBetRow,
} from '@/api/console'
import { useAdminStore } from '@/stores/admin'
import { gameLabel } from '@/utils/labels'
import { newFundOrderNo } from '@/utils/fundOrderNo'

const props = defineProps<{
  roomId?: string
  initialQ?: string
  /** CASH | CREDIT；CREDIT 保留飞盘开关（对手盘），上分改为扣信用 */
  bookMode?: 'CASH' | 'CREDIT' | string
  /** 本房代理流水整包；玩家回水上限＝它的一半，与发放口径一致 */
  agentFlowRate?: number | null
}>()
const store = useAdminStore()
const isCreditBook = computed(() => props.bookMode === 'CREDIT')
const canWritePlayer = computed(() => store.profile?.role === 'AGENT')
const canHang = computed(() => store.profile?.role === 'AGENT')
const canFundPlayer = computed(() => store.profile?.role === 'AGENT')
/** 管理/总监全部可见玩家；总代（含分身）仅名下房间 */
const canResetPlayerPwd = computed(() => {
  const r = store.profile?.role
  if (r === 'ADMIN' || r === 'BRANCH') return true
  return isGeneralSide(r, store.profile?.parentRole)
})

const q = ref(props.initialQ ?? '')

watch(
  () => props.initialQ,
  (v) => {
    if (v != null && v !== q.value) {
      q.value = v
      page.value = 1
      void load()
    }
  },
)
watch(
  () => props.roomId,
  () => {
    page.value = 1
    void load()
  },
)
const list = ref<Array<{
  id: string
  uid: string
  nickname: string
  username: string
  balance: number
  status: string
  loginLocked?: boolean
  lastLoginIp?: string | null
  lastLoginAt?: string | null
  flyEnabled?: boolean
  playerRebateRate?: number | null
  childCount?: number
  parent?: PlayerParentBrief | null
}>>([])
const pwdCredsVisible = ref(false)
const pwdCreds = ref<{ nickname: string; username: string; password: string } | null>(null)
const loading = ref(false)
const page = ref(1)
const pageSize = 20
const total = ref(0)
const dlg = ref(false)
const dlgTitle = ref('')
const amount = ref(PLAYER_UP_MIN)
const remark = ref('')
const saving = ref(false)
const targetId = ref('')
const mode = ref<'up' | 'down'>('up')
const clientRequestId = ref('')

const rebateDlg = ref(false)
const rebateSaving = ref(false)
const rebateTarget = ref<{ id: string; nickname: string; uid?: string; username?: string } | null>(null)
const rebatePct = ref(1.8)
const rebateTotal = ref(0.05)
const rebateMinRate = ref(0.018)
const rebateMaxRate = ref(0.05)

const rebateMinPct = computed(() => Number((rebateMinRate.value * 100).toFixed(2)))
const rebateMaxPct = computed(() => Number((rebateMaxRate.value * 100).toFixed(2)))
const agentSharePct = computed(() => {
  const t = Number((rebateTotal.value * 100).toFixed(2))
  const p = Number(rebatePct.value || 0)
  return Math.max(0, Number((t - p).toFixed(2)))
})
const playerBarWidth = computed(() => {
  const t = rebateTotal.value * 100
  if (!(t > 0)) return '0%'
  return `${Math.min(100, (Number(rebatePct.value || 0) / t) * 100)}%`
})
const agentBarWidth = computed(() => {
  const t = rebateTotal.value * 100
  if (!(t > 0)) return '0%'
  return `${Math.min(100, (agentSharePct.value / t) * 100)}%`
})
const examplePlayer = computed(() =>
  formatMoney(10000 * Number(rebatePct.value || 0) / 100),
)
const exampleAgent = computed(() =>
  formatMoney(10000 * agentSharePct.value / 100),
)

function fmt(n: number) {
  return formatMoney(n)
}
function pctText(rate: number) {
  return Number((rate * 100).toFixed(2))
}

function rebateCellText(rate?: number | null) {
  if (rate == null) return '默认'
  return `${pctText(rate)}%`
}

async function load() {
  loading.value = true
  try {
    const res = await consoleApi.players({
      page: page.value,
      pageSize,
      q: q.value || undefined,
      roomId: props.roomId,
    })
    list.value = res.list
    total.value = res.total
  } catch (e: unknown) {
    list.value = []
    total.value = 0
    ElMessage.error((e as Error)?.message || '加载玩家失败')
  } finally {
    loading.value = false
  }
}

function openCredit(row: { id: string; nickname: string }) {
  targetId.value = row.id
  mode.value = 'up'
  dlgTitle.value = `上分 → ${row.nickname}`
  amount.value = PLAYER_UP_MIN
  remark.value = ''
  clientRequestId.value = newFundOrderNo('up')
  dlg.value = true
}
function openDebit(row: { id: string; nickname: string }) {
  targetId.value = row.id
  mode.value = 'down'
  dlgTitle.value = `下分 ← ${row.nickname}`
  amount.value = PLAYER_DOWN_MIN
  remark.value = ''
  clientRequestId.value = newFundOrderNo('down')
  dlg.value = true
}

async function submitMoney() {
  if (!(amount.value > 0)) return ElMessage.warning('请填写金额')
  if (mode.value === 'up') {
    if (amount.value < PLAYER_UP_MIN) return ElMessage.warning(`上分最低 ${PLAYER_UP_MIN}`)
    if (amount.value > PLAYER_FUND_MAX) return ElMessage.warning(`单笔上分不超过 ${PLAYER_FUND_MAX}`)
  } else {
    if (amount.value < PLAYER_DOWN_MIN) return ElMessage.warning(`下分最低 ${PLAYER_DOWN_MIN}`)
    if (amount.value > PLAYER_FUND_MAX) return ElMessage.warning(`单笔下分不超过 ${PLAYER_FUND_MAX}`)
  }
  const dir = mode.value === 'up' ? '上分' : '下分'
  try {
    await ElMessageBox.confirm(
      `是否确认给该玩家${dir} ${fmt(amount.value)}？`,
      `${dir}确认`,
      { type: 'warning', confirmButtonText: `确认${dir}`, cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  saving.value = true
  try {
    const rid = String(clientRequestId.value || '').trim()
    if (rid.length < 8) {
      ElMessage.error('订单号无效，请关闭后重新打开上下分')
      return
    }
    const roomId = String(props.roomId || '').trim()
    if (!roomId) {
      ElMessage.error('请先选择房间再上下分')
      return
    }
    if (mode.value === 'up') {
      const res = await consoleApi.creditPlayer(
        targetId.value,
        amount.value,
        roomId,
        remark.value || undefined,
        rid,
      )
      const real = Number(res?.real ?? amount.value)
      const orderTip = res?.orderNo || rid
      if (isCreditBook.value) {
        ElMessage.success(`上分成功 · 订单 ${orderTip} · 已扣剩余信用 ${fmt(real || amount.value)}`)
      } else {
        ElMessage.success(`上分成功 · 订单 ${orderTip} · 已扣上盘额度 ${fmt(real || amount.value)}`)
      }
    } else {
      const res = await consoleApi.debitPlayer(
        targetId.value,
        amount.value,
        roomId,
        remark.value || undefined,
        rid,
      )
      ElMessage.success(`下分成功 · 订单 ${res?.orderNo || rid}`)
    }
    dlg.value = false
    await load()
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as { message?: string })?.message
    if (msg) ElMessage.error(msg)
  } finally {
    saving.value = false
  }
}

/** CLOSED 是玩家自助注销，与运营停用不是一回事，必须分开显示 */
function statusLabel(status?: string): string {
  if (status === 'ACTIVE') return '正常'
  if (status === 'CLOSED') return '已注销'
  return '停用'
}

/**
 * 停用会把玩家直接踢下线，跟改昵称不是一个量级，所以要二次确认；
 * statusBusy 防连点——菜单项没有 loading 态，重复请求会连着刷两次列表。
 */
const statusBusy = ref(false)

async function toggleStatus(row: { id: string; status: string; nickname?: string }) {
  if (row.status === 'CLOSED') {
    ElMessage.warning('该账号已由玩家注销，不能再改状态')
    return
  }
  if (statusBusy.value) return
  const next = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  const who = row.nickname ? `「${row.nickname}」` : '该玩家'
  try {
    await ElMessageBox.confirm(
      next === 'DISABLED'
        ? `停用后${who}将无法登录，已在游戏中的会被踢下线。确认停用？`
        : `确认恢复${who}的登录权限？`,
      next === 'DISABLED' ? '停用玩家' : '启用玩家',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  statusBusy.value = true
  try {
    await consoleApi.setPlayerStatus(row.id, next)
    ElMessage.success('已更新')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
  } finally {
    statusBusy.value = false
  }
}

async function onResetPlayerPwd(row: { id: string; nickname: string; username: string; loginLocked?: boolean }) {
  try {
    await ElMessageBox.confirm(
      row.loginLocked
        ? `玩家「${row.nickname}」已冻结。重置密码后将解冻并可重新登录，旧登录失效。`
        : `重置玩家「${row.nickname}」密码？旧登录将失效；若曾冻结也会一并解冻。`,
      '重置密码',
      { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    const res = await consoleApi.resetPlayerPassword(row.id)
    pwdCreds.value = {
      nickname: row.nickname,
      username: res.username || row.username,
      password: res.password,
    }
    pwdCredsVisible.value = true
    ElMessage.success(res.message || '密码已重置')
    await load()
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as { message?: string })?.message
    if (msg) ElMessage.error(msg)
  }
}

async function copyPwdCreds() {
  if (!pwdCreds.value) return
  const text = `账号：${pwdCreds.value.username}\n密码：${pwdCreds.value.password}`
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

async function toggleFly(row: {
  id: string
  nickname: string
  flyEnabled?: boolean
}) {
  const nowOn = row.flyEnabled !== false
  const nextOn = !nowOn
  try {
    await ElMessageBox.confirm(
      nowOn
        ? (isCreditBook.value
          ? `关闭「${row.nickname}」的飞盘后：输赢跟你（代理）结算，不再进平台占成。信用上分欠款每周不冲。`
          : `关闭「${row.nickname}」的飞盘后：只改玩家房间分，不动上盘额度，不再进平台盘口。`)
        : (isCreditBook.value
          ? `开启「${row.nickname}」的飞盘后：输赢跟平台结算，结账按飞盘上缴+已发佣金；未结上分每周不冲。`
          : `开启「${row.nickname}」的飞盘后：上盘额度充足时跟平台结算；额度耗尽则软关盘。`),
      nowOn ? '关闭飞盘' : '开启飞盘',
      {
        type: 'warning',
        confirmButtonText: nowOn ? '确认关闭' : '确认开启',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }
  try {
    await consoleApi.setPlayerFly(row.id, nextOn, props.roomId)
    ElMessage.success(
      nextOn
        ? '已开启飞盘（跟平台）'
        : (isCreditBook.value ? '已关闭飞盘（跟代理）' : '已关闭飞盘（只动玩家分）'),
    )
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '操作失败',
    )
  }
}

async function editRebate(row: {
  id: string
  nickname: string
  uid?: string
  username?: string
  playerRebateRate?: number | null
}) {
  rebateTarget.value = row
  const roomFlow = Number(props.agentFlowRate)
  try {
    const policy = await consoleApi.rebatePolicy(props.roomId)
    rebateMinRate.value = Number(policy.chain?.effective.playerMin ?? policy.playerMinRate ?? 0.018)
    rebateMaxRate.value = Number(policy.chain?.effective.playerMax ?? policy.playerMaxRate ?? 0.05)
    rebateTotal.value = Number.isFinite(roomFlow) && roomFlow > 0
      ? roomFlow
      : Number(policy.chain?.effective.agentPkg ?? policy.agentDefaultRate ?? 0.05)
  } catch {
    /*
     * 拿不到回水政策就不能猜上限：以前退回「代理整包」，
     * 而整包（如 5%）通常高于玩家上限（如 3%），弹窗会放你填一个后端必拒的数。
     * 与其让人填完再被打回，不如直接说清楚拉取失败。
     */
    ElMessage.error('回水政策拉取失败，暂时不能改玩家回水，请刷新后重试')
    return
  }
  rebatePct.value = row.playerRebateRate != null
    ? Number((row.playerRebateRate * 100).toFixed(2))
    : rebateMinPct.value
  rebateDlg.value = true
}

async function submitRebate() {
  if (!rebateTarget.value) return
  const pct = Number(rebatePct.value)
  if (Number.isNaN(pct)) return ElMessage.warning('请填写玩家回水')
  if (pct < rebateMinPct.value || pct > rebateMaxPct.value) {
    return ElMessage.warning(`玩家回水须在 ${rebateMinPct.value}% ~ ${rebateMaxPct.value}%`)
  }
  try {
    await ElMessageBox.confirm(
      `确认把「${rebateTarget.value.nickname || rebateTarget.value.uid}」的回水改成 ${pct}%？改完之后的流水按新比例算。`,
      '修改玩家回水',
      { type: 'warning', confirmButtonText: '保存', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  rebateSaving.value = true
  try {
    await consoleApi.setPlayerRebateRate(rebateTarget.value.id, pct / 100, props.roomId)
    ElMessage.success('已保存玩家回水')
    rebateDlg.value = false
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '保存失败',
    )
  } finally {
    rebateSaving.value = false
  }
}

const detailOpen = ref(false)
const detailLoading = ref(false)
const detailTab = ref('info')
const detail = ref<PlayerDetail | null>(null)
const betRange = ref('today')
const betLoading = ref(false)
const betRows = ref<ReportRoomBetRow[]>([])
const betTotal = ref(0)
const betPage = ref(1)
const betPageSize = 20
const betLoadedOnce = ref(false)

const hangDlg = ref(false)
const hangSaving = ref(false)
const hangFriendUid = ref('')
const hangUnder = ref<{ id: string; uid: string; nickname: string } | null>(null)

function fmtDt(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function betStatusLabel(s?: string) {
  if (s === 'WON') return '赢'
  if (s === 'LOST') return '输'
  if (s === 'PENDING' || s === 'OPEN') return '待结算'
  if (s === 'CANCELLED' || s === 'VOID') return '取消'
  return s || '—'
}

function betStatusType(s?: string): 'success' | 'danger' | 'info' | 'warning' {
  if (s === 'WON') return 'success'
  if (s === 'LOST') return 'danger'
  if (s === 'PENDING' || s === 'OPEN') return 'warning'
  return 'info'
}

async function openDetail(row: { id: string }) {
  detailOpen.value = true
  detailTab.value = 'info'
  detailLoading.value = true
  detail.value = null
  betRows.value = []
  betTotal.value = 0
  betPage.value = 1
  betLoadedOnce.value = false
  try {
    detail.value = await consoleApi.playerDetail(row.id, { roomId: props.roomId })
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '加载详情失败',
    )
    detailOpen.value = false
  } finally {
    detailLoading.value = false
  }
}

function onDetailClosed() {
  detail.value = null
  betRows.value = []
  betLoadedOnce.value = false
}

function onDetailTabChange(name: string | number) {
  if (name === 'bets' && !betLoadedOnce.value) {
    void loadBets()
  }
}

function onBetRangeChange() {
  betPage.value = 1
  void loadBets()
}

async function loadBets() {
  const d = detail.value
  if (!d) return
  const roomId = props.roomId || d.roomId
  if (!roomId) {
    ElMessage.warning('该玩家未绑定房间，无法查注单')
    return
  }
  betLoading.value = true
  try {
    const res = await consoleApi.reportRoomBets({
      roomId,
      playerId: d.id,
      range: betRange.value,
      page: betPage.value,
      pageSize: betPageSize,
    })
    betRows.value = res.list
    betTotal.value = res.total
    betLoadedOnce.value = true
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '加载注单失败',
    )
  } finally {
    betLoading.value = false
  }
}

function openHang(row: { id: string; uid: string; nickname: string }) {
  hangUnder.value = row
  hangFriendUid.value = ''
  hangDlg.value = true
}

function onMoreCommand(
  cmd: string,
  row: {
    id: string
    uid: string
    nickname: string
    username?: string
    status: string
    flyEnabled?: boolean
    playerRebateRate?: number | null
  },
) {
  if (cmd === 'hang') openHang(row)
  else if (cmd === 'fly') void toggleFly(row)
  else if (cmd === 'rebate') void editRebate(row)
  else if (cmd === 'status') void toggleStatus(row)
}

async function submitHang() {
  if (!hangUnder.value) return
  const roomId = String(props.roomId || '').trim()
  if (!roomId) return ElMessage.warning('请先选择房间再挂靠（挂靠按房间隔离）')
  const friendUid = hangFriendUid.value.trim()
  if (!friendUid) return ElMessage.warning('请填写下级玩家 UID')
  if (friendUid === hangUnder.value.uid) {
    return ElMessage.warning('下级与推荐人不能相同')
  }
  try {
    await ElMessageBox.confirm(
      `确认在本房将 UID ${friendUid} 挂到 ${hangUnder.value.nickname}（${hangUnder.value.uid}）名下？`,
      '确认挂靠',
      { type: 'warning', confirmButtonText: '确认挂靠', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  hangSaving.value = true
  try {
    const res = await consoleApi.hangPlayer(friendUid, hangUnder.value.uid, roomId)
    ElMessage.success(res.message || '挂靠成功')
    hangDlg.value = false
    await load()
    if (detailOpen.value && detail.value?.id === hangUnder.value.id) {
      detail.value = await consoleApi.playerDetail(hangUnder.value.id, { roomId: props.roomId })
    }
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '挂靠失败',
    )
  } finally {
    hangSaving.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.players-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
.filter-search { width: 220px; }
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
.players-table { width: 100%; }
.panel-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  padding: 10px 14px;
  border-top: 1px solid #e2e8f0;
  background: #fff;
}
.muted { color: #94a3b8 !important; }
.players-table :deep(.el-table .el-table__cell) {
  padding-top: 16px;
  padding-bottom: 16px;
}
.players-table :deep(.el-table .cell) {
  padding-left: 18px;
  padding-right: 18px;
}
/* 每列内容水平居中，多余宽度均匀分给各列 */
.players-table :deep(.col-block .cell) {
  display: flex;
  justify-content: center;
}
.cell-block {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.ip-cell {
  font-size: 12px;
  color: #475569;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: #64748b;
  font-size: 13px;
}
.nick {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
.bal {
  font-size: 15px;
  font-weight: 650;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.fly-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.fly-pill.on {
  background: #f0f9eb;
  color: #67c23a;
  border: 1px solid #c2e7b0;
}
.fly-pill.off {
  background: #f4f4f5;
  color: #64748b;
  border: 1px solid #e2e8f0;
}
.hang-name {
  font-size: 13px;
  color: #0f172a;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hang-count {
  font-size: 14px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}
.hang-count.strong {
  font-weight: 700;
  color: var(--ops-gold, #f59e0b);
}
.rebate-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  height: 26px;
  padding: 0 12px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #f5f7fa;
  color: #64748b;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  cursor: default;
}
button.rebate-cell {
  cursor: pointer;
  font: inherit;
}
button.rebate-cell:hover {
  border-color: #c6e2ff;
  background: #ecf5ff;
  color: #409eff;
}
.rebate-cell.custom {
  background: #f0f9eb;
  border-color: #c2e7b0;
  color: #67c23a;
  font-weight: 650;
}
.rebate-cell.static { cursor: default; }
.row-ops {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: nowrap;
}
.more-btn { color: #64748b !important; }
:deep(.danger-item) { color: #f56c6c; }
.detail-body { min-height: 240px; }
.kv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
  margin-bottom: 16px;
}
.kv .k {
  display: block;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 2px;
}
.kv .v {
  font-size: 14px;
  color: #0f172a;
  word-break: break-all;
}
.kv .v .sub {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #a8abb2;
}
.kv .mono { font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.sec-hd {
  margin: 4px 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.empty-soft {
  padding: 16px 0;
  font-size: 13px;
  color: #a8abb2;
  text-align: center;
}
.bet-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.hang-tip {
  margin: 0 0 14px;
  font-size: 13px;
  color: #64748b;
  line-height: 1.55;
}
.hang-tip b { color: #0f172a; }
.flow-tip {
  margin-bottom: 14px;
  padding: 10px 12px;
  background: #fafbfc;
  border: 1px solid var(--ops-border-soft, #f0f2f5);
  border-radius: 8px;
  font-size: 12px;
  color: var(--ops-text-2, #606266);
  line-height: 1.55;
}
.flow-title { font-weight: 600; color: #0f172a; margin-bottom: 6px; }
.flow-tip ol { margin: 0; padding-left: 18px; }

.rb-player {
  padding: 12px 14px;
  background: #fafafa;
  border: 1px solid #eef0f3;
  border-radius: 10px;
  margin-bottom: 12px;
}
.rb-name {
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.3;
}
.rb-meta {
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 12px;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}
.rb-tip {
  margin: 0 0 14px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
}
.rb-metrics {
  display: grid;
  grid-template-columns: 1fr 1.4fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
.rb-card {
  padding: 12px;
  background: #fafafa;
  border: 1px solid #eef0f3;
  border-radius: 10px;
  min-width: 0;
}
.rb-card.main {
  background: #fff;
  border-color: #e4e7ed;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.rb-k {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 8px;
}
.rb-v {
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.rb-v.gold { color: var(--ops-gold, #f59e0b); }
.rb-edit {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rb-edit :deep(.el-input-number) { width: 100%; }
.rb-unit {
  font-size: 14px;
  font-weight: 600;
  color: #64748b;
  flex-shrink: 0;
}
.rb-range {
  margin-top: 8px;
  font-size: 11px;
  color: #a8abb2;
}
.rb-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: #f0f2f5;
  margin-bottom: 8px;
}
.rb-bar-p { background: #409eff; }
.rb-bar-a { background: var(--ops-gold, #f59e0b); }
.rb-legend {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 12px;
}
.rb-legend .dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.rb-legend .dot.p { background: #409eff; }
.rb-legend .dot.a { background: var(--ops-gold, #f59e0b); }
.rb-example {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 10px 12px;
  background: #fafbfc;
  border: 1px solid #f0f2f5;
  border-radius: 8px;
  font-size: 12px;
  color: #64748b;
}
.rb-ex-label { color: #64748b; }
.rb-example b {
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 520px) {
  .rb-metrics { grid-template-columns: 1fr; }
}
.pwd-creds {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 14px;
  color: #0f172a;
}
.pwd-creds .k {
  display: inline-block;
  width: 56px;
  color: #64748b;
}
.pwd-creds code {
  font-family: ui-monospace, Consolas, monospace;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 4px;
}
.pwd-creds code.pwd {
  color: #b45309;
  font-weight: 700;
}
.pwd-creds .hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #94a3b8;
}
</style>
