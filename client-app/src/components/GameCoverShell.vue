<template>
  <div
    v-if="visible"
    class="game-cover-shell"
    :style="{
      background: bgColor,
      '--cover-in-duration': `${durationMs}ms`,
      '--cover-in-from-scale': String(fromScale),
    }"
  >
    <img
      :src="bgSrc"
      class="cover-bg"
      :alt="alt"
      draggable="false"
    />
    <button type="button" class="cover-back" @click="emit('close')">返回</button>
    <!-- 开始按钮等叠加层由各游戏封面通过默认插槽传入 -->
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * 游戏封面通用外壳（PG 通用能力，放 components 根，不依赖任何 games/<游戏名> 模块）。
 * 统一「全屏固定根 + 封面底图 + 进场缩放动画」，各游戏差异（底图、底色、
 * 进场时长/初始缩放、按钮层）通过 props + 插槽传入，避免三套封面重复壳代码。
 */
defineProps({
  visible: { type: Boolean, default: true },
  bgSrc: { type: String, required: true },
  alt: { type: String, default: '' },
  bgColor: { type: String, default: '#0a0604' },
  durationMs: { type: Number, default: 800 },
  fromScale: { type: Number, default: 1.05 },
})

const emit = defineEmits<{ close: [] }>()
</script>

<style scoped>
.game-cover-shell {
  position: fixed;
  inset: 0;
  z-index: 9998;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}

.cover-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  user-select: none;
  -webkit-user-drag: none;
  animation: coverIn var(--cover-in-duration, 800ms) ease-out both;
}

.cover-back {
  position: absolute;
  top: max(12px, env(safe-area-inset-top, 0px));
  left: max(12px, env(safe-area-inset-left, 0px));
  z-index: 3;
  border: none;
  padding: 8px 14px;
  margin: 0;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
  border-radius: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  backdrop-filter: blur(4px);
}

.cover-back:active {
  opacity: 0.85;
}

@keyframes coverIn {
  from {
    transform: scale(var(--cover-in-from-scale, 1.05));
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
