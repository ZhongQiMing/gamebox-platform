<template>
  <div class="fcs" :class="[`mode-${mode}`, `skin-${skin}`]" aria-live="polite">
    <!--
      整块就是底图大金框内侧的电视屏。
      不另画金边；外圈金框用机柜底图，本组件只负责「屏内」播放。
    -->
    <div class="fcs-screen">
      <!-- 分镜动画底板（舞台场景）；数字/水果/文案由上面 HTML 叠加 -->
      <div
        v-if="sheetReady"
        class="fcs-sheet"
        :style="sheetStyle"
        aria-hidden="true"
      />

      <!-- 常驻：底图(金框+纯色橙) / 独立旋转放射线 / 独立数字黑框 / 叠字（大奖也在此算账） -->
      <div v-if="mode === 'idle' || mode === 'award'" class="fcs-panel fcs-idle">
        <div class="fcs-idle-board">
          <!-- 独立放射线层：可单独旋转 -->
          <div class="fcs-idle-rays" aria-hidden="true">
            <img
              class="fcs-idle-rays-img"
              src="/images/games/slots/center/idle-rays.webp"
              alt=""
              draggable="false"
            />
          </div>

          <!-- 固定四行槽位：1图标算式 2赢分 3倍数 4总额；无中奖时前两行空着，倍数/总额位置不变 -->
          <div class="fcs-idle-layout" :style="idleLayoutBoxStyle">
            <div class="fcs-idle-row fcs-idle-row--top">
              <template v-if="idleHitStyle">
                <div
                  class="fcs-idle-hit"
                  role="img"
                  :aria-label="hitLabel || '中奖'"
                  :style="idleHitStyle"
                />
                <div v-if="idleFormulaParts" class="fcs-idle-formula">
                  = {{ idleFormulaParts.a }} x {{ idleFormulaParts.b }} x {{ idleFormulaParts.c }}
                </div>
              </template>
            </div>

            <div class="fcs-idle-row fcs-idle-row--win">
              <template v-if="winAmount > 0">
                <span class="fcs-idle-win-label">赢</span>
                <span class="fcs-idle-win-num">{{ winAmount }}</span>
              </template>
            </div>

            <div class="fcs-idle-row fcs-idle-row--meter">
              <span class="fcs-idle-meter-label">倍数</span>
              <div class="fcs-idle-led" aria-label="倍数">
                <span class="fcs-idle-led-num">{{ mult }}</span>
              </div>
            </div>

            <div class="fcs-idle-row fcs-idle-row--meter">
              <span class="fcs-idle-meter-label">总额</span>
              <div class="fcs-idle-led" aria-label="总额">
                <span class="fcs-idle-led-num">{{ totalStake }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 猜大小：常驻底图 + 金圈滚数字；猜中/猜错加大结果反馈 -->
      <div
        v-else-if="mode === 'gamble_roll' || mode === 'gamble_win' || mode === 'gamble_lose' || mode === 'gamble_push'"
        class="fcs-panel fcs-gamble"
        :class="{
          rolling: mode === 'gamble_roll',
          locked: mode !== 'gamble_roll',
          [mode]: mode !== 'gamble_roll',
        }"
      >
        <div class="fcs-gamble-ring" aria-hidden="true">
          <span
            v-for="i in 16"
            :key="i"
            class="fcs-gamble-bulb"
            :style="{ '--i': i - 1 }"
          />
        </div>
        <div class="fcs-reel" aria-live="polite">
          <div ref="reelWindowEl" class="fcs-reel-window">
            <div class="fcs-reel-strip" :style="reelStripStyle">
              <span
                v-for="(n, i) in reelStrip"
                :key="i"
                class="fcs-reel-cell"
                :style="{
                  height: `${reelCellPx}px`,
                  fontSize: `${Math.max(26, Math.round(reelCellPx * 0.78))}px`,
                }"
              >{{ n }}</span>
            </div>
          </div>
        </div>
        <!-- 结果条：一眼看出中/没中 -->
        <div v-if="mode === 'gamble_win'" class="fcs-gamble-banner win" role="status">
          猜中 · 赢翻倍
        </div>
        <div v-else-if="mode === 'gamble_lose'" class="fcs-gamble-banner lose" role="status">
          未中 · 本局结束
        </div>
        <div v-else-if="mode === 'gamble_push'" class="fcs-gamble-banner push" role="status">
          和局 · 再来
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { FruitAwardType, FruitBetSymbolId } from '@gamebox/shared'
import {
  CENTER_SHEETS,
  CENTER_SYMBOL_SHEETS,
  centerSheetKeyForMode,
  centerSymbolSheetKey,
  IDLE_LAYOUT_PCT,
  IDLE_ORANGE_BOX,
  IDLE_RING_ICON_BOX,
  ringIconSpriteStyle,
  type CenterSheetSpec,
  type CenterStageMode,
} from '@/games/slots/fruitCenterAssets'

