<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page cs-page">

    <div class="app-bar">
      <div class="back" @click="goBack">‹</div>
      <div class="title">在 线 客 服</div>
      <div class="right"></div>
    </div>

    <h1 class="cs-title">在 线 客 服</h1>

    <div class="cs-messages" ref="msgListEl">
      <template v-for="m in viewMessages" :key="m.key">
        <div v-if="m.type === 'time'" class="cs-time">{{ m.text }}</div>
        <div v-else-if="m.type === 'agent'" class="cs-msg agent">
          <div class="cs-bubble-avatar"><img :src="AGENT_AVATAR" alt=""></div>
          <div class="cs-bubble">
            <template v-if="m.caption">{{ m.caption }}</template>
            <PrivateMediaImage
              v-if="m.img"
              class="cs-bubble-img"
              :src="m.img"
              session="player"
              alt="收款码"
            />
          </div>
        </div>
        <div v-else-if="m.type === 'user'" class="cs-msg user">
          <div class="cs-bubble">
            <template v-if="m.caption">{{ m.caption }}</template>
            <PrivateMediaImage
              v-if="m.img"
              class="cs-bubble-img"
              :src="m.img"
              session="player"
              alt=""
            />
          </div>
        </div>
      </template>
    </div>

    <div class="cs-composer">
      <textarea
        ref="inputEl"
        v-model="draft"
        class="cs-input"
        rows="1"
        placeholder="输入消息，如：上分500 / 下分500"
        autocomplete="off"
        :disabled="sending"
        @keydown.enter.exact.prevent="send"
        @input="autoGrow"
      ></textarea>

      <button
        :class="['cs-send', draft.trim() && !sending ? '' : 'disabled']"
        type="button"
        aria-label="发送"
        @click="send"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 11.5l18-8-7 19-3-8-8-3z" stroke-linejoin="round"/>
        </svg>
      </button>

      <button
        type="button"
        class="cs-plus"
        :class="{ disabled: sending }"
        aria-label="发送图片"
        :disabled="sending"
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

  <TabBar />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useActiveInterval } from '@/composables/useActiveInterval'
import { useBodyClass } from '@/composables/useBodyClass'
import TabBar from '@/components/TabBar.vue'
import PrivateMediaImage from '@/components/PrivateMediaImage.vue'
import { csApi, type CsMessageDto } from '@/api/cs'
import {
  completeCsRequest,
  csRequestForText,
  type PendingCsRequest,
} from '@/utils/csClientRequest'
import '@/assets/cs.css'

useBodyClass('deco-bg')

const router = useRouter()
const { toast } = useToast()

const AGENT_AVATAR = '/images/avatars/001.jpg'
const WELCOME = '您好，欢迎来到金御汇，我是您的专属客服。发送「上分金额」或「下分金额」可直接申请，例如：上分500'

interface ViewMsg {
  key: string
  type: 'time' | 'agent' | 'user'
  text: string
  caption?: string
  img?: string
  ts: number
}

function safeUploadImg(url: string) {
  const u = String(url || '').trim()
  if (/^\/api\/cs\/media\/[A-Za-z0-9_-]{10,64}$/.test(u)) return u
  return ''
}

function parseMsgContent(text: string) {
  const raw = String(text || '')
  const m = raw.match(/\[img\](\S+)/i)
  const img = safeUploadImg(m?.[1] || '')
  const caption = raw.replace(/\[img\]\S+/gi, '').trim()
  return { caption: caption || (img ? '' : raw), img }
}

const remote = ref<CsMessageDto[]>([])
const draft = ref('')
const sending = ref(false)
const msgListEl = ref<HTMLElement>()
const inputEl = ref<HTMLTextAreaElement>()
const fileEl = ref<HTMLInputElement>()
let pendingTextRequest: PendingCsRequest | null = null

function nowLabel(ts = Date.now()) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `今 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function senderToType(sender: string): 'agent' | 'user' {
  return sender === 'PLAYER' ? 'user' : 'agent'
}

const viewMessages = computed<ViewMsg[]>(() => {
  const out: ViewMsg[] = []
  if (!remote.value.length) {
    const now = Date.now()
    out.push({ key: 'welcome-time', type: 'time', text: nowLabel(now), ts: now })
    out.push({ key: 'welcome', type: 'agent', text: WELCOME, caption: WELCOME, ts: now })
    return out
  }

  let lastTs = 0
  for (const m of remote.value) {
    const ts = new Date(m.createdAt).getTime()
    if (!lastTs || ts - lastTs >= 10 * 60 * 1000) {
      out.push({ key: `t-${m.id}`, type: 'time', text: nowLabel(ts), ts })
    }
    const parsed = parseMsgContent(m.text)
    out.push({
      key: m.id,
      type: senderToType(m.sender),
      text: m.text,
      caption: parsed.caption,
      img: parsed.img,
      ts,
    })
    lastTs = ts
  }
  return out
})

function scrollToBottom() {
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = msgListEl.value
      if (el) el.scrollTop = el.scrollHeight
    })
  })
}

async function load(silent = false) {
  try {
    const res = await csApi.list(100)
    const next = res.list || []
    const prevLen = remote.value.length
    const prevLast = remote.value[prevLen - 1]?.id
    const nextLast = next[next.length - 1]?.id
    remote.value = next
    if (!silent || prevLen !== next.length || prevLast !== nextLast) scrollToBottom()
  } catch (e: unknown) {
    if (!silent) toast((e as Error).message || '加载失败')
  }
}

async function appendMessages(added: CsMessageDto[]) {
  if (!added.length) {
    await load(true)
    return
  }
  const ids = new Set(remote.value.map((m) => m.id))
  for (const m of added) {
    if (!ids.has(m.id)) remote.value.push(m)
  }
  scrollToBottom()
}

async function send() {
  const text = draft.value.trim()
  if (!text || sending.value) return
  const request = csRequestForText(text, pendingTextRequest)
  pendingTextRequest = request
  sending.value = true
  try {
    const res = await csApi.send(text, request.clientRequestId)
    await appendMessages(res.list || [])
    pendingTextRequest = completeCsRequest(pendingTextRequest, request)
    draft.value = ''
    if (inputEl.value) inputEl.value.style.height = 'auto'
  } catch (e: unknown) {
    toast((e as Error).message || '发送失败')
  } finally {
    sending.value = false
  }
}

function pickImage() {
  if (sending.value) return
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
  if (!file || sending.value) return
  if (file.size > 8_000_000) {
    toast('图片请小于 8MB')
    return
  }
  sending.value = true
  try {
    const dataUrl = await readAsDataUrl(file)
    const up = await csApi.upload(dataUrl)
    const text = `[img]${up.url}`
    const request = csRequestForText(text, null)
    const res = await csApi.send(text, request.clientRequestId)
    await appendMessages(res.list || [])
  } catch (e: unknown) {
    toast((e as Error).message || '图片发送失败')
  } finally {
    sending.value = false
  }
}

function autoGrow() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/lobby')
}

useActiveInterval(() => void load(true), 4000)

onMounted(() => {
  void load()
})
</script>
