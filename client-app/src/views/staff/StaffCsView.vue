<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page staff-console-page scs-page" :class="{ 'is-chat': !!active }">
    <!-- 会话列表 -->
    <template v-if="!active">
      <div class="app-bar">
        <div class="title">
          <span class="brand-dot"></span>
          <span class="brand-wordmark">客服聊天</span>
        </div>
        <div class="scs-bar-right">
          <button type="button" class="scs-bar-btn" @click="goSettings">设置</button>
          <button type="button" class="scs-bar-btn" @click="loadSessions">{{ sessionsLoading ? '…' : '刷新' }}</button>
        </div>
      </div>

      <div class="page-body">
        <div class="scs-head">
          <span>未读 {{ unreadTotal }}</span>
          <button v-if="canPlayerFund" type="button" class="scs-link" @click="goPlayers">去给玩家上下分</button>
          <button v-else-if="canReviewFund" type="button" class="scs-link" @click="goFund">去审核申请</button>
        </div>

        <div v-if="sessionsLoading && !sessions.length" class="sp-empty">加载中…</div>
        <div v-else-if="!sessions.length" class="sp-empty">暂无会话，玩家发消息后会出现在这里</div>

        <button
          v-for="s in sessions"
          :key="s.playerId"
          type="button"
          class="scs-row"
          @click="openSession(s)"
        >
          <span class="scs-av">{{ (s.nickname || '?').slice(0, 1) }}</span>
          <span class="scs-body">
            <span class="scs-top">
              <b>{{ s.nickname || '玩家' }}</b>
              <em>{{ fmtShort(s.lastAt) }}</em>
            </span>
            <span class="scs-preview">
              <i v-if="s.unread" class="scs-dot">{{ s.unread > 99 ? '99+' : s.unread }}</i>
              {{ previewSender(s.lastSender) }}{{ previewText(s.lastText) }}
            </span>
          </span>
        </button>
      </div>
    </template>

    <!-- 聊天室：消息滚动；快捷发送 + 输入钉在底部 -->
    <template v-else>
      <div class="app-bar scs-chat-bar">
        <div class="back" @click="closeSession">‹</div>
        <div class="title scs-chat-title">
          <b>{{ active.nickname }}</b>
          <em>{{ active.uid }}</em>
        </div>
        <div class="scs-bar-right">
          <button type="button" class="scs-bar-btn" @click="goSettings">设置</button>
          <button type="button" class="scs-bar-btn" @click="reloadChat">{{ msgLoading ? '…' : '刷新' }}</button>
        </div>
      </div>

      <div class="scs-chat">
        <div ref="bubblesEl" class="scs-msgs">
          <div v-if="msgLoading && !messages.length" class="sp-empty">加载中…</div>
          <div v-else-if="!messages.length" class="sp-empty">暂无消息，可直接回复</div>
          <div
            v-for="m in messages"
            :key="m.id"
            class="scs-msg"
            :class="bubbleClass(m.sender)"
          >
            <div class="scs-bubble">
              <p v-if="msgCaption(m.text)">{{ msgCaption(m.text) }}</p>
              <PrivateMediaImage
                v-if="msgImage(m.text)"
                class="scs-img"
                :src="msgImage(m.text)"
                session="staff"
                alt=""
              />
              <time>{{ fmtClock(m.createdAt) }}</time>
            </div>
          </div>
        </div>

        <div class="scs-dock">
          <div class="scs-ops">
            <button v-if="canPlayerFund" type="button" @click="goPlayers">上下分</button>
            <button v-if="canReviewFund" type="button" @click="goFund">审申请</button>
            <button type="button" :disabled="sending" @click="sendPayQr('wechat')">发微信码</button>
            <button type="button" :disabled="sending" @click="sendPayQr('alipay')">发支付宝码</button>
            <button
              v-if="canReviewFund"
              type="button"
              class="scs-ops-review"
              @click="openPlayerFund"
            >
              审本单
              <i v-if="playerFundCount > 0" class="scs-ops-review-n">{{ playerFundCount > 99 ? '99+' : playerFundCount }}</i>
            </button>
          </div>
          <div v-if="quickReplies.length" class="scs-quick">
            <button
              v-for="(t, i) in quickReplies"
              :key="i"
              type="button"
              @click="sendQuick(t)"
            >{{ shortLabel(t) }}</button>
          </div>
          <div class="scs-composer">
            <textarea
              v-model="draft"
              rows="1"
              placeholder="输入回复…"
              :disabled="sending"
              @keydown.enter.exact.prevent="send"
            ></textarea>
            <button
              type="button"
              class="scs-send"
              :disabled="!draft.trim() || sending"
              @click="send"
            >发送</button>
            <button
              type="button"
              class="scs-img-btn"
              :disabled="sending"
              aria-label="发送图片"
              @click="pickImage"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3.5" y="5.5" width="17" height="13" rx="2"/>
                <circle cx="9" cy="10" r="1.6"/>
                <path d="M3.5 15.5l4.5-4 3.5 3 3-2.5 6 5.5"/>
              </svg>
            </button>
            <input
              ref="fileEl"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              @change="onImagePicked"
            >
          </div>
        </div>
      </div>

      <!-- 当前玩家上下分待审 -->
      <div v-if="fundSheetVisible" class="sp-sheet scs-fund-sheet" @click.self="closeFundSheet">
        <div class="sp-sheet-panel scs-fund-panel">
          <h3>上下分审核</h3>
          <p class="hint">{{ active?.nickname || '玩家' }} · {{ active?.uid || '' }}</p>

          <div v-if="fundLoading" class="sp-empty">加载中…</div>
          <div v-else-if="!playerFunds.length" class="sp-empty">该玩家暂无待审申请</div>

          <div v-for="row in playerFunds" :key="row.id" class="scs-fund-row">
            <div class="scs-fund-top">
              <span class="scs-fund-tag" :class="row.type === 'UP' ? 'up' : 'down'">
                {{ row.type === 'UP' ? '上分' : '下分' }}
              </span>
              <b :class="row.type === 'UP' ? 'up' : 'down'">{{ fmtAmount(row.amount) }}</b>
            </div>
            <div class="scs-fund-meta">
              <template v-if="channelLabel(row.channel)">{{ channelLabel(row.channel) }} · </template>
              {{ fmtFundTime(row.createdAt) }}
            </div>
            <div class="scs-fund-ops">
              <button
                type="button"
                class="ok"
                :disabled="fundBusyId === row.id"
                @click="approveFund(row)"
              >通过</button>
              <button
                type="button"
                class="no"
                :disabled="fundBusyId === row.id"
                @click="openReject(row)"
              >拒绝</button>
            </div>
          </div>

          <div class="sp-sheet-actions">
            <button type="button" class="cancel" @click="closeFundSheet">关闭</button>
          </div>
        </div>
      </div>

      <div v-if="rejectVisible" class="sp-sheet" @click.self="closeReject">
        <div class="sp-sheet-panel">
          <h3>拒绝申请</h3>
          <p class="hint">
            {{ rejectTarget?.type === 'UP' ? '上分' : '下分' }}
            {{ fmtAmount(rejectTarget?.amount) }}
          </p>
          <input v-model="rejectReason" type="text" maxlength="40" placeholder="原因（可选）">
          <div class="sp-sheet-actions">
            <button type="button" class="cancel" :disabled="!!fundBusyId" @click="closeReject">取消</button>
            <button type="button" class="ok warn" :disabled="!!fundBusyId" @click="doReject">确认拒绝</button>
          </div>
        </div>
      </div>
    </template>

    <AppModal
      :visible="approveVisible"
      title="确认通过"
      :message="approveMessage"
      ok-text="确认通过"
      cancel-text="取消"
      @ok="doApproveFund"
      @cancel="closeApprove"
    />

    <StaffTabBar v-if="!active" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppModal from '@/components/AppModal.vue'