const props = withDefaults(
  defineProps<{
    mode: CenterStageMode
    mult: number
    totalStake: number
    winAmount: number
    gambleResult?: number | null
    awardType?: FruitAwardType | 'bar' | 'normal' | string
    hitSymbol?: FruitBetSymbolId | 'luck' | null
    hitSize?: 'big' | 'small' | 'luck'
    hitKind?: string | null
    hitLabel?: string
    /** 中奖格赔率（算式第一项，如 5） */
    hitOdds?: number
    /** 该符号押注注数（算式第三项，如 2） */
    hitBetUnits?: number
  }>(),
  {
    gambleResult: null,
    awardType: 'normal',
    hitSymbol: null,
    hitSize: 'big',
    hitKind: null,
    hitLabel: '',
    hitOdds: 0,
    hitBetUnits: 0,
  },
)

const sheetReady = ref(false)
const frameIndex = ref(0)
const activeSheet = ref<CenterSheetSpec | null>(null)
const symbolSheetReady = ref(false)
const symbolFrameIndex = ref(0)
const activeSymbolSheet = ref<CenterSheetSpec | null>(null)

let sheetTimer: ReturnType<typeof setInterval> | null = null
let symbolSheetTimer: ReturnType<typeof setInterval> | null = null
const sheetCache = new Map<string, boolean>()

const skin = computed(() => {
  if (props.mode !== 'award') return 'none'
  const t = props.awardType || 'normal'
  if (t === 'bar' || props.hitSymbol === 'bar') return 'bar'
  if (t === 'train' || t === 'big3' || t === 'small3' || t === 'four' || t === 'slam') return t
  if (t === 'luck_send' || t === 'luck_eat') return 'luck'
  return 'normal'
})

/** 常驻顶行：fruit-ring-icons-clean 整格裁切 */
const idleHitStyle = computed(() => {
  const sym = props.hitSymbol
  if (sym && sym in IDLE_RING_ICON_BOX) {
    return ringIconSpriteStyle(IDLE_RING_ICON_BOX[sym as keyof typeof IDLE_RING_ICON_BOX])
  }
  if (props.hitKind === 'luck' || sym === 'luck') {
    return ringIconSpriteStyle(IDLE_RING_ICON_BOX.luck)
  }
  return null
})

/** 顶行算式三项（有图标即显示，列宽按最大 100/100/99 预留） */
const idleFormulaParts = computed(() => {
  if (!idleHitStyle.value) return null
  return {
    a: Math.max(0, Math.floor(props.hitOdds || 0)),
    b: Math.max(0, Math.floor(props.mult || 0)),
    c: Math.max(0, Math.floor(props.hitBetUnits || 0)),
  }
})

