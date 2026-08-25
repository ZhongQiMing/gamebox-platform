<template>
  <!--
    官方 GamePageSkin：bg → speedEffectGroup → spinPanel → payoutGroup → betBoard
    用 Teleport 挂到舞台插槽，避免遮罩盖住车标/押注板
  -->
  <Teleport defer to="#bcbm-speed-fx-mount">
    <div v-show="speedLayerOn" class="fx-speed-layer" aria-hidden="true">
      <!-- 官方 SPINNING：speedEffectMask.alpha=0.6，且在 spin 之下 -->
      <div v-if="showSpeedMask" class="fx-speed-mask" />
      <!-- armature 锚点 (240,160) scale=0.7；DB 失败时回退 CSS 射线 -->
      <div v-show="!useDbSpeed" class="fx-speed-arm" :class="{ strong: speedStrong }">
        <div
          v-for="(ray, i) in speedRays"
          :key="`ray${i}`"
          class="fx-speed-ray-wrap"
          :style="ray.wrapStyle"
        >
          <img
            class="fx-speed-ray"
            :src="speedSrc"
            alt=""
            draggable="false"
            :style="ray.animStyle"
          />
        </div>
        <img
          v-if="showSpeedZoom"
          class="fx-speed-zoom"
          :src="speedZoomSrc"
          alt=""
          draggable="false"
        />
        <img
          v-if="showSpeedBlur"
          class="fx-speed-blur"
          :src="speedBlurSrc"
          alt=""
          draggable="false"
        />
      </div>
    </div>
  </Teleport>

  <Teleport defer to="#bcbm-payout-fx-mount">
    <div v-show="payoutLayerOn" class="fx-payout-layer" aria-hidden="true">
      <!--
        官方 yben_effect_final_common @ (240,220) scale=0.6
        reward_1: 四层 scifi 圈 + 四角 mask_effect_outline（青色括号框，非五边形）
        reward_2/3: 左右横贯 vfx_thunder_01 电弧 + glow
        不要用 lv2 环绕电弧围框——官网主视觉是括号框+左右电弧
      -->
      <div
        v-show="payoutArmOn && !useDbPayout"
        class="fx-payout-arm"
        :class="`anim-${payoutAnim}`"
      >
        <img
          class="fx-circle c01"
          :src="fxUrl('common/vfx_scifi_circle01.webp')"
          alt=""
          draggable="false"
        />
        <img
          class="fx-circle c02"
          :src="fxUrl('common/vfx_scifi_circle02.webp')"
          alt=""
          draggable="false"
        />
        <img
          class="fx-circle c03"
          :src="fxUrl('common/vfx_scifi_circle03.webp')"
          alt=""
          draggable="false"
        />
        <img
          class="fx-circle c05"
          :src="fxUrl('common/vfx_scifi_circle05.webp')"
          alt=""
          draggable="false"
        />

        <!-- 青色括号框：四角 outline，原尺寸 201×151，按骨骼翻转 -->
        <img
          v-for="(o, i) in cornerOutlines"
          :key="`ol${i}`"
          v-show="showCorners"
          class="fx-corner-outline"
          :src="fxUrl('common/mask_effect_outline.webp')"
          alt=""
          draggable="false"
          :style="o.style"
        />

        <!-- 左右横贯电弧（官网主电弧） -->
        <img
          v-for="(t, i) in sideThunders"
          :key="`st${i}`"
          v-show="showSideThunder"
          class="fx-side-thunder"
          :src="fxUrl('common/vfx_thunder_01.webp')"
          alt=""
          draggable="false"
          :style="t.style"
        />

        <img
          v-show="showGlow"
          class="fx-glow"
          :src="fxUrl('common/vfx_bg_txt_glow.webp')"
          alt=""
          draggable="false"
        />
      </div>

      <img
        v-for="(c, i) in clones"
        :key="`c${i}`"
        class="fx-clone"
        :class="{ main: c.main, small: !c.main, shine: c.shine }"
        :src="c.src"
        alt=""
        draggable="false"
        :style="c.style"
      />

      <!-- 官方 bonusArmature scale=1，locale 横幅字 -->
      <img
        v-if="bannerSrc"
        class="fx-banner"
        :class="{ pop: bannerPop }"
        :src="bannerSrc"
        alt=""
        draggable="false"
      />
      <img
        v-if="bannerSrc && bannerPop"
        class="fx-banner-shadow"
        :src="bannerSrc"
        alt=""
        draggable="false"
      />

      <!-- 官方 Lv4 rewardPaperBg：yben_vfx_bg_purple ADD 全屏（彩纸粒子在 #bcbm-paper-fx-host） -->
      <img
        v-if="showPaperBg"
        class="fx-paper-bg"
        src="/images/games/bcbm/benz/main/yben_vfx_bg_purple.webp"
        alt=""
        draggable="false"
      />

      <!-- PrizeLv 电弧：DragonBones yben_lv2_thunder（见 startPrizeThunder） -->
      <!-- 金额蓝光粒子专用层：在数字下、派彩 DB 上，勿整图拉竖条 -->
      <div id="bcbm-amount-glow-host" class="fx-amount-glow-host" />

      <!-- 官方 payoutAmountText：中心/顶部都用 win 字图；闪光用 yben_number_effect -->
      <div
        v-if="amountVisible"
        class="fx-amount-wrap"
        :class="{ top: amountAtTop }"
        :style="amountWrapStyle"
      >
        <div
          class="fx-amount-digits"
          :style="{ transform: `scaleY(${amountScaleY})` }"
        >
          <img
            v-for="(ch, i) in amountChars"
            :key="`${i}-${ch}`"
            class="fx-amount-digit"
            :src="glyphSrc(ch)"
            :style="digitStyle(ch)"
            alt=""
            draggable="false"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import {
  playBcbmCounting,
  endBcbmCounting,
  playBcbmPrizeLv,
  playBcbmFlash,
  endBcbmPayout,
  playBcbmBonusAnnounce,
  bcbmCountDurationMs,
} from '@/games/bcbm/bcbmAudio'
import {
  bcbmWinDigitStyle,
  bcbmWinGlyphSrc,
  formatBcbmWinAmount,
  measureBcbmWinTextWidth,
} from '@/games/bcbm/bcbmWinFont'
import {
  destroyBcbmDragonBones,
  playBcbmDbArmature,
  preloadBcbmDragonBones,
  startBcbmAmountGlow,
  startBcbmRewardPaper,
  stopBcbmAmountGlow,
  stopBcbmRewardPaper,
  stopBcbmDbLayer,
  stopBcbmDbSlot,
} from '@/games/bcbm/bcbmDragonBones'

