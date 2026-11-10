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
      <div class="title">{{ canFund ? '上下分' : '玩家查询' }}</div>
      <div class="right sc-bar-act" @click="reload">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <!-- 管理/房主：按房间分组，同账号多房各显各余额 -->
      <template v-if="useRoomGroups">
        <div class="sp-search">
          <input
            v-model="keyword"
            type="search"
            placeholder="搜房间 / 昵称 / 账号 / UID"
            @keyup.enter="onSearch"
          >
          <button type="button" @click="onSearch">搜索</button>
        </div>

        <div class="rm-sum" v-if="!loading && visibleRooms.length">
          <span>共 {{ visibleRooms.length }} 间</span>
          <span>玩家 {{ totalPlayersShown }}</span>
        </div>

        <div v-if="loading && !rooms.length" class="sp-empty">加载中…</div>
        <div v-else-if="!visibleRooms.length" class="sp-empty">
          {{ keyword.trim() ? '无匹配房间或玩家' : '暂无房间' }}
        </div>

        <section v-for="b in playerBlocks" :key="b.key" class="sg-wrap" :class="{ 'sg-plain': b.kind === 'room' }">
          <button
            v-if="b.kind === 'general'"
            type="button"
            class="pl-room sg-head"
            @click="toggleGeneral(b.key)"
          >
            <div class="pl-room-hd">
              <div class="pl-room-name"><em class="sg-tag">总代</em>{{ b.name }}</div>
              <span class="sg-chev" :class="{ open: isGeneralOpen(b.key) }"></span>
            </div>
            <div class="sg-pills">
              <span class="sg-pill">下线占成 {{ b.sharePct }}%</span>
              <span class="sg-pill">整包 {{ b.flowPct }}%</span>
              <span class="sg-pill">{{ b.bookLabel }}</span>
              <span class="sg-pill">{{ b.rooms.length }} 间房</span>
            </div>
            <div class="pl-room-ft">
              <span>{{ b.quotaLabel }} {{ b.quotaText }}</span>
              <span>{{ b.secondLabel }} {{ b.secondText }}</span>
              <span>玩家 {{ b.members }}</span>
            </div>
          </button>
          <div v-show="b.kind === 'room' || isGeneralOpen(b.key)" :class="{ 'sg-body': b.kind === 'general' }">
            <section v-for="r in b.rooms" :key="r.id" class="pl-block">
              <button type="button" class="pl-room" @click="toggleRoom(r.id)">
                <div class="pl-room-hd">
                  <div class="pl-room-name"><em class="sg-tag">本房代理</em>{{ r.agent?.nickname || r.agent?.username || r.name }}</div>
                  <span class="st" :class="(r.status || '').toLowerCase()">{{ statusLabel(r.status) }}</span>
                </div>
                <div class="pl-room-meta">
                  {{ r.name }} · 进房码 {{ r.roomNo }}
                </div>
                <div class="pl-room-ft">
                  <span>玩家 {{ roomPlayerCount(r) }}</span>
                  <span class="arrow">{{ isOpen(r.id) ? '收起 ∧' : '展开 ›' }}</span>
                </div>
              </button>

              <div v-if="isOpen(r.id)" class="pl-players">
                <div v-if="roomLoading[r.id]" class="sp-empty tight">加载中…</div>
                <div v-else-if="!playersOf(r.id).length" class="sp-empty tight">本房暂无玩家</div>
                <div v-for="p in playersOf(r.id)" :key="`${r.id}-${p.id}`" class="sp-row">
                  <div class="top">
                    <div class="name">
                      {{ p.nickname }}
                      <span v-if="p.loginLocked" class="sp-lock">冻结</span>
                      <span v-else-if="p.status !== 'ACTIVE'" class="sp-lock is-off">停用</span>
                    </div>
                    <div class="bal">{{ fmt(p.balance) }}</div>
                  </div>
                  <div class="meta">{{ p.username }} · {{ p.uid }} · 本房余额</div>
                  <div v-if="canResetPwd" class="ops">
                    <button type="button" class="warn" @click="askResetPwd(p)">重置密码</button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      </template>

      <!-- 代理端：仍按单房列表 -->
      <template v-else>
        <div class="sp-search">
          <input
            v-model="keyword"
            type="search"
            placeholder="昵称 / 账号 / UID"
            @keyup.enter="reloadAgent"
          >
          <button type="button" @click="reloadAgent">搜索</button>
        </div>

        <div class="rm-sum" v-if="!loading && list.length">
          <span>共 {{ total }} 人</span>
          <span>本页 {{ list.length }}</span>
        </div>

        <div v-if="loading" class="sp-empty">加载中…</div>
        <div v-else-if="!list.length" class="sp-empty">暂无玩家</div>
        <div v-for="p in list" :key="p.id" class="sp-row">
          <div class="top">
            <div class="name">
              {{ p.nickname }}
              <span v-if="p.loginLocked" class="sp-lock">冻结</span>
              <span v-else-if="p.status !== 'ACTIVE'" class="sp-lock is-off">停用</span>
            </div>
            <div class="bal">{{ fmt(p.balance) }}</div>
          </div>
          <div class="meta">{{ p.username }} · {{ p.uid }}</div>
          <div v-if="canFund" class="ops">
            <button type="button" @click="openFund(p, 'up')">上分</button>
            <button type="button" class="down" @click="openFund(p, 'down')">下分</button>
            <button
              type="button"
              class="pl-fly"
              :class="p.flyEnabled === false ? 'is-off' : 'is-on'"
              :disabled="flyBusyId === p.id"
              @click="askFly(p)"
            >{{ p.flyEnabled === false ? '关盘' : '飞盘' }}</button>
          </div>
        </div>

        <div v-if="total > list.length" class="sp-empty">
          <button type="button" class="sc-logout" :disabled="loading" @click="loadMore">加载更多</button>
        </div>
      </template>
    </div>

    <div v-if="fundVisible" class="sp-sheet" @click.self="closeFund">
      <div class="sp-sheet-panel">
        <h3>{{ fundMode === 'up' ? '玩家上分' : '玩家下分' }}</h3>
        <p class="hint">{{ fundTarget?.nickname }} · 当前 {{ fmt(fundTarget?.balance) }}</p>
        <p v-if="fundOrderNo" class="hint">订单号 {{ fundOrderNo }}</p>
        <input v-model.number="fundAmount" type="number" min="1" inputmode="numeric" placeholder="金额">
        <div class="sp-chips">
          <button
            v-for="n in amountChips"
            :key="n"
            type="button"
            :class="{ on: fundAmount === n }"
            @click="fundAmount = n"
          >{{ n >= 10000 ? `${n / 10000}万` : n }}</button>
        </div>
        <input v-model="fundRemark" type="text" maxlength="40" placeholder="备注（可选）">
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" @click="closeFund">取消</button>
          <button
            type="button"
            class="ok"
            :class="{ warn: fundMode === 'down' }"
            :disabled="fundBusy"
            @click="askFundConfirm"
          >确认</button>
        </div>
      </div>
    </div>

    <div v-if="confirmVisible" class="sp-sheet" @click.self="confirmVisible = false">
      <div class="sp-sheet-panel">
        <h3>确认{{ fundMode === 'up' ? '上分' : '下分' }}</h3>
        <p class="hint">
          是否确认给 {{ fundTarget?.nickname }}
          {{ fundMode === 'up' ? '上分' : '下分' }} {{ fmt(fundAmount) }}？
        </p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="fundBusy" @click="confirmVisible = false">取消</button>
          <button
            type="button"
            class="ok"
            :class="{ warn: fundMode === 'down' }"
            :disabled="fundBusy"
            @click="doFund"
          >确认{{ fundMode === 'up' ? '上分' : '下分' }}</button>
        </div>
      </div>
    </div>

    <div v-if="pwdConfirmVisible" class="sp-sheet" @click.self="pwdConfirmVisible = false">
      <div class="sp-sheet-panel">
        <h3>重置密码</h3>
        <p class="hint">
          {{ pwdTarget?.loginLocked ? '该玩家已冻结。' : '' }}
          重置「{{ pwdTarget?.nickname }}」密码并解冻？旧登录将失效。
        </p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="pwdBusy" @click="pwdConfirmVisible = false">取消</button>
          <button type="button" class="ok warn" :disabled="pwdBusy" @click="doResetPwd">确认重置</button>
        </div>
      </div>
    </div>

    <div v-if="flyConfirmVisible" class="sp-sheet" @click.self="flyConfirmVisible = false">
      <div class="sp-sheet-panel">
        <h3>{{ flyTargetNext ? '飞盘' : '关盘' }}</h3>
        <p class="hint">
          {{ flyTargetNext ? `是否将「${flyTarget?.nickname || '该玩家'}」开启飞盘？` : `是否将「${flyTarget?.nickname || '该玩家'}」关闭飞盘？` }}
        </p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="!!flyBusyId" @click="flyConfirmVisible = false">取消</button>
          <button
            type="button"
            class="ok"
            :class="{ warn: !flyTargetNext }"
            :disabled="!!flyBusyId"
            @click="doSetFly"
          >{{ flyBusyId ? '处理中…' : '确认' }}</button>
        </div>
      </div>
    </div>

    <div v-if="pwdResultVisible" class="sp-sheet" @click.self="pwdResultVisible = false">
      <div class="sp-sheet-panel">
        <h3>新密码（请立即告知）</h3>
        <p class="hint">账号 {{ pwdResult?.username }}</p>
        <p class="hint">密码 {{ pwdResult?.password }}</p>
        <div class="sp-sheet-actions">
          <button type="button" class="ok" @click="copyPwdResult">复制</button>
          <button type="button" class="cancel" @click="pwdResultVisible = false">关闭</button>
        </div>
      </div>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  staffConsoleApi,
  type StaffPlayerRow,
  type StaffRoom,
} from '@/api/staffConsole'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useStaffStore } from '@/stores/staff'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { formatMoney, PLAYER_DOWN_MIN, PLAYER_FUND_MAX, PLAYER_UP_MIN } from '@gamebox/shared'
import { newFundOrderNo } from '@/utils/fundOrderNo'
import {
  loadStaffGenerals,
  moneyOrDash,
  pctOfRate,
  type StaffGeneralRow,
} from '@/utils/staffGenerals'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const route = useRoute()
const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const isLandlord = computed(() => staff.isBranch)
const isGeneral = computed(() => staff.isGeneral)
const useRoomGroups = computed(() => isLandlord.value || isGeneral.value)
const canFund = computed(() => staff.role === 'AGENT')
const canResetPwd = computed(() => useRoomGroups.value)

