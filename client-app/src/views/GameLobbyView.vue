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
              <!-- 彩票/牌桌显示期号；即时游戏只显示「实时进行」 -->
              <div v-if="g.type === 'lottery' || g.type === 'table'" class="gc-issue">
                第 <span class="gc-issue-no">{{ cardState[g.key]?.issue ?? '000000' }}</span>
                {{ g.type === 'table' ? '局' : '期' }}
              </div>
              <div :class="['gc-countdown', cardState[g.key]?.cdClass]">
                {{ cardState[g.key]?.cdText ?? (g.type === 'instant' ? '实时进行' : '--:--') }}
              </div>
            </div>
          </div>

          <div v-if="g.type === 'lottery' || g.type === 'table'" class="gc-foot">
            <div class="gc-foot-issue">
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
  
  <PgLoader v-if="showMahjongPgLoader" @done="onMahjongPgLoaderDone" />
  <MahjongCover v-if="showMahjongCover" @start="enterMahjongGame" />
  <SlotsCover v-if="showSlotsCover" @start="enterSlotsGame" />
  <BcbmCover v-if="showBcbmCover" @start="enterBcbmGame" />
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
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
  LOTTERY_PREP_SEC,
} from '@gamebox/shared'
import TabBar from '@/components/TabBar.vue'
import PgLoader from '@/components/PgLoader.vue'
import MahjongCover from '@/components/MahjongCover.vue'
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
  backendCode?: string
  /** games-assets 内嵌聊天室，不依赖后端上架状态即可进入 */
  assetGame?: boolean
}

