<template>
  <div id="footer-container" class="footer-container">
    <div class="footer-mask-container-port">
      <div class="footer-mask footer-mask-color" :style="maskColorStyle" />
      <div class="footer-mask footer-mask-black" />
    </div>
    <p class="footer-copyright-text" :style="copyrightStyle">
      PGSOFT.COM 2025 © PG SOFT® 版权所有
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { calcPgScreenMetrics, PG_SCREEN_H } from '@/games/pg-common/pgScreenScale'
import { PG_THEME_COLOR, usePgFooterTheme } from './pgFooterTheme'

/** 正版版权：designH=640 贴近底边；H≈779 时视觉底边≈35.64（随壳层增高上移） */
const COPYRIGHT_BOTTOM_AT_640 = 8
const COPYRIGHT_BOTTOM_AT_779 = 35.64
const COPYRIGHT_BOTTOM_SLOPE =
  (COPYRIGHT_BOTTOM_AT_779 - COPYRIGHT_BOTTOM_AT_640) / (779 - 640)

const props = defineProps({
  themeColor: {
    type: String,
    default: PG_THEME_COLOR,
  },
})

const { maskColorStyle } = usePgFooterTheme(() => props.themeColor)

const screenHeight = ref(calcPgScreenMetrics(true).height)

const copyrightStyle = computed(() => {
  const extra = Math.max(0, screenHeight.value - PG_SCREEN_H)
  return {
    bottom: `${(COPYRIGHT_BOTTOM_AT_640 + extra * COPYRIGHT_BOTTOM_SLOPE).toFixed(2)}px`,
  }
})

function onResize() {
  screenHeight.value = calcPgScreenMetrics(true).height
}

onMounted(() => {
  onResize()
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
})
</script>

<style scoped>
/* 正版 shell #footer-container：只有 CSS 渐变 + 生成文字，不铺底图 */
.footer-container {
  display: flex;
  /* 正版 #footer-container / .footer-image-container 高度约 229，版权在此层内上浮 */
  height: 229px;
  bottom: 0;
  position: absolute;
  width: 100%;
  left: 0;
  pointer-events: none;
  /* 盖住封面底图，但低于开始钮/进度条（safe_area z=2）与 logo（z=3） */
  z-index: 1;
}

.footer-mask-container-port {
  display: flex;
  flex-direction: column;
  height: 229px;
  bottom: 0;
  position: absolute;
  width: 100%;
  left: 0;
}

.footer-mask {
  height: 100%;
  position: absolute;
  width: 100%;
}

.footer-mask-black {
  background-image: linear-gradient(180deg, rgba(0, 0, 0, 0.03), #000);
}

.footer-copyright-text {
  position: absolute;
  left: 0;
  width: 100%;
  margin: 0;
  padding: 0;
  color: rgba(255, 255, 255, 0.78);
  font-size: 8px;
  line-height: 1.2;
  text-align: center;
  white-space: nowrap;
  z-index: 1;
  pointer-events: none;
}
</style>
