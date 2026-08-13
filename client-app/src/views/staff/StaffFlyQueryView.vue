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
            <div class="fly-k">{{ isCreditBook ? '剩余信用' : '上盘额度' }}</div>
            <div class="fly-v">{{ fmt(isCreditBook ? (wallet?.creditUnused ?? wallet?.diskPoolRemaining ?? wallet?.pointsQuota) : (wallet?.diskPoolRemaining ?? wallet?.pointsQuota)) }}</div>
            <div class="fly-note">{{ isCreditBook ? '还能给玩家上的信用额度' : '向平台买的飞盘额度' }}</div>
          </div>
          <div v-if="isCreditBook">
            <div class="fly-k">合同额度</div>
            <div class="fly-v">{{ fmt(wallet?.creditLimit) }}</div>
            <div class="fly-note">占成在结账时按信用账本轧差</div>
          </div>
          <div v-else>
            <div class="fly-k">上盘可飞</div>
            <div class="fly-v" :class="{ dim: !Number(wallet?.flyCover) }">{{ fmt(wallet?.flyCover) }}</div>
            <div class="fly-note">{{ flyCoverHint }}</div>
          </div>
        </div>
        <div class="fly-sub">
          玩家持分 {{ fmt(wallet?.playerPointsTotal) }}
          <template v-if="!isCreditBook">
            · 代理余额 {{ fmt(wallet?.balance) }}
          </template>
          <template v-else> · 佣金账户 {{ fmt(wallet?.balance) }}（结账轧差后清零）</template>
        </div>
      </section>
      <p v-else class="fly-land-tip">只读查看各房飞盘开关；开/关仍由本房代理操作</p>

      <div class="sc-sec-title">{{ isLandlord ? '各房上盘' : '房间上盘' }}</div>
      <div v-if="loading && !rooms.length" class="sp-empty">加载中…</div>
      <div v-else-if="!rooms.length" class="sp-empty">暂无房间</div>

      <div v-for="r in rooms" :key="r.id" class="fly-card">
        <div class="fly-card-hd">
          <div>
            <b>{{ r.name }}</b>
            <em>
              {{ r.roomNo }} · {{ r.status === 'OPEN' ? '营业' : r.status }}
              <template v-if="r.bookMode === 'CREDIT'"> · 信用盘</template>
            </em>
          </div>
          <div v-if="r.bookMode !== 'CREDIT'" class="fly-cover">
            {{ fmt(r.fly?.flyCover ?? r.agent?.flyCover) }}
          </div>
          <div v-else class="fly-cover credit">开关</div>
        </div>

        <div class="fly-status" :class="`is-${flyMode(r)}`">
          <span>{{ flyModeLabel(r) }}</span>
          <span class="fly-stat">开 {{ r.fly?.onCount ?? 0 }} · 关 {{ r.fly?.offCount ?? 0 }}</span>
        </div>

        <div v-if="canToggleAgent || canToggleGeneral" class="fly-ops">
          <button
            type="button"
            class="fly-btn on"
            :class="{ active: toggleMode(r) === 'on' }"
            :disabled="busyId === r.id || toggleMode(r) === 'on'"
            @click="openConfirm(r, true)"
          >{{ canToggleGeneral ? '飞平台' : '飞盘' }}</button>
          <button
            type="button"
            class="fly-btn off"
            :class="{ active: toggleMode(r) === 'off' }"
            :disabled="busyId === r.id || toggleMode(r) === 'off'"
            @click="openConfirm(r, false)"
          >{{ canToggleGeneral ? '总代坐庄' : '关盘' }}</button>
        </div>
        <p v-else class="fly-tip-inline">{{ isLandlord ? '只读查看；开/关由本房代理操作' : '仅本房代理或总代可整房开关' }}</p>
      </div>

      <p class="fly-tip">
        <template v-if="isCreditBook">
          信用盘：飞盘开=输赢进平台，占成结账轧差；关盘=跟代理。电脑端玩家页可单独调整个人。
        </template>
        <template v-else>
          飞盘：输赢进平台、吃上盘额度；关盘：只改玩家房间分。电脑端玩家页可单独调整个人。
        </template>
      </p>
    </div>

    <div v-if="confirmVisible" class="sp-sheet" @click.self="closeConfirm">
      <div class="sp-sheet-panel">
        <h3>{{ confirmFlyOn ? '整房飞盘' : '整房关盘' }}</h3>
        <p class="hint">{{ confirmHint }}</p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="!!busyId" @click="closeConfirm">取消</button>
          <button
            type="button"
            class="ok"
            :class="{ warn: !confirmFlyOn }"
            :disabled="!!busyId"
            @click="doConfirm"
          >{{ busyId ? '处理中…' : (confirmFlyOn ? '确认开盘' : '确认关盘') }}</button>
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
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const loading = ref(false)
const wallet = ref<StaffWalletMe | null>(null)
const rooms = ref<StaffRoom[]>([])
const busyId = ref<string | null>(null)

