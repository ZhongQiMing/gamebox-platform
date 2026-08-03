import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAdminStore } from '@/stores/admin'
import http from '@/api/http'

const staffRoles = ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] as const

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('@/layout/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] } },
      { path: 'rooms', name: 'rooms', component: () => import('@/views/RoomsView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] } },
      { path: 'rooms/:id', name: 'room-detail', component: () => import('@/views/RoomDetailView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] } },
      { path: 'players', name: 'players', component: () => import('@/views/PlayersView.vue'), meta: { roles: ['AGENT', 'PROXY'] } },
      { path: 'reports', name: 'reports', component: () => import('@/views/ReportsView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] } },
      { path: 'recharge', name: 'recharge', component: () => import('@/views/RechargeReviewView.vue'), meta: { roles: ['AGENT', 'PROXY'] } },
      { path: 'games', name: 'games', component: () => import('@/views/GameManageView.vue'), meta: { roles: ['ADMIN'] } },
      { path: 'control', name: 'control', component: () => import('@/views/ControlView.vue'), meta: { roles: ['ADMIN'] } },
      { path: 'rebate', name: 'rebate', component: () => import('@/views/RebatePolicyView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] } },
      /* 账号列表仅超管侧栏入口；详情仍允许房主/代理从房间等深链进入 */
      { path: 'agents', name: 'agents', component: () => import('@/views/AgentManageView.vue'), meta: { roles: ['ADMIN'] } },
      { path: 'agents/:id', name: 'agent-detail', component: () => import('@/views/AgentDetailView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] } },
      { path: 'risk', name: 'risk', component: () => import('@/views/RiskView.vue'), meta: { roles: ['ADMIN', 'BRANCH'] } },
      { path: 'logs', name: 'logs', component: () => import('@/views/LogView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'AGENT', 'PROXY'] } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const store = useAdminStore()

  if (store.token && !store.profile) {
    try {
      const user = await http.get<AdminProfile, AdminProfile>('/users/me')
      if (!staffRoles.includes(user.role as typeof staffRoles[number])) {
        store.logout()
      } else {
        store.setAuth(user, store.token)
      }
    } catch {
      store.logout()
    }
  }

  if (!to.meta.public && !store.isLoggedIn) return { name: 'login' }
  if (to.name === 'login' && store.isLoggedIn) return { path: '/' }

  const roles = to.meta.roles as string[] | undefined
  if (roles?.length && store.profile && !roles.includes(store.profile.role)) {
    return { name: 'dashboard' }
  }
})

interface AdminProfile { id: string; uid: string; username: string; nickname: string; role: string }

export default router
