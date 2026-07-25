<template>
  <div class="cabinet-page" @pointerdown.once="onFirstInteract">
    <img
      class="cabinet-ambient"
      :src="cabinetAmbientUrl"
      alt=""
      draggable="false"
      aria-hidden="true"
    />

    <div class="cabinet-stage">
      <img
        class="cabinet-body"
        :src="cabinetBodyUrl"
        alt="水果机"
        draggable="false"
      />

      <!-- 「水果机」顶弧跑马灯：常灭暗泡，报奖时追跑点亮 -->
      <div class="title-marquee" :class="{ on: titleMarqueeOn }" aria-hidden="true">
        <span
          v-for="(bulb, i) in titleMarqueeBulbs"
          :key="`tm${i}`"
          class="title-marquee-bulb"
          :class="{ lit: titleMarqueeLit(i) }"
          :style="titleMarqueeBulbStyle(bulb)"
        />
      </div>

      <!-- 电视屏：只在底图大金框内侧黑屏播放（不动 24 格） -->
      <FruitCenterStage
        class="fruit-tv-screen"
        :style="boxStyle(tvScreenBox)"
        :mode="stageMode"
        :mult="selectedMult"
        :total-stake="stakedScore"
        :win-amount="winScore"
        :gamble-result="gambleResultNum"
        :award-type="stageAwardType"
        :hit-symbol="centerHitSymbol"
        :hit-size="centerHitSize"
        :hit-kind="centerHitKind"
        :hit-label="centerHitLabel"
        :hit-odds="centerHitOdds"
        :hit-bet-units="centerHitBetUnits"
      />

      <img
        class="fruit-ring"
        :src="fruitRingUrl"
        alt="24格"
        draggable="false"
        :style="boxStyle(fruitRingBox)"
      />

      <!-- 跑灯 / 中奖格高亮（叠在 24 格上） -->
      <div
        v-for="(cell, i) in cellBoxes"
        :key="`c${i}`"
        :ref="(el) => setRingCellRef(el as any, i)"
        class="ring-cell"
        :class="{
          hit: hitLit.has(i) && trainHead !== i && trainTail !== i,
          train: trainHead === i,
          'train-tail': trainTail === i,
          flash: flashAll,
        }"
        :style="boxStyle(cell)"
      />

      <div class="led-score led-score--total" :style="boxStyle(totalScoreBox)">
        <SegDigit
          v-for="(d, i) in totalScoreDigits"
          :key="`t${i}`"
          :digit="d"
          tone="red"
        />
      </div>
      <div class="led-score led-score--win" :style="boxStyle(winScoreBox)">
        <SegDigit
          v-for="(d, i) in winScoreDigits"
          :key="`w${i}`"
          :digit="d"
          tone="red"
        />
      </div>

      <div
        v-for="led in betLeds"
        :key="led.id"
        class="led-bet"
        :style="boxStyle(led)"
      >
        <SegDigit
          v-for="(d, i) in betLedDigits(led.id)"
          :key="`${led.id}${i}`"
          :digit="d"
          tone="cyan"
        />
      </div>

      <button
        v-for="btn in controlButtons"
        :key="btn.id"
        type="button"
        class="ctrl-btn"
        :class="{
          disabled: isControlDisabled(btn.id),
          autoOn: btn.id === 'auto' && autoPlaying,
          gambleHint:
            stageMode === 'gamble_roll' &&
            winScore > 0 &&
            !busy &&
            !autoPlaying &&
            (btn.id === 'big' || btn.id === 'small'),
        }"
        :aria-label="btn.label"
        :aria-pressed="btn.id === 'auto' ? autoPlaying : undefined"
        :style="boxStyle(btn)"
        :disabled="isControlDisabled(btn.id)"
        @click="onControlClick(btn.id)"
      >
        <img :src="btn.src" :alt="btn.label" draggable="false" />
      </button>

      <button
        v-for="btn in betButtons"
        :key="btn.id"
        type="button"
        class="bet-btn"
        :class="{ selected: selectedBet === btn.id, disabled: busy || autoPlaying }"
        :aria-label="btn.label"
        :style="boxStyle(btn)"
        :disabled="busy || autoPlaying"
        @pointerdown="onBetHoldStart(btn.id, $event)"
        @pointerup="onBetHoldEnd()"
        @pointerleave="onBetHoldEnd()"
        @pointercancel="onBetHoldEnd()"
      >
        <img :src="btn.src" :alt="btn.label" draggable="false" />
      </button>

      <button
        v-for="btn in multButtons"
        :key="btn.value"
        type="button"
        class="mult-btn"
        :class="{ active: selectedMult === btn.value, disabled: busy || autoPlaying }"
        :aria-label="`倍数 x${btn.value}`"
        :aria-pressed="selectedMult === btn.value"
        :style="boxStyle(btn)"
        :disabled="busy || autoPlaying"
        @click="onMultClick(btn.value)"
      >
        <img :src="btn.src" :alt="`x${btn.value}`" draggable="false" />
      </button>
    </div>

    <button type="button" class="lobby-back fruit-top-btn" @click="goBack" aria-label="返回" />

    <div class="fruit-top-right">
      <button
        v-if="isDev"
        type="button"
        class="fruit-demo-chip"
        :disabled="busy || autoPlaying"
        @click="playTrainDemo"
      >
        开火车演示
      </button>
      <button
        type="button"
        class="fruit-top-btn fruit-top-btn--history"
        aria-label="历史记录"
        @click="showHistory = true"
      />
      <button
        type="button"
        class="fruit-top-btn fruit-top-btn--rules"
        aria-label="游戏玩法"
        @click="showRules = true"
      />
      <button
        type="button"
        class="fruit-top-btn fruit-top-btn--settings"
        aria-label="设置"
        @click="openSettings"
      />
    </div>

    <FruitSettingsPanel v-if="showSettings" @close="showSettings = false" />

    <!-- 历史记录 -->
    <div v-if="showHistory" class="fruit-modal" @click.self="showHistory = false">
      <div class="fruit-modal-card">
        <div class="fruit-modal-head">
          <h3>历史记录</h3>
          <button type="button" class="fruit-modal-close" @click="showHistory = false">关闭</button>
        </div>
        <div v-if="spinHistory.length" class="fruit-history-list">
          <div v-for="(row, i) in spinHistory" :key="i" class="fruit-history-row">
            <span class="fh-time">{{ row.time }}</span>
            <span class="fh-award">{{ row.award }}</span>
            <span class="fh-win" :class="{ plus: row.win > 0 }">
              {{ row.win > 0 ? `+${row.win}` : '0' }}
            </span>
          </div>
        </div>
        <div v-else class="fruit-modal-empty">暂无记录，开始游戏后这里会显示近局结果</div>
      </div>
    </div>

    <!-- 游戏玩法 -->
    <div v-if="showRules" class="fruit-modal" @click.self="showRules = false">
      <div class="fruit-modal-card fruit-modal-card--rules">
        <div class="fruit-modal-head">
          <h3>游戏玩法</h3>
          <button type="button" class="fruit-modal-close" @click="showRules = false">关闭</button>
        </div>
        <div class="fruit-rules-body">
          <p>经典水果机（玛丽机）：先选倍数，再对各水果押分，按「开始」跑灯开奖。</p>
          <p><b>自动</b>：盘面已有押分时点「自动」，会按当前押分连续开局；按钮变为「停止」，再点即可在本局结束后停下。</p>
          <p><b>普通中奖</b>：灯停在已押符号上，按该格倍率 × 该符号押注 × 当前倍数得分。</p>
          <p><b>开火车</b>：正常停灯 → 全图闪 → 语音报奖 → 从停点一格格往前开并同步常驻一二行算账；结束后有赢分才进猜大小。</p>
          <p><b>大三元 / 小三元 / 大四喜 / 大满贯</b>：正常停灯 → 全图闪 → 语音揭晓 → 对应格一格格点亮并同步算账。</p>
          <p><b>送灯</b>：停在好运格 → 闪灯报「送灯」→ 再分别跑灯到各中奖格并算账。</p>
          <p><b>吃灯</b>：停在好运格 → 报「吃灯」，本局无分。</p>
          <p><b>猜大小</b>：当局有赢分时可猜大(8-13)或小(1-6)，猜中翻倍，猜错清零，7 为和局。自动模式下跳过猜大小，直接连开下一局。</p>
          <p>顶部弧槽跑马灯会在报奖与庆祝时追跑点亮，属老式柜机效果。</p>
          <button
            v-if="isDev"
            type="button"
            class="fruit-demo-btn"
            :disabled="busy || autoPlaying"
            @click="playTrainDemo"
          >
            演示完整开火车效果
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  FRUIT_AWARD_LABELS,
  FRUIT_MULT_STEPS,
  FRUIT_RING,
  type FruitAwardType,
  type FruitBetSymbolId,
} from '@/games/slots'
import type { CenterStageMode } from '@/games/slots/fruitCenterAssets'
import FruitCenterStage from '@/components/FruitCenterStage.vue'
import FruitSettingsPanel from '@/components/FruitSettingsPanel.vue'
import {
  playFruitAnnounce,
  playFruitAwardFanfare,
  playFruitAwardVoice,
  playFruitBet,
  playFruitGo,
  playFruitSfx,
  initFruitMuteFromStorage,
  setFruitBgmDuck,
  startFruitBgm,
  stopFruitBgm,
  stopFruitGo,
  unlockFruitAudio,
} from '@/games/slots/fruitAudio'
import { gamesApi } from '@/api/games'
import { useWalletStore } from '@/stores/wallet'
import { useToast } from '@/composables/useToast'
import { useGameSpinSession } from '@/composables/useGameSpinSession'