const TXT = '/images/games/bcbm/benz/txt'
/** 黑底已转透明，带版本避免浏览器继续用旧图 */
const FXV = 'alpha1'
const FX = `/images/games/bcbm/benz/fx`
const fxUrl = (rel: string) => `${FX}/${rel}?v=${FXV}`

export type BcbmFxKind =
  | 'sanyuan'
  | 'sixi'
  | 'lightning'
  | 'uturn'
  | 'fast'
  | 'drift'
  | 'win'
  | 'none'

const showSpeed = ref(false)
const showSpeedZoom = ref(false)
const showSpeedBlur = ref(false)
const showSpeedMask = ref(false)
const speedStrong = ref(false)
const useDbSpeed = ref(false)
const useDbPayout = ref(false)
const payoutArmOn = ref(false)
/** reward1 | reward2 | reward3 | reward4 | '' */
const payoutAnim = ref('')
const showCorners = ref(false)
const showSideThunder = ref(false)
const showGlow = ref(false)
const bannerSrc = ref('')
const bannerPop = ref(false)
const amountVisible = ref(false)
const amountAtTop = ref(false)
const amountFlying = ref(false)
const amountText = ref('')
const amountScale = ref(0.6)
const amountScaleY = ref(1)
const amountLeft = ref<number | null>(null)
const amountY = ref(400)
const clones = ref<
  Array<{
    src: string
    main: boolean
    shine?: boolean
    style: Record<string, string>
  }>
>([])
/** 官方 PrizeLv randomPlayThunder 槽 */
const prizeThunders = ref<
  Array<{ id: number; src: string; style: Record<string, string> }>
>([])
const showAmountShine = ref(false)
const showAmountDot = ref(false)
const showPaperBg = ref(false)
let prizeThunderTimers: number[] = []
const speedFrame = ref(0)
const speedZoomFrame = ref(0)

/**
 * 官方 PrizeLv 电弧槽（HIT：for i=0..5; if i!=1; ang=60*i+30）
 * rotation = ang+90；半径 140；圆心 (W/2, payoutY=220)；scale 0.6
 * 详见 scripts/_yben_dump/OFFICIAL_THUNDER_SPEC.md
 */
const THUNDER_RADIUS = 140
const THUNDER_SCALE = 0.6
const THUNDER_SLOTS: Array<{ ang: number; rotation: number }> = (() => {
  const list: Array<{ ang: number; rotation: number }> = []
  for (let i = 0; i < 6; i++) {
    if (i === 1) continue
    const ang = 60 * i + 30
    list.push({ ang, rotation: ang + 90 })
  }
  return list
})()

let timers: number[] = []
let running: Promise<void> | null = null
let speedTickId = 0
let amountRaf = 0

/**
 * 手机基类 GameAppPage（benz2221）：
 * payoutArmatureDisplayY=220 scale=0.6
 * bonusArmatureDisplayScale=1
 * reward_1 ≈ 35f@24fps ≈ 1460ms；reward_2/3 ≈ 50f ≈ 2080ms；reward_4 ≈ 1460ms
 */
const STAGE_W = 480
/** 与 mobilePanelLayout.MOBILE_STAGE_H 一致；面板下移后射线仍需铺满 */
const STAGE_H = 820
const PAYOUT_Y = 220
const SMALL_ICON_Y = 310
const ICON_NATIVE = 112
const LARGE_ICON = ICON_NATIVE
const SMALL_ICON = Math.round(ICON_NATIVE * 0.5)
const FLY_MS = 500
const REWARD1_MS = 1460
const REWARD2_MS = 2080
const REWARD4_MS = 1460
const AMOUNT_CENTER_Y = 400
const AMOUNT_CENTER_SCALE = 0.6
/** 官方 setPayoutAmountTextTop：left=220 y=44 scale=0.2 */
const AMOUNT_TOP_LEFT = 220
const AMOUNT_TOP_Y = 44
const AMOUNT_TOP_SCALE = 0.2
const AMOUNT_TOP_HOLD_MS = 200
/** text_appear ≈17f@24fps（预留，当前时间轴未单独引用） */
const _TEXT_APPEAR_MS = 708
void _TEXT_APPEAR_MS

