<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page cs-page">

    <div class="app-bar">
      <div class="back" @click="goBack">‹</div>
      <div class="title">在 线 客 服</div>
      <div class="right"></div>
    </div>

    <h1 class="cs-title">在 线 客 服</h1>

    <!-- 消息区 -->
    <div class="cs-messages" ref="msgListEl">
      <template v-for="(m, i) in messages" :key="i">
        <div v-if="m.type === 'time'" class="cs-time">{{ m.text }}</div>
        <div v-else-if="m.type === 'agent'" class="cs-msg agent">
          <div class="cs-bubble-avatar"><img :src="AGENT_AVATAR" alt=""></div>
          <div v-if="m.img" class="cs-img-bubble" @click="viewImage(m.img)">
            <img :src="m.img" alt="图片">
          </div>
          <div v-else class="cs-bubble">{{ m.text }}</div>
        </div>
        <div v-else-if="m.type === 'user'" class="cs-msg user">
          <div v-if="m.img" class="cs-img-bubble" @click="viewImage(m.img)">
            <img :src="m.img" alt="图片">
          </div>
          <div v-else class="cs-bubble">{{ m.text }}</div>
        </div>
        <div v-else-if="m.type === 'typing'" class="cs-msg agent cs-typing">
          <div class="cs-bubble-avatar"><img :src="AGENT_AVATAR" alt=""></div>
          <div class="cs-bubble">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
        </div>
      </template>
    </div>

    <!-- 输入框 + 图片按钮 + 发送按钮 -->
    <div class="cs-composer">
      <button class="cs-plus" type="button" aria-label="发送图片" @click="imgInputEl?.click()">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2"/>
          <circle cx="8.5" cy="10" r="1.4" fill="currentColor" stroke="none"/>
          <path d="M3 17l5-5 4 4 3-3 6 6"/>
        </svg>
      </button>
      <input type="file" ref="imgInputEl" accept="image/*" hidden @change="onPickImage">

      <textarea
        ref="inputEl"
        v-model="draft"
        class="cs-input"
        rows="1"
        placeholder="输入消息..."
        autocomplete="off"
        @keydown.enter.exact.prevent="send"
        @input="autoGrow"
      ></textarea>

      <button :class="['cs-send', draft.trim() ? '' : 'disabled']" type="button" aria-label="发送" @click="send">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 11.5l18-8-7 19-3-8-8-3z" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <!-- 图片预览大图遮罩 -->
    <div :class="['cs-img-viewer', viewerSrc ? 'show' : '']" @click="viewerSrc = ''">
      <img :src="viewerSrc" alt="">
    </div>

  </div>

  <TabBar />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import TabBar from '@/components/TabBar.vue'
import '@/assets/cs.css'

useBodyClass('deco-bg')

const router = useRouter()
const userStore = useUserStore()
const { toast } = useToast()

const AGENT_AVATAR = '/images/avatars/001.jpg'

interface CsMessage {
  type: 'time' | 'agent' | 'user' | 'typing'
  text?: string
  img?: string
  ts?: number
}

const STORE_KEY = `cs_messages_${userStore.profile?.uid ?? 'guest'}_default`
const EXPIRE_MS = 60 * 60 * 1000
const REPLY_DELAY_MS = 1500

const messages = ref<CsMessage[]>([])
const draft = ref('')
const viewerSrc = ref('')
const msgListEl = ref<HTMLElement>()
const inputEl = ref<HTMLTextAreaElement>()
const imgInputEl = ref<HTMLInputElement>()