/*
 * 上下分必须落到具体房间的账本。从「我的 / 充值 / 客服」进来时地址栏没带 roomId，
 * 只绑一间房的代理就直接用那一间，不然他在手机上永远上不了分。
 * 绑多间房才要求先选房，避免把分加到错的房里。
 */
const fallbackRoomId = ref('')
const activeRoomId = computed(() => {
  const q = typeof route.query.roomId === 'string' ? route.query.roomId.trim() : ''
  return q || fallbackRoomId.value
})

const rooms = ref<StaffRoom[]>([])
const generalMap = ref<Record<string, StaffGeneralRow>>({})
const openIds = ref<string[]>([])
const playersByRoom = reactive<Record<string, StaffPlayerRow[]>>({})
const roomLoading = reactive<Record<string, boolean>>({})
const roomTotals = reactive<Record<string, number>>({})
/** 搜索时各房命中玩家（按本房余额）；空 = 未按玩家过滤 */
const searchHits = ref<Record<string, StaffPlayerRow[]> | null>(null)

const keyword = ref('')
const loading = ref(false)
const list = ref<StaffPlayerRow[]>([])
const page = ref(1)
const total = ref(0)
const pageSize = 20

const fundVisible = ref(false)
const confirmVisible = ref(false)
const fundBusy = ref(false)
const fundMode = ref<'up' | 'down'>('up')
const fundAmount = ref(100)
const fundRemark = ref('')
const fundOrderNo = ref('')
const fundTarget = ref<StaffPlayerRow | null>(null)
const amountChips = [100, 500, 1000, 2000, 5000, 10000]
const isCreditBook = ref(false)

