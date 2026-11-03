<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div v-if="!isTabOverview" class="back" @click="router.back()">‹</div>
      <div class="title">{{ pageTitle }}</div>
      <div class="right sc-bar-act" @click="load">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <div
        v-if="view !== 'points'"
        class="sp-tabs sp-tabs--range"
        :data-count="visibleRanges.length"
      >
        <button
          v-for="t in visibleRanges"
          :key="t.key"
          type="button"
          :class="{ on: range === t.key }"
          @click="switchRange(t.key)"
        >{{ t.label }}</button>
      </div>

      <div v-if="loading" class="sp-empty">加载中…</div>
      <template v-else-if="pageReady">
        <!-- 英雄区 -->
        <section class="rp-hero">
          <div class="rp-hero-k">{{ heroLabel }}</div>
          <div class="rp-hero-v" :class="pnlClass(heroValue)">
            {{ view === 'points' ? fmt(heroValue) : fmtSigned(heroValue) }}
          </div>
          <div
            class="rp-hero-row"
            :class="{ 'cols-4': isLandlordOverview || isGeneralOverview || isAgentOverview, 'cols-2': heroMetrics.length === 2 }"
          >
            <div v-for="m in heroMetrics" :key="m.k">
              <span class="k">{{ m.k }}</span>
              <span class="v" :class="m.cls || ''">{{ m.v }}</span>
            </div>
          </div>
        </section>

        <!-- 管理/房主：详细单行清单；其他角色保留原格子（子报表可无格子） -->
        <div v-if="(isLandlordOverview || isGeneralOverview || isAgentOverview) && summaryCells.length" class="rp-detail">
          <div v-for="c in summaryCells" :key="c.k" class="rp-detail-row">
            <span class="k">{{ c.k }}</span>
            <b class="v" :class="c.cls || ''">{{ c.v }}</b>
          </div>
        </div>
        <div v-else-if="summaryCells.length" class="rd-grid">
          <div v-for="c in summaryCells" :key="c.k" class="rd-cell">
            <div class="mk">{{ c.k }}</div>
            <div class="mv" :class="c.cls || ''">{{ c.v }}</div>
          </div>
        </div>

        <!-- 竞猜：分游戏 -->
        <template v-if="view === 'guess'">
          <div class="sc-sec-title">分游戏竞猜</div>
          <div v-if="!(summary?.byGame || []).length" class="sp-empty">该区间暂无已结算注单</div>
          <section v-for="g in summary?.byGame || []" :key="g.gameCode" class="sg-wrap">
            <button type="button" class="rp-card sg-head" @click="toggleGame(g.gameCode)">
              <div class="rp-card-hd">
                <div class="rp-card-name">
                  <b>{{ g.gameName || g.gameCode }}</b>
                  <span>注单 {{ formatCount(g.betCount) }} · 流水 {{ fmt(g.betFlow) }}</span>
                </div>
                <div class="rg-side">
                  <div class="rp-card-pnl" :class="pnlClass(gamePnl(g.housePnl))">{{ fmtSigned(gamePnl(g.housePnl)) }}</div>
                  <span class="sg-chev" :class="{ open: isGameOpen(g.gameCode) }"></span>
                </div>
              </div>
              <div class="rp-metrics cols-3">
                <div class="rp-m"><em>注单</em><b>{{ formatCount(g.betCount) }}</b></div>
                <div class="rp-m"><em>流水</em><b>{{ fmt(g.betFlow) }}</b></div>
                <div class="rp-m"><em>派彩</em><b>{{ fmt(g.payout) }}</b></div>
              </div>
            </button>
            <div v-show="isGameOpen(g.gameCode)" class="sg-body">
              <div v-if="gameState(g.gameCode).loading && !gameState(g.gameCode).list.length" class="sp-empty">加载中…</div>
              <div v-else-if="!gameState(g.gameCode).list.length" class="sp-empty">该游戏暂无注单</div>
              <div v-for="b in gameState(g.gameCode).list" :key="b.id" class="sp-row sf-row">
                <div class="top">
                  <div class="name">{{ b.playerNickname || '—' }}</div>
                  <div class="bal" :class="pnlClass(b.playerPnl)">{{ fmtSigned(b.playerPnl) }}</div>
                </div>
                <div class="meta">
                  {{ betStatusLabel(b.status) }}
                  <template v-if="betTypeLabel(b.betType)"> · {{ betTypeLabel(b.betType) }}</template>
                  · 投 {{ fmt(b.amount) }} · 派 {{ fmt(b.payout) }}
                  · {{ fmtTime(b.createdAt) }}
                </div>
              </div>
              <div v-if="gameState(g.gameCode).list.length < gameState(g.gameCode).total" class="sp-empty">
                <button type="button" class="sc-logout" :disabled="gameState(g.gameCode).loading" @click="loadMoreGame(g.gameCode)">
                  {{ gameState(g.gameCode).loading ? '加载中…' : '加载更多' }}
                </button>
              </div>
            </div>
          </section>
        </template>

        <!-- 积分：玩家持分名单 -->
        <template v-else-if="view === 'points'">
          <div class="sc-sec-title">玩家持分</div>
          <div class="sp-tabs sp-tabs--range" data-count="3">
            <button
              v-for="t in pointsTabs"
              :key="t.key"
              type="button"
              :class="{ on: pointsFilter === t.key }"
              @click="switchPointsFilter(t.key)"
            >{{ t.label }}</button>
          </div>
          <div v-if="pointsLoading && !pointsList.length" class="sp-empty">加载中…</div>
          <div v-else-if="!pointsList.length" class="sp-empty">暂无符合条件的玩家</div>
          <div v-for="row in pointsList" :key="row.id" class="sp-row sf-row">
            <div class="top">
              <div class="name">{{ row.nickname || '—' }}</div>
              <div class="bal" :class="row.balance > 0 ? 'up' : ''">{{ fmt(row.balance) }}</div>
            </div>
            <div class="meta">{{ row.uid || '—' }}</div>
          </div>
          <div v-if="pointsCanMore" class="sp-empty">
            <button type="button" class="sc-logout" :disabled="pointsLoading" @click="loadMorePoints">
              {{ pointsLoading ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </template>

        <!-- 分房间：管理/房主只读；代理端可点进详情 -->
        <template v-else-if="showRoomBreakdown">
          <div class="sc-sec-title">{{ roomSectionTitle }}</div>
          <section
            v-for="b in roomBlocks"
            :key="b.key"
            class="rg"
            :class="{ 'rg-plain': b.kind === 'room' }"
          >
            <button
              v-if="b.kind === 'general'"
              type="button"
              class="rp-card rg-head"
              @click="toggleGroup(b.key)"
            >
              <div class="rp-card-hd">
                <div class="rp-card-name">
                  <b><em class="rg-tag">总代</em>{{ b.name }}</b>
                  <div class="rg-pills">
                    <i v-if="b.sharePct">占成 {{ b.sharePct }}%</i>
                    <i v-if="b.flowPct">整包 {{ b.flowPct }}%</i>
                    <i>{{ b.rooms.length }} 间房</i>
                  </div>
                </div>
                <div class="rg-side">
                  <div class="rp-card-pnl" :class="pnlClass(groupHeadline(b))">{{ fmtSigned(groupHeadline(b)) }}</div>
                  <span class="rg-chev" :class="{ open: isGroupOpen(b.key) }"></span>
                </div>
              </div>
              <div class="rp-line-grid" v-if="isLandlordOverview">
                <div class="rp-line"><span>流水</span><b>{{ fmt(b.flow) }}</b></div>
                <div class="rp-line"><span>庄家盈亏</span><b :class="pnlClass(b.house)">{{ fmtSigned(b.house) }}</b></div>
                <div class="rp-line"><span>总代占成</span><b :class="pnlClass(b.generalShare)">{{ fmtSigned(b.generalShare) }}</b></div>
                <div class="rp-line"><span>平台占成</span><b :class="pnlClass(b.platformShare)">{{ fmtSigned(b.platformShare) }}</b></div>
              </div>
              <div v-else-if="view === 'fund'" class="rp-metrics">
                <div class="rp-m"><em>上分</em><b class="up">{{ fmt(b.up) }}</b></div>
                <div class="rp-m"><em>下分</em><b class="down">{{ fmt(b.down) }}</b></div>
              </div>
              <div v-else class="rp-metrics">
                <div class="rp-m"><em>流水</em><b>{{ fmt(b.flow) }}</b></div>
                <div class="rp-m"><em>玩家</em><b>{{ b.members }}</b></div>
              </div>
            </button>
            <div v-show="b.kind === 'room' || isGroupOpen(b.key)" :class="{ 'rg-body': b.kind === 'general' }">
              <component
                :is="isLandlordOverview ? 'div' : 'button'"
                v-for="r in b.rooms"
                :key="r.roomId"
                v-bind="isLandlordOverview ? {} : { type: 'button' }"
                class="rp-card"
                :class="{ 'is-static': isLandlordOverview }"
                @click="onRoomCardClick(r.roomId)"
              >
                <div class="rp-card-hd">
                  <div class="rp-card-name">
                    <b><em v-if="agentTitle(r) !== r.name" class="rg-tag">本房代理</em>{{ agentTitle(r) }}</b>
                    <span>{{ roomSub(r) }}</span>
                  </div>
                  <div class="rp-card-pnl" :class="pnlClass(roomPnl(r))">{{ fmtSigned(roomPnl(r)) }}</div>
                </div>
                <div class="rp-line-grid" v-if="isLandlordOverview || isGeneralOverview || isAgentOverview">
                  <div class="rp-line"><span>流水</span><b>{{ fmt(r.betFlow) }}</b></div>
                  <div class="rp-line"><span>庄家盈亏</span><b :class="pnlClass(r.housePnl)">{{ fmtSigned(r.housePnl) }}</b></div>
                  <div class="rp-line">
                    <span>{{ roomShareLabel }}</span>
                    <b :class="pnlClass(roomShareValue(r))">{{ fmtSigned(roomShareValue(r)) }}</b>
                  </div>
                  <div v-if="isLandlordOverview" class="rp-line"><span>代理佣金</span><b class="gold">{{ fmt(r.commissionAmount) }}</b></div>
                  <div class="rp-line"><span>注单</span><b>{{ formatCount(r.betCount) }}</b></div>
                </div>
                <div v-else-if="view === 'fund'" class="rp-metrics">
                  <div class="rp-m"><em>上分</em><b class="up">{{ fmt(r.upAmount) }}</b></div>
                  <div class="rp-m"><em>下分</em><b class="down">{{ fmt(r.downAmount) }}</b></div>
                </div>
                <div v-else class="rp-metrics">
                  <div class="rp-m"><em>注单</em><b>{{ formatCount(r.betCount) }}</b></div>
                  <div class="rp-m"><em>流水</em><b>{{ fmt(r.betFlow) }}</b></div>
                  <div class="rp-m"><em>上分</em><b class="up">{{ fmt(r.upAmount) }}</b></div>
                  <div class="rp-m"><em>下分</em><b class="down">{{ fmt(r.downAmount) }}</b></div>
                </div>
              </component>
            </div>
          </section>
        </template>

        <!-- 上下分：区间内明细，全部 / 上分 / 下分 -->
        <template v-if="view === 'fund'">
          <div class="sc-sec-title">上下分明细</div>
          <div class="sp-tabs sp-tabs--range" data-count="3">
            <button
              v-for="t in fundTypeTabs"
              :key="t.key"
              type="button"
              :class="{ on: fundType === t.key }"
              @click="switchFundType(t.key)"
            >{{ t.label }}</button>
          </div>
          <div v-if="fundLoading && !fundList.length" class="sp-empty">加载中…</div>
          <div v-else-if="!fundList.length" class="sp-empty">该区间暂无记录</div>
          <div v-for="row in fundList" :key="row.id" class="sp-row sf-row">
            <div class="top">
              <div class="name">
                <span class="sf-tag" :class="row.type === 'UP' ? 'up' : 'down'">
                  {{ row.type === 'UP' ? '上分' : '下分' }}
                </span>
                {{ row.player?.nickname || '—' }}
              </div>
              <div class="bal" :class="row.type === 'UP' ? 'up' : 'down'">{{ fmt(row.amount) }}</div>
            </div>
            <div class="meta">
              <template v-if="row.orderNo">订单 {{ row.orderNo }} · </template>
              {{ row.player?.uid || '—' }}
              <template v-if="channelLabel(row.channel)"> · {{ channelLabel(row.channel) }}</template>
              · {{ fmtTime(row.reviewedAt || row.createdAt) }}
            </div>
          </div>
          <div v-if="fundCanMore" class="sp-empty">
            <button type="button" class="sc-logout" :disabled="fundLoading" @click="loadMoreFund">
              {{ fundLoading ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </template>
      </template>
    </div>

    <StaffTabBar v-if="isAgentSide || isLandlord || isGeneral" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useStaffStore } from '@/stores/staff'
import {
  staffConsoleApi,
  type StaffFundOrder,
  type StaffPlayerRow,
  type StaffReportByRoomRow,
  type StaffReportSummary,
  type StaffRoomBet,
  type StaffWalletMe,
} from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { formatCount, formatDateTime, formatMoney, formatSignedMoney } from '@gamebox/shared'
import { useBodyClass } from '@/composables/useBodyClass'
import { TIME_RANGES } from '@/composables/timeRange'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const route = useRoute()
const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const allRanges = TIME_RANGES

const range = ref('today')
const loading = ref(false)
const summary = ref<StaffReportSummary | null>(null)
const roomRows = ref<StaffReportByRoomRow[]>([])
const wallet = ref<StaffWalletMe | null>(null)

type RoomLink = {
  generalUserId: string
  generalName: string
  shareRate?: number
  flowRate?: number
  agentName: string
}
const roomMeta = ref<Record<string, RoomLink>>({})

type FundTypeKey = '' | 'UP' | 'DOWN'
const fundTypeTabs: { key: FundTypeKey; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'UP', label: '上分' },
  { key: 'DOWN', label: '下分' },
]
const fundType = ref<FundTypeKey>('')
const fundList = ref<StaffFundOrder[]>([])
const fundPage = ref(1)
const fundTotal = ref(0)
const fundLoading = ref(false)
const fundCanMore = computed(() => fundList.value.length < fundTotal.value)

type PointsFilterKey = '' | 'positive' | 'zero'
const pointsTabs: { key: PointsFilterKey; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'positive', label: '有持分' },
  { key: 'zero', label: '零持分' },
]
const pointsFilter = ref<PointsFilterKey>('')
const pointsList = ref<StaffPlayerRow[]>([])
const pointsPage = ref(1)
const pointsTotal = ref(0)
const pointsLoading = ref(false)
/** wallet 失败时仍展示列表 */
const pointsBooted = ref(false)
const pointsCanMore = computed(() => pointsList.value.length < pointsTotal.value)
let fundReqSeq = 0
let pointsReqSeq = 0

const view = computed(() => {
  const v = String(route.query.view || '')
  if (v === 'guess' || v === 'points' || v === 'fund') return v
  return ''
})

const isAgentSide = computed(() => staff.isAgentSide)
const isLandlord = computed(() => staff.isBranch)
const isGeneral = computed(() => staff.isGeneral)
/** 底栏「明细」总览：无 view；从「我的」进子报表时显示返回 */
const isAgentOverview = computed(() => isAgentSide.value && !view.value)
const isLandlordOverview = computed(() => isLandlord.value && !view.value)
const isGeneralOverview = computed(() => isGeneral.value && !view.value)
const isTabOverview = computed(() => isAgentOverview.value || isLandlordOverview.value || isGeneralOverview.value)
/** 今日 / 昨日 / 本周 / 上周 / 本月 */
const visibleRanges = computed(() => allRanges)

const pageTitle = computed(() => {
  if (isLandlordOverview.value || isGeneralOverview.value) return '经营明细'
  if (isLandlord.value || isGeneral.value) return '报表摘要'
  if (view.value === 'guess') return '竞猜报表'
  if (view.value === 'points') return '积分报表'
  if (view.value === 'fund') return '上下分报表'
  if (isAgentSide.value) return '账单明细'
  return '经营报表'
})

/** 管理/总代总览展示分房。代理只有一间房时，上面的账就是这间房，不再重复一张本房账单。 */
const showRoomBreakdown = computed(() => {
  if (view.value === 'guess' || view.value === 'points') return false
  if (isAgentOverview.value) return roomRows.value.length > 1
  if (isLandlordOverview.value || isGeneralOverview.value) return roomRows.value.length > 0
  return roomRows.value.length > 1
})
const roomSectionTitle = computed(() => {
  if (view.value === 'fund') return '分房间上下分'
  return '分房间'
})

const pageReady = computed(() => {
  if (view.value === 'points') return pointsBooted.value
  return !!summary.value
})

const heroLabel = computed(() => {
  if (view.value === 'points') return '玩家持分合计'
  if (view.value === 'fund') return '本期净上下分'
  if (isLandlordOverview.value) return '扣返水盈亏'
  if (isGeneralOverview.value) return '加返水总盈利'
  if (isAgentOverview.value) return '加返水总盈利'
  return '庄家盈亏'
})

const heroValue = computed(() => {
  if (view.value === 'points') return Number(wallet.value?.playerPointsTotal || 0)
  if (view.value === 'fund') {
    return Number(summary.value?.upAmount || 0) - Number(summary.value?.downAmount || 0)
  }
  if (isLandlordOverview.value) {
    const s = summary.value
    if (s?.realNetEarning != null) return Number(s.realNetEarning)
    return Number(s?.satHousePnl ?? s?.housePnl ?? 0) - Number(s?.rebatePackage ?? 0)
  }
  if (isGeneralOverview.value) {
    const s = summary.value
    if (s?.realNetEarning != null) return Number(s.realNetEarning)
    return Number(s?.myShareAmount || 0) + Number(s?.rebateGeneral || 0)
  }
  if (isAgentOverview.value) {
    const s = summary.value
    return Number(s?.myShareAmount || 0) + Number(s?.rebateAgent || 0)
  }
  return isAgentSide.value
    ? Number(summary.value?.playerPnl || 0)
    : Number(summary.value?.housePnl || 0)
})

const heroMetrics = computed(() => {
  const s = summary.value
  if (view.value === 'points') {
    const credit = wallet.value?.bookMode === 'CREDIT'
    return [
      {
        k: '代理余额',
        v: fmt(
          wallet.value?.agentBalance
          ?? (credit
            ? Number(wallet.value?.pointsQuota ?? 0) + Number(wallet.value?.balance ?? 0)
            : Number(wallet.value?.balance ?? 0)),
        ),
      },
      { k: '上盘可飞', v: fmt(wallet.value?.flyCover) },
      { k: '玩家持分', v: fmt(wallet.value?.playerPointsTotal) },
    ]
  }
  if (!s) return []
  if (view.value === 'fund') {
    return [
      { k: '上分', v: fmt(s.upAmount), cls: 'up' },
      { k: '下分', v: fmt(s.downAmount), cls: 'down' },
      { k: '待审', v: `${s.pendingUp ?? 0}/${s.pendingDown ?? 0}` },
    ]
  }
  if (view.value === 'guess') {
    return [
      { k: '流水', v: fmt(s.betFlow) },
      { k: '派彩', v: fmt(s.payout) },
      { k: '注单', v: formatCount(s.betCount) },
    ]
  }
  if (isLandlordOverview.value) {
    const share = s.myShareAmount ?? s.platformShareAmount ?? s.housePnl
    return [
      { k: '平台占成', v: fmtSigned(share), cls: pnlClass(share) },
      { k: '总代返水', v: fmt(s.rebateGeneral), cls: 'gold' },
      { k: '代理返水', v: fmt(s.rebateAgent), cls: 'gold' },
      { k: '玩家回水', v: fmt(s.rebatePlayer), cls: 'gold' },
    ]
  }
  if (isGeneralOverview.value) {
    const share = Number(s.myShareAmount || 0)
    return [
      { k: '总盈利', v: fmtSigned(share), cls: pnlClass(share) },
      { k: '我的返水', v: fmt(s.rebateGeneral), cls: 'gold' },
      { k: '代理返水', v: fmt(s.rebateAgent), cls: 'gold' },
      { k: '玩家回水', v: fmt(s.rebatePlayer), cls: 'gold' },
    ]
  }
  if (isAgentOverview.value) {
    const share = Number(s.myShareAmount || 0)
    return [
      { k: '总盈利', v: fmtSigned(share), cls: pnlClass(share) },
      { k: '我的返水', v: fmt(s.rebateAgent), cls: 'gold' },
      { k: '玩家回水', v: fmt(s.rebatePlayer), cls: 'gold' },
    ]
  }
  return [
    { k: '流水', v: fmt(s.betFlow) },
    { k: '派彩', v: fmt(s.payout) },
    { k: '注单', v: formatCount(s.betCount) },
  ]
})

const summaryCells = computed(() => {
  const s = summary.value
  if (!s) return []
  /* 子报表不再叠交叉格子 */
  if (view.value === 'points' || view.value === 'fund' || view.value === 'guess') return []
  // 管理/房主：平台视角（盈利 / 流水 / 佣金），不含代理待审
  if (isLandlordOverview.value) {
    const commission = Number(s.commissionAmount || 0)
    const house = s.satHousePnl ?? s.housePnl
    return [
      { k: '庄家盈亏', v: fmtSigned(house), cls: pnlClass(house) },
      { k: '流水', v: fmt(s.betFlow) },
      { k: '派彩', v: fmt(s.payout) },
      { k: '注单数', v: formatCount(s.betCount) },
      { k: '玩家盈亏', v: fmtSigned(s.playerPnl), cls: pnlClass(s.playerPnl) },
      { k: '代理佣金', v: fmt(commission), cls: commission > 0 ? 'gold' : '' },
      { k: '佣金笔数', v: String(s.commissionCount ?? 0) },
      { k: '上分合计', v: fmt(s.upAmount), cls: 'up' },
      { k: '下分合计', v: fmt(s.downAmount), cls: 'down' },
      { k: '活跃玩家', v: String(s.activePlayers ?? 0) },
      { k: '房间数', v: String(s.roomCount ?? 0) },
    ]
  }
  if (isGeneralOverview.value) {
    const house = s.housePnl
    return [
      { k: '庄家盈亏', v: fmtSigned(house), cls: pnlClass(house) },
      { k: '流水', v: fmt(s.betFlow) },
      { k: '派彩', v: fmt(s.payout) },
      { k: '注单数', v: formatCount(s.betCount) },
      { k: '上分合计', v: fmt(s.upAmount), cls: 'up' },
      { k: '下分合计', v: fmt(s.downAmount), cls: 'down' },
      { k: '活跃玩家', v: String(s.activePlayers ?? 0) },
      { k: '房间数', v: String(s.roomCount ?? 0) },
    ]
  }
  if (isAgentOverview.value) {
    return [
      { k: '庄家盈亏', v: fmtSigned(s.housePnl), cls: pnlClass(s.housePnl) },
      { k: '流水', v: fmt(s.betFlow) },
      { k: '派彩', v: fmt(s.payout) },
      { k: '注单数', v: formatCount(s.betCount) },
      { k: '上分合计', v: fmt(s.upAmount), cls: 'up' },
      { k: '下分合计', v: fmt(s.downAmount), cls: 'down' },
      { k: '活跃玩家', v: String(s.activePlayers ?? 0) },
      { k: '房间数', v: String(s.roomCount ?? 0) },
    ]
  }
  return [
    { k: '上分', v: fmt(s.upAmount), cls: 'up' },
    { k: '下分', v: fmt(s.downAmount), cls: 'down' },
    { k: '活跃玩家', v: String(s.activePlayers ?? '—') },
    { k: '房间数', v: String(s.roomCount) },
  ]
})

function onRoomCardClick(roomId: string) {
  if (isLandlordOverview.value) return
  void router.push({ name: 'staff-room-detail', params: { id: roomId } })
}

function roomPnl(r: StaffReportByRoomRow) {
  if (view.value === 'fund') {
    return Number(r.upAmount || 0) - Number(r.downAmount || 0)
  }
  if (isLandlordOverview.value) return Number(r.platformShareAmount ?? r.housePnl ?? 0)
  if (isGeneralOverview.value) return Number(r.generalShareAmount || 0)
  if (isAgentOverview.value) return Number(r.agentShareAmount || 0)
  return isAgentSide.value ? Number(r.playerPnl || 0) : Number(r.housePnl || 0)
}

const roomShareLabel = computed(() => (isLandlordOverview.value ? '平台占成' : '总盈利'))
function roomShareValue(r: StaffReportByRoomRow) {
  if (isGeneralOverview.value) return Number(r.generalShareAmount || 0)
  if (isAgentOverview.value) return Number(r.agentShareAmount || 0)
  return Number(r.platformShareAmount ?? r.housePnl ?? 0)
}

function pctLabel(rate?: number) {
  const n = Number(rate)
  if (!Number.isFinite(n) || n === 0) return ''
  const pct = n > 1 ? n : n * 100
  return String(Math.round(pct * 10) / 10)
}

function agentTitle(r: StaffReportByRoomRow) {
  if (isAgentSide.value) return r.name
  return String(r.agentNickname || roomMeta.value[r.roomId]?.agentName || '').trim() || r.name
}

function roomSub(r: StaffReportByRoomRow) {
  const bits = [`进房码 ${r.roomNo}`, `玩家 ${r.memberCount ?? 0}`]
  if (agentTitle(r) !== r.name) bits.unshift(r.name)
  return bits.join(' · ')
}

type RoomBlock = {
  key: string
  kind: 'room' | 'general'
  name: string
  sharePct: string
  flowPct: string
  rooms: StaffReportByRoomRow[]
  flow: number
  house: number
  generalShare: number
  platformShare: number
  members: number
  up: number
  down: number
}

const roomBlocks = computed<RoomBlock[]>(() => {
  const blocks: RoomBlock[] = []
  const seen = new Set<string>()
  for (const row of roomRows.value) {
    const link = roomMeta.value[row.roomId]
    const gid = isGeneral.value || isAgentSide.value ? '' : (link?.generalUserId || '')
    if (!gid) {
      blocks.push({
        key: row.roomId,
        kind: 'room',
        name: '',
        sharePct: '',
        flowPct: '',
        rooms: [row],
        flow: 0,
        house: 0,
        generalShare: 0,
        platformShare: 0,
        members: 0,
        up: 0,
        down: 0,
      })
      continue
    }
    if (seen.has(gid)) continue
    seen.add(gid)
    const rooms = roomRows.value.filter((item) => roomMeta.value[item.roomId]?.generalUserId === gid)
    blocks.push({
      key: gid,
      kind: 'general',
      name: link?.generalName || '总代',
      sharePct: pctLabel(link?.shareRate),
      flowPct: pctLabel(link?.flowRate),
      rooms,
      flow: rooms.reduce((s, item) => s + Number(item.betFlow || 0), 0),
      house: rooms.reduce((s, item) => s + Number(item.housePnl || 0), 0),
      generalShare: rooms.reduce((s, item) => s + Number(item.generalShareAmount || 0), 0),
      platformShare: rooms.reduce((s, item) => s + Number(item.platformShareAmount ?? item.housePnl ?? 0), 0),
      members: rooms.reduce((s, item) => s + Number(item.memberCount || 0), 0),
      up: rooms.reduce((s, item) => s + Number(item.upAmount || 0), 0),
      down: rooms.reduce((s, item) => s + Number(item.downAmount || 0), 0),
    })
  }
  return blocks
})

const openedGroups = ref<Record<string, boolean>>({})
function isGroupOpen(key: string) {
  if (openedGroups.value[key] != null) return openedGroups.value[key]
  const groups = roomBlocks.value.filter((b) => b.kind === 'general')
  return groups.length <= 1 || groups[0]?.key === key
}
function toggleGroup(key: string) {
  openedGroups.value = { ...openedGroups.value, [key]: !isGroupOpen(key) }
}
function groupHeadline(b: RoomBlock) {
  if (view.value === 'fund') return b.up - b.down
  if (isLandlordOverview.value) return b.generalShare
  return isAgentSide.value
    ? b.rooms.reduce((s, item) => s + Number(item.playerPnl || 0), 0)
    : b.house
}
function fmt(n?: number | null) {
  return formatMoney(n ?? 0)
}
function fmtSigned(n?: number | null) {
  return formatSignedMoney(n ?? 0)
}
function pnlClass(n?: number | null) {
  const v = Number(n || 0)
  if (v > 0) return 'up'
  if (v < 0) return 'down'
  return ''
}

async function loadFund(page = 1, append = false) {
  if (view.value !== 'fund') return
  const seq = ++fundReqSeq
  fundLoading.value = true
  try {
    const res = await staffConsoleApi.fundHistory(page, {
      status: 'APPROVED',
      range: range.value,
      ...(fundType.value ? { type: fundType.value } : {}),
    })
    if (seq !== fundReqSeq) return
    fundPage.value = res.page
    fundTotal.value = res.total
    fundList.value = append ? [...fundList.value, ...(res.list || [])] : (res.list || [])
  } catch (e: unknown) {
    if (seq !== fundReqSeq) return
    if (!append) fundList.value = []
    toast(e instanceof Error ? e.message : '流水加载失败')
  } finally {
    if (seq === fundReqSeq) fundLoading.value = false
  }
}

function switchFundType(key: FundTypeKey) {
  if (fundType.value === key) return
  fundType.value = key
  void loadFund(1, false)
}

function loadMoreFund() {
  if (!fundCanMore.value || fundLoading.value) return
  void loadFund(fundPage.value + 1, true)
}

async function loadPoints(page = 1, append = false) {
  if (view.value !== 'points') return
  const seq = ++pointsReqSeq
  pointsLoading.value = true
  try {
    const res = await staffConsoleApi.players({
      page,
      pageSize: 30,
      ...(pointsFilter.value ? { points: pointsFilter.value } : {}),
    })
    if (seq !== pointsReqSeq) return
    pointsPage.value = res.page
    pointsTotal.value = res.total
    pointsList.value = append ? [...pointsList.value, ...(res.list || [])] : (res.list || [])
  } catch (e: unknown) {
    if (seq !== pointsReqSeq) return
    if (!append) pointsList.value = []
    toast(e instanceof Error ? e.message : '玩家列表加载失败')
  } finally {
    if (seq === pointsReqSeq) pointsLoading.value = false
  }
}

function switchPointsFilter(key: PointsFilterKey) {
  if (pointsFilter.value === key) return
  pointsFilter.value = key
  void loadPoints(1, false)
}

function loadMorePoints() {
  if (!pointsCanMore.value || pointsLoading.value) return
  void loadPoints(pointsPage.value + 1, true)
}

function fmtTime(iso?: string | null) {
  return iso ? formatDateTime(iso) : ''
}

function channelLabel(ch?: string | null) {
  if (!ch) return ''
  const map: Record<string, string> = {
    wechat: '微信',
    alipay: '支付宝',
    bank: '银行卡',
    cs: '客服',
  }
  return map[ch] || ch
}

type GameBetState = { list: StaffRoomBet[]; total: number; page: number; loading: boolean }
const openGames = ref<Record<string, boolean>>({})
const gameBets = ref<Record<string, GameBetState>>({})
const guessRoomIds = ref<string[]>([])

function gameState(code: string): GameBetState {
  return gameBets.value[code] || { list: [], total: 0, page: 0, loading: false }
}
function isGameOpen(code: string) {
  return !!openGames.value[code]
}
function gamePnl(house: number) {
  return isAgentSide.value ? -Number(house || 0) : Number(house || 0)
}
function betStatusLabel(status: string) {
  return ({ PENDING: '未开奖', WON: '已中', LOST: '未中', CANCELLED: '已取消' } as Record<string, string>)[status] || status
}
function betTypeLabel(betType?: string | null) {
  if (!betType) return ''
  const map: Record<string, string> = {
    big: '大', small: '小', odd: '单', even: '双',
    top2big: '冠亚大', top2small: '冠亚小', top2odd: '冠亚单', top2even: '冠亚双',
    triplet: '三同', straight: '三连', alldiff: '三不同',
  }
  return map[betType] || betType
}

async function loadGameBets(code: string, page: number, append: boolean) {
  const prev = gameState(code)
  gameBets.value = { ...gameBets.value, [code]: { ...prev, loading: true } }
  try {
    if (!guessRoomIds.value.length) {
      const rooms = await staffConsoleApi.rooms().catch(() => [])
      guessRoomIds.value = (rooms || []).map((room) => room.id)
    }
    if (!guessRoomIds.value.length) {
      gameBets.value = { ...gameBets.value, [code]: { list: [], total: 0, page: 1, loading: false } }
      return
    }
    const pages = await Promise.all(guessRoomIds.value.map((roomId) =>
      staffConsoleApi.reportRoomBets({
        roomId,
        range: range.value,
        page,
        pageSize: 20,
        gameCode: code,
      }),
    ))
    const incoming = pages.flatMap((item) => item.list || [])
    incoming.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    const total = pages.reduce((sum, item) => sum + Number(item.total || 0), 0)
    const current = append ? gameState(code).list : []
    gameBets.value = {
      ...gameBets.value,
      [code]: { list: [...current, ...incoming], total, page, loading: false },
    }
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '注单加载失败')
    gameBets.value = { ...gameBets.value, [code]: { ...gameState(code), loading: false } }
  }
}

