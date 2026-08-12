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
      <div class="title">回水设置</div>
      <div class="right sc-bar-act" @click="reload">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <p class="rb-tip">
        待领回水含今日流水预计；主代理可提前帮玩家领到账户（等同玩家自助领，不必等早 6 点自动发）。
        <template v-if="!canEdit">子账号仅可查看。</template>
      </p>

      <div class="sp-search">
        <input
          v-model="keyword"
          type="search"
          placeholder="昵称 / 账号 / UID"
          @keyup.enter="reload"
        >
        <button type="button" @click="reload">搜索</button>
      </div>

      <div v-if="loading && !list.length" class="sp-empty">加载中…</div>
      <div v-else-if="!list.length" class="sp-empty">暂无玩家</div>

      <div v-for="p in list" :key="p.id" class="sp-row rb-row">
        <div class="top">
          <div class="name">{{ p.nickname }}</div>
          <div class="bal">{{ pct(p.rebateRate) }}</div>
        </div>
        <div class="meta">
          {{ p.username }} · {{ p.uid }}
          <template v-if="p.playerRebateRate == null"> · 继承默认</template>
        </div>
        <div class="rb-pending">
          <span>
            <em>当前待领</em>
            <b :class="{ hot: pendingOf(p) > 0 }">{{ fmt(pendingOf(p)) }}</b>
          </span>
          <span v-if="todayOf(p) > 0 && todayOf(p) !== pendingOf(p)">
            <em>今日</em>
            <b>{{ fmt(todayOf(p)) }}</b>
          </span>
        </div>
        <div v-if="canEdit" class="ops">
          <button type="button" @click="openEdit(p)">改比例</button>
          <button
            type="button"
            class="rb-claim"
            :disabled="busyId === p.id || pendingOf(p) <= 0"
            @click="claim(p)"
          >{{ busyId === p.id ? '领取中…' : '提前领取' }}</button>
        </div>
      </div>

      <div v-if="total > list.length" class="sp-empty">
        <button type="button" class="sc-logout" :disabled="loading" @click="loadMore">加载更多</button>
      </div>
    </div>

    <div v-if="editVisible" class="sp-sheet" @click.self="closeEdit">
      <div class="sp-sheet-panel">
        <h3>玩家回水</h3>
        <p class="hint">{{ editTarget?.nickname }} · 当前 {{ pct(editTarget?.rebateRate) }}</p>
        <input
          v-model.number="editPct"
          type="number"
          min="0"
          step="0.1"
          inputmode="decimal"
          placeholder="例如 1.8 表示 1.8%"
        >
        <p class="hint">单位 %，如 1.8 = 1.8%</p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="busy" @click="closeEdit">取消</button>
          <button type="button" class="ok" :disabled="busy" @click="save">保存</button>
        </div>
      </div>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { staffConsoleApi, type StaffPlayerRow } from '@/api/staffConsole'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useStaffStore } from '@/stores/staff'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const canEdit = computed(() => staff.role === 'AGENT')

const keyword = ref('')
const loading = ref(false)
const list = ref<StaffPlayerRow[]>([])
const page = ref(1)
const total = ref(0)
const pageSize = 20

/** playerId → 待领 / 今日 */
const pendingMap = reactive<Record<string, { claimableTotal: number; todayEstimated: number }>>({})

const editVisible = ref(false)
const editTarget = ref<StaffPlayerRow | null>(null)
const editPct = ref(1.8)
const busy = ref(false)
const busyId = ref<string | null>(null)

function pct(rate?: number | null) {
  if (rate == null || Number.isNaN(Number(rate))) return '—'
  return `${(Number(rate) * 100).toFixed(2).replace(/\.?0+$/, '')}%`
}

function fmt(n?: number | null) {
  return Number(n || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function pendingOf(p: StaffPlayerRow) {
  return Number(pendingMap[p.id]?.claimableTotal || 0)
}

function todayOf(p: StaffPlayerRow) {
  return Number(pendingMap[p.id]?.todayEstimated || 0)
}

function openEdit(p: StaffPlayerRow) {
  editTarget.value = p
  editPct.value = Math.round(Number(p.rebateRate || 0.018) * 1000) / 10
  editVisible.value = true
}

function closeEdit() {
  if (busy.value) return
  editVisible.value = false
  editTarget.value = null
}

async function save() {
  if (!editTarget.value || busy.value) return
  const rate = Number(editPct.value) / 100
  if (!Number.isFinite(rate) || rate <= 0) {
    toast('请输入有效比例')
    return
  }
  busy.value = true
  try {
    await staffConsoleApi.setPlayerRebateRate(editTarget.value.id, rate)
    toast('已保存')
    editVisible.value = false
    await reload()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '保存失败')
  } finally {
    busy.value = false
  }
}

async function claim(p: StaffPlayerRow) {
  if (!canEdit.value || busyId.value) return
  const amt = pendingOf(p)
  if (amt <= 0) return
  if (!window.confirm(`确认帮「${p.nickname}」提前领取待领回水 ${fmt(amt)}？将直接打入玩家账户。`)) {
    return
  }
  busyId.value = p.id
  try {
    const res = await staffConsoleApi.claimPlayerRebate(p.id)
    toast(res.message || `已领取 ${fmt(res.amount)}`)
    await loadBriefs(list.value.map((x) => x.id))
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '领取失败')
  } finally {
    busyId.value = null
  }
}

async function loadBriefs(ids: string[]) {
  if (!ids.length) return
  try {
    const res = await staffConsoleApi.playersRebateBrief(ids)
    for (const row of res.list || []) {
      pendingMap[row.playerId] = {
        claimableTotal: Number(row.claimableTotal || 0),
        todayEstimated: Number(row.todayEstimated || 0),
      }
    }
  } catch {
    /* 比例列表仍可用 */
  }
}

async function fetchPage(p: number, append: boolean) {
  loading.value = true
  try {
    const res = await staffConsoleApi.players({
      page: p,
      pageSize,
      q: keyword.value.trim() || undefined,
    })
    total.value = res.total
    page.value = res.page
    list.value = append ? [...list.value, ...res.list] : res.list
    if (!append) {
      for (const key of Object.keys(pendingMap)) delete pendingMap[key]
    }
    await loadBriefs(res.list.map((x) => x.id))
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function reload() {
  return fetchPage(1, false)
}
function loadMore() {
  return fetchPage(page.value + 1, true)
}

onMounted(() => { void reload() })
</script>

<style scoped>
.rb-tip {
  margin: 0 2px 12px;
  font-size: 12px;
  color: rgba(244, 211, 107, 0.5);
  line-height: 1.4;
}
.rb-pending {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin: 8px 0 4px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.28);
}
.rb-pending em {
  display: block;
  font-style: normal;
  font-size: 10px;
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.48);
  margin-bottom: 2px;
}
.rb-pending b {
  font-size: 15px;
  font-weight: 700;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
}
.rb-pending b.hot { color: #86efac; }
.rb-row :deep(.ops) {
  gap: 8px;
}
.rb-row .ops button.rb-claim {
  border-color: rgba(34, 197, 94, 0.5) !important;
  background: rgba(22, 101, 52, 0.4) !important;
  color: #bbf7d0 !important;
}
.rb-row .ops button.rb-claim:disabled {
  opacity: 0.4;
}
</style>
