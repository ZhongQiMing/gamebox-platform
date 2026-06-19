<template>
  <div 
    class="mahjong-tile" 
    :class="{ 
      'is-golden': isGolden, 
      'is-exploding': isExploding,
      'is-icon-tile': usesIconOverlay,
    }"
  >
    <!-- 108 源：百搭/胡 仅为图标，用 CSS 牌底（避免 blank-mahjong-tile.png 缺失导致破图） -->
    <div
      v-if="usesIconOverlay"
      class="tile-base"
      :class="{ 'tile-base--golden': isGolden }"
      aria-hidden="true"
    />
    <img 
      :src="`${assetBase}/${symbol}.png`" 
      class="symbol-img"
      :class="{ 'symbol-img--overlay': usesIconOverlay }"
      draggable="false"
      alt=""
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps({
  symbol: { type: String, required: true },
  isGolden: { type: Boolean, default: false },
  isExploding: { type: Boolean, default: false },
  assetBase: { type: String, default: '/images/games/mahjong/classic/symbols' }
})

const assetBase = computed(() =>
  props.isGolden
    ? props.assetBase.replace('/symbols', '/symbols-golden')
    : props.assetBase,
)

const usesIconOverlay = computed(() => props.symbol === 'wild' || props.symbol === 'hu')
</script>

<style scoped>
.mahjong-tile {
  width: 100%;
  height: 100%;
  position: relative;
  display: block;
  line-height: 0;
}

.symbol-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-position: center;
  pointer-events: none;
  object-fit: cover;
}

.tile-base {
  position: absolute;
  inset: 0;
  border-radius: 10%;
  background: linear-gradient(165deg, #faf6ee 0%, #ece3d4 45%, #ddd2c0 100%);
  box-shadow:
    inset 0 2px 0 rgba(255, 255, 255, 0.75),
    inset 0 -2px 4px rgba(0, 0, 0, 0.08),
    0 2px 5px rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(180, 150, 100, 0.45);
}

.tile-base--golden {
  background: linear-gradient(165deg, #fff4c8 0%, #e8c860 40%, #c89828 100%);
  border-color: rgba(255, 220, 120, 0.65);
  box-shadow:
    inset 0 2px 0 rgba(255, 248, 200, 0.8),
    inset 0 -2px 4px rgba(80, 50, 0, 0.15),
    0 2px 6px rgba(0, 0, 0, 0.28);
}

.symbol-img--overlay {
  object-fit: contain;
  padding: 4%;
}

.is-exploding {
  animation: explode 0.4s ease-out forwards;
}

@keyframes explode {
  0% { transform: scale(1); opacity: 1; filter: brightness(1); }
  50% { transform: scale(1.15); opacity: 0.85; filter: brightness(1.8); }
  100% { transform: scale(0); opacity: 0; filter: brightness(2.5); }
}
</style>
