<template>
  <!--
    官方 BetBoardPanelV2.startMaskAnimation：
    effectMask 作 mask 扫过 maskEffectGroup → 露出 pattern/outline（白光闪过）。
    bg：每 7s，mask0 x:-width→width，5s
    ring：延迟 2s 后每 7s，group1→4 各 1s + 间隔 500ms（group4 反向）
  -->
  <div v-show="active" class="mask-fx" aria-hidden="true">
    <div class="g0">
      <div
        class="win-h"
        :style="{
          transform: `translateX(${flash0X}px)`,
          transition: flash0T,
        }"
      >
        <img
          class="pattern"
          src="/images/games/bcbm/benz/bet/yben_mask_panel_pattern.webp"
          alt=""
          draggable="false"
          :style="{
            transform: `translateX(${-flash0X}px)`,
            transition: flash0T,
          }"
        />
      </div>
    </div>

    <div class="g-ring" style="top: 192px; height: 89px">
      <div
        class="win-v"
        :style="{ transform: `translateY(${flash1Y}px)`, transition: flash1T }"
      >
        <div
          class="ring-inner"
          :style="{
            transform: `translateY(${-flash1Y}px)`,
            transition: flash1T,
          }"
        >
          <img class="outline" style="left: 8.5px" :src="outline" alt="" />
          <img class="outline" style="left: 383.5px" :src="outline" alt="" />
        </div>
      </div>
    </div>

    <div class="g-ring" style="top: 220.5px; height: 64px">
      <div
        class="win-v"
        :style="{ transform: `translateY(${flash2Y}px)`, transition: flash2T }"
      >
        <div
          class="ring-inner"
          :style="{
            transform: `translateY(${-flash2Y}px)`,
            transition: flash2T,
          }"
        >
          <img
            class="outline s07"
            style="left: 106px; top: 1px"
            :src="outline"
            alt=""
          />
          <img
            class="outline s07"
            style="left: 311px; top: 0"
            :src="outline"
            alt=""
          />
        </div>
      </div>
    </div>

    <div class="g-ring" style="top: 213.5px; height: 64px">
      <div
        class="win-v"
        :style="{ transform: `translateY(${flash3Y}px)`, transition: flash3T }"
      >
        <div
          class="ring-inner"
          :style="{
            transform: `translateY(${-flash3Y}px)`,
            transition: flash3T,
          }"
        >
          <img
            class="outline s07"
            style="left: 173px; top: 0"
            :src="outline"
            alt=""
          />
          <img
            class="outline s07"
            style="left: 243.5px; top: 0.5px"
            :src="outline"
            alt=""
          />
        </div>
      </div>
    </div>

    <div class="g-ring" style="top: 109px; height: 89px">
      <div
        class="win-v"
        :style="{ transform: `translateY(${flash4Y}px)`, transition: flash4T }"
      >
        <div
          class="ring-inner"
          :style="{
            transform: `translateY(${-flash4Y}px)`,
            transition: flash4T,
          }"
        >
          <img
            class="outline"
            style="left: 195.5px; top: 0"
            :src="outline"
            alt=""
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  active: boolean
}>()

const outline = '/images/games/bcbm/benz/bet/yben_mask_outline.webp'

const MASK0_W = 200
const PANEL_W = 480
/** 官方 effectMask.width=50（旋转后竖向扫光厚度） */
const MW = 50
/** 相对 group：start = h+1，end = -mw-1；group4 反向 */
const HIDDEN = 200

const flash0X = ref(-MASK0_W)
const flash0T = ref('none')
const flash1Y = ref(HIDDEN)
const flash2Y = ref(HIDDEN)
const flash3Y = ref(HIDDEN)
const flash4Y = ref(HIDDEN)
const flash1T = ref('none')
const flash2T = ref('none')
const flash3T = ref('none')
const flash4T = ref('none')

let bgTimer: number | null = null
let ringKick: number | null = null
let ringTimer: number | null = null
let chain: number[] = []

