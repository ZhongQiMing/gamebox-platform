<template>
  <!-- 大厅专属屏幕级装饰层（与原型一致） -->
  <div class="lobby-deco" aria-hidden="true">
    <img class="lobby-deco-crown" src="/images/crown-emblem.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-tl" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-tr" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-bl" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-br" src="/images/corner-flourish.png" alt="">
  </div>

  <!-- 屏幕级 fixed 顶角按钮（退出在房间页，大厅不放） -->
  <button class="lobby-back" @click="onLobbyBack" aria-label="返回"></button>

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
          v-for="g in visibleGames"
          :key="g.key"
          class="game-card"
          :class="{ 'is-maint': isMaintenance(g) }"
          :data-game="g.key"
          @click="onGameClick(g)"
        >
          <div v-if="isMaintenance(g)" class="gc-tag gc-tag--maint">维 护</div>
          <div v-else-if="g.tag" class="gc-tag">{{ g.tag }}</div>

          <div class="gc-main">
            <div class="gc-icon">
              <img v-if="g.iconImg" :src="g.iconImg" alt="">
              <svg v-else viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" v-html="g.svg"></svg>
            </div>

            <div class="gc-name">{{ g.name }}</div>

            <div class="gc-status">
              <!-- 彩票/牌桌显示期号；即时游戏只显示「实时进行」 -->
              <div
                v-if="g.type === 'lottery' || g.type === 'table'"
                class="gc-issue"
                :title="cardState[g.key]?.issueFull || undefined"
              >
                第 <span class="gc-issue-no">{{ cardState[g.key]?.issue ?? '—' }}</span>
                {{ g.type === 'table' ? '局' : '期' }}
              </div>
              <div
                :class="[
                  'gc-countdown',
                  isMaintenance(g) ? 'is-freeze' : cardState[g.key]?.cdClass,
                ]"
              >
                {{
                  isMaintenance(g)
                    ? '维护中'
                    : (cardState[g.key]?.cdText ?? (g.type === 'instant' ? '实时进行' : '--:--'))
                }}
              </div>
            </div>
          </div>

          <div v-if="g.type === 'lottery' || g.type === 'table'" class="gc-foot">
            <div
              class="gc-foot-issue"
              :title="cardState[g.key]?.prevIssueFull || undefined"
            >
              <span class="gc-foot-issue-no">{{ cardState[g.key]?.prevIssue ?? '— —' }}</span>
              {{ g.type === 'table' ? '局' : '期' }}
            </div>
            <!-- 牌类：龙/虎/庄闲 详细结果 -->
            <div
              v-if="(cardState[g.key]?.parts?.length ?? 0) > 0"
              class="gc-foot-detail"
            >
              <template v-for="(p, i) in cardState[g.key]!.parts" :key="`${g.key}-p-${i}`">
                <span v-if="p.kind === 'sep'" class="gc-sep">{{ p.text }}</span>
                <span
                  v-else
                  class="gc-chip"
                  :class="[
                    `gc-chip--${p.kind}`,
                    p.tone ? `gc-chip--${p.tone}` : '',
                  ]"
                >{{ p.text }}</span>
              </template>
            </div>
            <!-- PK10 赛车/飞艇：游戏内原版赛道号图 -->
            <div v-else-if="isPk10Game(g.key)" class="gc-foot-numbers gc-foot-numbers--pk10">
              <template v-if="(cardState[g.key]?.nums?.length ?? 0) > 0">
                <img
                  v-for="(n, i) in cardState[g.key]!.nums"
                  :key="`${g.key}-lane-${i}`"
                  class="gc-lane"
                  :src="pk10BallUrl(g.key, n)"
                  :alt="n"
                  draggable="false"
                />
              </template>
              <span v-else class="gc-foot-empty">等待开奖</span>
            </div>
            <!-- 快三：游戏内原版骰子图 -->
            <div v-else-if="isDice3Game(g.key)" class="gc-foot-numbers gc-foot-numbers--dice">
              <template v-if="(cardState[g.key]?.nums?.length ?? 0) > 0">
                <img
                  v-for="(n, i) in cardState[g.key]!.nums"
                  :key="`${g.key}-dice-${i}`"
                  class="gc-dice"
                  :src="kuai3DiceUrl(n)"
                  :alt="n"
                  draggable="false"
                />
              </template>
              <span v-else class="gc-foot-empty">等待开奖</span>
            </div>
            <!-- 时时彩：与游戏内同款金色号码球 -->
            <div v-else-if="isDigit5Game(g.key)" class="gc-foot-numbers gc-foot-numbers--ssc">
              <template v-if="(cardState[g.key]?.nums?.length ?? 0) > 0">
                <span
                  v-for="(n, i) in cardState[g.key]!.nums"
                  :key="`${g.key}-ssc-${i}`"
                  class="gc-ssc-ball"
                >{{ n }}</span>
              </template>
              <span v-else class="gc-foot-empty">等待开奖</span>
            </div>
            <!-- 幸运六合彩：游戏内原版色波号码球 -->
            <div v-else-if="isLhcGame(g.key)" class="gc-foot-numbers gc-foot-numbers--lhc">
              <template v-if="(cardState[g.key]?.nums?.length ?? 0) > 0">
                <template v-for="(n, i) in lhcFootNums(cardState[g.key]!.nums)" :key="`${g.key}-lhc-${i}`">
                  <span v-if="n === '+'" class="gc-lhc-sep">+</span>
                  <img
                    v-else
                    class="gc-lhc-ball"
                    :src="lhcBallUrl(n)"
                    :alt="n"
                    draggable="false"
                  />
                </template>
              </template>
              <span v-else class="gc-foot-empty">等待开奖</span>
            </div>
            <!-- 其它数字彩兜底 -->
            <div v-else class="gc-foot-numbers">
              <template v-if="(cardState[g.key]?.nums?.length ?? 0) > 0">
                <span
                  v-for="(n, i) in cardState[g.key]!.nums"
                  :key="`${g.key}-n-${i}`"
                  class="gc-num"
                  :class="numClass(g.key, n, i)"
                >{{ n }}</span>
              </template>
              <span v-else class="gc-foot-empty">等待开奖</span>
            </div>
          </div>
          <div v-else class="gc-foot gc-foot--instant">
            <div class="gc-foot-instant-label">实时开奖 · 即开即玩</div>
          </div>
        </div>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <TabBar />

  <SlotsCover
    v-if="showSlotsCover"
    @start="enterSlotsGame"
    @close="closeSlotsCover"
  />
  <BcbmCover
    v-if="showBcbmCover"
    @start="enterBcbmGame"
    @close="closeBcbmCover"
  />
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { gamesApi } from '@/api/games'
import { lotteryApi } from '@/api/lottery'
import { tableApi, TABLE_SERVER_CODE } from '@/api/table'
import {
  formatTableRoundNo,
  shortTableRoundLabel,
  tableLobbyIntervalSec,
  tableLobbyPrepSec,
  LOTTERY_INTERVALS,
  lotteryPrepSec,
} from '@gamebox/shared'
import TabBar from '@/components/TabBar.vue'
import SlotsCover from '@/components/SlotsCover.vue'
import BcbmCover from '@/components/BcbmCover.vue'
import '@/assets/game-lobby.css'