const pwdConfirmVisible = ref(false)
const pwdResultVisible = ref(false)
const pwdBusy = ref(false)
const pwdTarget = ref<StaffPlayerRow | null>(null)
const pwdResult = ref<{ username: string; password: string } | null>(null)

/* 单玩家飞盘：接口一直都有，之前只有电脑端后台能改，代理在手机上只能整房一刀切 */
const flyConfirmVisible = ref(false)
const flyBusyId = ref<string | null>(null)
const flyTarget = ref<StaffPlayerRow | null>(null)
const flyTargetNext = computed(() => flyTarget.value?.flyEnabled === false)

const visibleRooms = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  const hits = searchHits.value
  if (hits) {
    return rooms.value.filter((r) => (hits[r.id]?.length || 0) > 0)
  }
  if (!q) return rooms.value
  return rooms.value.filter((r) => {
    const agent = `${r.agent?.nickname || ''} ${r.agent?.username || ''}`.toLowerCase()
    const general = `${r.general?.nickname || ''} ${r.general?.username || ''}`.toLowerCase()
    return (
      r.name.toLowerCase().includes(q)
      || r.roomNo.includes(q)
      || agent.includes(q)
      || general.includes(q)
    )
  })
})

const totalPlayersShown = computed(() => {
  if (searchHits.value) {
    return Object.values(searchHits.value).reduce((n, arr) => n + arr.length, 0)
  }
  return rooms.value.reduce((n, r) => n + (r.memberCount || 0), 0)
})

