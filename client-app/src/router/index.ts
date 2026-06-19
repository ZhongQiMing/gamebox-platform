import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

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
      path: '/lobby',
      name: 'lobby',
      component: () => import('@/views/GameLobbyView.vue'),
    },
    { path: '/recharge', name: 'recharge', component: () => import('@/views/RechargeView.vue') },
    { path: '/flow',     name: 'flow',     component: () => import('@/views/FlowView.vue') },
    { path: '/cs',       name: 'cs',       component: () => import('@/views/CsView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/ProfileView.vue') },
    { path: '/agent',    name: 'agent',    component: () => import('@/views/AgentCenterView.vue') },
    { path: '/password', name: 'password', component: () => import('@/views/ChangePasswordView.vue') },
    { path: '/bets',     name: 'bets',     component: () => import('@/views/BetRecordsView.vue') },
    { path: '/apply-records', name: 'apply-records', component: () => import('@/views/ApplyRecordsView.vue') },
    { path: '/points-log', name: 'points-log', component: () => import('@/views/PointsLogView.vue') },
    { path: '/game/arcade/:gameCode',  name: 'arcade',  component: () => import('@/views/BcbmView.vue') },
    { path: '/game/lucky-wheel', name: 'lucky-wheel', component: () => import('@/views/LuckyWheelView.vue') },
    { path: '/game/laba', name: 'laba', component: () => import('@/views/LabaGameView.vue') },
    { path: '/game/slot/slots-mahjong', name: 'mahjong', component: () => import('@/views/MahjongGameView.vue'), meta: { public: true } },
    { path: '/game/slot/:gameCode',    name: 'slot',    component: () => import('@/views/SlotView.vue') },
    { path: '/game/lottery/:gameCode', name: 'lottery', component: () => import('@/views/LotteryView.vue') },
    { path: '/game/table/:gameCode',   name: 'table',   component: () => import('@/views/TableView.vue') },
    { path: '/activities',             name: 'activities', component: () => import('@/views/ActivityView.vue') },
  ],
})

// 全局导航守卫：先等会话恢复（刷新场景），再判断登录态
router.beforeEach(async (to) => {
  const userStore = useUserStore()
  await userStore.restoreSession()
  if (!to.meta.public && !userStore.isLoggedIn) {
    return { name: 'login' }
  }
  if (to.meta.public && userStore.isLoggedIn && (to.name === 'login' || to.name === 'register')) {
    return { name: 'lobby' }
  }
})

export default router
