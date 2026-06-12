<template>
  <!-- 大厅装饰层 -->
  <div class="lobby-deco" aria-hidden="true">
    <img class="lobby-deco-crown" src="/images/crown-emblem.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-tl" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-tr" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-bl" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-br" src="/images/corner-flourish.png" alt="">
  </div>

  <!-- 顶角按钮 -->
  <button class="lobby-back" @click="router.back()" aria-label="返回"></button>
  <button class="lobby-logout" @click="doLogout" aria-label="退出登录"></button>

  <div class="page lobby-page lobby-bg">
    <div class="page-body">
      <h1 class="lobby-title">游 戏 大 厅</h1>

      <!-- 余额展示条 -->
      <div class="lobby-balance-bar">
        <span class="lb-label">账户余额</span>
        <span class="lb-value">
          <span v-if="walletStore.loading">—</span>
          <span v-else>{{ walletStore.balance.toLocaleString('en-US') }}</span>
        </span>
        <span class="lb-unit">积分</span>
        <button class="lb-refresh" @click="walletStore.fetchBalance()" :disabled="walletStore.loading">
          ↻
        </button>
      </div>

      <!-- 跑马灯 -->
      <div class="lobby-marquee">
        <div class="lm-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M3 10v4l7 3V7L3 10z"/><path d="M10 7l8-3v16l-8-3"/><path d="M6 17v2a1.5 1.5 0 0 0 3 0v-1"/></svg>
        </div>
        <div class="lm-track-wrap">
          <div class="lm-track">
            <span v-for="(n, i) in notices" :key="i">{{ n }}&nbsp;&nbsp;&nbsp;&nbsp;</span>
          </div>
        </div>
      </div>

      <!-- 游戏列表 -->
      <div class="games-list">
        <!-- 后端游戏（实时数据） -->
        <div
          v-for="game in onlineGames"
          :key="game.code"
          class="game-card"
          @click="onApiGameClick(game)"
        >
          <div class="gc-frame">
            <div class="gc-icon">
              <img
                v-if="game.coverUrl"
                :src="game.coverUrl"
                :alt="game.name"
                @error="($event.target as HTMLImageElement).style.display='none'"
              >
              <svg v-else viewBox="0 0 48 48" class="gc-svg">
                <circle cx="24" cy="24" r="20" fill="rgba(200,160,40,0.15)" stroke="#c8a028" stroke-width="1.5"/>
                <text x="24" y="30" text-anchor="middle" fill="#e8c032" font-size="14">🎮</text>
              </svg>
            </div>
            <div class="gc-info">
              <div class="gc-name">{{ game.name }}</div>
              <div class="gc-desc">
                <template v-if="game.category === 'SLOT'">即 进 即 转 · 随 时 开 玩</template>
                <template v-else>彩票游戏</template>
              </div>
            </div>
            <div v-if="game.category === 'SLOT'" class="gc-tag">热 门</div>
          </div>
        </div>

        <!-- 静态展示游戏（即将上线） -->
        <div
          v-for="game in staticGames"
          :key="game.key"
          class="game-card"
          @click="toast(`${game.name}  即将上线，敬请期待！`)"
        >
          <div class="gc-frame">
            <div class="gc-icon">
              <img
                v-if="game.iconImg"
                :src="game.iconImg"
                :alt="game.name"
                @error="($event.target as HTMLImageElement).style.display='none'"
              >
            </div>
            <div class="gc-info">
              <div class="gc-name">{{ game.name }}</div>
              <div class="gc-desc">{{ game.desc }}</div>
            </div>
            <div v-if="game.tag" class="gc-tag">{{ game.tag }}</div>
            <div v-if="game.type === 'lottery'" class="gc-countdown">
              <span class="gc-issue">{{ countdowns[game.key] }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <TabBar />
  <AppModal
    :visible="logoutModal"
    title="退出登录"
    message="确定要退出当前账号吗？"
    :showCancel="true"
    @ok="confirmLogout"
    @cancel="logoutModal = false"
  />
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useWalletStore } from '@/stores/wallet'
import { useToast } from '@/composables/useToast'
import { gamesApi, type GameItem } from '@/api/games'
import TabBar from '@/components/TabBar.vue'
import AppModal from '@/components/AppModal.vue'
import '@/assets/game-lobby.css'

