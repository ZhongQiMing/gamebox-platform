<template>
  <nav v-if="show" class="lobby-tabbar" aria-label="运营底栏">
    <div
      v-for="tab in tabs"
      :key="tab.key"
      :class="['tab-item', isOn(tab) ? 'active' : '']"
      :data-tab="tab.key"
      @click="go(tab)"
    >
      <span class="t-icon">{{ tab.icon }}</span>
      <span class="t-text">{{ tab.text }}</span>
      <i v-if="tab.key === 'recharge' && fundBadge > 0" class="tab-badge">{{ badgeText(fundBadge) }}</i>
      <i v-if="tab.key === 'cs' && csBadge > 0" class="tab-badge">{{ badgeText(csBadge) }}</i>
      <i v-if="tab.key === 'settings' && joinBadge > 0" class="tab-badge">{{ badgeText(joinBadge) }}</i>
    </div>
  </nav>
</template>

<script setup lang="ts">
/**
 * 主代理底栏：游戏 / 充值(审核) / 明细 / 客服 / 我的
 * 代理子账号（查账型）：游戏 / 明细 / 我的
 * 客服：审核 / 明细 / 客服 / 我的
 * 管理 / 总监 / 总代 / 总代子账号：游戏 / 明细 / 我的
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStaffStore } from '@/stores/staff'
import { staffConsoleApi } from '@/api/staffConsole'
import '@/assets/common.css'

const route = useRoute()
const router = useRouter()
const staff = useStaffStore()

const show = computed(() => staff.isMobileOps && staff.isLoggedIn)
/** 房间代理子账号：不是总代分身 */
const isRoomProxy = computed(() => staff.role === 'PROXY' && !staff.isGeneral)
const isCs = computed(() => staff.isCs)
const isBranchShell = computed(() => staff.isBranch || staff.isGeneral)
const fundBadge = ref(0)
const csBadge = ref(0)
/** 主代理进房待审；挂在「我的」上，入口在设置里不好找 */
const joinBadge = ref(0)
const isMainAgent = computed(() => staff.role === 'AGENT')

const ALL_TABS = [
  { key: 'home', name: 'staff-lobby', icon: '⛨', text: '游 戏', match: ['staff-lobby'] },
  { key: 'recharge', name: 'staff-fund', icon: '¥', text: '充 值', match: ['staff-fund'] },
  {
    key: 'flow',
    name: 'staff-report',
    icon: '▤',
    text: '明 细',
    match: ['staff-report', 'staff-audit'],
  },
  { key: 'cs', name: 'staff-cs', icon: '✆', text: '客 服', match: ['staff-cs'] },
  {
    key: 'settings',
    name: 'staff-profile',
    icon: '☰',
    text: '我 的',
    match: [
      'staff-profile',
      'staff-account',
      'staff-password',
      'staff-pay-methods',
      'staff-home',
      'staff-players',
      'staff-join',
      'staff-fly-query',
      'staff-rebate',
      'staff-agents',
      'staff-hang',
      'staff-rooms',
      'staff-room-detail',
      'staff-live',
    ],
  },
] as const

const BRANCH_TABS = [
  {
    key: 'home',
    name: 'staff-game-rooms',
    icon: '⛨',
    text: '游 戏',
    match: ['staff-game-rooms', 'staff-lobby'],
  },
  {
    key: 'flow',
    name: 'staff-report',
    icon: '▤',
    text: '明 细',
    match: ['staff-report', 'staff-audit'],
  },
  {
    key: 'settings',
    name: 'staff-profile',
    icon: '☰',
    text: '我 的',
    match: [
      'staff-profile',
      'staff-account',
      'staff-password',
      'staff-rooms',
      'staff-room-detail',
      'staff-agents',
      'staff-risk',
      'staff-home',
      'staff-fly-query',
      'staff-players',
      'staff-live',
    ],
  },
] as const

const CS_TABS = [
  {
    key: 'recharge',
    name: 'staff-fund',
    icon: '¥',
    text: '审 核',
    match: ['staff-fund'],
  },
  {
    key: 'flow',
    name: 'staff-audit',
    icon: '▤',
    text: '明 细',
    match: ['staff-audit', 'staff-report'],
  },
  {
    key: 'cs',
    name: 'staff-cs',
    icon: '✆',
    text: '客 服',
    match: ['staff-cs'],
  },
  {
    key: 'settings',
    name: 'staff-profile',
    icon: '☰',
    text: '我 的',
    match: ['staff-profile', 'staff-account', 'staff-password'],
  },
] as const

type StaffTab =
  | (typeof ALL_TABS)[number]
  | (typeof BRANCH_TABS)[number]
  | (typeof CS_TABS)[number]