/**
 * 四角青色括号框 mask_effect_outline（官网主框，不是五边形电框）
 * TL(-273.7,-160.9) scY=-1 | TR(273.7,-160.9) scX=scY=-1
 * BL(-273.7,134) | BR(273.7,134) scX=-1
 * 贴图 201×151，保持原比例，禁止拉大成围框
 */
const cornerOutlines = [
  {
    style: {
      left: '-273.7px',
      top: '-160.9px',
      transform: 'translate(-50%, -50%) scaleY(-1)',
    },
  },
  {
    style: {
      left: '273.7px',
      top: '-160.9px',
      transform: 'translate(-50%, -50%) scale(-1, -1)',
    },
  },
  {
    style: {
      left: '-273.7px',
      top: '134px',
      transform: 'translate(-50%, -50%)',
    },
  },
  {
    style: {
      left: '273.7px',
      top: '134px',
      transform: 'translate(-50%, -50%) scaleX(-1)',
    },
  },
]

/**
 * 左右横贯电弧 vfx_thunder_01（官网主电弧）
 * 官网 4 槽：L / L1 / R / R1，各带 display 偏移+缩放（不是居中一整条粗光带）
 * 骨位 L(-423.4,26.85) L1(-403.4,46.85) R/R1(427.05,12.2)
 * 贴图 705×344，pivot=中心；CSS = 骨位 + display(x,y) + scale/rotate
 */
function thunderStyle(
  boneX: number,
  boneY: number,
  dx: number,
  dy: number,
  scX: number,
  scY: number,
  skDeg = 0,
) {
  const rot = skDeg ? ` rotate(${skDeg}deg)` : ''
  return {
    left: `${boneX + dx}px`,
    top: `${boneY + dy}px`,
    transform: `translate(-50%, -50%) scale(${scX}, ${scY})${rot}`,
  }
}

const sideThunders = [
  // vfx_thunder_L display0
  {
    style: {
      ...thunderStyle(-423.4, 26.85, 57.87, -21.6, 0.8, 0.7, 2.88),
      animationDelay: '0s',
      opacity: '0.85',
    },
  },
  // vfx_thunder_L1 display1（偏右、略扁，叠出分支感）
  {
    style: {
      ...thunderStyle(-403.4, 46.85, 198.9, -18.51, 1.09, 0.77, 0),
      animationDelay: '0.07s',
      opacity: '0.7',
    },
  },
  // vfx_thunder_R display0
  {
    style: {
      ...thunderStyle(427.05, 12.2, 24.35, 23.79, -0.8, 0.7, -3.68),
      animationDelay: '0.04s',
      opacity: '0.85',
    },
  },
  // vfx_thunder_R1 display2
  {
    style: {
      ...thunderStyle(427.05, 12.2, -156.06, -14.21, -0.7, 0.7, 5.36),
      animationDelay: '0.11s',
      opacity: '0.7',
    },
  },
]

export type CloneFrom = { src: string; x: number; y: number; scale: number }

export type PayoutOpts = {
  kind: Exclude<BcbmFxKind, 'win' | 'none'> | null
  clones: CloneFrom[]
  payout: number
  payoutLevel: number
  /** 报奖旁白用（sixi_red / sanyuan_benz 等）；缺省则用 kind */
  awardType?: string
  /** 官方滚分时长公式需要 totalBet */
  totalBet?: number
}

const SPEED_WEAK = [
  fxUrl('speed2/vfx_speed_line_3.webp'),
  fxUrl('speed2/vfx_speed_line_4.webp'),
]
const SPEED_STRONG = [
  fxUrl('speed/vfx_speed_line_1.webp'),
  fxUrl('speed/vfx_speed_line_2.webp'),
]
const ZOOM_WEAK = [fxUrl('speed2/vfx_circle_zoom_3.webp')]
const ZOOM_STRONG = [
  fxUrl('speed/vfx_circle_zoom_1.webp'),
  fxUrl('speed/vfx_circle_zoom_2.webp'),
]
/**
 * 官方 speedup_effect：同一张放射贴图挂在多根 bone 上，短脉冲 sc 0.01→8（大线→20），
 * 再配合旋转相位。勿把 8 份全图叠到 maxScale≈1.2（糊成一团、往外爆不开）。
 */
const SPEED_RAY_DEFS = [
  { rot: 0, delay: '0s', dur: '0.72s', peak: 8 },
  { rot: 40, delay: '0.18s', dur: '0.68s', peak: 8 },
  { rot: 90, delay: '0.08s', dur: '0.7s', peak: 12 },
  { rot: 145, delay: '0.28s', dur: '0.66s', peak: 8 },
]

const speedLayerOn = computed(
  () => showSpeedMask.value || showSpeed.value || showSpeedZoom.value || showSpeedBlur.value,
)
const payoutLayerOn = computed(
  () =>
    payoutArmOn.value ||
    showGlow.value ||
    !!bannerSrc.value ||
    amountVisible.value ||
    clones.value.length > 0 ||
    prizeThunders.value.length > 0 ||
    showAmountShine.value ||
    showAmountDot.value ||
    showPaperBg.value,
)

