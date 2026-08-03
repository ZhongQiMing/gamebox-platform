<template>
  <div class="cabinet-page" @pointerdown.once="onFirstInteract">
    <img
      class="cabinet-ambient"
      :src="cabinetAmbientUrl"
      alt=""
      draggable="false"
      aria-hidden="true"
    />

    <div class="cabinet-stage" :class="ringFxClass">
      <img
        class="cabinet-body"
        :src="cabinetBodyUrl"
        alt="水果机
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
        alt="24格
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
          active: cursorIndex === i,
          hit: hitLit.has(i),
          train: trainHead === i,
          'train-tail': trainTail === i,
          'train-car': trainBody.has(i) && trainHead !== i,
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

    <!-- 与牌桌聊天室同一套侧栏图标：历史 / 玩法 / 设置 -->
    <div class="fruit-top-right" aria-label="快捷操作">
      <button type="button" class="fruit-rail-btn" title="历史记录" @click="openBetRecords">
        <img class="fruit-rail-ic" src="/images/table-rail/rail-history.png" alt="" draggable="false" />
        <span class="fruit-rail-lb">历史</span>
      </button>
      <button type="button" class="fruit-rail-btn" title="玩法规则" @click="showRules = true">
        <img class="fruit-rail-ic" src="/images/table-rail/rail-rules.png" alt="" draggable="false" />
        <span class="fruit-rail-lb">玩法</span>
      </button>
      <button type="button" class="fruit-rail-btn" title="设置" @click="openSettings">
        <img class="fruit-rail-ic" src="/images/table-rail/rail-settings.png" alt="" draggable="false" />
        <span class="fruit-rail-lb">设置</span>
      </button>
    </div>

    <FruitSettingsPanel v-if="showSettings" @close="showSettings = false" />

    <!-- 游戏玩法 -->
    <div v-if="showRules" class="fruit-modal" @click.self="showRules = false">
      <div class="fruit-modal-card fruit-modal-card--rules">
        <div class="fruit-modal-head">
          <h3>游戏玩法</h3>
          <button type="button" class="fruit-modal-close" aria-label="关闭" @click="showRules = false">
            &times;
          </button>
        </div>
        <div class="fruit-rules-body">
          <section class="fruit-rules-sec">
            <h4>一、游戏说明</h4>
            <p>
              水果机为经典街机玩法（俗称玛丽机）。外围共 24 个图案格，底部有 8 个押注仓位。              玩家先选择押注倍数，再对一个或多个水果仓位押分，按下「开始」后跑灯开奖。              灯停在已押符号对应的格子上即中奖；未押的符号停中不计分。            </p>
          </section>

          <section class="fruit-rules-sec">
            <h4>二、如何下注</h4>
            <ol>
              <li>底部「倍数」选择本局押注倍数：×1、×5、×10、×20、×50、×100。</li>
              <li>点击下方水果图标押分，每点一次该仓位增加 1 注；实际扣分 = 注数 × 倍数。</li>
              <li>可同时押多个水果；总押注须在游戏限额内。</li>
              <li>点「开始」开奖；点「自动」可按当前盘面押分连续开局，再点「停止」结束自动。</li>
              <li>「退币」可退回尚未开跑的盘面押分（当局已结算赢分不受影响）。</li>
            </ol>
          </section>

          <section class="fruit-rules-sec">
            <h4>三、中奖结算</h4>
            <p>单格中奖得分：</p>
            <p class="fruit-rules-formula">得分 = 格位赔率 × 押注倍数 × 该符号注数。</p>
            <p>
              例：押苹果 2 注、倍数 ×10，灯停在大苹果（×5），得分 = 5 × 10 × 2 = 100。              特殊奖一次命中多格时，对每个命中格分别按上式计算后累加。            </p>
          </section>

          <section class="fruit-rules-sec">
            <h4>四、押注仓位与赔率</h4>
            <p>押某一仓位后，该符号的「大格」与「小格」均可中奖，赔率以停中格子为准：</p>
            <table class="fruit-rules-table">
              <thead>
                <tr>
                  <th>仓位</th>
                  <th>大格赔率</th>
                  <th>小格赔率</th>
                </tr>
              </thead>
              <tbody>
                <tr><td>天门（BAR）</td><td>×100</td><td>×50</td></tr>
                <tr><td>77</td><td>×40</td><td>×2</td></tr>
                <tr><td>双星</td><td>×30</td><td>×2</td></tr>
                <tr><td>西瓜</td><td>×20</td><td>×2</td></tr>
                <tr><td>铃铛</td><td>×20</td><td>×2</td></tr>
                <tr><td>芒果</td><td>×15</td><td>×2</td></tr>
                <tr><td>橘子</td><td>×10</td><td>×2</td></tr>
                <tr><td>苹果</td><td>×5</td><td>×2</td></tr>
              </tbody>
            </table>
            <p>盘面另有 2 格「GOOD LUCK」好运格，不直接派彩，用于触发送灯或吃灯。</p>
          </section>

          <section class="fruit-rules-sec">
            <h4>五、奖项说明</h4>
            <ul>
              <li><b>普通中奖</b>：灯停在某一水果格。若已押该符号，按该格赔率结算；未押则本局不得分。</li>
              <li>
                <b>幸运送灯</b>：开到好运格并发放送灯。随机 1～N 个水果格为中奖格，                对每个已押中的符号分别计分后累加。              </li>
              <li><b>幸运吃灯</b>：开到好运格但触发吃灯。本局全部押注无效，不得分。</li>
              <li>
                <b>开火车</b>：从停点起连续命中若干格（跳过好运格），凡已押中的符号均计分。              </li>
              <li>
                <b>大三元</b>：一次同时中「大77、大双星、大西瓜」三个高赔格。                你押了哪个，就按哪个的赔率算分；三个都押了就三个都算，只押其中一个也只算那一个。              </li>
              <li>
                <b>小三元</b>：一次同时中「大铃铛、大芒果、大橘子」三个高赔格。                算法同上：押中哪个算哪个，可叠加。              </li>
              <li><b>大四喜</b>：命中盘面全部苹果格，凡押了苹果的按各格赔率累计得分。</li>
              <li><b>大满贯</b>：命中盘面全部非好运格，已押符号按各命中格赔率全部累计。</li>
            </ul>
          </section>

          <section class="fruit-rules-sec">
            <h4>六、猜大小</h4>
            <p>
              当局有赢分时，可用全部当局赢分猜「大」或「小」（不可改金额）。            </p>
            <ul>
              <li><b>小</b>：开出 1～6 为赢，赢分翻倍；</li>
              <li><b>大</b>：开出 8～13 为赢，赢分翻倍；</li>
              <li><b>和</b>：开出 7，赢分退回，可继续猜。</li>
              <li>猜错则当局赢分清零。</li>
            </ul>
            <p>猜中后可继续用新的当局赢分再猜，也可直接离开带走积分。自动模式下跳过猜大小，直接进入下一局。</p>
          </section>

          <section class="fruit-rules-sec">
            <h4>七、其他说明</h4>
            <ul>
              <li>顶部「总积分」为当前可用积分；「当局赢分」为上一局（或猜大小后）尚未并入总积分的赢分。</li>
              <li>开新局前，若仍有当局赢分，将自动并入总积分。</li>
              <li>点返回离开：本局已开跑时会等结算完成再退；若正在猜大小，则放弃续猜并退出。查看历史记录可返回继续猜大小。</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  FRUIT_RING,
  type FruitAwardType,
  type FruitBetSymbolId,
} from '@/games/slots'
import type { CenterStageMode } from '@/games/slots/fruitCenterAssets'
import FruitCenterStage from '@/components/FruitCenterStage.vue'
import FruitSettingsPanel from '@/components/FruitSettingsPanel.vue'
import {
  playFruitBet,
  playFruitSfx,
  initFruitMuteFromStorage,
  setFruitBgmDuck,
  startFruitBgm,
  stopFruitBgm,
  stopFruitAnnounce,
  stopFruitGo,
  disposeFruitAudio,
  unlockFruitAudio,
} from '@/games/slots/fruitAudio'
import {
  TITLE_MARQUEE_BULBS,
  betButtons,
  betLeds,
  boxStyle,
  buildControlButtons,
  cabinetAmbientUrl,
  cabinetBodyUrl,
  cellBoxes,
  fruitRingBox,
  fruitRingUrl,
  multButtons,
  titleMarqueeBulbStyle,
  totalScoreBox,
  tvScreenBox,
  winScoreBox,
  type BetId,
  type ControlId,
  type MultValue,
} from '@/games/slots/fruitLayout'
import { useFruitRingLights } from '@/games/slots/useFruitRingLights'
import { createFruitAwardFx } from '@/games/slots/fruitAwardFx'
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
const walletStore = useWalletStore()
const { toast } = useToast()
const spinSession = useGameSpinSession('fruit')
/** 服务端游戏限额（默认与 seed 一致，进页后刷新） */
const fruitMinBet = ref(1)
const fruitMaxBet = ref(100_000)