function toggleGame(code: string) {
  const next = !isGameOpen(code)
  openGames.value = { ...openGames.value, [code]: next }
  if (next && !gameBets.value[code]) void loadGameBets(code, 1, false)
}
function loadMoreGame(code: string) {
  const state = gameState(code)
  if (state.loading || state.list.length >= state.total) return
  void loadGameBets(code, state.page + 1, true)
}

async function load() {
  loading.value = true
  openGames.value = {}
  gameBets.value = {}
  try {
    const tasks: Promise<unknown>[] = []
    if (view.value === 'points') {
      pointsBooted.value = false
      tasks.push(
        staffConsoleApi.walletMe().then((w) => { wallet.value = w }).catch(() => { wallet.value = null }),
        loadPoints(1, false),
      )
      roomRows.value = []
      fundList.value = []
      fundTotal.value = 0
    } else {
      tasks.push(
        staffConsoleApi.reportSummary({ range: range.value }).then((s) => { summary.value = s }),
      )
      if (view.value !== 'guess') {
        tasks.push(
          staffConsoleApi.reportByRoom({ range: range.value })
            .then((byRoom) => { roomRows.value = byRoom.list || [] })
            .catch(() => { roomRows.value = [] }),
          staffConsoleApi.rooms()
            .then((list) => {
              const next: Record<string, RoomLink> = {}
              for (const room of list || []) {
                next[room.id] = {
                  generalUserId: room.general?.userId || '',
                  generalName: String(room.general?.nickname || room.general?.username || '').trim(),
                  shareRate: room.general?.shareRate,
                  flowRate: room.general?.flowRate,
                  agentName: String(room.agent?.nickname || room.agent?.username || '').trim(),
                }
              }
              roomMeta.value = next
            })
            .catch(() => { roomMeta.value = {} }),
        )
      } else {
        roomRows.value = []
        roomMeta.value = {}
      }
      if (!view.value) {
        tasks.push(
          staffConsoleApi.walletMe().then((w) => { wallet.value = w }).catch(() => { wallet.value = null }),
        )
      }
      if (view.value === 'fund') {
        tasks.push(loadFund(1, false))
      } else {
        fundList.value = []
        fundTotal.value = 0
      }
      pointsList.value = []
      pointsTotal.value = 0
    }
    await Promise.all(tasks)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    if (view.value === 'points') pointsBooted.value = true
    loading.value = false
  }
}

