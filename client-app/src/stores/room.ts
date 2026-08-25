import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { roomsApi, type RoomCard } from '@/api/rooms'
import { useWalletStore } from '@/stores/wallet'
import { publicMediaUrl } from '@/utils/publicMediaUrl'

const STORAGE_KEY = 'gamebox_current_room'

function loadStored(): RoomCard | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RoomCard
    if (parsed?.roomNo && parsed?.name) {
      return { ...parsed, icon: publicMediaUrl(parsed.icon) || null }
    }
  } catch {
    /* ignore */
  }
  return null
}

export const useRoomStore = defineStore('room', () => {
  const current = ref<RoomCard | null>(loadStored())
  const approved = ref<RoomCard[]>([])

  const hasRoom = computed(() => !!current.value?.roomNo)
  const roomNo = computed(() => current.value?.roomNo ?? '')

  function setCurrent(room: RoomCard) {
    /*
     * 余额是按房间算的。换房时先归零，等新房的余额拉回来再显示；
     * 不归零就会在新房间里短暂显示上一间房的钱，玩家按那个数去下注。
     */
    const changed = current.value?.roomNo !== room.roomNo
    current.value = room
    localStorage.setItem(STORAGE_KEY, JSON.stringify(room))
    if (changed) useWalletStore().reset()
  }

  function clearCurrent() {
    current.value = null
    approved.value = []
    localStorage.removeItem(STORAGE_KEY)
  }

  async function fetchMine() {
    approved.value = await roomsApi.mine()
    return approved.value
  }

  /**
   * 进房申请/重进。
   * PENDING 不写入 current、不加入 approved（不能进大厅）。
   */
  async function enter(roomNoInput: string) {
    const room = await roomsApi.enter(roomNoInput)
    if (room.memberStatus === 'PENDING') {
      return room
    }
    setCurrent(room)
    const exists = approved.value.some((r) => r.roomNo === room.roomNo)
    if (!exists) approved.value = [room, ...approved.value]
    return room
  }

  return {
    current,
    approved,
    hasRoom,
    roomNo,
    setCurrent,
    clearCurrent,
    fetchMine,
    enter,
  }
})