/** 橙色安全区定位（与 IDLE_ORANGE_BOX / LED 比例一致） */
const idleLayoutBoxStyle = computed(() => ({
  left: `${IDLE_ORANGE_BOX.leftPct}%`,
  right: `${IDLE_ORANGE_BOX.rightPct}%`,
  top: `${IDLE_ORANGE_BOX.topPct}%`,
  bottom: `${IDLE_ORANGE_BOX.bottomPct}%`,
  '--idle-pad-y': `${IDLE_LAYOUT_PCT.padding.y}%`,
  '--idle-pad-x': `${IDLE_LAYOUT_PCT.padding.x}%`,
  '--idle-pad-b': `${IDLE_LAYOUT_PCT.padding.bottom}%`,
  '--idle-led-w': `${IDLE_LAYOUT_PCT.ledMaxWidthPct}%`,
  '--idle-led-ar': String(IDLE_LAYOUT_PCT.ledAspect),
}))

const sheetStyle = computed(() => {
  const spec = activeSheet.value
  if (!spec || !sheetReady.value) return {}
  const total = spec.cols * spec.rows
  const idx = Math.min(frameIndex.value, total - 1)
  const col = idx % spec.cols
  const row = Math.floor(idx / spec.cols)
  return {
    backgroundImage: `url(${spec.url})`,
    backgroundSize: `${spec.cols * 100}% ${spec.rows * 100}%`,
    backgroundPosition: `${(col / Math.max(1, spec.cols - 1)) * 100}% ${(row / Math.max(1, spec.rows - 1)) * 100}%`,
  }
})

function probeSheet(url: string): Promise<boolean> {
  if (sheetCache.has(url)) return Promise.resolve(sheetCache.get(url)!)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      sheetCache.set(url, true)
      resolve(true)
    }
    img.onerror = () => {
      sheetCache.set(url, false)
      resolve(false)
    }
    img.src = url
  })
}

function stopSheet() {
  if (sheetTimer) {
    clearInterval(sheetTimer)
    sheetTimer = null
  }
  sheetReady.value = false
  activeSheet.value = null
  frameIndex.value = 0
}

function stopSymbolSheet() {
  if (symbolSheetTimer) {
    clearInterval(symbolSheetTimer)
    symbolSheetTimer = null
  }
  symbolSheetReady.value = false
  activeSymbolSheet.value = null
  symbolFrameIndex.value = 0
}

async function startSheetForCurrentMode() {
  const key = centerSheetKeyForMode(props.mode, String(props.awardType || ''))
  if (!key) {
    stopSheet()
    return
  }
  const spec = CENTER_SHEETS[key]
  if (!spec) {
    stopSheet()
    return
  }

  // 同一张分镜已在播：只保证计时器在跑，不卸底图
  if (sheetReady.value && activeSheet.value?.url === spec.url) {
    if (!sheetTimer) {
      const total = spec.cols * spec.rows
      sheetTimer = setInterval(() => {
        if (!activeSheet.value) return
        const next = frameIndex.value + 1
        if (next >= total) {
          if (spec.loop) frameIndex.value = 0
          else {
            frameIndex.value = total - 1
            if (sheetTimer) {
              clearInterval(sheetTimer)
              sheetTimer = null
            }
          }
        } else {
          frameIndex.value = next
        }
      }, Math.max(30, Math.round(1000 / spec.fps)))
    }
    return
  }

  const ok = await probeSheet(spec.url)
  if (!ok) {
    stopSheet()
    return
  }
  if (centerSheetKeyForMode(props.mode, String(props.awardType || '')) !== key) return

  // 新分镜就绪后再替换，避免中间卸掉彩色底图露出黑底
  if (sheetTimer) {
    clearInterval(sheetTimer)
    sheetTimer = null
  }
  activeSheet.value = spec
  sheetReady.value = true
  frameIndex.value = 0
  const total = spec.cols * spec.rows
  sheetTimer = setInterval(() => {
    if (!activeSheet.value) return
    const next = frameIndex.value + 1
    if (next >= total) {
      if (spec.loop) frameIndex.value = 0
      else {
        frameIndex.value = total - 1
        if (sheetTimer) {
          clearInterval(sheetTimer)
          sheetTimer = null
        }
      }
    } else {
      frameIndex.value = next
    }
  }, Math.max(30, Math.round(1000 / spec.fps)))
}

