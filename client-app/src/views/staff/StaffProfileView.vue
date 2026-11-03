<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page settings-page staff-settings-page">
    <div class="app-bar">
      <div class="back"></div>
      <div class="title">我 的</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <!-- 名片：与玩家端同款卡框 -->
      <button type="button" class="user-card user-bar" title="账号资料" @click="go('staff-account')">
        <span class="avatar-luxe-wrap">
          <img class="avatar-img" :src="avatarSrc" alt="">
          <img class="avatar-frame" src="/images/avatar-ring.webp" alt="">
        </span>
        <div class="user-info">
          <div class="user-name">{{ staff.profile?.nickname || '———' }}</div>
          <div class="user-divider" aria-hidden="true"><span class="user-divider-gem"></span></div>
          <div class="user-id">
            <span class="id-dot"></span>ID&nbsp;<span id="userId">{{ staff.profile?.uid || '———' }}</span>
          </div>
          <div class="user-id user-role">
            <span class="id-dot"></span>
            {{ roleLabel }} · {{ staff.profile?.username || '———' }}
          </div>
        </div>
      </button>

      <div :class="['settings-card', 'wallet-card', hidden ? 'is-hidden' : '', isPlatform ? 'platform-book' : '']">
        <div class="wc-title-row">
          <span class="wc-title">{{ isCs ? '我 的 口 袋' : (isPlatform ? '平 台 账 本' : '额 度 中 心') }}</span>
          <div class="wc-actions">
            <button class="wc-eye" type="button" aria-label="刷新" @click="load">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12a8 8 0 0 1 13-6.2"/>
                <path d="M17 2.5v3.5h-3.5"/>
                <path d="M20 12a8 8 0 0 1-13 6.2"/>
                <path d="M7 21.5v-3.5h3.5"/>
              </svg>
            </button>
            <button class="wc-eye" type="button" aria-label="显示/隐藏余额" @click="hidden = !hidden">
              <svg class="wc-eye-show" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <svg class="wc-eye-hide" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 3l18 18"/>
                <path d="M2 12s4-7 10-7c2.4 0 4.4 1 6 2"/>
                <path d="M22 12s-4 7-10 7c-2.4 0-4.4-1-6-2"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="wc-balance-row">
          <span class="wc-balance" :class="isPlatform ? pnlClass(mainQuota) : ''">
            {{ hidden ? '*****' : (isPlatform ? fmtSigned(mainQuota) : fmt(mainQuota)) }}
          </span>
          <span class="wc-currency">{{ mainQuotaLabel }}</span>
        </div>
        <div v-if="!isCs" class="wc-stats-row">
          <div v-for="s in quotaStats" :key="s.k" class="wc-stat">
            <span class="ws-label">{{ s.k }}</span>
            <span class="ws-value" :class="s.cls">{{ hidden ? '***' : (s.raw || (s.signed ? fmtSigned(s.v) : fmt(s.v))) }}</span>
          </div>
        </div>
      </div>

      <template v-if="isCs">
        <div v-if="csMe?.slaLocked" class="settings-card cs-lock-card">
          账号已锁定：{{ csMe.slaLockReason || '漏接玩家消息' }}。请联系代理报备后解锁。
        </div>
        <div class="settings-card cs-duty-card">
          <div class="cs-duty-row">
            <div>
              <div class="cs-duty-title">接单状态</div>
              <div class="cs-duty-sub">{{ csIdle ? '接单中 · 新会话会优先派给你' : '休息中 · 暂不接新单' }}</div>
            </div>
            <button
              type="button"
              class="cs-duty-switch"
              :class="{ on: csIdle }"
              :disabled="csStatusBusy"
              @click="toggleCsDuty"
            >{{ csIdle ? '接单' : '休息' }}</button>
          </div>
          <div class="cs-duty-time">
            今日接单 {{ hm(csMe?.idleSecToday) }} · 休息 {{ hm(csMe?.restSecToday) }}
          </div>
        </div>
        <div class="settings-card cs-menu-card">
          <button type="button" class="cs-menu-item" @click="go('staff-account')">
            <span>账号资料</span><span class="arrow">›</span>
          </button>
          <button type="button" class="cs-menu-item" @click="go('staff-password')">
            <span>修改密码</span><span class="arrow">›</span>
          </button>
          <button type="button" class="cs-menu-item" @click="goWage">
            <span>佣金记录</span><span class="arrow">›</span>
          </button>
        </div>
      </template>

      <!-- 快捷经营：仅主代理（子账号查账型不碰钱、不审进房） -->
      <div v-if="isAgent" class="settings-card grid-card grid-3x3">
        <button type="button" class="gc-item" @click="go('staff-join')">
          <span class="gc-icon gc-icon--join">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3.5h7l3.5 3.5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z"/>
              <path d="M14 3.5V7h3.5"/>
              <path d="M9 13.5l2 2 4-4"/>
            </svg>
          </span>
          <span class="gc-text">进房审核</span>
          <i v-if="pendingJoin > 0" class="gc-badge">{{ badge(pendingJoin) }}</i>
        </button>
        <button type="button" class="gc-item" @click="go('staff-players')">
          <span class="gc-icon gc-icon--up">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="3.2"/>
              <path d="M5.5 19c0-3.2 2.8-5.5 6.5-5.5s6.5 2.3 6.5 5.5"/>
            </svg>
          </span>
          <span class="gc-text">上下分</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-rebate')">
          <span class="gc-icon gc-icon--rebate">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.5c3.2 4.2 5.5 7.2 5.5 10a5.5 5.5 0 1 1-11 0c0-2.8 2.3-5.8 5.5-10z"/>
              <path d="M12 13v5"/>
              <path d="M9.8 16.2L12 18.5l2.2-2.3"/>
            </svg>
          </span>
          <span class="gc-text">回 水</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-pay-methods')">
          <span class="gc-icon gc-icon--pay">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="6" width="17" height="12" rx="2"/>
              <path d="M3.5 10h17"/>
              <path d="M8 14.5h4"/>
            </svg>
          </span>
          <span class="gc-text">收款方式</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-cs-perf')">
          <span class="gc-icon gc-icon--agent">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 19V9"/>
              <path d="M10 19V5"/>
              <path d="M16 19v-7"/>
              <path d="M3 21h18"/>
            </svg>
          </span>
          <span class="gc-text">客服绩效</span>
        </button>
      </div>

      <!-- 管理 / 总监 / 总代：急办入口（风控仅平台侧；软控、对账、游戏上下架仍用电脑后台） -->
      <div
        v-if="isLandlord"
        class="settings-card grid-card"
        :class="isPlatform ? 'grid-4col' : 'grid-3x3'"
      >
        <button type="button" class="gc-item" @click="go('staff-rooms')">
          <span class="gc-icon gc-icon--intro">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"/>
            </svg>
          </span>
          <span class="gc-text">房间管理</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-agents')">
          <span class="gc-icon gc-icon--agent">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="5.5" r="2.4"/>
              <circle cx="6" cy="17.5" r="2.2"/>
              <circle cx="18" cy="17.5" r="2.2"/>
              <path d="M12 8v3.5M12 11.5L6.5 15.2M12 11.5l5.5 3.7"/>
            </svg>
          </span>
          <span class="gc-text">代理管理</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-players')">
          <span class="gc-icon gc-icon--up">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="3.2"/>
              <path d="M5.5 19c0-3.2 2.8-5.5 6.5-5.5s6.5 2.3 6.5 5.5"/>
            </svg>
          </span>
          <span class="gc-text">玩家查询</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-risk')" v-if="isPlatform">
          <span class="gc-icon gc-icon--risk">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.8 20.5 19H3.5L12 3.8z"/>
              <path d="M12 10v4.5"/>
              <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none"/>
            </svg>
          </span>
          <span class="gc-text">风控预警</span>
          <i v-if="riskUnhandled > 0" class="gc-badge">{{ badge(riskUnhandled) }}</i>
        </button>
        <button type="button" class="gc-item" @click="go('staff-report')">
          <span class="gc-icon gc-icon--bets">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="3"/>
              <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none"/>
            </svg>
          </span>
          <span class="gc-text">经营报表</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-audit')">
          <span class="gc-icon gc-icon--cs">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4h10a2 2 0 0 1 2 2v14l-3-1.5L12 20l-3-1.5L6 20V6a2 2 0 0 1 2-2z"/>
              <path d="M9 9h6M9 12h4M9 15h5"/>
            </svg>
          </span>
          <span class="gc-text">流水日志</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-fly-query')">
          <span class="gc-icon gc-icon--ledger">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4h10a2 2 0 0 1 2 2v14l-3-1.5L12 20l-3-1.5L6 20V6a2 2 0 0 1 2-2z" transform="translate(-1 0)"/>
              <path d="M9 9h6M9 12h4"/>
            </svg>
          </span>
          <span class="gc-text">上盘查询</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-live')">
          <span class="gc-icon gc-icon--bets">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8"/>
              <path d="M12 7.5V12l3 1.8"/>
            </svg>
          </span>
          <span class="gc-text">实时开奖</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-account')">
          <span class="gc-icon gc-icon--account">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="3.2"/>
              <path d="M5.5 19c0-3.2 2.8-5.5 6.5-5.5s6.5 2.3 6.5 5.5"/>
            </svg>
          </span>
          <span class="gc-text">账号资料</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-password')">
          <span class="gc-icon gc-icon--update">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2"/>
              <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
            </svg>
          </span>
          <span class="gc-text">修改密码</span>
        </button>
      </div>

      <!-- 报表：主代理 / 子账号 -->
      <div v-if="isAgentSide" class="settings-card grid-card grid-3x3">
        <button type="button" class="gc-item" @click="goReport('guess')">
          <span class="gc-icon gc-icon--bets">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="3"/>
              <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none"/>
            </svg>
          </span>
          <span class="gc-text">竞猜报表</span>
        </button>
        <button type="button" class="gc-item" @click="goReport('points')">
          <span class="gc-icon gc-icon--account">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8"/>
              <path d="M12 8v8M9.5 10.5h5M9.5 13.5h5"/>
            </svg>
          </span>
          <span class="gc-text">积分报表</span>
        </button>
        <button type="button" class="gc-item" @click="goReport('fund')">
          <span class="gc-icon gc-icon--apply">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3.5h7l3.5 3.5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z"/>
              <path d="M14 3.5V7h3.5"/>
              <path d="M9 12h6M9 15h4"/>
            </svg>
          </span>
          <span class="gc-text">上下分报表</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-agents')">
          <span class="gc-icon gc-icon--agent">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="5.5" r="2.4"/>
              <circle cx="6" cy="17.5" r="2.2"/>
              <circle cx="18" cy="17.5" r="2.2"/>
              <path d="M12 8v3.5M12 11.5L6.5 15.2M12 11.5l5.5 3.7"/>
            </svg>
          </span>
          <span class="gc-text">代理报表</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-audit')">
          <span class="gc-icon gc-icon--cs">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4h10a2 2 0 0 1 2 2v14l-3-1.5L12 20l-3-1.5L6 20V6a2 2 0 0 1 2-2z"/>
              <path d="M9 9h6M9 12h4M9 15h5"/>
            </svg>
          </span>
          <span class="gc-text">资金流水</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-fly-query')">
          <span class="gc-icon gc-icon--ledger">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4h10a2 2 0 0 1 2 2v14l-3-1.5L12 20l-3-1.5L6 20V6a2 2 0 0 1 2-2z" transform="translate(-1 0)"/>
              <path d="M9 9h6M9 12h4"/>
            </svg>
          </span>
          <span class="gc-text">上盘查询</span>
        </button>
        <button type="button" class="gc-item" @click="go('staff-live')">
          <span class="gc-icon gc-icon--bets">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8"/>
              <path d="M12 7.5V12l3 1.8"/>
            </svg>
          </span>
          <span class="gc-text">实时开奖</span>
        </button>
        <button
          v-if="isAgent"
          type="button"
          class="gc-item"
          @click="go('staff-hang')"
        >
          <span class="gc-icon gc-icon--gift">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 12v8"/>
              <path d="M5 12h14v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7z"/>
              <path d="M4 8.5h16V12H4z"/>
              <path d="M12 8.5c-2 0-3.2-1.4-3.2-2.7S10 3.5 12 5c2-1.5 3.2-1 3.2 0.8S14 8.5 12 8.5z"/>
            </svg>
          </span>
          <span class="gc-text">下级挂靠</span>
        </button>
        <button
          v-else
          type="button"
          class="gc-item"
          @click="go('staff-password')"
        >
          <span class="gc-icon gc-icon--update">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2"/>
              <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
            </svg>
          </span>
          <span class="gc-text">修改密码</span>
        </button>
        <button type="button" class="gc-item" @click="goRooms">
          <span class="gc-icon gc-icon--intro">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"/>
            </svg>
          </span>
          <span class="gc-text">房间管理</span>
        </button>
      </div>

      <div class="settings-card logout-card">
        <button type="button" class="logout-btn" @click="askLogout">退 出 登 录</button>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <AppModal
    :visible="showLogoutModal"
    title="退出登录"
    :message="logoutMessage"
    ok-text="确定退出"
    cancel-text="再想想"
    :danger="true"
    @ok="confirmLogout"
    @cancel="showLogoutModal = false"
  />

  <StaffTabBar />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import StaffTabBar from '@/components/StaffTabBar.vue'