const speedSrc = computed(() => {
  const frames = speedStrong.value ? SPEED_STRONG : SPEED_WEAK
  return frames[speedFrame.value % frames.length]
})
const speedZoomSrc = computed(() => {
  const frames = speedStrong.value ? ZOOM_STRONG : ZOOM_WEAK
  return frames[speedZoomFrame.value % frames.length]
})
const speedBlurSrc = computed(() =>
  speedStrong.value ? fxUrl('speed/vfx_bg_blur.webp') : fxUrl('speed2/vfx_bg_blur.webp'),
)

const speedRays = computed(() => {
  if (!showSpeed.value)
    return [] as Array<{
      wrapStyle: Record<string, string>
      animStyle: Record<string, string>
    }>
  const speedMul = speedStrong.value ? 0.42 : 1
  return SPEED_RAY_DEFS.map((d) => ({
    wrapStyle: { transform: `rotate(${d.rot}deg)` },
    animStyle: {
      animationDuration: `${parseFloat(d.dur) * speedMul}s`,
      animationDelay: d.delay,
      '--speed-peak': String(d.peak),
    },
  }))
})

const BANNER: Record<Exclude<BcbmFxKind, 'win' | 'none'>, string> = {
  sanyuan: `${TXT}/yben_txt_three_great_scholars_hans.webp`,
  sixi: `${TXT}/yben_txt_four_great_blessings_hans.webp`,
  lightning: `${TXT}/yben_txt_lightning_bolt_hans.webp`,
  uturn: `${TXT}/yben_txt_u_turn_hans.webp`,
  fast: `${TXT}/yben_txt_fast_and_furious_hans.webp`,
  drift: `${TXT}/yben_txt_total_drift_hans.webp`,
}

const amountChars = computed(() => amountText.value.split(''))
const amountWrapStyle = computed(() => {
  const w = measureBcbmWinTextWidth(amountText.value || '0', amountScale.value)
  if (amountAtTop.value && amountLeft.value != null) {
    // 官方 left=220 为字图左缘；我们用中心点 = left + w/2
    return {
      left: `${amountLeft.value}px`,
      top: `${amountY.value}px`,
      width: `${w}px`,
      transform: 'translate(-50%, -50%)',
      transition: 'none',
    }
  }
  return {
    left: '50%',
    top: `${amountY.value}px`,
    width: `${w}px`,
    transform: 'translate(-50%, -50%)',
    transition: 'none',
  }
})

function digitStyle(ch: string) {
  return bcbmWinDigitStyle(ch, amountScale.value)
}

function glyphSrc(ch: string) {
  return bcbmWinGlyphSrc(ch)
}

/** 金额显示时抬高 payout 插槽，避免被押注板挡住（官方此时面板已下移到 y=505） */
watch(amountVisible, (on) => {
  const el = document.getElementById('bcbm-payout-fx-mount')
  if (el) el.classList.toggle('fx-mount-amount-up', on)
})

function clearTimers() {
  for (const t of timers) window.clearInterval(t)
  timers = []
  if (amountRaf) {
    cancelAnimationFrame(amountRaf)
    amountRaf = 0
  }
}

function every(ms: number, fn: () => void) {
  const id = window.setInterval(fn, ms)
  timers.push(id)
  return id
}

function sleep(ms: number) {
  return new Promise<void>((r) => window.setTimeout(r, ms))
}

function resetLayers() {
  showSpeed.value = false
  showSpeedZoom.value = false
  showSpeedBlur.value = false
  showSpeedMask.value = false
  speedStrong.value = false
  useDbSpeed.value = false
  useDbPayout.value = false
  void stopBcbmDbLayer('speed')
  void stopBcbmDbLayer('payout')
  payoutArmOn.value = false
  payoutAnim.value = ''
  showCorners.value = false
  showSideThunder.value = false
  showGlow.value = false
  bannerSrc.value = ''
  bannerPop.value = false
  amountVisible.value = false
  amountAtTop.value = false
  amountFlying.value = false
  amountText.value = ''
  amountScale.value = AMOUNT_CENTER_SCALE
  amountScaleY.value = 1
  amountLeft.value = null
  amountY.value = AMOUNT_CENTER_Y
  clones.value = []
  stopPrizeLvFx()
  showPaperBg.value = false
  speedFrame.value = 0
  speedZoomFrame.value = 0
  speedTickId = 0
}

/**
 * 官方 randomPlayThunder：
 * - 池 _remainThunderIdxList=[0..4] 对应 5 个预创建槽
 * - playByFrame("vfx_electric_loop", 99) + spark.start()
 * - 存活 200+floor(600*random) ms 后还池并链式续播
 * - PrizeLv 进入时 for(n=0;n<3;n++) 同时起 3 路
 */
const activeThunderSlots = new Set<string>()

function stopPrizeThunder() {
  for (const id of prizeThunderTimers) window.clearTimeout(id)
  prizeThunderTimers = []
  for (const key of activeThunderSlots) {
    void stopBcbmDbSlot('payout', key)
  }
  activeThunderSlots.clear()
  prizeThunders.value = []
}