const titleMarqueeBulbs = TITLE_MARQUEE_BULBS

const lights = useFruitRingLights(FRUIT_RING.length)
const {
  cursorIndex,
  hitLit,
  trainHead,
  trainTail,
  trainBody,
  flashAll,
  ringFxClass,
  setRingCellRef,
  setCursor,
  clearTrainVisual,
  setRingFx,
  clearHitLit,
} = lights

const totalScore = ref(0)
const winScore = ref(0)
const busy = ref(false)
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
const showRules = ref(false)
const showSettings = ref(false)

const totalScoreDigits = computed(() =>
  String(Math.min(999999, Math.max(0, totalScore.value))).padStart(6, '0').split(''),
)
const winScoreDigits = computed(() =>
  String(Math.min(999999, Math.max(0, winScore.value))).padStart(6, '0').split(''),
)

/** 自动连局中（为 true 时按钮显示「停止」） */
const autoPlaying = ref(false)
let autoRunToken = 0

const controlButtons = computed(() => buildControlButtons(autoPlaying.value))

function isControlDisabled(id: ControlId) {
  if (id === 'refund') return busy.value || autoPlaying.value
  // 自动中允许点「停止」；未开自动时转盘忙则不可点
  if (id === 'auto') return busy.value && !autoPlaying.value
  return busy.value || autoPlaying.value
}