import PrivateMediaImage from '@/components/PrivateMediaImage.vue'
import StaffTabBar from '@/components/StaffTabBar.vue'
import {
  staffConsoleApi,
  type StaffCsMessage,
  type StaffCsSession,
  type StaffFundOrder,
} from '@/api/staffConsole'
import { useStaffStore } from '@/stores/staff'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { fetchStaffPaySettings, loadStaffPaySettings } from '@/utils/staffPaySettings'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const route = useRoute()
const router = useRouter()
const staff = useStaffStore()
const { toast } = useToast()

const canPlayerFund = computed(() => staff.role === 'AGENT')
const canReviewFund = computed(() => staff.role === 'AGENT' || staff.role === 'CS')

const sessionsLoading = ref(false)
const sessions = ref<StaffCsSession[]>([])
const active = ref<StaffCsSession | null>(null)
const messages = ref<StaffCsMessage[]>([])
const msgLoading = ref(false)
const draft = ref('')
const sending = ref(false)
const fileEl = ref<HTMLInputElement | null>(null)
const bubblesEl = ref<HTMLElement | null>(null)
const quickReplies = ref<string[]>([])
const paySettingsCache = ref<{
  quickReplies: string[]
  wechatQrs: Array<{ id: string; url: string; note?: string; name?: string }>
  alipayQrs: Array<{ id: string; url: string; note?: string; name?: string }>
} | null>(null)