/** 七段数码管单字 */
const SEG_MAP: Record<string, string[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'd', 'e', 'g'],
  '3': ['a', 'b', 'c', 'd', 'g'],
  '4': ['b', 'c', 'f', 'g'],
  '5': ['a', 'c', 'd', 'f', 'g'],
  '6': ['a', 'c', 'd', 'e', 'f', 'g'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
}

const SEG_PATHS: Record<string, string> = {
  a: 'M3.5 1.5 L16.5 1.5 L14.5 3.5 L5.5 3.5 Z',
  b: 'M16.8 2.2 L18.8 4 L18.8 10.2 L16.8 12 L14.8 10.2 L14.8 4 Z',
  c: 'M16.8 14 L18.8 15.8 L18.8 22 L16.8 23.8 L14.8 22 L14.8 15.8 Z',
  d: 'M3.5 24.5 L5.5 22.5 L14.5 22.5 L16.5 24.5 L14.5 26.5 L5.5 26.5 Z',
  e: 'M1.2 14 L3.2 15.8 L3.2 22 L1.2 23.8 L-0.8 22 L-0.8 15.8 Z',
  f: 'M1.2 2.2 L3.2 4 L3.2 10.2 L1.2 12 L-0.8 10.2 L-0.8 4 Z',
  g: 'M3.5 13.2 L5.5 11.4 L14.5 11.4 L16.5 13.2 L14.5 15 L5.5 15 Z',
}

const SegDigit = defineComponent({
  name: 'SegDigit',
  props: {
    digit: { type: String, required: true },
    tone: { type: String as () => 'red' | 'cyan', default: 'red' },
  },
  setup(props) {
    const onColor = computed(() => (props.tone === 'cyan' ? '#2ef0ff' : '#ff2a1a'))
    const offColor = computed(() =>
      props.tone === 'cyan' ? 'rgba(10, 35, 48, 0.55)' : 'rgba(60, 16, 10, 0.5)',
    )
    const glow = computed(() =>
      props.tone === 'cyan'
        ? 'drop-shadow(0 0 1.5px #5af6ff) drop-shadow(0 0 3px rgba(40,220,255,0.9))'
        : 'drop-shadow(0 0 1.5px #ff4a30) drop-shadow(0 0 3px rgba(255,40,20,0.9))',
    )
    return () => {
      const on = new Set(SEG_MAP[props.digit] ?? SEG_MAP['0'])
      return h(
        'svg',
        {
          class: 'seg-digit',
          viewBox: '-1 0 22 28',
          preserveAspectRatio: 'xMidYMid meet',
          'aria-hidden': 'true',
        },
        Object.entries(SEG_PATHS).map(([id, d]) => {
          const lit = on.has(id)
          return h('path', {
            key: id,
            d,
            fill: lit ? onColor.value : offColor.value,
            style: lit ? { filter: glow.value } : undefined,
          })
        }),
      )
    }
  },
})

const router = useRouter()
const route = useRoute()
const isDev = import.meta.env.DEV
/** DEV 下一局强制大奖（仅本地演示，不改真钱包） */
const forceAwardOnce = ref<FruitAwardType | null>(null)
const walletStore = useWalletStore()
const { toast } = useToast()
const spinSession = useGameSpinSession('fruit')
/** 服务端游戏限额（默认与 seed 一致，进页后刷新） */
const fruitMinBet = ref(1)
const fruitMaxBet = ref(50_000)

const cabinetBodyUrl = '/images/games/slots/fruit-cabinet-base.png'
const cabinetAmbientUrl = '/images/games/slots/fruit-cabinet-bg-blur.jpg'
const fruitRingUrl = '/images/games/slots/24格.png'

const BASE_W = 1024
const BASE_H = 1536

interface PixelBox {
  x: number
  y: number
  w: number
  h: number
}

/** 24 格盘面（位置不动） */
const fruitRingBox: PixelBox = { x: 139, y: 421, w: 752, h: 680 }
/**
 * 底图中间大金框内侧黑屏 = 电视机画面区
 * 仅中心舞台用这里，不改 24 格坐标
 */
const tvScreenBox: PixelBox = { x: 256, y: 534, w: 518, h: 455 }
const totalScoreBox: PixelBox = { x: 275, y: 323, w: 185, h: 48 }
const winScoreBox: PixelBox = { x: 571, y: 323, w: 182, h: 47 }

/**
 * 「水果机」顶弧跑马灯（底图 1024×1536）
 * 位置：外金弧下沿 ↔ 内标题金框上沿 的灯槽中线（约 y=45 顶点，不是外框顶边）
 * 形状：圆拟合 + 等角均分，左右镜像对称，16 点
 */
const TITLE_MARQUEE_BULBS = [
  { x: 214, y: 155 },
  { x: 244, y: 130 },
  { x: 280, y: 108 },
  { x: 320, y: 90 },
  { x: 361, y: 75 },
  { x: 403, y: 62 },
  { x: 445, y: 53 },
  { x: 489, y: 49 },
  { x: 535, y: 49 },
  { x: 579, y: 53 },
  { x: 621, y: 62 },
  { x: 663, y: 75 },
  { x: 704, y: 90 },
  { x: 744, y: 108 },
  { x: 782, y: 130 },
  { x: 820, y: 155 },
] as const

/** 灯珠直径：落在灯槽内 */
const TITLE_MARQUEE_BULB_SIZE = 28
const titleMarqueeBulbs = TITLE_MARQUEE_BULBS

/**
 * 24 格在 ring 图内的实测格子（752×680）
 * 格缝按 24格.png 透明缝实测，行高不均（GOOD LUCK 等偏矮）
 * 行高约：103 / 107 / 102 / 79 / 102 / 87 / 100
 * 顺序与 FRUIT_RING 一致：上7 → 右5 → 下7(右→左) → 左5(下→上)
 */
const RING_X = [0, 105, 214, 323, 432, 540, 648, 752] as const
const RING_Y = [0, 103, 210, 312, 391, 493, 580, 680] as const
const RING_PAD = 2

function ringCellAt(col: number, row: number): PixelBox {
  return {
    x: RING_X[col] + RING_PAD,
    y: RING_Y[row] + RING_PAD,
    w: RING_X[col + 1] - RING_X[col] - RING_PAD * 2,
    h: RING_Y[row + 1] - RING_Y[row] - RING_PAD * 2,
  }
}

