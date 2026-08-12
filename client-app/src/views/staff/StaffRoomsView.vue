<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">房间管理</div>
      <div class="right sc-bar-act" @click="load">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <div class="sp-search">
        <input v-model="keyword" type="search" placeholder="搜进房码 / 房间名 / 代理" @keyup.enter="noop">
      </div>

      <div class="rm-sum" v-if="!loading && rooms.length">
        <span>共 {{ filtered.length }} 间</span>
        <span>营业 {{ openCount }}</span>
      </div>

      <div v-if="loading" class="sp-empty">加载中…</div>
      <div v-else-if="!filtered.length" class="sp-empty">暂无房间</div>

      <button
        v-for="r in filtered"
        :key="r.id"
        type="button"
        class="rm-card"
        :class="{ 'is-closed': r.status !== 'OPEN' }"
        @click="goDetail(r.id)"
      >
        <i class="rm-corner tl" aria-hidden="true"></i>
        <i class="rm-corner tr" aria-hidden="true"></i>
        <i class="rm-corner bl" aria-hidden="true"></i>
        <i class="rm-corner br" aria-hidden="true"></i>

        <div class="rm-top">
          <div class="rm-icon-wrap">
            <img
              class="rm-icon"
              :src="r.icon || defaultIcon"
              :alt="r.name"
              loading="lazy"
              @error="onIconError"
            >
          </div>
          <div class="rm-main">
            <div class="rm-hd">
              <div class="rm-title">
                <span class="rm-agent-tag">本房代理</span>
                <span class="rm-name">{{ displayName(r) }}</span>
              </div>
              <div class="rm-tags">
                <span class="rm-chip">{{ r.bookMode === 'CREDIT' ? 'B·信用' : 'A·现金' }}</span>
                <span class="rm-st" :class="r.status.toLowerCase()">{{ statusLabel(r.status) }}</span>
              </div>
            </div>
            <div class="rm-code">
              <span class="rm-code-k">进房码</span>
              <span class="rm-code-v">{{ r.roomNo }}</span>
            </div>
          </div>
        </div>

        <div class="rm-grid">
          <div class="rm-cell">
            <span class="mk">玩家</span>
            <span class="mv">{{ r.memberCount ?? 0 }}</span>
          </div>
          <div class="rm-cell">
            <span class="mk">游戏</span>
            <span class="mv">{{ (r.enabledGames || []).length }}</span>
          </div>
          <template v-if="r.bookMode === 'CREDIT'">
            <div class="rm-cell">
              <span class="mk">剩余信用</span>
              <span class="mv">{{ r.agent ? fmt(r.agent.pointsQuota) : '—' }}</span>
            </div>
            <div class="rm-cell">
              <span class="mk">合同额度</span>
              <span class="mv">{{ fmt(r.creditLimit) }}</span>
            </div>
          </template>
          <template v-else>
            <div class="rm-cell">
              <span class="mk">上盘额度</span>
              <span class="mv">{{ r.agent ? fmt(r.agent.pointsQuota) : '—' }}</span>
            </div>
            <div class="rm-cell">
              <span class="mk">上盘可飞</span>
              <span class="mv">{{ r.agent ? fmt(r.agent.flyCover) : '—' }}</span>
            </div>
          </template>
        </div>

        <div class="rm-ft">
          <span>点击进入房间管理</span>
          <span class="arrow">管理 ›</span>
        </div>
      </button>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { staffConsoleApi, type StaffRoom } from '@/api/staffConsole'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useStaffStore } from '@/stores/staff'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const defaultIcon = '/images/rooms/default-room.png'
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
const openCount = computed(() => rooms.value.filter((r) => r.status === 'OPEN').length)

function fmt(n?: number | null) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}
function statusLabel(s: string) {
  return ({ OPEN: '营业', CLOSED: '关闭', MAINTENANCE: '维护', FROZEN: '冻结' } as Record<string, string>)[s] || s
}
function displayName(r: StaffRoom) {
  const nick = String(r.agent?.nickname || r.agent?.username || '').trim()
  if (nick) return nick
  return String(r.name || '').trim() || '未绑定'
}
function onIconError(e: Event) {
  const img = e.target as HTMLImageElement | null
  if (img && img.src !== defaultIcon) img.src = defaultIcon
}
function goDetail(id: string) {
  router.push({ name: 'staff-room-detail', params: { id } })
}
function noop() { /* enter 仅触发本地筛选 */ }