const fundSheetVisible = ref(false)
const fundLoading = ref(false)
const playerFunds = ref<StaffFundOrder[]>([])
const playerFundCount = ref(0)
const fundBusyId = ref<string | null>(null)
const rejectVisible = ref(false)
const rejectTarget = ref<StaffFundOrder | null>(null)
const rejectReason = ref('')
const approveVisible = ref(false)
const approveTarget = ref<StaffFundOrder | null>(null)
const approveMessage = computed(() => {
  const row = approveTarget.value
  if (!row) return ''
  return (
    `确认通过${row.type === 'UP' ? '上分' : '下分'} ${fmtAmount(row.amount)}？`
    + `\n玩家 ${row.player?.nickname || row.player?.uid || active.value?.nickname || '—'}`
    + (row.orderNo ? `\n订单 ${row.orderNo}` : '')
  )
})

let pollTimer: ReturnType<typeof setInterval> | null = null
let activeGeneration = 0

interface ActiveRequest {
  playerId: string
  generation: number
}

function activeRequest(): ActiveRequest | null {
  const playerId = active.value?.playerId
  return playerId ? { playerId, generation: activeGeneration } : null
}

function isActiveRequest(request: ActiveRequest): boolean {
  return request.generation === activeGeneration && active.value?.playerId === request.playerId
}

async function reloadQuickSettings() {
  try {
    const s = await fetchStaffPaySettings(staff.profile?.id || 'anon')
    paySettingsCache.value = s
    quickReplies.value = s.quickReplies || []
  } catch {
    const s = loadStaffPaySettings(staff.profile?.id || 'anon')
    paySettingsCache.value = s
    quickReplies.value = s.quickReplies || []
  }
}

function shortLabel(t: string) {
  const s = String(t || '').trim()
  return s.length > 10 ? `${s.slice(0, 10)}…` : s
}

const unreadTotal = computed(() =>
  sessions.value.reduce((n, s) => n + Number(s.unread || 0), 0),
)

function previewSender(sender?: string) {
  if (sender === 'PLAYER') return ''
  if (sender === 'SYSTEM') return '[系统] '
  if (sender === 'AGENT') return '[我] '
  return ''
}

function previewText(text?: string) {
  const raw = String(text || '').replace(/\[img\]\S+/gi, '[图片]').trim()
  return raw.length > 36 ? `${raw.slice(0, 36)}…` : raw || '—'
}

function msgCaption(text: string) {
  return String(text || '').replace(/\[img\]\S+/gi, '').trim()
}

function msgImage(text: string) {
  const m = String(text || '').match(/\[img\](\S+)/i)
  const u = String(m?.[1] || '').trim()
  if (/^\/api\/cs\/media\/[A-Za-z0-9_-]{10,64}$/.test(u)) return u
  return ''
}

function bubbleClass(sender: string) {
  if (sender === 'SYSTEM') return 'sys'
  if (sender === 'PLAYER') return 'them'
  return 'me'
}