const RING_CELL_LOCAL: ReadonlyArray<PixelBox> = [
  // 上 7
  ringCellAt(0, 0),
  ringCellAt(1, 0),
  ringCellAt(2, 0),
  ringCellAt(3, 0),
  ringCellAt(4, 0),
  ringCellAt(5, 0),
  ringCellAt(6, 0),
  // 右 5（含偏矮格）
  ringCellAt(6, 1),
  ringCellAt(6, 2),
  ringCellAt(6, 3),
  ringCellAt(6, 4),
  ringCellAt(6, 5),
  // 下 7（右→左）
  ringCellAt(6, 6),
  ringCellAt(5, 6),
  ringCellAt(4, 6),
  ringCellAt(3, 6),
  ringCellAt(2, 6),
  ringCellAt(1, 6),
  ringCellAt(0, 6),
  // 左 5（下→上，含偏矮格）
  ringCellAt(0, 5),
  ringCellAt(0, 4),
  ringCellAt(0, 3),
  ringCellAt(0, 2),
  ringCellAt(0, 1),
]

const cellBoxes: PixelBox[] = RING_CELL_LOCAL.map((b) => ({
  x: fruitRingBox.x + b.x,
  y: fruitRingBox.y + b.y,
  w: b.w,
  h: b.h,
}))

const totalScore = ref(0)
const winScore = ref(0)
const busy = ref(false)
const cursorIndex = ref(-1)
// 跑灯高亮直写 DOM：只在旧/新两个格子上增删 .active class，
// 不再让 24 格 v-for 每步整体重算 class（跑灯每圈数十步），显著降低主线程压力。
const ringCellEls: (HTMLElement | null)[] = []
function setRingCellRef(el: HTMLElement | null, i: number) {
  ringCellEls[i] = el
}
function setCursor(idx: number) {
  const old = cursorIndex.value
  if (old === idx) return
  if (old >= 0) ringCellEls[old]?.classList.remove('active')
  if (idx >= 0) ringCellEls[idx]?.classList.add('active')
  cursorIndex.value = idx
}
const hitLit = ref<Set<number>>(new Set())
const trainHead = ref(-1)
const trainTail = ref(-1)
const flashAll = ref(false)
const selectedBet = ref<FruitBetSymbolId>('apple')

/** 标题弧槽跑马灯：常灭，报奖时追跑 */
const titleMarqueeOn = ref(false)
const titleMarqueePhase = ref(0)
let titleMarqueeTimer: ReturnType<typeof setInterval> | null = null

/** 中心舞台状态 */
const stageMode = ref<CenterStageMode>('idle')
const stageAwardType = ref<FruitAwardType | 'bar' | 'normal'>('normal')
const gambleResultNum = ref<number | null>(null)
const centerHitSymbol = ref<FruitBetSymbolId | 'luck' | null>(null)
const centerHitSize = ref<'big' | 'small' | 'luck'>('big')
const centerHitKind = ref<string | null>(null)
const centerHitLabel = ref('')
/** 中奖格赔率（算式第一项） */
const centerHitOdds = ref(0)
/** 该符号押注注数（算式第三项） */
const centerHitBetUnits = ref(0)
const showHistory = ref(false)
const showRules = ref(false)
const showSettings = ref(false)

interface SpinHistoryRow {
  time: string
  award: string
  win: number
}
const spinHistory = ref<SpinHistoryRow[]>([])

const totalScoreDigits = computed(() =>
  String(Math.min(999999, Math.max(0, totalScore.value))).padStart(6, '0').split(''),
)
const winScoreDigits = computed(() =>
  String(Math.min(999999, Math.max(0, winScore.value))).padStart(6, '0').split(''),
)

type ControlId = 'refund' | 'auto' | 'small' | 'big' | 'start'

interface ControlButton extends PixelBox {
  id: ControlId
  label: string
  src: string
}

/** 自动连局中（为 true 时按钮显示「停止」） */
const autoPlaying = ref(false)
let autoRunToken = 0

const controlButtons = computed<ControlButton[]>(() => [
  { id: 'refund', label: '退币', src: '/images/games/slots/退币.png', x: 139, y: 1136, w: 129, h: 64 },
  {
    id: 'auto',
    label: autoPlaying.value ? '停止' : '自动',
    src: autoPlaying.value ? '/images/games/slots/停止.png' : '/images/games/slots/自动.png',
    x: 297,
    y: 1136,
    w: 127,
    h: 63,
  },
  { id: 'small', label: '小', src: '/images/games/slots/小.png', x: 451, y: 1136, w: 109, h: 63 },
  { id: 'big', label: '大', src: '/images/games/slots/大.png', x: 587, y: 1136, w: 109, h: 63 },
  { id: 'start', label: '开始', src: '/images/games/slots/开始.png', x: 726, y: 1137, w: 159, h: 62 },
])

function isControlDisabled(id: ControlId) {
  if (id === 'refund') return false
  // 自动中允许点「停止」；未开自动时转盘忙则不可点
  if (id === 'auto') return busy.value && !autoPlaying.value
  return busy.value || autoPlaying.value
}

function stopAutoPlay() {
  if (!autoPlaying.value) return
  autoPlaying.value = false
  autoRunToken += 1
}

type BetId = FruitBetSymbolId

interface BetButton extends PixelBox {
  id: BetId
  label: string
  src: string
}

const betButtons: BetButton[] = [
  { id: 'bar', label: '天门', src: '/images/games/slots/1.png', x: 75, y: 1270, w: 118, h: 100 },
  { id: 'seven', label: '77', src: '/images/games/slots/2.png', x: 185, y: 1269, w: 113, h: 101 },
  { id: 'star', label: '双星', src: '/images/games/slots/3.png', x: 295, y: 1269, w: 108, h: 101 },
  { id: 'melon', label: '西瓜', src: '/images/games/slots/4.png', x: 402, y: 1269, w: 106, h: 101 },
  { id: 'bell', label: '铃铛', src: '/images/games/slots/5.png', x: 510, y: 1269, w: 109, h: 101 },
  { id: 'lemon', label: '芒果', src: '/images/games/slots/6.png', x: 618, y: 1269, w: 111, h: 101 },
  { id: 'orange', label: '橘子', src: '/images/games/slots/7.png', x: 726, y: 1269, w: 114, h: 101 },
  { id: 'apple', label: '苹果', src: '/images/games/slots/8.png', x: 832, y: 1269, w: 120, h: 101 },
]

const betLeds: Array<PixelBox & { id: BetId }> = [
  { id: 'bar', x: 104, y: 1240, w: 83, h: 22 },
  { id: 'seven', x: 206, y: 1240, w: 85, h: 22 },
  { id: 'star', x: 313, y: 1240, w: 81, h: 22 },
  { id: 'melon', x: 414, y: 1240, w: 84, h: 22 },
  { id: 'bell', x: 520, y: 1240, w: 85, h: 22 },
  { id: 'lemon', x: 627, y: 1240, w: 83, h: 22 },
  { id: 'orange', x: 731, y: 1240, w: 86, h: 22 },
  { id: 'apple', x: 837, y: 1240, w: 87, h: 22 },
]

const betCounts = ref<Record<BetId, number>>({
  bar: 0,
  seven: 0,
  star: 0,
  melon: 0,
  bell: 0,
  lemon: 0,
  orange: 0,
  apple: 0,
})

function betLedDigits(id: BetId) {
  return String(Math.min(99, betCounts.value[id] ?? 0)).padStart(2, '0').split('')
}

type MultValue = (typeof FRUIT_MULT_STEPS)[number]

interface MultButton extends PixelBox {
  value: MultValue
  src: string
}

