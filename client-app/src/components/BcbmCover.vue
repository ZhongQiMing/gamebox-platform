<template>
  <GameCoverShell
    :visible="visible"
    bg-src="/images/games/bcbm/bcbm-cover-custom.webp"
    alt="奔驰宝马"
    bg-color="#060018"
    :duration-ms="800"
    :from-scale="1.05"
    class="bcbm-cover-shell"
    @close="emit('close')"
  >
    <!--
      封面金紫霓虹风：用官方蓝框 + 金色「开始」字，
      替代通用红金 start-btn-ai（与封面/局内 UI 不搭）
    -->
    <button
      type="button"
      class="start-btn"
      aria-label="开始"
      :disabled="started"
      @click="handleStart"
    >
      <img
        class="btn-frame"
        src="/images/games/bcbm/benz/main/yben_btn_geniric_blue.webp"
        alt=""
        draggable="false"
      />
      <span class="btn-text">开始</span>
      <span class="btn-shine" aria-hidden="true" />
    </button>
  </GameCoverShell>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import GameCoverShell from './GameCoverShell.vue'

defineProps({
  visible: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits(['start', 'close'])

/* 进游戏要等路由分块下载，这期间连点会 push 两次 */
const started = ref(false)

function handleStart() {
  if (started.value) return
  started.value = true
  emit('start')
}
</script>

<style scoped>
.start-btn {
  font-family: 'PingFang SC', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  position: absolute;
  left: 50%;
  bottom: 9%;
  transform: translateX(-50%);
  width: min(72vw, 300px);
  height: calc(min(72vw, 300px) * 0.34);
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  z-index: 2;
  -webkit-tap-highlight-color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: btnPulse 2.4s ease-in-out infinite;
  transition: transform 0.12s ease, filter 0.12s ease;
}

.btn-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  mix-blend-mode: screen;
  filter: drop-shadow(0 0 12px rgba(120, 80, 255, 0.45));
}

.btn-text {
  position: relative;
  z-index: 1;
  font-size: clamp(22px, 6.2vw, 30px);
  font-weight: 800;
  letter-spacing: 0.55em;
  margin-right: -0.55em;
  line-height: 1;
  background: linear-gradient(
    180deg,
    #fff8d6 0%,
    #ffe08a 28%,
    #f0b84a 55%,
    #c98928 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: none;
  filter: drop-shadow(0 1px 0 rgba(80, 40, 0, 0.55))
    drop-shadow(0 0 10px rgba(180, 120, 255, 0.35));
}

.btn-shine {
  position: absolute;
  inset: 18% 8%;
  border-radius: 999px;
  background: linear-gradient(
    105deg,
    transparent 35%,
    rgba(255, 255, 255, 0.18) 48%,
    transparent 62%
  );
  pointer-events: none;
  z-index: 2;
  animation: shineSweep 3.2s ease-in-out infinite;
}

@keyframes btnPulse {
  0%,
  100% {
    filter: brightness(1);
  }
  50% {
    filter: brightness(1.12);
  }
}

@keyframes shineSweep {
  0%,
  55% {
    opacity: 0;
    transform: translateX(-30%);
  }
  70% {
    opacity: 1;
    transform: translateX(0);
  }
  100% {
    opacity: 0;
    transform: translateX(30%);
  }
}

.start-btn:active {
  animation: none;
  transform: translateX(-50%) translateY(3px) scale(0.97);
  filter: brightness(0.88);
}
</style>