import AppModal from '@/components/AppModal.vue'
import { useStaffStore } from '@/stores/staff'
import { useUserStore } from '@/stores/user'
import { useRoomStore } from '@/stores/room'
import { staffConsoleApi, type StaffCsMe, type StaffWalletMe } from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { formatMoney, formatSignedMoney, staffRoleLabel } from '@gamebox/shared'
import '@/assets/settings.css'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const user = useUserStore()
const roomStore = useRoomStore()
const { toast } = useToast()

const loading = ref(false)
const hidden = ref(false)
const showLogoutModal = ref(false)
const wallet = ref<StaffWalletMe | null>(null)
const csMe = ref<StaffCsMe | null>(null)
const pendingJoin = ref(0)
const riskUnhandled = ref(0)
const roomCount = ref(0)
/** 代理「我的」头像 = 本房房间图标 */
const roomIcon = ref('')
const agentRoomId = ref('')
const todayBook = ref({
  realNet: 0,
  share: 0,
  house: 0,
  rebateGeneral: 0,
  rebateAgent: 0,
  rebatePlayer: 0,
})
const csStatusBusy = ref(false)
const pendingFundOnLogout = ref(0)

const logoutMessage = computed(() => {
  if (pendingFundOnLogout.value > 0) {
    return `你还有 ${pendingFundOnLogout.value} 笔上下分没审。退出后计时不会停，超时仍会通知代理。确定退出吗？`
  }
  return '确定要退出当前账号吗？'
})