const multButtons: MultButton[] = [
  { value: 1, src: '/images/games/slots/X1.png', x: 242, y: 1435, w: 89, h: 66 },
  { value: 5, src: '/images/games/slots/X5.png', x: 354, y: 1435, w: 89, h: 66 },
  { value: 10, src: '/images/games/slots/X10.png', x: 470, y: 1435, w: 89, h: 66 },
  { value: 20, src: '/images/games/slots/X20.png', x: 586, y: 1435, w: 92, h: 66 },
  { value: 50, src: '/images/games/slots/X50.png', x: 703, y: 1435, w: 92, h: 66 },
  { value: 100, src: '/images/games/slots/X100.png', x: 823, y: 1435, w: 92, h: 66 },
]

const selectedMult = ref<MultValue>(10)

/** 上一局注数快照（开始键空押时复用） */
const lastBetCounts = ref<Record<BetId, number> | null>(null)
/** 当前已从总积分扣下、压在盘面上的分数 */
const stakedScore = ref(0)

let betHoldTimer: ReturnType<typeof setTimeout> | null = null
let betHoldInterval: ReturnType<typeof setInterval> | null = null

function hasAnyBet(src: Record<BetId, number> = betCounts.value) {
  return (Object.values(src) as number[]).some((n) => n > 0)
}

function clearBoardBets(refund: boolean) {
  if (refund && stakedScore.value > 0) {
    totalScore.value += stakedScore.value
  }
  stakedScore.value = 0
  for (const k of Object.keys(betCounts.value) as BetId[]) betCounts.value[k] = 0
}

function stopBetHold() {
  if (betHoldTimer) {
    clearTimeout(betHoldTimer)
    betHoldTimer = null
  }
  if (betHoldInterval) {
    clearInterval(betHoldInterval)
    betHoldInterval = null
  }
}

/** 按下：立刻下一注；长按后连加 */
function onBetHoldStart(id: BetId, ev?: PointerEvent) {
  if (busy.value || autoPlaying.value) return
  unlockFruitAudio()
  startFruitBgm()
  ev?.preventDefault()
  try {
    if (ev) {
      ;(ev.currentTarget as HTMLElement | null)?.setPointerCapture?.(ev.pointerId)
    }
  } catch {
    /* ignore */
  }

  selectedBet.value = id
  if (!addBet(id)) return

  stopBetHold()
  betHoldTimer = setTimeout(() => {
    betHoldTimer = null
    betHoldInterval = setInterval(() => {
      if (busy.value || autoPlaying.value || !addBet(id)) stopBetHold()
    }, 90)
  }, 280)
}

function onBetHoldEnd() {
  stopBetHold()
}

/** 把上一局注数摆回盘面（开始键第一次），并立刻从总积分扣下 */
function restoreLastBets(): boolean {
  if (!lastBetCounts.value || !hasAnyBet(lastBetCounts.value)) return false
  const restored = { ...lastBetCounts.value }
  const units = (Object.values(restored) as number[]).reduce((a, b) => a + b, 0)
  const cost = units * selectedMult.value
  if (cost > fruitMaxBet.value) {
    playFruitSfx('lose', 0.45)
    toast(`总押注不能超过 ${fruitMaxBet.value}`)
    return false
  }
  // 若盘面已有押分，先退回再重摆
  if (stakedScore.value > 0) {
    totalScore.value += stakedScore.value
    stakedScore.value = 0
  }
  if (totalScore.value < cost) {
    playFruitSfx('lose', 0.45)
    toast('积分不足，无法重复上局')
    return false
  }
  betCounts.value = restored
  totalScore.value -= cost
  stakedScore.value = cost
  playFruitSfx('click')
  return true
}

function clearCenterHit() {
  centerHitSymbol.value = null
  centerHitSize.value = 'big'
  centerHitKind.value = null
  centerHitLabel.value = ''
  centerHitOdds.value = 0
  centerHitBetUnits.value = 0
}

function setCenterHit(cellIndex: number) {
  const cell = FRUIT_RING[cellIndex]
  if (!cell) return
  centerHitKind.value = cell.kind
  centerHitSymbol.value = cell.symbol ?? 'luck'
  centerHitSize.value = cell.size
  centerHitLabel.value = cell.label
  centerHitOdds.value = cell.mult
  const bets = lastBetCounts.value ?? betCounts.value
  centerHitBetUnits.value = cell.symbol ? bets[cell.symbol] ?? 0 : 0
}

function enterAwardStage(awardType: FruitAwardType | 'bar' | 'normal') {
  // 不再切大奖分镜：语音/闪灯报奖，算账留在常驻四行
  stageAwardType.value = awardType
  stageMode.value = 'idle'
}

function enterGambleOrIdle() {
  // 保留中奖图标，供常驻四行顶栏显示；新一局 doSpin 时再清
  gambleResultNum.value = null
  if (winScore.value > 0) {
    stageMode.value = 'gamble_roll'
  } else {
    stageMode.value = 'idle'
    stageAwardType.value = 'normal'
  }
}

function boxStyle(box: PixelBox) {
  return {
    left: `${(box.x / BASE_W) * 100}%`,
    top: `${(box.y / BASE_H) * 100}%`,
    width: `${(box.w / BASE_W) * 100}%`,
    height: `${(box.h / BASE_H) * 100}%`,
  }
}

function titleMarqueeBulbStyle(bulb: { x: number; y: number }) {
  const s = TITLE_MARQUEE_BULB_SIZE
  return {
    left: `${((bulb.x - s / 2) / BASE_W) * 100}%`,
    top: `${((bulb.y - s / 2) / BASE_H) * 100}%`,
    width: `${(s / BASE_W) * 100}%`,
  }
}

/** 经典三段跑马：亮 → 灭 → 灭 循环追跑 */
function titleMarqueeLit(index: number) {
  if (!titleMarqueeOn.value) return false
  const n = titleMarqueeBulbs.length
  const phase = titleMarqueePhase.value % n
  // 一串 3 颗亮灯沿弧追跑
  for (let k = 0; k < 3; k++) {
    if ((phase + k) % n === index) return true
  }
  // 对侧再一串，更像柜机对称跑灯
  const phase2 = (phase + Math.floor(n / 2)) % n
  for (let k = 0; k < 3; k++) {
    if ((phase2 + k) % n === index) return true
  }
  return false
}

function startTitleMarquee() {
  titleMarqueeOn.value = true
  if (titleMarqueeTimer) return
  titleMarqueeTimer = setInterval(() => {
    titleMarqueePhase.value = (titleMarqueePhase.value + 1) % titleMarqueeBulbs.length
  }, 70)
}

function stopTitleMarquee() {
  titleMarqueeOn.value = false
  titleMarqueePhase.value = 0
  if (titleMarqueeTimer) {
    clearInterval(titleMarqueeTimer)
    titleMarqueeTimer = null
  }
}

function syncTitleMarquee() {
  const celebrating =
    flashAll.value ||
    (busy.value && stageAwardType.value !== 'normal') ||
    stageMode.value === 'gamble_roll' ||
    stageMode.value === 'gamble_win' ||
    stageMode.value === 'gamble_push'
  if (celebrating) startTitleMarquee()
  else stopTitleMarquee()
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/**
 * 总积分 = 玩家自己的可用积分（钱包余额 − 当局未取赢分 − 已压在盘面的分）。
 * 当局赢分单独挂在「当局赢分」灯上，不并进总积分，直到取分/开新局/退币。
 */
function syncScoreFromWallet() {
  const bal = Math.max(0, Math.floor(Number(walletStore.balance) || 0))
  totalScore.value = Math.max(
    0,
    bal - Math.max(0, winScore.value) - Math.max(0, stakedScore.value),
  )
}

/** 把当局赢分并入总积分显示（开新局 / 自动跳过猜大小 / 退币） */
function collectPendingWin() {
  if (winScore.value <= 0) return
  winScore.value = 0
  syncScoreFromWallet()
}

function onFirstInteract() {
  unlockFruitAudio()
  startFruitBgm()
}

function goBack() {
  stopAutoPlay()
  stopFruitBgm()
  // replace 回大厅，去掉游戏页历史，避免大厅返回再次进入游戏
  router.replace('/lobby')
}

function openSettings() {
  unlockFruitAudio()
  playFruitSfx('click', 0.45)
  showSettings.value = true
}

function pushSpinHistory(awardType: string, win: number) {
  const award =
    awardType in FRUIT_AWARD_LABELS
      ? FRUIT_AWARD_LABELS[awardType as FruitAwardType]
      : awardType === 'bar'
        ? '天门'
        : '普通中奖'
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
  spinHistory.value.unshift({ time, award, win })
  if (spinHistory.value.length > 30) spinHistory.value.length = 30
}

/** 注数合计 × 倍数 = 实际扣分 */
function totalBetCost() {
  const units = (Object.values(betCounts.value) as number[]).reduce((a, b) => a + b, 0)
  return units * selectedMult.value
}

function buildBetPayload(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of Object.keys(betCounts.value) as BetId[]) {
    const units = betCounts.value[id]
    if (units > 0) out[id] = units * selectedMult.value
  }
  return out
}

