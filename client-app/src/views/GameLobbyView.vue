<template>
  <!-- 大厅专属屏幕级装饰层（与原型一致） -->
  <div class="lobby-deco" aria-hidden="true">
    <img class="lobby-deco-crown" src="/images/crown-emblem.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-tl" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-tr" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-bl" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-br" src="/images/corner-flourish.png" alt="">
  </div>

  <!-- 屏幕级 fixed 顶角按钮（退出在房间页，大厅不放） -->
  <button class="lobby-back" @click="onLobbyBack" aria-label="返回"></button>

  <div class="page lobby-page">
    <div class="page-body">

      <h1 class="lobby-title">游 戏 大 厅</h1>

      <LobbyGamesList ref="listRef" @select="onGameClick" />

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <TabBar />

  <SlotsCover
    v-if="showSlotsCover"
    @start="enterSlotsGame"
    @close="closeSlotsCover"
  />
  <BcbmCover
    v-if="showBcbmCover"
    @start="enterBcbmGame"
    @close="closeBcbmCover"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import type { LobbyGame } from '@/composables/useGameLobbyCards'
import TabBar from '@/components/TabBar.vue'
import LobbyGamesList from '@/components/LobbyGamesList.vue'
import SlotsCover from '@/components/SlotsCover.vue'
import BcbmCover from '@/components/BcbmCover.vue'
import '@/assets/game-lobby.css'

useBodyClass('lobby-bg')

const router = useRouter()
const { toast } = useToast()
const listRef = ref<InstanceType<typeof LobbyGamesList> | null>(null)

function onLobbyBack() {
  const back = window.history.state?.back
  const backPath = typeof back === 'string' ? back.split('?')[0] : ''
  if (backPath.startsWith('/game')) {
    const pos = Number(window.history.state?.position ?? 0)
    if (pos >= 2) router.go(-2)
    else router.replace('/room')
    return
  }
  if (backPath === '/room') {
    router.back()
    return
  }
  router.replace('/room')
}

const showSlotsCover = ref(false)
const currentSlotsRoute = ref('')
const showBcbmCover = ref(false)
const currentBcbmRoute = ref('')

function closeSlotsCover() {
  showSlotsCover.value = false
  currentSlotsRoute.value = ''
}
function closeBcbmCover() {
  showBcbmCover.value = false
  currentBcbmRoute.value = ''
}
async function enterSlotsGame() {
  const target = currentSlotsRoute.value
  if (target) await router.push(target)
  closeSlotsCover()
}
async function enterBcbmGame() {
  const target = currentBcbmRoute.value
  if (target) await router.push(target)
  closeBcbmCover()
}

function onGameClick(g: LobbyGame) {
  const list = listRef.value
  if (list?.isMaintenance(g)) {
    toast(`${g.name.replace(/\s+/g, '')} · 维护中，暂不可进入`)
    return
  }
  if (!g.route || !list?.isPlatformOnline(g)) {
    toast(`${g.name.replace(/\s+/g, '')} · 已下架`)
    return
  }

  if (g.key === 'slots') {
    currentSlotsRoute.value = g.route || ''
    showSlotsCover.value = true
    return
  }
  if (g.key === 'bcbm') {
    currentBcbmRoute.value = g.route || ''
    showBcbmCover.value = true
    return
  }

  router.push(g.route)
}

function onLobbyVisible() {
  if (document.visibilityState === 'visible') void listRef.value?.refreshAll()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onLobbyVisible)
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onLobbyVisible)
})
</script>