/** 秒 → 「2时13分」 */
function hm(sec?: number | null) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}时${m}分` : `${m}分`
}

const isAgent = computed(() => staff.role === 'AGENT')
const isAgentSide = computed(() => staff.isAgentSide)
const isPlatform = computed(() => staff.isBranch)
const isLandlord = computed(() => staff.isBranch || staff.isGeneral)
const isCs = computed(() => staff.isCs)
const csIdle = computed(() => (csMe.value?.workStatus || 'REST') === 'IDLE')
const roleLabel = computed(() => staffRoleLabel(staff.role, staff.parentRole))
const isCreditBook = computed(() => wallet.value?.bookMode === 'CREDIT')
const avatarSrc = computed(() => {
  if (isAgent.value) return roomIcon.value || '/images/rooms/default-room.webp'
  return staff.profile?.avatar || '/images/avatars/001.jpg'
})

const mainQuota = computed(() => {
  if (isCs.value) return Number(csMe.value?.balance ?? wallet.value?.balance ?? 0)
  if (isPlatform.value) return todayBook.value.realNet
  return Number(wallet.value?.pointsQuota || 0)
})
const mainQuotaLabel = computed(() => {
  if (isCs.value) return '可用额度'
  if (isPlatform.value) return '扣返水盈亏'
  /* 房主与代理同一个叫法：现金＝可用额度，信用＝剩余信用，都别跟「上盘可飞」混 */
  return isCreditBook.value ? '剩余信用' : '可用额度'
})

type QuotaStat = { k: string; v: number; raw?: string; cls?: string; signed?: boolean }

function signedCls(n: number) {
  if (n > 0) return 'is-pos'
  if (n < 0) return 'is-neg'
  return ''
}

const quotaStats = computed((): QuotaStat[] => {
  if (isCs.value) return []
  if (isPlatform.value) {
    const b = todayBook.value
    return [
      { k: '平台占成', v: b.share, cls: signedCls(b.share), signed: true },
      { k: '庄家盈亏', v: b.house, cls: signedCls(b.house), signed: true },
      { k: '总代返水', v: b.rebateGeneral },
      { k: '代理返水', v: b.rebateAgent },
      { k: '玩家回水', v: b.rebatePlayer },
      { k: '房间数', v: roomCount.value, raw: String(roomCount.value) },
    ]
  }
  if (isCreditBook.value) {
    const merged =
      wallet.value?.agentBalance
      ?? Number(wallet.value?.balance || 0)
    return [
      { k: '代理余额', v: Number(merged) },
      { k: '玩家持分', v: Number(wallet.value?.playerPointsTotal || 0) },
      { k: '上盘可飞', v: Number(wallet.value?.flyCover || 0) },
    ]
  }
  /*
   * 总代这格不是 0：服务端给他返的 flyCover 是 generalTreeFlyAvailable，
   * 即整棵树（他自己 + 名下代理盘分 + 玩家持分）还能让平台当庄多少，
   * 与代理那格的单支口径不同但同样是真实值，电脑后台也照样显示。
   */
  return [
    { k: isLandlord.value ? '账户余额' : '代理余额', v: Number(wallet.value?.balance || 0) },
    { k: '玩家持分', v: Number(wallet.value?.playerPointsTotal || 0) },
    { k: '上盘可飞', v: Number(wallet.value?.flyCover || 0) },
  ]
})

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
function badge(n: number) {
  return n > 99 ? '99+' : String(n)
}
function go(name: string) {
  router.push({ name })
}
function goWage() {
  router.push({ name: 'staff-audit', query: { tab: 'wage' } })
}
function goReport(view: string) {
  router.push({ name: 'staff-report', query: { view } })
}

async function toggleCsDuty() {
  if (!csMe.value?.id || csStatusBusy.value) return
  const next = csIdle.value ? 'REST' : 'IDLE'
  csStatusBusy.value = true
  try {
    csMe.value = await staffConsoleApi.patchCsStaff(csMe.value.id, { workStatus: next })
    toast(next === 'IDLE' ? '已开始接单' : '已休息')
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '切换失败')
  } finally {
    csStatusBusy.value = false
  }
}
/** 一代理一房：直达房间详情，不经列表卡片 */
async function goRooms() {
  try {
    const list = await staffConsoleApi.rooms()
    if (list?.length === 1) {
      await router.push({ name: 'staff-room-detail', params: { id: list[0].id } })
      return
    }
  } catch {
    /* 失败则走列表页 */
  }
  await router.push({ name: 'staff-rooms' })
}
/**
 * 退出前先数一遍手头还有多少笔没审。
 * 计时不会因为退出而停——到点照样提醒代理，所以这里只是提醒，不是拦截。
 */
async function askLogout() {
  pendingFundOnLogout.value = 0
  if (isCs.value || isAgent.value) {
    try {
      const res = await staffConsoleApi.fundPending(1)
      pendingFundOnLogout.value = Number(res?.total ?? res?.list?.length ?? 0)
    } catch {
      /* 数不出来就按 0 提示，别挡住退出 */
    }
  }
  showLogoutModal.value = true
}

async function confirmLogout() {
  showLogoutModal.value = false
  await Promise.all([staff.endPlay(), user.clearStaffPlay()])
  roomStore.clearCurrent()
  await staff.logout()
  // 回玩家登录：退出运营后应能直接登玩家号自己玩
  await router.replace({ name: 'login' })
}

async function load() {
  if (loading.value) return
  loading.value = true
  try {
    const tasks: Promise<unknown>[] = [
      staffConsoleApi.walletMe().then((w) => { wallet.value = w }).catch(() => { wallet.value = null }),
    ]
    if (isCs.value) {
      tasks.push(
        staffConsoleApi.csStaffMe()
          .then((m) => { csMe.value = m })
          .catch(() => { csMe.value = null }),
      )
    }
    if (isAgent.value) {
      tasks.push(
        staffConsoleApi.joinPending()
          .then((join) => { pendingJoin.value = Number(join?.total || join?.list?.length || 0) })
          .catch(() => { pendingJoin.value = 0 }),
        staffConsoleApi.rooms()
          .then((list) => {
            const r = list?.[0]
            agentRoomId.value = r?.id || ''
            roomIcon.value = r?.icon || '/images/rooms/default-room.webp'
          })
          .catch(() => {
            agentRoomId.value = ''
            roomIcon.value = '/images/rooms/default-room.webp'
          }),
      )
    } else {
      pendingJoin.value = 0
    }
    if (isPlatform.value) {
      tasks.push(
        staffConsoleApi.rooms()
          .then((list) => { roomCount.value = list?.length || 0 })
          .catch(() => { roomCount.value = 0 }),
        staffConsoleApi.reportSummary({ range: 'today' })
          .then((s) => {
            const house = Number(s?.satHousePnl ?? s?.housePnl ?? 0)
            const pack = Number(s?.rebatePackage ?? 0)
            todayBook.value = {
              realNet: s?.realNetEarning != null ? Number(s.realNetEarning) : house - pack,
              share: Number(s?.myShareAmount ?? s?.platformShareAmount ?? 0),
              house,
              rebateGeneral: Number(s?.rebateGeneral ?? 0),
              rebateAgent: Number(s?.rebateAgent ?? 0),
              rebatePlayer: Number(s?.rebatePlayer ?? 0),
            }
          })
          .catch(() => {
            todayBook.value = { realNet: 0, share: 0, house: 0, rebateGeneral: 0, rebateAgent: 0, rebatePlayer: 0 }
          }),
        staffConsoleApi.riskSummary()
          .then((s) => { riskUnhandled.value = s.unhandled || 0 })
          .catch(() => { riskUnhandled.value = 0 }),
      )
    } else if (isLandlord.value) {
      tasks.push(
        staffConsoleApi.rooms()
          .then((list) => { roomCount.value = list?.length || 0 })
          .catch(() => { roomCount.value = 0 }),
      )
    }
    await Promise.all(tasks)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
</script>

<style scoped>
.staff-settings-page {
  min-height: 100vh;
  min-height: 100dvh;
}
/* 角色/账号行：紧挨在 ID 下方，字号略小 */
.staff-settings-page :deep(.user-card .user-id + .user-role) {
  margin-top: -8px;
}
.staff-settings-page :deep(.user-card .user-role) {
  font-size: 11px;
  letter-spacing: 0.5px;
  text-transform: none;
}
.wc-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wc-balance.up,
.wc-balance.down {
  background: none;
  -webkit-text-fill-color: currentColor;
  text-shadow: none;
}
.wc-balance.up { color: #86efac; }
.wc-balance.down { color: #fca5a5; }
.staff-settings-page :deep(.wallet-card.platform-book .wc-stats-row) {
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.gc-item {
  position: relative;
}
.gc-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 10px;
  background: #a32130;
  color: #fff;
  font-size: 10px;
  font-style: normal;
  line-height: 16px;
  text-align: center;
}
.gc-icon--up { color: #ffe08a; }
.gc-icon--risk { color: #ffb4b8; }
.cs-duty-card {
  padding: 14px 16px;
}
.cs-duty-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.cs-duty-title {
  font-size: 14px;
  letter-spacing: 1px;
  color: rgba(255, 236, 179, 0.92);
}
.cs-duty-time {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(212, 175, 55, 0.18);
  font-size: 12px;
  color: rgba(244, 211, 107, 0.55);
}
.cs-lock-card {
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.6;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.35);
  border: 1px solid rgba(252, 165, 165, 0.4);
}
.cs-duty-sub {
  margin-top: 4px;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.45);
}
.cs-duty-switch {
  min-width: 64px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid rgba(244, 211, 107, 0.35);
  background: rgba(40, 28, 12, 0.65);
  color: rgba(244, 211, 107, 0.7);
  font-size: 12px;
  letter-spacing: 1px;
  cursor: pointer;
}
.cs-duty-switch.on {
  border-color: rgba(134, 239, 172, 0.55);
  background: rgba(22, 101, 52, 0.45);
  color: #bbf7d0;
}
.cs-menu-card {
  padding: 0;
  overflow: hidden;
}
.cs-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border: 0;
  border-bottom: 1px solid rgba(244, 211, 107, 0.12);
  background: transparent;
  color: rgba(255, 236, 179, 0.9);
  font-size: 14px;
  letter-spacing: 1px;
  cursor: pointer;
  text-align: left;
}
.cs-menu-item:last-child {
  border-bottom: 0;
}
.cs-menu-item .arrow {
  color: rgba(244, 211, 107, 0.45);
}
.gc-icon--down { color: #ffb4b8; }
.gc-icon--join { color: #b8d0ff; }
.gc-icon--pay { color: #9fe0c8; }
</style>
