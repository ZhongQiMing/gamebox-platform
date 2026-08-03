<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">经营报表</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <div class="sp-tabs">
        <button
          v-for="t in ranges"
          :key="t.key"
          type="button"
          :class="{ on: range === t.key }"
          @click="switchRange(t.key)"
        >{{ t.label }}</button>
      </div>

      <div v-if="loading" class="sp-empty">加载中…</div>
      <template v-else-if="summary">
        <div class="rd-grid">
          <div class="rd-cell"><div class="mk">流水</div><div class="mv">{{ fmt(summary.betFlow) }}</div></div>
          <div class="rd-cell"><div class="mk">派彩</div><div class="mv">{{ fmt(summary.payout) }}</div></div>
          <div class="rd-cell"><div class="mk">庄家盈亏</div><div class="mv" :class="pnlClass(summary.housePnl)">{{ fmt(summary.housePnl) }}</div></div>
          <div class="rd-cell"><div class="mk">注单</div><div class="mv">{{ summary.betCount }}</div></div>
          <div class="rd-cell"><div class="mk">上分</div><div class="mv up">{{ fmt(summary.upAmount) }}</div></div>
          <div class="rd-cell"><div class="mk">下分</div><div class="mv down">{{ fmt(summary.downAmount) }}</div></div>
          <div class="rd-cell"><div class="mk">活跃玩家</div><div class="mv">{{ summary.activePlayers ?? '—' }}</div></div>
          <div class="rd-cell"><div class="mk">房间数</div><div class="mv">{{ summary.roomCount }}</div></div>
        </div>

        <div class="sc-sec-title">分游戏</div>
        <div v-if="!(summary.byGame || []).length" class="sp-empty">该区间暂无注单</div>
        <div v-for="g in summary.byGame || []" :key="g.gameCode" class="agent-card" style="cursor:default">
          <div class="agent-card-hd">
            <div class="agent-name" style="font-size:14px">{{ g.gameName || g.gameCode }}</div>
            <div class="mv" :class="pnlClass(g.housePnl)">{{ fmt(g.housePnl) }}</div>
          </div>
          <div class="agent-sub" style="margin:0">
            注单 {{ g.betCount }} · 流水 {{ fmt(g.betFlow) }} · 派彩 {{ fmt(g.payout) }}
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { staffConsoleApi, type StaffReportSummary } from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const { toast } = useToast()

const ranges = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'thisweek', label: '本周' },
  { key: 'thismonth', label: '本月' },
]

const range = ref('today')
const loading = ref(false)
const summary = ref<StaffReportSummary | null>(null)

function fmt(n?: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function pnlClass(n?: number) {
  const v = Number(n || 0)
  if (v > 0) return 'up'
  if (v < 0) return 'down'
  return ''
}

async function load() {
  loading.value = true
  try {
    summary.value = await staffConsoleApi.reportSummary({ range: range.value })
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function switchRange(key: string) {
  range.value = key
  void load()
}

onMounted(() => { void load() })
</script>