/** 官方 clearAllPrizeElement：电弧 + 金额蓝光 + 彩纸/紫底一起清 */
function stopPrizeLvFx() {
  stopPrizeThunder()
  stopBcbmAmountGlow('amountGlow')
  stopBcbmRewardPaper('paper')
  showAmountShine.value = false
  showAmountDot.value = false
  showPaperBg.value = false
}

function startPrizeThunder() {
  // 只停电弧槽，勿清 amountShine/Dot（与电弧并行）
  for (const id of prizeThunderTimers) window.clearTimeout(id)
  prizeThunderTimers = []
  for (const key of activeThunderSlots) {
    void stopBcbmDbSlot('payout', key)
  }
  activeThunderSlots.clear()
  prizeThunders.value = []
  // 官方：相对 thunderArmatureList 的下标 0..4
  const remain = THUNDER_SLOTS.map((_, idx) => idx)
  const spawnOne = () => {
    if (!remain.length) return
    const pick = Math.floor(Math.random() * remain.length)
    const listIdx = remain.splice(pick, 1)[0]!
    const slot = THUNDER_SLOTS[listIdx]!
    const slotKey = `thunder-${listIdx}`
    const rad = (slot.ang * Math.PI) / 180
    const x = STAGE_W / 2 + THUNDER_RADIUS * Math.cos(rad)
    const y = PAYOUT_Y + THUNDER_RADIUS * Math.sin(rad)
    activeThunderSlots.add(slotKey)
    void playBcbmDbArmature({
      layerKey: 'payout',
      packId: 'thunder',
      animation: 'vfx_electric_loop',
      playTimes: 99,
      x,
      y,
      scale: THUNDER_SCALE,
      rotationDeg: slot.rotation,
      withSpark: true,
      stageW: STAGE_W,
      stageH: 640,
      slotKey,
    }).then((ok) => {
      if (!ok) activeThunderSlots.delete(slotKey)
    })
    const tid = window.setTimeout(
      () => {
        void stopBcbmDbSlot('payout', slotKey)
        activeThunderSlots.delete(slotKey)
        remain.push(listIdx)
        spawnOne()
      },
      200 + Math.floor(Math.random() * 600),
    )
    prizeThunderTimers.push(tid)
  }
  // 官方：同步连调 3 次，无 stagger
  for (let i = 0; i < 3; i++) spawnOne()
}

function stop() {
  clearTimers()
  resetLayers()
  const el = document.getElementById('bcbm-payout-fx-mount')
  if (el) el.classList.remove('fx-mount-amount-up')
  running = null
}

function ensureSpeedTick(ms: number) {
  if (speedTickId) {
    window.clearInterval(speedTickId)
    timers = timers.filter((t) => t !== speedTickId)
  }
  speedTickId = every(ms, () => {
    if (showSpeed.value) speedFrame.value++
    if (showSpeedZoom.value) speedZoomFrame.value++
  })
}

async function playSpeedDb(strong: boolean) {
  await nextTick()
  const ok = await playBcbmDbArmature({
    layerKey: 'speed',
    packId: strong ? 'speedStrong' : 'speedWeak',
    animation: 'speedup_effect',
    playTimes: 0,
    x: STAGE_W / 2,
    y: 160,
    scale: 0.7,
    stageW: STAGE_W,
    stageH: STAGE_H,
    slotKey: strong ? 'speedStrong' : 'speedWeak',
  })
  useDbSpeed.value = ok
  return ok
}

function startSpeedWeak() {
  speedStrong.value = false
  showSpeedMask.value = true
  showSpeed.value = true
  showSpeedZoom.value = true
  showSpeedBlur.value = true
  speedFrame.value = 0
  speedZoomFrame.value = 0
  ensureSpeedTick(42)
  void playSpeedDb(false)
}

function startSpeedStrong() {
  speedStrong.value = true
  showSpeedMask.value = true
  showSpeed.value = true
  showSpeedZoom.value = true
  showSpeedBlur.value = true
  speedFrame.value = 0
  speedZoomFrame.value = 0
  ensureSpeedTick(14)
  void playSpeedDb(true)
}

function stopSpeed() {
  showSpeed.value = false
  showSpeedZoom.value = false
  showSpeedBlur.value = false
  showSpeedMask.value = false
  speedStrong.value = false
  useDbSpeed.value = false
  void stopBcbmDbLayer('speed')
  if (speedTickId) {
    window.clearInterval(speedTickId)
    timers = timers.filter((t) => t !== speedTickId)
    speedTickId = 0
  }
}

async function playPayoutDb(animation: string, playTimes = 1) {
  await nextTick()
  const ok = await playBcbmDbArmature({
    layerKey: 'payout',
    packId: 'payoutCommon',
    animation,
    playTimes,
    x: STAGE_W / 2,
    y: PAYOUT_Y,
    scale: 0.6,
    stageW: STAGE_W,
    stageH: 640,
    slotKey: 'payoutCommon',
  })
  useDbPayout.value = ok
  return ok
}

