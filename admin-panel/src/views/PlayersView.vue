<template>
  <div class="ops-page">
    <PageHeader title="玩家上下分" subtitle="给本房玩家上分 / 下分；真分走额度与飞盘，假分只加玩家余额" />
    <PlayersPanel />
  </div>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import PlayersPanel from '@/views/PlayersPanel.vue'
</script>
