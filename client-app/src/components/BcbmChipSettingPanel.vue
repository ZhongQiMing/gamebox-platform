<template>
  <!--
    官方 ChipSettingSkin / createChipSettingPopup
    手机选 4 枚；筹码池固定为平台面额
  -->
  <Teleport defer to=".stage">
    <div class="chip-root" @click.self="emit('close')">
      <div class="chip-panel">
        <img class="border" :src="BORDER" alt="" draggable="false" />
        <img class="border-inner" :src="BORDER2" alt="" draggable="false" />

        <h2 class="title">选择筹码</h2>
        <p class="hint">(*请选择四个筹码 {{ picked.length }}/4)</p>

        <div class="grid">
          <button
            v-for="v in pool"
            :key="v"
            type="button"
            class="chip"
            :class="{ on: picked.includes(v) }"
            @click="toggle(v)"
          >
            <img
              :src="picked.includes(v) ? CHIP_ON : CHIP_OFF"
              alt=""
              draggable="false"
            />
            <span>{{ v }}</span>
          </button>
        </div>

        <button type="button" class="btn cancel" @click="emit('close')">
          <img class="btn-bg" :src="BTN_RED" alt="" draggable="false" />
          <img class="btn-txt" :src="TXT_CANCEL" alt="取消" draggable="false" />
        </button>
        <button
          type="button"
          class="btn confirm"
          :disabled="picked.length !== 4"
          @click="confirm"
        >
          <img class="btn-bg" :src="BTN_BLUE" alt="" draggable="false" />
          <img class="btn-txt" :src="TXT_CONFIRM" alt="确定" draggable="false" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { BCBM_CHIP_POOL } from '@/games/bcbm'

const props = defineProps<{
  modelValue: number[]
}>()

const emit = defineEmits<{
  close: []
  'update:modelValue': [chips: number[]]
  confirm: [chips: number[]]
}>()

const BORDER = '/images/games/bcbm/benz/main/yben_ui_geniric_border.webp'
const BORDER2 = '/images/games/bcbm/benz/main/yben_ui_geniric_border2.webp'
const CHIP_ON = '/images/games/bcbm/benz/bet/yben_btn_chips_on.webp'
const CHIP_OFF = '/images/games/bcbm/benz/bet/yben_btn_chips_off.webp'
const BTN_BLUE = '/images/games/bcbm/benz/main/yben_btn_geniric_blue.webp'
const BTN_RED = '/images/games/bcbm/benz/main/yben_btn_geniric_red.webp'
const TXT_CONFIRM = '/images/games/bcbm/benz/txt/yben_txt_confirm_hans.webp'
const TXT_CANCEL = '/images/games/bcbm/benz/txt/yben_txt_cancel_hans.webp'

const pool = BCBM_CHIP_POOL
const picked = ref<number[]>([])

watch(
  () => props.modelValue,
  (v) => {
    picked.value = [...v].sort((a, b) => a - b)
  },
  { immediate: true },
)

function toggle(v: number) {
  const i = picked.value.indexOf(v)
  if (i >= 0) {
    picked.value = picked.value.filter((x) => x !== v)
    return
  }
  if (picked.value.length >= 4) return
  picked.value = [...picked.value, v].sort((a, b) => a - b)
}

function confirm() {
  if (picked.value.length !== 4) return
  const next = [...picked.value].sort((a, b) => a - b)
  emit('update:modelValue', next)
  emit('confirm', next)
  emit('close')
}
</script>

<style scoped>
.chip-root {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}
.chip-panel {
  position: relative;
  width: 440px;
  height: 400px;
  color: #fff;
}
.border {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  /* 边框素材带黑底 */
  mix-blend-mode: screen;
}
.border-inner {
  position: absolute;
  left: 10px;
  right: 10px;
  top: 84px;
  width: calc(100% - 20px);
  height: 222px;
  object-fit: fill;
  pointer-events: none;
  mix-blend-mode: screen;
  opacity: 0.85;
}
.title {
  position: relative;
  z-index: 1;
  margin: 17px 0 0;
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
}
.hint {
  position: absolute;
  left: 0;
  right: 0;
  top: 61px;
  z-index: 1;
  margin: 0;
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  color: #9fd4ff;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}
/*
 * 官方 chipList：verticalCenter=-2，TileLayout
 * paddingTop/Bottom=20、h/vGap=10；落在 border2（y=84,h=222）内
 */
.grid {
  position: absolute;
  left: 28px;
  right: 28px;
  top: 84px;
  height: 222px;
  z-index: 1;
  box-sizing: border-box;
  padding: 22px 10px 26px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: 1fr 1fr;
  gap: 8px 4px;
  justify-items: center;
  align-items: center;
}
.chip {
  position: relative;
  width: 60px;
  height: 60px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  filter: brightness(0.72);
  transition: filter 0.12s ease, transform 0.12s ease;
}
.chip.on {
  filter: brightness(1.15) drop-shadow(0 0 6px rgba(80, 200, 255, 0.55));
  transform: scale(1.04);
}
.chip img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: screen;
}
.chip span {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #d8eefc;
  font-size: 16px;
  font-weight: 700;
  text-shadow: 0 1px 3px #000;
  pointer-events: none;
}
.chip.on span {
  color: #ffe56a;
}
.btn {
  position: absolute;
  bottom: 14px;
  z-index: 2;
  width: 120px;
  height: 48px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn.cancel {
  left: calc(50% - 100px - 60px);
}
.btn.confirm {
  left: calc(50% + 110px - 60px);
}
.btn-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  mix-blend-mode: screen;
}
.btn-txt {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  max-width: 72px;
  height: auto;
  object-fit: contain;
  z-index: 1;
}
</style>
