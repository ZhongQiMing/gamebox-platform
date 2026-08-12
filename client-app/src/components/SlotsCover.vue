<template>
  <GameCoverShell
    :visible="visible"
    bg-src="/images/games/slots/fruit-cover.webp"
    alt="水果机"
    bg-color="#0a0604"
    :duration-ms="750"
    :from-scale="1.04"
    @close="emit('close')"
  >
    <button
      type="button"
      class="start-btn"
      aria-label="开始"
      @click="handleStart"
    >
      <img
        src="/images/games/slots/开始按钮.png"
        class="start-btn-img"
        alt=""
        draggable="false"
      />
    </button>
  </GameCoverShell>
</template>

<script setup lang="ts">
import GameCoverShell from './GameCoverShell.vue'

defineProps({
  visible: { type: Boolean, default: true },
})

const emit = defineEmits(['start', 'close'])

function handleStart() {
  emit('start')
}
</script>

<style scoped>
/*
  与封面同坐标系锁定（设计稿 1024×1536，按钮素材 615×259 @ 204,1204）。
  宽高都用百分比 + 按钮图 object-fit:fill，跟封面 fill 同步拉伸，避免缩放错位。
*/
.start-btn {
  position: absolute;
  left: calc(204 / 1024 * 100%);
  top: calc(1204 / 1536 * 100%);
  width: calc(615 / 1024 * 100%);
  height: calc(259 / 1536 * 100%);
  border: none;
  padding: 0;
  margin: 0;
  background: transparent;
  cursor: pointer;
  z-index: 2;
  -webkit-tap-highlight-color: transparent;
  line-height: 0;
  animation: btnPulse 2s ease-in-out infinite;
  transition: filter 0.12s ease, transform 0.12s ease;
}

.start-btn-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}

/* 椭圆压暗层：盖在钮面上，避免 brightness 把半透明描边滤成黑圈 */
.start-btn::after {
  content: '';
  position: absolute;
  left: 7%;
  right: 7%;
  top: 18%;
  bottom: 18%;
  border-radius: 50%;
  background: rgba(50, 16, 0, 0.42);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.1s ease;
}

/* 封面黑槽已填色，可轻微下压；压暗用遮罩而不是整钮 brightness */
.start-btn:active {
  animation: none;
  transform: translateY(4px) scale(0.96);
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
}

.start-btn:active::after {
  opacity: 1;
}

@keyframes btnPulse {
  0%, 100% {
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.45)) brightness(1);
  }
  50% {
    filter: drop-shadow(0 6px 18px rgba(255, 190, 40, 0.55)) brightness(1.06);
  }
}
</style>
