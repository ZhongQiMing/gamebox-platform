<template>
  <div v-if="broken" class="app-error">
    <div class="app-error-card">
      <h1 class="app-error-title">页面出了点问题</h1>
      <p class="app-error-desc">不用担心，积分和订单不受影响。可刷新重试，或返回大厅。</p>
      <p v-if="detail" class="app-error-detail">{{ detail }}</p>
      <div class="app-error-actions">
        <button type="button" class="app-error-btn app-error-btn--primary" @click="reload">刷新页面</button>
        <button type="button" class="app-error-btn" @click="goLobby">返回大厅</button>
      </div>
    </div>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const broken = ref(false)
const detail = ref('')

onErrorCaptured((err) => {
  broken.value = true
  detail.value = err instanceof Error ? err.message : String(err)
  console.error('[AppErrorBoundary]', err)
  return false
})

function reload() {
  window.location.reload()
}

function goLobby() {
  broken.value = false
  detail.value = ''
  void router.replace({ name: 'lobby' }).catch(() => {
    window.location.href = '/lobby'
  })
}

defineExpose({
  show(message?: string) {
    broken.value = true
    detail.value = message || ''
  },
})
</script>

<style scoped>
.app-error {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #0a0700;
  color: #f5ecd6;
}
.app-error-card {
  width: min(420px, 100%);
  padding: 28px 24px;
  border-radius: 16px;
  background: linear-gradient(160deg, #1a140d, #120e08);
  border: 1px solid rgba(212, 175, 55, 0.35);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  text-align: center;
}
.app-error-title {
  font-size: 1.35rem;
  font-weight: 700;
  color: #f4d36b;
  margin-bottom: 10px;
}
.app-error-desc {
  font-size: 0.95rem;
  line-height: 1.55;
  color: #c9b890;
  margin-bottom: 12px;
}
.app-error-detail {
  font-size: 0.78rem;
  color: #7a6e58;
  word-break: break-word;
  margin-bottom: 18px;
  max-height: 4.5em;
  overflow: hidden;
}
.app-error-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
.app-error-btn {
  min-width: 120px;
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid rgba(212, 175, 55, 0.4);
  background: transparent;
  color: #f5ecd6;
  font-size: 0.95rem;
  cursor: pointer;
}
.app-error-btn--primary {
  background: linear-gradient(180deg, #d4af37, #8a6f1f);
  border-color: transparent;
  color: #1a1200;
  font-weight: 600;
}
</style>
