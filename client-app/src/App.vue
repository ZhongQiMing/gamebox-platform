<template>
  <RouterView v-if="!loading" />
  <div v-else class="splash">
    <span class="splash-dot" />
  </div>
  <AppToast />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import AppToast from '@/components/AppToast.vue'
import { useUserStore } from '@/stores/user'
import { authApi } from '@/api/auth'

const loading = ref(true)
const userStore = useUserStore()

onMounted(async () => {
  if (userStore.token) {
    try {
      const profile = await authApi.me()
      userStore.setAuth(profile, userStore.token)
    } catch {
      // token 失效，清除
      userStore.logout()
    }
  }
  loading.value = false
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
.splash {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100vh; background: #0a0700;
}
.splash-dot {
  width: 14px; height: 14px; border-radius: 50%;
  background: #d4a93c;
  animation: pulse 1.2s infinite ease-in-out;
}
@keyframes pulse { 0%,100%{opacity:.3;transform:scale(1)} 50%{opacity:1;transform:scale(1.4)} }
</style>