useBodyClass('lobby-bg')

const router = useRouter()
const { toast } = useToast()

/** 大厅返回：优先回房间号页；若上一页是游戏路由则跳过，避免与游戏页互相循环 */
function onLobbyBack() {
  const back = window.history.state?.back
  const backPath = typeof back === 'string' ? back.split('?')[0] : ''
  if (backPath.startsWith('/game')) {
    const pos = Number(window.history.state?.position ?? 0)
    if (pos >= 2) router.go(-2)
    else router.replace('/room')
    return
  }
  if (backPath === '/room') {
    router.back()
    return
  }
  router.replace('/room')
}

/* ===== 游戏列表（与原型 game-lobby.js 的 GAMES 一致） =====
 * type: 'lottery' 定时开奖；'table' 牌桌墙钟周期；'instant' 即时开局
 * route: 已接入后端的游戏跳转路由；无 route 的卡片点击提示「即将上线」 */
interface LobbyGame {
  key: string
  name: string
  tag?: string
  type: 'lottery' | 'table' | 'instant'
  /** 一整期总秒数 */
  intervalSec?: number
  /** 准备中 / 开奖流程秒数（从倒计时中扣掉） */
  prepSec?: number
  iconImg?: string
  svg?: string
  route?: string
  /** 对应后端 Game.code；大厅展示/进入必须在平台上架列表中 */
  backendCode?: string
}