async function onControlClick(id: ControlId) {
  unlockFruitAudio()
  startFruitBgm()
  if (id === 'refund') {
    stopAutoPlay()
    playFruitSfx('cashout')
    // 退币：先取当局赢分，再把盘面押分退回总积分
    collectPendingWin()
    clearBoardBets(true)
    syncScoreFromWallet()
    hitLit.value = new Set()
    setCursor(-1)
    trainHead.value = -1
    trainTail.value = -1
    clearCenterHit()
    enterGambleOrIdle()
    return
  }
  if (id === 'auto') {
    await onAutoClick()
    return
  }
  if (busy.value || autoPlaying.value) return

  if (id === 'big' || id === 'small') {
    await doGamble(id)
    return
  }
  if (id === 'start') {
    // 空押：第一次开始 = 重复上一局注数；再点开始才开跑
    if (!hasAnyBet()) {
      if (restoreLastBets()) return
      toast('请先押分')
      playFruitSfx('lose', 0.4)
      return
    }
    await doSpin()
  }
}

/** 自动：按当前（或上局）押分连续开局；再点变为停止 */
async function onAutoClick() {
  if (autoPlaying.value) {
    stopAutoPlay()
    playFruitSfx('click')
    return
  }
  if (busy.value) return

  if (!hasAnyBet()) {
    if (!restoreLastBets()) {
      toast('请先押分')
      playFruitSfx('lose', 0.4)
      return
    }
  }

  autoPlaying.value = true
  playFruitSfx('click')
  const token = ++autoRunToken

  while (autoPlaying.value && token === autoRunToken) {
    // 自动模式跳过猜大小：当局赢分并入总积分后继续开
    if (winScore.value > 0) {
      collectPendingWin()
      stageMode.value = 'idle'
      stageAwardType.value = 'normal'
      gambleResultNum.value = null
    }

    if (!hasAnyBet()) {
      if (!restoreLastBets()) {
        stopAutoPlay()
        toast('积分不足，自动已停止')
        playFruitSfx('lose', 0.4)
        break
      }
    }

    await doSpin()

    if (!autoPlaying.value || token !== autoRunToken) break

    await sleep(380)

    if (!autoPlaying.value || token !== autoRunToken) break

    if (!restoreLastBets()) {
      stopAutoPlay()
      toast('积分不足，自动已停止')
      playFruitSfx('lose', 0.4)
      break
    }
  }
}

function addBet(id: BetId): boolean {
  const cost = selectedMult.value
  if (totalScore.value < cost) {
    playFruitSfx('lose', 0.45)
    toast('积分不足')
    return false
  }
  if (stakedScore.value + cost > fruitMaxBet.value) {
    playFruitSfx('lose', 0.45)
    toast(`总押注不能超过 ${fruitMaxBet.value}`)
    return false
  }
  if (betCounts.value[id] >= 99) {
    toast('单格已满')
    return false
  }
  betCounts.value[id] += 1
  // 押分当下从总积分扣，方便看出压了多少
  totalScore.value -= cost
  stakedScore.value += cost
  playFruitBet(id)
  return true
}

function onMultClick(value: MultValue) {
  if (busy.value || autoPlaying.value) return
  if (value === selectedMult.value) return

  const units = (Object.values(betCounts.value) as number[]).reduce((a, b) => a + b, 0)
  if (units > 0) {
    const newStake = units * value
    if (newStake > fruitMaxBet.value) {
      playFruitSfx('lose', 0.45)
      toast(`总押注不能超过 ${fruitMaxBet.value}`)
      return
    }
    const delta = newStake - stakedScore.value
    if (delta > 0 && totalScore.value < delta) {
      playFruitSfx('lose', 0.45)
      toast('积分不足，无法切换该倍数')
      return
    }
    // 倍数升高补扣，降低则退回差额
    totalScore.value -= delta
    stakedScore.value = newStake
  }

  selectedMult.value = value
  playFruitSfx('mult')
}

async function doGamble(choice: 'big' | 'small') {
  if (winScore.value <= 0) {
    toast('没有可再赌的当局赢分')
    playFruitSfx(choice === 'big' ? 'big' : 'small')
    return
  }
  if (stageMode.value === 'gamble_win' || stageMode.value === 'gamble_lose') return
  busy.value = true
  playFruitSfx(choice === 'big' ? 'big' : 'small')
  const amount = winScore.value
  try {
    const clientRequestId = spinSession.currentOrNewClientRequestId()
    const res = await gamesApi.fruitGamble(amount, choice, clientRequestId)
    spinSession.clearClientRequestId()
    walletStore.balance = res.balance
    const result = res.result as 'win' | 'lose' | 'push'
    const roll = res.roll

    gambleResultNum.value = roll
    if (result === 'win') {
      winScore.value = amount * 2
      syncScoreFromWallet()
      stageMode.value = 'gamble_win'
      playFruitSfx('gambleWin')
      await sleep(2000)
      stageMode.value = 'gamble_roll'
    } else if (result === 'lose') {
      winScore.value = 0
      syncScoreFromWallet()
      stageMode.value = 'gamble_lose'
      playFruitSfx('gambleLose')
      await sleep(2000)
      enterGambleOrIdle()
    } else {
      syncScoreFromWallet()
      stageMode.value = 'gamble_push'
      playFruitSfx('click')
      await sleep(1200)
      stageMode.value = 'gamble_roll'
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : '再赌失败')
  } finally {
    busy.value = false
  }
}

async function runLightTo(stopIndex: number, minLaps = 2) {
  const n = FRUIT_RING.length
  const start = cursorIndex.value >= 0 ? cursorIndex.value : 0
  const dist = ((stopIndex - start) % n + n) % n
  const totalSteps = minLaps * n + dist
  setFruitBgmDuck(true)
  playFruitGo()
  for (let step = 0; step <= totalSteps; step++) {
    const idx = (start + step) % n
    setCursor(idx)
    const p = step / totalSteps
    if (p > 0.72) playFruitSfx('tick', 0.35)
    let delay = 55
    if (p < 0.15) delay = 110 - p * 300
    else if (p > 0.7) delay = 55 + (p - 0.7) * 280
    else delay = 38
    await sleep(Math.max(28, delay))
  }
  stopFruitGo()
  setCursor(stopIndex)
  playFruitSfx('stop')
  await sleep(220)
}

/** 单格报奖：中心立刻切水果图标 + 语音 + 累加赢分 */
async function announceCell(
  cellIndex: number,
  addWin = 0,
): Promise<string> {
  const cell = FRUIT_RING[cellIndex]
  if (!cell?.symbol) return ''
  setCenterHit(cellIndex)
  const size = cell.size === 'big' ? 'big' : 'small'
  const label = `${cell.label} ×${cell.mult}`
  const announceP = playFruitAnnounce(cell.symbol, size)
  if (addWin > 0) {
    winScore.value += addWin
    playFruitSfx('scoreUp', 0.7)
  }
  await announceP
  return label
}

