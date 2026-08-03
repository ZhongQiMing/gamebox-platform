<template>
  <!-- 官方 BetItemL/M/S：外圈由 sparks + mid + 旋转 out 拼成 -->
  <button
    type="button"
    class="bet-cell"
    :class="[
      `size-${bet.size}`,
      {
        win: win && settlePhase !== 'off',
        down: pressed,
        dimmed,
        shine: settlePhase === 'shine',
        rising: settlePhase === 'rise',
      },
    ]"
    :style="xyStyle"
    :disabled="disabled"
    @pointerdown="pressed = true"
    @pointerup="pressed = false"
    @pointerleave="pressed = false"
    @pointercancel="pressed = false"
    @click="$emit('bet')"
  >
    <!-- 小光点 sparks（betGlowImage0..N） -->
    <img
      v-for="(sp, i) in sparks"
      :key="`sp${i}`"
      class="spark"
      :src="sparkUrl"
      alt=""
      draggable="false"
      :style="sparkStyle(sp, i)"
    />

    <!-- L/M：中环 + 外环（外环持续旋转） -->
    <template v-if="bet.size !== 'S'">
      <img
        class="glow-mid"
        :src="midUrl"
        alt=""
        draggable="false"
        :style="midStyle"
      />
      <img
        class="glow-out"
        :class="{ cw: rotateCw }"
        :src="outUrl"
        alt=""
        draggable="false"
        :style="outStyle"
      />
    </template>

    <!-- 按下 / 中奖 shine：highlightRect（官方 shineTask PING_PONG α） -->
    <div
      v-if="bet.size !== 'S'"
      class="highlight"
      :style="highlightStyle"
    />
    <img
      v-else
      class="highlight-add"
      :src="addUrl"
      alt=""
      draggable="false"
      :style="addStyle"
    />

    <img
      class="icon"
      :class="`color-${color}`"
      :src="iconUrl"
      alt=""
      draggable="false"
      :style="iconStyle"
    />
    <img
      class="odds"
      :src="oddsUrl"
      alt=""
      draggable="false"
      :style="oddsStyle"
    />
    <div v-if="amount > 0" class="amt" :style="amtStyle">
      <img :src="txtbox" alt="" draggable="false" />
      <span :style="{ fontSize: skin.amtFont + 'px' }">{{ amount }}</span>
    </div>
    <!--
      官方 FastJumpAmount：
      initPayoutTask → 显示 +金额（alpha=1）
      shineTask → highlightRect 闪
      riseUpPayoutLabelTask → bottom+100 / alpha→0.5（400ms）
    -->
    <span
      v-if="payoutLabelOn"
      class="payout-label"
      :class="[`size-${bet.size}`, { rise: settlePhase === 'rise' }]"
      >+{{ floatLabel }}</span
    >
  </button>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BCBM_PLAYTYPE_META } from '@/games/bcbm/bcbmSpinMath'
import {
  BET_SKIN,
  BET_GLOW_SPARKS,
  BET_GLOW_RING,
  BET_HIGHLIGHT,
  H5,
  type PanelBet,
} from '@/games/bcbm/mobilePanelLayout'

export type BetSettlePhase = 'off' | 'label' | 'shine' | 'rise'

const props = defineProps<{
  bet: PanelBet
  amount: number
  win?: boolean
  /** 本仓派彩（>0 时显示 +金额） */
  winAmount?: number
  /**
   * 官方 generateAllBetItemShinningTask 阶段：
   * label=initPayout / shine=shineTask / rise=riseUpPayoutLabel
   */
  settlePhase?: BetSettlePhase
  /** 官方 dimTask：未中押格 alpha=0.3 */
  dimmed?: boolean
  disabled?: boolean
  /** 官方 setBet：sqrt(bet/limit) 点亮 spark 比例 */
  betLimit?: number
}>()

defineEmits<{ bet: [] }>()

const pressed = ref(false)
const floatLabel = ref('0')

function fmtWinAmt(n: number) {
  if (!Number.isFinite(n)) return '0'
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2).replace(/\.?0+$/, '')
}

const payoutLabelOn = computed(
  () =>
    !!props.win &&
    !!(props.winAmount && props.winAmount > 0) &&
    props.settlePhase != null &&
    props.settlePhase !== 'off',
)

