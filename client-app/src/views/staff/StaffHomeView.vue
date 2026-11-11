<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page staff-console-page home-page">
    <div class="app-bar">
      <div class="title">管理中心</div>
      <div class="right sc-bar-act" @click="load">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body home-body">
      <!-- 仅管理员/房主停留本页；代理/子账号→大厅，客服→上下分 -->
      <div class="home-hello">
        {{ staff.profile?.nickname || '—' }}
        <span>{{ roleLabel }}</span>
      </div>

      <section class="home-kpi">
        <div class="home-kpi-top">
          <div>
            <div class="home-kpi-label">今日庄家盈亏</div>
            <div class="home-kpi-num" :class="pnlClass(heroPnl)">{{ fmtSigned(heroPnl) }}</div>
          </div>
          <button type="button" class="home-kpi-btn" @click="go('staff-report')">报表摘要</button>
        </div>
        <div class="home-kpi-row">
          <div>
            <em>上分</em>
            <b class="up">{{ fmt(summary?.upAmount) }}</b>
          </div>
          <div>
            <em>下分</em>
            <b class="down">{{ fmt(summary?.downAmount) }}</b>
          </div>
          <div>
            <em>流水</em>
            <b>{{ fmt(summary?.betFlow) }}</b>
          </div>
        </div>
        <div class="home-kpi-foot">
          房间 {{ roomCount || 0 }} · 活跃 {{ summary?.activePlayers ?? 0 }}
          <template v-if="weekSummary"> · 本周盈亏 {{ fmtSigned(weekPnl) }}</template>
        </div>
      </section>

      <section class="home-block">
        <div class="home-block-hd">待办</div>
        <button
          v-if="riskUnhandled > 0"
          type="button"
          class="home-todo hot"
          @click="go('staff-risk')"
        >
          <span>
            <b>风控待处理</b>
            <em>{{ riskUnhandled }} 条</em>
          </span>
          <span class="home-todo-a">›</span>
        </button>
        <div v-else class="home-todo idle">
          <span><b>暂无待办</b></span>
        </div>
      </section>

      <section class="home-block">
        <div class="home-block-hd">快操作</div>
        <nav class="home-nav">
          <button type="button" class="home-nav-item" @click="go('staff-rooms')">
            <span class="home-nav-t">房间</span>
            <span class="home-nav-m">{{ roomCount > 0 ? `${roomCount} 间` : '' }}</span>
            <span class="home-nav-a">›</span>
          </button>
          <button type="button" class="home-nav-item" @click="go('staff-agents')">
            <span class="home-nav-t">代理上下分</span>
            <span class="home-nav-m"></span>
            <span class="home-nav-a">›</span>
          </button>
          <button v-if="!staff.isCs" type="button" class="home-nav-item" @click="go('staff-activities')">
            <span class="home-nav-t">活动</span>
            <span class="home-nav-m"></span>
            <span class="home-nav-a">›</span>
          </button>
          <button type="button" class="home-nav-item" @click="go('staff-report')">
            <span class="home-nav-t">报表</span>
            <span class="home-nav-m"></span>
            <span class="home-nav-a">›</span>
          </button>
        </nav>
      </section>

      <button type="button" class="home-logout" @click="onLogout">退出登录</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStaffStore } from '@/stores/staff'
import {
  staffConsoleApi,
  type StaffReportSummary,
} from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { formatMoney, formatSignedMoney, staffRoleLabel } from '@gamebox/shared'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const loading = ref(false)
const summary = ref<StaffReportSummary | null>(null)
const weekSummary = ref<StaffReportSummary | null>(null)
const roomCount = ref(0)
const riskUnhandled = ref(0)

const roleLabel = computed(() => staffRoleLabel(staff.role, staff.parentRole))

const heroPnl = computed(() => Number(summary.value?.housePnl || 0))
const weekPnl = computed(() => Number(weekSummary.value?.housePnl || 0))

