<template>
  <div class="games-list">
    <div
      v-for="g in visibleGames"
      :key="g.key"
      class="game-card"
      :class="{ 'is-maint': isMaintenance(g), 'is-entering': enteringKey === g.key }"
      :data-game="g.key"
      @click="onClick(g)"
    >
      <div v-if="isMaintenance(g)" class="gc-tag gc-tag--maint">维 护</div>
      <div v-else-if="g.tag" class="gc-tag">{{ g.tag }}</div>

      <div class="gc-main">
        <div class="gc-icon">
          <img v-if="g.iconImg" :src="g.iconImg" alt="">
        </div>

        <div class="gc-name">{{ g.name }}</div>

        <div class="gc-status">
          <div
            v-if="g.type === 'lottery' || g.type === 'table'"
            class="gc-issue"
            :title="cardState[g.key]?.issueFull || undefined"
          >
            第 <span class="gc-issue-no">{{ cardState[g.key]?.issue ?? '—' }}</span>
            {{ g.type === 'table' ? '局' : '期' }}
          </div>
          <div
            :class="[
              'gc-countdown',
              isMaintenance(g) ? 'is-freeze' : cardState[g.key]?.cdClass,
            ]"
          >
            {{
              enteringKey === g.key
                ? '进入中…'
                : isMaintenance(g)
                  ? '维护中'
                  : (cardState[g.key]?.cdText ?? (g.type === 'instant' ? '实时进行' : '--:--'))
            }}
          </div>
        </div>
      </div>

      <div v-if="g.type === 'lottery' || g.type === 'table'" class="gc-foot">
        <div
          class="gc-foot-issue"
          :title="cardState[g.key]?.prevIssueFull || undefined"
        >
          <span class="gc-foot-issue-no">{{ cardState[g.key]?.prevIssue ?? '— —' }}</span>
          {{ g.type === 'table' ? '局' : '期' }}
        </div>
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
</template>

<script setup lang="ts">
import { toRef } from 'vue'
import { useGameLobbyCards, type LobbyGame } from '@/composables/useGameLobbyCards'

const props = defineProps<{
  /** 房间已开启游戏 code；不传则仅按平台目录（玩家端） */
  enabledCodes?: string[] | null
  enteringKey?: string
}>()

const emit = defineEmits<{
  select: [game: LobbyGame]
}>()

const {
  visibleGames,
  cardState,
  isMaintenance,
  isPlatformOnline,
  isPk10Game,
  isDice3Game,
  isDigit5Game,
  isLhcGame,
  pk10BallUrl,
  kuai3DiceUrl,
  lhcBallUrl,
  lhcFootNums,
  numClass,
  refreshAll,
} = useGameLobbyCards({
  enabledCodes: toRef(props, 'enabledCodes'),
})

function onClick(g: LobbyGame) {
  emit('select', g)
}

defineExpose({ refreshAll, visibleGames, isMaintenance, isPlatformOnline })
</script>