function stopAutoPlay() {
  if (!autoPlaying.value) return
  autoPlaying.value = false
  autoRunToken += 1
}

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
  if (cost < fruitMinBet.value) {
    playFruitSfx('lose', 0.45)
    toast(`总押注不能低于${fruitMinBet.value}`)
    return false
  }
  if (cost > fruitMaxBet.value) {
    playFruitSfx('lose', 0.45)
    toast(`总押注不能超过${fruitMaxBet.value}`)
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

let leavingGame = false
/** 本局开奖进行中时，卸载页不要抢先 abandon（等跑完再退）*/
let abandonOnUnmount = true

function waitWhileBusy(timeoutMs = 120_000) {
  if (!busy.value) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const t0 = Date.now()
    const id = setInterval(() => {
      if (!busy.value || Date.now() - t0 > timeoutMs) {
        clearInterval(id)
        resolve()
      }
    }, 80)
  })
}

/** 猜大小阶段离开：赢分已入账，放弃续赌资金。*/
async function abandonGambleAndLeaveUi() {
  stopAutoPlay()
  stopBetHold()
  stopTitleMarquee()
  collectPendingWin()
  stageMode.value = 'idle'
  stageAwardType.value = 'normal'
  gambleResultNum.value = null
  try {
    const res = await gamesApi.fruitAbandonGamble()
    if (typeof res.balance === 'number') walletStore.balance = res.balance
  } catch {
    /* 忽略 */
  }
  syncScoreFromWallet()
}

function isInGamblePhase() {
  return (
    winScore.value > 0 ||
    stageMode.value === 'gamble_roll' ||
    stageMode.value === 'gamble_win' ||
    stageMode.value === 'gamble_lose' ||
    stageMode.value === 'gamble_push'
  )
}