/** 大厅排序：时时彩 → 赛车飞艇 → 快三/六合 → 牌桌 → 街机电子（麻将靠后） */
const GAMES: LobbyGame[] = [
  // —— 时时彩 ——
  {
    key: 'ssc', name: '快乐时时彩', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.ssc, prepSec: LOTTERY_PREP_SEC,
    iconImg: '/images/games/ssc/ssc.png',
    route: '/game/lottery/ssc', backendCode: 'ssc', assetGame: true,
  },
  {
    key: 'ffc', name: '1分时时彩', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.ffc, prepSec: LOTTERY_PREP_SEC,
    iconImg: '/images/games/ffc/ffc.png',
    route: '/game/lottery/ffc', backendCode: 'ffc', assetGame: true,
  },
  // —— 赛车 / 飞艇 ——
  {
    key: 'speed-racing', name: '极速赛车', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS['speed-racing'], prepSec: LOTTERY_PREP_SEC,
    iconImg: '/images/games/speed-racing/speed-racing.png',
    route: '/game/lottery/speed-racing', backendCode: 'speed-racing', assetGame: true,
  },
  {
    key: 'bjsc', name: '北京赛车', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.bjsc, prepSec: LOTTERY_PREP_SEC,
    iconImg: '/images/games/bjsc/bjsc.png',
    route: '/game/lottery/bjsc', backendCode: 'bjsc', assetGame: true,
  },
  {
    key: 'speed-boat', name: '幸运飞艇', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS['speed-boat'], prepSec: LOTTERY_PREP_SEC,
    iconImg: '/images/games/speed-boat/speed-boat.png',
    route: '/game/lottery/speed-boat', backendCode: 'speed-boat', assetGame: true,
  },
  // —— 快三 / 六合 ——
  {
    key: 'kuai3', name: '1分快三', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.kuai3, prepSec: LOTTERY_PREP_SEC,
    iconImg: '/images/games/kuai3/kuai3.png',
    route: '/game/lottery/kuai3', backendCode: 'kuai3', assetGame: true,
  },
  {
    key: 'lhc', name: '幸运六合彩', type: 'lottery',
    intervalSec: LOTTERY_INTERVALS.lhc, prepSec: LOTTERY_PREP_SEC,
    iconImg: '/images/games/hk-mark6/hk-mark6.png',
    route: '/game/lottery/lhc', backendCode: 'lhc', assetGame: true,
  },
  // —— 牌桌（prep = 开奖流程 + 派奖；不走彩票 API） ——
  {
    key: 'zhajinhua', name: '炸金花', tag: '热 门', type: 'table',
    intervalSec: tableLobbyIntervalSec('zhajinhua'), prepSec: tableLobbyPrepSec('zhajinhua'),
    iconImg: '/images/games/zhajinhua/zhajinhua.png',
    route: '/game/lottery/zhajinhua', assetGame: true,
  },
  {
    key: 'douniu', name: '斗牛', type: 'table',
    intervalSec: tableLobbyIntervalSec('douniu'), prepSec: tableLobbyPrepSec('douniu'),
    iconImg: '/images/games/douniu/douniu.png',
    route: '/game/lottery/douniu', assetGame: true,
  },
  {
    key: 'baccarat', name: '百家乐', tag: '热 门', type: 'table',
    intervalSec: tableLobbyIntervalSec('baccarat'), prepSec: tableLobbyPrepSec('baccarat'),
    iconImg: '/images/games/baccarat/baccarat.png',
    route: '/game/lottery/baccarat', assetGame: true,
  },
  {
    key: 'longhu', name: '龙虎斗', tag: '新 品', type: 'table',
    intervalSec: tableLobbyIntervalSec('longhu'), prepSec: tableLobbyPrepSec('longhu'),
    iconImg: '/images/games/longhu/longhu-icon.png',
    route: '/game/lottery/longhu', assetGame: true,
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
  {
    key: 'mahjong', name: '麻将胡了', tag: '热 门', type: 'instant',
    iconImg: '/images/games/mahjong/mahjong.png',
    route: '/game/slot/slots-mahjong', backendCode: 'slots-mahjong',
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
  issue: string
  prevIssue: string
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
/** 牌桌直播相位（来自 /table/.../snapshot） */
const apiTableLive = reactive<Record<string, { phase: string; secondsLeft: number; roundNo: string; fetchedAt: number }>>({})

/** 与服务端 genIssueNo 一致的期号族 */
const RACING_ISSUE_KEYS = new Set(['bjsc', 'speed-racing', 'speed-boat'])
const MMDD_ISSUE_KEYS = new Set(['ssc', 'ffc', 'kuai3', 'lhc'])
const RACING_ISSUE_BASE_MS = Date.UTC(2024, 0, 1)

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
/** 与服务端 _nextAlignedTime 一致：UTC epoch 整除对齐的下一开奖点 */
function nextOpenAtMs(intervalSec: number, now = Date.now()) {
  const intervalMs = intervalSec * 1000
  return Math.ceil(now / intervalMs) * intervalMs
}
/** 本地兜底期号/局号：按 openAt 对齐服务端公式（有 API 时优先 API） */
function fmtLobbyIssueFromOpenAt(gameKey: string, openAtMs: number, intervalSec: number) {
  const intervalMs = intervalSec * 1000
  if (RACING_ISSUE_KEYS.has(gameKey)) {
    return String(Math.max(1, Math.floor((openAtMs - RACING_ISSUE_BASE_MS) / intervalMs) + 1))
  }
  if (MMDD_ISSUE_KEYS.has(gameKey)) {
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

/** 稳定种子：同一游戏同一期号始终同一组号码（大厅无人进房也会轮换） */
function hashSeed(str: string) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SUITS = ['♠', '♥', '♣', '♦'] as const
const RANKS_LHD = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
/** 龙虎比牌：A=1 … K=13 */
function rankValueLhd(r: string) {
  return RANKS_LHD.indexOf(r as (typeof RANKS_LHD)[number]) + 1
}
function pickCard(rnd: () => number) {
  const suit = SUITS[Math.floor(rnd() * SUITS.length)]
  const rank = RANKS_LHD[Math.floor(rnd() * RANKS_LHD.length)]
  const tone = suit === '♥' || suit === '♦' ? 'red' as const : 'black' as const
  return { text: `${suit}${rank}`, tone, rank }
}
/** 百家乐点数：A=1，2-9 面值，10/J/Q/K=0，只取个位 */
function baccaratPoint(rank: string) {
  if (rank === 'A') return 1
  if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 0
  return Number(rank)
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
      resultPart(String(outcome.result || (gameKey === 'douniu' ? 'banker' : 'tie')), 'bp'),
    ]
  }
  return []
}

function seededTableParts(gameKey: string, rnd: () => number): DrawPart[] {
  const sep = (): DrawPart => ({ kind: 'sep', text: '·' })

  if (gameKey === 'longhu') {
    const d = pickCard(rnd)
    const t = pickCard(rnd)
    const dv = rankValueLhd(d.rank)
    const tv = rankValueLhd(t.rank)
    const result =
      dv > tv ? { text: '龙赢', tone: 'dragon' as const }
      : tv > dv ? { text: '虎赢', tone: 'tiger' as const }
      : { text: '和局', tone: 'tie' as const }
    return [
      { kind: 'side', text: '龙', tone: 'dragon' },
      { kind: 'card', text: d.text, tone: d.tone },
      sep(),
      { kind: 'side', text: '虎', tone: 'tiger' },
      { kind: 'card', text: t.text, tone: t.tone },
      sep(),
      { kind: 'result', text: result.text, tone: result.tone },
    ]
  }

  if (gameKey === 'baccarat') {
    const b1 = pickCard(rnd)
    const b2 = pickCard(rnd)
    const p1 = pickCard(rnd)
    const p2 = pickCard(rnd)
    const bp = (baccaratPoint(b1.rank) + baccaratPoint(b2.rank)) % 10
    const pp = (baccaratPoint(p1.rank) + baccaratPoint(p2.rank)) % 10
    const result =
      bp > pp ? { text: '庄赢', tone: 'banker' as const }
      : pp > bp ? { text: '闲赢', tone: 'player' as const }
      : { text: '和局', tone: 'tie' as const }
    /* 大厅底栏空间紧：每边牌面合并为一枚 chip，去掉中间分隔点 */
    const parts: DrawPart[] = [
      { kind: 'side', text: '庄', tone: 'banker' },
      { kind: 'card', text: `${b1.text} ${b2.text}` },
      { kind: 'point', text: `${bp}点`, tone: 'banker' },
      { kind: 'side', text: '闲', tone: 'player' },
      { kind: 'card', text: `${p1.text} ${p2.text}` },
      { kind: 'point', text: `${pp}点`, tone: 'player' },
      { kind: 'result', text: result.text, tone: result.tone },
    ]
    if (b1.rank === b2.rank) parts.push({ kind: 'tag', text: '庄对', tone: 'banker' })
    if (p1.rank === p2.rank) parts.push({ kind: 'tag', text: '闲对', tone: 'player' })
    return parts
  }

  if (gameKey === 'zhajinhua') {
    const hands = ['豹子', '顺金', '金花', '顺子', '对子', '散牌']
    // 权重：散牌/对子更常见
    const weights = [3, 4, 10, 12, 22, 49]
    const pickHand = () => {
      const total = weights.reduce((a, b) => a + b, 0)
      let x = rnd() * total
      for (let i = 0; i < hands.length; i++) {
        x -= weights[i]
        if (x <= 0) return hands[i]
      }
      return '散牌'
    }
    const bh = pickHand()
    const ph = pickHand()
    const bi = hands.indexOf(bh)
    const pi = hands.indexOf(ph)
    const result =
      bi < pi ? { text: '庄赢', tone: 'banker' as const }
      : pi < bi ? { text: '闲赢', tone: 'player' as const }
      : { text: '和局', tone: 'tie' as const }
    return [
      { kind: 'side', text: '庄', tone: 'banker' },
      { kind: 'hand', text: bh, tone: 'banker' },
      sep(),
      { kind: 'side', text: '闲', tone: 'player' },
      { kind: 'hand', text: ph, tone: 'player' },
      sep(),
      { kind: 'result', text: result.text, tone: result.tone },
    ]
  }

  if (gameKey === 'douniu') {
    const hands = ['五小牛', '炸弹牛', '五花牛', '牛牛', '牛9', '牛8', '牛7', '牛6', '牛5', '牛4', '牛3', '牛2', '牛1', '无牛']
    const pickHand = () => hands[Math.floor(rnd() * hands.length)]
    const bh = pickHand()
    const ph = pickHand()
    const bi = hands.indexOf(bh)
    const pi = hands.indexOf(ph)
    const result =
      bi < pi ? { text: '庄赢', tone: 'banker' as const }
      : pi < bi ? { text: '闲赢', tone: 'player' as const }
      : { text: '庄赢', tone: 'banker' as const } // 同级默认庄赢（与玩法一致）
    return [
      { kind: 'side', text: '庄', tone: 'banker' },
      { kind: 'hand', text: bh, tone: 'banker' },
      sep(),
      { kind: 'side', text: '闲', tone: 'player' },
      { kind: 'hand', text: ph, tone: 'player' },
      sep(),
      { kind: 'result', text: result.text, tone: result.tone },
    ]
  }

  return [{ kind: 'result', text: '已开奖', tone: 'tie' }]
}

function seededDraw(gameKey: string, issue: string): { nums: string[]; parts: DrawPart[] } {
  const kind = DRAW_KIND[gameKey] ?? 'digit5'
  const rnd = mulberry32(hashSeed(`${gameKey}:${issue}`))
  if (kind === 'table') {
    return { nums: [], parts: seededTableParts(gameKey, rnd) }
  }
  if (kind === 'digit5') {
    return { nums: Array.from({ length: 5 }, () => String(Math.floor(rnd() * 10))), parts: [] }
  }
  if (kind === 'dice3') {
    return { nums: Array.from({ length: 3 }, () => String(1 + Math.floor(rnd() * 6))), parts: [] }
  }
  if (kind === 'pk10') {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return { nums: arr.map(String), parts: [] }
  }
  if (kind === 'lhc') {
    const pool = Array.from({ length: 49 }, (_, i) => i + 1)
    const pick: number[] = []
    for (let i = 0; i < 7; i++) {
      const j = Math.floor(rnd() * pool.length)
      pick.push(pool.splice(j, 1)[0])
    }
    const special = pick.pop()!
    return {
      nums: [...pick.sort((a, b) => a - b).map((n) => pad(n, 2)), '+', pad(special, 2)],
      parts: [],
    }
  }
  return { nums: Array.from({ length: 5 }, () => String(Math.floor(rnd() * 10))), parts: [] }
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
  // 牌类优先用服务端 snapshot 历史
  if (DRAW_KIND[gameKey] === 'table') {
    if (cached?.parts?.length) return { nums: [], parts: cached.parts }
    return seededDraw(gameKey, prevIssue)
  }
  if (cached?.nums?.length) {
    return { nums: cached.nums, parts: [] }
  }
  return seededDraw(gameKey, prevIssue)
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
      }
      const row = list?.[0]
      if (!row) return
      const nums = parseApiDrawNumbers(row.drawNumbers)
      if (!nums.length) return
      apiDrawCache[g.key] = { issueNo: String(row.issueNo), nums }
    } catch {
      // 后端无此彩种或未开奖：用本地种子结果
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
    const chatLottery = RACING_ISSUE_KEYS.has(g.key) || MMDD_ISSUE_KEYS.has(g.key)
    const isTable = g.type === 'table'
    let r: number
    let localIssue: string
    let localPrev: string
    if (chatLottery || isTable) {
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
    } else {
      const elapsed = (Date.now() - todayStartMs()) / 1000
      const seq = Math.floor(elapsed / interval) + 1
      r = interval - (elapsed % interval)
      localIssue = pad(Math.max(1, seq), 6)
      localPrev = seq > 1 ? pad(seq - 1, 6) : '— —'
    }

    let cdText: string
    let cdClass = ''
    const live = isTable ? apiTableLive[g.key] : undefined
    if (live && Date.now() - live.fetchedAt < 20_000) {
      /* 有近期 snapshot：按真实相位展示（本地按 elapsed 估算剩余） */
      const elapsedSec = (Date.now() - live.fetchedAt) / 1000
      const left = Math.max(0, live.secondsLeft - elapsedSec)
      if (live.phase === 'BETTING' && left > 0) {
        cdText = fmtMmss(left)
        cdClass = ''
      } else {
        cdText = '准备中'
        cdClass = 'is-drawing'
      }
    } else if (r <= prep) {
      cdText = '准备中'; cdClass = 'is-drawing'
    } else {
      cdText = fmtMmss(r - prep)
    }
    /*
     * 牌桌双形态（必须严格分工，短号绝不能进 API / 验算 / 注单）：
     * - 权威全号 issueFull/prevFull：BJL20260725-0399（服务端 roundNo，缓存与 resolveDraw 只用它）
     * - 大厅短显 cardState：0399（pure display；进房点击不带期号）
     */
    const issueFull = apiCurrentCache[g.key] || localIssue
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
    }
    const draw = resolveDraw(g.key, prevFull)
    cardState[g.key] = {
      issue,
      prevIssue,
      cdText,
      cdClass,
      nums: draw.nums,
      parts: draw.parts,
    }
  }
}

