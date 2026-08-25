<template>
  <span v-if="!nums.length" class="dn-empty">—</span>

  <span v-else-if="isPk10Game(lobbyKey)" class="dn dn--pk10">
    <img
      v-for="(n, i) in nums"
      :key="`lane-${i}`"
      class="dn-lane"
      :src="pk10BallUrl(lobbyKey, n)"
      :alt="n"
      draggable="false"
    >
  </span>

  <span v-else-if="isDice3Game(lobbyKey)" class="dn dn--dice">
    <img
      v-for="(n, i) in nums"
      :key="`dice-${i}`"
      class="dn-dice"
      :src="kuai3DiceUrl(n)"
      :alt="n"
      draggable="false"
    >
  </span>

  <span v-else-if="isLhcGame(lobbyKey)" class="dn dn--lhc">
    <template v-for="(n, i) in lhcFootNums(nums)" :key="`lhc-${i}`">
      <span v-if="n === '+'" class="dn-sep">+</span>
      <img v-else class="dn-lhc" :src="lhcBallUrl(n)" :alt="n" draggable="false">
    </template>
  </span>

  <span v-else-if="isDigit5Game(lobbyKey)" class="dn dn--ssc">
    <span v-for="(n, i) in nums" :key="`ssc-${i}`" class="dn-ball">{{ n }}</span>
  </span>

  <span v-else-if="isFruitGame(lobbyKey)" class="dn dn--icon">
    <img v-if="fruitIcon" class="dn-fruit" :src="fruitIcon" :alt="fruitText" draggable="false">
    <span class="dn-text">{{ fruitText }}</span>
  </span>

  <span v-else-if="isBcbmGame(lobbyKey)" class="dn dn--icon">
    <img v-if="bcbmIcon" class="dn-car" :src="bcbmIcon" :alt="bcbmText" draggable="false">
    <span class="dn-text">{{ bcbmText }}</span>
  </span>

  <span v-else-if="isTableGame(lobbyKey)" class="dn dn--table">
    <template v-for="(n, i) in tableBeads" :key="`tb-${i}`">
      <span v-if="n.bead" class="dn-bead" :class="n.bead.tone">{{ n.bead.text }}</span>
      <span v-else class="dn-text">{{ n.raw }}</span>
    </template>
  </span>

  <span v-else class="dn dn--text">
    <span v-for="(n, i) in nums" :key="`t-${i}`" class="dn-text">{{ n }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  bcbmDrawIconPath,
  bcbmDrawLabel,
  fruitDrawIconPath,
  fruitDrawLabel,
  tableDrawBead,
} from '@gamebox/shared'
import {
  isBcbmGame,
  isDice3Game,
  isDigit5Game,
  isFruitGame,
  isLhcGame,
  isPk10Game,
  isTableGame,
  pk10BallUrl,
  kuai3DiceUrl,
  lhcBallUrl,
  lhcFootNums,
} from '@/composables/drawNumberAssets'

/**
 * 开奖号码展示。玩家端大厅按游戏画赛道号 / 骰子 / 彩球，
 * 管理后台与员工端实时开奖共用同一套画法。
 */
const props = defineProps<{
  /** 服务端游戏代码（与大厅内部 key 偶有出入，下方映射） */
  gameCode: string
  /** 服务端下发的开奖串，形如「3  6  5  4  9」 */
  draw?: string | null
}>()

/** 后端代码 → 大厅内部 key（只有这两个对不上） */
const CODE_TO_LOBBY_KEY: Record<string, string> = {
  'dragon-tiger': 'longhu',
  'fruit-machine': 'slots',
}

const lobbyKey = computed(() => CODE_TO_LOBBY_KEY[props.gameCode] ?? props.gameCode)

const nums = computed(() => String(props.draw ?? '').trim().split(/\s+/).filter(Boolean))

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
  gap: 4px;
  flex-wrap: wrap;
}
.dn-empty { color: var(--text-muted); }

.dn-lane { width: 20px; height: 20px; object-fit: contain; }
.dn-dice { width: 20px; height: 20px; object-fit: contain; }
.dn-lhc { width: 20px; height: 20px; object-fit: contain; }
.dn-fruit { width: 22px; height: 22px; object-fit: contain; }
.dn-car { width: 24px; height: 24px; object-fit: contain; }
.dn-sep {
  font-size: 12px;
  font-weight: 700;
  color: var(--gold);
}

/* 与玩家端大厅 .gc-ssc-ball 同一配方，只是略小一号 */
.dn-ball {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: linear-gradient(160deg, #fff5c8 0%, #f0c848 38%, #c99820 72%, #8a6f1f 100%);
  color: #1a1408;
  font-weight: 700;
  font-size: 11px;
  font-variant-numeric: tabular-nums lining-nums;
  line-height: 1;
  box-shadow:
    0 0 0 1px rgba(212, 175, 55, 0.35),
    0 2px 6px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.45);
}

.dn-text {
  font-size: 12px;
  font-weight: 700;
  color: #fff4c2;
}

.dn-bead {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.dn-bead.banker,
.dn-bead.dragon { background: linear-gradient(160deg, #f87171, #b91c1c); }
.dn-bead.player { background: linear-gradient(160deg, #60a5fa, #1d4ed8); }
.dn-bead.tiger { background: linear-gradient(160deg, #fbbf24, #b45309); }
.dn-bead.tie { background: linear-gradient(160deg, #4ade80, #15803d); }
</style>
