<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">实时开奖</div>
      <div class="right sc-bar-act" @click="refresh">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <div v-if="maintTip" class="ld-maint">{{ maintTip }}</div>

      <div class="sc-cards">
        <div class="sc-card">
          <div class="k">今日下注</div>
          <div class="v">{{ fmt(todayBet) }}</div>
        </div>
        <div class="sc-card">
          <div class="k">今日派彩</div>
          <div class="v">{{ fmt(todayPayout) }}</div>
        </div>
        <div class="sc-card">
          <div class="k">今日盈亏</div>
          <div class="v" :class="todayBet - todayPayout >= 0 ? '' : 'down'">
            {{ fmt(todayBet - todayPayout) }}
          </div>
        </div>
      </div>

      <div v-if="loading && !games.length" class="sp-empty">加载中…</div>
      <div v-else-if="!games.length" class="sp-empty">暂无开奖中的游戏</div>

      <template v-for="sec in sections" :key="sec.key">
        <template v-if="sec.games.length">
          <div class="sc-sec-title">{{ sec.title }}</div>

          <div v-for="g in sec.games" :key="g.code" class="sp-row">
            <div class="top">
              <div class="name">
                {{ g.name }}
                <span class="ld-phase" :class="phaseTone(g.phase)">{{ g.phaseLabel }}</span>
              </div>
              <div v-if="sec.key !== 'instant'" class="bal t">{{ countdown(g) }}</div>
            </div>

            <!-- 街机是一按一开，没有期号也没有倒计时，这两行摆出来只会是三个破折号 -->
            <template v-if="sec.key !== 'instant'">
              <div class="meta">当期 {{ g.issueNo || '—' }}</div>
              <div class="meta ld-draw-row">
                <span>上期 {{ g.lastIssueNo || '—' }} · 开出</span>
                <DrawNumbers :game-code="g.code" :draw="g.lastDraw" />
              </div>
              <div class="meta">
                当期下注 {{ fmt(g.currentBetAmount) }}（{{ g.currentBetCount }} 笔）
              </div>
            </template>

            <div class="meta">
              今日 {{ fmt(g.todayBetAmount) }} / 派彩 {{ fmt(g.todayPayout) }}
            </div>
          </div>
        </template>
      </template>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { formatMoney } from '@gamebox/shared'
import { staffConsoleApi, type StaffLiveDrawGame } from '@/api/staffConsole'
import DrawNumbers from '@/components/DrawNumbers.vue'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { useActiveInterval } from '@/composables/useActiveInterval'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const { toast } = useToast()

const loading = ref(false)
const games = ref<StaffLiveDrawGame[]>([])
const maintTip = ref('')
/** 本地跑秒，不必为了倒计时每秒打一次接口 */
const tick = ref(0)

const todayBet = computed(() => games.value.reduce((s, g) => s + Number(g.todayBetAmount || 0), 0))
const todayPayout = computed(() => games.value.reduce((s, g) => s + Number(g.todayPayout || 0), 0))

/**
 * 按玩法分三段。原先彩票、牌桌、街机混在一张长列表里，
 * 街机（水果机 / 奔驰宝马）是单人即开即玩，没有期号也没有倒计时，
 * 混进来只会显示一串破折号。
 */
const sections = computed(() => [
  {
    key: 'lottery',
    title: '彩 票',
    games: games.value.filter((g) => g.category === 'LOTTERY'),
  },
  {
    key: 'table',
    title: '牌 桌',
    games: games.value.filter((g) => g.category === 'TABLE'),
  },
  {
    key: 'instant',
    title: '街 机',
    games: games.value.filter((g) => g.category === 'ARCADE' || g.category === 'SLOT'),
  },
])

function fmt(n?: number) {
  return formatMoney(n ?? 0)
}

function phaseTone(phase: string) {
  if (phase === 'BETTING' || phase === 'OPEN') return 'on'
  if (phase === 'DRAWING' || phase === 'LOCKED') return 'wait'
  return ''
}

/** 倒计时按拉取时刻加上本地流逝的秒数，避免每秒请求 */
function countdown(g: StaffLiveDrawGame) {
  const left = Math.max(0, Math.floor(Number(g.remainSec || 0)) - tick.value)
  if (left <= 0) return '开奖中'
  const m = Math.floor(left / 60)
  const s = left % 60
  return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`
}

async function refresh() {
  loading.value = true
  try {
    const res = await staffConsoleApi.liveDraws()
    games.value = res?.games || []
    tick.value = 0
    maintTip.value = res?.maint?.windowActive
      ? `维护中（${res.maint.window} ${res.maint.timezone}），开奖暂停`
      : ''
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void refresh() })
useActiveInterval(() => { void refresh() }, 15000)
useActiveInterval(() => { tick.value += 1 }, 1000, { refreshOnResume: false })
</script>

<style scoped>
.ld-maint {
  margin-bottom: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
  font-size: 13px;
  line-height: 1.5;
}
.ld-phase {
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: rgba(148, 163, 184, 0.22);
  color: #64748b;
}
.ld-phase.on {
  background: rgba(22, 163, 74, 0.16);
  color: #16a34a;
}
.ld-phase.wait {
  background: rgba(245, 158, 11, 0.18);
  color: #b45309;
}
.ld-draw-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