/** 大厅排序：时时彩 → 赛车飞艇 → 快三/六合 → 牌桌 → 街机电子 */
const GAMES: LobbyGame[] = [
  // —— 时时彩 ——
  {
    key: 'ssc', name: '快乐时时彩', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.ssc, prepSec: lotteryPrepSec('ssc'),
    iconImg: '/images/games/ssc/ssc.png',
    route: '/game/lottery/ssc', backendCode: 'ssc',
  },
  {
    key: 'ffc', name: '1分时时彩', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.ffc, prepSec: lotteryPrepSec('ffc'),
    iconImg: '/images/games/ffc/ffc.png',
    route: '/game/lottery/ffc', backendCode: 'ffc',
  },
  // —— 赛车 / 飞艇 ——
  {
    key: 'speed-racing', name: '极速赛车', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS['speed-racing'], prepSec: lotteryPrepSec('speed-racing'),
    iconImg: '/images/games/speed-racing/speed-racing.png',
    route: '/game/lottery/speed-racing', backendCode: 'speed-racing',
  },
  {
    key: 'bjsc', name: '北京赛车', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.bjsc, prepSec: lotteryPrepSec('bjsc'),
    iconImg: '/images/games/bjsc/bjsc.png',
    route: '/game/lottery/bjsc', backendCode: 'bjsc',
  },
  {
    key: 'speed-boat', name: '幸运飞艇', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS['speed-boat'], prepSec: lotteryPrepSec('speed-boat'),
    iconImg: '/images/games/speed-boat/speed-boat.png',
    route: '/game/lottery/speed-boat', backendCode: 'speed-boat',
  },
  // —— 快三 / 六合 ——
  {
    key: 'kuai3', name: '1分快三', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.kuai3, prepSec: lotteryPrepSec('kuai3'),
    iconImg: '/images/games/kuai3/kuai3.png',
    route: '/game/lottery/kuai3', backendCode: 'kuai3',
  },
  {
    key: 'lhc', name: '幸运六合彩', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.lhc, prepSec: lotteryPrepSec('lhc'),
    iconImg: '/images/games/hk-mark6/hk-mark6.png',
    route: '/game/lottery/lhc', backendCode: 'lhc',
  },
  // —— 牌桌（prep = 开奖流程 + 派奖；不走彩票 API） ——
  {
    key: 'zhajinhua', name: '炸金花', tag: '热 门', type: 'table',
    intervalSec: tableLobbyIntervalSec('zhajinhua'), prepSec: tableLobbyPrepSec('zhajinhua'),
    iconImg: '/images/games/zhajinhua/zhajinhua.png',
    route: '/game/lottery/zhajinhua', backendCode: 'zhajinhua',
  },
  {
    key: 'douniu', name: '斗牛', type: 'table',
    intervalSec: tableLobbyIntervalSec('douniu'), prepSec: tableLobbyPrepSec('douniu'),
    iconImg: '/images/games/douniu/douniu.png',
    route: '/game/lottery/douniu', backendCode: 'douniu',
  },
  {
    key: 'baccarat', name: '百家乐', tag: '热 门', type: 'table',
    intervalSec: tableLobbyIntervalSec('baccarat'), prepSec: tableLobbyPrepSec('baccarat'),
    iconImg: '/images/games/baccarat/baccarat.png',
    route: '/game/lottery/baccarat', backendCode: 'baccarat',
  },
  {
    key: 'longhu', name: '龙虎斗', tag: '新 品', type: 'table',
    intervalSec: tableLobbyIntervalSec('longhu'), prepSec: tableLobbyPrepSec('longhu'),
    iconImg: '/images/games/longhu/longhu-icon.png',
    route: '/game/lottery/longhu', backendCode: 'dragon-tiger',
  },
  // —— 街机 / 电子 ——
  {
    key: 'slots', name: '水果机', type: 'instant',
    iconImg: '/images/games/slots/slots.png',
    route: '/game/fruit', backendCode: 'fruit-machine',
  },
  {
    key: 'bcbm', name: '奔驰宝马', tag: '新 品', type: 'instant',
    iconImg: '/images/games/bcbm/bcbm-icon.png',
    route: '/game/arcade/bcbm', backendCode: 'bcbm',
  },
]

/** code → ONLINE | MAINTENANCE（下架不在目录里） */
const catalogStatus = ref<Map<string, string>>(new Map())
const catalogLoaded = ref(false)

function resolveBackendCode(g: LobbyGame): string | undefined {
  if (g.backendCode) return g.backendCode
  if (g.type === 'table') return TABLE_SERVER_CODE[g.key]
  return undefined
}

function platformStatus(g: LobbyGame): string | null {
  const code = resolveBackendCode(g)
  if (!code || !catalogLoaded.value) return null
  return catalogStatus.value.get(code) ?? null
}

function isPlatformOnline(g: LobbyGame): boolean {
  return platformStatus(g) === 'ONLINE'
}

function isMaintenance(g: LobbyGame): boolean {
  return platformStatus(g) === 'MAINTENANCE'
}

/** 上架可玩 + 维护可见；下架不展示 */
const visibleGames = computed(() =>
  GAMES.filter((g) => {
    const s = platformStatus(g)
    return s === 'ONLINE' || s === 'MAINTENANCE'
  }),
)