async function goBack() {
  if (leavingGame) return
  leavingGame = true
  stopAutoPlay()
  stopBetHold()

  // 猜大小阶段：立刻退出并放弃续赌（不等骰子动画）
  if (isInGamblePhase()) {
    abandonOnUnmount = false
    await abandonGambleAndLeaveUi()
    stopFruitBgm()
    router.replace('/lobby')
    return
  }

  // 开奖演出中：等本局跑完并结算后再退
  if (busy.value) {
    toast('本局结算中，完成后退出。')
    await waitWhileBusy()
  }

  abandonOnUnmount = false
  if (isInGamblePhase()) {
    // 本局结算后进入猜大小：带走已入账赢分，放弃续赌。
    await abandonGambleAndLeaveUi()
  } else {
    // 仅盘面有押、未开跑：退回本地押分。
    clearBoardBets(true)
    syncScoreFromWallet()
    stopTitleMarquee()
  }

  stopFruitBgm()
  // replace 回大厅，去掉游戏页历史，避免大厅返回再次进入游戏
  router.replace('/lobby')
}

function openSettings() {
  unlockFruitAudio()
  playFruitSfx('click', 0.45)
  showSettings.value = true
}

/** 与聊天室游戏一致：跳转竞猜记录页（返回可继续玩，勿 abandon）*/
function openBetRecords() {
  abandonOnUnmount = false
  router.push({ path: '/bets', query: { game: 'fruit-machine', from: 'game' } })
}