async function startSymbolSheet() {
  stopSymbolSheet()
  if (props.mode !== 'award') return
  const key = centerSymbolSheetKey(props.hitSymbol)
  if (!key) return
  const spec = CENTER_SYMBOL_SHEETS[key]
  if (!spec) return
  const ok = await probeSheet(spec.url)
  if (!ok) return
  if (props.mode !== 'award' || centerSymbolSheetKey(props.hitSymbol) !== key) return

  activeSymbolSheet.value = spec
  symbolSheetReady.value = true
  symbolFrameIndex.value = 0
  const total = spec.cols * spec.rows
  symbolSheetTimer = setInterval(() => {
    if (!activeSymbolSheet.value) return
    const next = symbolFrameIndex.value + 1
    if (next >= total) {
      if (spec.loop) symbolFrameIndex.value = 0
      else {
        symbolFrameIndex.value = total - 1
        if (symbolSheetTimer) {
          clearInterval(symbolSheetTimer)
          symbolSheetTimer = null
        }
      }
    } else {
      symbolFrameIndex.value = next
    }
  }, Math.max(30, Math.round(1000 / spec.fps)))
}

const REEL_MAX = 13
const REEL_LOOPS = 6
/** 滚轮数字条：1..13 重复多圈，便于无缝滚动 */
const reelStrip = Array.from({ length: REEL_MAX * REEL_LOOPS }, (_, i) => (i % REEL_MAX) + 1)

const rollDisplay = ref(1)
const reelOffset = ref(REEL_MAX * 2)
const reelCellPx = ref(48)
const reelWindowEl = ref<HTMLElement | null>(null)
let rollRaf = 0
let lockRaf = 0
let rollLastTs = 0
const ROLL_CELLS_PER_SEC = 14

const reelStripStyle = computed(() => ({
  transform: `translate3d(0, ${-reelOffset.value * reelCellPx.value}px, 0)`,
}))

function measureReelCell() {
  const el = reelWindowEl.value
  if (!el) return
  const raw = el.getBoundingClientRect().height
  if (raw >= 20 && raw <= 160) {
    reelCellPx.value = Math.round(raw)
    return
  }
  const stage = el.closest('.fcs-screen') as HTMLElement | null
  const sw = stage?.clientWidth ?? 200
  reelCellPx.value = Math.max(32, Math.min(80, Math.round(sw * 0.22)))
}

function stopRoll() {
  if (rollRaf) {
    cancelAnimationFrame(rollRaf)
    rollRaf = 0
  }
  if (lockRaf) {
    cancelAnimationFrame(lockRaf)
    lockRaf = 0
  }
  rollLastTs = 0
}

function startRoll() {
  stopRoll()
  measureReelCell()
  const mod = reelOffset.value % REEL_MAX
  reelOffset.value = REEL_MAX * 2 + mod
  rollLastTs = 0
  const tick = (now: number) => {
    if (!rollLastTs) rollLastTs = now
    const dt = Math.min(0.05, (now - rollLastTs) / 1000)
    rollLastTs = now
    reelOffset.value += ROLL_CELLS_PER_SEC * dt
    if (reelOffset.value > REEL_MAX * (REEL_LOOPS - 2)) {
      reelOffset.value -= REEL_MAX
    }
    const idx = Math.round(reelOffset.value) % REEL_MAX
    rollDisplay.value = idx + 1
    rollRaf = requestAnimationFrame(tick)
  }
  rollRaf = requestAnimationFrame(tick)
}

function snapReelTo(result: number) {
  stopRoll()
  measureReelCell()
  const targetNum = Math.max(1, Math.min(REEL_MAX, Math.floor(result)))
  // 停在最近的同点数格，视觉上就是当前条直接定格
  const cur = reelOffset.value
  const base = Math.floor(cur / REEL_MAX) * REEL_MAX
  let target = base + (targetNum - 1)
  // 若目标格已滚过，落到下一圈同点数，避免回跳
  if (target + 0.01 < cur) target += REEL_MAX
  reelOffset.value = target
  rollDisplay.value = targetNum
}