/* ===== 跑马灯：中性运营文案（禁止伪造「某某赢了 xxx」） ===== */
const marqueeItems = ref<string[]>([])

function buildMarquee() {
  marqueeItems.value = [
    '理性娱乐 · 量力而行',
    '开奖结果以房间官方公告为准',
    '下注前请确认玩法与赔率',
    '封盘后请等待开奖动画完成',
    '祝您游戏愉快',
    '积分变动以账户余额为准',
  ]
}

/* ===== 期号 / 倒计时滴答：倒计时显示 = 总时间 − 准备中 ===== */

/** 开奖号码形态：大厅底条展示用 */
type DrawKind = 'digit5' | 'dice3' | 'pk10' | 'lhc' | 'table'

const DRAW_KIND: Record<string, DrawKind> = {
  ssc: 'digit5',
  ffc: 'digit5',
  kuai3: 'dice3',
  bjsc: 'pk10',
  'speed-racing': 'pk10',
  'speed-boat': 'pk10',
  lhc: 'lhc',
  zhajinhua: 'table',
  douniu: 'table',
  baccarat: 'table',
  longhu: 'table',
}

/** 各 PK10 游戏自带赛道号素材目录（与游戏内 ballHtml 一致） */
const PK10_BALL_BASE: Record<string, string> = {
  bjsc: '/games-assets/bjsc/assets/balls',
  'speed-racing': '/games-assets/speed-racing/assets/balls',
  'speed-boat': '/games-assets/speed-boat/assets/balls',
}

function isPk10Game(key: string) {
  return DRAW_KIND[key] === 'pk10'
}
function isDice3Game(key: string) {
  return DRAW_KIND[key] === 'dice3'
}
function isDigit5Game(key: string) {
  return DRAW_KIND[key] === 'digit5'
}
function isLhcGame(key: string) {
  return DRAW_KIND[key] === 'lhc'
}

function pk10BallUrl(gameKey: string, n: string) {
  const base = PK10_BALL_BASE[gameKey] || PK10_BALL_BASE['speed-racing']
  const num = Math.max(1, Math.min(10, Number(n) || 1))
  return `${base}/ball-${String(num).padStart(2, '0')}.png`
}

/** 快三大厅用游戏内 xs/tbl 同款扁平骰子图标 */
function kuai3DiceUrl(n: string) {
  const num = Math.max(1, Math.min(6, Number(n) || 1))
  return `/games-assets/kuai3/assets/result/icon-${String(num).padStart(2, '0')}.png`
}

/** 六合彩：与游戏内 ballHtml 同路径 ball_01.png … ball_49.png */
function lhcBallUrl(n: string) {
  const num = Math.max(1, Math.min(49, Number(n) || 1))
  return `/games-assets/lhc/assets/balls/ball_${String(num).padStart(2, '0')}.png`
}

/** 大厅底条：正码 6 + 「+」+ 特码（接口若无加号则补上） */
function lhcFootNums(nums: string[]): string[] {
  const raw = nums.filter((n) => n !== '+')
  if (raw.length < 7) return nums
  const mains = raw.slice(0, 6).map((n) => String(n).padStart(2, '0'))
  const special = String(raw[6]).padStart(2, '0')
  return [...mains, '+', special]
}

interface DrawPart {
  kind: 'side' | 'card' | 'point' | 'hand' | 'result' | 'tag' | 'sep'
  text: string
  tone?: 'dragon' | 'tiger' | 'banker' | 'player' | 'tie' | 'win' | 'red' | 'black'
}

interface CardState {
  /** 大厅短显期号/局号 */
  issue: string
  prevIssue: string
  /** 完整期号（title 悬停，不占版面） */
  issueFull?: string
  prevIssueFull?: string
  cdText: string
  cdClass: string
  /** 数字彩开奖号 */
  nums: string[]
  /** 牌类详细结果（优先展示） */
  parts: DrawPart[]
}

const cardState = reactive<Record<string, CardState>>({})
/** 后端历史开奖缓存（优先于本地种子结果） */
const apiDrawCache = reactive<Record<string, { issueNo: string; nums: string[]; parts?: DrawPart[] }>>({})
/** 后端当前期号（与进房后 serverCurrent.issueNo 对齐） */
const apiCurrentCache = reactive<Record<string, string>>({})
/** 彩票直播相位（来自 /lottery/.../current，与进房 lockAt 对齐） */
const apiLotteryLive = reactive<Record<string, {
  issueNo: string
  lockAt: number
  openAt: number
  status: string
  fetchedAt: number
}>>({})
/** 牌桌直播相位（来自 /table/.../snapshot） */
const apiTableLive = reactive<Record<string, { phase: string; secondsLeft: number; roundNo: string; fetchedAt: number }>>({})