type PlayerBlock = {
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
  members: number
  rooms: StaffRoom[]
}

const playerBlocks = computed<PlayerBlock[]>(() => {
  const blocks: PlayerBlock[] = []
  const seen = new Set<string>()
  for (const room of visibleRooms.value) {
    const gid = isGeneral.value ? '' : (room.general?.userId || '')
    if (!gid) {
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
        members: 0,
        rooms: [room],
      })
      continue
    }
    if (seen.has(gid)) continue
    seen.add(gid)
    const groupRooms = visibleRooms.value.filter((item) => item.general?.userId === gid)
    const wallet = generalMap.value[gid]
    const credit = wallet?.bookMode === 'CREDIT'
    blocks.push({
      key: gid,
      kind: 'general',
      name: String(room.general?.nickname || room.general?.username || wallet?.nickname || '总代').trim(),
      sharePct: pctOfRate(wallet?.shareRate ?? room.general?.shareRate),
      flowPct: pctOfRate(wallet?.flowRate ?? room.general?.flowRate),
      bookLabel: wallet ? (credit ? 'B·信用' : 'A·现金') : '—',
      quotaLabel: credit ? '剩余信用' : '可用额度',
      quotaText: moneyOrDash(wallet, wallet?.pointsQuota),
      secondLabel: credit ? '合同额度' : '余额',
      secondText: moneyOrDash(wallet, credit ? wallet?.creditLimit : wallet?.agentBalance ?? wallet?.balance),
      members: groupRooms.reduce((sum, item) => sum + roomPlayerCount(item), 0),
      rooms: groupRooms,
    })
  }
  return blocks
})

const openedGenerals = ref<Record<string, boolean>>({})
function isGeneralOpen(key: string) {
  if (openedGenerals.value[key] != null) return openedGenerals.value[key]
  if (searchHits.value) return true
  const groups = playerBlocks.value.filter((b) => b.kind === 'general')
  return groups.length <= 1 || groups[0]?.key === key
}
function toggleGeneral(key: string) {
  openedGenerals.value = { ...openedGenerals.value, [key]: !isGeneralOpen(key) }
}

