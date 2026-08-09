<template>
  <!-- 与玩家大厅同一套装饰 / 背景 / 游戏卡片 -->
  <div class="lobby-deco" aria-hidden="true">
    <img class="lobby-deco-crown" src="/images/crown-emblem.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-tl" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-tr" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-bl" src="/images/corner-flourish.png" alt="">
    <img class="lobby-deco-corner lobby-deco-corner-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page lobby-page staff-lobby-page">
    <div class="page-body">
      <div class="staff-lobby-head">
        <button
          v-if="showSwitchRoom"
          type="button"
          class="staff-lobby-back"
          @click="switchRoom"
        >‹ 换房间</button>
        <h1 class="lobby-title">{{ headTitle }}</h1>
        <button type="button" class="staff-lobby-refresh" @click="onRefresh">
          {{ loading ? '…' : '刷新' }}
        </button>
      </div>
      <div v-if="activeRoom && isLandlord" class="staff-lobby-room">
        进房码 {{ activeRoom.roomNo }} · {{ activeRoom.bookMode === 'CREDIT' ? 'B·信用' : 'A·现金' }}
      </div>

      <div v-if="loading && !rooms.length" class="sp-empty staff-lobby-empty">加载中…</div>
      <div v-else-if="!rooms.length" class="sp-empty staff-lobby-empty">暂无营业房间</div>
      <div v-else-if="!activeRoom" class="sp-empty staff-lobby-empty">请选择房间</div>
      <template v-else>
        <!-- 跑马灯：与玩家端同款（不展示房间芯片） -->
        <div class="lobby-marquee">
          <div class="lm-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M3 10v4l7 3V7L3 10z"/>
              <path d="M10 7l8-3v16l-8-3"/>
              <path d="M6 17v2a1.5 1.5 0 0 0 3 0v-1"/>
            </svg>
          </div>
          <div class="lm-track-wrap">
            <div class="lm-track">
              <template v-for="dup in 2" :key="dup">
                <template v-for="(it, i) in marqueeItems" :key="`${dup}-${i}`">
                  <span class="lm-item" data-type="win">
                    <span class="lm-emoji">🎉</span>
                    <span class="lm-text">{{ it }}</span>
                  </span>
                  <span class="lm-sep">◆</span>
                </template>
              </template>
            </div>
          </div>
        </div>

        <LobbyGamesList
          ref="listRef"
          :enabled-codes="enabledCodes"
          :entering-key="entering"
          @select="enterGame"
        />
      </template>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <SlotsCover
    v-if="showSlotsCover"
    @start="enterSlotsGame"
    @close="closeSlotsCover"
  />
  <BcbmCover
    v-if="showBcbmCover"
    @start="enterBcbmGame"
    @close="closeBcbmCover"
  />

  <StaffTabBar />
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import StaffTabBar from '@/components/StaffTabBar.vue'
import LobbyGamesList from '@/components/LobbyGamesList.vue'
import SlotsCover from '@/components/SlotsCover.vue'
import BcbmCover from '@/components/BcbmCover.vue'
import type { LobbyGame } from '@/composables/useGameLobbyCards'
import { staffConsoleApi, type StaffRoom } from '@/api/staffConsole'
import { useStaffStore } from '@/stores/staff'
import { useUserStore } from '@/stores/user'
import { useRoomStore } from '@/stores/room'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/game-lobby.css'
import '@/assets/staff-console.css'

useBodyClass('lobby-bg')

const route = useRoute()
const router = useRouter()
const staff = useStaffStore()
const user = useUserStore()
const roomStore = useRoomStore()
const { toast } = useToast()

const listRef = ref<InstanceType<typeof LobbyGamesList> | null>(null)
const loading = ref(false)
const rooms = ref<StaffRoom[]>([])
const activeRoomId = ref('')
const entering = ref('')

const isLandlord = computed(() => staff.isBranch)
const queryRoomId = computed(() => String(route.query.roomId || '').trim())

const marqueeItems = [
  '理性娱乐 · 量力而行',
  '开奖结果以房间官方公告为准',
  '下注前请确认玩法与赔率',
  '封盘后请等待开奖动画完成',
  '祝您游戏愉快',
  '积分变动以账户余额为准',
]

const activeRoom = computed(() => rooms.value.find((r) => r.id === activeRoomId.value) || null)
const enabledCodes = computed(() => {
  if (!activeRoom.value) return [] as string[]
  return (activeRoom.value.enabledGames || []).map((c) => String(c))
})
const headTitle = computed(() => {
  if (isLandlord.value && activeRoom.value?.name) return activeRoom.value.name
  return '游 戏 大 厅'
})
/** 管理/房主从房间卡进入大厅后，始终可返回换房（含仅 1 间） */
const showSwitchRoom = computed(() => isLandlord.value)

