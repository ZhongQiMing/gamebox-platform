<template>
  <!--
    官方 MenuPopupSkin：440×360
    内框 Group width=410 top=71 bottom=106；标签≈x76、开关≈x267
  -->
  <div class="set-root" @click.self="emit('close')">
    <div class="set-panel">
      <img class="border" :src="BORDER" alt="" draggable="false" />

      <button type="button" class="close" aria-label="关闭" @click="emit('close')">
        <img :src="CLOSE" alt="" draggable="false" />
      </button>

      <h2 class="title">设置</h2>

      <div class="inner">
        <img class="inner-border" :src="BORDER2" alt="" draggable="false" />
        <div class="body">
          <div class="row">
            <span class="label">音乐</span>
            <button
              type="button"
              class="switch"
              :class="{ on: bgmOn }"
              role="switch"
              :aria-checked="bgmOn"
              aria-label="音乐"
              @click="toggleBgm"
            >
              <span class="knob" />
            </button>
          </div>
          <div class="row">
            <span class="label">音效</span>
            <button
              type="button"
              class="switch"
              :class="{ on: sfxOn }"
              role="switch"
              :aria-checked="sfxOn"
              aria-label="音效"
              @click="toggleSfx"
            >
              <span class="knob" />
            </button>
          </div>
        </div>
      </div>

      <button type="button" class="ok" @click="emit('close')">
        <img class="ok-bg" :src="OK_BG" alt="" draggable="false" />
        <img class="ok-txt" :src="OK_TXT" alt="确定" draggable="false" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  isBcbmBgmMuted,
  isBcbmSfxMuted,
  setBcbmBgmMuted,
  setBcbmSfxMuted,
  startBcbmBgm,
} from '@/games/bcbm/bcbmAudio'

const emit = defineEmits<{
  close: []
  'update:sound': [on: boolean]
}>()

const BORDER = '/images/games/bcbm/benz/main/yben_ui_geniric_border.webp'
const BORDER2 = '/images/games/bcbm/benz/main/yben_ui_geniric_border2.webp'
const CLOSE = '/images/games/bcbm/benz/rules/yben_msc_btn_close.webp'
const OK_BG = '/images/games/bcbm/benz/main/yben_btn_geniric_blue.webp'
const OK_TXT = '/images/games/bcbm/benz/txt/yben_txt_confirm_hans.webp'

const bgmOn = ref(true)
const sfxOn = ref(true)

onMounted(() => {
  bgmOn.value = !isBcbmBgmMuted()
  sfxOn.value = !isBcbmSfxMuted()
})

function toggleBgm() {
  bgmOn.value = !bgmOn.value
  setBcbmBgmMuted(!bgmOn.value)
  if (bgmOn.value) startBcbmBgm()
  emit('update:sound', bgmOn.value || sfxOn.value)
}

function toggleSfx() {
  sfxOn.value = !sfxOn.value
  setBcbmSfxMuted(!sfxOn.value)
  emit('update:sound', bgmOn.value || sfxOn.value)
}
</script>

<style scoped>
.set-root {
  position: absolute;
  inset: 0;
  z-index: 42;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
.set-panel {
  position: relative;
  width: 440px;
  height: 360px;
  color: #fff;
}
.border {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  mix-blend-mode: screen;
}
/* 落在外框右上角内侧（整颗按钮在霓虹框内） */
.close {
  position: absolute;
  top: 32px;
  right: 32px;
  z-index: 5;
  width: 36px;
  height: 36px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.close img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.title {
  position: relative;
  z-index: 1;
  margin: 0;
  padding-top: 27px;
  text-align: center;
  font-size: 22px;
  font-weight: 700;
  color: #7ad7ff;
  letter-spacing: 2px;
  text-shadow: 0 0 10px rgba(80, 200, 255, 0.45);
}
/* 官方：width=410，左右各 15；top=71 bottom=106 */
.inner {
  position: absolute;
  left: 15px;
  right: 15px;
  top: 71px;
  bottom: 106px;
  z-index: 1;
}
.inner-border {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  mix-blend-mode: screen;
  opacity: 0.9;
}
/*
 * 官方标签 x≈76、开关 x≈267（相对内框 410）
 * 左右各约 76，避免贴边拉伸
 */
.body {
  position: relative;
  z-index: 1;
  height: 100%;
  box-sizing: border-box;
  padding: 0 72px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 28px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
}
.label {
  font-size: 18px;
  color: #cfe9ff;
  letter-spacing: 2px;
}
.switch {
  position: relative;
  width: 66px;
  height: 34px;
  border: 0;
  border-radius: 17px;
  padding: 0;
  background: #3a4a5c;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.18s ease;
}
.switch.on {
  background: #3db06d;
}
.switch .knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  transition: transform 0.18s ease;
}
.switch.on .knob {
  transform: translateX(32px);
}
.ok {
  position: absolute;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 2;
  width: 160px;
  height: 52px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.ok-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  mix-blend-mode: screen;
}
.ok-txt {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  height: 28px;
  width: auto;
  object-fit: contain;
  pointer-events: none;
}
</style>
