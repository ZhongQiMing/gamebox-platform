<template>
  <!-- 原点由父级 .spin-anchor 定位；手机 RADIUS=180 -->
  <div class="spin-ring">
    <div
      v-for="i in iconCount"
      :key="i - 1"
      :ref="(el) => setCarRef(el as HTMLElement | null, i - 1)"
      class="car-slot"
      :class="[
        `color-${iconColor(i - 1)}`,
        { hit: hitIconSet.has(i - 1) },
      ]"
    >
      <!--
        素材 yben_icon_large_*_{color} 已自带同色外圈光晕；
        中奖呼吸 = 加强这圈 bloom 的明暗起伏，勿再叠一层假光环。
      -->
      <img
        class="car-img"
        :src="spinIconUrl(i - 1)"
        alt=""
        draggable="false"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'
import {
  BcbmSpinEngine,
  BCBM_PLAYTYPE_META,
  spinIconUrl,
  iconIndexOfCarPos,
  type IconPose,
} from '@/games/bcbm/bcbmSpinMath'

/** skin carN → 外圈色（与 yben_icon_large_*_{color} 一致） */
function iconColor(iconIndex: number): 'red' | 'green' | 'yellow' {
  const pt = ((iconIndex % 12) + 12) % 12
  const c = BCBM_PLAYTYPE_META[pt]?.color
  return c === 'red' || c === 'green' || c === 'yellow' ? c : 'yellow'
}

const props = defineProps<{
  hitCarPos?: number[]
}>()

const emit = defineEmits<{
  stopped: []
  ready: []
  /** 官方 SpinStatusEnum 对齐：starting / spinning / stopping / stopped */
  status: [string]
}>()

const engine = new BcbmSpinEngine()
const iconCount = engine.poses().length

/**
 * 官方 Egret 默认 frameRate=30；参数（MAX_SPEED=20、STOP_ACCEL=-0.5）按「每逻辑帧」标定。
 * 若用 rAF 60fps 每帧 tick，转速/刹车都会快约一倍 → 观感「转不对」。
 */
const LOGIC_FPS = 30
const FRAME_MS = 1000 / LOGIC_FPS

// 逐帧动画直写 DOM：24 个槽位每逻辑帧只改 transform，不走 Vue diff
const carEls: (HTMLElement | null)[] = new Array(iconCount).fill(null)
function setCarRef(el: HTMLElement | null, i: number) {
  carEls[i] = el
}

const hitIconSet = computed(() => {
  const s = new Set<number>()
  for (const p of props.hitCarPos ?? []) s.add(iconIndexOfCarPos(p))
  return s
})

let raf = 0
let wasRunning = false
let lastStatus = engine.status
let lastTs = 0
let accMs = 0

function applyPoses(poses: IconPose[]) {
  for (let i = 0; i < poses.length; i++) {
    const el = carEls[i]
    if (!el) continue
    const p = poses[i]
    el.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) scale(${p.scale})`
    el.style.zIndex = String(p.zIndex)
  }
}

function afterTick() {
  if (engine.status !== lastStatus) {
    lastStatus = engine.status
    emit('status', engine.status)
  }
  if (engine.status === 'stopped' && wasRunning) {
    wasRunning = false
    emit('stopped')
  }
}

function loop(ts: number) {
  if (!lastTs) lastTs = ts
  let dt = ts - lastTs
  lastTs = ts
  // 后台挂起后避免一次补太多帧
  if (dt > 100) dt = FRAME_MS
  accMs += dt
  let steps = 0
  while (accMs >= FRAME_MS && steps < 3) {
    applyPoses(engine.tick())
    afterTick()
    accMs -= FRAME_MS
    steps++
  }
  if (steps === 0) {
    // 仅重绘当前姿态（hit class 等由 Vue 更新）
    applyPoses(engine.poses())
  }
  raf = requestAnimationFrame(loop)
}

type SpinStartOpts = {
  /** 官方 delaySpining(ms) */
  delayMs?: number
  /**
   * 高倍期待：先转起来，再 setTarget
   * true 时不立刻写入 targetPos
   */
  deferTarget?: boolean
}

/**
 * 官方：不重置角度，从当前 Idle 透视 morph 到 StartSpin 再加速。
 */
async function start(carPos: number, opts: SpinStartOpts | number = {}) {
  const o: SpinStartOpts =
    typeof opts === 'number' ? { delayMs: opts } : (opts ?? {})
  wasRunning = true
  engine.angleSpeed = 0
  engine.angleAccelarate = 0
  engine.canStopSpinningNow = true
  engine.setTarget(-1)
  if (engine.status !== 'idle') {
    await engine.transformToIdle()
  }
  if (o.delayMs && o.delayMs > 0) engine.delayStop(o.delayMs)
  if (!o.deferTarget) engine.setTarget(carPos)
  engine.transformToSpin()
}

function setTarget(carPos: number) {
  engine.setTarget(carPos)
}

function delayStop(ms: number) {
  engine.delayStop(ms)
}

function transformToIdle() {
  return engine.transformToIdle()
}

onMounted(() => {
  applyPoses(engine.poses())
  lastTs = 0
  accMs = 0
  raf = requestAnimationFrame(loop)
  emit('ready')
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
})

/**
 * 官方 cloneIcons：从灯环复制中奖 carPos 图标，坐标转成舞台绝对像素
 * spin-anchor 在 GamePageSkin：(240, 168)
 */
function getClonePayload(carPositions: number[]) {
  const OX = 240
  const OY = 168
  const cur = engine.poses()
  return carPositions.map((cp) => {
    const ii = iconIndexOfCarPos(cp)
    const p = cur[ii] ?? { x: 0, y: 0, scale: 0.4 }
    return {
      src: spinIconUrl(ii),
      x: OX + p.x,
      y: OY + p.y,
      scale: p.scale,
    }
  })
}

defineExpose({ start, setTarget, delayStop, transformToIdle, getClonePayload, engine })
</script>

<style scoped>
.spin-ring {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
}
.car-slot {
  position: absolute;
  left: 0;
  top: 0;
  width: 112px;
  height: 112px;
  transform-origin: center center;
  pointer-events: none;
  will-change: transform;
}
.car-img {
  position: absolute;
  inset: 0;
  width: 112px;
  height: 112px;
  object-fit: fill;
  pointer-events: none;
}
.car-slot.color-red {
  --glow: #ff2438;
  --glow2: rgba(255, 36, 56, 0.85);
}
.car-slot.color-green {
  --glow: #28ff4e;
  --glow2: rgba(40, 255, 78, 0.85);
}
.car-slot.color-yellow {
  --glow: #ffe03c;
  --glow2: rgba(255, 224, 60, 0.9);
}
/*
 * 官方 getIconShineTask(4)：clone ADD α 0.2→1，200ms ×4 ping-pong。
 * 灯环本体用亮度/外发光对齐节奏（无独立 clone 层时）。
 */
.car-slot.hit .car-img {
  animation: bcbmIconShine 0.2s ease-in-out 4 alternate;
}
@keyframes bcbmIconShine {
  from {
    opacity: 0.35;
    filter: brightness(0.9)
      drop-shadow(0 0 1px var(--glow))
      drop-shadow(0 0 3px var(--glow2));
  }
  to {
    opacity: 1;
    filter: brightness(1.35)
      drop-shadow(0 0 2px var(--glow))
      drop-shadow(0 0 6px var(--glow))
      drop-shadow(0 0 10px var(--glow2));
  }
}
</style>
