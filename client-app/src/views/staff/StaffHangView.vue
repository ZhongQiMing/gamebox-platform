<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">下级挂靠</div>
      <div class="right sc-bar-act" @click="reload">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <p class="hang-tip">
        挂靠按房间隔离：只能挂本房玩家；本房流水才返给本房挂靠上级。
      </p>

      <div v-if="rooms.length > 1" class="hang-room">
        <label class="hang-label">选择房间</label>
        <select v-model="roomId" class="hang-input" @change="onRoomChange">
          <option v-for="r in rooms" :key="r.id" :value="r.id">
            {{ r.name || r.roomNo }}（{{ r.roomNo }}）
          </option>
        </select>
      </div>
      <p v-else-if="activeRoom" class="hang-room-one">
        当前房间：{{ activeRoom.name || activeRoom.roomNo }}
      </p>

      <div v-if="under" class="hang-under">
        <div class="hang-under-hd">
          <span>已选推荐人</span>
          <button type="button" class="hang-clear" @click="clearUnder">重选</button>
        </div>
        <div class="hang-under-name">{{ under.nickname }}</div>
        <div class="hang-under-meta">{{ under.username }} · {{ under.uid }}</div>
        <label class="hang-label">下级玩家 UID</label>
        <input
          v-model="friendUid"
          type="text"
          maxlength="12"
          inputmode="numeric"
          placeholder="输入要挂靠的玩家 UID"
          class="hang-input"
        >
        <button
          type="button"
          class="hang-submit"
          :disabled="busy"
          @click="askConfirm"
        >{{ busy ? '提交中…' : '确认挂靠' }}</button>
      </div>

      <template v-else>
        <div class="sp-search">
          <input
            v-model="keyword"
            type="search"
            placeholder="搜索推荐人：昵称 / 账号 / UID"
            @keyup.enter="reload"
          >
          <button type="button" @click="reload">搜索</button>
        </div>

        <div v-if="loading && !list.length" class="sp-empty">加载中…</div>
        <div v-else-if="!list.length" class="sp-empty">暂无玩家</div>

        <button
          v-for="p in list"
          :key="p.id"
          type="button"
          class="sp-row hang-pick"
          @click="pickUnder(p)"
        >
          <div class="top">
            <div class="name">{{ p.nickname }}</div>
            <div class="bal">选为推荐人</div>
          </div>
          <div class="meta">{{ p.username }} · {{ p.uid }}</div>
        </button>

        <div v-if="total > list.length" class="sp-empty">
          <button type="button" class="sc-logout" :disabled="loading" @click="loadMore">加载更多</button>
        </div>
      </template>
    </div>

    <div v-if="confirmVisible" class="sp-sheet" @click.self="confirmVisible = false">
      <div class="sp-sheet-panel">
        <h3>确认挂靠</h3>
        <p class="hint">
          将 UID {{ friendUid.trim() }} 挂到
          {{ under?.nickname }}（{{ under?.uid }}）名下？
        </p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="busy" @click="confirmVisible = false">取消</button>
          <button type="button" class="ok" :disabled="busy" @click="submitHang">确认挂靠</button>
        </div>
      </div>
    </div>
    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { staffConsoleApi, type StaffPlayerRow, type StaffRoom } from '@/api/staffConsole'
import StaffTabBar from '@/components/StaffTabBar.vue'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const { toast } = useToast()

const rooms = ref<StaffRoom[]>([])
const roomId = ref('')
const activeRoom = computed(() => rooms.value.find((r) => r.id === roomId.value) || null)

const keyword = ref('')
const loading = ref(false)
const list = ref<StaffPlayerRow[]>([])
const page = ref(1)
const total = ref(0)
const pageSize = 20

const under = ref<StaffPlayerRow | null>(null)
const friendUid = ref('')
const busy = ref(false)
const confirmVisible = ref(false)

function onRoomChange() {
  under.value = null
  friendUid.value = ''
  void reload()
}

function pickUnder(p: StaffPlayerRow) {
  under.value = p
  friendUid.value = ''
  confirmVisible.value = false
}

function clearUnder() {
  if (busy.value) return
  under.value = null
  friendUid.value = ''
  confirmVisible.value = false
}

function askConfirm() {
  if (!under.value) return
  const uid = friendUid.value.trim()
  if (!uid) {
    toast('请填写下级玩家 UID')
    return
  }
  if (uid === under.value.uid) {
    toast('下级与推荐人不能相同')
    return
  }
  confirmVisible.value = true
}

async function submitHang() {
  if (!under.value) return
  if (!roomId.value) {
    toast('请先选择房间')
    return
  }
  const friend = friendUid.value.trim()
  if (!friend) return
  busy.value = true
  try {
    const res = await staffConsoleApi.hangPlayer(friend, under.value.uid, roomId.value)
    toast(res.message || '挂靠成功')
    confirmVisible.value = false
    friendUid.value = ''
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '挂靠失败')
  } finally {
    busy.value = false
  }
}

async function fetchPage(p: number, append: boolean) {
  if (!roomId.value) {
    list.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const res = await staffConsoleApi.players({
      page: p,
      pageSize,
      q: keyword.value.trim() || undefined,
      roomId: roomId.value,
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

async function reload() {
  await fetchPage(1, false)
}

async function loadMore() {
  await fetchPage(page.value + 1, true)
}

onMounted(async () => {
  try {
    rooms.value = await staffConsoleApi.rooms()
    roomId.value = rooms.value[0]?.id || ''
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载房间失败')
  }
  await reload()
})
</script>

<style scoped>
.hang-tip {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(232, 212, 168, 0.72);
}

.hang-room {
  margin-bottom: 12px;
}

.hang-room-one {
  margin: 0 0 12px;
  font-size: 12px;
  color: rgba(232, 212, 168, 0.65);
}

.hang-under {
  padding: 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(212, 175, 95, 0.22);
}

.hang-under-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  color: rgba(232, 212, 168, 0.65);
}

.hang-clear {
  border: none;
  background: transparent;
  color: #d4af5f;
  font-size: 12px;
  padding: 0;
}

.hang-under-name {
  font-size: 16px;
  font-weight: 600;
  color: #f3e6c4;
}

.hang-under-meta {
  margin-top: 4px;
  margin-bottom: 14px;
  font-size: 12px;
  color: rgba(232, 212, 168, 0.55);
}

.hang-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  color: rgba(232, 212, 168, 0.7);
}

.hang-input {
  width: 100%;
  box-sizing: border-box;
  height: 42px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid rgba(212, 175, 95, 0.28);
  background: rgba(0, 0, 0, 0.28);
  color: #f3e6c4;
  font-size: 15px;
  outline: none;
}

.hang-input::placeholder {
  color: rgba(232, 212, 168, 0.35);
}

.hang-submit {
  width: 100%;
  margin-top: 14px;
  height: 44px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(180deg, #e0c06a, #b8923a);
  color: #2a1f0a;
  font-size: 15px;
  font-weight: 600;
}

.hang-submit:disabled {
  opacity: 0.55;
}

.hang-pick {
  width: 100%;
  text-align: left;
  cursor: pointer;
  border: none;
  display: block;
}

.hang-pick .bal {
  font-size: 12px;
  font-weight: 500;
  color: #d4af5f;
}
</style>
