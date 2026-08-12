import { defineStore } from 'pinia'
import { ref } from 'vue'
import { walletApi } from '@/api/wallet'
import { useRoomStore } from '@/stores/room'
import { useUserStore } from '@/stores/user'

export const useWalletStore = defineStore('wallet', () => {
  const balance = ref(0)
  const loading = ref(false)
  let requestSequence = 0

  /** 拉取当前进房房间的余额；未进房则置 0 */
  async function fetchBalance() {
    const sequence = ++requestSequence
    const user = useUserStore()
    const room = useRoomStore()
    const sessionEpoch = user.sessionEpoch
    const userId = String(user.profile?.uid || '')
    const roomNo = String(room.roomNo || '').trim()
    const roomId = String((room.current as { id?: string } | null)?.id || roomNo)

    const isCurrent = () => {
      const currentRoomNo = String(room.roomNo || '').trim()
      const currentRoomId = String((room.current as { id?: string } | null)?.id || currentRoomNo)
      return sequence === requestSequence
        && user.sessionEpoch === sessionEpoch
        && String(user.profile?.uid || '') === userId
        && currentRoomNo === roomNo
        && currentRoomId === roomId
    }

    loading.value = true
    try {
      if (!userId || !/^\d{6}$/.test(roomNo)) {
        if (isCurrent()) balance.value = 0
        return
      }
      const res = await walletApi.balance({ roomNo })
      if (isCurrent()) {
        balance.value = Math.round((Number(res.balance) || 0) * 100) / 100
      }
    } finally {
      if (sequence === requestSequence) loading.value = false
    }
  }

  function reset() {
    requestSequence += 1
    balance.value = 0
    loading.value = false
  }

  return { balance, loading, fetchBalance, reset }
})
