<template>
  <!-- 大厅专属屏幕级装饰层（与原型一致） -->
  <div class="lobby-deco" aria-hidden="true">
    <img class="lobby-deco-crown" src="/images/crown-emblem.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-tl" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-tr" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-bl" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-br" src="/images/corner-flourish.png" alt="">
  </div>

  <!-- 屏幕级 fixed 顶角按钮 -->
  <button class="lobby-back" @click="router.back()" aria-label="返回"></button>
  <button class="lobby-logout" @click="openLogout" aria-label="退出登录"></button>

  <div class="page lobby-page">
    <div class="page-body">

      <h1 class="lobby-title">游 戏 大 厅</h1>

      <!-- 跑马灯：玩家喜报（横向无缝滚动，内容双份拼接） -->
      <div class="lobby-marquee">
        <div class="lm-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M3 10v4l7 3V7L3 10z"/>
            <path d="M10 7l8-3v16l-8-3"/>
            <path d="M6 17v2a1.5 1.5 0 0 0 3 0v-1"/>
          </svg>
        </div>
        <div class="lm-track-wrap">
          <div class="lm-track" @click="toast('恭喜！祝您也好运连连')">
            <template v-for="dup in 2">
              <template v-for="(it, i) in marqueeItems" :key="`${dup}-${i}`">
                <span class="lm-item" data-type="win">
                  <span class="lm-emoji">🎉</span>
                  <span class="lm-text" v-html="it"></span>
                </span>
                <span class="lm-sep">◆</span>
              </template>
            </template>
          </div>
        </div>
      </div>

      <!-- 游戏列表：一行一张，结构与原型 game-lobby.js 渲染输出一致 -->
      <div class="games-list">
        <div
          v-for="g in GAMES"
          :key="g.key"
          class="game-card"
          :data-game="g.key"
          @click="onGameClick(g)"
        >
          <div v-if="g.tag" class="gc-tag">{{ g.tag }}</div>

          <div class="gc-main">
            <div class="gc-icon">
              <img v-if="g.iconImg" :src="g.iconImg" alt="">
              <svg v-else viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" v-html="g.svg"></svg>
            </div>

            <div :class="['gc-name', g.name.length >= 5 ? 'gc-name-tight' : '']">{{ g.name }}</div>

            <div class="gc-status">
              <div class="gc-issue">第 <span class="gc-issue-no">{{ cardState[g.key]?.issue ?? '000000' }}</span> 期</div>
              <div :class="['gc-countdown', cardState[g.key]?.cdClass]">{{ cardState[g.key]?.cdText ?? '--:--' }}</div>
            </div>
          </div>

          <div class="gc-foot">
            <div class="gc-foot-issue"><span class="gc-foot-issue-no">{{ cardState[g.key]?.prevIssue ?? '000000' }}</span> 期</div>
            <div class="gc-foot-numbers"></div>
          </div>
        </div>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <TabBar />
  
  <PgLoading v-if="showPgLoading" :progress="pgLoadingProgress" />
  <MahjongCover v-if="showMahjongCover" @start="enterMahjongGame" />
  <QueenCover v-if="showQueenCover" @start="enterQueenGame" />
  <LabaCover v-if="showLabaCover" @start="enterLabaGame" />
  <SlotsCover v-if="showSlotsCover" @start="enterSlotsGame" />
  <BcbmCover v-if="showBcbmCover" @start="enterBcbmGame" />
  <LonghuCover v-if="showLonghuCover" @start="enterLonghuGame" />
  <WheelCover v-if="showWheelCover" @start="enterWheelGame" />
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { gamesApi } from '@/api/games'
import TabBar from '@/components/TabBar.vue'
import PgLoading from '@/components/PgLoading.vue'
import MahjongCover from '@/components/MahjongCover.vue'
import QueenCover from '@/components/QueenCover.vue'
import LabaCover from '@/components/LabaCover.vue'
import SlotsCover from '@/components/SlotsCover.vue'
import BcbmCover from '@/components/BcbmCover.vue'
import LonghuCover from '@/components/LonghuCover.vue'
import WheelCover from '@/components/WheelCover.vue'
import '@/assets/game-lobby.css'

useBodyClass('lobby-bg')

