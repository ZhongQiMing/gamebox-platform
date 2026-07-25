<!--
  FROZEN / DEPRECATED — 2026-07
  此视图已不再挂路由。`/game/table/:gameCode` 已 redirect 到 AssetsGameView（iframe H5）。
  真金路径：HTTP /api/table/* + games-common placeTableBet。
  请勿再扩展本文件的 WS 下注逻辑；保留仅作历史对照。
-->
<template>
  <div class="page table-page">
    <div class="table-header">
      <button class="back-btn" @click="goAssets">‹</button>
      <span class="title">牌桌已迁移</span>
    </div>
    <p class="deprecated-tip">请从大厅进入游戏。旧版 WebSocket 桌面已停用。</p>
    <button class="go-btn" type="button" @click="goAssets">进入大厅牌桌</button>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

function goAssets() {
  const raw = String(route.params.gameCode || '').toLowerCase()
  const map: Record<string, string> = {
    'dragon-tiger': 'longhu',
    longhu: 'longhu',
    baccarat: 'baccarat',
    zhajinhua: 'zhajinhua',
    douniu: 'douniu',
  }
  const key = map[raw]
  if (key) router.replace(`/game/lottery/${key}`)
  else router.replace('/lobby')
}

onMounted(() => {
  goAssets()
})
</script>

<style scoped>
.table-page { padding: 24px; color: #eee; }
.deprecated-tip { margin: 16px 0; opacity: 0.8; }
.go-btn {
  padding: 10px 16px;
  border: 0;
  border-radius: 8px;
  background: #c9a227;
  color: #1a1208;
  font-weight: 700;
}
.back-btn { background: none; border: 0; color: inherit; font-size: 24px; }
.table-header { display: flex; align-items: center; gap: 8px; }
</style>