const showSlotsCover = ref(false)
const pendingSlotsRoute = ref('')
const showBcbmCover = ref(false)
const pendingBcbmRoute = ref('')

function switchRoom() {
  void router.push({ name: 'staff-game-rooms' })
}

async function loadRooms() {
  loading.value = true
  try {
    const list = await staffConsoleApi.rooms()
    const open = (list || []).filter((r) => r.status === 'OPEN')
    rooms.value = open

    if (isLandlord.value) {
      const wanted = queryRoomId.value
      if (!wanted) {
        await router.replace({ name: 'staff-game-rooms' })
        return
      }
      if (!open.some((r) => r.id === wanted)) {
        toast('该房间未营业或不存在')
        await router.replace({ name: 'staff-game-rooms' })
        return
      }
      activeRoomId.value = wanted
      return
    }

    if (!activeRoomId.value || !open.some((r) => r.id === activeRoomId.value)) {
      activeRoomId.value = open[0]?.id || ''
    }
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

async function onRefresh() {
  await loadRooms()
  await listRef.value?.refreshAll()
}

async function attachPlaySession() {
  if (!activeRoom.value) throw new Error('请选择房间')
  const card = await staffConsoleApi.playEnter(activeRoom.value.id)
  staff.beginPlay()
  if (staff.profile && staff.token) {
    user.attachStaffPlay(staff.profile, staff.token)
  }
  roomStore.setCurrent({
    roomNo: card.roomNo,
    name: card.name,
    icon: card.icon,
    memberStatus: 'APPROVED',
  })
}

async function enterGame(g: LobbyGame) {
  if (!activeRoom.value || entering.value) return
  const list = listRef.value
  if (list?.isMaintenance(g)) {
    toast(`${g.name.replace(/\s+/g, '')} · 维护中，暂不可进入`)
    return
  }
  if (!g.route || !list?.isPlatformOnline(g)) {
    toast(`${g.name.replace(/\s+/g, '')} · 已下架`)
    return
  }

  if (g.key === 'slots') {
    pendingSlotsRoute.value = g.route
    showSlotsCover.value = true
    return
  }
  if (g.key === 'bcbm') {
    pendingBcbmRoute.value = g.route
    showBcbmCover.value = true
    return
  }

  entering.value = g.key
  try {
    await attachPlaySession()
    await router.push(g.route)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '进入失败')
  } finally {
    entering.value = ''
  }
}

function closeSlotsCover() {
  showSlotsCover.value = false
  pendingSlotsRoute.value = ''
}
function closeBcbmCover() {
  showBcbmCover.value = false
  pendingBcbmRoute.value = ''
}

async function enterSlotsGame() {
  const routePath = pendingSlotsRoute.value
  closeSlotsCover()
  if (!routePath) return
  entering.value = 'slots'
  try {
    await attachPlaySession()
    await router.push(routePath)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '进入失败')
  } finally {
    entering.value = ''
  }
}

async function enterBcbmGame() {
  const routePath = pendingBcbmRoute.value
  closeBcbmCover()
  if (!routePath) return
  entering.value = 'bcbm'
  try {
    await attachPlaySession()
    await router.push(routePath)
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '进入失败')
  } finally {
    entering.value = ''
  }
}

watch(queryRoomId, () => {
  if (isLandlord.value) void loadRooms()
})

onMounted(() => { void loadRooms() })
</script>

<style scoped>
.staff-lobby-page {
  min-height: 100vh;
  min-height: 100dvh;
}
.staff-lobby-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
  min-height: 36px;
}
.staff-lobby-head .lobby-title {
  margin-bottom: 0;
  max-width: 56%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.staff-lobby-back {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  height: 28px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: #fff4c2;
  font-size: 13px;
  letter-spacing: 1px;
  cursor: pointer;
  z-index: 2;
}
.staff-lobby-refresh {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  height: 28px;
  padding: 0 12px;
  border-radius: 14px;
  border: 1px solid rgba(212, 175, 55, 0.55);
  background: rgba(20, 14, 8, 0.75);
  color: #fff4c2;
  font-size: 12px;
  letter-spacing: 2px;
  cursor: pointer;
  z-index: 2;
}
.staff-lobby-room {
  text-align: center;
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(244, 211, 107, 0.65);
  margin-bottom: 8px;
}
.staff-lobby-empty {
  margin-top: 40px;
  color: rgba(244, 211, 107, 0.55);
}
</style>
