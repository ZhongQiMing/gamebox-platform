<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="title">
        <span class="brand-dot"></span>
        <span class="brand-wordmark">上下分审核</span>
      </div>
      <div class="right sc-bar-act" @click="reload">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <div class="sp-tabs sf-tabs" :data-count="tabButtons.length">
        <button
          v-for="t in tabButtons"
          :key="t.key"
          type="button"
          :class="{ on: tab === t.key }"
          @click="switchTab(t.key)"
        >{{ t.label }}</button>
      </div>

      <div class="sf-head">
        <span>{{ headHint }}</span>
        <button v-if="canPlayerFund" type="button" class="sf-link" @click="goPlayers">玩家上下分</button>
      </div>

      <div v-if="loading && !displayList.length" class="sp-empty">加载中…</div>
      <div v-else-if="!displayList.length" class="sp-empty">{{ emptyText }}</div>

      <div v-for="row in displayList" :key="row.id" class="sp-row sf-row">
        <div class="top">
          <div class="name">
            <span class="sf-tag" :class="row.type === 'UP' ? 'up' : 'down'">
              {{ row.type === 'UP' ? '上分' : '下分' }}
            </span>
            {{ row.player?.nickname || '—' }}
          </div>
          <div class="bal" :class="row.type === 'UP' ? 'up' : 'down'">{{ fmt(row.amount) }}</div>
        </div>
        <div class="meta">
          <template v-if="row.orderNo">订单 {{ row.orderNo }} · </template>
          {{ row.player?.uid || '—' }}
          <template v-if="channelLabel(row.channel)"> · {{ channelLabel(row.channel) }}</template>
          · {{ fmtTime(isDone ? (row.reviewedAt || row.createdAt) : row.createdAt) }}
          <template v-if="isDone"> · {{ statusText(row.status) }}</template>
        </div>
        <div v-if="!isDone" class="ops">
          <button
            type="button"
            class="sf-ok"
            :disabled="busyId === row.id"
            @click="approve(row)"
          >通过</button>
          <button
            type="button"
            class="sf-no"
            :disabled="busyId === row.id"
            @click="openReject(row)"
          >拒绝</button>
        </div>
      </div>

      <div v-if="canLoadMore" class="sp-empty">
        <button type="button" class="sc-logout" :disabled="loading" @click="loadMore">加载更多</button>
      </div>
    </div>

    <div v-if="rejectVisible" class="sp-sheet" @click.self="closeReject">
      <div class="sp-sheet-panel">
        <h3>拒绝申请</h3>
        <p class="hint">
          {{ rejectTarget?.player?.nickname }} ·
          {{ rejectTarget?.type === 'UP' ? '上分' : '下分' }}
          {{ fmt(rejectTarget?.amount) }}
        </p>
        <input v-model="rejectReason" type="text" maxlength="40" placeholder="原因（可选）">
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="!!busyId" @click="closeReject">取消</button>
          <button type="button" class="ok warn" :disabled="!!busyId" @click="doReject">确认拒绝</button>
        </div>
      </div>
    </div>

    <AppModal
      :visible="approveVisible"
      title="确认通过"
      :message="approveMessage"
      ok-text="确认通过"
      cancel-text="取消"
      @ok="doApprove"
      @cancel="closeApprove"
    />

    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppModal from '@/components/AppModal.vue'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { staffConsoleApi, type StaffFundOrder } from '@/api/staffConsole'
import { useStaffStore } from '@/stores/staff'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

type FundTab = 'pending' | 'all' | 'done'

const route = useRoute()
const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

/** 客服不可浏览玩家列表，仅审申请 */
const canPlayerFund = computed(() => staff.role === 'AGENT')

/** 从四宫格带入的类型；「未审核」按此过滤，「全部待办」看全部 */
const typeHint = computed(() => {
  const t = String(route.query.type || '').toUpperCase()
  return t === 'UP' || t === 'DOWN' ? t : ''
})

const tab = ref<FundTab>('pending')
const isDone = computed(() => tab.value === 'done')

const tabButtons = computed(() => {
  const base: { key: FundTab; label: string }[] = [
    { key: 'pending', label: '未审核' },
    { key: 'all', label: '全部待办' },
    { key: 'done', label: '已通过' },
  ]
  return base
})

const loading = ref(false)
const list = ref<StaffFundOrder[]>([])
const page = ref(1)
const total = ref(0)
const busyId = ref<string | null>(null)

const displayList = computed(() => {
  if (tab.value === 'all' || tab.value === 'done' || !typeHint.value) return list.value
  return list.value.filter((r) => r.type === typeHint.value)
})

const headHint = computed(() => {
  if (tab.value === 'done') return `已通过 ${total.value} 笔`
  if (tab.value === 'all') return `全部待办 ${list.value.length} 笔`
  if (typeHint.value === 'UP') return `未审核上分 ${displayList.value.length} 笔`
  if (typeHint.value === 'DOWN') return `未审核下分 ${displayList.value.length} 笔`
  return `未审核 ${displayList.value.length} 笔`
})

