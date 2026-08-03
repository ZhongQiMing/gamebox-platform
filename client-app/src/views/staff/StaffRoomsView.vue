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
      <div class="title">房间</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <div class="sp-search">
        <input v-model="keyword" type="search" placeholder="搜进房码 / 房间名 / 代理" @keyup.enter="noop">
      </div>

      <div v-if="loading" class="sp-empty">加载中…</div>
      <div v-else-if="!filtered.length" class="sp-empty">暂无房间</div>

      <button
        v-for="r in filtered"
        :key="r.id"
        type="button"
        class="room-card"
        @click="goDetail(r.id)"
      >
        <div class="room-card-hd">
          <div class="room-card-name">{{ r.name }}</div>
          <span class="st" :class="r.status.toLowerCase()">{{ statusLabel(r.status) }}</span>
        </div>
        <div class="room-card-code">进房码 <b>{{ r.roomNo }}</b> · 玩家 {{ r.memberCount }}</div>

        <div class="room-metrics">
          <div class="m">
            <span class="mk">盘口池</span>
            <span class="mv gold">{{ fmt(r.poolBalance) }}</span>
          </div>
          <div class="m">
            <span class="mk">额度</span>
            <span class="mv">{{ r.agent ? fmt(r.agent.pointsQuota) : '—' }}</span>
          </div>
          <div class="m">
            <span class="mk">占用</span>
            <span class="mv">{{ r.agent ? fmt(r.agent.flyCover) : '—' }}</span>
          </div>
          <div class="m">
            <span class="mk">代理余额</span>
            <span class="mv">{{ r.agent ? fmt(r.agent.balance) : '—' }}</span>
          </div>
        </div>

        <div class="room-card-agent">
          {{ r.agent ? `代理 ${r.agent.nickname}` : '未绑定代理' }}
          <span class="arrow">详情 ›</span>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { staffConsoleApi, type StaffRoom } from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const { toast } = useToast()

const loading = ref(false)
const rooms = ref<StaffRoom[]>([])
const keyword = ref('')

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return rooms.value
  return rooms.value.filter((r) => {
    const agent = `${r.agent?.nickname || ''} ${r.agent?.username || ''}`.toLowerCase()
    return (
      r.name.toLowerCase().includes(q)
      || r.roomNo.includes(q)
      || agent.includes(q)
    )
  })
})

function fmt(n?: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function statusLabel(s: string) {
  return ({ OPEN: '营业', CLOSED: '关闭', MAINTENANCE: '维护', FROZEN: '冻结' } as Record<string, string>)[s] || s
}
function goDetail(id: string) {
  router.push({ name: 'staff-room-detail', params: { id } })
}
function noop() { /* enter 仅触发本地筛选 */ }

async function load() {
  loading.value = true
  try {
    const list = await staffConsoleApi.rooms()
    // 并行拉盘口池（对照电脑房间详情「房间彩池」）
    const withPool = await Promise.all(
      list.map(async (r) => {
        try {
          const p = await staffConsoleApi.roomPool(r.id)
          return { ...r, poolBalance: Number(p.balance || 0) }
        } catch {
          return { ...r, poolBalance: 0 }
        }
      }),
    )
    rooms.value = withPool
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
</script>