function fmt(n?: number) {
  return formatMoney(n ?? 0)
}
function statusLabel(s?: string) {
  return ({ OPEN: '营业', CLOSED: '关闭', MAINTENANCE: '维护', FROZEN: '冻结' } as Record<string, string>)[s || ''] || s || '—'
}
function isOpen(id: string) {
  return openIds.value.includes(id)
}
function playersOf(roomId: string) {
  if (searchHits.value) return searchHits.value[roomId] || []
  return playersByRoom[roomId] || []
}
function roomPlayerCount(r: StaffRoom) {
  if (searchHits.value) return searchHits.value[r.id]?.length || 0
  if (roomTotals[r.id] != null) return roomTotals[r.id]
  return r.memberCount ?? 0
}

async function loadRoomPlayers(roomId: string) {
  roomLoading[roomId] = true
  try {
    const res = await staffConsoleApi.players({
      page: 1,
      pageSize: 100,
      roomId,
    })
    playersByRoom[roomId] = res.list || []
    roomTotals[roomId] = res.total
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载玩家失败')
    playersByRoom[roomId] = []
  } finally {
    roomLoading[roomId] = false
  }
}

async function toggleRoom(roomId: string) {
  if (isOpen(roomId)) {
    openIds.value = openIds.value.filter((id) => id !== roomId)
    return
  }
  openIds.value = [...openIds.value, roomId]
  if (!searchHits.value && !playersByRoom[roomId]) {
    await loadRoomPlayers(roomId)
  }
}

async function onSearch() {
  const q = keyword.value.trim()
  if (!q) {
    searchHits.value = null
    return
  }
  /* 房间名/进房码命中：只筛房间，不展开玩家搜索 */
  const roomOnly = rooms.value.some((r) => {
    const agent = `${r.agent?.nickname || ''} ${r.agent?.username || ''}`.toLowerCase()
    const general = `${r.general?.nickname || ''} ${r.general?.username || ''}`.toLowerCase()
    const qq = q.toLowerCase()
    return r.name.toLowerCase().includes(qq) || r.roomNo.includes(q) || agent.includes(qq) || general.includes(qq)
  })
  const looksLikePlayer = !roomOnly || q.length >= 2

  loading.value = true
  try {
    if (!looksLikePlayer && roomOnly) {
      searchHits.value = null
      return
    }
    const hits: Record<string, StaffPlayerRow[]> = {}
    await Promise.all(
      rooms.value.map(async (r) => {
        const res = await staffConsoleApi.players({
          page: 1,
          pageSize: 50,
          roomId: r.id,
          q,
        })
        if (res.list?.length) hits[r.id] = res.list
      }),
    )
    searchHits.value = hits
    openIds.value = Object.keys(hits)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '搜索失败')
  } finally {
    loading.value = false
  }
}

async function loadRooms() {
  loading.value = true
  try {
    const [list, gens] = await Promise.all([
      staffConsoleApi.rooms(),
      loadStaffGenerals().catch(() => ({})),
    ])
    rooms.value = list || []
    generalMap.value = gens
    searchHits.value = null
    /* 默认展开第一间，方便一眼看到玩家 */
    openIds.value = []
    Object.keys(playersByRoom).forEach((k) => { delete playersByRoom[k] })
    if (rooms.value.length === 1) {
      openIds.value = [rooms.value[0].id]
      await loadRoomPlayers(rooms.value[0].id)
    }
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载房间失败')
    rooms.value = []
  } finally {
    loading.value = false
  }
}

async function reload() {
  if (useRoomGroups.value) {
    const q = keyword.value.trim()
    await loadRooms()
    if (q) await onSearch()
    return
  }
  await reloadAgent()
}