/** 天门 / 高倍格：灯效庆祝；一律留在常驻四行算账 */
async function celebrateHighCell(cellIndex: number) {
  const cell = FRUIT_RING[cellIndex]
  if (!cell?.symbol) return
  const isBar = cell.symbol === 'bar'
  const isHigh = isBar || cell.mult >= 20
  if (!isHigh) return

  setCenterHit(cellIndex)
  stageMode.value = 'idle'
  playFruitSfx(isBar ? 'barWin' : 'jackpot', isBar ? 0.95 : 0.85)
  if (isBar) playFruitSfx('jackpot', 0.7)
  await flashRing(isBar ? 5 : 3, isBar ? 85 : 90)
  await sleep(isBar ? 350 : 200)
}

async function flashRing(times = 3, gap = 120) {
  for (let i = 0; i < times; i++) {
    flashAll.value = true
    await sleep(gap)
    flashAll.value = false
    await sleep(gap)
  }
}

/** 开火车：车头推进；每亮一格同步常驻一二行算账 */
async function playTrainReveal(
  hitIndexes: number[],
  winByCell: Map<number, number>,
) {
  hitLit.value = new Set()
  trainHead.value = -1
  trainTail.value = -1
  stageMode.value = 'idle'
  for (const idx of hitIndexes) {
    trainTail.value = trainHead.value
    trainHead.value = idx
    const next = new Set(hitLit.value)
    next.add(idx)
    hitLit.value = next
    setCursor(idx)
    setCenterHit(idx)
    playFruitSfx('trainStep', 0.85)
    await announceCell(idx, winByCell.get(idx) ?? 0)
    await sleep(100)
  }
  trainHead.value = -1
  trainTail.value = -1
}

/**
 * 大三元 / 小三元 / 大四喜 / 大满贯：
 * 揭晓后一格格点亮留下，同步常驻一二行算账（不做每格狂闪）
 */
async function playMultiHitReveal(
  hitIndexes: number[],
  winByCell: Map<number, number>,
  stepMs = 260,
) {
  hitLit.value = new Set()
  stageMode.value = 'idle'
  for (const idx of hitIndexes) {
    const next = new Set(hitLit.value)
    next.add(idx)
    hitLit.value = next
    setCursor(idx)
    setCenterHit(idx)
    playFruitSfx('special', 0.4)
    await announceCell(idx, winByCell.get(idx) ?? 0)
    await sleep(stepMs)
  }
}

/** 送灯：揭晓后分别跑灯到每个中奖格，灯留下并同步算账 */
async function playLuckSendRuns(
  hitIndexes: number[],
  winByCell: Map<number, number>,
) {
  hitLit.value = new Set()
  stageMode.value = 'idle'
  for (const idx of hitIndexes) {
    await runLightTo(idx, 1)
    const next = new Set(hitLit.value)
    next.add(idx)
    hitLit.value = next
    setCenterHit(idx)
    await announceCell(idx, winByCell.get(idx) ?? 0)
    await sleep(80)
  }
}

async function revealHits(
  awardType: FruitAwardType,
  stopIndex: number,
  hitIndexes: number[],
  wins: Array<{ cellIndex: number; amount: number }>,
) {
  const winByCell = new Map(wins.map((w) => [w.cellIndex, w.amount]))
  const stoppedOnLuck = FRUIT_RING[stopIndex]?.size === 'luck'
  const isSend =
    awardType === 'luck_send' || (stoppedOnLuck && hitIndexes.length > 0 && awardType !== 'luck_eat')
  const special = awardType !== 'normal' || isSend

  hitLit.value = new Set()
  stageMode.value = 'idle'

  // —— 吃灯：停 Luck → 闪 → 报吃灯 → 本局无分 ——
  if (awardType === 'luck_eat') {
    setCursor(stopIndex)
    centerHitSymbol.value = 'luck'
    centerHitSize.value = 'luck'
    centerHitKind.value = 'luck'
    centerHitLabel.value = '吃灯'
    await sleep(350)
    playFruitSfx('special', 0.55)
    await flashRing(2, 110)
    enterAwardStage('luck_eat')
    await playFruitAwardVoice('luck_eat')
    await sleep(500)
    clearCenterHit()
    setFruitBgmDuck(false)
    return
  }

  // —— 送灯：停 Luck → 闪 → 报送灯 → 再分别跑灯到各中奖格并算账 ——
  if (isSend) {
    setCursor(stopIndex)
    centerHitSymbol.value = 'luck'
    centerHitSize.value = 'luck'
    centerHitKind.value = 'luck'
    centerHitLabel.value = '送灯'
    await sleep(350)
    playFruitSfx('jackpot', 0.85)
    await flashRing(3, 100)
    enterAwardStage('luck_send')
    playFruitAwardFanfare('luck_send')
    await playFruitAwardVoice('luck_send')
    await sleep(150)
    await playLuckSendRuns(hitIndexes, winByCell)
    playFruitSfx('coin', 0.8)
    await flashRing(3, 90)
  }
  // —— 开火车：停灯 → 闪 → 报奖 → 从停点一格格开并算账 ——
  else if (awardType === 'train') {
    clearCenterHit()
    setCursor(stopIndex)
    await sleep(420)
    playFruitSfx('special', 0.75)
    await flashRing(4, 90)
    enterAwardStage('train')
    playFruitAwardFanfare('train')
    await playFruitAwardVoice('train')
    await sleep(180)
    await playTrainReveal(hitIndexes, winByCell)
    playFruitSfx('coin', 0.85)
    playFruitSfx('awardTrain', 0.55)
    await flashRing(3, 90)
  }
  // —— 大三元 / 小三元 / 大四喜 / 大满贯 ——
  // 停灯 → 闪 → 语音揭晓 → 对应格一格格点亮并算账
  else if (awardType === 'big3' || awardType === 'small3' || awardType === 'four' || awardType === 'slam') {
    clearCenterHit()
    setCursor(stopIndex)
    await sleep(400)
    playFruitSfx('jackpot', 0.95)
    await flashRing(awardType === 'slam' ? 5 : 4, 90)
    enterAwardStage(awardType)
    playFruitAwardFanfare(awardType)
    await playFruitAwardVoice(awardType)
    await sleep(180)
    await playMultiHitReveal(
      hitIndexes,
      winByCell,
      awardType === 'slam' ? 110 : awardType === 'four' ? 200 : 280,
    )
    playFruitSfx('coin', 0.85)
    await flashRing(3, 90)
  }
  // —— 普通单格 ——
  else if (hitIndexes.length) {
    hitLit.value = new Set(hitIndexes)
    for (const idx of hitIndexes) {
      setCursor(idx)
      const amt = winByCell.get(idx) ?? 0
      setCenterHit(idx)
      stageMode.value = 'idle'
      await celebrateHighCell(idx)
      await announceCell(idx, amt)
    }
    if ((wins.reduce((s, w) => s + w.amount, 0) || 0) > 0) {
      playFruitSfx('win', 0.75)
    }
  }

  await sleep(special ? 700 : 280)
  if (special) await sleep(500)
  setFruitBgmDuck(false)
  // 猜大小由 doSpin 在最终赢分校准后再切入
}