const tabs = computed((): StaffTab[] => {
  if (isCs.value) return [...CS_TABS]
  if (isBranchShell.value) return [...BRANCH_TABS]
  if (isRoomProxy.value) {
    return ALL_TABS.filter((t) => t.key !== 'recharge' && t.key !== 'cs')
  }
  return [...ALL_TABS]
})

function isOn(tab: StaffTab) {
  const name = String(route.name || '')
  return (tab.match as readonly string[]).includes(name)
}

function go(tab: StaffTab) {
  if (route.name === tab.name) return
  router.push({ name: tab.name })
}

function badgeText(n: number) {
  return n > 99 ? '99+' : String(n)
}

let badgeBusy = false
let pollTimer: ReturnType<typeof setInterval> | null = null
const POLL_MS = 8000

async function refreshBadges() {
  if (!show.value || !staff.isLoggedIn) {
    fundBadge.value = 0
    csBadge.value = 0
    joinBadge.value = 0
    return
  }
  if (badgeBusy) return
  badgeBusy = true
  try {
    const tasks: Promise<unknown>[] = []
    // 管理/总监/总代/代理子账号无充值·客服角标；主代理与客服保留
    if (isRoomProxy.value || isBranchShell.value) {
      fundBadge.value = 0
      csBadge.value = 0
    } else {
      tasks.push(
        staffConsoleApi.fundPending(1)
          .then((fund) => { fundBadge.value = Number(fund?.total || fund?.list?.length || 0) })
          .catch(() => { fundBadge.value = 0 }),
        staffConsoleApi.csSessions()
          .then((sessions) => {
            const list = sessions?.list || []
            csBadge.value = list.reduce((n, s) => n + Number(s.unread || 0), 0)
          })
          .catch(() => { csBadge.value = 0 }),
      )
    }
    if (isMainAgent.value) {
      tasks.push(
        staffConsoleApi.joinPending()
          .then((join) => { joinBadge.value = Number(join?.total || join?.list?.length || 0) })
          .catch(() => { joinBadge.value = 0 }),
      )
    } else {
      joinBadge.value = 0
    }
    await Promise.all(tasks)
  } catch {
    /* ignore：业务失败不登出；401 由 staffHttp 按当前票处理 */
  } finally {
    badgeBusy = false
  }
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPoll() {
  stopPoll()
  if (!show.value || !staff.isLoggedIn) return
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'hidden') return
    void refreshBadges()
  }, POLL_MS)
}

/*
 * 客服心跳：App 从最近任务被划掉时进程直接结束，前端跑不了任何「我下班了」的代码，
 * 只能靠这条定时上报。服务端超过约 100 秒收不到就把他转成休息，不再派单也不再按漏接罚。
 * 挂在底栏是因为客服的每一页都带着它，页面之间跳转不会断。
 */
const HEARTBEAT_MS = 30_000
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function sendHeartbeat() {
  if (!isCs.value || !staff.isLoggedIn) return
  /* 切到后台时进程可能还活着，但人已经不在看了，不发心跳更贴近真实在岗 */
  if (document.visibilityState === 'hidden') return
  void staffConsoleApi.csHeartbeat().catch(() => undefined)
}

function startHeartbeat() {
  stopHeartbeat()
  if (!isCs.value || !staff.isLoggedIn) return
  sendHeartbeat()
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

function onVisibility() {
  if (document.visibilityState === 'visible') {
    void refreshBadges()
    startPoll()
    /* 回到前台立刻补一次，别等下一个 30 秒才让服务端知道人回来了 */
    sendHeartbeat()
  }
}

function syncBody() {
  if (show.value) {
    document.body.classList.add('has-tabbar')
    document.body.classList.add('has-staff-tabbar')
  } else {
    document.body.classList.remove('has-tabbar')
    document.body.classList.remove('has-staff-tabbar')
  }
}

onMounted(() => {
  syncBody()
  void refreshBadges()
  startPoll()
  startHeartbeat()
  document.addEventListener('visibilitychange', onVisibility)
})
watch(show, (on) => {
  syncBody()
  void refreshBadges()
  if (on) {
    startPoll()
    startHeartbeat()
  } else {
    stopPoll()
    stopHeartbeat()
  }
})
watch([isRoomProxy, isCs, isBranchShell, isMainAgent], () => {
  void refreshBadges()
  startHeartbeat()
})
watch(() => route.fullPath, () => { void refreshBadges() })
onUnmounted(() => {
  stopPoll()
  stopHeartbeat()
  document.removeEventListener('visibilitychange', onVisibility)
  document.body.classList.remove('has-tabbar')
  document.body.classList.remove('has-staff-tabbar')
})
</script>