function fruitErrMsg(e: unknown, fallback = '操作失败') {
  const msg = e instanceof Error ? e.message : String(e || '')
  if (!msg) return fallback
  if (/余额不足|积分不足|PLAYER\//i.test(msg)) return '积分不足'
  if (/没有可再赌/.test(msg)) return '没有可再赌的当局赢分'
  if (/再赌金额须等于/.test(msg)) return msg.replace(/^.*再赌金额/, '再赌金额')
  if (/总押注须在|无效仓位|请至少押/.test(msg)) return msg
  if (/未上线|不存在|已下线/.test(msg)) return '游戏暂不可用'
  if (/网络|timeout|Failed to fetch|Network/i.test(msg)) return '网络异常，请重试'
  return msg.length > 80 ? fallback : msg
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
    if (busy.value || autoPlaying.value) return
    stopAutoPlay()
    playFruitSfx('cashout')
    // 退币：放弃猜大小资格，盘面押分退回，赢分已在开奖时入账
    collectPendingWin()
    clearBoardBets(true)
    try {
      const res = await gamesApi.fruitAbandonGamble()
      if (typeof res.balance === 'number') walletStore.balance = res.balance
    } catch {
      /* 忽略：本地已清，下次开跑服务端也会清 pending */
    }
    syncScoreFromWallet()
    clearHitLit()
    setCursor(-1)
    clearTrainVisual()
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
    // 自动模式跳过猜大小：取分入账并放弃服务端续赌资格
    if (winScore.value > 0) {
      collectPendingWin()
      stageMode.value = 'idle'
      stageAwardType.value = 'normal'
      gambleResultNum.value = null
      try {
        const res = await gamesApi.fruitAbandonGamble()
        if (typeof res.balance === 'number') walletStore.balance = res.balance
        syncScoreFromWallet()
      } catch {
        /* 下次开跑服务端也会清*/
      }
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
    toast(`总押注不能超过${fruitMaxBet.value}`)
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
    let res
    try {
      res = await gamesApi.fruitGamble(amount, choice, clientRequestId)
    } catch {
      // 幂等重试：响应丢失时用同一 clientRequestId 拉回结果
      res = await gamesApi.fruitGamble(amount, choice, clientRequestId)
    }
    spinSession.clearClientRequestId()
    walletStore.balance = res.balance
    const result = res.result as 'win' | 'lose' | 'push'
    const roll = res.roll
    const payout = typeof res.payout === 'number' ? res.payout : 0
    const pending =
      typeof res.pendingGambleAmount === 'number' ? res.pendingGambleAmount : payout

    gambleResultNum.value = roll
    if (result === 'win') {
      winScore.value = pending
      syncScoreFromWallet()
      stageMode.value = 'gamble_win'
      playFruitSfx('gambleWin')
      await sleep(2000)
      stageMode.value = pending > 0 ? 'gamble_roll' : 'idle'
    } else if (result === 'lose') {
      winScore.value = 0
      syncScoreFromWallet()
      stageMode.value = 'gamble_lose'
      playFruitSfx('gambleLose')
      await sleep(2000)
      enterGambleOrIdle()
    } else {
      winScore.value = pending
      syncScoreFromWallet()
      stageMode.value = 'gamble_push'
      playFruitSfx('click')
      await sleep(1200)
      stageMode.value = pending > 0 ? 'gamble_roll' : 'idle'
    }
  } catch (e) {
    toast(fruitErrMsg(e, '再赌失败'))
  } finally {
    busy.value = false
  }
}

const awardFx = createFruitAwardFx({
  lights,
  sleep,
  winScore,
  stageMode,
  centerHitSymbol,
  centerHitSize,
  centerHitKind,
  centerHitLabel,
  centerHitOdds,
  centerHitBetUnits,
  clearCenterHit,
  setCenterHit,
  enterAwardStage,
  startTitleMarquee,
})
const { runLightTo, revealHits } = awardFx

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
  // 开新局前：当局赢分并入总积分（不丢分）；服务端也会清 pending 猜大小。
  collectPendingWin()
  clearHitLit()
  clearTrainVisual()
  flashAll.value = false
  stageMode.value = 'idle'
  clearCenterHit()
  gambleResultNum.value = null
  playFruitSfx('start')

  const clientRequestId = spinSession.currentOrNewClientRequestId()
  type SpinRes = {
    awardType: string
    stopIndex: number
    hitIndexes: number[]
    totalWin: number
    wins?: Array<{ cellIndex: number; amount: number; symbol?: string; mult?: number }>
    balance?: number
  }
  let result: SpinRes

  try {
    try {
      result = await gamesApi.fruitSpin(payload, clientRequestId)
    } catch {
      // 响应丢失时幂等重试：服务端已结算则回放，未结算则补开
      result = await gamesApi.fruitSpin(payload, clientRequestId)
    }
    spinSession.clearClientRequestId()
    if (typeof result.balance === 'number') walletStore.balance = result.balance

    const wins = (result.wins ?? []).map((w) => ({
      cellIndex: w.cellIndex,
      amount: w.amount,
    }))

    const award = result.awardType as FruitAwardType
    // 一律先正常跑灯停格；开火车等特殊奖在停定后再揭晓报奖
    await runLightTo(result.stopIndex, 2)
    // 报奖累加前先归零，避免与上局残值叠算；最终以 totalWin 校准
    winScore.value = 0
    await revealHits(award, result.stopIndex, result.hitIndexes, wins)

    const win = result.totalWin ?? 0
    winScore.value = win
    // 押注已消耗，清盘面但不退分
    stakedScore.value = 0
    for (const k of Object.keys(betCounts.value) as BetId[]) betCounts.value[k] = 0
    syncScoreFromWallet()

    const isSpecial = result.awardType !== 'normal'
    // 特殊奖的 coin 已在 revealHits 末尾播过，这里只补普通中奖 / 未中
    if (win > 0) {
      if (!isSpecial) {
        playFruitSfx('win')
        if (win >= cost * 20) playFruitSfx('coin')
      }
    } else if (result.awardType !== 'luck_eat') {
      playFruitSfx('lose')
      setFruitBgmDuck(false)
    }

    await sleep(isSpecial ? 450 : 320)
    enterGambleOrIdle()
    await sleep(isSpecial ? 200 : 280)
  } catch (e) {
    spinSession.clearClientRequestId()
    stopFruitGo()
    setFruitBgmDuck(false)
    flashAll.value = false
    setRingFx('none')
    stageMode.value = 'idle'
    clearCenterHit()
    try {
      await walletStore.fetchBalance()
      stakedScore.value = 0
      for (const k of Object.keys(betCounts.value) as BetId[]) betCounts.value[k] = 0
      syncScoreFromWallet()
    } catch {
      clearBoardBets(true)
    }
    toast(fruitErrMsg(e, '开奖失败'))
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  initFruitMuteFromStorage()
  try {
    await walletStore.fetchBalance()
  } catch {
    /* 未登录时总分保持 0，不允许伪造余额 */
  }
  syncScoreFromWallet()
  // 从历史记录返回等：恢复仍可猜大小的当局赢分
  try {
    const pend = await gamesApi.fruitPendingGamble()
    if (typeof pend.balance === 'number') walletStore.balance = pend.balance
    const amt = Math.max(0, Number(pend.pendingGambleAmount) || 0)
    if (amt > 0) {
      winScore.value = amt
      stageMode.value = 'gamble_roll'
    }
    syncScoreFromWallet()
  } catch {
    /* 忽略：无 pending 或接口暂不可用*/
  }
  try {
    const games = await gamesApi.list()
    const cfg = games.find((g) => g.code === 'fruit-machine')
    if (cfg) {
      fruitMinBet.value = Math.max(1, Number(cfg.minBet) || 1)
      fruitMaxBet.value = Math.max(fruitMinBet.value, Number(cfg.maxBet) || 100_000)
    }
  } catch {
    /* 用默认限额 */
  }
})

