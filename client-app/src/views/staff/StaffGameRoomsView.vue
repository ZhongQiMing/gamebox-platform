<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="title">游戏大厅</div>
      <div class="right sc-bar-act" @click="load">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <div class="rm-sum" v-if="!loading && rooms.length">
        <span>共 {{ rooms.length }} 间</span>
        <span>营业 {{ openCount }}</span>
      </div>

      <div v-if="loading && !rooms.length" class="sp-empty">加载中…</div>
      <div v-else-if="!rooms.length" class="sp-empty">暂无房间</div>

      <section v-for="g in groups" :key="g.key" class="gd-wrap">
        <button v-if="!flatOwn" type="button" class="gr-card gd-head" @click="toggleGroup(g.key)">
          <i class="gr-corner tl" aria-hidden="true"></i>
          <i class="gr-corner tr" aria-hidden="true"></i>
          <i class="gr-corner bl" aria-hidden="true"></i>
          <i class="gr-corner br" aria-hidden="true"></i>
          <div class="gr-top">
            <div class="gr-icon-wrap gd-seal" aria-hidden="true">
              <span>{{ g.key === '__none__' ? '直' : '总' }}</span>
            </div>
            <div class="gr-main">
              <div class="gr-hd">
                <div class="gr-title">
                  <span class="gr-agent-tag">{{ g.key === '__none__' ? '直挂' : '总代' }}</span>
                  <span class="gr-name">{{ g.name }}</span>
                </div>
                <span class="gd-chev" :class="{ open: isOpen(g.key) }"></span>
              </div>
              <div class="gd-pills">
                <span v-if="g.key !== '__none__'" class="gr-chip">总代占成 {{ g.sharePct }}%</span>
                <span v-if="g.key !== '__none__'" class="gr-chip">返水 {{ g.flowPct }}%</span>
                <span v-if="g.bookMode" class="gr-chip">{{ g.bookMode === 'CREDIT' ? '信用盘' : '现金盘' }}</span>
                <span class="gr-chip">{{ g.rooms.length }} 间房</span>
              </div>
            </div>
          </div>
          <div class="gr-grid">
            <template v-if="g.key !== '__none__'">
              <div class="gr-cell">
                <span class="mk">{{ g.bookMode === 'CREDIT' ? '剩余信用' : '可用额度' }}</span>
                <span class="mv">{{ g.quotaText }}</span>
              </div>
              <div class="gr-cell">
                <span class="mk">{{ g.bookMode === 'CREDIT' ? '合同额度' : '余额' }}</span>
                <span class="mv">{{ g.bookMode === 'CREDIT' ? g.creditText : g.balanceText }}</span>
              </div>
              <div class="gr-cell">
                <span class="mk">上盘可飞</span>
                <span class="mv">{{ g.flyText }}</span>
              </div>
              <div class="gr-cell">
                <span class="mk">玩家</span>
                <span class="mv">{{ g.members }}</span>
              </div>
            </template>
            <template v-else>
              <div class="gr-cell">
                <span class="mk">房间</span>
                <span class="mv">{{ g.rooms.length }}</span>
              </div>
              <div class="gr-cell">
                <span class="mk">玩家</span>
                <span class="mv">{{ g.members }}</span>
              </div>
            </template>
          </div>
        </button>

        <div v-show="flatOwn || isOpen(g.key)" :class="{ 'gd-body': !flatOwn }">
          <button
            v-for="r in g.rooms"
            :key="r.id"
            type="button"
            class="gr-card gd-room"
            :class="{ 'is-closed': r.status !== 'OPEN' }"
            @click="enterLobby(r)"
          >
            <i class="gr-corner tl" aria-hidden="true"></i>
            <i class="gr-corner tr" aria-hidden="true"></i>
            <i class="gr-corner bl" aria-hidden="true"></i>
            <i class="gr-corner br" aria-hidden="true"></i>

            <div class="gr-top">
              <div class="gr-icon-wrap">
                <img
                  class="gr-icon"
                  :src="r.icon || defaultIcon"
                  :alt="r.name"
                  loading="lazy"
                  @error="onIconError"
                >
              </div>
              <div class="gr-main">
                <div class="gr-hd">
                  <div class="gr-title">
                    <span class="gr-agent-tag">本房代理</span>
                    <span class="gr-name">{{ displayName(r) }}</span>
                  </div>
                  <div class="gr-tags">
                    <span class="gr-chip">{{ r.bookMode === 'CREDIT' ? '信用盘' : '现金盘' }}</span>
                    <span class="gr-st" :class="r.status.toLowerCase()">{{ statusLabel(r.status) }}</span>
                  </div>
                </div>
                <div class="gr-code">
                  <span class="gr-code-k">进房码</span>
                  <span class="gr-code-v">{{ r.roomNo }}</span>
                </div>
              </div>
            </div>

            <div class="gr-grid">
              <div class="gr-cell">
                <span class="mk">玩家</span>
                <span class="mv">{{ r.memberCount ?? 0 }}</span>
              </div>
              <div class="gr-cell">
                <span class="mk">游戏</span>
                <span class="mv">{{ (r.enabledGames || []).length }}</span>
              </div>
              <template v-if="r.bookMode === 'CREDIT'">
                <div class="gr-cell">
                  <span class="mk">剩余信用</span>
                  <span class="mv">{{ r.agent ? fmt(r.agent.pointsQuota) : '—' }}</span>
                </div>
                <div class="gr-cell">
                  <span class="mk">合同额度</span>
                  <span class="mv">{{ fmt(r.creditLimit) }}</span>
                </div>
              </template>
              <template v-else>
                <div class="gr-cell">
                  <span class="mk">可用额度</span>
                  <span class="mv">{{ r.agent ? fmt(r.agent.pointsQuota) : '—' }}</span>
                </div>
                <div class="gr-cell">
                  <span class="mk">上盘可飞</span>
                  <span class="mv">{{ r.agent ? fmt(r.agent.flyCover) : '—' }}</span>
                </div>
              </template>
            </div>
          </button>
        </div>
      </section>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { staffConsoleApi, type StaffAgentRow, type StaffRoom } from '@/api/staffConsole'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useStaffStore } from '@/stores/staff'
