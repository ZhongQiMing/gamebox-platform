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
      <div class="title">上盘查询</div>
      <div class="right sc-bar-act" @click="load">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <section v-if="!isLandlord" class="sc-panel fly-hero">
        <div class="fly-hero-grid">
          <div>
            <div class="fly-k">{{ isCreditBook ? '剩余信用' : '可用额度' }}</div>
            <div class="fly-v">{{ fmt(isCreditBook ? (wallet?.creditUnused ?? wallet?.diskPoolRemaining ?? wallet?.pointsQuota) : (wallet?.diskPoolRemaining ?? wallet?.pointsQuota)) }}</div>
          </div>
          <div v-if="isCreditBook">
            <div class="fly-k">合同额度</div>
            <div class="fly-v">{{ fmt(wallet?.creditLimit) }}</div>
          </div>
          <div v-else>
            <div class="fly-k">上盘可飞</div>
            <div class="fly-v" :class="{ dim: !Number(wallet?.flyCover) }">{{ fmt(wallet?.flyCover) }}</div>
          </div>
        </div>
        <div class="fly-sub">
          玩家持分 {{ fmt(wallet?.playerPointsTotal) }}
          · 代理余额 {{ fmt(agentBalance) }}
        </div>
      </section>
      <p v-else class="fly-land-tip">只读查看</p>

      <div class="sc-sec-title">{{ isLandlord ? '各房上盘' : '房间上盘' }}</div>
      <div v-if="loading && !rooms.length" class="sp-empty">加载中…</div>
      <div v-else-if="!rooms.length" class="sp-empty">暂无房间</div>

      <section
        v-for="b in flyBlocks"
        :key="b.key"
        class="sg-wrap"
        :class="{ 'sg-plain': b.kind === 'room' }"
      >
        <button
          v-if="b.kind === 'general'"
          type="button"
          class="fly-card sg-head"
          @click="toggleGroup(b.key)"
        >
          <div class="fly-card-hd">
            <div>
              <b><em class="sg-tag">总代</em>{{ b.name }}</b>
              <div class="sg-pills">
                <span class="sg-pill">下线占成 {{ b.sharePct }}%</span>
                <span class="sg-pill">整包 {{ b.flowPct }}%</span>
                <span class="sg-pill">{{ b.bookLabel }}</span>
                <span class="sg-pill">{{ b.rooms.length }} 间房</span>
              </div>
            </div>
            <span class="sg-chev" :class="{ open: isGroupOpen(b.key) }"></span>
          </div>
          <div class="fly-hero-grid">
            <div>
              <div class="fly-k">{{ b.quotaLabel }}</div>
              <div class="fly-v">{{ b.quotaText }}</div>
            </div>
            <div>
              <div class="fly-k">{{ b.secondLabel }}</div>
              <div class="fly-v">{{ b.secondText }}</div>
            </div>
          </div>
          <div class="fly-sub">上盘可飞 {{ b.flyText }} · 玩家 {{ b.members }}</div>
        </button>

        <div v-show="b.kind === 'room' || isGroupOpen(b.key)" :class="{ 'sg-body': b.kind === 'general' }">
          <div v-for="r in b.rooms" :key="r.id" class="fly-card">
            <div class="fly-card-hd">
              <div>
                <b>{{ isAgentView ? (r.name || '本房') : (r.agent?.nickname || r.agent?.username || r.name) }}</b>
                <em>
                  <template v-if="!isAgentView">{{ r.name }} · </template>{{ r.roomNo }} · {{ r.status === 'OPEN' ? '营业' : r.status }}
                  <template v-if="r.bookMode === 'CREDIT'"> · 信用盘</template>
                </em>
              </div>
              <div v-if="r.bookMode !== 'CREDIT'" class="fly-cover">
                {{ fmt(r.fly?.flyCover ?? r.agent?.flyCover) }}
              </div>
              <div v-else class="fly-cover credit">开关</div>
            </div>

            <div class="fly-status" :class="`is-${flyMode(r)}`">
              <span class="fly-mode">{{ agentFlyLabel(r) }}</span>
              <span class="fly-stat">玩家开 {{ r.fly?.onCount ?? 0 }} · 关 {{ r.fly?.offCount ?? 0 }}</span>
            </div>

            <div v-if="canToggleAgent" class="fly-ops">
              <button
                type="button"
                class="fly-btn on"
                :class="{ active: flyMode(r) === 'on' }"
                :disabled="busyId === r.id || flyMode(r) === 'on'"
                @click="openConfirm(r, true, 'agent')"
              >飞盘</button>
              <button
                type="button"
                class="fly-btn off"
                :class="{ active: flyMode(r) === 'off' }"
                :disabled="busyId === r.id || flyMode(r) === 'off'"
                @click="openConfirm(r, false, 'agent')"
              >关盘</button>
            </div>

            <template v-if="r.general && (canToggleGeneral || isLandlord)">
              <div class="fly-ops" :class="{ 'is-readonly': !canToggleGeneral }">
                <button
                  type="button"
                  class="fly-btn on"
                  :class="{ active: generalFlyOn(r) }"
                  :disabled="!canToggleGeneral || busyId === r.id || generalFlyOn(r)"
                  @click="openConfirm(r, true, 'general')"
                >飞盘</button>
                <button
                  type="button"
                  class="fly-btn off"
                  :class="{ active: !generalFlyOn(r) }"
                  :disabled="!canToggleGeneral || busyId === r.id || !generalFlyOn(r)"
                  @click="openConfirm(r, false, 'general')"
                >关盘</button>
              </div>
            </template>
          </div>
        </div>
      </section>

    </div>

    <div v-if="confirmVisible" class="sp-sheet" @click.self="closeConfirm">
      <div class="sp-sheet-panel">
        <h3>{{ confirmTitle }}</h3>
        <p class="hint">{{ confirmHint }}</p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="!!busyId" @click="closeConfirm">取消</button>
          <button
            type="button"
            class="ok"
            :class="{ warn: !confirmFlyOn }"
            :disabled="!!busyId"
            @click="doConfirm"
          >{{ busyId ? '处理中…' : confirmOkText }}</button>
        </div>
      </div>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  staffConsoleApi,
  type StaffRoom,
  type StaffWalletMe,
} from '@/api/staffConsole'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useStaffStore } from '@/stores/staff'
import { useToast } from '@/composables/useToast'
import { formatMoney } from '@gamebox/shared'
import { useBodyClass } from '@/composables/useBodyClass'
import {
  loadStaffGenerals,
  moneyOrDash,
  pctOfRate,
  treeFly,
  type StaffGeneralRow,
} from '@/utils/staffGenerals'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const loading = ref(false)
const wallet = ref<StaffWalletMe | null>(null)
const rooms = ref<StaffRoom[]>([])
const generalMap = ref<Record<string, StaffGeneralRow>>({})
const busyId = ref<string | null>(null)

