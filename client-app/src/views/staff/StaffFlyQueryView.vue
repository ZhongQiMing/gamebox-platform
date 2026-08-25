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

        <div class="fly-status" :class="`is-${toggleMode(r)}`">
          <span class="fly-mode">{{ flyModeLabel(r) }}</span>
          <span class="fly-stat">{{ flyStatText(r) }}</span>
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
const canToggleGeneral = computed(() => staff.isGeneral)
const isLandlord = computed(() => staff.isBranch)
const isCreditBook = computed(() => wallet.value?.bookMode === 'CREDIT')
const agentBalance = computed(() => {
  const w = wallet.value
  if (!w) return 0
  if (w.agentBalance != null) return Number(w.agentBalance)
  return Number(w.balance || 0)
})

/*
 * 总代按的是「本房代理飞出来的注归谁」，代理按的是「自己房里玩家的注归谁」。
 * 两件事都叫「飞盘 / 关盘」会让总代以为自己在动玩家开关，所以文案分开。
 */
const confirmTitle = computed(() => {
  if (canToggleGeneral.value) return confirmFlyOn.value ? '整房飞平台' : '整房总代坐庄'
  return confirmFlyOn.value ? '整房飞盘' : '整房关盘'
})

const confirmOkText = computed(() => {
  if (canToggleGeneral.value) return confirmFlyOn.value ? '确认飞平台' : '确认坐庄'
  return confirmFlyOn.value ? '确认飞盘' : '确认关盘'
})

/** 服务端没带 message 时的兜底提示 */
const doneText = computed(() => {
  if (canToggleGeneral.value) return confirmFlyOn.value ? '已设为飞平台' : '已设为总代坐庄'
  return confirmFlyOn.value ? '已整房开启飞盘' : '已整房关盘'
})

const confirmHint = computed(() => {
  const name = confirmTarget.value?.name || '本房'
  if (canToggleGeneral.value) {
    return confirmFlyOn.value
      ? `将「${name}」设为飞平台：代理开盘飞出来的注上交平台，输赢不算你的。代理关盘的玩家仍由代理坐庄，轮不到你。`
      : `将「${name}」设为总代坐庄：代理开盘飞出来的注由你接，输赢从你的盘分出。代理关盘的玩家仍由代理坐庄，轮不到你。`
  }
  return confirmFlyOn.value
    ? `将「${name}」整房设为飞盘：玩家的注飞给平台，输赢不动你的盘分。`
    : `将「${name}」整房设为关盘：玩家的注由你自己坐庄，输赢从你的盘分出。`
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

function flyModeLabel(r: StaffRoom) {
  /* 总代这行只反映他自己那个开关；代理关盘的玩家轮不到他 */
  if (canToggleGeneral.value) {
    return r.generalFlyEnabled !== false
      ? '飞平台（仅代理开盘的注上交）'
      : '总代坐庄（仅代理开盘的注你接）'
  }
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

/*
 * 这两个数字是各玩家 flyEnabled 的合计。
 * 代理按的就是这个开关，写「开 / 关」即可；
 * 总代自己的按钮改的是另一层，必须标明「代理开 / 关」，
 * 否则会以为这是自己那两个按钮的状态。
 */
function flyStatText(r: StaffRoom) {
  const on = r.fly?.onCount ?? 0
  const off = r.fly?.offCount ?? 0
  return canToggleGeneral.value
    ? `代理开 ${on} · 关 ${off}`
    : `开 ${on} · 关 ${off}`
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
    toast(res.message || doneText.value)
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
.fly-tip-inline {
  margin: 0;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.45);
}
</style>