import { useToast } from '@/composables/useToast'
import { formatMoney } from '@gamebox/shared'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()
/** 总代自己看，名下房间直接铺开，不再套一层自己的抽屉 */
const flatOwn = computed(() => staff.isGeneral)

const defaultIcon = '/images/rooms/default-room.webp'
const loading = ref(false)
const rooms = ref<StaffRoom[]>([])
const openCount = computed(() => rooms.value.filter((r) => r.status === 'OPEN').length)

function fmt(n?: number | null) {
  return formatMoney(n ?? 0)
}
function statusLabel(s: string) {
  return ({ OPEN: '营业', CLOSED: '关闭', MAINTENANCE: '维护', FROZEN: '冻结' } as Record<string, string>)[s] || s
}
/** 标题优先代理昵称，否则房间名（与「本房代理」同一行） */
function displayName(r: StaffRoom) {
  const nick = String(r.agent?.nickname || r.agent?.username || '').trim()
  if (nick) return nick
  const name = String(r.name || '').trim()
  return name || '未绑定'
}
function pctLabel(rate?: number) {
  const n = Number(rate)
  if (!Number.isFinite(n)) return '—'
  const pct = n > 1 ? n : n * 100
  return String(Math.round(pct * 10) / 10)
}

type GeneralBrief = StaffAgentRow & {
  bookMode?: string
  creditLimit?: number
}

const generalMap = ref<Record<string, GeneralBrief>>({})

type RoomGroup = {
  key: string
  name: string
  sharePct: string
  flowPct: string
  bookMode: string
  quotaText: string
  flyText: string
  creditText: string
  balanceText: string
  members: number
  rooms: StaffRoom[]
}

