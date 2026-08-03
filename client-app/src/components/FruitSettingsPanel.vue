<template>
  <Teleport to="body">
    <div class="fruit-set-mask" @click.self="emit('close')" />
    <div class="fruit-set-sheet" role="dialog" aria-modal="true" aria-labelledby="fruit-set-title">
      <header class="fruit-set-head">
        <h3 id="fruit-set-title">设置</h3>
        <button type="button" class="fruit-set-close" aria-label="关闭" @click="emit('close')">
          &times;
        </button>
      </header>

      <div class="fruit-set-body">
        <div class="fruit-set-row">
          <span class="fruit-set-label">背景音乐</span>
          <button
            type="button"
            class="fruit-set-switch"
            :class="{ 'is-on': bgmOn }"
            role="switch"
            :aria-checked="bgmOn"
            aria-label="背景音乐"
            @click.stop="toggleBgm"
          />
        </div>
        <div class="fruit-set-row">
          <span class="fruit-set-label">游戏音效</span>
          <button
            type="button"
            class="fruit-set-switch"
            :class="{ 'is-on': sfxOn }"
            role="switch"
            :aria-checked="sfxOn"
            aria-label="游戏音效"
            @click.stop="toggleSfx"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  isFruitBgmMuted,
  isFruitSfxMuted,
  setFruitBgmMuted,
  setFruitSfxMuted,
  startFruitBgm,
  unlockFruitAudio,
  playFruitSfx,
} from '@/games/slots/fruitAudio'

const emit = defineEmits<{
  close: []
}>()

const bgmOn = ref(true)
const sfxOn = ref(true)

onMounted(() => {
  bgmOn.value = !isFruitBgmMuted()
  sfxOn.value = !isFruitSfxMuted()
})

function toggleBgm() {
  unlockFruitAudio()
  setFruitBgmMuted(bgmOn.value)
  bgmOn.value = !isFruitBgmMuted()
  if (bgmOn.value) startFruitBgm()
  if (sfxOn.value) playFruitSfx('click', 0.45)
}

function toggleSfx() {
  unlockFruitAudio()
  setFruitSfxMuted(sfxOn.value)
  sfxOn.value = !isFruitSfxMuted()
  if (sfxOn.value) playFruitSfx('click', 0.45)
}
</script>

<style scoped>
.fruit-set-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(2px);
}

.fruit-set-sheet {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 1001;
  width: min(92vw, 460px);
  max-height: min(80vh, 620px);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(212, 175, 55, 0.5);
  border-radius: 14px;
  background: linear-gradient(180deg, #1c150d 0%, #120d08 100%);
  box-shadow:
    0 18px 50px rgba(0, 0, 0, 0.65),
    inset 0 1px 0 rgba(255, 226, 150, 0.14);
  color: #f5e6c8;
  overflow: hidden;
  pointer-events: auto;
}

.fruit-set-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(212, 175, 55, 0.28);
  background: linear-gradient(180deg, rgba(58, 44, 22, 0.6), rgba(30, 22, 12, 0.2));
}

.fruit-set-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
  font-family: 'Noto Serif SC', 'Songti SC', serif;
  color: #f2d98a;
}

.fruit-set-close {
  width: 30px;
  height: 30px;
  border: 1px solid rgba(212, 175, 55, 0.4);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #f2d98a;
  font-size: 20px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  transition: transform 0.14s, filter 0.14s;
  -webkit-tap-highlight-color: transparent;
}

.fruit-set-close:active {
  transform: scale(0.9);
  filter: brightness(1.2);
}

.fruit-set-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 18px 18px;
  -webkit-overflow-scrolling: touch;
}

.fruit-set-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 4px;
  border-bottom: 1px solid rgba(212, 175, 55, 0.16);
  pointer-events: auto;
}

.fruit-set-label {
  font-size: 15px;
  color: #e8d9b0;
  letter-spacing: 1px;
}

.fruit-set-switch {
  position: relative;
  width: 50px;
  height: 28px;
  border-radius: 999px;
  border: none;
  padding: 0;
  background: rgba(120, 100, 60, 0.4);
  cursor: pointer;
  transition: background 0.2s ease;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
  pointer-events: auto;
  touch-action: manipulation;
}

.fruit-set-switch::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #f4ead0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  transition: transform 0.2s ease;
  pointer-events: none;
}

.fruit-set-switch.is-on {
  background: linear-gradient(90deg, #b8862a, #e8c76a);
}

.fruit-set-switch.is-on::after {
  transform: translateX(22px);
}
</style>
