<template>
  <div v-loading="loading" class="room-detail">
    <nav class="room-subnav" aria-label="总代副项">
      <div class="room-subnav-tabs">
        <button
          v-for="t in detailTabs"
          :key="t.key"
          type="button"
          class="room-tab-btn"
          :class="{ active: tab === t.key }"
          @click="setTab(t.key)"
        >
          {{ t.label }}
        </button>
      </div>
      <div class="room-subnav-meta">
        <div class="room-subnav-id">
          <b>{{ detail?.nickname || '总代详情' }}</b>
          <span v-if="detail">{{ detail.username }} · {{ detail.uid }}</span>
        </div>
        <el-button size="small" @click="goBack">{{ backLabel }}</el-button>
        <el-button size="small" @click="goSettle">去结算中心</el-button>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
    </nav>

    <div class="room-page">
      <!-- 基础信息：合同 + 今日汇总 -->
      <div v-show="tab === 'basic'" class="room-page-pane">
        <section v-if="detail" class="basic-info">
          <div class="basic-info-hd">
            <div class="basic-info-title">
              <h2>{{ detail.nickname }}</h2>
            </div>
            <el-tag size="small" :type="detail.status === 'ACTIVE' ? 'success' : 'info'">
              {{ detail.status === 'ACTIVE' ? '正常' : '停用' }}
            </el-tag>
          </div>

          <div class="kv-grid basic-kv">
            <div class="kv">
              <div class="k">登录账号</div>
              <div class="v">{{ detail.username }}</div>
            </div>
            <div class="kv">
              <div class="k">UID</div>
              <div class="v mono">{{ detail.uid }}</div>
            </div>
            <div class="kv">
              <div class="k">盘口 / 占成</div>
              <div class="v">{{ bookBrief }}</div>
            </div>
            <div class="kv">
              <div class="k">流水费率</div>
              <div class="v">{{ pct(detail.flowRate) }}%</div>
            </div>
            <div class="kv">
              <div class="k">结账周期</div>
              <div class="v">{{ settleBrief }}</div>
            </div>
            <div class="kv">
              <div class="k">名下房间</div>
              <div class="v">营业 {{ todayAgg.open }} / {{ todayAgg.total }}</div>
            </div>
            <div class="kv">
              <div class="k">成员合计</div>
              <div class="v">{{ todayAgg.members }}</div>
            </div>
            <div class="kv">
              <div class="k">月费合计</div>
              <div class="v">{{ fmt(todayAgg.monthly) }}</div>
            </div>
            <div class="kv">
              <div class="k">最近登录</div>
              <div class="v">{{ formatDt(detail.lastLoginAt) }}</div>
            </div>
            <div class="kv">
              <div class="k">创建时间</div>
              <div class="v">{{ formatDt(detail.createdAt) }}</div>
            </div>
          </div>

          <div class="basic-quota">
            <div class="basic-quota-hd">
              <span class="basic-quota-title">{{ isCredit ? '总代信用账本' : '总代可用额度' }}</span>
              <div v-if="canFund" class="basic-quota-actions">
                <el-button type="primary" size="small" @click="openFund('up')">上分</el-button>
                <el-button type="warning" size="small" @click="openFund('down')">下分</el-button>
              </div>
            </div>
            <div class="money-strip" :class="{ 'credit-grid': isCredit }">
              <div class="money-card">
                <div class="money-label">{{ isCredit ? '剩余信用' : '可用额度' }}</div>
                <div class="money-val gold">{{ fmt(detail.pointsQuota) }}</div>
              </div>
              <div v-if="isCredit" class="money-card">
                <div class="money-label">合同额度</div>
                <div class="money-val">{{ fmt(detail.creditLimit) }}</div>
              </div>
              <div class="money-card">
                <div class="money-label">今日流水</div>
                <div class="money-val" style="color: var(--desk-accent, #38bdf8)">{{ fmt(todayAgg.betFlow) }}</div>
              </div>
              <div class="money-card">
                <div class="money-label">飞盘</div>
                <div class="money-val" style="color: var(--desk-accent, #38bdf8)">{{ fmt(todayAgg.flown) }}</div>
              </div>
              <div class="money-card">
                <div class="money-label">关盘</div>
                <div class="money-val closed-flow">{{ fmt(todayAgg.closed) }}</div>
              </div>
              <div class="money-card">
                <div class="money-label">今日庄家盈亏</div>
                <div class="money-val" :style="{ color: pnlColor(todayAgg.housePnl) }">{{ fmt(todayAgg.housePnl) }}</div>
              </div>
              <div class="money-card">
                <div class="money-label">今日下注人数</div>
                <div class="money-val">{{ todayAgg.activePlayers }}</div>
              </div>
              <div class="money-card">
                <div class="money-label">平台上分合计</div>
                <div class="money-val gold">{{ fmt(fundSummary?.quotaIn) }}</div>
              </div>
              <div class="money-card">
                <div class="money-label">平台回收合计</div>
                <div class="money-val">{{ fmt(fundSummary?.quotaOut) }}</div>
              </div>
            </div>
          </div>

          <div class="basic-quota">
            <div class="basic-quota-hd">
              <span class="basic-quota-title">可见总监</span>
              <div v-if="isAdmin" class="basic-quota-actions">
                <el-select
                  v-model="grantPick"
                  size="small"
                  placeholder="选择总监授权可见"
                  filterable
                  clearable
                  style="width: 220px"
                >
                  <el-option
                    v-for="b in grantCandidates"
                    :key="b.ownerUserId"
                    :label="`${b.nickname}（${b.uid}）`"
                    :value="b.ownerUserId"
                  />
                </el-select>
                <el-button
                  type="primary"
                  size="small"
                  :disabled="!grantPick"
                  :loading="grantBusy"
                  @click="onGrant"
                >授权可见</el-button>
              </div>
            </div>

            <el-alert type="info" :closable="false" show-icon class="mb12">
              名单里没有的总监，看不到这个总代本人、他名下的房间、代理、玩家，
              也查不到相关报表、结算与实时开奖，更不能把新房挂到他名下。
              <template v-if="!grantRows.length">
                <b>当前一个总监都没授权，只有管理直管。</b>
              </template>
            </el-alert>

            <el-table :data="grantRows" size="small" border empty-text="无（仅管理直管）">
              <el-table-column label="总监" min-width="180">
                <template #default="{ row }">
                  {{ row.nickname }}
                  <span class="muted">（{{ row.uid }}）</span>
                </template>
              </el-table-column>
              <el-table-column label="账号" prop="username" min-width="140" />
              <el-table-column label="状态" width="90" align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.status === 'ACTIVE' ? 'success' : 'info'">
                    {{ row.status === 'ACTIVE' ? '正常' : '停用' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="授权时间" width="170">
                <template #default="{ row }">{{ formatDt(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column v-if="isAdmin" label="操作" width="110" align="center">
                <template #default="{ row }">
                  <el-button
                    size="small"
                    type="danger"
                    plain
                    :loading="grantBusy"
                    @click="onRevoke(row as GeneralOwnerRow)"
                  >取消可见</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </section>
        <div v-else class="empty-box">总代加载中…</div>
      </div>

      <!-- 经营概况：区间汇总 + 分房明细 -->
      <div v-show="tab === 'overview'" class="room-page-pane">
        <div class="ov">
          <div class="ov-toolbar">
            <el-radio-group v-model="rangeKey" size="small" @change="onRangePreset">
              <el-radio-button label="today">今日</el-radio-button>
              <el-radio-button label="yesterday">昨日</el-radio-button>
              <el-radio-button label="thisweek">本周</el-radio-button>
              <el-radio-button label="lastweek">上周</el-radio-button>
              <el-radio-button label="thismonth">本月</el-radio-button>
              <el-radio-button label="custom">自定义</el-radio-button>
            </el-radio-group>
            <el-button
              v-if="rangeKey !== 'custom'"
              size="small"
              :loading="summaryLoading"
              @click="loadSummary"
            >刷新</el-button>
          </div>

          <div v-if="rangeKey === 'custom'" class="ov-custom">
            <div class="ov-custom-row">
              <el-date-picker
                v-model="customRange"
                type="datetimerange"
                unlink-panels
                clearable
                :editable="false"
                range-separator="至"
                start-placeholder="开始时间"
                end-placeholder="结束时间"
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DDTHH:mm:ss+08:00"
                class="ov-custom-picker"
              />
              <el-button type="primary" :loading="summaryLoading" @click="loadSummary">查询</el-button>
            </div>
          </div>

          <div v-if="summary?.range" class="ov-range">
            统计区间（上海时间）
            <b>{{ summary.range.fromText || formatDt(summary.range.from) }}</b>
            ～
            <b>{{ summary.range.toText || formatDt(summary.range.to) }}</b>
            · 名下 {{ roomIds.length }} 间合计
          </div>

          <section class="ov-block">
            <div class="ov-block-hd"><h4>核心指标</h4></div>
            <div class="ov-summary" :style="ovSummaryCols(coreKpis.length)">
              <div v-for="k in coreKpis" :key="k.label" class="sum-chip">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section class="ov-block">
            <div class="ov-block-hd"><h4>资金进出</h4></div>
            <div class="ov-summary" :style="ovSummaryCols(cashKpis.length)">
              <div v-for="k in cashKpis" :key="k.label" class="sum-chip" :class="{ hot: k.hot }">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section class="ov-block">
            <div class="ov-block-hd"><h4>注单概况</h4></div>
            <div class="ov-summary" :style="ovSummaryCols(betKpis.length)">
              <div v-for="k in betKpis" :key="k.label" class="sum-chip">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section class="ov-block">
            <div class="ov-block-hd"><h4>分房明细</h4></div>
            <el-table
              :data="byRoom"
              stripe
              border
              size="small"
              empty-text="该区间名下房间暂无注单"
              show-summary
              :summary-method="roomSummary"
            >
              <el-table-column label="房间" min-width="150">
                <template #default="{ row }: { row: any }">
                  <div>{{ row.name }}</div>
                  <div class="sub">{{ row.roomNo }}</div>
                </template>
              </el-table-column>
              <el-table-column label="代理" min-width="140">
                <template #default="{ row }: { row: any }">
                  <div>{{ row.agentNickname || '—' }}</div>
                  <div class="sub">{{ row.agentUsername || '' }}</div>
                </template>
              </el-table-column>
              <el-table-column prop="memberCount" label="成员" width="64" align="right">
                <template #default="{ row }: { row: any }">{{ row.memberCount }}</template>
              </el-table-column>
              <el-table-column prop="betFlow" label="流水" min-width="100" align="right">
                <template #default="{ row }: { row: any }">{{ fmt(stakeFlow(row)) }}</template>
              </el-table-column>
              <el-table-column v-if="!isAdminOrBranch" prop="flownBetFlow" label="飞盘" min-width="88" align="right">
                <template #default="{ row }: { row: any }">{{ fmt(row.flownBetFlow) }}</template>
              </el-table-column>
              <el-table-column v-if="!isAdminOrBranch" prop="closedBetFlow" label="关盘" min-width="80" align="right">
                <template #default="{ row }: { row: any }">
                  <span class="closed-flow">{{ fmt(row.closedBetFlow) }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="payout" label="派彩" min-width="100" align="right">
                <template #default="{ row }: { row: any }">{{ fmt(row.payout) }}</template>
              </el-table-column>
              <el-table-column prop="housePnl" label="庄家盈亏" min-width="100" align="right">
                <template #default="{ row }: { row: any }">
                  <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="agentShareAmount" label="代理占成" min-width="100" align="right">
                <template #default="{ row }: { row: any }">{{ fmt(row.agentShareAmount) }}</template>
              </el-table-column>
              <!-- 「我的占成」＝各自那份：管理看平台那份，总代看自己的成数差 -->
              <el-table-column prop="platformShareAmount" label="我的占成" min-width="100" align="right">
                <template #default="{ row }: { row: any }">
                  <span :style="{ color: pnlColor(row.platformShareAmount) }">{{ fmt(row.platformShareAmount) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="" width="64">
                <template #default="{ row }: { row: any }">
                  <el-button link type="primary" @click="goRoom(row.roomId)">详情</el-button>
                </template>
              </el-table-column>
            </el-table>
          </section>

          <div class="ov-split ov-split-tables">
            <section class="ov-block ov-pane">
              <div class="ov-pane-hd"><h4>游戏明细</h4></div>
              <div class="ov-pane-body">
                <el-table
                  :data="summary?.byGame || []"
                  stripe
                  size="small"
                  empty-text="该区间暂无注单"
                  class="ov-fit-table"
                  table-layout="fixed"
                >
                  <el-table-column label="游戏" show-overflow-tooltip>
                    <template #default="{ row }: { row: any }">{{ row.gameName || gameLabel(row.gameCode) }}</template>
                  </el-table-column>
                  <el-table-column prop="betCount" label="注单" width="56" align="right" />
                  <el-table-column label="流水" width="88" align="right">
                    <template #default="{ row }: { row: any }">{{ fmt(row.betFlow) }}</template>
                  </el-table-column>
                  <el-table-column label="庄家盈亏" width="88" align="right">
                    <template #default="{ row }: { row: any }">
                      <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </section>

            <section class="ov-block ov-pane">
              <div class="ov-pane-hd"><h4>资金往来</h4></div>
              <div class="ov-pane-body">
                <el-table
                  v-loading="fundLoading"
                  :data="fundRows"
                  stripe
                  size="small"
                  empty-text="该区间暂无往来"
                  class="ov-fit-table"
                  table-layout="fixed"
                >
                  <el-table-column label="时间" width="88">
                    <template #default="{ row }: { row: any }">{{ formatDtShort(row.createdAt) }}</template>
                  </el-table-column>
                  <el-table-column label="动作" min-width="100" show-overflow-tooltip>
                    <template #default="{ row }: { row: any }">{{ row.actionLabel }}</template>
                  </el-table-column>
                  <el-table-column label="金额" width="96" align="right">
                    <template #default="{ row }: { row: any }">
                      <span :class="amountClass(row)">{{ amountText(row) }}</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </section>
          </div>
        </div>
      </div>

      <!-- 名下房间：各房自己的合同与今日数据 -->
      <div v-show="tab === 'rooms'" class="room-page-pane">
        <el-table
          :data="rooms"
          stripe
          border
          size="small"
          empty-text="名下暂无房间"
          class="rooms-in-general"
        >
          <el-table-column label="房间" min-width="160">
            <template #default="{ row }: { row: any }">
              <div>{{ row.name }}</div>
              <div class="sub mono">{{ row.roomNo }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="88">
            <template #default="{ row }: { row: any }">
              <el-tag size="small" :type="roomStatusTagType(row.status)" effect="light">
                {{ roomStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="代理" min-width="128">
            <template #default="{ row }: { row: any }">
              <template v-if="row.agent">
                <div>{{ row.agent.nickname }}</div>
                <div class="sub">{{ row.agent.username }}</div>
              </template>
              <span v-else class="muted">未绑定</span>
            </template>
          </el-table-column>
          <el-table-column label="盘口合同" min-width="160">
            <template #default="{ row }: { row: any }">
              {{ row.bookMode === 'CREDIT' ? 'B · 信用盘' : 'A · 现金盘' }}
              · 占成 {{ sharePct(row) }}%
              · {{ settleShort(row) }}
              <div v-if="row.bookMode === 'CREDIT'" class="sub">合同额度 {{ fmt(row.creditLimit) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="成员" width="72" align="right">
            <template #default="{ row }: { row: any }">{{ row.memberCount }}</template>
          </el-table-column>
          <el-table-column label="今日流水" min-width="120" align="right">
            <template #default="{ row }: { row: any }">
              <div>{{ fmt(row.todayStats?.betFlow) }}</div>
              <div v-if="!isAdminOrBranch" class="sub">
                上台 {{ fmt(row.todayStats?.flownBetFlow) }}
                · <span class="closed-flow">关 {{ fmt(row.todayStats?.closedBetFlow) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="庄家盈亏" min-width="100" align="right">
            <template #default="{ row }: { row: any }">
              <span :style="{ color: pnlColor(row.todayStats?.housePnl) }">{{ fmt(row.todayStats?.housePnl) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="月费" min-width="90">
            <template #default="{ row }: { row: any }">
              <template v-if="row.monthlyFee > 0">{{ Math.floor(row.monthlyFee) }}/月</template>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="" width="72">
            <template #default="{ row }: { row: any }">
              <el-button link type="primary" @click.stop="goRoom(row.id)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-show="tab === 'fund'" class="room-page-pane">
        <el-tabs v-model="auditTab" @tab-change="onAuditTab">
          <el-tab-pane label="额度往来" name="fund" />
          <el-tab-pane label="全部操作" name="ops" />
        </el-tabs>
        <el-table v-loading="auditLoading" :data="auditRows" stripe border size="small" empty-text="暂无记录">
          <el-table-column label="时间" width="156">
            <template #default="{ row }: { row: any }">{{ formatDt(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="动作" min-width="140">
            <template #default="{ row }: { row: any }">{{ row.actionLabel }}</template>
          </el-table-column>
          <el-table-column label="对象" min-width="140">
            <template #default="{ row }: { row: any }">
              <template v-if="row.counterparty">
                <div>{{ row.counterparty.nickname }}</div>
                <div class="sub">{{ row.counterparty.username }}</div>
              </template>
              <span v-else class="muted">—</span>
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
      </div>
    </div>

    <DeskDialog v-model="fundVisible" :title="fundMode === 'up' ? '总代上分' : '总代下分'" width="400px">
      <el-form label-width="72px">
        <el-form-item label="金额">
          <el-input-number v-model="fundAmount" :min="1" :max="10000000" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fundVisible = false">取消</el-button>
        <el-button :type="fundMode === 'up' ? 'primary' : 'warning'" :loading="fundBusy" @click="doFund">
          确认{{ fundMode === 'up' ? '上分' : '下分' }}
        </el-button>
      </template>
    </DeskDialog>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DeskDialog from '@/components/DeskDialog.vue'
import { consoleApi, type AgentAuditRow, type AgentDetail, type ConsoleRoom, type GeneralOwnerRow, type ReportByRoomRow, type ReportSummary } from '@/api/console'
import { formatMoney, formatShanghaiDateTime, formatShanghaiDateTimeShort, formatSignedMoney } from '@gamebox/shared'
import { useAdminStore } from '@/stores/admin'
import {
  CLOSED_FLOW_COLOR,
  gameLabel,
  roomStatusLabel,
  roomStatusTagType,
  type KpiChip,
} from '@/utils/labels'
import { newFundOrderNo } from '@/utils/fundOrderNo'

const route = useRoute()
const router = useRouter()
const store = useAdminStore()

const id = computed(() => String(route.params.id || ''))
const loading = ref(false)
const detail = ref<AgentDetail | null>(null)
const rooms = ref<ConsoleRoom[]>([])
const tab = ref(
  ['basic', 'overview', 'rooms', 'fund'].includes(String(route.query.tab || ''))
    ? String(route.query.tab)
    : 'overview',
)

const detailTabs = [
  { key: 'basic', label: '基础信息' },
  { key: 'overview', label: '经营概况' },
  { key: 'rooms', label: '名下房间' },
  { key: 'fund', label: '资金往来' },
]

const isAdmin = computed(() => store.profile?.role === 'ADMIN')
const isAdminOrBranch = computed(() => {
  const r = store.profile?.role
  return r === 'ADMIN' || r === 'BRANCH'
})

/* ── 可见总监 ── */
const grantRows = ref<GeneralOwnerRow[]>([])
const allBranches = ref<GeneralOwnerRow[]>([])
const grantPick = ref('')
const grantBusy = ref(false)
/** 还没授权的总监才出现在下拉里 */
const grantCandidates = computed(() => {
  const has = new Set(grantRows.value.map((r) => r.ownerUserId))
  return allBranches.value.filter((b) => !has.has(b.ownerUserId))
})

async function loadGrants() {
  const uid = String(route.params.id || '')
  if (!uid) return
  try {
    const res = await consoleApi.generalOwners(uid)
    grantRows.value = res.granted || []
    allBranches.value = res.allBranches || []
  } catch {
    grantRows.value = []
    allBranches.value = []
  }
}

async function onGrant() {
  const uid = String(route.params.id || '')
  if (!uid || !grantPick.value) return
  grantBusy.value = true
  try {
    await consoleApi.setGeneralOwner(uid, grantPick.value, true)
    ElMessage.success('已授权可见')
    grantPick.value = ''
    await loadGrants()
  } catch (e) {
    ElMessage.error((e as Error).message || '授权失败')
  } finally {
    grantBusy.value = false
  }
}

async function onRevoke(row: GeneralOwnerRow) {
  const uid = String(route.params.id || '')
  if (!uid) return
  try {
    await ElMessageBox.confirm(
      `取消后总监「${row.nickname}」将看不到这个总代本人、名下房间、代理与玩家，`
      + '相关报表、结算与实时开奖一并隐藏，也不能再把新房挂到他名下。',
      '取消可见',
      { type: 'warning', confirmButtonText: '确认取消可见', cancelButtonText: '算了' },
    )
  } catch {
    return
  }
  grantBusy.value = true
  try {
    await consoleApi.setGeneralOwner(uid, row.ownerUserId, false)
    ElMessage.success('已取消可见')
    await loadGrants()
  } catch (e) {
    ElMessage.error((e as Error).message || '操作失败')
  } finally {
    grantBusy.value = false
  }
}
const canFund = computed(() =>
  isAdminOrBranch.value
  && detail.value?.role === 'GENERAL'
  && detail.value?.status === 'ACTIVE',
)
const backLabel = computed(() => {
  const from = String(route.query.from || '')
  if (from === 'room') return '返回本房'
  if (from === 'agents') return '返回账号中心'
  return '返回房间中心'
})
const isCredit = computed(() => detail.value?.bookMode === 'CREDIT')

const roomIds = computed(() => rooms.value.map((r) => r.id))

const todayAgg = computed(() => {
  let betFlow = 0
  let flown = 0
  let closed = 0
  let housePnl = 0
  let members = 0
  let activePlayers = 0
  let open = 0
  let monthly = 0
  for (const r of rooms.value) {
    members += Number(r.memberCount || 0)
    monthly += Number(r.monthlyFee || 0)
    if (r.status === 'OPEN') open += 1
    betFlow += Number(r.todayStats?.betFlow || 0)
    flown += Number(r.todayStats?.flownBetFlow || 0)
    closed += Number(r.todayStats?.closedBetFlow || 0)
    housePnl += Number(r.todayStats?.housePnl || 0)
    activePlayers += Number(r.todayStats?.activePlayers || 0)
  }
  return { betFlow, flown, closed, housePnl, members, activePlayers, open, monthly, total: rooms.value.length }
})

const bookBrief = computed(() => {
  const d = detail.value
  if (!d) return '—'
  const mode = d.bookMode === 'CREDIT' ? 'B 信用盘' : 'A 现金盘'
  return `${mode} · 占成 ${pct(d.shareRate)}%`
})
const settleBrief = computed(() => {
  const c = detail.value?.settleCycle
  if (c === 'MONTHLY_15_30' || c === 'MONTHLY_15' || c === 'MONTHLY_30') return '每月 15 号与月末'
  if (c === 'MONTHLY_1') return '每月 1 号'
  return '礼拜一'
})

const rangeKey = ref('today')
const customRange = ref<[string, string] | null>(null)
const summaryLoading = ref(false)
const summary = ref<ReportSummary | null>(null)
const byRoom = ref<ReportByRoomRow[]>([])

const fundLoading = ref(false)
const fundRows = ref<AgentAuditRow[]>([])
const fundSummary = ref<{ quotaIn?: number; quotaOut?: number } | null>(null)

const auditTab = ref<'fund' | 'ops'>('fund')
const auditLoading = ref(false)
const auditRows = ref<AgentAuditRow[]>([])
const auditTotal = ref(0)
const auditPage = ref(1)
const auditPageSize = 20

const fundVisible = ref(false)
const fundBusy = ref(false)
const fundMode = ref<'up' | 'down'>('up')
const fundAmount = ref(10000)

/** 后端按角色算好：平台/总代=占成，代理=庄家盈亏−挂靠支出 */
const netPnl = computed(() => {
  if (summary.value?.netPnl != null) return summary.value.netPnl
  const house = summary.value?.housePnl
  return house == null ? null : Number(house)
})

const coreKpis = computed(() => [
  { label: '净盈亏', value: fmt(netPnl.value), color: pnlColor(netPnl.value) },
  { label: '庄家盈亏', value: fmt(summary.value?.housePnl), color: pnlColor(summary.value?.housePnl) },
  { label: '玩家盈亏', value: fmt(summary.value?.playerPnl), color: pnlColor(summary.value?.playerPnl) },
  { label: '流水', value: fmt(stakeFlow(summary.value)), color: 'var(--desk-accent, #38bdf8)' },
  ...(!isAdminOrBranch.value
    ? [
        { label: '飞盘', value: fmt(displayFlownFlow(summary.value)), color: 'var(--desk-accent, #38bdf8)' },
        { label: '关盘', value: fmt(summary.value?.closedBetFlow), color: CLOSED_FLOW_COLOR },
      ]
    : []),
  { label: '派彩', value: fmt(summary.value?.payout) },
  { label: '挂靠支出', value: fmt(summary.value?.commissionAmount), color: '#f59e0b' },
])

const cashKpis = computed(() => [
  { label: '上分合计', value: fmt(summary.value?.upAmount), color: '#f59e0b' },
  { label: '上分笔数', value: String(summary.value?.upCount ?? '—') },
  { label: '下分合计', value: fmt(summary.value?.downAmount), color: '#f56c6c' },
  { label: '下分笔数', value: String(summary.value?.downCount ?? '—') },
  {
    label: '待审上分',
    value: String(summary.value?.pendingUp ?? '—'),
    color: (summary.value?.pendingUp ?? 0) > 0 ? '#ef4444' : undefined,
    hot: (summary.value?.pendingUp ?? 0) > 0,
  },
  {
    label: '待审下分',
    value: String(summary.value?.pendingDown ?? '—'),
    color: (summary.value?.pendingDown ?? 0) > 0 ? '#d97706' : undefined,
    hot: (summary.value?.pendingDown ?? 0) > 0,
  },
] satisfies KpiChip[])

const betKpis = computed<KpiChip[]>(() => [
  { label: '注单数', value: String(summary.value?.betCount ?? '—') },
  { label: '佣金笔数', value: String(summary.value?.commissionCount ?? '—') },
  { label: '活跃玩家', value: String(summary.value?.activePlayers ?? '—') },
  { label: '房间成员', value: String(todayAgg.value.members) },
])

function setTab(key: string) {
  if (tab.value === key) return
  tab.value = key
  void router.replace({ query: { ...route.query, tab: key } })
}

function goBack() {
  const from = String(route.query.from || '')
  const roomId = String(route.query.roomId || '')
  if (from === 'room' && roomId) {
    router.push({ name: 'room-detail', params: { id: roomId } })
    return
  }
  if (from === 'agents') {
    router.push({ name: 'agents' })
    return
  }
  router.push({ name: 'rooms' })
}
function goSettle() {
  if (!id.value) return
  router.push({ name: 'settle', query: { generalUserId: id.value } })
}
function goRoom(roomId: string) {
  router.push({ name: 'room-detail', params: { id: roomId } })
}

function sharePct(row: ConsoleRoom) {
  return Math.round(Number(row.agentShareRate ?? 0) * 100)
}
function settleShort(row: ConsoleRoom) {
  if (row.settleCycle === 'MONTHLY_15_30' || row.settleCycle === 'MONTHLY_15' || row.settleCycle === 'MONTHLY_30') {
    return '半月结'
  }
  if (row.settleCycle === 'MONTHLY_1') return '月结'
  return '礼拜一'
}

function stakeFlow(s?: { betFlow?: number; pendingBetFlow?: number } | null) {
  return Number(s?.betFlow || 0) + Number(s?.pendingBetFlow || 0)
}
function displayFlownFlow(s?: {
  flownBetFlow?: number
  flownBetFlowLive?: number
} | null) {
  return Number(s?.flownBetFlowLive ?? s?.flownBetFlow ?? 0)
}

function fmt(n?: number | null) {
  if (n == null) return '—'
  return formatMoney(n)
}
function pct(n?: number | null) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '—'
  const x = v > 1 ? v : v * 100
  return String(Number(x.toFixed(1)))
}
function pnlColor(n?: number | null) {
  const v = Number(n || 0)
  if (v > 0) return '#16a34a'
  if (v < 0) return '#ef4444'
  return 'var(--el-text-color-regular)'
}
function formatDt(v?: string | null) {
  return formatShanghaiDateTime(v)
}
function formatDtShort(v?: string | null) {
  return formatShanghaiDateTimeShort(v)
}
function ovSummaryCols(n: number) {
  const cols = Math.max(1, Math.min(6, n || 1))
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
}

function amountClass(row: AgentAuditRow) {
  if (row.action === 'QUOTA_RECALL' || row.action === 'CONSOLE_DEBIT') return 'down'
  if (row.action === 'GENERAL_CREDIT_LIMIT_BUMP' && row.detail?.direction === 'down') return 'down'
  if (row.amount != null && row.amount < 0) return 'down'
  return 'up'
}
function amountText(row: AgentAuditRow) {
  if (row.amount == null) return '—'
  const n = Number(row.amount)
  if (row.action === 'QUOTA_RECALL') return `-${formatMoney(Math.abs(n))}`
  return formatSignedMoney(n)
}

function roomSummary(param: { columns: Array<{ property?: string }>; data: ReportByRoomRow[] }) {
  const { columns, data } = param
  return columns.map((col, i) => {
    if (i === 0) return '合计'
    const key = col.property
    if (!key) return ''
    const summable = ['memberCount', 'betFlow', 'flownBetFlow', 'closedBetFlow', 'payout', 'housePnl', 'agentShareAmount', 'platformShareAmount']
    if (!summable.includes(key)) return ''
    const total = data.reduce((s, r) => {
      if (key === 'betFlow') return s + stakeFlow(r)
      return s + Number((r as unknown as Record<string, unknown>)[key] || 0)
    }, 0)
    if (key === 'memberCount') return String(total)
    return fmt(total)
  })
}

function summaryRangeParams() {
  if (!roomIds.value.length) return null
  const params: { roomIds: string; range?: string; from?: string; to?: string } = {
    roomIds: roomIds.value.join(','),
  }
  if (rangeKey.value === 'custom') {
    if (!customRange.value?.[0] || !customRange.value?.[1]) return null
    params.from = customRange.value[0]
    params.to = customRange.value[1]
  } else {
    params.range = rangeKey.value
  }
  return params
}

function onRangePreset() {
  if (rangeKey.value !== 'custom') void loadSummary()
}

async function loadSummary() {
  const params = summaryRangeParams()
  if (!params) {
    if (rangeKey.value === 'custom') ElMessage.warning('请选择自定义起止时间')
    summary.value = null
    byRoom.value = []
    return
  }
  summaryLoading.value = true
  try {
    const [s, roomsRes] = await Promise.all([
      consoleApi.reportSummary(params),
      consoleApi.reportByRoom(params),
    ])
    summary.value = s
    byRoom.value = roomsRes.list || []
    await loadFundPreview()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载报表失败')
  } finally {
    summaryLoading.value = false
  }
}

async function loadFundPreview() {
  if (!id.value) {
    fundRows.value = []
    return
  }
  fundLoading.value = true
  try {
    const range = summary.value?.range
    const res = await consoleApi.agentAudit(id.value, {
      page: 1,
      pageSize: 8,
      tab: 'fund',
      from: range?.from,
      to: range?.to,
    })
    fundRows.value = res.list || []
    fundSummary.value = res.summary || null
  } catch {
    fundRows.value = []
  } finally {
    fundLoading.value = false
  }
}

async function loadAudit() {
  if (!id.value) return
  auditLoading.value = true
  try {
    const page = await consoleApi.agentAudit(id.value, {
      page: auditPage.value,
      pageSize: auditPageSize,
      tab: auditTab.value,
    })
    fundSummary.value = page.summary
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

function applyTabFromQuery() {
  const q = String(route.query.tab || '')
  if (detailTabs.some((t) => t.key === q)) tab.value = q
}

async function load() {
  if (!id.value) return
  loading.value = true
  try {
    const [d, allRooms] = await Promise.all([
      consoleApi.agentDetail(id.value),
      consoleApi.rooms({ includeClosed: isAdminOrBranch.value }),
    ])
    if (d.role !== 'GENERAL') {
      await router.replace({ name: 'agent-detail', params: { id: id.value } })
      return
    }
    detail.value = d
    rooms.value = allRooms.filter((r) => r.general?.userId === id.value)
    await Promise.all([
      loadAudit(),
      loadGrants(),
      tab.value === 'overview' ? loadSummary() : Promise.resolve(),
    ])
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

function openFund(mode: 'up' | 'down') {
  fundMode.value = mode
  fundAmount.value = 10000
  fundVisible.value = true
}
async function doFund() {
  const uid = detail.value?.id
  const amount = Number(fundAmount.value)
  if (!uid || !(amount > 0)) return
  const orderNo = newFundOrderNo(fundMode.value)
  try {
    await ElMessageBox.confirm(
      `确认给总代「${detail.value?.nickname}」${fundMode.value === 'up' ? '上分' : '下分回收'} ${formatMoney(amount)}？订单号 ${orderNo}`,
      fundMode.value === 'up' ? '总代上分' : '总代下分',
      { type: fundMode.value === 'up' ? 'info' : 'warning' },
    )
  } catch {
    return
  }
  fundBusy.value = true
  try {
    if (fundMode.value === 'up') await consoleApi.issue(uid, amount, orderNo)
    else await consoleApi.recall(uid, amount, orderNo)
    ElMessage.success(fundMode.value === 'up' ? '已上分' : '已下分回收')
    fundVisible.value = false
    await load()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '操作失败')
  } finally {
    fundBusy.value = false
  }
}

watch(tab, (t) => {
  if (t === 'overview' && !summary.value) void loadSummary()
  if (t === 'fund') void loadAudit()
})
watch(() => route.query.tab, () => applyTabFromQuery())
watch(() => route.params.id, () => { void load() })
onMounted(() => {
  applyTabFromQuery()
  void load()
})
</script>

<style scoped src="./room-detail/room-detail.css"></style>
<style scoped>
.sub { font-size: 12px; color: var(--el-text-color-secondary); }
.muted { color: var(--el-text-color-secondary); }
.mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.up { color: #16a34a; }
.down { color: #ef4444; }
.pager { margin-top: 12px; justify-content: flex-end; }
.fund-tip-text { margin: 0 0 12px; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.5; }
.is-clickable-table :deep(.el-table__row) { cursor: pointer; }
</style>