const confirmVisible = ref(false)
const confirmTarget = ref<StaffRoom | null>(null)
const confirmFlyOn = ref(false)

const canToggleAgent = computed(() => staff.role === 'AGENT')
const canToggleGeneral = computed(() => staff.role === 'GENERAL')
const isLandlord = computed(() => staff.role === 'ADMIN' || staff.role === 'BRANCH')
const isCreditBook = computed(() => wallet.value?.bookMode === 'CREDIT')

const flyCoverHint = computed(() => {
  const cover = Number(wallet.value?.flyCover || 0)
  if (cover > 0) return '上盘还有额度；开关开时跟平台飞'
  return '上盘额度耗尽：即使开关开着也按关盘（只动玩家分）'
})

const confirmHint = computed(() => {
  const name = confirmTarget.value?.name || '本房'
  if (canToggleGeneral.value) {
    return confirmFlyOn.value
      ? `将「${name}」总代飞盘设为开：代理开盘的注飞向平台。`
      : `将「${name}」总代飞盘设为关：代理开盘的注由总代坐庄，不再飞平台。`
  }
  const credit = confirmTarget.value?.bookMode === 'CREDIT'
  if (confirmFlyOn.value) {
    return credit
      ? `将「${name}」全体玩家设为飞盘开：输赢进平台盘口，占成在结账时按信用账本轧差。个人仍可在电脑端单独关掉。`
      : `将「${name}」全体玩家设为飞盘开：上盘额度大于 0 时输赢进平台。个人仍可在电脑端单独关掉。`
  }
  return credit
    ? `将「${name}」全体玩家设为关盘：不再进平台盘口，输赢跟代理；占成仍按信用账本在结账时轧差。个人仍可在电脑端单独开启。`
    : `将「${name}」全体玩家设为关盘：不再进平台，只改玩家房间分，不动上盘额度。个人仍可在电脑端单独开启。`
})

function fmt(n?: number | null) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
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

function flyModeLabel(r: StaffRoom) {
  const m = flyMode(r)
  if (m === 'on') {
    const cover = Number(r.fly?.flyCover ?? r.agent?.flyCover ?? 0)
    if (r.bookMode !== 'CREDIT' && cover <= 0) return '开关开着·上盘耗尽（软关盘）'
    return '飞盘中（平台盘口）'
  }
  if (m === 'off') return '关盘（不进平台）'
  if (m === 'mixed') return '部分开盘'
  return '暂无玩家'
}

function toggleMode(r: StaffRoom): 'on' | 'off' | 'mixed' | 'empty' {
  if (canToggleGeneral.value) return r.generalFlyEnabled !== false ? 'on' : 'off'
  return flyMode(r)
}

function openConfirm(r: StaffRoom, flyEnabled: boolean) {
  if ((!canToggleAgent.value && !canToggleGeneral.value) || busyId.value) return
  confirmTarget.value = r
  confirmFlyOn.value = flyEnabled
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
    const res = canToggleGeneral.value
      ? await staffConsoleApi.setGeneralRoomFly(r.id, confirmFlyOn.value)
      : await staffConsoleApi.setRoomFly(r.id, confirmFlyOn.value)
    toast(res.message || (confirmFlyOn.value ? '已开启飞盘' : '已关盘'))
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
    const [w, list] = await Promise.all([
      staffConsoleApi.walletMe().catch(() => null),
      staffConsoleApi.rooms().catch(() => [] as StaffRoom[]),
    ])
    wallet.value = w
    rooms.value = list || []
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
.fly-v {
  font-family: 'Noto Serif SC', serif;
  font-size: 28px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.fly-v.dim { color: rgba(255, 244, 194, 0.45); }
.fly-note {
  margin-top: 4px;
  font-size: 10px;
  letter-spacing: 0.5px;
  color: rgba(244, 211, 107, 0.42);
  line-height: 1.3;
}
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
  font-size: 18px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
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
.fly-stat {
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
.fly-tip-inline {
  margin: 0;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.45);
}
.fly-tip {
  margin: 14px 2px 0;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.4);
  line-height: 1.4;
}
</style>
