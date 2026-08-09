<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="crown-deco" src="/images/crown-emblem.png" alt="">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <button class="page-back-fixed" type="button" aria-label="退出" @click="onExit"></button>
  <button class="page-logout-fixed" type="button" aria-label="安全退出" @click="onExit"></button>

  <div ref="stageEl" class="page referral-page">
    <div class="page-body">
      <div class="user-bar">
        <div class="avatar-luxe-wrap">
          <img class="avatar-img" :src="avatarSrc" alt="">
          <img class="avatar-frame" src="/images/avatar-ring.png" alt="">
        </div>
        <div class="user-info">
          <div class="user-name">{{ userStore.profile?.nickname ?? '———' }}</div>
          <div class="user-divider" aria-hidden="true"><span class="user-divider-gem"></span></div>
          <div class="user-id">
            <span class="id-dot"></span>ID&nbsp;<span class="uid-num">{{ userStore.profile?.uid ?? '———————' }}</span>
          </div>
        </div>
      </div>

      <div class="section-title">
        <span class="orn">◆</span>请 输 入 房 间 号<span class="orn">◆</span>
      </div>

      <div class="code-boxes">
        <input
          v-for="(_, idx) in digits"
          :key="idx"
          :ref="(el) => setBoxRef(el, idx)"
          v-model="digits[idx]"
          type="tel"
          class="code-box"
          :class="{ filled: !!digits[idx], shake: shakeIdx === idx }"
          maxlength="1"
          inputmode="numeric"
          autocomplete="one-time-code"
          @input="onDigitInput(idx)"
          @keydown="onDigitKeydown($event, idx)"
          @paste="onPaste"
        >
      </div>

      <div v-if="roomStore.approved.length" class="rooms-section">
        <div class="section-title">
          <span class="orn">◆</span>恭 迎 归 来 · 棋 局 再 续<span class="orn">◆</span>
        </div>
        <div class="rooms-grid">
          <button
            v-for="r in roomStore.approved"
            :key="r.roomNo"
            type="button"
            class="room-tile"
            @click="enterApproved(r)"
          >
            <div class="room-luxe-wrap">
              <img class="room-icon" :src="r.icon || defaultIcon" :alt="r.name" loading="lazy">
              <img class="room-frame" src="/images/room-frame-gold.png" alt="">
            </div>
            <div class="name">{{ r.name }}</div>
            <div class="room-no">{{ r.roomNo }}</div>
          </button>
        </div>
      </div>

      <button class="btn btn-primary btn-block btn-enter-room" type="button" :disabled="submitting" @click="submitEnter">
        <span class="ruby ruby-l"></span>
        <span class="btn-text">{{ submitting ? '进 入 中...' : '进 入 房 间' }}</span>
        <span class="ruby ruby-r"></span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useRoomStore } from '@/stores/room'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import type { RoomCard } from '@/api/rooms'
import '@/assets/referral-input.css'

useBodyClass('referral-bg')

const DESIGN_W = 390
const defaultIcon = '/images/rooms/default-room.png'

const router = useRouter()
const userStore = useUserStore()
const roomStore = useRoomStore()
const { toast } = useToast()

const stageEl = ref<HTMLElement | null>(null)
const boxRefs = ref<(HTMLInputElement | null)[]>([])
const digits = ref(['', '', '', '', '', ''])
const shakeIdx = ref(-1)
const submitting = ref(false)
let stageLastW = -1

const avatarSrc = computed(() => userStore.profile?.avatar || '/images/avatars/001.jpg')

function setBoxRef(el: unknown, idx: number) {
  if (el && typeof el === 'object' && 'focus' in el) {
    boxRefs.value[idx] = el as HTMLInputElement
  }
}

function fitStage() {
  const el = stageEl.value
  if (!el) return
  const w = window.innerWidth
  const h = window.innerHeight
  el.style.setProperty('--page-scale', '1')
  el.style.setProperty('--app-h', '0px')
  void el.offsetHeight
  const ch = el.scrollHeight || 1
  const scale = Math.min(w / DESIGN_W, h / ch)
  el.style.setProperty('--page-scale', String(scale))
  el.style.setProperty('--app-h', `${h}px`)
  stageLastW = w
}

function onResize() {
  if (window.innerWidth !== stageLastW) fitStage()
}

function getCode() {
  return digits.value.join('')
}

function resetCode() {
  digits.value = ['', '', '', '', '', '']
  nextTick(() => boxRefs.value[0]?.focus())
}

function onDigitInput(idx: number) {
  const v = digits.value[idx].replace(/\D/g, '').slice(0, 1)
  digits.value[idx] = v
  if (v && idx < 5) boxRefs.value[idx + 1]?.focus()
  else if (v) boxRefs.value[idx]?.blur()
}

function onDigitKeydown(e: KeyboardEvent, idx: number) {
  if (e.key === 'Backspace' && !digits.value[idx]) {
    e.preventDefault()
    if (idx > 0) {
      digits.value[idx - 1] = ''
      boxRefs.value[idx - 1]?.focus()
    }
  } else if (e.key === 'ArrowLeft' && idx > 0) {
    boxRefs.value[idx - 1]?.focus()
  } else if (e.key === 'ArrowRight' && idx < 5) {
    boxRefs.value[idx + 1]?.focus()
  }
}

function onPaste(e: ClipboardEvent) {
  e.preventDefault()
  const text = e.clipboardData?.getData('text') || ''
  const nums = text.replace(/\D/g, '').slice(0, 6)
  digits.value = Array.from({ length: 6 }, (_, i) => nums[i] || '')
  const focusAt = Math.min(nums.length, 5)
  nextTick(() => boxRefs.value[focusAt]?.focus())
}

async function goLobby(room: RoomCard) {
  toast(`正在进入 · ${room.name}`)
  resetCode()
  setTimeout(() => router.replace('/lobby'), 500)
}

async function enterApproved(room: RoomCard) {
  try {
    const entered = await roomStore.enter(room.roomNo)
    if (entered.memberStatus === 'PENDING') {
      toast('进房申请审核中，请等待代理通过')
      return
    }
    await goLobby(entered)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '进入失败')
  }
}

async function submitEnter() {
  const code = getCode()
  if (!/^\d{6}$/.test(code)) {
    toast('请输入完整的 6 位房间号')
    const empty = digits.value.findIndex((d) => !d)
    const idx = empty >= 0 ? empty : 0
    shakeIdx.value = idx
    boxRefs.value[idx]?.focus()
    setTimeout(() => { shakeIdx.value = -1 }, 400)
    return
  }
  submitting.value = true
  try {
    const room = await roomStore.enter(code)
    if (room.memberStatus === 'PENDING') {
      toast('已提交，等待代理审核')
      resetCode()
      return
    }
    await goLobby(room)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '进入失败')
    resetCode()
  } finally {
    submitting.value = false
  }
}

/** 输入房间号页：返回/退出直接退回登录页，无需二次确认 */
function onExit() {
  roomStore.clearCurrent()
  userStore.logout()
  router.replace('/login')
}

onMounted(async () => {
  fitStage()
  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', () => setTimeout(fitStage, 250))
  window.addEventListener('load', fitStage)
  setTimeout(() => boxRefs.value[0]?.focus(), 200)
  try {
    await roomStore.fetchMine()
  } catch {
    /* 未登录拦截由路由处理；列表失败不阻断输入 */
  }
  await nextTick()
  fitStage()
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
})
</script>