const confirmVisible = ref(false)
const confirmTarget = ref<StaffRoom | null>(null)
const confirmFlyOn = ref(false)
const confirmLayer = ref<'agent' | 'general'>('agent')

const canToggleAgent = computed(() => staff.role === 'AGENT')
const canToggleGeneral = computed(() => staff.isGeneral)
const isLandlord = computed(() => staff.isBranch)
const isAgentView = computed(() => staff.isAgentSide)
const isCreditBook = computed(() => wallet.value?.bookMode === 'CREDIT')
const agentBalance = computed(() => {
  const w = wallet.value
  if (!w) return 0
  if (w.agentBalance != null) return Number(w.agentBalance)
  return Number(w.balance || 0)
})

type FlyBlock = {
  key: string
  kind: 'room' | 'general'
  name: string
  sharePct: string
  flowPct: string
  bookLabel: string
  quotaLabel: string
  quotaText: string
  secondLabel: string
  secondText: string
  flyText: string
  members: number
  rooms: StaffRoom[]
}

/** 总代自己看这一页时，顶上已经是他的额度，不再套一层自己的抽屉 */
const flyBlocks = computed<FlyBlock[]>(() => {
  const blocks: FlyBlock[] = []
  const seen = new Set<string>()
  for (const room of rooms.value) {
    const gid = room.general?.userId || ''
    const nest = !!gid && isLandlord.value
    if (!nest) {
      blocks.push({
        key: room.id,
        kind: 'room',
        name: '',
        sharePct: '',
        flowPct: '',
        bookLabel: '',
        quotaLabel: '',
        quotaText: '',
        secondLabel: '',
        secondText: '',
        flyText: '',
        members: 0,
        rooms: [room],
      })
      continue
    }
    if (seen.has(gid)) continue
    seen.add(gid)
    const groupRooms = rooms.value.filter((item) => item.general?.userId === gid)
    const walletRow = generalMap.value[gid]
    const credit = walletRow?.bookMode === 'CREDIT'
    const seenAgent = new Set<string>()
    const downFly: number[] = []
    for (const item of groupRooms) {
      const id = item.agent?.userId
      if (!id || seenAgent.has(id)) continue
      seenAgent.add(id)
      downFly.push(Number(item.agent?.flyCover || 0))
    }
    const fly = treeFly(Number(walletRow?.flyCover || 0), downFly)
    blocks.push({
      key: gid,
      kind: 'general',
      name: String(room.general?.nickname || room.general?.username || walletRow?.nickname || '总代').trim(),
      sharePct: pctOfRate(walletRow?.shareRate ?? room.general?.shareRate),
      flowPct: pctOfRate(walletRow?.flowRate ?? room.general?.flowRate),
      bookLabel: walletRow ? (credit ? 'B·信用' : 'A·现金') : '—',
      quotaLabel: credit ? '剩余信用' : '可用额度',
      quotaText: moneyOrDash(walletRow, walletRow?.pointsQuota),
      secondLabel: credit ? '合同额度' : '余额',
      secondText: moneyOrDash(walletRow, credit ? walletRow?.creditLimit : walletRow?.agentBalance ?? walletRow?.balance),
      flyText: moneyOrDash(walletRow, fly),
      members: groupRooms.reduce((sum, item) => sum + Number(item.memberCount || 0), 0),
      rooms: groupRooms,
    })
  }
  return blocks
})

