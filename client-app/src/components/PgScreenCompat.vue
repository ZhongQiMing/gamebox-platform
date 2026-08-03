<template>
  <div
    class="pg-screen-root"
    :class="{
      'pg-screen-root--center': centerVertically,
      'pg-screen-root--transparent': backdropTransparent,
    }"
    :style="rootStyle"
  >
    <div class="pg-screen-stage" :style="stageStyle">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import {
  calcPgScreenMetrics,
  type PgScreenMetrics,
} from '@/games/pg-common/pgScreenScale'

const props = defineProps({
  zIndex: {
    type: Number,
    default: 9998,
  },
  centerVertically: {
    type: Boolean,
    default: true,
  },
  backdropTransparent: {
    type: Boolean,
    default: false,
  },
  /** 正版 screen_compat：高度 640~780 自适应（麻将封面需要） */
  adaptiveHeight: {
    type: Boolean,
    default: false,
  },
})

const centerVertically = computed(() => props.centerVertically)
const backdropTransparent = computed(() => props.backdropTransparent)

const metrics = ref<PgScreenMetrics>(calcPgScreenMetrics(props.adaptiveHeight))

function updateMetrics() {
  metrics.value = calcPgScreenMetrics(props.adaptiveHeight)
}

watch(
  () => props.adaptiveHeight,
  () => updateMetrics(),
)

onMounted(() => {
  updateMetrics()
  window.addEventListener('resize', updateMetrics)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateMetrics)
})

provide('pgScreenMetrics', metrics)

const rootStyle = computed(() => ({
  zIndex: String(props.zIndex),
}))

const stageStyle = computed(() => ({
  width: `${metrics.value.width}px`,
  height: `${metrics.value.height}px`,
  transform: `scale(${metrics.value.scale.toFixed(5)})`,
}))
</script>

<style scoped>
.pg-screen-root {
  position: fixed;
  inset: 0;
  background: #000;
  overflow: hidden;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  touch-action: manipulation;
  font-family: 'PingFang SC', 'Microsoft YaHei', 'WenQuanYi Micro Hei', sans-serif;
}

.pg-screen-root--center {
  align-items: center;
}

.pg-screen-root--transparent {
  background: transparent;
}

.pg-screen-stage {
  position: relative;
  flex-shrink: 0;
  transform-origin: top center;
  overflow: hidden;
}

.pg-screen-root--center .pg-screen-stage {
  transform-origin: center center;
}
</style>
