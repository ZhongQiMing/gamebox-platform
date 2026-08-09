<template>
  <Teleport to="body">
    <div v-if="visible" class="pc-mask" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <div class="pc-card">
        <div :id="titleId" class="pc-title">服务协议与隐私政策</div>
        <div class="pc-body">
          <p>欢迎使用金御汇。在开始前，请阅读并同意我们的
            <a class="pc-link" @click="emit('view')">《隐私政策》</a>。</p>
          <p>我们仅收集为你提供游戏与账户服务所必需的信息，不会向第三方出售你的个人数据。你可随时在「我的 · 账号管理」中注销账号。</p>
          <p class="pc-tip">点击「同意并继续」，即表示你已阅读并接受上述条款。</p>
        </div>
        <div class="pc-actions">
          <button type="button" class="pc-btn pc-btn-ghost" @click="emit('disagree')">不同意并退出</button>
          <button type="button" class="pc-btn pc-btn-primary" @click="emit('agree')">同意并继续</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useId } from 'vue'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ agree: []; disagree: []; view: [] }>()
const titleId = useId()
</script>

<style scoped>
.pc-mask {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(2px);
}
.pc-card {
  width: 100%;
  max-width: 340px;
  border-radius: 16px;
  padding: 22px 20px 18px;
  background: linear-gradient(180deg, #1c1508 0%, #120d04 100%);
  border: 1px solid rgba(244, 211, 107, 0.28);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
}
.pc-title {
  font-size: 18px;
  font-weight: 700;
  text-align: center;
  color: #f4d36b;
  letter-spacing: 1px;
}
.pc-body {
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.82);
}
.pc-body p {
  margin: 0 0 10px;
}
.pc-tip {
  color: rgba(244, 211, 107, 0.72);
}
.pc-link {
  color: #f4d36b;
  text-decoration: underline;
  cursor: pointer;
}
.pc-actions {
  margin-top: 18px;
  display: flex;
  gap: 12px;
}
.pc-btn {
  flex: 1;
  height: 42px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.pc-btn-ghost {
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.22);
}
.pc-btn-primary {
  background: linear-gradient(180deg, #f6d976 0%, #d9a83a 100%);
  color: #2a1c00;
}
</style>