watch(
  () => [props.mode, props.awardType] as const,
  async ([m]) => {
    void startSheetForCurrentMode()
    void startSymbolSheet()
    await nextTick()
    measureReelCell()
    if (m === 'gamble_roll') {
      startRoll()
    } else if (m === 'gamble_win' || m === 'gamble_lose' || m === 'gamble_push') {
      snapReelTo(props.gambleResult ?? rollDisplay.value)
    } else {
      stopRoll()
    }
    if (m !== 'award') stopSymbolSheet()
  },
  { immediate: true },
)

watch(
  () => props.gambleResult,
  (n) => {
    if (n == null) return
    if (
      props.mode === 'gamble_win' ||
      props.mode === 'gamble_lose' ||
      props.mode === 'gamble_push'
    ) {
      snapReelTo(n)
    }
  },
)

watch(
  () => [props.hitSymbol, props.hitKind, props.hitLabel] as const,
  () => {
    void startSymbolSheet()
  },
)

onMounted(() => {
  measureReelCell()
  if (props.mode === 'gamble_roll') startRoll()
  else if (
    props.mode === 'gamble_win' ||
    props.mode === 'gamble_lose' ||
    props.mode === 'gamble_push'
  ) {
    snapReelTo(props.gambleResult ?? 7)
  }
})

onUnmounted(() => {
  stopRoll()
  stopSheet()
  stopSymbolSheet()
})
</script>

<style scoped>
/* 外层对齐底图大金框内侧；不画额外金边 */
.fcs {
  position: absolute;
  overflow: hidden;
  pointer-events: none;
  box-sizing: border-box;
  background: transparent;
}

/*
 * 电视画面填满金框内侧。
 * 不铺黑底：保留分镜彩色底图；特效盖不满时仍能看见舞台底色，而不是黑洞。
 * 回退色取自 idle 分镜深蓝底，仅在分镜尚未就绪时短暂露出。
 */
.fcs-screen {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #101928;
}

.fcs-sheet {
  position: absolute;
  inset: 0;
  z-index: 0;
  background-repeat: no-repeat;
  opacity: 1;
  pointer-events: none;
}

.fcs-panel {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8% 6% 10%;
  box-sizing: border-box;
  text-align: center;
}

.fcs-idle {
  padding: 0;
  position: relative;
  justify-content: stretch;
  align-items: stretch;
}

/* 透明叠层：金框跑马灯+橙色放射板由 idle 分镜提供 */
.fcs-idle-board {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  background: transparent;
  pointer-events: none;
}

/* 独立放射线：严格裁在橙色纯色内（不盖黑边/金框）；中心偏右下 */
.fcs-idle-rays {
  position: absolute;
  /* 与 IDLE_ORANGE_BOX / 叠字安全区一致 */
  left: 16%;
  right: 16%;
  top: 10.5%;
  bottom: 11%;
  z-index: 0;
  overflow: hidden;
  border-radius: 12px;
  pointer-events: none;
}

.fcs-idle-rays-img {
  position: absolute;
  /* 锚点再往右下偏一点；放大保证旋转时仍填满橙色裁切区 */
  left: 66%;
  top: 58%;
  width: 220%;
  max-width: none;
  transform: translate(-50%, -50%);
  animation: fcsRaysSpin 22s linear infinite;
  opacity: 0.5;
  mix-blend-mode: soft-light;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  will-change: transform;
}