const emptyText = computed(() => (isDone.value ? '暂无已通过记录' : '暂无待审申请'))
const canLoadMore = computed(() => {
  if (tab.value === 'pending') return false
  return list.value.length < total.value
})

const rejectVisible = ref(false)
const rejectTarget = ref<StaffFundOrder | null>(null)
const rejectReason = ref('')

function fmt(n?: number | null) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

function fmtTime(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${mi}`
}

function channelLabel(ch?: string | null) {
  if (!ch) return ''
  const map: Record<string, string> = {
    wechat: '微信',
    alipay: '支付宝',
    bank: '银行卡',
    cs: '客服',
  }
  return map[ch] || ch
}

function statusText(s?: string) {
  if (s === 'APPROVED') return '已通过'
  if (s === 'REJECTED') return '已拒绝'
  return '待审'
}

function goPlayers() {
  router.push({ name: 'staff-players' })
}

function switchTab(next: FundTab) {
  if (tab.value === next) return
  tab.value = next
  void fetchPage(1, false)
}

async function fetchPage(p: number, append: boolean) {
  loading.value = true
  try {
    const res = isDone.value
      ? await staffConsoleApi.fundHistory(p, { status: 'APPROVED' })
      : await staffConsoleApi.fundPending(p)
    total.value = res.total
    page.value = res.page
    list.value = append ? [...list.value, ...res.list] : res.list
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

const approveVisible = ref(false)
const approveTarget = ref<StaffFundOrder | null>(null)
const approveMessage = computed(() => {
  const row = approveTarget.value
  if (!row) return ''
  return (
    `确认通过${row.type === 'UP' ? '上分' : '下分'} ${fmt(row.amount)}？`
    + `\n玩家 ${row.player?.nickname || row.player?.uid || '—'}`
    + (row.orderNo ? `\n订单 ${row.orderNo}` : '')
  )
})

function approve(row: StaffFundOrder) {
  if (busyId.value) return
  approveTarget.value = row
  approveVisible.value = true
}

function closeApprove() {
  if (busyId.value) return
  approveVisible.value = false
  approveTarget.value = null
}

async function doApprove() {
  const row = approveTarget.value
  if (!row || busyId.value) return
  approveVisible.value = false
  busyId.value = row.id
  try {
    await staffConsoleApi.fundApprove(row.id)
    toast('已通过')
    list.value = list.value.filter((x) => x.id !== row.id)
    total.value = Math.max(0, total.value - 1)
    approveTarget.value = null
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    busyId.value = null
  }
}

function openReject(row: StaffFundOrder) {
  rejectTarget.value = row
  rejectReason.value = ''
  rejectVisible.value = true
}

function closeReject() {
  if (busyId.value) return
  rejectVisible.value = false
  rejectTarget.value = null
}

async function doReject() {
  if (!rejectTarget.value || busyId.value) return
  const id = rejectTarget.value.id
  busyId.value = id
  try {
    await staffConsoleApi.fundReject(id, rejectReason.value.trim() || '不同意')
    toast('已拒绝')
    rejectVisible.value = false
    rejectTarget.value = null
    list.value = list.value.filter((x) => x.id !== id)
    total.value = Math.max(0, total.value - 1)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    busyId.value = null
  }
}

function syncTabFromQuery() {
  const q = String(route.query.tab || '')
  if (q === 'done' || q === 'all' || q === 'pending') tab.value = q
}

onMounted(() => {
  syncTabFromQuery()
  void reload()
})
watch(() => route.query.tab, () => {
  syncTabFromQuery()
  void reload()
})
</script>

<style scoped>
.sf-tabs {
  margin-bottom: 10px;
}
.sf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0 2px 12px;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.55);
}
.sf-link {
  border: 0;
  background: transparent;
  color: var(--gold-bright);
  font-size: 12px;
  letter-spacing: 1px;
  cursor: pointer;
  padding: 0;
}
.sf-tag {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 1px;
  vertical-align: 1px;
}
.sf-tag.up {
  color: #86efac;
  background: rgba(22, 101, 52, 0.35);
  border: 1px solid rgba(134, 239, 172, 0.35);
}
.sf-tag.down {
  color: #fca5a5;
  background: rgba(127, 29, 29, 0.35);
  border: 1px solid rgba(252, 165, 165, 0.35);
}
.sf-row .bal.up { color: #86efac; }
.sf-row .bal.down { color: #fca5a5; }

.sf-row :deep(.ops) {
  gap: 10px;
}
.sf-row :deep(.ops button.sf-ok),
.sf-row .ops button.sf-ok {
  border-color: rgba(34, 197, 94, 0.55) !important;
  background: rgba(22, 101, 52, 0.45) !important;
  color: #bbf7d0 !important;
  font-weight: 650;
}
.sf-row :deep(.ops button.sf-no),
.sf-row .ops button.sf-no {
  border-color: rgba(248, 113, 113, 0.55) !important;
  background: rgba(127, 29, 29, 0.45) !important;
  color: #fecaca !important;
  font-weight: 650;
}
</style>