watch(
  () => props.winAmount,
  (amt) => {
    if (amt && amt > 0) floatLabel.value = fmtWinAmt(amt)
  },
  { immediate: true },
)

const skin = computed(() => BET_SKIN[props.bet.size])
const meta = computed(() => BCBM_PLAYTYPE_META[props.bet.playType])
const color = computed(() => meta.value.color)
const sparks = computed(() => BET_GLOW_SPARKS[props.bet.size])
const ring = computed(() => BET_GLOW_RING[props.bet.size])
/** playType≥9（奔驰）外环正转，其余反转 */
const rotateCw = computed(() => props.bet.playType >= 9)

const xyStyle = computed(() => ({
  left: `${props.bet.x}px`,
  top: `${props.bet.y}px`,
  width: `${props.bet.w}px`,
  height: `${props.bet.h}px`,
}))

const sparkUrl = computed(() => {
  const kind = props.bet.size === 'S' ? 'minibet' : 'largebet'
  return `/images/games/bcbm/benz/bet/yben_vfx_glow_${kind}_${color.value}.png`
})
const midUrl = computed(
  () =>
    `/images/games/bcbm/benz/bet/yben_vfx_bet_glow_mid_line_${color.value}.png`,
)
const outUrl = computed(
  () =>
    `/images/games/bcbm/benz/bet/yben_vfx_bet_glow_out_line_${color.value}.png`,
)
const addUrl = computed(
  () => `/images/games/bcbm/benz/bet/yben_vfx_add_${color.value}.png`,
)
const iconUrl = computed(
  () =>
    `/images/games/bcbm/benz/bet/yben_icon_bet_${meta.value.brand}_${color.value}.png`,
)
const oddsUrl = computed(
  () => `/images/games/bcbm/benz/bet/yben_txt_x${meta.value.mult}.png`,
)
const txtbox = H5.txtbox

/** 无下注 spark/mid α=0.3；有下注按额度点亮 */
const litCount = computed(() => {
  const n = sparks.value.length
  if (props.amount <= 0) return 0
  const limit = props.betLimit && props.betLimit > 0 ? props.betLimit : 1000
  const ratio = Math.min(1, Math.sqrt(props.amount / limit))
  return Math.ceil(n * ratio)
})

function sparkStyle(sp: { x: number; y: number; rot: number }, i: number) {
  const on = props.amount > 0 && i < litCount.value
  return {
    left: `${sp.x}px`,
    top: `${sp.y}px`,
    transform: `rotate(${sp.rot}deg)`,
    opacity: on || props.win ? 1 : 0.3,
  }
}

const midStyle = computed(() => {
  const r = ring.value
  if (!r) return {}
  return {
    left: `${r.mid.x}px`,
    top: `${r.mid.y}px`,
    opacity: props.amount > 0 || props.win ? 1 : 0.3,
  }
})

const outStyle = computed(() => {
  const r = ring.value
  if (!r) return {}
  return {
    left: `${r.out.x - r.out.ax}px`,
    top: `${r.out.y - r.out.ay}px`,
  }
})

const iconStyle = computed(() => ({
  left: `${skin.value.icon.x}px`,
  top: `${skin.value.icon.y}px`,
}))
const oddsStyle = computed(() => ({
  top: `${skin.value.odds.y}px`,
}))
const amtStyle = computed(() => {
  const s = skin.value.amtBg
  const w = s.w * s.scale
  const h = s.h * s.scale
  return {
    top: `${s.y}px`,
    left: '50%',
    width: `${w}px`,
    height: `${h}px`,
    marginLeft: `${-w / 2}px`,
  }
})

/** 官方 playType%3 → fillColor：黄 0x687203 / 绿 0x157C09 / 红 0x9E0707 */
const HIGHLIGHT_COLOR: Record<string, string> = {
  yellow: 'rgba(104,114,3,0.5)',
  green: 'rgba(21,124,9,0.5)',
  red: 'rgba(158,7,7,0.5)',
}