const groups = computed<RoomGroup[]>(() => {
  const map = new Map<string, RoomGroup>()
  for (const room of rooms.value) {
    const key = room.general?.userId || '__none__'
    let group = map.get(key)
    if (!group) {
      const wallet = generalMap.value[key]
      const bookMode = wallet?.bookMode === 'CREDIT' ? 'CREDIT' : wallet ? 'CASH' : ''
      group = {
        key,
        name: String(room.general?.nickname || room.general?.username || '').trim() || '直挂平台',
        sharePct: pctLabel(room.general?.shareRate),
        flowPct: pctLabel(room.general?.flowRate),
        bookMode,
        quotaText: wallet ? fmt(wallet.pointsQuota) : '—',
        flyText: wallet ? fmt(wallet.flyCover) : '—',
        creditText: wallet ? fmt(wallet.creditLimit) : '—',
        balanceText: wallet ? fmt(wallet.agentBalance ?? wallet.balance) : '—',
        members: 0,
        rooms: [],
      }
      map.set(key, group)
    }
    group.rooms.push(room)
    group.members += Number(room.memberCount || 0)
  }
  for (const group of map.values()) {
    if (group.key === '__none__') continue
    const wallet = generalMap.value[group.key]
    if (!wallet) continue
    const seen = new Set<string>()
    let down = 0
    for (const room of group.rooms) {
      const id = room.agent?.userId || room.agent?.agentId
      if (!id || seen.has(id)) continue
      seen.add(id)
      down += Number(room.agent?.flyCover || 0)
    }
    /* 总代「上盘可飞」是整棵树：他自己这一支，加上名下每个代理那一支 */
    group.flyText = fmt(Number(wallet.flyCover || 0) + down)
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === '__none__') return 1
    if (b.key === '__none__') return -1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
})

const opened = ref<Record<string, boolean>>({})
function isOpen(key: string) {
  return opened.value[key] !== false && (opened.value[key] === true || groups.value.length === 1)
}
function toggleGroup(key: string) {
  opened.value = { ...opened.value, [key]: !isOpen(key) }
}
function onIconError(e: Event) {
  const img = e.target as HTMLImageElement | null
  if (img && img.src !== defaultIcon) img.src = defaultIcon
}

function enterLobby(r: StaffRoom) {
  if (r.status !== 'OPEN') {
    toast('该房间未营业，暂不可进入大厅')
    return
  }
  void router.push({ name: 'staff-lobby', query: { roomId: r.id } })
}