const router = useRouter()
const userStore = useUserStore()
const walletStore = useWalletStore()
const { toast } = useToast()

const logoutModal = ref(false)

// 后端实时游戏
const onlineGames = ref<GameItem[]>([])

const notices = [
  '🏆 恭喜 VIP 会员 王***享 喜获大奖 88,888 积分',
  '🎉 平台持续更新中，更多游戏即将上线！',
  '💰 每日签到可领取积分奖励，快来参与吧！',
]

// 静态占位游戏（尚未接入后端）
const staticGames = [
  { key: 'ssc',     name: '时时彩',   desc: '5 位数字 · 10 分一期',  tag: '',      type: 'lottery', intervalSec: 600, iconImg: '/images/games/ssc.png' },
  { key: 'speed-racing', name: '极速赛车', desc: '1-10 号 · 1 分一期', tag: '新 品', type: 'lottery', intervalSec: 60, iconImg: '/images/games/speed-racing.png' },
  { key: 'bjsc',    name: '北京赛车', desc: '10 选号 · 5 分一期',     tag: '',      type: 'lottery', intervalSec: 300, iconImg: '/images/games/bjsc.png' },
  { key: 'lhc',     name: '六合彩',   desc: '49 选 7 · 1 分一期',     tag: '',      type: 'lottery', intervalSec: 60,  iconImg: '/images/games/hk-mark6.png' },
  { key: 'kuai3',   name: '极速快三', desc: '3 颗骰子 · 1 分一期',    tag: '',      type: 'lottery', intervalSec: 60,  iconImg: '/images/games/kuai3.png' },
]

// 实时倒计时（响应式 reactive 对象）
const countdowns = reactive<Record<string, string>>({})

function refreshCountdowns() {
  for (const g of staticGames) {
    if (g.type !== 'lottery' || !g.intervalSec) continue
    const rem = g.intervalSec - (Math.floor(Date.now() / 1000) % g.intervalSec)
    const m = Math.floor(rem / 60).toString().padStart(2, '0')
    const s = (rem % 60).toString().padStart(2, '0')
    countdowns[g.key] = `${m}:${s}`
  }
}

let timer: ReturnType<typeof setInterval>

onMounted(async () => {
  walletStore.fetchBalance()
  refreshCountdowns()
  timer = setInterval(refreshCountdowns, 1000)
  try {
    onlineGames.value = await gamesApi.list()
  } catch {
    // 后端不可达时不阻断大厅渲染
  }
})

onUnmounted(() => clearInterval(timer))

function onApiGameClick(game: GameItem) {
  if (game.code === 'lucky-wheel') {
    router.push('/game/lucky-wheel')
    return
  }
  if (game.code === 'ffc') {
    toast(`${game.name}  彩票模块即将上线！`)
    return
  }
  toast(`${game.name}  即将开放，敬请期待！`)
}

function doLogout() {
  logoutModal.value = true
}

function confirmLogout() {
  userStore.logout()
  logoutModal.value = false
  router.push('/login')
}
</script>

<style scoped>
/* 余额展示条 */
.lobby-balance-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 16px 12px;
  padding: 10px 16px;
  background: linear-gradient(135deg, rgba(40,28,8,0.9), rgba(20,14,4,0.95));
  border: 1px solid rgba(200,160,40,0.35);
  border-radius: 12px;
}
.lb-label { color: rgba(255,255,255,0.5); font-size: 12px; }
.lb-value { color: #e8c032; font-size: 22px; font-weight: 700; flex: 1; text-align: right; }
.lb-unit  { color: rgba(255,255,255,0.4); font-size: 12px; }
.lb-refresh {
  background: none; border: none; color: rgba(200,160,40,0.7);
  font-size: 18px; cursor: pointer; line-height: 1; padding: 0 4px;
  transition: transform 0.3s;
}
.lb-refresh:active { transform: rotate(180deg); }
</style>
