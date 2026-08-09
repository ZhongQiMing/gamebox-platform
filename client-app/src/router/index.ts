import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useRoomStore } from '@/stores/room'
import { useStaffStore } from '@/stores/staff'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/login',
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/WelcomeView.vue'),
      meta: { public: true },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/RegisterView.vue'),
      meta: { public: true },
    },
    {
      /* 注册页与应用商店都要能直接打开，所以不能要求登录 */
      path: '/privacy',
      name: 'privacy',
      component: () => import('@/views/PrivacyPolicyView.vue'),
      meta: { public: true, allowWithoutRoom: true },
    },
    {
      path: '/staff/login/agent',
      name: 'staff-login-agent',
      component: () => import('@/views/staff/StaffLoginView.vue'),
      meta: { public: true, staffPublic: true },
    },
    {
      path: '/staff/login/branch',
      name: 'staff-login-branch',
      component: () => import('@/views/staff/StaffLoginView.vue'),
      meta: { public: true, staffPublic: true },
    },
    {
      path: '/staff/home',
      name: 'staff-home',
      component: () => import('@/views/staff/StaffHomeView.vue'),
      meta: { public: true, staff: true },
    },
    {
      path: '/staff/game-rooms',
      name: 'staff-game-rooms',
      component: () => import('@/views/staff/StaffGameRoomsView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH'] },
    },
    {
      path: '/staff/lobby',
      name: 'staff-lobby',
      component: () => import('@/views/staff/StaffLobbyView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
    },
    {
      path: '/staff/profile',
      name: 'staff-profile',
      component: () => import('@/views/staff/StaffProfileView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY', 'CS'] },
    },
    {
      path: '/staff/account',
      name: 'staff-account',
      component: () => import('@/views/staff/StaffAccountView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY', 'CS'] },
    },
    {
      path: '/staff/password',
      name: 'staff-password',
      component: () => import('@/views/staff/StaffPasswordView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY', 'CS'] },
    },
    {
      path: '/staff/players',
      name: 'staff-players',
      component: () => import('@/views/staff/StaffPlayersView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH', 'AGENT'] },
    },
    {
      path: '/staff/fund',
      name: 'staff-fund',
      component: () => import('@/views/staff/StaffFundView.vue'),
      meta: { public: true, staff: true, staffRoles: ['AGENT', 'CS'] },
    },
    {
      path: '/staff/cs',
      name: 'staff-cs',
      component: () => import('@/views/staff/StaffCsView.vue'),
      meta: { public: true, staff: true, staffRoles: ['AGENT', 'CS'] },
    },
    {
      path: '/staff/join',
      name: 'staff-join',
      component: () => import('@/views/staff/StaffJoinReviewView.vue'),
      meta: { public: true, staff: true, staffRoles: ['AGENT'] },
    },
    {
      path: '/staff/rebate',
      name: 'staff-rebate',
      component: () => import('@/views/staff/StaffRebateView.vue'),
      meta: { public: true, staff: true, staffRoles: ['AGENT', 'PROXY'] },
    },
    {
      path: '/staff/pay-methods',
      name: 'staff-pay-methods',
      component: () => import('@/views/staff/StaffPayMethodsView.vue'),
      meta: { public: true, staff: true, staffRoles: ['AGENT', 'CS'] },
    },
    {
      path: '/staff/fly-query',
      name: 'staff-fly-query',
      component: () => import('@/views/staff/StaffFlyQueryView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
    },
    {
      path: '/staff/hang',
      name: 'staff-hang',
      component: () => import('@/views/staff/StaffHangView.vue'),
      meta: { public: true, staff: true, staffRoles: ['AGENT'] },
    },
    {
      path: '/staff/rooms',
      name: 'staff-rooms',
      component: () => import('@/views/staff/StaffRoomsView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
    },
    {
      path: '/staff/rooms/:id',
      name: 'staff-room-detail',
      component: () => import('@/views/staff/StaffRoomDetailView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
    },
    {
      path: '/staff/audit',
      name: 'staff-audit',
      component: () => import('@/views/staff/StaffAuditView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY', 'CS'] },
    },
    {
      path: '/staff/report',
      name: 'staff-report',
      component: () => import('@/views/staff/StaffReportView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
    },
    {
      path: '/staff/agents',
      name: 'staff-agents',
      component: () => import('@/views/staff/StaffAgentsView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] },
    },
    {
      path: '/staff/risk',
      name: 'staff-risk',
      component: () => import('@/views/staff/StaffRiskView.vue'),
      meta: { public: true, staff: true, staffRoles: ['ADMIN', 'BRANCH'] },
    },
    {
      path: '/room',
      name: 'room',
      component: () => import('@/views/ReferralInputView.vue'),
      meta: { allowWithoutRoom: true },
    },
    {
      path: '/lobby',
      name: 'lobby',
      component: () => import('@/views/GameLobbyView.vue'),
    },
    { path: '/recharge', name: 'recharge', component: () => import('@/views/RechargeView.vue') },
    /* 旧明细页：与聊天室竞猜报表合并为 /bets */
    { path: '/flow', redirect: '/bets' },
    { path: '/cs',       name: 'cs',       component: () => import('@/views/CsView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/ProfileView.vue'), meta: { allowWithoutRoom: true } },
    { path: '/account', name: 'account', component: () => import('@/views/AccountManageView.vue'), meta: { allowWithoutRoom: true } },
    { path: '/agent',    name: 'agent',    component: () => import('@/views/AgentCenterView.vue') },
    { path: '/password', name: 'password', component: () => import('@/views/ChangePasswordView.vue'), meta: { allowWithoutRoom: true } },
    { path: '/close-account', name: 'close-account', component: () => import('@/views/CloseAccountView.vue'), meta: { allowWithoutRoom: true } },
    { path: '/bets',     name: 'bets',     component: () => import('@/views/BetRecordsView.vue') },
    { path: '/apply-records', name: 'apply-records', component: () => import('@/views/ApplyRecordsView.vue') },
    { path: '/rebate', name: 'rebate', component: () => import('@/views/RebateView.vue') },
    { path: '/points-log', name: 'points-log', component: () => import('@/views/PointsLogView.vue') },
    { path: '/game-intro', name: 'game-intro', component: () => import('@/views/GameIntroView.vue') },
    { path: '/game/arcade/bcbm', name: 'arcade-bcbm', component: () => import('@/views/BcbmView.vue') },
    {
      path: '/game/arcade/:gameCode',
      name: 'arcade',
      redirect: (to) => {
        const code = String(to.params.gameCode || '').toLowerCase()
        return code === 'bcbm' ? '/game/arcade/bcbm' : '/lobby'
      },
    },
    { path: '/game/fruit', name: 'fruit-machine', component: () => import('@/views/FruitMachineView.vue') },
    /* 旧老虎机壳：强制进现用水果机（仍走登录守卫，不会跳过登录） */
    { path: '/game/slot/:gameCode', name: 'slot', redirect: '/game/fruit' },
    /* 彩票 H5（AssetsGameView） */
    { path: '/game/lottery/bjsc', name: 'bjsc', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'bjsc' } },
    { path: '/game/lottery/ssc', name: 'ssc', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'ssc' } },
    { path: '/game/lottery/ffc', name: 'ffc', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'ffc' } },
    { path: '/game/lottery/speed-racing', name: 'speed-racing', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'speed-racing' } },
    { path: '/game/lottery/speed-boat', name: 'speed-boat', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'speed-boat' } },
    { path: '/game/lottery/kuai3', name: 'kuai3', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'kuai3' } },
    { path: '/game/lottery/lhc', name: 'lhc', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'lhc' } },
    /* 旧路径：牌桌曾挂在 lottery 下 → 统一到 /game/table/* */
    { path: '/game/lottery/zhajinhua', redirect: '/game/table/zhajinhua' },
    { path: '/game/lottery/douniu', redirect: '/game/table/douniu' },
    { path: '/game/lottery/baccarat', redirect: '/game/table/baccarat' },
    { path: '/game/lottery/longhu', redirect: '/game/table/longhu' },
    /* 旧彩票壳 LotteryView：未知 code 回大厅（已知彩票已由上方精确路由承接） */
    {
      path: '/game/lottery/:gameCode',
      name: 'lottery',
      redirect: (to) => {
        const code = String(to.params.gameCode || '').toLowerCase()
        const tableAlias: Record<string, string> = {
          zhajinhua: 'zhajinhua',
          douniu: 'douniu',
          baccarat: 'baccarat',
          longhu: 'longhu',
          'dragon-tiger': 'longhu',
        }
        if (tableAlias[code]) return `/game/table/${tableAlias[code]}`
        return '/lobby'
      },
    },
    /* 牌桌 H5（AssetsGameView）— 正式路径 */
    { path: '/game/table/zhajinhua', name: 'zhajinhua', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'zhajinhua' } },
    { path: '/game/table/douniu', name: 'douniu', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'douniu' } },
    { path: '/game/table/baccarat', name: 'baccarat', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'baccarat' } },
    { path: '/game/table/longhu', name: 'longhu', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'longhu' } },
    {
      path: '/game/table/:gameCode',
      name: 'table',
      redirect: (to) => {
        const raw = String(to.params.gameCode || '').toLowerCase()
        const map: Record<string, string> = {
          'dragon-tiger': 'longhu',
          longhu: 'longhu',
          baccarat: 'baccarat',
          zhajinhua: 'zhajinhua',
          douniu: 'douniu',
        }
        const key = map[raw]
        return key ? `/game/table/${key}` : '/lobby'
      },
    },
    { path: '/activities',             name: 'activities', component: () => import('@/views/ActivityView.vue') },
  ],
})