async function load() {
  loading.value = true
  try {
    const [roomList, agentPage] = await Promise.all([
      staffConsoleApi.rooms(),
      staffConsoleApi.agents({ role: 'GENERAL', page: 1, pageSize: 500, boundOnly: false }).catch(() => null),
    ])
    rooms.value = roomList || []
    const next: Record<string, GeneralBrief> = {}
    for (const row of (agentPage?.list || []) as GeneralBrief[]) {
      if (row?.id) next[row.id] = row
    }
    generalMap.value = next
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

.gr-card {
  position: relative;
  display: block;
  width: 100%;
  margin-bottom: 14px;
  padding: 16px 14px 14px;
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
.gr-card::before {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: 11px;
  border: 1px solid rgba(244, 211, 107, 0.28);
  box-shadow:
    inset 0 0 12px rgba(244, 211, 107, 0.06),
    inset 0 1px 0 rgba(255, 240, 200, 0.1);
  pointer-events: none;
}
.gr-card::after {
  content: '';
  position: absolute;
  left: 14px;
  right: 14px;
  top: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(244, 211, 107, 0.55) 30%,
    rgba(255, 244, 194, 0.85) 50%,
    rgba(244, 211, 107, 0.55) 70%,
    transparent 100%
  );
  pointer-events: none;
}
.gr-card:active {
  transform: scale(0.992);
  box-shadow:
    0 0 0 1px rgba(244, 211, 107, 0.4),
    0 0 22px rgba(244, 211, 107, 0.28),
    0 6px 16px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 244, 194, 0.22);
}
.gr-card.is-closed {
  opacity: 0.72;
  filter: saturate(0.85);
}

/* 四角金饰 */
.gr-corner {
  position: absolute;
  width: 14px;
  height: 14px;
  pointer-events: none;
  z-index: 1;
}
.gr-corner::before,
.gr-corner::after {
  content: '';
  position: absolute;
  background: linear-gradient(90deg, #f5e2a0, #c9a227);
  box-shadow: 0 0 4px rgba(244, 211, 107, 0.45);
}
.gr-corner::before { width: 14px; height: 1.5px; }
.gr-corner::after { width: 1.5px; height: 14px; }
.gr-corner.tl { top: 7px; left: 7px; }
.gr-corner.tr { top: 7px; right: 7px; transform: scaleX(-1); }
.gr-corner.bl { bottom: 7px; left: 7px; transform: scaleY(-1); }
.gr-corner.br { bottom: 7px; right: 7px; transform: scale(-1); }

.gr-top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: stretch;
  gap: 12px;
  margin-bottom: 12px;
}
.gr-icon-wrap {
  position: relative;
  width: 74px;
  height: 74px;
  flex-shrink: 0;
  padding: 3px;
  border-radius: 14px;
  background:
    linear-gradient(#1a1208, #1a1208) padding-box,
    linear-gradient(
      160deg,
      #fff4c2 0%,
      #d4a832 28%,
      #8a6818 55%,
      #f0d878 78%,
      #a8801e 100%
    ) border-box;
  border: 2px solid transparent;
  box-shadow:
    0 0 10px rgba(212, 160, 64, 0.28),
    inset 0 0 0 1px rgba(0, 0, 0, 0.45);
}
.gr-icon {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 10px;
  object-fit: cover;
  background: rgba(0, 0, 0, 0.35);
}
.gr-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 8px;
}
.gr-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.gr-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
}
.gr-name {
  min-width: 0;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: #f5d36b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gr-agent-tag {
  flex-shrink: 0;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.72);
  white-space: nowrap;
}
.gd-wrap { margin-bottom: 18px; }
.gd-head { margin-bottom: 0; }
.gd-seal {
  display: flex;
  align-items: center;
  justify-content: center;
}
.gd-seal span {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 2px;
  color: #f5d36b;
  text-shadow: 0 0 12px rgba(245, 211, 107, 0.4);
}
.gd-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.gd-chev {
  position: relative;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid rgba(212, 175, 55, 0.5);
  background: rgba(0, 0, 0, 0.32);
}
.gd-chev::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 8px;
  width: 8px;
  height: 8px;
  border-right: 1.5px solid #f5d36b;
  border-bottom: 1.5px solid #f5d36b;
  transform: rotate(45deg);
  transition: transform 0.15s ease, top 0.15s ease;
}
.gd-chev.open::before {
  top: 11px;
  transform: rotate(225deg);
}
.gd-body {
  position: relative;
  margin: 8px 2px 0 20px;
  padding-left: 12px;
  border-left: 1px solid rgba(212, 175, 55, 0.42);
}
.gd-room { margin-bottom: 10px; }
.gd-room:last-child { margin-bottom: 0; }
.gr-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.gr-chip {
  font-size: 10px;
  letter-spacing: 0.5px;
  color: #d4af37;
  border: 1px solid rgba(212, 175, 55, 0.4);
  border-radius: 4px;
  padding: 2px 6px;
}
.gr-st {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(212, 175, 55, 0.35);
  color: #f5d36b;
}
.gr-st.open { color: #86efac; border-color: rgba(134, 239, 172, 0.45); }
.gr-st.closed,
.gr-st.frozen { color: #fca5a5; border-color: rgba(252, 165, 165, 0.45); }
.gr-st.maintenance { color: #f5d36b; }

.gr-code {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.32);
  border: 1px solid rgba(212, 175, 55, 0.22);
}
.gr-code-k {
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-muted);
}
.gr-code-v {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 2px;
  font-variant-numeric: tabular-nums;
  color: #fff4c2;
  font-family: 'Roboto Mono', 'SF Mono', Menlo, Consolas, ui-monospace, monospace;
}

.gr-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
/* 标签在上、数字独占一行：横排时六位数在窄屏放不下，会被截成省略号 */
.gr-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 40px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.26);
  border: 1px solid rgba(212, 175, 55, 0.14);
}
.gr-cell .mk {
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-muted);
}
/*
 * 用 --money-third 而不是 --money-half：--money-half 按「整页宽度放两个数字」算，
 * 没扣掉卡片自己的内边距。这里页面 16 + 卡片 14 + 格子 10（左右各一份）再加列间隙，
 * 一共吃掉约 68px，每个数字实际只剩 (100vw − 68) / 2，22px 的字放不下会顶出卡片。
 */
.gr-cell .mv {
  font-size: var(--money-third);
  font-weight: 800;
  line-height: 1.1;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
