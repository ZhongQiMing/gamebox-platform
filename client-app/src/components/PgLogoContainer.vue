<template>
  <div
    class="logo-container"
    :class="{ 'logo-container--official': officialLayout }"
    :style="{ bottom: props.bottom }"
  >
    <!-- 正版 DOM：先认证条再 logo + row-reverse → 视觉上 PG 左、认证右 -->
    <template v-if="officialLayout">
      <img
        v-if="certUrl"
        class="footer-text-img"
        :src="certUrl"
        alt=""
      />
      <PgFooterLogo />
    </template>
    <template v-else>
      <PgFooterLogo />
      <img
        v-if="certUrl"
        class="footer-text-img"
        :src="certUrl"
        alt=""
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import PgFooterLogo from './PgFooterLogo.vue'

/** certUrl：认证条图片（正版 download.png），由各游戏从自己的 manifest 传入 */
const props = withDefaults(
  defineProps<{
    bottom?: string
    certUrl?: string
    /** 正版壳层排布：row-reverse + left:12px */
    officialLayout?: boolean
  }>(),
  { bottom: '52px', officialLayout: false },
)
</script>

<style scoped>
.logo-container {
  align-items: center;
  display: flex;
  flex-direction: row;
  position: absolute;
  left: 0;
  right: 0;
  width: 100%;
  padding: 0 4px 0 12px;
  box-sizing: border-box;
  pointer-events: none;
  z-index: 3;
}

.logo-container--official {
  flex-direction: row-reverse;
  left: 12px;
  right: 0;
  width: auto;
  padding: 0;
}

.footer-text-img {
  display: block;
  height: 59px;
  width: auto;
  max-width: calc(100% - 80px);
  margin-left: auto;
  object-fit: contain;
  object-position: right center;
  transition: 0.2s;
}

.logo-container--official .footer-text-img {
  max-width: none;
  margin-left: 0;
}
</style>