function go(name: string) {
  router.push({ name })
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

async function onLogout() {
  await staff.logout()
  await router.replace({ name: 'login' })
}

async function load() {
  loading.value = true
  try {
    await Promise.all([
      staffConsoleApi.reportSummary({ range: 'today' }).then((s) => { summary.value = s }).catch(() => { summary.value = null }),
      staffConsoleApi.rooms().then((list) => { roomCount.value = list?.length || 0 }).catch(() => { roomCount.value = 0 }),
      staffConsoleApi.reportSummary({ range: 'thisweek' }).then((s) => { weekSummary.value = s }).catch(() => { weekSummary.value = null }),
      staffConsoleApi.riskSummary().then((s) => { riskUnhandled.value = s.unhandled || 0 }).catch(() => { riskUnhandled.value = 0 }),
    ])
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void router.replace({ name: staff.homeRouteName() })
})
</script>

<style scoped>
.home-page {
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
.home-page :deep(.app-bar) {
  width: 100%;
}
.home-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  padding-top: 4px !important;
  box-sizing: border-box;
}

.home-hello {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 4px 2px 12px;
  font-family: 'Noto Serif SC', serif;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #fff4c2;
}
.home-hello span {
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 2px;
  color: rgba(244, 211, 107, 0.55);
}

.home-kpi {
  margin-bottom: 14px;
  padding: 16px 14px 14px;
  border-radius: 16px;
  border: 1px solid rgba(212, 175, 55, 0.28);
  background:
    radial-gradient(120% 80% at 100% 0%, rgba(244, 211, 107, 0.12), transparent 55%),
    linear-gradient(165deg, rgba(40, 28, 12, 0.95), rgba(12, 10, 8, 0.92));
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}
.home-kpi-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.home-kpi-label {
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(244, 211, 107, 0.55);
}
.home-kpi-num {
  margin-top: 4px;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.home-kpi-num.up { color: #7dffb2; }
.home-kpi-num.down { color: #ff8e8e; }
.home-kpi-btn {
  flex-shrink: 0;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(244, 211, 107, 0.4);
  background: rgba(0, 0, 0, 0.25);
  color: var(--gold-bright, #f4d36b);
  font-size: 12px;
  cursor: pointer;
}
.home-kpi-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 14px;
}
.home-kpi-row > div {
  padding: 10px 8px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.28);
  text-align: center;
}
.home-kpi-row em {
  display: block;
  font-style: normal;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.45);
  margin-bottom: 4px;
}
.home-kpi-row b {
  font-size: 15px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
}
.home-kpi-row b.up { color: #7dffb2; }
.home-kpi-row b.down { color: #ff8e8e; }
.home-kpi-foot {
  margin-top: 12px;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(244, 211, 107, 0.42);
}

.home-block {
  margin-bottom: 14px;
}
.home-block-hd {
  margin: 0 2px 8px;
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(244, 211, 107, 0.5);
}
.home-todo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 14px 14px;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.22);
  background: rgba(16, 12, 8, 0.85);
  color: #fff4c2;
  cursor: pointer;
  text-align: left;
}
.home-todo.hot {
  border-color: rgba(255, 120, 120, 0.45);
  background: linear-gradient(90deg, rgba(80, 20, 20, 0.55), rgba(16, 12, 8, 0.9));
}
.home-todo.idle {
  cursor: default;
  opacity: 0.75;
}
.home-todo b {
  display: block;
  font-size: 14px;
  font-weight: 650;
}
.home-todo em {
  display: block;
  margin-top: 2px;
  font-style: normal;
  font-size: 12px;
  color: rgba(244, 211, 107, 0.5);
}
.home-todo.hot em { color: #ffb4b4; }
.home-todo-a {
  font-size: 20px;
  color: rgba(244, 211, 107, 0.45);
}

.home-nav {
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.22);
  background: rgba(16, 12, 8, 0.85);
  overflow: hidden;
}
.home-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  border: 0;
  border-bottom: 1px solid rgba(212, 175, 55, 0.12);
  background: transparent;
  color: #fff4c2;
  cursor: pointer;
  text-align: left;
}
.home-nav-item:last-child { border-bottom: 0; }
.home-nav-t {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
}
.home-nav-m {
  font-size: 12px;
  color: rgba(244, 211, 107, 0.45);
}
.home-nav-a {
  font-size: 18px;
  color: rgba(244, 211, 107, 0.4);
}

.home-logout {
  margin: 8px 0 24px;
  width: 100%;
  height: 44px;
  border-radius: 12px;
  border: 1px solid rgba(255, 120, 120, 0.35);
  background: rgba(60, 16, 16, 0.35);
  color: #ffb4b4;
  font-size: 14px;
  cursor: pointer;
}
</style>