watch([stageMode, flashAll, stageAwardType, busy], () => {
  syncTitleMarquee()
})

onUnmounted(() => {
  // 开奖进行中勿抢 abandon（结算后 pending 可由下次进页恢复）。
  // 主动点返回/历史时由 goBack、openBetRecords 控制 abandonOnUnmount
  if (abandonOnUnmount && !busy.value) {
    void gamesApi.fruitAbandonGamble().catch(() => {})
  }
  stopAutoPlay()
  stopBetHold()
  stopTitleMarquee()
  stopFruitAnnounce()
  stopFruitGo()
  disposeFruitAudio()
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
  background: #1a0608;
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
  /* 略提饱和，边缘再压暗一点，让柜机更沉*/
  filter: saturate(1.12) contrast(1.04);
}

.cabinet-page::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 50% 42%, transparent 28%, rgba(10, 2, 4, 0.45) 72%, rgba(6, 1, 2, 0.72) 100%);
}

.cabinet-stage {
  /* 设计 1024×1536：等比例放大，任一边贴边即停，不额外拉高/拉宽 */
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  aspect-ratio: 1024 / 1536;
  width: min(100vw, calc(100dvh * 1024 / 1536));
  height: min(100dvh, calc(100vw * 1536 / 1024));
  max-width: 100%;
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
  background: rgba(140, 250, 255, 0.65);
  box-shadow:
    inset 0 0 0 3px rgba(255, 255, 220, 1),
    0 0 26px 10px rgba(80, 230, 255, 1),
    0 0 40px 14px rgba(255, 210, 80, 0.55);
  animation: fruitTrainHeadPulse 0.22s ease-out;
  z-index: 5;
  filter: brightness(1.4);
}

/* 车厢段整体提亮，转圈时是一段灯在跑，不是单格*/
.ring-cell.train-tail,
.ring-cell.train-car {
  opacity: 1;
  background: rgba(60, 210, 255, 0.5);
  box-shadow:
    inset 0 0 0 3px rgba(140, 240, 255, 0.95),
    0 0 16px 6px rgba(50, 200, 255, 0.75);
  z-index: 3;
  filter: brightness(1.15);
}

.ring-cell.train-slam {
  opacity: 1 !important;
  background: rgba(255, 255, 230, 0.85) !important;
  box-shadow:
    inset 0 0 0 4px #fff,
    0 0 30px 14px rgba(255, 240, 120, 1),
    0 0 50px 18px rgba(80, 220, 255, 0.85) !important;
  transform: scale(1.14);
  z-index: 7;
  animation: fruitTrainSlamPop 0.32s ease-out;
}