const openedGroups = ref<Record<string, boolean>>({})
function isGroupOpen(key: string) {
  if (openedGroups.value[key] != null) return openedGroups.value[key]
  const groups = flyBlocks.value.filter((b) => b.kind === 'general')
  return groups.length <= 1 || groups[0]?.key === key
}
function toggleGroup(key: string) {
  openedGroups.value = { ...openedGroups.value, [key]: !isGroupOpen(key) }
}

const confirmTitle = computed(() => (confirmFlyOn.value ? '飞盘' : '关盘'))
const confirmOkText = computed(() => '确认')
const doneText = computed(() => (confirmFlyOn.value ? '已开启飞盘' : '已关闭飞盘'))

const confirmHint = computed(() => {
  const name = confirmTarget.value?.name || '本房'
  return confirmFlyOn.value
    ? `是否将「${name}」开启飞盘？`
    : `是否将「${name}」关闭飞盘？`
})

function fmt(n?: number | null) {
  return formatMoney(n ?? 0)
}

function flyMode(r: StaffRoom): 'on' | 'off' | 'mixed' | 'empty' {
  const on = r.fly?.onCount ?? 0
  const off = r.fly?.offCount ?? 0
  const n = r.fly?.memberCount ?? 0
  if (!n) return 'empty'
  if (on > 0 && off > 0) return 'mixed'
  if (on > 0) return 'on'
  return 'off'
}

function agentFlyLabel(r: StaffRoom) {
  const m = flyMode(r)
  if (m === 'on') {
    const cover = Number(r.fly?.flyCover ?? r.agent?.flyCover ?? 0)
    if (r.bookMode !== 'CREDIT' && cover <= 0) return '开关开着·上盘耗尽'
    return '玩家飞盘中'
  }
  if (m === 'off') return '玩家关盘'
  if (m === 'mixed') return '玩家部分开盘'
  return '暂无玩家'
}

function generalFlyOn(r: StaffRoom) {
  return r.generalFlyEnabled !== false
}

function openConfirm(r: StaffRoom, flyEnabled: boolean, layer: 'agent' | 'general') {
  if (busyId.value) return
  if (layer === 'agent' && !canToggleAgent.value) return
  if (layer === 'general' && !canToggleGeneral.value) return
  confirmTarget.value = r
  confirmFlyOn.value = flyEnabled
  confirmLayer.value = layer
  confirmVisible.value = true
}