/* ===== 后端在线游戏（决定卡片是否可进入） ===== */
const onlineCodes = ref<Set<string>>(new Set())

const showMahjongPgLoader = ref(false)
const showMahjongCover = ref(false)
let currentMahjongRoute = ''
const showSlotsCover = ref(false)
let currentSlotsRoute = ''
const showBcbmCover = ref(false)
let currentBcbmRoute = ''

function onMahjongPgLoaderDone() {
  showMahjongCover.value = true
  showMahjongPgLoader.value = false
}

function enterMahjongGame() {
  showMahjongCover.value = false
  if (currentMahjongRoute) {
    router.push(currentMahjongRoute)
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

function onGameClick(g: LobbyGame) {
  const isPlayable =
    g.route &&
    (g.assetGame ||
      onlineCodes.value.size === 0 ||
      !g.backendCode ||
      onlineCodes.value.has(g.backendCode))

  if (!isPlayable) {
    toast(`${g.name.replace(/\s+/g, '')} · 即将上线`)
    return
  }

  // 麻将胡了：正版 PG 开屏 → 专属封面
  if (g.key === 'mahjong') {
    currentMahjongRoute = g.route || ''
    showMahjongPgLoader.value = true
    return
  }

  // 水果机 / 奔驰宝马：专属封面
  if (g.key === 'slots') {
    currentSlotsRoute = g.route || ''
    showSlotsCover.value = true
    return
  }
  if (g.key === 'bcbm') {
    currentBcbmRoute = g.route || ''
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
    onlineCodes.value = new Set(list.map(g => g.code))
  } catch {
    // 后端不可达时不阻断大厅渲染
  }
  // 拉取各彩种 / 牌桌最近开奖；失败则用期号种子结果，保证底条始终有号
  await Promise.all([refreshLotteryDraws(), refreshTableDraws()])
  tickAll()
  drawTimer = setInterval(() => {
    Promise.all([refreshLotteryDraws(), refreshTableDraws()]).then(() => tickAll())
  }, 8000)
})

onUnmounted(() => {
  clearInterval(timer)
  clearInterval(drawTimer)
})

</script>