function layoutFlyTargets(list: CloneFrom[]) {
  if (!list.length)
    return [] as Array<{
      src: string
      from: CloneFrom
      toX: number
      toY: number
      toW: number
      main: boolean
    }>
  const main = list[0]!
  const out: Array<{
    src: string
    from: CloneFrom
    toX: number
    toY: number
    toW: number
    main: boolean
  }> = [
    {
      src: main.src,
      from: main,
      toX: STAGE_W / 2,
      toY: PAYOUT_Y,
      toW: LARGE_ICON,
      main: true,
    },
  ]
  const seen = new Set<string>([main.src])
  const slots: Array<{ src: string; from: CloneFrom }> = []
  for (let i = 1; i < list.length; i++) {
    const c = list[i]!
    if (c.src === main.src) {
      out.push({
        src: c.src,
        from: c,
        toX: STAGE_W / 2,
        toY: PAYOUT_Y,
        toW: LARGE_ICON,
        main: true,
      })
      continue
    }
    if (seen.has(c.src)) continue
    seen.add(c.src)
    slots.push({ src: c.src, from: c })
  }
  const row1Y = SMALL_ICON_Y
  const row2Y = SMALL_ICON_Y + SMALL_ICON
  const n = slots.length
  const row1 = Math.min(n, 6)
  const row2 = Math.max(0, n - 6)
  const span1 = SMALL_ICON * row1
  const span2 = SMALL_ICON * row2
  const left1 = STAGE_W / 2 - span1 / 2
  const left2 = STAGE_W / 2 - span2 / 2
  slots.forEach((s, i) => {
    const row = i < 6 ? 0 : 1
    const col = i < 6 ? i : i - 6
    const left = row === 0 ? left1 : left2
    const y = row === 0 ? row1Y : row2Y
    out.push({
      src: s.src,
      from: s.from,
      toX: left + col * SMALL_ICON + SMALL_ICON / 2,
      toY: y,
      toW: SMALL_ICON,
      main: false,
    })
  })
  return out
}