@keyframes fcsRaysSpin {
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

/*
  橙色安全区：对齐参考图四行比例
  1 图标+算式 / 2 赢分 / 3 倍数 / 4 总额
  黑框保持原素材比例，不做瘦扁拉伸
*/
.fcs-idle-layout {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  padding: var(--idle-pad-y, 3.5%) var(--idle-pad-x, 4.5%) var(--idle-pad-b, 4%);
  display: grid;
  /* 始终四行固定槽位；无中奖时 1/2 行空着，3/4 倍数总额位置不变 */
  grid-template-rows: minmax(0, 15fr) minmax(0, 28fr) minmax(0, 24fr) minmax(0, 24fr);
  align-items: center;
  justify-items: stretch;
  overflow: hidden;
  pointer-events: none;
  container-type: size;
  font-size: clamp(11px, 3.4cqh, 16px);
}

.fcs-idle-row {
  position: relative;
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  width: 100%;
}

.fcs-idle-row--top {
  grid-row: 1;
}

.fcs-idle-row--win {
  grid-row: 2;
}

.fcs-idle-row--meter:nth-child(3) {
  grid-row: 3;
}

.fcs-idle-row--meter:nth-child(4) {
  grid-row: 4;
}

/* 1 顶行：图标 + 算式，整组居中 */
.fcs-idle-row--top {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35em;
}

.fcs-idle-hit {
  flex: 0 0 auto;
  width: clamp(22px, 12cqh, 36px);
  height: clamp(22px, 12cqh, 36px);
  aspect-ratio: 1;
  background-repeat: no-repeat;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.3));
}

.fcs-idle-formula {
  flex: 0 0 auto;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 1.05em;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #2c1806;
  text-shadow: 0 1px 0 rgba(255, 236, 180, 0.55);
  white-space: nowrap;
  line-height: 1.1;
  letter-spacing: 0.01em;
}

/* 2 赢分：视觉主标题 */
.fcs-idle-row--win {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.08em;
  font-family: 'Microsoft YaHei', 'PingFang SC', Impact, sans-serif;
  font-weight: 900;
  line-height: 0.95;
  white-space: nowrap;
}

.fcs-idle-win-label,
.fcs-idle-win-num {
  color: #ffe14a;
  -webkit-text-stroke: 0.04em rgba(90, 45, 0, 0.55);
  paint-order: stroke fill;
  text-shadow:
    0 1px 0 #fff6c8,
    0 2px 0 rgba(120, 55, 0, 0.55),
    0 0 8px rgba(255, 190, 40, 0.45);
}

.fcs-idle-win-label {
  font-size: 1.75em;
}

.fcs-idle-win-num {
  max-width: 72%;
  font-size: 1.6em;
  font-family: Impact, 'Arial Black', 'Microsoft YaHei', sans-serif;
  overflow: hidden;
  text-overflow: clip;
}

/* 3+4 倍数 / 总额：左标签 + 右 LED（素材比例） */
.fcs-idle-row--meter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45em;
  padding: 0 1%;
}

.fcs-idle-meter-label {
  flex: 0 0 auto;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 1.05em;
  font-weight: 800;
  color: #2c1806;
  text-shadow: 0 1px 0 rgba(255, 236, 180, 0.55);
  white-space: nowrap;
  line-height: 1;
}

.fcs-idle-led {
  flex: 0 0 auto;
  width: var(--idle-led-w, 72%);
  aspect-ratio: var(--idle-led-ar, 4.102564);
  max-height: none;
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  container-type: size;
  /* 原来指向 idle-led-box.png，素材从未入库，线上是个没有边框的裸数字。
     数码管黑框用 CSS 画，几何仍由上面的 aspect-ratio 决定，不依赖外部图。 */
  border: 1px solid rgba(120, 96, 40, 0.75);
  border-radius: 3px;
  background: #0a0704;
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.9),
    inset 0 0 0 1px rgba(0, 0, 0, 0.6);
}

.fcs-idle-led-num {
  position: relative;
  z-index: 1;
  max-width: 86%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Courier New', Consolas, monospace;
  font-weight: 800;
  font-size: clamp(12px, 48cqh, 28px);
  letter-spacing: 0.04em;
  line-height: 1;
  color: #ff2424;
  text-shadow:
    0 0 4px rgba(255, 30, 30, 0.95),
    0 0 8px rgba(255, 0, 0, 0.45);
}

.fcs-gamble {
  position: relative;
  justify-content: center;
  align-items: center;
  padding: 0;
  flex-direction: column;
  container-type: size;
}

