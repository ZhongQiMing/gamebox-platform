<template>
  <span v-if="!nums.length" class="dn-empty">—</span>

  <span v-else-if="kind === 'pk10'" class="dn">
    <img
      v-for="(n, i) in nums"
      :key="`lane-${i}`"
      class="dn-img dn-lane"
      :src="pk10BallUrl(lobbyKey, n)"
      :alt="n"
      draggable="false"
    >
  </span>

  <span v-else-if="kind === 'dice3'" class="dn">
    <img
      v-for="(n, i) in nums"
      :key="`dice-${i}`"
      class="dn-img dn-dice"
      :src="kuai3DiceUrl(n)"
      :alt="n"
      draggable="false"
    >
  </span>

  <span v-else-if="kind === 'lhc'" class="dn">
    <template v-for="(n, i) in lhcFootNums(nums)" :key="`lhc-${i}`">
      <span v-if="n === '+'" class="dn-sep">+</span>
      <img v-else class="dn-img dn-lhc" :src="lhcBallUrl(n)" :alt="n" draggable="false">
    </template>
  </span>

  <span v-else-if="kind === 'digit5'" class="dn">
    <span v-for="(n, i) in nums" :key="`ssc-${i}`" class="dn-ball">{{ n }}</span>
  </span>

  <span v-else-if="kind === 'fruit'" class="dn dn-icon-row">
    <img v-if="fruitIcon" class="dn-img dn-fruit" :src="fruitIcon" :alt="fruitText" draggable="false">
    <span class="dn-caption">{{ fruitText }}</span>
  </span>

  <span v-else-if="kind === 'bcbm'" class="dn dn-icon-row">
    <img v-if="bcbmIcon" class="dn-img dn-car" :src="bcbmIcon" :alt="bcbmText" draggable="false">
    <span class="dn-caption">{{ bcbmText }}</span>
  </span>

  <span v-else-if="kind === 'table'" class="dn">
    <template v-for="(n, i) in tableBeads" :key="`tb-${i}`">
      <span v-if="n.bead" class="dn-bead" :class="n.bead.tone">{{ n.bead.text }}</span>
      <span v-else class="dn-caption">{{ n.raw }}</span>
    </template>
  </span>

  <span v-else class="dn">
    <span v-for="(n, i) in nums" :key="`t-${i}`" class="dn-caption">{{ n }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  bcbmDrawIconPath,
  bcbmDrawLabel,
  fruitDrawIconPath,
  fruitDrawLabel,
  parseDrawTokens,
  tableDrawBead,
} from '@gamebox/shared'
import {
  drawKindOf,
  kuai3DiceUrl,
  lhcBallUrl,
  lhcFootNums,
  lobbyDrawKey,
  pk10BallUrl,
} from '@/utils/drawNumberAssets'

const props = defineProps<{
  gameCode: string
  draw?: string | null
}>()

const lobbyKey = computed(() => lobbyDrawKey(props.gameCode))
const kind = computed(() => drawKindOf(props.gameCode))
const nums = computed(() => parseDrawTokens(props.draw))

const fruitIcon = computed(() => fruitDrawIconPath(nums.value[0] || ''))
const fruitText = computed(() => {
  const [head, ...rest] = nums.value
  const label = fruitDrawLabel(head || '')
  return [label || head, ...rest].filter(Boolean).join(' · ')
})

const bcbmIcon = computed(() => bcbmDrawIconPath(nums.value[0] || ''))
const bcbmText = computed(() => {
  const [head, ...rest] = nums.value
  const label = bcbmDrawLabel(head || '')
  return [label || head, ...rest].filter(Boolean).join(' · ')
})

const tableBeads = computed(() =>
  nums.value.map((raw) => ({ raw, bead: tableDrawBead(raw) })),
)
</script>

<style scoped>
.dn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
  max-width: 100%;
}
.dn-icon-row { gap: 6px; }
.dn-empty { color: #94a3b8; }

.dn-img {
  display: block;
  object-fit: contain;
  flex-shrink: 0;
  user-select: none;
}
.dn-lane,
.dn-dice,
.dn-lhc { width: 24px; height: 24px; }
.dn-fruit { width: 28px; height: 28px; }
.dn-car { width: 30px; height: 30px; }

.dn-sep {
  font-size: 13px;
  font-weight: 700;
  color: #b45309;
  padding: 0 1px;
}

/* 与游戏内 .ssc-ball-digit / 大厅 .gc-ssc-ball 同一配方 */
.dn-ball {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(160deg, #fff5c8 0%, #f0c848 38%, #c99820 72%, #8a6f1f 100%);
  color: #1a1408;
  font-weight: 700;
  font-size: 12px;
  font-variant-numeric: tabular-nums lining-nums;
  line-height: 1;
  box-shadow:
    0 0 0 1px rgba(212, 175, 55, 0.35),
    0 2px 6px rgba(0, 0, 0, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.45);
}

.dn-caption {
  font-size: 12px;
  font-weight: 650;
  color: #334155;
  line-height: 1.2;
}

.dn-bead {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}
.dn-bead.banker,
.dn-bead.dragon { background: linear-gradient(160deg, #f87171, #b91c1c); }
.dn-bead.player { background: linear-gradient(160deg, #60a5fa, #1d4ed8); }
.dn-bead.tiger { background: linear-gradient(160deg, #fbbf24, #b45309); }
.dn-bead.tie { background: linear-gradient(160deg, #4ade80, #15803d); }
</style>