/** 全部彩票：上海日 MMDD + 当日序号（每日 00:00 重置） */
const LOTTERY_ISSUE_KEYS = new Set([
  'ssc', 'ffc', 'kuai3', 'lhc', 'bjsc', 'speed-racing', 'speed-boat',
])

function shanghaiYmdParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '01'
  return { y: get('year'), m: get('month'), d: get('day') }
}

/** Asia/Shanghai 当日 0 点（与彩票 H5 / 服务端日切一致） */
function todayStartMs() {
  const p = shanghaiYmdParts()
  return Date.parse(`${p.y}-${p.m}-${p.d}T00:00:00+08:00`)
}
function pad(n: number, w: number) { return String(n).padStart(w, '0') }

/**
 * 彩票大厅短显：仅认日切全号 MMDD+6 位 → 取当日序号后 4 位。
 * 旧连续累加号（如 1087645）禁止再截后四位，否则会误显示成「七千多期」。
 */
function shortLotteryIssueLabel(issueNo: string): string | null {
  const s = String(issueNo || '').trim()
  if (!s || s === '—' || s === '— —') return null
  const m = s.match(/^\d{4}(\d{6})$/)
  if (m) return m[1].slice(-4)
  return null
}

/** 与服务端 _nextAlignedTime 一致：UTC epoch 整除对齐的下一开奖点 */
function nextOpenAtMs(intervalSec: number, now = Date.now()) {
  const intervalMs = intervalSec * 1000
  return Math.ceil(now / intervalMs) * intervalMs
}
/** 本地兜底期号/局号：按 openAt 对齐服务端公式（有 API 时优先 API） */
function fmtLobbyIssueFromOpenAt(gameKey: string, openAtMs: number, intervalSec: number) {
  const intervalMs = intervalSec * 1000
  if (LOTTERY_ISSUE_KEYS.has(gameKey)) {
    const p = shanghaiYmdParts(new Date(openAtMs))
    const dayStart = Date.parse(`${p.y}-${p.m}-${p.d}T00:00:00+08:00`)
    const seq = Math.floor((openAtMs - dayStart) / intervalMs) + 1
    return `${p.m}${p.d}${pad(Math.max(1, seq), 6)}`
  }
  /* 牌桌：与 @gamebox/shared formatTableRoundNo / 服务端 alignedRoundNo 同源 */
  if (DRAW_KIND[gameKey] === 'table') {
    const serverCode = TABLE_SERVER_CODE[gameKey] || gameKey
    return formatTableRoundNo(serverCode, intervalMs, openAtMs)
  }
  return pad(Math.max(1, Math.floor((openAtMs - todayStartMs()) / intervalMs) + 1), 6)
}
function fmtMmss(sec: number) {
  const s = Math.max(0, Math.ceil(sec))
  return pad(Math.floor(s / 60), 2) + ':' + pad(s % 60, 2)
}

function faceCardText(card: unknown): { text: string; tone: 'red' | 'black' } {
  const c = (card || {}) as { suit?: string; rank?: string | number }
  const suitMap: Record<string, string> = {
    spade: '♠', heart: '♥', club: '♣', diamond: '♦',
    S: '♠', H: '♥', C: '♣', D: '♦',
  }
  const suit = suitMap[String(c.suit || '')] || '?'
  let rank = '?'
  if (typeof c.rank === 'number') {
    rank = ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' } as Record<number, string>)[c.rank] ?? String(c.rank)
  } else if (c.rank != null) {
    rank = String(c.rank)
  }
  const tone = suit === '♥' || suit === '♦' ? 'red' as const : 'black' as const
  return { text: `${suit}${rank}`, tone }
}

function resultPart(result: string, style: 'lhd' | 'bp'): DrawPart {
  if (style === 'lhd') {
    if (result === 'dragon') return { kind: 'result', text: '龙赢', tone: 'dragon' }
    if (result === 'tiger') return { kind: 'result', text: '虎赢', tone: 'tiger' }
    return { kind: 'result', text: '和局', tone: 'tie' }
  }
  if (result === 'banker') return { kind: 'result', text: '庄赢', tone: 'banker' }
  if (result === 'player') return { kind: 'result', text: '闲赢', tone: 'player' }
  return { kind: 'result', text: '和局', tone: 'tie' }
}