@keyframes fruitTrainSlamPop {
  0% {
    transform: scale(1.22);
    filter: brightness(1.8);
  }
  100% {
    transform: scale(1.08);
    filter: brightness(1.2);
  }
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
    transform: scale(1.06);
    filter: brightness(1.55);
  }
  100% {
    transform: scale(1);
    filter: brightness(1.2);
  }
}

/* —— 特殊奖主题色（父级 .fx-* 作用到中奖格）—— */
.cabinet-stage.fx-eat .fruit-ring {
  filter: brightness(0.42) saturate(0.35);
  transition: filter 0.35s ease;
}
.cabinet-stage.fx-eat .ring-cell.active {
  background: rgba(180, 30, 30, 0.45);
  box-shadow:
    inset 0 0 0 3px rgba(255, 80, 80, 0.9),
    0 0 18px 6px rgba(200, 20, 20, 0.7);
}

.cabinet-stage.fx-send .ring-cell.hit {
  background: rgba(200, 80, 255, 0.4);
  box-shadow:
    inset 0 0 0 3px rgba(255, 160, 255, 0.95),
    0 0 18px 6px rgba(180, 60, 255, 0.75),
    0 0 28px 8px rgba(255, 200, 80, 0.35);
}
.cabinet-stage.fx-send .ring-cell.active {
  background: rgba(255, 120, 220, 0.35);
  box-shadow:
    inset 0 0 0 3px rgba(255, 180, 255, 0.95),
    0 0 16px 5px rgba(220, 80, 255, 0.7);
}

.cabinet-stage.fx-train .fruit-ring {
  filter: brightness(0.92) saturate(1.2) hue-rotate(-8deg);
}
/* 已中格必须压过车头样式，转圈时也持续亮着 */
.cabinet-stage.fx-train .ring-cell.hit {
  opacity: 1 !important;
  background: rgba(40, 200, 255, 0.42) !important;
  box-shadow:
    inset 0 0 0 3px rgba(140, 240, 255, 1),
    0 0 18px 7px rgba(40, 190, 255, 0.75) !important;
  z-index: 4;
}
.cabinet-stage.fx-train .ring-cell.train-car:not(.train) {
  animation: fruitTrainCarShimmer 0.45s ease-in-out infinite alternate;
}
@keyframes fruitTrainCarShimmer {
  from { filter: brightness(0.95); }
  to { filter: brightness(1.2); }
}

.cabinet-stage.fx-big3 .ring-cell.hit {
  background: rgba(255, 170, 30, 0.45);
  box-shadow:
    inset 0 0 0 3px rgba(255, 220, 80, 1),
    0 0 20px 7px rgba(255, 160, 20, 0.85),
    0 0 32px 10px rgba(255, 80, 0, 0.35);
}

.cabinet-stage.fx-small3 .ring-cell.hit {
  background: rgba(60, 220, 140, 0.4);
  box-shadow:
    inset 0 0 0 3px rgba(160, 255, 200, 0.95),
    0 0 18px 6px rgba(40, 200, 120, 0.75);
}

.cabinet-stage.fx-four .fruit-ring {
  filter: brightness(1.05) saturate(1.2);
}
.cabinet-stage.fx-four .ring-cell.hit {
  background: rgba(255, 70, 70, 0.48);
  box-shadow:
    inset 0 0 0 3px rgba(255, 200, 180, 1),
    0 0 20px 7px rgba(255, 50, 50, 0.8),
    0 0 28px 10px rgba(80, 220, 100, 0.4);
  animation: fruitFourHitPop 0.5s ease-in-out infinite alternate;
}
@keyframes fruitFourHitPop {
  from { filter: brightness(1.05); transform: scale(1); }
  to { filter: brightness(1.35); transform: scale(1.03); }
}