function switchRange(key: string) {
  range.value = key
  void load()
}

watch(view, () => { void load() })
onMounted(() => { void load() })
</script>

<style scoped>
.rp-hero {
  margin-bottom: 12px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(244, 211, 107, 0.35);
  background:
    radial-gradient(120% 80% at 100% 0%, rgba(245, 158, 11, 0.16), transparent 55%),
    linear-gradient(160deg, rgba(52, 36, 18, 0.96) 0%, rgba(22, 14, 8, 0.98) 100%);
}
.rp-hero-k {
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(255, 244, 194, 0.72);
  margin-bottom: 4px;
}
.rp-hero-v {
  font-size: 30px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  font-family: 'Noto Serif SC', serif;
  margin-bottom: 12px;
}
.rp-hero-v.up { color: #86efac; }
.rp-hero-v.down { color: #fca5a5; }
.rp-hero-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(244, 211, 107, 0.14);
}
.rp-hero-row.cols-4 {
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}
.rp-hero-row.cols-2 {
  grid-template-columns: repeat(2, 1fr);
}
.rp-hero-row .k {
  display: block;
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 3px;
}
.rp-hero-row .v {
  font-size: 14px;
  font-weight: 650;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}
.rp-hero-row.cols-4 .v { font-size: 16px; }
.rp-hero-row .v.up { color: #86efac; }
.rp-hero-row .v.down { color: #fca5a5; }
.rp-hero-row .v.gold,
.rp-detail-row .v.gold,
.rp-line b.gold { color: #f5d36b; }

.rp-detail {
  margin-bottom: 14px;
  padding: 4px 12px;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.28);
  background: rgba(20, 14, 8, 0.88);
}
.rp-detail-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 2px;
  border-bottom: 1px solid rgba(244, 211, 107, 0.1);
}
.rp-detail-row:last-child { border-bottom: none; }
.rp-detail-row .k {
  flex-shrink: 0;
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--text-muted);
}
.rp-detail-row .v {
  min-width: 0;
  text-align: right;
  font-size: 15px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
}
.rp-detail-row .v.up { color: #86efac; }
.rp-detail-row .v.down { color: #fca5a5; }

.rp-card {
  display: block;
  width: 100%;
  margin-bottom: 10px;
  padding: 12px 14px;
  text-align: left;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.28);
  background: rgba(20, 14, 8, 0.88);
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.rp-card.is-static {
  cursor: default;
}
.rg { margin-bottom: 12px; }
.rg-plain { margin-bottom: 0; }
.rg-head { margin-bottom: 0; }
.rg-tag {
  margin-right: 6px;
  font-style: normal;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.72);
}
.rg-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.rg-pills i {
  font-style: normal;
  font-size: 10px;
  letter-spacing: 0.5px;
  color: #d4af37;
  border: 1px solid rgba(212, 175, 55, 0.4);
  border-radius: 4px;
  padding: 2px 6px;
}
.rg-side {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.rg-side .rp-card-pnl {
  max-width: none;
  white-space: nowrap;
  word-break: normal;
  font-size: 16px;
}
.rg-chev {
  position: relative;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid rgba(212, 175, 55, 0.5);
  background: rgba(0, 0, 0, 0.32);
}
.rg-chev::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 7px;
  width: 7px;
  height: 7px;
  border-right: 1.5px solid #f5d36b;
  border-bottom: 1.5px solid #f5d36b;
  transform: rotate(45deg);
}
.rg-chev.open::before {
  top: 10px;
  transform: rotate(225deg);
}
.rg-body {
  margin: 8px 0 0 16px;
  padding-left: 10px;
  border-left: 1px solid rgba(212, 175, 55, 0.42);
}
.rg-body .rp-card:last-child { margin-bottom: 0; }
.rp-card:not(.is-static):active { background: rgba(244, 211, 107, 0.06); }

.rp-line-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(244, 211, 107, 0.1);
}
.rp-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.rp-line span {
  flex-shrink: 0;
  font-size: 11px;
  letter-spacing: 0.5px;
  color: rgba(244, 211, 107, 0.48);
}
.rp-line b {
  min-width: 0;
  text-align: right;
  font-size: 13px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-line b.up { color: #86efac; }
.rp-line b.down { color: #fca5a5; }
.rp-link {
  display: block;
  width: 100%;
  margin: 8px 0 0;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.28);
  background: rgba(16, 12, 8, 0.85);
  color: #fff4c2;
  font-size: 14px;
  letter-spacing: 1px;
  text-align: left;
  cursor: pointer;
}

.rp-card-hd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.rp-card-name {
  min-width: 0;
  flex: 1;
}
.rp-card-name b {
  display: block;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 1px;
  color: #fff4c2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rp-card-name span {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.5);
  letter-spacing: 0.5px;
}
.rp-card-pnl {
  flex-shrink: 0;
  max-width: 42%;
  text-align: right;
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff4c2;
  word-break: break-all;
  line-height: 1.2;
}
.rp-card-pnl.up { color: #86efac; }
.rp-card-pnl.down { color: #fca5a5; }

.rp-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(244, 211, 107, 0.1);
}
.rp-metrics.cols-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.rp-m {
  min-width: 0;
}
.rp-m em {
  display: block;
  font-style: normal;
  font-size: 10px;
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.48);
  margin-bottom: 3px;
}
.rp-m b {
  display: block;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #fff4c2;
  word-break: break-all;
  line-height: 1.2;
}
.rp-m b.up { color: #86efac; }
.rp-m b.down { color: #fca5a5; }

.sf-tag {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 1px;
  vertical-align: 1px;
}
.sf-tag.up {
  color: #86efac;
  background: rgba(22, 101, 52, 0.35);
  border: 1px solid rgba(134, 239, 172, 0.35);
}
.sf-tag.down {
  color: #fca5a5;
  background: rgba(127, 29, 29, 0.35);
  border: 1px solid rgba(252, 165, 165, 0.35);
}
.sf-row .bal.up { color: #86efac; }
.sf-row .bal.down { color: #fca5a5; }
</style>