// 全局导航守卫：先等会话恢复（刷新场景），再判断登录态 / 房间态
router.beforeEach(async (to) => {
  const userStore = useUserStore()
  const roomStore = useRoomStore()
  const staffStore = useStaffStore()
  await Promise.all([userStore.restoreSession(), staffStore.restoreSession()])

  // 手机运营端（代理 / 房主）
  if (to.meta.staff) {
    if (!staffStore.isLoggedIn) {
      return {
        name: staffStore.loginKind === 'branch' ? 'staff-login-branch' : 'staff-login-agent',
      }
    }
    const allow = to.meta.staffRoles as string[] | undefined
    if (allow?.length && staffStore.role && !allow.includes(staffStore.role)) {
      return { name: staffStore.homeRouteName() }
    }
    return true
  }
  if (to.meta.staffPublic) {
    if (staffStore.isLoggedIn) {
      return { name: staffStore.homeRouteName() }
    }
    return true
  }

  // 已登录运营端：默认不进玩家流程；代理「游戏大厅」play 模式可进 /game/*
  if (staffStore.isLoggedIn && !to.meta.staff && !to.meta.staffPublic) {
    const play = staffStore.playActive
    const isGamePath = typeof to.path === 'string' && to.path.startsWith('/game')
    const staffHome = staffStore.homeRouteName()
    if (to.name === 'login' || to.name === 'register' || to.name === 'room') {
      return { name: staffHome }
    }
    if (to.name === 'lobby') {
      return { name: staffHome }
    }
    if (isGamePath && play) {
      // 挂上玩家会话壳（刷新后）
      if (!userStore.isLoggedIn && staffStore.profile && staffStore.token) {
        userStore.attachStaffPlay(staffStore.profile, staffStore.token)
      }
      return true
    }
    if (!play && (isGamePath || to.name === 'recharge' || to.name === 'bets' || to.name === 'cs' || to.name === 'settings')) {
      return { name: staffHome }
    }
  }

  if (!to.meta.public && !userStore.isLoggedIn) {
    return { name: 'login' }
  }
  if (to.meta.public && userStore.isLoggedIn && (to.name === 'login' || to.name === 'register')) {
    return roomStore.hasRoom ? { name: 'lobby' } : { name: 'room' }
  }
  // 已登录但未进房：只能停在房间号页 / 设置 / 账号管理 / 改密
  if (
    userStore.isLoggedIn
    && !roomStore.hasRoom
    && !to.meta.public
    && !to.meta.allowWithoutRoom
  ) {
    return { name: 'room' }
  }
})

export default router