/* —— 代理端原逻辑 —— */
function closeFund() {
  if (fundBusy.value) return
  fundVisible.value = false
  confirmVisible.value = false
}
function openFund(p: StaffPlayerRow, mode: 'up' | 'down') {
  fundTarget.value = p
  fundMode.value = mode
  fundAmount.value = mode === 'up' ? PLAYER_UP_MIN : PLAYER_DOWN_MIN
  fundRemark.value = ''
  fundOrderNo.value = newFundOrderNo(mode)
  confirmVisible.value = false
  fundVisible.value = true
}
function validateFundAmount(amount: number) {
  if (!amount || amount <= 0) {
    toast('请输入金额')
    return false
  }
  if (fundMode.value === 'up') {
    if (amount < PLAYER_UP_MIN) { toast(`上分最低 ${PLAYER_UP_MIN}`); return false }
    if (amount > PLAYER_FUND_MAX) { toast(`单笔上分不超过 ${PLAYER_FUND_MAX}`); return false }
  } else {
    if (amount < PLAYER_DOWN_MIN) { toast(`下分最低 ${PLAYER_DOWN_MIN}`); return false }
    if (amount > PLAYER_FUND_MAX) { toast(`单笔下分不超过 ${PLAYER_FUND_MAX}`); return false }
  }
  return true
}
function askFundConfirm() {
  if (!fundTarget.value) return
  const amount = Number(fundAmount.value)
  if (!validateFundAmount(amount)) return
  confirmVisible.value = true
}
async function doFund() {
  if (!fundTarget.value) return
  const amount = Number(fundAmount.value)
  if (!validateFundAmount(amount)) return
  const roomId = activeRoomId.value
  if (!roomId) {
    toast('你名下有多间房，请先从房间进入玩家列表再上下分')
    return
  }
  const rid = String(fundOrderNo.value || '').trim()
  if (rid.length < 8) {
    toast('订单号无效，请关闭后重新打开')
    return
  }
  fundBusy.value = true
  try {
    if (fundMode.value === 'up') {
      const res = await staffConsoleApi.creditPlayer(
        fundTarget.value.id,
        amount,
        roomId,
        fundRemark.value || undefined,
        rid,
      )
      const orderTip = res?.orderNo || rid
      toast(
        isCreditBook.value
          ? `上分成功 · ${orderTip} · 已扣剩余信用 ${fmt(amount)}`
          : `上分成功 · ${orderTip} · 已扣可用额度 ${fmt(amount)}`,
      )
    } else {
      const res = await staffConsoleApi.debitPlayer(
        fundTarget.value.id,
        amount,
        roomId,
        fundRemark.value || undefined,
        rid,
      )
      toast(`下分成功 · ${res?.orderNo || rid}`)
    }
    fundVisible.value = false
    confirmVisible.value = false
    await reloadAgent()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    fundBusy.value = false
  }
}

function askFly(p: StaffPlayerRow) {
  if (flyBusyId.value) return
  flyTarget.value = p
  flyConfirmVisible.value = true
}

async function doSetFly() {
  const target = flyTarget.value
  if (!target) return
  const next = flyTargetNext.value
  flyBusyId.value = target.id
  try {
    await staffConsoleApi.setPlayerFly(target.id, next, activeRoomId.value || undefined)
    const row = list.value.find((x) => x.id === target.id)
    if (row) row.flyEnabled = next
    flyConfirmVisible.value = false
    flyTarget.value = null
    toast(next ? '已开启飞盘' : '已关闭飞盘')
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    flyBusyId.value = null
  }
}

function askResetPwd(p: StaffPlayerRow) {
  pwdTarget.value = p
  pwdConfirmVisible.value = true
}
async function doResetPwd() {
  if (!pwdTarget.value) return
  pwdBusy.value = true
  try {
    const res = await staffConsoleApi.resetPlayerPassword(pwdTarget.value.id)
    pwdConfirmVisible.value = false
    pwdResult.value = {
      username: res.username || pwdTarget.value.username,
      password: res.password,
    }
    pwdResultVisible.value = true
    toast(res.message || '密码已重置并解冻')
    await reload()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '重置失败')
  } finally {
    pwdBusy.value = false
  }
}
async function copyPwdResult() {
  if (!pwdResult.value) return
  const text = `账号：${pwdResult.value.username}\n密码：${pwdResult.value.password}`
  try {
    await navigator.clipboard.writeText(text)
    toast('已复制')
  } catch {
    toast('复制失败，请手动记下')
  }
}