/* 橙色底上的金圈（HTML 画，不另做分镜） */
.fcs-gamble-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 0;
  width: min(58%, 160px);
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  box-sizing: border-box;
  container-type: size;
  border: 5px solid #e8b84a;
  box-shadow:
    0 0 0 3px #8a5a18,
    0 0 0 6px #f0d078,
    inset 0 0 0 3px rgba(40, 20, 0, 0.55),
    inset 0 0 18px rgba(0, 0, 0, 0.65),
    0 0 16px rgba(255, 200, 60, 0.35);
  background: radial-gradient(circle at 50% 45%, #1a1520 0%, #0a080c 72%);
  pointer-events: none;
}

.fcs-gamble-bulb {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 7cqmin;
  height: 7cqmin;
  min-width: 5px;
  min-height: 5px;
  margin: 0;
  border-radius: 50%;
  background: #ffd864;
  box-shadow: 0 0 5px rgba(255, 210, 80, 0.9);
  transform: translate(-50%, -50%) rotate(calc(var(--i) * 22.5deg)) translateY(-46cqmin);
}

.fcs-gamble.rolling .fcs-gamble-bulb {
  animation: fcsGambleBulb 0.9s linear infinite;
  animation-delay: calc(var(--i) * -0.056s);
}

@keyframes fcsGambleBulb {
  0%,
  100% {
    opacity: 0.35;
    background: #b8862a;
  }
  40%,
  55% {
    opacity: 1;
    background: #ffe57a;
  }
}

.fcs-gamble.gamble_win .fcs-gamble-ring {
  border-color: #ffe566;
  animation: fcsGambleWinPulse 0.55s ease-out 2;
  box-shadow:
    0 0 0 3px #6a9a20,
    0 0 0 7px #ffe08a,
    inset 0 0 0 3px rgba(40, 20, 0, 0.35),
    0 0 28px rgba(120, 255, 80, 0.55),
    0 0 40px rgba(255, 210, 60, 0.7);
}

.fcs-gamble.gamble_win .fcs-gamble-bulb {
  background: #b8ff60;
  box-shadow: 0 0 8px rgba(140, 255, 80, 0.95);
  animation: none;
  opacity: 1;
}

.fcs-gamble.gamble_lose .fcs-gamble-ring {
  border-color: #c04040;
  animation: fcsGambleLoseShake 0.45s ease-out;
  filter: brightness(0.85);
  box-shadow:
    0 0 0 3px #5a1010,
    0 0 0 6px #e06060,
    inset 0 0 22px rgba(120, 0, 0, 0.45),
    0 0 22px rgba(255, 40, 40, 0.45);
}

.fcs-gamble.gamble_lose .fcs-gamble-bulb {
  background: #ff6060;
  box-shadow: 0 0 6px rgba(255, 60, 60, 0.9);
  animation: none;
  opacity: 0.85;
}

.fcs-gamble.gamble_push .fcs-gamble-ring {
  border-color: #80c8ff;
  box-shadow:
    0 0 0 3px #285878,
    0 0 0 6px #a0d8ff,
    0 0 20px rgba(80, 180, 255, 0.5);
}

.fcs-gamble-banner {
  position: absolute;
  left: 50%;
  bottom: 14%;
  z-index: 3;
  transform: translateX(-50%);
  padding: 0.35em 0.85em;
  border-radius: 999px;
  font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: clamp(13px, 4.2cqw, 18px);
  font-weight: 900;
  letter-spacing: 0.06em;
  white-space: nowrap;
  pointer-events: none;
  animation: fcsGambleBannerIn 0.35s ease-out;
}