async function doSpin() {
  const payload = buildBetPayload()
  if (Object.keys(payload).length === 0) {
    toast('请先押分')
    playFruitSfx('lose', 0.4)
    return
  }
  // 押分时已从总积分扣过，这里用已压分数作本局成本
  const cost = stakedScore.value > 0 ? stakedScore.value : totalBetCost()
  if (cost <= 0) {
    toast('请先押分')
    playFruitSfx('lose', 0.4)
    return
  }
  if (cost < fruitMinBet.value || cost > fruitMaxBet.value) {
    toast(`总押注须在 ${fruitMinBet.value}~${fruitMaxBet.value} 之间`)
    playFruitSfx('lose', 0.4)
    return
  }

  // 开跑前记下本局注数，供下次「开始」复用
  lastBetCounts.value = { ...betCounts.value }

  busy.value = true
  // 开新局前：当局赢分并入总积分（不丢分）
  collectPendingWin()
  hitLit.value = new Set()
  trainHead.value = -1
  trainTail.value = -1
  flashAll.value = false
  stageMode.value = 'idle'
  clearCenterHit()
  gambleResultNum.value = null
  playFruitSfx('start')

  let result: {
    awardType: string
    stopIndex: number
    hitIndexes: number[]
    totalWin: number
    wins?: Array<{ cellIndex: number; amount: number; symbol?: string; mult?: number }>
    balance?: number
  }

  try {
    // DEV 演示强制奖只改表现，不改钱包；生产路径一律服务端权威
    const forced = isDev ? forceAwardOnce.value : null
    forceAwardOnce.value = null
    if (forced) {
      const { localFruitSpin } = await import('@/games/slots/fruitLocalSpin')
      result = localFruitSpin(payload, { forceAward: forced })
      // 演示不触碰真钱包，用本地总分做演出
      totalScore.value = Math.max(0, totalScore.value)
    } else {
      const clientRequestId = spinSession.currentOrNewClientRequestId()
      const res = await gamesApi.fruitSpin(payload, clientRequestId)
      spinSession.clearClientRequestId()
      result = res
      if (typeof res.balance === 'number') walletStore.balance = res.balance
    }

    const wins = (result.wins ?? []).map((w) => ({
      cellIndex: w.cellIndex,
      amount: w.amount,
    }))

    const award = result.awardType as FruitAwardType
    // 一律先正常跑灯停格；开火车等特殊奖在停定后再揭晓报奖
    await runLightTo(result.stopIndex, 2)
    await revealHits(award, result.stopIndex, result.hitIndexes, wins)

    // 以服务端结算为准校正当局赢分（报奖过程中已滚动累加）
    const win = result.totalWin ?? 0
    winScore.value = win
    pushSpinHistory(String(result.awardType || 'normal'), win)
    // 押注已消耗，清盘面但不退分
    stakedScore.value = 0
    for (const k of Object.keys(betCounts.value) as BetId[]) betCounts.value[k] = 0
    if (!forced) syncScoreFromWallet()

    const isSpecial = result.awardType !== 'normal'
    if (win > 0) {
      if (!isSpecial) {
        playFruitSfx('win')
        if (win >= cost * 20) playFruitSfx('coin')
      } else if (win >= cost * 10) {
        playFruitSfx('coin')
      }
    } else if (result.awardType !== 'luck_eat') {
      playFruitSfx('lose')
      setFruitBgmDuck(false)
    }

    // 报奖完全结束后再进猜大小（有赢分才转）
    await sleep(isSpecial ? 450 : 320)
    if (!forced) enterGambleOrIdle()
    else stageMode.value = 'idle'
    await sleep(isSpecial ? 200 : 280)
  } catch (e) {
    stopFruitGo()
    setFruitBgmDuck(false)
    flashAll.value = false
    stageMode.value = 'idle'
    clearCenterHit()
    try {
      await walletStore.fetchBalance()
      stakedScore.value = 0
      for (const k of Object.keys(betCounts.value) as BetId[]) betCounts.value[k] = 0
      syncScoreFromWallet()
    } catch {
      // 钱包不可用：把盘面押分退回总积分
      clearBoardBets(true)
    }
    toast(e instanceof Error ? e.message : '开奖失败')
  } finally {
    busy.value = false
  }
}

/** DEV：一键演示完整开火车（不改真钱包） */
async function playTrainDemo() {
  if (!isDev || busy.value || autoPlaying.value) return
  showRules.value = false
  unlockFruitAudio()
  startFruitBgm()

  if (!hasAnyBet()) {
    const ids: BetId[] = ['apple', 'orange', 'lemon', 'melon', 'bell', 'bar', 'seven', 'star']
    for (const id of ids) {
      betCounts.value[id] = Math.max(betCounts.value[id] || 0, 2)
    }
    const units = ids.reduce((s, id) => s + (betCounts.value[id] || 0), 0)
    const cost = units * selectedMult.value
    if (totalScore.value < cost) {
      totalScore.value = cost + 5000
    }
    stakedScore.value = cost
    totalScore.value = Math.max(0, totalScore.value - cost)
  }

  forceAwardOnce.value = 'train'
  toast('演示：开火车完整效果（DEV）')
  await doSpin()
}

onMounted(async () => {
  initFruitMuteFromStorage()
  try {
    await walletStore.fetchBalance()
  } catch {
    /* 未登录时总分保持 0，不允许伪造余额 */
  }
  syncScoreFromWallet()
  try {
    const games = await gamesApi.list()
    const cfg = games.find((g) => g.code === 'fruit-machine')
    if (cfg) {
      fruitMinBet.value = Math.max(1, Number(cfg.minBet) || 1)
      fruitMaxBet.value = Math.max(fruitMinBet.value, Number(cfg.maxBet) || 50_000)
    }
  } catch {
    /* 用默认限额 */
  }

  if (isDev && String(route.query.demo || '') === 'train') {
    await sleep(400)
    await playTrainDemo()
    router.replace({ path: route.path, query: {} })
  }
})

watch([stageMode, flashAll, stageAwardType, busy], () => {
  syncTitleMarquee()
})

onUnmounted(() => {
  stopAutoPlay()
  stopBetHold()
  stopTitleMarquee()
  stopFruitBgm()
})
</script>

<style scoped>
.cabinet-page {
  position: relative;
  width: 100%;
  max-width: none;
  height: 100vh;
  height: 100dvh;
  margin: 0;
  overflow: hidden;
  background: #2a0c10;
}

.cabinet-ambient {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  display: block;
}

.cabinet-stage {
  /* 保持机柜 1024×1536，电视屏才能是设计比例 518×455（不再被视口拉成竖条） */
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  aspect-ratio: 1024 / 1536;
  width: min(100%, 480px, calc(100vh * 1024 / 1536), calc(100dvh * 1024 / 1536));
  height: auto;
  max-height: 100%;
}

.cabinet-body {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  user-select: none;
  -webkit-user-drag: none;
  display: block;
  pointer-events: none;
}

/* 「水果机」顶弧跑马灯：常灭暗泡，报奖追跑 */
.title-marquee {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}

