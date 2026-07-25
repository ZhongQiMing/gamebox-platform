import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { roomsApi, type RoomCard } from '@/api/rooms'

const STORAGE_KEY = 'gamebox_current_room'

function loadStored(): RoomCard | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RoomCard
    if (parsed?.roomNo && parsed?.name) return parsed
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
    current.value = room
    localStorage.setItem(STORAGE_KEY, JSON.stringify(room))
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

  async function enter(roomNoInput: string) {
    const room = await roomsApi.enter(roomNoInput)
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