const highlightStyle = computed(() => {
  if (props.bet.size === 'S') return {}
  const h = BET_HIGHLIGHT[props.bet.size]
  return {
    left: `${h.x}px`,
    top: `${h.y}px`,
    width: `${h.w}px`,
    height: `${h.h}px`,
    background: HIGHLIGHT_COLOR[color.value] ?? h.color,
  }
})
const addStyle = computed(() => {
  const h = BET_HIGHLIGHT.S
  return {
    left: `${h.x}px`,
    top: `${h.y}px`,
    width: `${60 * h.scale}px`,
    height: `${52 * h.scale}px`,
    opacity: pressed.value ? 0.5 : 0,
  }
})
</script>

<style scoped>
.bet-cell {
  position: absolute;
  z-index: 3;
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
  line-height: 0;
  font-size: 0;
  overflow: visible;
  transition: opacity 0.12s linear;
}
/* 官方 dimTask：未中押格 alpha=0.3 */
.bet-cell.dimmed {
  opacity: 0.3;
}
.spark {
  position: absolute;
  z-index: 1;
  width: auto;
  height: auto;
  transform-origin: 0 0;
  pointer-events: none;
  mix-blend-mode: screen;
}
.glow-mid {
  position: absolute;
  z-index: 1;
  width: auto;
  height: auto;
  pointer-events: none;
  mix-blend-mode: screen;
}
.glow-out {
  position: absolute;
  z-index: 1;
  width: auto;
  height: auto;
  pointer-events: none;
  mix-blend-mode: screen;
  transform-origin: center center;
  animation: outSpinCcwt 10s linear infinite;
}
.glow-out.cw {
  animation-name: outSpinCwt;
}
.bet-cell:disabled .glow-out {
  /* 官方 transformPanel(false) → pauseAnimation */
  animation-play-state: paused;
}
@keyframes outSpinCcwt {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(-360deg);
  }
}
@keyframes outSpinCwt {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.highlight {
  position: absolute;
  z-index: 1;
  border-radius: 50%;
  pointer-events: none;
  mix-blend-mode: plus-lighter;
  opacity: 0;
}
.bet-cell.down .highlight {
  opacity: 0.5;
}
/* 官方 shineTask：highlightRect α→1，200ms × 4 PING_PONG */
.bet-cell.shine .highlight {
  animation: bcbmBetShine 0.2s linear 4 alternate;
}
.bet-cell.shine .highlight-add {
  animation: bcbmBetShine 0.2s linear 4 alternate;
}
@keyframes bcbmBetShine {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.highlight-add {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  mix-blend-mode: plus-lighter;
  object-fit: fill;
}
.icon {
  position: absolute;
  z-index: 2;
  width: auto;
  height: auto;
  max-width: none;
  pointer-events: none;
}
.icon.color-red {
  --glow: #ff2438;
}
.icon.color-green {
  --glow: #28ff4e;
}
.icon.color-yellow {
  --glow: #ffe03c;
}
/* 官方 payoutLabel：init 时贴在押格上，rise 时上移 100 + alpha→0.5 */
.payout-label {
  position: absolute;
  left: 50%;
  bottom: 18%;
  z-index: 6;
  transform: translateX(-50%);
  color: #fff;
  font-weight: 700;
  font-family: 'DIN Alternate', 'Helvetica Neue', Arial, sans-serif;
  letter-spacing: 0.02em;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.85),
    0 0 4px rgba(0, 0, 0, 0.55);
  pointer-events: none;
  white-space: nowrap;
  opacity: 1;
  transition:
    bottom 0.4s linear,
    opacity 0.4s linear,
    transform 0.4s linear;
}
.payout-label.size-L {
  font-size: 30px;
}
.payout-label.size-M {
  font-size: 26px;
}
.payout-label.size-S {
  font-size: 22px;
  bottom: 14%;
}
.payout-label.rise {
  bottom: calc(18% + 100px);
  opacity: 0.5;
  transform: translateX(-50%);
}
.payout-label.size-S.rise {
  bottom: calc(14% + 100px);
}
.odds {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  width: auto;
  height: auto;
  pointer-events: none;
}
.amt {
  position: absolute;
  z-index: 2;
  pointer-events: none;
}
.amt img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: fill;
  mix-blend-mode: plus-lighter;
}
.amt span {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 700;
  line-height: 1;
}
</style>