/** 将 /table snapshot 的 outcome 转为大厅底条 DrawPart */
function outcomeToParts(gameKey: string, outcome: Record<string, unknown> | null | undefined): DrawPart[] {
  if (!outcome) return []
  const sep = (): DrawPart => ({ kind: 'sep', text: '·' })
  if (gameKey === 'longhu') {
    const d = faceCardText(outcome.dragon)
    const t = faceCardText(outcome.tiger)
    return [
      { kind: 'side', text: '龙', tone: 'dragon' },
      { kind: 'card', text: d.text, tone: d.tone },
      sep(),
      { kind: 'side', text: '虎', tone: 'tiger' },
      { kind: 'card', text: t.text, tone: t.tone },
      sep(),
      resultPart(String(outcome.result || ''), 'lhd'),
    ]
  }
  if (gameKey === 'baccarat') {
    const banker = Array.isArray(outcome.banker) ? outcome.banker : []
    const player = Array.isArray(outcome.player) ? outcome.player : []
    const bText = banker.map((c) => faceCardText(c).text).join(' ')
    const pText = player.map((c) => faceCardText(c).text).join(' ')
    const parts: DrawPart[] = [
      { kind: 'side', text: '庄', tone: 'banker' },
      { kind: 'card', text: bText || '—' },
      { kind: 'point', text: `${Number(outcome.bankerPoint ?? 0)}点`, tone: 'banker' },
      { kind: 'side', text: '闲', tone: 'player' },
      { kind: 'card', text: pText || '—' },
      { kind: 'point', text: `${Number(outcome.playerPoint ?? 0)}点`, tone: 'player' },
      resultPart(String(outcome.result || ''), 'bp'),
    ]
    if (outcome.bankerPair) parts.push({ kind: 'tag', text: '庄对', tone: 'banker' })
    if (outcome.playerPair) parts.push({ kind: 'tag', text: '闲对', tone: 'player' })
    return parts
  }
  if (gameKey === 'zhajinhua' || gameKey === 'douniu') {
    const bt = (outcome.bankerType as { label?: string } | undefined)?.label || '—'
    const pt = (outcome.playerType as { label?: string } | undefined)?.label || '—'
    return [
      { kind: 'side', text: '庄', tone: 'banker' },
      { kind: 'hand', text: bt, tone: 'banker' },
      sep(),
      { kind: 'side', text: '闲', tone: 'player' },
      { kind: 'hand', text: pt, tone: 'player' },
      sep(),
      resultPart(String(outcome.result || 'banker'), 'bp'),
    ]
  }
  return []
}

function parseApiDrawNumbers(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((n) => String(n))
  } catch {
    /* ignore */
  }
  return []
}

function resolveDraw(gameKey: string, prevIssue: string): { nums: string[]; parts: DrawPart[] } {
  if (!prevIssue || prevIssue === '— —') return { nums: [], parts: [] }
  const cached = apiDrawCache[gameKey]
  // 牌类优先用服务端 snapshot 历史；无 cache 不造假开奖
  if (DRAW_KIND[gameKey] === 'table') {
    if (cached?.parts?.length) return { nums: [], parts: cached.parts }
    return { nums: [], parts: [] }
  }
  if (cached?.nums?.length) {
    return { nums: cached.nums, parts: [] }
  }
  return { nums: [], parts: [] }
}

function numClass(gameKey: string, n: string, index: number) {
  const kind = DRAW_KIND[gameKey] ?? 'digit5'
  if (n === '+') return 'gc-num--sep'
  if (kind === 'lhc' && index === 7) return 'gc-num--special'
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  if (v >= 5) return 'gc-num--big'
  return 'gc-num--small'
}

async function refreshLotteryDraws() {
  const tasks = GAMES.filter((g) => g.type === 'lottery').map(async (g) => {
    const code = g.backendCode || g.key
    try {
      const [list, current] = await Promise.all([
        lotteryApi.history(code, 1).catch(() => null),
        lotteryApi.currentIssue(code).catch(() => null),
      ])
      if (current?.issueNo) {
        apiCurrentCache[g.key] = String(current.issueNo)
        const lockAt = new Date(current.lockAt).getTime()
        const openAt = new Date(current.openAt).getTime()
        if (Number.isFinite(lockAt) && Number.isFinite(openAt)) {
          apiLotteryLive[g.key] = {
            issueNo: String(current.issueNo),
            lockAt,
            openAt,
            status: String(current.status || ''),
            fetchedAt: Date.now(),
          }
        }
      }
      const row = list?.[0]
      if (!row) return
      const nums = parseApiDrawNumbers(row.drawNumbers)
      if (!nums.length) return
      apiDrawCache[g.key] = { issueNo: String(row.issueNo), nums }
    } catch {
      // 后端无此彩种或未开奖：底条显示「等待开奖」
    }
  })
  await Promise.all(tasks)
}