const router = useRouter()
const userStore = useUserStore()
const { toast } = useToast()


/* ===== 游戏列表（与原型 game-lobby.js 的 GAMES 一致） =====
 * type: 'lottery' 定时开奖（期号+倒计时）；'instant' 即时开局
 * route: 已接入后端的游戏跳转路由；无 route 的卡片点击提示「即将上线」 */
interface LobbyGame {
  key: string
  name: string
  tag?: string
  type: 'lottery' | 'instant'
  intervalSec?: number
  iconImg?: string
  svg?: string
  route?: string
  backendCode?: string
}

const GAMES: LobbyGame[] = [
  {
    key: 'mahjong', name: '麻将胡了', tag: '热 门', type: 'instant',
    iconImg: '/images/games/mahjong.png',
    route: '/game/slot/slots-mahjong', backendCode: 'slots-mahjong',
  },
  {
    key: 'queen', name: '赏金女王', tag: '热 门', type: 'instant',
    iconImg: '/images/games/queen.png',
    route: '/game/slot/slots-queen', backendCode: 'slots-queen',
  },
  {
    key: 'ssc', name: '时时彩', type: 'lottery', intervalSec: 600,
    iconImg: '/images/games/ssc.png',
    route: '/game/lottery/ssc', backendCode: 'ssc',
  },
  {
    key: 'ffc', name: '分分彩', type: 'lottery', intervalSec: 60,
    iconImg: '/images/games/ffc.png',
    route: '/game/lottery/ffc', backendCode: 'ffc',
  },
  {
    key: 'speed-racing', name: '极速赛车', type: 'lottery', intervalSec: 60,
    iconImg: '/images/games/speed-racing.png',
    route: '/game/lottery/speed-racing', backendCode: 'speed-racing',
  },
  {
    key: 'bjsc', name: '北京赛车', type: 'lottery', intervalSec: 300,
    iconImg: '/images/games/bjsc.png',
    route: '/game/lottery/bjsc', backendCode: 'bjsc',
  },
  {
    key: 'speed-boat', name: '极速飞艇', type: 'lottery', intervalSec: 60,
    iconImg: '/images/games/speed-boat.png',
  },
  {
    key: 'lhc', name: '六合彩', type: 'lottery', intervalSec: 60,
    iconImg: '/images/games/hk-mark6.png',
  },
  {
    key: 'kuai3', name: '极速快三', type: 'lottery', intervalSec: 60,
    iconImg: '/images/games/kuai3.png',
    route: '/game/lottery/kuai3', backendCode: 'kuai3',
  },
  {
    key: 'zhajinhua', name: '炸金花', tag: '热 门', type: 'lottery', intervalSec: 60,
    iconImg: '/images/games/zhajinhua.png',
  },
  {
    key: 'douniu', name: '斗牛', type: 'lottery', intervalSec: 63,
    iconImg: '/images/games/douniu.png',
  },
  {
    key: 'baccarat', name: '百家乐', tag: '热 门', type: 'lottery', intervalSec: 60,
    iconImg: '/images/games/baccarat.png',
    route: '/game/table/baccarat', backendCode: 'baccarat',
  },
  {
    key: 'slots', name: '老虎机', type: 'instant',
    iconImg: '/images/games/slots.png',
    route: '/game/slot/slots-classic', backendCode: 'slots-classic',
  },
  {
    key: 'bcbm', name: '奔驰宝马', tag: '新 品', type: 'instant',
    iconImg: '/images/games/bcbm-icon.png',
    route: '/game/arcade/bcbm', backendCode: 'bcbm',
  },
  {
    key: 'laba', name: '经典拉霸', tag: '新 品', type: 'instant',
    iconImg: '/images/games/laba-icon.png',
    route: '/game/laba', backendCode: 'slots-classic',
  },
  {
    key: 'longhu', name: '龙虎斗', tag: '新 品', type: 'instant',
    iconImg: '/images/games/longhu-icon.png',
    route: '/game/table/dragon-tiger', backendCode: 'dragon-tiger',
  },
  {
    key: 'lucky-wheel', name: '幸运转盘', type: 'instant',
    iconImg: '/images/games/lucky-wheel-icon.png',
    route: '/game/lucky-wheel', backendCode: 'lucky-wheel',
  },
]

