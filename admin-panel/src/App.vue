<template>
  <el-config-provider :locale="zhCn">
    <AppErrorBoundary ref="boundaryRef">
      <RouterView />
    </AppErrorBoundary>
  </el-config-provider>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
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