async function refreshTableDraws() {
  const tasks = GAMES.filter((g) => g.type === 'table').map(async (g) => {
    const code = TABLE_SERVER_CODE[g.key] || g.key
    try {
      const snap = await tableApi.snapshot(code)
      if (!snap) return
      apiTableLive[g.key] = {
        phase: snap.phase,
        secondsLeft: snap.secondsLeft,
        roundNo: snap.roundNo,
        fetchedAt: Date.now(),
      }
      if (snap.roundNo) apiCurrentCache[g.key] = String(snap.roundNo)

      const hist = snap.history || []
      /* DRAWING/SETTLED：history[0] 常=当前局；上期取 history[1]
         BETTING：history[0] 才是真正上期 */
      let prevIdx = 0
      if (snap.phase === 'DRAWING' || snap.phase === 'SETTLED') {
        if (hist[0]?.roundNo === snap.roundNo) prevIdx = 1
      }
      const prev = hist[prevIdx]
      const outcome = (prev?.outcome
        || (snap.phase !== 'BETTING' ? snap.outcome : undefined)) as Record<string, unknown> | undefined
      const parts = outcomeToParts(g.key, outcome)
      if (parts.length) {
        apiDrawCache[g.key] = {
          issueNo: String(prev?.roundNo || (snap.phase !== 'BETTING' ? snap.roundNo : '') || ''),
          nums: [],
          parts,
        }
      }
    } catch {
      // 后端不可达时保留种子结果
    }
  })
  await Promise.all(tasks)
}

function tickAll() {
  for (const g of GAMES) {
    if ((g.type !== 'lottery' && g.type !== 'table') || !g.intervalSec) {
      cardState[g.key] = {
        issue: '',
        prevIssue: '',
        cdText: '实时进行',
        cdClass: 'is-instant',
        nums: [],
        parts: [],
      }
      continue
    }
    const interval = g.intervalSec
    const prep = Math.max(1, g.prepSec ?? 4)
    const isLottery = g.type === 'lottery'
    const isTable = g.type === 'table'
    let r: number
    let localIssue: string
    let localPrev: string
    /* 聊天室彩票 / 牌桌：倒计时与服务端 UTC epoch 对齐网格一致 */
    const openAt = nextOpenAtMs(interval)
    r = (openAt - Date.now()) / 1000
    if (r <= 0) r = interval
    if (isTable) {
      /* 牌桌：当前墙钟周期 = 正在进行的局；勿用 nextOpen（那是下一局） */
      localIssue = fmtLobbyIssueFromOpenAt(g.key, Date.now(), interval)
      localPrev = fmtLobbyIssueFromOpenAt(g.key, Date.now() - interval * 1000, interval)
    } else {
      localIssue = fmtLobbyIssueFromOpenAt(g.key, openAt, interval)
      localPrev = fmtLobbyIssueFromOpenAt(g.key, openAt - interval * 1000, interval)
    }

    let cdText: string
    let cdClass = ''
    const nowMs = Date.now()
    const liveTable = isTable ? apiTableLive[g.key] : undefined
    const liveLot = isLottery ? apiLotteryLive[g.key] : undefined
    /** 彩票直播包：期号与倒计时必须同包，禁止「旧期号 + 墙钟下一期秒数」拼盘 */
    let lotteryLiveIssue: string | null = null
    if (liveTable && nowMs - liveTable.fetchedAt < 20_000) {
      /* 牌桌近期 snapshot：按真实相位展示 */
      const elapsedSec = (nowMs - liveTable.fetchedAt) / 1000
      const left = Math.max(0, liveTable.secondsLeft - elapsedSec)
      if (liveTable.phase === 'BETTING' && left > 0) {
        cdText = fmtMmss(left)
        cdClass = ''
      } else {
        cdText = '开奖中'
        cdClass = 'is-drawing'
      }
    } else if (liveLot && nowMs - liveLot.fetchedAt < 25_000) {
      if (nowMs >= liveLot.openAt) {
        /* 该期 openAt 已过：作废直播包，避免继续显示已结束期号配上下一期墙钟倒计时 */
        delete apiLotteryLive[g.key]
        if (apiCurrentCache[g.key] === liveLot.issueNo) delete apiCurrentCache[g.key]
        cdText = '开奖中'
        cdClass = 'is-drawing'
        lotteryLiveIssue = localIssue
      } else if (liveLot.status === 'PENDING' && nowMs < liveLot.lockAt) {
        cdText = fmtMmss((liveLot.lockAt - nowMs) / 1000)
        cdClass = ''
        lotteryLiveIssue = liveLot.issueNo
      } else {
        cdText = '开奖中'
        cdClass = 'is-drawing'
        lotteryLiveIssue = liveLot.issueNo
      }
    } else {
      if (liveLot && nowMs - liveLot.fetchedAt >= 25_000) {
        delete apiLotteryLive[g.key]
        if (apiCurrentCache[g.key] === liveLot.issueNo) delete apiCurrentCache[g.key]
      }
      if (r <= prep) {
        cdText = '开奖中'; cdClass = 'is-drawing'
      } else {
        cdText = fmtMmss(r - prep)
      }
    }
    /*
     * 牌桌双形态（必须严格分工，短号绝不能进 API / 验算 / 注单）：
     * - 权威全号 issueFull/prevFull：BJL20260725-0399（服务端 roundNo，缓存与 resolveDraw 只用它）
     * - 大厅短显 cardState：0399（pure display；进房点击不带期号）
     */
    const issueFull = isLottery
      ? (lotteryLiveIssue || apiCurrentCache[g.key] || localIssue)
      : (apiCurrentCache[g.key] || localIssue)
    const prevFull = apiDrawCache[g.key]?.issueNo || localPrev
    let issue = issueFull
    let prevIssue = prevFull
    if (isTable) {
      issue = shortTableRoundLabel(issueFull) || shortTableRoundLabel(localIssue) || '—'
      const prevShort = shortTableRoundLabel(prevFull)
      if (prevShort) {
        prevIssue = prevShort
      } else if (!prevFull) {
        /* 尚无服务端上期：才允许本地全号派生短显 */
        prevIssue = shortTableRoundLabel(localPrev) || '— —'
      } else {
        /* 上期仍是旧 T… / 乱号：结果芯片可信，局号勿用本地短号冒充成另一局 */
        prevIssue = '— —'
      }
    } else if (isLottery) {
      issue = shortLotteryIssueLabel(issueFull) || shortLotteryIssueLabel(localIssue) || '—'
      /* 历史若仍是旧连续号，short 会得到 null，回退本地日切上期，避免底条空白或假「七千期」 */
      prevIssue = shortLotteryIssueLabel(prevFull)
        || shortLotteryIssueLabel(localPrev)
        || '— —'
    }
    const draw = resolveDraw(g.key, prevFull)
    cardState[g.key] = {
      issue,
      prevIssue,
      issueFull,
      prevIssueFull: prevFull || undefined,
      cdText,
      cdClass,
      nums: draw.nums,
      parts: draw.parts,
    }
  }
}

