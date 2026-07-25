import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useRoomStore } from '@/stores/room'

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
    { path: '/flow',     name: 'flow',     component: () => import('@/views/FlowView.vue') },
    { path: '/cs',       name: 'cs',       component: () => import('@/views/CsView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/ProfileView.vue'), meta: { allowWithoutRoom: true } },
    { path: '/account', name: 'account', component: () => import('@/views/AccountManageView.vue'), meta: { allowWithoutRoom: true } },
    { path: '/agent',    name: 'agent',    component: () => import('@/views/AgentCenterView.vue') },
    { path: '/password', name: 'password', component: () => import('@/views/ChangePasswordView.vue'), meta: { allowWithoutRoom: true } },
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
    {
      path: '/dev/fruit-fx',
      name: 'fruit-fx-preview',
      component: () => import('@/views/FruitFxPreviewView.vue'),
      meta: { public: true },
    },
    { path: '/game/slot/slots-mahjong', name: 'mahjong', component: () => import('@/views/MahjongGameView.vue') },
    {
      path: '/game/slot/slots-mahjong-iframe',
      name: 'mahjong-iframe',
      component: () => import('@/views/AssetsGameView.vue'),
      meta: { assetGame: 'slots-mahjong' },
    },
    { path: '/game/slot/slots-mahjong-vue', redirect: '/game/slot/slots-mahjong' },
    { path: '/game/slot/:gameCode',    name: 'slot',    component: () => import('@/views/SlotView.vue') },
    { path: '/game/lottery/bjsc', name: 'bjsc', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'bjsc' } },
    { path: '/game/lottery/ssc', name: 'ssc', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'ssc' } },
    { path: '/game/lottery/ffc', name: 'ffc', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'ffc' } },
    { path: '/game/lottery/speed-racing', name: 'speed-racing', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'speed-racing' } },
    { path: '/game/lottery/speed-boat', name: 'speed-boat', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'speed-boat' } },
    { path: '/game/lottery/kuai3', name: 'kuai3', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'kuai3' } },
    { path: '/game/lottery/lhc', name: 'lhc', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'lhc' } },
    { path: '/game/lottery/zhajinhua', name: 'zhajinhua', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'zhajinhua' } },
    { path: '/game/lottery/douniu', name: 'douniu', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'douniu' } },
    { path: '/game/lottery/baccarat', name: 'baccarat', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'baccarat' } },
    { path: '/game/lottery/longhu', name: 'longhu', component: () => import('@/views/AssetsGameView.vue'), meta: { assetGame: 'longhu' } },
    { path: '/game/lottery/:gameCode', name: 'lottery', component: () => import('@/views/LotteryView.vue') },
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
        return key ? `/game/lottery/${key}` : '/lobby'
      },
    },
    { path: '/activities',             name: 'activities', component: () => import('@/views/ActivityView.vue') },
  ],
})

// 全局导航守卫：先等会话恢复（刷新场景），再判断登录态 / 房间态
router.beforeEach(async (to) => {
  const userStore = useUserStore()
  const roomStore = useRoomStore()
  await userStore.restoreSession()
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