/* ===== 跑马灯喜报（与原型同款随机模板） ===== */
const NAME_PREFIX = ['黄金', '银河', '夜行', '闪电', '深海', '炽焰', '寒霜', '疾风', '幻影', '星辰', '破晓', '孤狼', '雷霆', '流沙', '沧海']
const NAME_SUFFIX = ['猎手', '行者', '刺客', '骑士', '大师', '旅人', '贵族', '王者', '使者', '武士', '船长', '法师', '剑客', '少年', '侠客']

const marqueeItems = ref<string[]>([])

function fmt(n: number) { return n.toLocaleString('en-US') }
function randName() {
  return NAME_PREFIX[Math.floor(Math.random() * NAME_PREFIX.length)]
    + NAME_SUFFIX[Math.floor(Math.random() * NAME_SUFFIX.length)]
}
function randGame() {
  return GAMES[Math.floor(Math.random() * GAMES.length)].name.replace(/\s+/g, '')
}
function randAmount() {
  const r = Math.random()
  if (r < 0.55) return 500 + Math.floor(Math.random() * 5000)
  if (r < 0.85) return 5000 + Math.floor(Math.random() * 30000)
  return 30000 + Math.floor(Math.random() * 70000)
}
function buildMarquee() {
  const tpls = [
    () => `${randName()} 在「${randGame()}」赢得 <span class="num">${fmt(randAmount())}</span> 积分`,
    () => `${randName()} 在「${randGame()}」连赢 ${3 + Math.floor(Math.random() * 8)} 场获 <span class="num">${fmt(randAmount())}</span> 积分`,
    () => `${randName()} 单场最大赢取 <span class="num">${fmt(randAmount())}</span> 积分`,
    () => `${randName()} 累计有效投注突破 <span class="num">${fmt(50 + Math.floor(Math.random() * 200))}</span> 万`,
    () => `${randName()} 解锁日积月累终极豪礼 <span class="num">${fmt(randAmount())}</span> 积分`,
  ]
  const items: string[] = []
  for (let i = 0; i < 6; i++) {
    items.push(tpls[Math.floor(Math.random() * tpls.length)]())
  }
  marqueeItems.value = items
}

/* ===== 期号 / 倒计时滴答（与原型规则一致） ===== */
const DRAW_SEC = 2
const FREEZE_SEC = 5

interface CardState { issue: string; prevIssue: string; cdText: string; cdClass: string }
const cardState = reactive<Record<string, CardState>>({})

function todayStartMs() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
function pad(n: number, w: number) { return String(n).padStart(w, '0') }
function fmtIssue6(seq: number) { return pad(Math.max(1, seq), 6) }
function fmtMmss(sec: number) {
  const s = Math.max(0, Math.ceil(sec))
  return pad(Math.floor(s / 60), 2) + ':' + pad(s % 60, 2)
}

function tickAll() {
  for (const g of GAMES) {
    if (g.type !== 'lottery' || !g.intervalSec) {
      cardState[g.key] = { issue: '— —', prevIssue: '— —', cdText: '实时进行', cdClass: 'is-instant' }
      continue
    }
    const interval = g.intervalSec
    const elapsed = (Date.now() - todayStartMs()) / 1000
    const seq = Math.floor(elapsed / interval) + 1
    const r = interval - (elapsed % interval)

    let cdText: string
    let cdClass = ''
    if (r > interval - DRAW_SEC) {
      cdText = '开奖中'; cdClass = 'is-drawing'
    } else if (r <= FREEZE_SEC) {
      cdText = '封盘中'; cdClass = 'is-freeze'
    } else {
      cdText = fmtMmss(r)
    }
    cardState[g.key] = {
      issue: fmtIssue6(seq),
      prevIssue: seq > 1 ? fmtIssue6(seq - 1) : '— —',
      cdText,
      cdClass,
    }
  }
}

/* ===== 后端在线游戏（决定卡片是否可进入） ===== */
const onlineCodes = ref<Set<string>>(new Set())

