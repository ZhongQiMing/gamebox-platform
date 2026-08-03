<template>
  <nav v-if="!fromGame" class="lobby-tabbar">
    <div
      v-for="tab in TABS"
      :key="tab.key"
      :class="['tab-item', isActive(tab) ? 'active' : '']"
      :data-tab="tab.key"
      @click="go(tab)"
    >
      <span class="t-icon">{{ tab.icon }}</span>
      <span class="t-text">{{ tab.text }}</span>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

/** 游戏内打开的子页：全屏铺满，不留底部 Tab */
const fromGame = computed(() => route.query.from === 'game')

function syncBodyClass() {
  if (fromGame.value) document.body.classList.remove('has-tabbar')
  else document.body.classList.add('has-tabbar')
}

onMounted(syncBodyClass)
onUnmounted(() => document.body.classList.remove('has-tabbar'))
watch(fromGame, syncBodyClass)

const TABS = [
  { key: 'home',     name: 'lobby',    icon: '⛨', text: '游 戏' },
  { key: 'recharge', name: 'recharge', icon: '¥', text: '充 值' },
  /* 明细 = 全游戏竞猜报表（与聊天室「+」竞猜报表同一页 /bets） */
  { key: 'flow',     name: 'bets',     icon: '▤', text: '明 细' },
  { key: 'cs',       name: 'cs',       icon: '✆', text: '客 服' },
  { key: 'settings', name: 'settings', icon: '☰', text: '我 的' },
]

function isActive(tab: typeof TABS[number]) {
  if (tab.name === 'bets') return route.name === 'bets' && !route.query.game
  return route.name === tab.name
}

function go(tab: typeof TABS[number]) {
  /* 明细：始终进全游戏报表（清掉 game=，避免误进单游戏注单） */
  if (tab.name === 'bets') {
    if (isActive(tab)) return
    router.push({ name: 'bets' })
    return
  }
  if (route.name === tab.name) return
  router.push({ name: tab.name })
}
</script>