async function fetchPage(p: number, append: boolean) {
  loading.value = true
  try {
    /* 带上房间，余额才是本房的；不带会把多房余额加在一起，看着像多出一笔钱 */
    const res = await staffConsoleApi.players({
      page: p,
      pageSize,
      q: keyword.value.trim() || undefined,
      roomId: activeRoomId.value || undefined,
    })
    total.value = res.total
    page.value = res.page
    list.value = append ? [...list.value, ...res.list] : res.list
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}
function reloadAgent() {
  return fetchPage(1, false)
}
function loadMore() {
  return fetchPage(page.value + 1, true)
}

onMounted(async () => {
  void staffConsoleApi.walletMe().then((w) => {
    isCreditBook.value = w?.bookMode === 'CREDIT'
  }).catch(() => { isCreditBook.value = false })

  if (useRoomGroups.value) {
    await loadRooms()
    const qRoomId = typeof route.query.roomId === 'string' ? route.query.roomId : ''
    if (qRoomId && rooms.value.some((r) => r.id === qRoomId)) {
      openIds.value = [qRoomId]
      await loadRoomPlayers(qRoomId)
    }
  } else {
    /* 只绑一间房就把它认下来，用户不必再绕回房间页 */
    if (!activeRoomId.value && canFund.value) {
      try {
        const mine = (await staffConsoleApi.rooms()) || []
        if (mine.length === 1) fallbackRoomId.value = mine[0].id
      } catch {
        /* 拉不到就退回「请先选房」，不挡列表 */
      }
    }
    await fetchPage(1, false)
  }
})
</script>

<style scoped>
.pl-block { margin-bottom: 12px; }
.pl-room {
  display: block;
  width: 100%;
  padding: 14px;
  text-align: left;
  color: inherit;
  cursor: pointer;
  border-radius: 14px;
  border: 2px solid transparent;
  background:
    radial-gradient(120% 90% at 100% 0%, rgba(245, 158, 11, 0.14), transparent 55%),
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
    0 0 0 1px rgba(244, 211, 107, 0.18),
    0 6px 18px rgba(0, 0, 0, 0.38);
  -webkit-tap-highlight-color: transparent;
}
.pl-room:active { transform: scale(0.992); }
.pl-room.sg-head .pl-room-ft {
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 6px 12px;
}
.pl-room-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.pl-room-name {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #f5d36b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pl-room-meta {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 10px;
}
.pl-room-ft {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 10px;
  border-top: 1px solid rgba(212, 175, 55, 0.14);
  font-size: 12px;
  color: var(--text-muted);
}
.pl-room-ft .arrow {
  color: #f5d36b;
  letter-spacing: 1px;
}
.pl-players {
  margin-top: 8px;
  padding-left: 2px;
}
.sp-empty.tight {
  padding: 14px 8px;
  font-size: 12px;
}

.sp-lock {
  margin-left: 6px;
  padding: 2px 7px;
  font-size: 11px;
  color: #fecaca;
  border: 1px solid rgba(252, 165, 165, 0.45);
  background: rgba(127, 29, 29, 0.3);
  border-radius: 999px;
  vertical-align: middle;
}
.sp-lock.is-off {
  color: #f5d36b;
  border-color: rgba(244, 211, 107, 0.4);
  background: rgba(120, 53, 15, 0.3);
}

/* 当前状态直接写在按钮上：飞盘=绿，关盘=红，跟上盘查询页两个整房按钮同一套配色 */
.pl-fly.is-on {
  color: #bbf7d0;
  border-color: rgba(134, 239, 172, 0.5);
  background: rgba(20, 83, 45, 0.45);
}
.pl-fly.is-off {
  color: #fecaca;
  border-color: rgba(252, 165, 165, 0.5);
  background: rgba(127, 29, 29, 0.45);
}
</style>