const showPgLoading = ref(false)
const pgLoadingProgress = ref(0)
const showMahjongCover = ref(false)
let currentMahjongRoute = ''
const showQueenCover = ref(false)
let currentQueenRoute = ''
const showLabaCover = ref(false)
let currentLabaRoute = ''
const showSlotsCover = ref(false)
let currentSlotsRoute = ''
const showBcbmCover = ref(false)
let currentBcbmRoute = ''
const showLonghuCover = ref(false)
let currentLonghuRoute = ''
const showWheelCover = ref(false)
let currentWheelRoute = ''

function enterMahjongGame() {
  showMahjongCover.value = false
  if (currentMahjongRoute) {
    router.push(currentMahjongRoute)
  }
}

function enterQueenGame() {
  showQueenCover.value = false
  if (currentQueenRoute) {
    router.push(currentQueenRoute)
  }
}

function enterLabaGame() {
  showLabaCover.value = false
  if (currentLabaRoute) {
    router.push(currentLabaRoute)
  }
}

function enterSlotsGame() {
  showSlotsCover.value = false
  if (currentSlotsRoute) {
    router.push(currentSlotsRoute)
  }
}

function enterBcbmGame() {
  showBcbmCover.value = false
  if (currentBcbmRoute) {
    router.push(currentBcbmRoute)
  }
}

function enterLonghuGame() {
  showLonghuCover.value = false
  if (currentLonghuRoute) {
    router.push(currentLonghuRoute)
  }
}

function enterWheelGame() {
  showWheelCover.value = false
  if (currentWheelRoute) {
    router.push(currentWheelRoute)
  }
}

const pgAnimatedGames = ['mahjong', 'queen', 'slots', 'bcbm', 'laba', 'longhu', 'lucky-wheel']

function onGameClick(g: LobbyGame) {
  // 检查游戏是否可玩（有路由，且后端在线或后端未加载）
  const isPlayable = g.route && (onlineCodes.value.size === 0 || !g.backendCode || onlineCodes.value.has(g.backendCode))

  if (!isPlayable) {
    toast(`${g.name.replace(/\s+/g, '')} · 即将上线`)
    return
  }

  // 如果是需要展示 PG 动画的游戏
  if (pgAnimatedGames.includes(g.key)) {
    showPgLoading.value = true
    pgLoadingProgress.value = 0
    
    // 模拟加载进度
    const interval = setInterval(() => {
      pgLoadingProgress.value += Math.random() * 15
      if (pgLoadingProgress.value >= 100) {
        pgLoadingProgress.value = 100
        clearInterval(interval)
        
        // 加载完成后延迟一小段时间
        setTimeout(() => {
          showPgLoading.value = false
          if (g.key === 'mahjong') {
            // 麻将胡了有专属封面
            currentMahjongRoute = g.route || ''
            showMahjongCover.value = true
          } else if (g.key === 'queen') {
            // 赏金女王有专属封面
            currentQueenRoute = g.route || ''
            showQueenCover.value = true
          } else if (g.key === 'laba') {
            currentLabaRoute = g.route || ''
            showLabaCover.value = true
          } else if (g.key === 'slots') {
            currentSlotsRoute = g.route || ''
            showSlotsCover.value = true
          } else if (g.key === 'bcbm') {
            currentBcbmRoute = g.route || ''
            showBcbmCover.value = true
          } else if (g.key === 'longhu') {
            currentLonghuRoute = g.route || ''
            showLonghuCover.value = true
          } else if (g.key === 'lucky-wheel') {
            currentWheelRoute = g.route || ''
            showWheelCover.value = true
          } else {
            // 其他游戏直接跳转
            router.push(g.route!)
          }
        }, 500)
      }
    }, 300)
    return
  }

  // 其他不需要 PG 动画的游戏（如彩票类）直接跳转
  router.push(g.route)
}

let timer: ReturnType<typeof setInterval>

onMounted(async () => {
  buildMarquee()
  tickAll()
  timer = setInterval(tickAll, 1000)
  try {
    const list = await gamesApi.list()
    onlineCodes.value = new Set(list.map(g => g.code))
  } catch {
    // 后端不可达时不阻断大厅渲染
  }
})

onUnmounted(() => clearInterval(timer))

function openLogout() {
  if (window.confirm('确定要退出当前账号吗？')) {
    userStore.logout()
    window.location.replace('/login')
  }
}
</script>