.fcs-gamble-banner.win {
  color: #1a3a08;
  background: linear-gradient(180deg, #f8ffc0 0%, #b8f060 45%, #6ec020 100%);
  box-shadow:
    0 0 0 2px rgba(255, 255, 200, 0.85),
    0 4px 14px rgba(40, 120, 0, 0.45),
    0 0 18px rgba(160, 255, 60, 0.55);
}

.fcs-gamble-banner.lose {
  color: #fff0f0;
  background: linear-gradient(180deg, #ff9090 0%, #e02828 50%, #8a1010 100%);
  box-shadow:
    0 0 0 2px rgba(255, 180, 180, 0.5),
    0 4px 14px rgba(80, 0, 0, 0.5),
    0 0 16px rgba(255, 40, 40, 0.45);
}

.fcs-gamble-banner.push {
  color: #063048;
  background: linear-gradient(180deg, #e8f8ff 0%, #80d0ff 50%, #3088c8 100%);
  box-shadow:
    0 0 0 2px rgba(220, 245, 255, 0.8),
    0 4px 12px rgba(20, 80, 140, 0.4);
}

@keyframes fcsGambleBannerIn {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(10px) scale(0.86);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
}

@keyframes fcsGambleWinPulse {
  0% {
    transform: translate(-50%, -50%) scale(1);
  }
  40% {
    transform: translate(-50%, -50%) scale(1.08);
  }
  100% {
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes fcsGambleLoseShake {
  0%,
  100% {
    transform: translate(-50%, -50%);
  }
  20% {
    transform: translate(calc(-50% - 5px), -50%);
  }
  40% {
    transform: translate(calc(-50% + 5px), -50%);
  }
  60% {
    transform: translate(calc(-50% - 3px), -50%);
  }
  80% {
    transform: translate(calc(-50% + 3px), -50%);
  }
}

/* 圈内竖向滚轮：始终同一条数字条，停轮不换层 */
.fcs-reel {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 1;
  width: min(46%, 128px);
  aspect-ratio: 1 / 1;
  height: auto;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-sizing: border-box;
  container-type: size;
  pointer-events: none;
}

.fcs-reel-window {
  width: 82%;
  height: 62%;
  overflow: hidden;
  position: relative;
  box-sizing: border-box;
}

/* 仅滚动时淡出上下；停轮后完整显示当前格 */
.fcs-gamble.rolling .fcs-reel-window {
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #000 18%,
    #000 82%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #000 18%,
    #000 82%,
    transparent 100%
  );
}

.fcs-gamble.locked .fcs-reel-window {
  mask-image: none;
  -webkit-mask-image: none;
}

.fcs-reel-strip {
  display: flex;
  flex-direction: column;
  align-items: center;
  will-change: transform;
}

.fcs-reel-cell {
  flex: 0 0 auto;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Arial Black', 'Microsoft YaHei', Impact, sans-serif;
  font-weight: 900;
  line-height: 1;
  color: #fff4c8;
  text-shadow:
    0 0 8px rgba(255, 200, 60, 0.8),
    0 2px 0 rgba(60, 30, 0, 0.65);
}

.fcs-gamble.rolling .fcs-reel-cell {
  color: #e8fff8;
  text-shadow:
    0 0 10px #40ffe0,
    0 0 18px rgba(0, 220, 200, 0.5),
    0 2px 0 rgba(0, 0, 0, 0.65);
}

.fcs-gamble.locked .fcs-reel-cell {
  color: #fff8d0;
  text-shadow:
    0 0 10px #ffd040,
    0 0 20px rgba(255, 180, 0, 0.55),
    0 2px 0 rgba(0, 0, 0, 0.65);
}

.fcs-gamble.gamble_win .fcs-reel-cell {
  color: #e8ffe0;
  text-shadow:
    0 0 12px #80ff40,
    0 0 24px rgba(120, 255, 40, 0.65),
    0 2px 0 rgba(20, 60, 0, 0.7);
  animation: fcsFlash 0.45s ease-out 2;
}

.fcs-gamble.gamble_lose .fcs-reel-cell {
  color: #ffb0b0;
  text-shadow:
    0 0 12px #ff3030,
    0 0 22px rgba(255, 40, 40, 0.55),
    0 2px 0 rgba(60, 0, 0, 0.7);
}

.fcs-gamble.gamble_push .fcs-reel-cell {
  color: #d8f4ff;
  text-shadow:
    0 0 12px #40c0ff,
    0 0 20px rgba(40, 160, 255, 0.5),
    0 2px 0 rgba(0, 30, 60, 0.65);
}

@keyframes fcsFlash {
  from {
    filter: brightness(1);
  }
  to {
    filter: brightness(1.35);
  }
}
</style>
