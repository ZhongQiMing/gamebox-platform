<template>
  <div v-if="broken" class="ops-error">
    <div class="ops-error-card">
      <h1 class="ops-error-title">页面出了点问题</h1>
      <p class="ops-error-desc">可以刷新重试，或返回首页。业务数据不会因此被改写。</p>
      <p v-if="detail" class="ops-error-detail">{{ detail }}</p>
      <div class="ops-error-actions">
        <el-button type="primary" @click="reload">刷新页面</el-button>
        <el-button @click="goHome">返回首页</el-button>
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

function goHome() {
  broken.value = false
  detail.value = ''
  void router.replace({ path: '/' }).catch(() => {
    window.location.href = '/'
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
.ops-error {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  background: var(--ops-bg, #f3f4f7);
}
.ops-error-card {
  width: min(440px, 100%);
  padding: 28px 24px;
  border-radius: 12px;
  background: #fff;
  border: 1px solid var(--ops-border, #e8eaef);
  box-shadow: 0 8px 28px rgba(31, 35, 41, 0.08);
  text-align: center;
}
.ops-error-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--ops-text, #1f2329);
  margin-bottom: 8px;
}
.ops-error-desc {
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--ops-text-2, #606266);
  margin-bottom: 12px;
}
.ops-error-detail {
  font-size: 0.8rem;
  color: var(--ops-muted, #8f959e);
  word-break: break-word;
  margin-bottom: 18px;
  max-height: 4.5em;
  overflow: hidden;
}
.ops-error-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}
</style>