function clearTimers() {
  if (bgTimer != null) window.clearInterval(bgTimer)
  if (ringKick != null) window.clearTimeout(ringKick)
  if (ringTimer != null) window.clearInterval(ringTimer)
  for (const id of chain) window.clearTimeout(id)
  bgTimer = ringKick = ringTimer = null
  chain = []
}

function resetPos() {
  flash0T.value = 'none'
  flash0X.value = -MASK0_W
  flash1T.value = flash2T.value = flash3T.value = flash4T.value = 'none'
  flash1Y.value = flash2Y.value = flash3Y.value = flash4Y.value = HIDDEN
}

function playFlash0() {
  flash0T.value = 'none'
  flash0X.value = -MASK0_W
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      flash0T.value = 'transform 5s linear'
      flash0X.value = PANEL_W
    })
  })
}

function sweep(
  yRef: typeof flash1Y,
  tRef: typeof flash1T,
  from: number,
  to: number,
) {
  tRef.value = 'none'
  yRef.value = from
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      tRef.value = 'transform 1s linear'
      yRef.value = to
    })
  })
}

function playRingSequence() {
  // 相对各 g-ring：h+1 → -mw-1；group4 反向
  sweep(flash1Y, flash1T, 89 + 1, -MW - 1)
  chain.push(
    window.setTimeout(() => sweep(flash2Y, flash2T, 64 + 1, -MW - 1), 1500),
    window.setTimeout(() => sweep(flash3Y, flash3T, 64 + 1, -MW - 1), 3000),
    window.setTimeout(() => sweep(flash4Y, flash4T, -MW - 1, 89 + 1), 4500),
  )
}

function start() {
  clearTimers()
  resetPos()
  bgTimer = window.setInterval(playFlash0, 7000)
  ringKick = window.setTimeout(() => {
    playRingSequence()
    ringTimer = window.setInterval(playRingSequence, 7000)
  }, 2000)
}

function stop() {
  clearTimers()
  resetPos()
}

watch(
  () => props.active,
  (on) => {
    if (on) start()
    else stop()
  },
)

onMounted(() => {
  if (props.active) start()
})
onBeforeUnmount(stop)
</script>

<style scoped>
.mask-fx {
  position: absolute;
  left: 0;
  top: 0;
  width: 480px;
  height: 439px;
  z-index: 2;
  pointer-events: none;
  overflow: hidden;
}
.g0 {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.win-h {
  position: absolute;
  left: 0;
  top: 95px;
  width: 200px;
  height: 344px;
  overflow: hidden;
  will-change: transform;
  -webkit-mask-image: url('/images/games/bcbm/benz/bet/yben_sfx_flash_light.webp');
  mask-image: url('/images/games/bcbm/benz/bet/yben_sfx_flash_light.webp');
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-mode: luminance;
  mask-mode: luminance;
}
.win-h .pattern {
  position: absolute;
  left: 5px;
  top: 9px;
  width: 470px;
  height: 304px;
  object-fit: fill;
  mix-blend-mode: screen;
  will-change: transform;
}
.g-ring {
  position: absolute;
  left: 0;
  width: 480px;
  overflow: hidden;
}
.win-v {
  position: absolute;
  left: 0;
  top: 0;
  width: 480px;
  height: 50px;
  overflow: hidden;
  will-change: transform;
  /* 等效官方 rotation=90 后的上下软边 */
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #fff 28%,
    #fff 72%,
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    #fff 28%,
    #fff 72%,
    transparent 100%
  );
}
.ring-inner {
  position: absolute;
  left: 0;
  top: 0;
  width: 480px;
  height: 100px;
  will-change: transform;
}
.outline {
  position: absolute;
  top: 0;
  width: 89px;
  height: 89px;
  object-fit: fill;
  mix-blend-mode: screen;
}
.outline.s07 {
  width: 62.3px;
  height: 62.3px;
}
</style>