async function load() {
  loading.value = true
  try {
    rooms.value = await staffConsoleApi.rooms()
    // 代理/子账号：一代理一房，列表无意义，直接进详情
    if (staff.isAgentSide && rooms.value.length === 1) {
      await router.replace({
        name: 'staff-room-detail',
        params: { id: rooms.value[0].id },
      })
      return
    }
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
</script>

<style scoped>
.rm-sum {
  display: flex;
  justify-content: space-between;
  margin: 0 2px 10px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-muted);
}

.rm-card {
  position: relative;
  display: block;
  width: 100%;
  margin-bottom: 14px;
  padding: 16px 14px 12px;
  text-align: left;
  color: inherit;
  cursor: pointer;
  border-radius: 14px;
  border: 2px solid transparent;
  background:
    radial-gradient(120% 90% at 100% 0%, rgba(245, 158, 11, 0.16), transparent 55%),
    linear-gradient(165deg, rgba(48, 34, 18, 0.98) 0%, rgba(16, 11, 7, 0.99) 100%) padding-box,
    linear-gradient(
      135deg,
      #f5e2a0 0%,
      #c9a227 18%,
      #8a6818 38%,
      #e8c96a 55%,
      #a8801e 72%,
      #6b4f1a 88%,
      #f0d878 100%
    ) border-box;
  box-shadow:
    0 0 0 1px rgba(244, 211, 107, 0.22),
    0 0 18px rgba(212, 160, 64, 0.18),
    0 8px 22px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 244, 194, 0.16),
    inset 0 -1px 0 rgba(0, 0, 0, 0.35);
  -webkit-tap-highlight-color: transparent;
  overflow: hidden;
}
.rm-card::before {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 11px;
  border: 1px solid rgba(244, 211, 107, 0.28);
  pointer-events: none;
}
.rm-card:active {
  transform: scale(0.992);
}
.rm-card.is-closed {
  opacity: 0.72;
}

.rm-corner {
  position: absolute;
  width: 14px;
  height: 14px;
  pointer-events: none;
  z-index: 1;
}
.rm-corner::before,
.rm-corner::after {
  content: '';
  position: absolute;
  background: linear-gradient(90deg, #f5e2a0, #c9a227);
}
.rm-corner::before { width: 14px; height: 1.5px; }
.rm-corner::after { width: 1.5px; height: 14px; }
.rm-corner.tl { top: 7px; left: 7px; }
.rm-corner.tr { top: 7px; right: 7px; transform: scaleX(-1); }
.rm-corner.bl { bottom: 7px; left: 7px; transform: scaleY(-1); }
.rm-corner.br { bottom: 7px; right: 7px; transform: scale(-1); }

.rm-top {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}
.rm-icon-wrap {
  width: 74px;
  height: 74px;
  flex-shrink: 0;
  padding: 3px;
  border-radius: 14px;
  background:
    linear-gradient(#1a1208, #1a1208) padding-box,
    linear-gradient(160deg, #fff4c2, #d4a832 40%, #8a6818 70%, #f0d878) border-box;
  border: 2px solid transparent;
}
.rm-icon {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 10px;
  object-fit: cover;
  background: rgba(0, 0, 0, 0.35);
}
.rm-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
}
.rm-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rm-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
}
.rm-agent-tag {
  flex-shrink: 0;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.72);
}
.rm-name {
  min-width: 0;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: #f5d36b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rm-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.rm-chip {
  font-size: 10px;
  letter-spacing: 0.5px;
  color: #d4af37;
  border: 1px solid rgba(212, 175, 55, 0.4);
  border-radius: 4px;
  padding: 2px 6px;
}
.rm-st {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(212, 175, 55, 0.35);
  color: #f5d36b;
}
.rm-st.open { color: #86efac; border-color: rgba(134, 239, 172, 0.45); }
.rm-st.closed,
.rm-st.frozen { color: #fca5a5; border-color: rgba(252, 165, 165, 0.45); }
.rm-st.maintenance { color: #f5d36b; }

.rm-code {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(212, 175, 55, 0.22);
}
.rm-code-k {
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-muted);
}
.rm-code-v {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 2px;
  font-variant-numeric: tabular-nums;
  color: #fff4c2;
  font-family: 'Roboto Mono', 'SF Mono', Menlo, Consolas, ui-monospace, monospace;
}

.rm-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 10px;
}
.rm-cell {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-height: 40px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.26);
  border: 1px solid rgba(212, 175, 55, 0.14);
}
.rm-cell .mk {
  flex-shrink: 0;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text-muted);
}
.rm-cell .mv {
  min-width: 0;
  text-align: right;
  font-size: 15px;
  font-weight: 800;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-ft {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 10px;
  border-top: 1px solid rgba(212, 175, 55, 0.14);
  font-size: 11px;
  color: var(--text-muted);
}
.rm-ft .arrow {
  color: #f5d36b;
  letter-spacing: 1px;
}
</style>