.cabinet-stage.fx-slam .ring-cell.hit {
  background: rgba(255, 245, 200, 0.55);
  box-shadow:
    inset 0 0 0 3px #fff6c0,
    0 0 22px 8px rgba(255, 220, 80, 0.95),
    0 0 36px 12px rgba(255, 160, 40, 0.55);
  animation: fruitSlamHitGlow 0.55s ease-in-out infinite alternate;
}
.cabinet-stage.fx-slam .fruit-ring {
  filter: brightness(1.18) saturate(1.25);
  animation: fruitSlamRingPulse 1.1s ease-in-out infinite;
}
@keyframes fruitSlamHitGlow {
  from { filter: brightness(1.05); }
  to { filter: brightness(1.45); }
}
@keyframes fruitSlamRingPulse {
  0%, 100% { filter: brightness(1.1) saturate(1.15); }
  50% { filter: brightness(1.28) saturate(1.35); }
}

.ring-cell.hit-pulse {
  opacity: 1 !important;
  filter: brightness(1.55);
  transform: scale(1.04);
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
  top: max(10px, env(safe-area-inset-top));
  right: max(8px, env(safe-area-inset-right));
  z-index: 100;
  display: flex;
  flex-direction: row;
  gap: 6px;
  align-items: flex-start;
}

.fruit-rail-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: #f2d98a;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.14s ease, filter 0.14s ease;
}

.fruit-rail-btn:active {
  transform: scale(0.9);
  filter: brightness(1.15);
}

.fruit-rail-ic {
  width: 38px;
  height: 38px;
  object-fit: contain;
  display: block;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.45));
}

.fruit-rail-lb {
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.5px;
  font-family: 'Noto Serif SC', 'Songti SC', serif;
  color: rgba(240, 220, 160, 0.9);
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
  display: flex;
  flex-direction: column;
  width: min(92vw, 380px);
  max-height: min(72vh, 520px);
  overflow: hidden;
  border-radius: 14px;
  border: 1px solid rgba(244, 211, 107, 0.4);
  background: linear-gradient(180deg, #2a1c10 0%, #140e08 100%);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  color: #f5e6c8;
}

.fruit-modal-card--rules {
  width: min(94vw, 460px);
  max-height: min(82vh, 680px);
}

.fruit-modal-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(244, 211, 107, 0.22);
  background: linear-gradient(180deg, rgba(58, 44, 22, 0.55), rgba(30, 22, 12, 0.15));
}

.fruit-modal-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: #ffe7a0;
}

.fruit-modal-close {
  width: 30px;
  height: 30px;
  border: 1px solid rgba(212, 175, 55, 0.4);
  border-radius: 50%;
  padding: 0;
  font-size: 20px;
  line-height: 1;
  color: #f2d98a;
  background: rgba(0, 0, 0, 0.35);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.fruit-modal-close:active {
  transform: scale(0.9);
  filter: brightness(1.2);
}

.fruit-rules-body {
  flex: 1;
  min-height: 0;
  padding: 10px 16px 18px;
  font-size: 13px;
  line-height: 1.65;
  color: rgba(245, 230, 200, 0.88);
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.fruit-rules-sec {
  margin: 0 0 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(244, 211, 107, 0.12);
}

.fruit-rules-sec:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.fruit-rules-sec h4 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #ffe7a0;
}

.fruit-rules-body p,
.fruit-rules-body ol,
.fruit-rules-body ul {
  margin: 0 0 8px;
}

.fruit-rules-body ol,
.fruit-rules-body ul {
  padding-left: 1.2em;
}

.fruit-rules-body li {
  margin: 0 0 6px;
}

.fruit-rules-body b {
  color: #ffe7a0;
  font-weight: 700;
}

.fruit-rules-formula {
  margin: 8px 0 !important;
  padding: 8px 12px;
  text-align: center;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #ffe7a0;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(244, 211, 107, 0.2);
  border-radius: 8px;
}

.fruit-rules-table {
  width: 100%;
  margin: 8px 0 10px;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.fruit-rules-table th,
.fruit-rules-table td {
  padding: 8px 6px;
  text-align: center;
  border-bottom: 1px solid rgba(244, 211, 107, 0.14);
}

.fruit-rules-table th {
  color: rgba(245, 224, 192, 0.55);
  font-weight: 600;
}

.fruit-rules-table td:first-child {
  text-align: left;
  color: #ffe7a0;
}

</style>