const showSlotsCover = ref(false)
const currentSlotsRoute = ref('')
const showBcbmCover = ref(false)
const currentBcbmRoute = ref('')

function closeSlotsCover() {
  showSlotsCover.value = false
  currentSlotsRoute.value = ''
}

function closeBcbmCover() {
  showBcbmCover.value = false
  currentBcbmRoute.value = ''
}

async function enterSlotsGame() {
  const target = currentSlotsRoute.value
  if (target) await router.push(target)
  closeSlotsCover()
}

async function enterBcbmGame() {
  const target = currentBcbmRoute.value
  if (target) await router.push(target)
  closeBcbmCover()
}

function onGameClick(g: LobbyGame) {
  if (isMaintenance(g)) {
    toast(`${g.name.replace(/\s+/g, '')} · 维护中，暂不可进入`)
    return
  }
  if (!g.route || !isPlatformOnline(g)) {
    toast(`${g.name.replace(/\s+/g, '')} · 已下架`)
    return
  }

  // 水果机 / 奔驰宝马：专属封面
  if (g.key === 'slots') {
    currentSlotsRoute.value = g.route || ''
    showSlotsCover.value = true
    return
  }
  if (g.key === 'bcbm') {
    currentBcbmRoute.value = g.route || ''
    showBcbmCover.value = true
    return
  }

  // 彩票类等直接跳转
  if (g.route) router.push(g.route)
}

let timer: ReturnType<typeof setInterval>
let drawTimer: ReturnType<typeof setInterval>

onMounted(async () => {
  buildMarquee()
  tickAll()
  timer = setInterval(tickAll, 1000)
  try {
    const list = await gamesApi.list()
    catalogStatus.value = new Map(list.map((g) => [g.code, g.status || 'ONLINE']))
  } catch {
    catalogStatus.value = new Map()
  } finally {
    catalogLoaded.value = true
  }
  // 拉取各彩种 / 牌桌最近开奖；无数据时底条显示「等待开奖」
  await Promise.all([refreshLotteryDraws(), refreshTableDraws()])
  tickAll()
  drawTimer = setInterval(() => {
    Promise.all([refreshLotteryDraws(), refreshTableDraws()]).then(() => tickAll())
  }, 3000)
})

onUnmounted(() => {
  clearInterval(timer)
  clearInterval(drawTimer)
})

</script>