function closeConfirm() {
  if (busyId.value) return
  confirmVisible.value = false
  confirmTarget.value = null
}

async function doConfirm() {
  const r = confirmTarget.value
  if (!r || busyId.value) return
  busyId.value = r.id
  try {
    if (confirmLayer.value === 'general') {
      await staffConsoleApi.setGeneralRoomFly(r.id, confirmFlyOn.value)
    } else {
      await staffConsoleApi.setRoomFly(r.id, confirmFlyOn.value)
    }
    toast(doneText.value)
    confirmVisible.value = false
    confirmTarget.value = null
    await load()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    busyId.value = null
  }
}

async function load() {
  loading.value = true
  try {
    const [w, list, gens] = await Promise.all([
      staffConsoleApi.walletMe().catch(() => null),
      staffConsoleApi.rooms().catch(() => [] as StaffRoom[]),
      isLandlord.value ? loadStaffGenerals().catch(() => ({})) : Promise.resolve({}),
    ])
    wallet.value = w
    rooms.value = list || []
    generalMap.value = gens
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
</script>

<style scoped>
.fly-land-tip {
  margin: 0 2px 12px;
  font-size: 11px;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}
.fly-hero {
  margin-bottom: 14px;
}
.fly-hero-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.fly-k {
  font-size: 12px;
  letter-spacing: 2px;
  color: rgba(255, 244, 194, 0.6);
  margin-bottom: 6px;
}
/*
 * 这里不能用 --money-half：它按整页宽放两个数字算，而这格还要扣掉
 * 页面 16×2、面板 14×2、边框 2×2 和栅格间隙 12，360px 屏每列只剩约 142px，
 * 22px 字放到八位数金额就压线，配上 nowrap 会直接顶出面板。
 */
.fly-v {
  font-family: 'Noto Serif SC', serif;
  font-size: var(--money-third);
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  line-height: 1.1;
}
.fly-v.dim { color: rgba(255, 244, 194, 0.45); }
.fly-sub {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(244, 211, 107, 0.12);
  font-size: 11px;
  color: rgba(244, 211, 107, 0.5);
}
.fly-card-hd {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}
.fly-card-hd b {
  display: block;
  font-size: 15px;
  color: #fff4c2;
  letter-spacing: 1px;
  margin-bottom: 3px;
}
.fly-card-hd em {
  font-style: normal;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.5);
}
.fly-cover {
  font-size: var(--money-third);
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.fly-status {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
  letter-spacing: 1px;
  background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 244, 194, 0.75);
}
.fly-status.is-on {
  color: #86efac;
  background: rgba(22, 101, 52, 0.28);
}
.fly-status.is-off {
  color: #fca5a5;
  background: rgba(127, 29, 29, 0.28);
}
.fly-status.is-mixed {
  color: #fcd34d;
  background: rgba(120, 53, 15, 0.35);
}
.fly-mode {
  min-width: 0;
}
.fly-stat {
  flex-shrink: 0;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
.fly-ops {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.fly-btn {
  height: 40px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 2px;
  cursor: pointer;
}
.fly-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.fly-btn.on {
  border: 1px solid rgba(34, 197, 94, 0.55);
  background: rgba(22, 101, 52, 0.35);
  color: #bbf7d0;
}
.fly-btn.on.active {
  background: rgba(22, 101, 52, 0.65);
  border-color: rgba(134, 239, 172, 0.7);
}
.fly-btn.off {
  border: 1px solid rgba(248, 113, 113, 0.55);
  background: rgba(127, 29, 29, 0.35);
  color: #fecaca;
}
.fly-btn.off.active {
  background: rgba(127, 29, 29, 0.65);
  border-color: rgba(252, 165, 165, 0.7);
}
.fly-ops.is-readonly .fly-btn,
.fly-ops.is-readonly .fly-btn:disabled {
  cursor: default;
  opacity: 0.4;
}
.fly-ops.is-readonly .fly-btn.active,
.fly-ops.is-readonly .fly-btn.active:disabled {
  opacity: 1;
}
</style>
