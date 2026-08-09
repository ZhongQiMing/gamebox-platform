<template>
  <AppErrorBoundary ref="boundaryRef">
    <RouterView v-slot="{ Component, route }">
      <template v-if="Component">
        <!--
          keep-alive 子节点不能用 v-if 掏空：进注单时若 slot 变空，缓存会被拆掉，
          iframe 重载后开奖只剩「开奖中」、没有发牌翻牌。
          include 只缓存 AssetsGameView；其它页照常挂载、不进缓存。
        -->
        <keep-alive include="AssetsGameView" :max="6">
          <component
            :is="Component"
            :key="route.meta.assetGame ? 'game-' + String(route.meta.assetGame) : route.fullPath"
          />
        </keep-alive>
      </template>
    </RouterView>
    <AppToast />
    <PrivacyConsentDialog
      :visible="showConsent"
      @agree="agreePrivacy"
      @disagree="disagreePrivacy"
      @view="viewPrivacy"
    />
  </AppErrorBoundary>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import AppToast from '@/components/AppToast.vue'
import AppErrorBoundary from '@/components/AppErrorBoundary.vue'
import PrivacyConsentDialog from '@/components/PrivacyConsentDialog.vue'
import { useToast } from '@/composables/useToast'

const boundaryRef = ref<InstanceType<typeof AppErrorBoundary> | null>(null)
const router = useRouter()
const route = useRoute()
const { toast } = useToast()

function onFatal(ev: Event) {
  const msg = (ev as CustomEvent<string>).detail
  boundaryRef.value?.show(msg)
}

/* ── 首启隐私同意 ──────────────────────────────
 * 设备维度只弹一次；同意后写 localStorage。查看完整政策时临时让开弹窗，
 * 让 /privacy 页面能被读到，返回后若仍未同意会再次弹出。 */
const PRIVACY_KEY = 'gb_privacy_agreed'
const privacyAgreed = ref(localStorage.getItem(PRIVACY_KEY) === '1')
const showConsent = computed(() => !privacyAgreed.value && route.name !== 'privacy')

function agreePrivacy() {
  localStorage.setItem(PRIVACY_KEY, '1')
  privacyAgreed.value = true
}
function disagreePrivacy() {
  if (Capacitor.isNativePlatform()) CapApp.exitApp()
  else toast('需同意隐私政策后方可使用')
}
function viewPrivacy() {
  router.push({ name: 'privacy' })
}

/* ── Android 物理返回键 ──────────────────────────
 * 未同意隐私前：返回=退出（不可绕过）。
 * 处于根页（登录/大厅/房间号/员工首页）：两秒内再按一次退出，否则提示。
 * 其它页：正常回退一层。 */
const ROOT_ROUTES = new Set<string>([
  'login', 'register', 'room', 'lobby',
  'staff-login-agent', 'staff-login-branch',
  'staff-home', 'staff-lobby', 'staff-game-rooms', 'staff-fund',
])
let backHandle: PluginListenerHandle | null = null
let lastBackAt = 0

async function registerBackButton() {
  if (!Capacitor.isNativePlatform()) return
  backHandle = await CapApp.addListener('backButton', ({ canGoBack }) => {
    if (showConsent.value) {
      CapApp.exitApp()
      return
    }
    const name = router.currentRoute.value.name as string | undefined
    const atRoot = !name || ROOT_ROUTES.has(name)
    if (!atRoot && canGoBack) {
      router.back()
      return
    }
    const now = Date.now()
    if (now - lastBackAt < 2000) {
      CapApp.exitApp()
    } else {
      lastBackAt = now
      toast('再按一次退出应用')
    }
  })
}

onMounted(() => {
  window.addEventListener('app-fatal-error', onFatal)
  registerBackButton()
})
onUnmounted(() => {
  window.removeEventListener('app-fatal-error', onFatal)
  backHandle?.remove()
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
