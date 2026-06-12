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
    { path: '/cs',       name: 'cs',       component: () => import('@/views/PlaceholderView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/PlaceholderView.vue') },
    { path: '/game/lucky-wheel', name: 'lucky-wheel', component: () => import('@/views/LuckyWheelView.vue') },
  ],
})

// 全局导航守卫：未登录跳 login
router.beforeEach((to) => {
  const userStore = useUserStore()
  if (!to.meta.public && !userStore.isLoggedIn) {
    return { name: 'login' }
  }
  if (to.meta.public && userStore.isLoggedIn && (to.name === 'login' || to.name === 'register')) {
    return { name: 'lobby' }
  }
})

export default router
