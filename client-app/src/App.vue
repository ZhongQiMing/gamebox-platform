<template>
  <RouterView />
  <AppToast />
</template>

<script setup lang="ts">
import AppToast from '@/components/AppToast.vue'
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