.title-marquee-bulb {
  position: absolute;
  aspect-ratio: 1;
  border-radius: 50%;
  box-sizing: border-box;
  background:
    radial-gradient(circle at 35% 30%, #6a5038 0%, #2a1c10 48%, #0c0806 100%);
  border: 1.5px solid rgba(120, 85, 40, 0.95);
  box-shadow:
    inset 0 1px 2px rgba(255, 210, 140, 0.22),
    inset 0 -2px 3px rgba(0, 0, 0, 0.65),
    0 1px 2px rgba(0, 0, 0, 0.45);
  opacity: 0.95;
}

.title-marquee-bulb.lit {
  background:
    radial-gradient(circle at 32% 26%, #fffce8 0%, #ffe566 22%, #ffb428 55%, #e07010 82%, #8a4008 100%);
  border-color: rgba(255, 220, 120, 0.95);
  box-shadow:
    0 0 8px 3px rgba(255, 200, 60, 0.95),
    0 0 18px 6px rgba(255, 140, 20, 0.7),
    0 0 28px 8px rgba(255, 100, 0, 0.35),
    inset 0 0 6px rgba(255, 255, 230, 0.9),
    inset 0 -2px 3px rgba(120, 50, 0, 0.35);
  opacity: 1;
}

.fruit-tv-screen {
  position: absolute;
  z-index: 1;
  pointer-events: none;
}

.fruit-ring {
  position: absolute;
  z-index: 2;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  display: block;
}

.ring-cell {
  position: absolute;
  z-index: 3;
  border-radius: 10px;
  box-sizing: border-box;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.05s linear, box-shadow 0.05s linear, background 0.05s linear;
}

.ring-cell.active {
  opacity: 1;
  background: rgba(255, 230, 80, 0.28);
  box-shadow:
    inset 0 0 0 3px rgba(255, 220, 60, 0.95),
    0 0 14px 4px rgba(255, 200, 40, 0.75);
}

.ring-cell.hit {
  opacity: 1;
  background: rgba(255, 120, 40, 0.35);
  box-shadow:
    inset 0 0 0 3px rgba(255, 160, 40, 0.95),
    0 0 16px 5px rgba(255, 100, 20, 0.65);
}

.ring-cell.train {
  opacity: 1;
  background: rgba(80, 220, 255, 0.4);
  box-shadow:
    inset 0 0 0 3px rgba(160, 245, 255, 1),
    0 0 20px 8px rgba(40, 200, 255, 0.85),
    0 0 32px 10px rgba(255, 200, 60, 0.25);
  animation: fruitTrainHeadPulse 0.34s ease-out;
}

.ring-cell.train-tail {
  opacity: 1;
  background: rgba(60, 180, 230, 0.28);
  box-shadow:
    inset 0 0 0 3px rgba(100, 220, 255, 0.85),
    0 0 14px 5px rgba(40, 180, 255, 0.55);
}

.ring-cell.flash {
  opacity: 1 !important;
  background: rgba(255, 240, 120, 0.45);
  box-shadow:
    inset 0 0 0 3px #ffe566,
    0 0 22px 8px rgba(255, 200, 40, 0.85);
}

@keyframes fruitTrainHeadPulse {
  0% {
    transform: scale(1);
    filter: brightness(1.4);
  }
  100% {
    transform: scale(1);
    filter: brightness(1);
  }
}

.led-score,
.led-bet {
  position: absolute;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  pointer-events: none;
  box-sizing: border-box;
  overflow: visible;
  padding: 0;
}

.seg-digit {
  display: block;
  height: 78%;
  width: auto;
  aspect-ratio: 10 / 16;
  flex: 0 0 auto;
  max-width: none;
  overflow: visible;
}

.led-score .seg-digit {
  height: 70%;
  margin: 0 1px;
}

.led-bet .seg-digit {
  height: 80%;
  margin: 0 1px;
}

.ctrl-btn,
.bet-btn,
.mult-btn {
  position: absolute;
  z-index: 3;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: none;
  user-select: none;
  transition: transform 0.08s ease, filter 0.08s ease;
}

.ctrl-btn img,
.bet-btn img,
.mult-btn img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

.ctrl-btn:active:not(:disabled),
.bet-btn:active:not(:disabled),
.mult-btn:active:not(:disabled) {
  transform: scale(0.94);
  filter: brightness(0.9);
}

.ctrl-btn:disabled,
.bet-btn:disabled,
.mult-btn:disabled {
  cursor: default;
}

/* 有当局赢分时可按大/小再赌 */
.ctrl-btn.gambleHint {
  animation: gamblePulse 0.9s ease-in-out infinite alternate;
  filter: brightness(1.15) drop-shadow(0 0 8px rgba(255, 220, 80, 0.85));
}

.ctrl-btn.autoOn {
  filter: brightness(1.12) drop-shadow(0 0 8px rgba(255, 160, 40, 0.75));
}

@keyframes gamblePulse {
  from {
    transform: scale(1);
  }
  to {
    transform: scale(1.06);
  }
}

.bet-btn.selected {
  filter: brightness(1.12) drop-shadow(0 0 6px rgba(255, 200, 60, 0.7));
}

.mult-btn {
  border-radius: 8px;
  transition: transform 0.08s ease, filter 0.08s ease, box-shadow 0.12s ease;
}

.mult-btn img {
  border-radius: inherit;
}

.mult-btn.active {
  z-index: 4;
  box-shadow:
    0 0 0 2px rgba(219, 58, 1, 0.95),
    0 0 6px 2px rgba(219, 58, 1, 0.7),
    0 0 0 4px #ffce03,
    0 0 0 7px rgba(219, 58, 1, 0.55),
    0 0 14px 6px rgba(219, 58, 1, 0.55);
}

/* 与大厅一致的金圈顶栏按钮 */
.fruit-top-btn {
  position: fixed;
  top: max(12px, env(safe-area-inset-top));
  z-index: 100;
  width: 40px;
  height: 40px;
  padding: 0;
  font-size: 0;
  color: transparent;
  border: none;
  background-color: transparent;
  background-position: center;
  background-size: contain;
  background-repeat: no-repeat;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  transition: transform 0.15s, filter 0.18s;
}

.fruit-top-btn:active {
  transform: scale(0.92);
  filter: brightness(1.18);
}

.lobby-back.fruit-top-btn {
  left: 12px;
  background-image: url('/images/back-button.svg');
}

.fruit-top-right {
  position: fixed;
  top: max(12px, env(safe-area-inset-top));
  right: 12px;
  z-index: 100;
  display: flex;
  gap: 8px;
  align-items: center;
}

.fruit-demo-chip {
  border: 1px solid rgba(80, 220, 255, 0.65);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #062838;
  background: linear-gradient(180deg, #e8ffff 0%, #60d8ff 45%, #2090c8 100%);
  box-shadow: 0 0 10px rgba(60, 200, 255, 0.35);
  cursor: pointer;
  white-space: nowrap;
}

.fruit-demo-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.fruit-top-right .fruit-top-btn {
  position: static;
}

.fruit-top-btn--history {
  background-image: url('/images/history-button.svg');
}

.fruit-top-btn--rules {
  background-image: url('/images/rules-button.svg');
}

.fruit-top-btn--settings {
  background-image: url('/images/settings-button.svg');
}

.fruit-modal {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.62);
}

.fruit-modal-card {
  width: min(92vw, 380px);
  max-height: min(72vh, 520px);
  overflow: auto;
  border-radius: 14px;
  border: 1px solid rgba(244, 211, 107, 0.4);
  background: linear-gradient(180deg, #2a1c10 0%, #140e08 100%);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  color: #f5e6c8;
}

.fruit-modal-card--rules {
  max-height: min(78vh, 580px);
}

.fruit-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(244, 211, 107, 0.22);
}

.fruit-modal-head h3 {
  margin: 0;
  font-size: 16px;
  letter-spacing: 0.12em;
  color: #ffe7a0;
}

.fruit-modal-close {
  border: 1px solid rgba(244, 211, 107, 0.35);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  color: #f5e0c0;
  background: rgba(0, 0, 0, 0.25);
  cursor: pointer;
}

.fruit-modal-empty {
  padding: 36px 16px;
  text-align: center;
  color: rgba(245, 224, 192, 0.55);
  font-size: 13px;
}

.fruit-history-list {
  padding: 8px 12px 14px;
}

.fruit-history-row {
  display: grid;
  grid-template-columns: 72px 1fr 64px;
  gap: 8px;
  align-items: center;
  padding: 10px 6px;
  border-bottom: 1px solid rgba(244, 211, 107, 0.12);
  font-size: 13px;
}

.fh-time {
  color: rgba(245, 224, 192, 0.55);
  font-variant-numeric: tabular-nums;
}

.fh-award {
  color: #ffe7a0;
}

.fh-win {
  text-align: right;
  color: rgba(245, 224, 192, 0.55);
  font-variant-numeric: tabular-nums;
}

.fh-win.plus {
  color: #7dff9a;
  font-weight: 700;
}

.fruit-rules-body {
  padding: 12px 16px 18px;
  font-size: 13px;
  line-height: 1.65;
  color: rgba(245, 230, 200, 0.88);
}

.fruit-rules-body p {
  margin: 0 0 10px;
}

.fruit-rules-body b {
  color: #ffe7a0;
  font-weight: 700;
}

.fruit-demo-btn {
  display: block;
  width: 100%;
  margin-top: 14px;
  padding: 10px 14px;
  border: 1px solid rgba(80, 220, 255, 0.55);
  border-radius: 10px;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #062838;
  background: linear-gradient(180deg, #e8ffff 0%, #60d8ff 45%, #2090c8 100%);
  box-shadow: 0 0 14px rgba(60, 200, 255, 0.35);
  cursor: pointer;
}

.fruit-demo-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
