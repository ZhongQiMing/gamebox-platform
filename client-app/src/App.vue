<template>
  <AppErrorBoundary ref="boundaryRef">
    <RouterView />
    <AppToast />
  </AppErrorBoundary>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import AppToast from '@/components/AppToast.vue'
import AppErrorBoundary from '@/components/AppErrorBoundary.vue'

const boundaryRef = ref<InstanceType<typeof AppErrorBoundary> | null>(null)

function onFatal(ev: Event) {
  const msg = (ev as CustomEvent<string>).detail
  boundaryRef.value?.show(msg)
}

onMounted(() => {
  window.addEventListener('app-fatal-error', onFatal)
})
onUnmounted(() => {
  window.removeEventListener('app-fatal-error', onFatal)
})
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #app {
  width: 100%; height: 100%;
  background: #0a0700;
  font-family: 'PingFang SC', 'Noto Sans SC', sans-serif;
  -webkit-tap-highlight-color: transparent;
}
</style>