function fmtShort(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `${hh}:${mi}`
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mi}`
}

function fmtClock(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function goPlayers() {
  router.push({ name: 'staff-players' })
}

function goFund() {
  router.push({ name: 'staff-fund' })
}

function goSettings() {
  router.push({ name: 'staff-pay-methods' })
}

function fmtAmount(n?: number | null) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

function fmtFundTime(iso?: string) {
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

async function refreshPlayerFundCount() {
  const request = activeRequest()
  if (!canReviewFund.value || !request) {
    playerFundCount.value = 0
    return
  }
  try {
    const res = await staffConsoleApi.fundPending(1, request.playerId)
    if (!isActiveRequest(request)) return
    playerFundCount.value = Number(res.total || 0)
    if (fundSheetVisible.value) playerFunds.value = res.list || []
  } catch {
    /* ignore badge errors */
  }
}

async function openPlayerFund() {
  const request = activeRequest()
  if (!request) return
  fundSheetVisible.value = true
  rejectVisible.value = false
  fundLoading.value = true
  try {
    const res = await staffConsoleApi.fundPending(1, request.playerId)
    if (!isActiveRequest(request)) return
    playerFunds.value = res.list || []
    playerFundCount.value = Number(res.total || 0)
  } catch (e: unknown) {
    if (isActiveRequest(request)) toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    if (isActiveRequest(request)) fundLoading.value = false
  }
}

function closeFundSheet() {
  if (fundBusyId.value) return
  fundSheetVisible.value = false
  rejectVisible.value = false
}

function approveFund(row: StaffFundOrder) {
  if (fundBusyId.value) return
  approveTarget.value = row
  approveVisible.value = true
}

function closeApprove() {
  if (fundBusyId.value) return
  approveVisible.value = false
  approveTarget.value = null
}

async function doApproveFund() {
  const row = approveTarget.value
  const request = activeRequest()
  if (!row || !request || fundBusyId.value) return
  approveVisible.value = false
  fundBusyId.value = row.id
  try {
    await staffConsoleApi.fundApprove(row.id)
    if (!isActiveRequest(request)) return
    toast('已通过')
    playerFunds.value = playerFunds.value.filter((x) => x.id !== row.id)
    playerFundCount.value = Math.max(0, playerFundCount.value - 1)
    approveTarget.value = null
    await loadMessages(true, request)
  } catch (e: unknown) {
    if (isActiveRequest(request)) toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    if (isActiveRequest(request)) fundBusyId.value = null
  }
}

function openReject(row: StaffFundOrder) {
  rejectTarget.value = row
  rejectReason.value = ''
  rejectVisible.value = true
}

function closeReject() {
  if (fundBusyId.value) return
  rejectVisible.value = false
  rejectTarget.value = null
}

async function doReject() {
  const request = activeRequest()
  if (!rejectTarget.value || !request || fundBusyId.value) return
  const id = rejectTarget.value.id
  fundBusyId.value = id
  try {
    await staffConsoleApi.fundReject(id, rejectReason.value.trim() || '不同意')
    if (!isActiveRequest(request)) return
    toast('已拒绝')
    rejectVisible.value = false
    rejectTarget.value = null
    playerFunds.value = playerFunds.value.filter((x) => x.id !== id)
    playerFundCount.value = Math.max(0, playerFundCount.value - 1)
    await loadMessages(true, request)
  } catch (e: unknown) {
    if (isActiveRequest(request)) toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    if (isActiveRequest(request)) fundBusyId.value = null
  }
}

async function sendQuick(text: string) {
  const t = String(text || '').trim()
  if (!t || !active.value || sending.value) return
  draft.value = t
  await send()
}

async function sendPayQr(kind: 'wechat' | 'alipay') {
  const request = activeRequest()
  if (!request || sending.value) return
  let settings = paySettingsCache.value
  try {
    settings = await fetchStaffPaySettings(staff.profile?.id || 'anon')
    if (isActiveRequest(request)) {
      paySettingsCache.value = settings
      quickReplies.value = settings.quickReplies || []
    }
  } catch {
    settings = settings || loadStaffPaySettings(staff.profile?.id || 'anon')
  }
  if (!isActiveRequest(request)) return
  const list = kind === 'wechat' ? settings.wechatQrs : settings.alipayQrs
  if (!list.length) {
    toast(kind === 'wechat' ? '请先在收款方式上传微信码' : '请先在收款方式上传支付宝码')
    router.push({ name: 'staff-pay-methods' })
    return
  }
  const caption = kind === 'wechat' ? '微信收款码' : '支付宝收款码'
  const text = `${caption}\n[img]${list[0].url}`
  if (!isActiveRequest(request)) return
  sending.value = true
  try {
    const res = await staffConsoleApi.csReply(request.playerId, text)
    if (!isActiveRequest(request)) return
    if (res.message) messages.value = [...messages.value, res.message]
    else await loadMessages(true, request)
    await scrollBottom()
  } catch (e: unknown) {
    if (isActiveRequest(request)) toast(e instanceof Error ? e.message : '发送失败')
  } finally {
    if (isActiveRequest(request)) sending.value = false
  }
}

async function scrollBottom() {
  await nextTick()
  const el = bubblesEl.value
  if (el) el.scrollTop = el.scrollHeight
}

async function loadSessions() {
  sessionsLoading.value = true
  try {
    const res = await staffConsoleApi.csSessions()
    sessions.value = res.list || []
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    sessionsLoading.value = false
  }
}

async function loadMessages(silent = false, fixedRequest?: ActiveRequest) {
  const request = fixedRequest || activeRequest()
  if (!request || !isActiveRequest(request)) return
  if (!silent) msgLoading.value = true
  try {
    const res = await staffConsoleApi.csMessages(request.playerId)
    if (!isActiveRequest(request)) return
    const prevLen = messages.value.length
    messages.value = res.list || []
    if (!silent || messages.value.length !== prevLen) await scrollBottom()
  } catch (e: unknown) {
    if (!silent && isActiveRequest(request)) toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    if (isActiveRequest(request)) msgLoading.value = false
  }
}

async function openSession(s: StaffCsSession) {
  activeGeneration += 1
  active.value = s
  messages.value = []
  draft.value = ''
  sending.value = false
  msgLoading.value = false
  fundLoading.value = false
  fundBusyId.value = null
  playerFunds.value = []
  playerFundCount.value = 0
  fundSheetVisible.value = false
  reloadQuickSettings()
  const request = activeRequest()
  if (!request) return
  await router.replace({ name: 'staff-cs', query: { playerId: s.playerId } })
  if (!isActiveRequest(request)) return
  await loadMessages(false, request)
  void refreshPlayerFundCount()
  try {
    await staffConsoleApi.csRead(request.playerId)
    if (isActiveRequest(request)) s.unread = 0
  } catch {
    /* ignore */
  }
}

async function closeSession() {
  activeGeneration += 1
  active.value = null
  messages.value = []
  playerFunds.value = []
  playerFundCount.value = 0
  fundSheetVisible.value = false
  sending.value = false
  msgLoading.value = false
  fundLoading.value = false
  fundBusyId.value = null
  await router.replace({ name: 'staff-cs', query: {} })
  await loadSessions()
}

async function reloadChat() {
  const request = activeRequest()
  if (!request) return
  await loadMessages(false, request)
  if (isActiveRequest(request)) {
    try {
      await staffConsoleApi.csRead(request.playerId)
      if (isActiveRequest(request) && active.value) active.value.unread = 0
    } catch {
      /* ignore */
    }
  }
}

async function send() {
  const request = activeRequest()
  if (!request || sending.value) return
  const text = draft.value.trim()
  if (!text) return
  sending.value = true
  try {
    const res = await staffConsoleApi.csReply(request.playerId, text)
    if (!isActiveRequest(request)) return
    draft.value = ''
    if (res.message) messages.value = [...messages.value, res.message]
    else await loadMessages(true, request)
    await scrollBottom()
  } catch (e: unknown) {
    if (isActiveRequest(request)) toast(e instanceof Error ? e.message : '发送失败')
  } finally {
    if (isActiveRequest(request)) sending.value = false
  }
}

function pickImage() {
  if (!active.value || sending.value) return
  fileEl.value?.click()
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

async function onImagePicked(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const request = activeRequest()
  if (!file || !request || sending.value) return
  if (file.size > 8_000_000) {
    toast('图片请小于 8MB')
    return
  }
  sending.value = true
  try {
    const dataUrl = await readAsDataUrl(file)
    const up = await staffConsoleApi.csUploadImage(dataUrl)
    const res = await staffConsoleApi.csReply(request.playerId, `[img]${up.url}`)
    if (!isActiveRequest(request)) return
    if (res.message) messages.value = [...messages.value, res.message]
    else await loadMessages(true, request)
    await scrollBottom()
  } catch (e: unknown) {
    if (isActiveRequest(request)) toast(e instanceof Error ? e.message : '图片发送失败')
  } finally {
    if (isActiveRequest(request)) sending.value = false
  }
}

function startPoll() {
  stopPoll()
  pollTimer = setInterval(() => {
    if (active.value) {
      void loadMessages(true)
      if (canReviewFund.value) void refreshPlayerFundCount()
    } else void loadSessions()
  }, 5000)
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

onActivated(() => { reloadQuickSettings() })

onMounted(async () => {
  reloadQuickSettings()
  await loadSessions()
  const pid = typeof route.query.playerId === 'string' ? route.query.playerId : ''
  if (pid) {
    const hit = sessions.value.find((s) => s.playerId === pid)
    if (hit) await openSession(hit)
    else {
      active.value = {
        playerId: pid,
        uid: '',
        nickname: '玩家',
        avatar: null,
        lastText: '',
        lastSender: '',
        lastAt: '',
        unread: 0,
      }
      reloadQuickSettings()
      await loadMessages()
      void refreshPlayerFundCount()
    }
  }
  startPoll()
})

onUnmounted(() => { stopPoll() })
</script>

<style scoped>
.scs-page {
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}
/* 聊天态：锁死视口高度，输入框永远贴底，消息区内部滚动 */
.scs-page.is-chat {
  height: 100vh;
  height: 100dvh;
  max-height: 100vh;
  max-height: 100dvh;
  overflow: hidden;
}
.scs-page.is-chat :deep(.app-bar),
.scs-page.is-chat .scs-chat-bar {
  flex-shrink: 0;
}
.scs-bar-right {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 5;
  display: flex;
  gap: 6px;
}
.scs-bar-btn {
  height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(244, 211, 107, 0.45);
  background: linear-gradient(180deg, rgba(72, 48, 20, 0.55) 0%, rgba(28, 18, 8, 0.9) 100%);
  color: #fff4c2;
  font-size: 12px;
  letter-spacing: 1px;
  cursor: pointer;
}
.scs-bar-btn:active {
  filter: brightness(1.12);
}
.scs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 2px 12px;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.55);
}
.scs-link {
  border: 0;
  background: transparent;
  color: var(--gold-bright);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.scs-row {
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  margin-bottom: 8px;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.22);
  background: rgba(16, 12, 8, 0.85);
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.scs-row:active { background: rgba(244, 211, 107, 0.06); }
.scs-av {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: linear-gradient(160deg, #6b4a1a, #2a1a0a);
  border: 1px solid rgba(244, 211, 107, 0.35);
  color: #fff4c2;
  font-weight: 700;
}
.scs-body { flex: 1; min-width: 0; }
.scs-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.scs-top b {
  font-size: 15px;
  color: #fff4c2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scs-top em {
  flex-shrink: 0;
  font-style: normal;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.45);
}
.scs-preview {
  display: block;
  font-size: 12px;
  color: rgba(255, 244, 194, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scs-dot {
  display: inline-block;
  min-width: 16px;
  height: 16px;
  margin-right: 4px;
  padding: 0 4px;
  border-radius: 999px;
  background: #dc2626;
  color: #fff;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  vertical-align: 1px;
}

.scs-chat-title {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  line-height: 1.2;
}
.scs-chat-title b {
  font-size: 15px;
  font-weight: 650;
  color: #fff4c2;
}
.scs-chat-title em {
  font-style: normal;
  font-size: 11px;
  color: rgba(244, 211, 107, 0.5);
}

.scs-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}
.scs-msgs {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 8px 12px 12px;
  -webkit-overflow-scrolling: touch;
}

.scs-dock {
  flex-shrink: 0;
  border-top: 1px solid rgba(212, 175, 55, 0.18);
  background: rgba(12, 9, 6, 0.98);
}
.scs-ops,
.scs-quick {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  padding: 8px 12px 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.scs-ops button,
.scs-quick button {
  flex-shrink: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(212, 175, 55, 0.3);
  background: rgba(0, 0, 0, 0.25);
  color: rgba(255, 244, 194, 0.8);
  font-size: 12px;
  cursor: pointer;
}
.scs-ops button.scs-ops-review {
  position: relative;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid rgba(212, 175, 55, 0.65);
  background: linear-gradient(180deg, #e8c96a 0%, #b8922e 100%);
  color: #2a1a08;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  box-shadow: 0 2px 8px rgba(184, 146, 46, 0.35);
}
.scs-ops button.scs-ops-review:active {
  filter: brightness(1.08);
}
.scs-ops-review-n {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #dc2626;
  color: #fff;
  font-size: 10px;
  font-style: normal;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px rgba(12, 9, 6, 0.95);
}
.scs-fund-sheet .scs-fund-panel {
  max-height: min(72vh, 560px);
  overflow-y: auto;
}
.scs-fund-row {
  margin: 0 0 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 55, 0.22);
  background: rgba(0, 0, 0, 0.22);
}
.scs-fund-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.scs-fund-tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  letter-spacing: 1px;
}
.scs-fund-tag.up {
  color: #86efac;
  background: rgba(22, 101, 52, 0.35);
  border: 1px solid rgba(134, 239, 172, 0.35);
}
.scs-fund-tag.down {
  color: #fca5a5;
  background: rgba(127, 29, 29, 0.35);
  border: 1px solid rgba(252, 165, 165, 0.35);
}
.scs-fund-top b {
  font-size: 18px;
}
.scs-fund-top b.up { color: #86efac; }
.scs-fund-top b.down { color: #fca5a5; }
.scs-fund-meta {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(244, 211, 107, 0.5);
}
.scs-fund-ops {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.scs-fund-ops button {
  flex: 1;
  height: 36px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
}
.scs-fund-ops button.ok {
  border-color: rgba(34, 197, 94, 0.55);
  background: rgba(22, 101, 52, 0.45);
  color: #bbf7d0;
}
.scs-fund-ops button.no {
  border-color: rgba(248, 113, 113, 0.55);
  background: rgba(127, 29, 29, 0.45);
  color: #fecaca;
}
.scs-fund-ops button:disabled {
  opacity: 0.55;
}
.scs-quick {
  padding-top: 6px;
  padding-bottom: 0;
}
.scs-msg {
  display: flex;
  margin-bottom: 10px;
}
.scs-msg.me { justify-content: flex-end; }
.scs-msg.them { justify-content: flex-start; }
.scs-msg.sys { justify-content: center; }
.scs-bubble {
  max-width: 78%;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(40, 28, 14, 0.95);
  border: 1px solid rgba(212, 175, 55, 0.22);
  color: #fff4c2;
}
.scs-msg.me .scs-bubble {
  background: linear-gradient(165deg, rgba(88, 60, 22, 0.95), rgba(40, 26, 10, 0.98));
  border-color: rgba(244, 211, 107, 0.4);
}
.scs-msg.sys .scs-bubble {
  max-width: 90%;
  background: transparent;
  border: 0;
  color: rgba(244, 211, 107, 0.5);
  font-size: 12px;
  text-align: center;
  padding: 4px 8px;
}
.scs-bubble p {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.scs-bubble time {
  display: block;
  margin-top: 6px;
  font-size: 10px;
  color: rgba(244, 211, 107, 0.4);
}
.scs-msg.me .scs-bubble time { text-align: right; }
.scs-msg.sys .scs-bubble time { display: none; }
.scs-img {
  display: block;
  max-width: 100%;
  max-height: 220px;
  margin-top: 6px;
  border-radius: 8px;
}

.scs-composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 8px 12px calc(10px + env(safe-area-inset-bottom, 0px));
  z-index: 6;
}
.scs-composer textarea {
  flex: 1;
  min-height: 40px;
  max-height: 100px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 55, 0.28);
  background: rgba(0, 0, 0, 0.35);
  color: #fff4c2;
  font-size: 14px;
  resize: none;
  outline: none;
}
.scs-send {
  height: 40px;
  padding: 0 14px;
  border-radius: 12px;
  border: 0;
  background: linear-gradient(180deg, #f5d36b 0%, #c9a227 100%);
  color: #1a120a;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 1px;
  cursor: pointer;
}
.scs-send:disabled {
  opacity: 0.45;
  cursor: default;
}
.scs-img-btn {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(212, 175, 55, 0.4);
  background: rgba(20, 14, 8, 0.9);
  color: #fff4c2;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.scs-img-btn svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.scs-img-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