function setClonesAt(
  targets: ReturnType<typeof layoutFlyTargets>,
  phase: 'from' | 'to',
) {
  clones.value = targets.map((t) => {
    const x = phase === 'from' ? t.from.x : t.toX
    const y = phase === 'from' ? t.from.y : t.toY
    const w = phase === 'from' ? Math.max(36, LARGE_ICON * t.from.scale) : t.toW
    return {
      src: t.src,
      main: t.main,
      shine: false,
      style: {
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${w}px`,
        marginLeft: `${-w / 2}px`,
        marginTop: `${-w / 2}px`,
        transition:
          phase === 'to'
            ? `left ${FLY_MS}ms ease-out, top ${FLY_MS}ms ease-out, width ${FLY_MS}ms ease-out, height ${FLY_MS}ms ease-out, margin-left ${FLY_MS}ms ease-out, margin-top ${FLY_MS}ms ease-out, opacity 400ms ease`
            : 'none',
        opacity: '1',
      },
    }
  })
}

function setAmountCenter(text: string) {
  amountAtTop.value = false
  amountFlying.value = false
  amountLeft.value = null
  amountY.value = AMOUNT_CENTER_Y
  amountScale.value = AMOUNT_CENTER_SCALE
  amountScaleY.value = 1
  amountText.value = text
  amountVisible.value = true
}

/** 官方 setPayoutAmountTextTop：字图 left=220 y=44 sc=0.2 */
function setAmountTop(text: string) {
  const t = text || '0'
  amountAtTop.value = true
  amountFlying.value = false
  amountText.value = t
  amountScale.value = AMOUNT_TOP_SCALE
  const w = measureBcbmWinTextWidth(t, AMOUNT_TOP_SCALE)
  amountLeft.value = AMOUNT_TOP_LEFT + w / 2
  amountY.value = AMOUNT_TOP_Y
  amountVisible.value = true
}

/** 官方 payoutAmountFlashArmature text_appear（ADD） */
async function playAmountTextAppear() {
  const x =
    amountAtTop.value && amountLeft.value != null
      ? amountLeft.value
      : STAGE_W / 2
  const y = amountAtTop.value ? AMOUNT_TOP_Y : AMOUNT_CENTER_Y
  await playBcbmDbArmature({
    layerKey: 'payout',
    packId: 'number',
    animation: 'text_appear',
    playTimes: 1,
    x,
    y,
    scale: amountScale.value,
    stageW: STAGE_W,
    stageH: 640,
    slotKey: 'amountFlash',
  })
}


/**
 * 官方 ShowAmount：中心从 0 滚到总奖金，再飞到左上余额旁变成「+金额」。
 * 滚分时长对齐官网：Lv≤1 瞬间；Lv2=2s；Lv≥3=min(14s, 2s+倍率公式)
 */
async function showAmountWithCount(
  payout: number,
  payoutLevel: number,
  totalBet = 0,
) {
  const target = Math.max(0, Math.round(payout))
  const finalText = formatBcbmWinAmount(target)
  const countMs = bcbmCountDurationMs(payout, totalBet, payoutLevel)

  if (countMs <= 0) {
    setAmountCenter(finalText)
    await sleep(120)
    return 0
  }

  setAmountCenter(formatBcbmWinAmount(0))
  await sleep(80)

  await new Promise<void>((resolve) => {
    const t0 = performance.now()
    let lastShown = -1
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / countMs)
      const eased = 1 - Math.pow(1 - p, 2)
      const cur = Math.round(target * eased)
      if (cur !== lastShown) {
        lastShown = cur
        amountText.value = formatBcbmWinAmount(cur)
      }
      if (p < 1) {
        amountRaf = requestAnimationFrame(tick)
      } else {
        amountText.value = finalText
        amountRaf = 0
        resolve()
      }
    }
    amountRaf = requestAnimationFrame(tick)
  })
  await sleep(280)
  return countMs
}

/**
 * 中心金额飞到左上余额旁，变成「+多少」
 */
async function flashAmountToTop() {
  if (!amountVisible.value) return
  const text = amountText.value || formatBcbmWinAmount(0)
  // 官方：scaleY→0(200)+text_appear+flash → setTop scaleY=0 → scaleY→0.2(200)+text_appear
  playBcbmFlash()
  void playAmountTextAppear()
  amountScaleY.value = 1
  await nextTick()
  amountScaleY.value = 0
  await sleep(200)

  setAmountTop(text)
  amountScaleY.value = 0
  await nextTick()
  await waitFrames(2)
  void playAmountTextAppear()
  amountScaleY.value = 1
  await sleep(200)
  await sleep(AMOUNT_TOP_HOLD_MS)
}

function waitFrames(n = 2) {
  return new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => step(left - 1))
    }
    step(n)
  })
}

async function playPayout(opts: PayoutOpts) {
  if (running) await running
  running = (async () => {
    clearTimers()
    resetLayers()

    const { kind, payout, payoutLevel } = opts
    const totalBet = opts.totalBet ?? 0
    const targets = layoutFlyTargets(opts.clones)
    const hasBonus = !!kind

    // —— reward_1_start：四层圈 + 四角青色括号框；无侧雷、无 glow ——
    payoutArmOn.value = true
    payoutAnim.value = 'reward1'
    showCorners.value = true
    showSideThunder.value = false
    showGlow.value = false
    void playPayoutDb('reward_1_start', 1)

    setClonesAt(targets, 'from')
    await nextTick()
    await waitFrames(2)
    setClonesAt(targets, 'to')
    await sleep(Math.max(REWARD1_MS, FLY_MS + 120))

    // —— reward_2：DB 自带侧雷；CSS 侧雷仅兜底 ——
    if (hasBonus) {
      payoutAnim.value = 'reward2'
      const db2 = await playPayoutDb('reward_2_text_appear', 1)
      showSideThunder.value = !db2
      showGlow.value = !db2
      if (db2) void playPayoutDb('reward_2_text_appear_loop', 0)
      // 彩纸仅 PrizeLv4（HIT：PrizeLv3 || PrizeLv4 && paper → 仅 Lv4）
      bannerSrc.value = BANNER[kind!]
      bannerPop.value = true
      playBcbmBonusAnnounce(opts.awardType || kind!)
      await sleep(220)
      bannerPop.value = false
      await sleep(REWARD2_MS - 220)
      bannerSrc.value = ''
    }

    if (targets.length > 7) {
      clones.value = clones.value.map((c) =>
        c.main ? c : { ...c, style: { ...c.style, opacity: '0' } },
      )
    }

    // 官方：特奖且 totalBonus==0 → Bonus 后直接 End（跳过 ShowAmount）
    if (hasBonus && payout <= 0) {
      payoutAnim.value = 'reward4'
      showCorners.value = false
      showSideThunder.value = false
      showGlow.value = false
      endBcbmPayout(true)
      void playPayoutDb('reward_4_end')
      await sleep(REWARD4_MS)
      clones.value = []
      payoutArmOn.value = false
      payoutAnim.value = ''
      useDbPayout.value = false
      void stopBcbmDbLayer('payout')
      clearTimers()
      speedTickId = 0
      return
    }

    // —— ShowAmount：reward_3 loop + 滚分；Lv≥3 立刻叠 PrizeLv（与滚分并行）——
    // 正版：timeline AND(armature×a, Delay(r+1000))；入口末尾立刻 onPayoutStepCompleted→PrizeLv
    payoutAnim.value = 'reward3'
    showCorners.value = true
    const countMs =
      payout > 0 ? bcbmCountDurationMs(payout, totalBet, payoutLevel) : 0
    const reward3Times =
      payoutLevel <= 1 ? 1 : payoutLevel === 2 ? 2 : Math.ceil(countMs / 2000) + 1
    const reward3Ms = reward3Times * 2083
    const showAmountHoldMs =
      payoutLevel >= 3 ? Math.max(reward3Ms, countMs + 1000) : Math.max(reward3Ms, countMs)
    const dbOk = await playPayoutDb(
      'reward_3_bg_loop_duplication1',
      reward3Times,
    )
    // 仅 DB 失败时才用 CSS 侧雷/glow 兜底（侧雷是 common 内建，不是环绕电弧）
    showSideThunder.value = !dbOk
    showGlow.value = !dbOk
    playBcbmCounting(payoutLevel)

    // 官方：2<level 时 ShowAmount 一开始就进 PrizeLv；Lv3 无彩纸（|| && 短路）
    // PrizeLv：amountShinePs + amountDotPs（蓝光粒子）+ randomPlayThunder×3
    if (payoutLevel >= 3) {
      playBcbmPrizeLv(payoutLevel, hasBonus)
      await startBcbmAmountGlow({
        layerKey: 'amountGlow',
        x: STAGE_W / 2,
        // 正版粒子 y=460（金额中心 400 下方 60px），勿再抬高
        y: AMOUNT_CENTER_Y + 60,
        stageW: STAGE_W,
        stageH: 640,
      })
      startPrizeThunder()
      if (payoutLevel >= 4) {
        // 紫底在 payoutGroup；彩纸 GravityPS 在 betBoard+1
        showPaperBg.value = true
        void startBcbmRewardPaper({
          layerKey: 'paper',
          stageW: STAGE_W,
          stageH: 820,
        })
      }
    }

    if (payout > 0) {
      showGlow.value = false
      // 正版：滚分一结束就 stop counting + counting_end（不是等 Jump）
      await Promise.all([
        showAmountWithCount(payout, payoutLevel, totalBet).then(() => {
          endBcbmCounting()
        }),
        sleep(showAmountHoldMs),
      ])
      // 官方：进 JumpAmount 前 clearAllPrizeElement（含彩纸/紫底）
      stopPrizeLvFx()

      // —— JumpAmount：正版一进 Jump 就 fadeout/bonus_end，再 reward_4 + 飞顶 ——
      payoutAnim.value = 'reward4'
      showCorners.value = false
      showSideThunder.value = false
      showGlow.value = false
      endBcbmPayout(hasBonus)
      void playPayoutDb('reward_4_end')
      const jump = flashAmountToTop()
      await Promise.all([sleep(REWARD4_MS), jump])
    } else {
      endBcbmCounting()
      stopPrizeLvFx()
      payoutAnim.value = 'reward4'
      showCorners.value = false
      showSideThunder.value = false
      showGlow.value = false
      endBcbmPayout(hasBonus)
      playBcbmFlash()
      void playPayoutDb('reward_4_end')
      await sleep(REWARD4_MS)
    }
    stopPrizeLvFx()
    // 官方 Jump 后金额仍留在顶部，等押格 shine/rise/Idle 再清（由 View hideAmount）
    clones.value = clones.value.map((c) =>
      c.main
        ? { ...c, style: { ...c.style, opacity: '0' } }
        : { ...c, style: { ...c.style, opacity: '0' } },
    )
    payoutArmOn.value = false
    payoutAnim.value = ''
    showCorners.value = false
    showSideThunder.value = false
    showGlow.value = false
    useDbPayout.value = false
    // 保留 amountFlash / 字图；清 common armature
    void stopBcbmDbSlot('payout', 'payoutCommon')
    clearTimers()
    speedTickId = 0
  })()
  await running
  running = null
}

onMounted(() => {
  void preloadBcbmDragonBones()
})

onBeforeUnmount(() => {
  destroyBcbmDragonBones()
})

/**
 * 官方 SmallPrize：cloneIcons（主 clone ADD α0.2）+ 顶栏字图 + text_appear。
 * ding / getIconShineTask 由 shineMainClone + View 编排。
 */
async function playWin(opts: {
  payout: number
  clones?: Array<{ src: string; x: number; y: number; scale: number }>
}) {
  const { payout, clones: cloneSrcs = [] } = opts
  if (payout <= 0) return
  if (running) await running
  running = (async () => {
    if (cloneSrcs.length) {
      const main = cloneSrcs[0]!
      const w = Math.max(36, LARGE_ICON * main.scale)
      clones.value = [
        {
          src: main.src,
          main: true,
          shine: false,
          style: {
            left: `${main.x}px`,
            top: `${main.y}px`,
            width: `${w}px`,
            height: `${w}px`,
            marginLeft: `${-w / 2}px`,
            marginTop: `${-w / 2}px`,
            opacity: '0.2',
            mixBlendMode: 'plus-lighter',
            transition: 'none',
          },
        },
      ]
    }
    const target = formatBcbmWinAmount(payout)
    setAmountTop(target)
    amountScaleY.value = 0
    await nextTick()
    await waitFrames(2)
    void playAmountTextAppear()
    amountScaleY.value = 1
    await sleep(220)
  })()
  await running
  running = null
}

/** 官方 getIconShineTask(4)：主 clone α 0.2→1，200ms ×4 ping-pong ≈800ms */
async function shineMainClone() {
  if (!clones.value.length) return
  clones.value = clones.value.map((c) =>
    c.main
      ? {
          ...c,
          shine: true,
          style: {
            ...c.style,
            opacity: '1',
            mixBlendMode: 'plus-lighter',
          },
        }
      : c,
  )
  await sleep(800)
  clones.value = clones.value.map((c) =>
    c.main
      ? {
          ...c,
          shine: false,
          style: { ...c.style, opacity: '0' },
        }
      : c,
  )
}

function hideAmount() {
  amountVisible.value = false
  amountAtTop.value = false
  amountFlying.value = false
  amountScaleY.value = 1
  clones.value = []
  void stopBcbmDbSlot('payout', 'amountFlash')
}

onBeforeUnmount(stop)

defineExpose({
  startSpeedWeak,
  startSpeedStrong,
  stopSpeed,
  playPayout,
  hideAmount,
  playWin,
  shineMainClone,
  stop,
})
</script>

<style scoped src="../games/bcbm/bcbm-fx-overlay.css"></style>
