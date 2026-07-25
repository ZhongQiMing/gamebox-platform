<template>
  <nav v-if="!fromGame" class="lobby-tabbar">
    <div
      v-for="tab in TABS"
      :key="tab.key"
      :class="['tab-item', route.name === tab.name ? 'active' : '']"
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
  { key: 'flow',     name: 'flow',     icon: '▤', text: '明 细' },
  { key: 'cs',       name: 'cs',       icon: '✆', text: '客 服' },
  { key: 'settings', name: 'settings', icon: '☰', text: '我 的' },
]

function go(tab: typeof TABS[number]) {
  if (route.name === tab.name) return
  router.push({ name: tab.name })
}
</script>
