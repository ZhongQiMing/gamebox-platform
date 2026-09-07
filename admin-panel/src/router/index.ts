import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { staffMatchesRoles } from '@gamebox/shared'
import { useAdminStore } from '@/stores/admin'
import http from '@/api/http'

const staffRoles = ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY', 'CS'] as const

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('@/layout/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'] } },
      { path: 'rooms', name: 'rooms', component: () => import('@/views/RoomsView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'] } },
      { path: 'rooms/general/:id', name: 'general-detail', component: () => import('@/views/GeneralDetailView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'GENERAL'] } },
      { path: 'rooms/:id', name: 'room-detail', component: () => import('@/views/RoomDetailView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'] } },
      {
        path: 'players',
        name: 'players',
        component: () => import('@/views/PlayerCenterView.vue'),
        meta: { roles: ['ADMIN', 'BRANCH'] },
      },
      {
        /* 代理/总代仍走房间里的玩家列表，带 roomId 的老链接照旧跳过去 */
        path: 'players/in-room',
        name: 'players-in-room',
        redirect: (to) => {
          const roomId = typeof to.query.roomId === 'string' ? to.query.roomId : ''
          const q = typeof to.query.q === 'string' ? to.query.q : undefined
          if (roomId) {
            return {
              name: 'room-detail',
              params: { id: roomId },
              query: { tab: 'players', ...(q ? { q } : {}) },
            }
          }
          return { name: 'rooms' }
        },
      },
      { path: 'reports', name: 'reports', component: () => import('@/views/ReportsView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'] } },
      { path: 'recharge', name: 'recharge', component: () => import('@/views/RechargeReviewView.vue'), meta: { roles: ['AGENT', 'CS'] } },
      { path: 'cs-staff', name: 'cs-staff', component: () => import('@/views/CsStaffManageView.vue'), meta: { roles: ['AGENT'] } },
      { path: 'games', name: 'games', component: () => import('@/views/GameManageView.vue'), meta: { roles: ['ADMIN'] } },
      { path: 'control', name: 'control', component: () => import('@/views/ControlView.vue'), meta: { roles: ['ADMIN'] } },
      { path: 'live', name: 'live', component: () => import('@/views/LiveDrawsView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'] } },
      { path: 'rebate', name: 'rebate', component: () => import('@/views/RebatePolicyView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'] } },
      { path: 'settle', name: 'settle', component: () => import('@/views/SettleCenterView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'GENERAL'] } },
      { path: 'general-settle', redirect: { name: 'settle' } },
      /* 账号列表：管理/总监开总监与总代 */
      { path: 'agents', name: 'agents', component: () => import('@/views/AgentManageView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'GENERAL'] } },
      { path: 'agents/:id', name: 'agent-detail', component: () => import('@/views/AgentDetailView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'] } },
      { path: 'risk', name: 'risk', component: () => import('@/views/RiskView.vue'), meta: { roles: ['ADMIN', 'BRANCH'] } },
      { path: 'fund-recon', name: 'fund-recon', component: () => import('@/views/FundReconView.vue'), meta: { roles: ['ADMIN'] } },
      { path: 'logs', name: 'logs', component: () => import('@/views/LogView.vue'), meta: { roles: ['ADMIN', 'BRANCH', 'GENERAL', 'AGENT', 'PROXY'] } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(async (to) => {
  const store = useAdminStore()

  /*
   * 同一标签刷新后内存里的 profile 没了，但会话 Cookie 还在（JS 读不到它）。
   * sessionStorage 里有「本标签登录过」才去问服务端；关标签再开标记没了，直接当登出。
   */
  if (store.hadSession && !store.profile) {
    try {
      const user = await http.get<AdminProfile, AdminProfile>('/users/me')
      if (!staffRoles.includes(user.role as typeof staffRoles[number])) {
        store.logout()
      } else {
        store.setAuth(user)
      }
    } catch {
      store.logout()
    }
  }

  if (!to.meta.public && !store.isLoggedIn) return { name: 'login' }
  if (to.name === 'login' && store.isLoggedIn) {
    return store.profile?.role === 'CS' ? { name: 'recharge' } : { path: '/' }
  }

  const roles = to.meta.roles as string[] | undefined
  if (
    roles?.length
    && store.profile
    && !staffMatchesRoles(store.profile.role, roles, store.profile.parentRole)
  ) {
    return store.profile.role === 'CS' ? { name: 'recharge' } : { name: 'dashboard' }
  }

  if (store.profile?.role === 'CS' && (to.path === '/' || to.name === 'dashboard')) {
    return { name: 'recharge' }
  }
})

interface AdminProfile {
  id: string
  uid: string
  username: string
  nickname: string
  role: string
  parentId?: string | null
  parentRole?: string | null
}

export default router