function nowLabel() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `今 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function pruneExpired(arr: CsMessage[]) {
  const cutoff = Date.now() - EXPIRE_MS
  return (arr || []).filter(m => m.type !== 'typing' && !!m.ts && m.ts >= cutoff)
}

function loadMessages(): CsMessage[] {
  try {
    return pruneExpired(JSON.parse(localStorage.getItem(STORE_KEY) || '[]'))
  } catch { return [] }
}

function saveMessages() {
  const toSave = messages.value.filter(m => m.type !== 'typing')
  try { localStorage.setItem(STORE_KEY, JSON.stringify(toSave)) } catch { /* 忽略 */ }
}

function resetWelcome() {
  const now = Date.now()
  messages.value = [
    { type: 'time', text: nowLabel(), ts: now },
    { type: 'agent', text: '您好，欢迎来到金御汇，我是您的专属客服，请问有什么可以帮您？', ts: now },
  ]
  saveMessages()
}

function scrollToBottom() {
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = msgListEl.value
      if (el) el.scrollTop = el.scrollHeight
    })
  })
}

/* 距上一条非 time/typing 消息超过 10 分钟，自动插入时间分隔 */
function maybeInsertTimeDivider() {
  const last = [...messages.value].reverse().find(m => m.type !== 'typing' && m.type !== 'time')
  if (!last || !last.ts || Date.now() - last.ts >= 10 * 60 * 1000) {
    messages.value.push({ type: 'time', text: nowLabel(), ts: Date.now() })
  }
}

/* 客服自动回复（关键词匹配，等后端客服系统接入后替换） */
function autoReply(input: string) {
  if (/上分|充值|存款|入金/.test(input))
    return '上分请点击底部【充值】发起申请，到账时间通常 1-3 分钟，超时未到账请联系代理。'
  if (/下分|提现|取款|出金/.test(input))
    return '下分请点击底部【充值】→ 切换"下分"标签提交申请，到账时间 1-5 分钟。'
  if (/回水/.test(input))
    return '回水佣金每日早晨 06:00 自动结算前一天的有效下注，可在【明细】页查看。'
  if (/下线|代理|分成/.test(input))
    return '下线佣金每日 06:00 自动发放。好友需由代理挂到您名下后才能拿佣金，详情见【我的】→ 推广中心。'
  if (/推广|推荐码|邀请|挂靠/.test(input))
    return '客户之间不能直接互邀。请让好友先注册，再把好友玩家 ID 告诉代理，由代理挂到您名下后即可拿流水佣金。'
  if (/规则|玩法|怎么玩/.test(input))
    return '具体玩法可以告诉我您想了解的游戏（百家乐 / 龙虎斗 / 快乐时时彩 / 老虎机），我会发您完整规则。'
  if (/余额|积分|账变/.test(input))
    return '您的当前积分余额会显示在【我的】页钱包中心，所有变动均会记录到【账变明细】页面。'
  if (/你好|您好|hi|hello/i.test(input))
    return '您好，很高兴为您服务，请问需要咨询什么？'
  return '已收到您的消息，请稍候，我们会尽快为您处理。'
}

let typingTimer: ReturnType<typeof setTimeout> | undefined
let replyTimer: ReturnType<typeof setTimeout> | undefined
let pruneTimer: ReturnType<typeof setInterval> | undefined

function scheduleAgentReply(replyText: string) {
  typingTimer = setTimeout(() => {
    messages.value.push({ type: 'typing' })
    scrollToBottom()
  }, 350)

  replyTimer = setTimeout(() => {
    const i = messages.value.findIndex(m => m.type === 'typing')
    if (i >= 0) messages.value.splice(i, 1)
    messages.value.push({ type: 'agent', text: replyText, ts: Date.now() })
    saveMessages()
    scrollToBottom()
  }, REPLY_DELAY_MS)
}

function send() {
  const text = draft.value.trim()
  if (!text) return
  maybeInsertTimeDivider()
  messages.value.push({ type: 'user', text, ts: Date.now() })
  saveMessages()
  draft.value = ''
  if (inputEl.value) inputEl.value.style.height = 'auto'
  scrollToBottom()
  scheduleAgentReply(autoReply(text))
}

function onPickImage(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !/^image\//.test(file.type)) return
  if (file.size > 5 * 1024 * 1024) {
    toast('图片不能超过 5MB')
    return
  }
  const reader = new FileReader()
  reader.onload = ev => {
    maybeInsertTimeDivider()
    messages.value.push({ type: 'user', img: String(ev.target?.result ?? ''), ts: Date.now() })
    saveMessages()
    scrollToBottom()
    scheduleAgentReply('收到您发来的图片，我看一下，请稍候。')
  }
  reader.readAsDataURL(file)
}

function autoGrow() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

function viewImage(src?: string) {
  if (src) viewerSrc.value = src
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/lobby')
}

onMounted(() => {
  messages.value = loadMessages()
  if (!messages.value.length) resetWelcome()
  scrollToBottom()

  // 每 60 秒清理过期消息
  pruneTimer = setInterval(() => {
    const before = messages.value.length
    messages.value = pruneExpired(messages.value)
    if (!messages.value.length) resetWelcome()
    if (messages.value.length !== before) saveMessages()
  }, 60 * 1000)
})

onUnmounted(() => {
  clearTimeout(typingTimer)
  clearTimeout(replyTimer)
  clearInterval(pruneTimer)
})
</script>
