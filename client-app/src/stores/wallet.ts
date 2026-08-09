import { defineStore } from 'pinia'
import { ref } from 'vue'
import { walletApi } from '@/api/wallet'
import { useRoomStore } from '@/stores/room'

export const useWalletStore = defineStore('wallet', () => {
  const balance = ref(0)
  const loading = ref(false)

  /** 拉取当前进房房间的余额；未进房则置 0 */
  async function fetchBalance() {
    loading.value = true
    try {
      const room = useRoomStore()
      const roomNo = String(room.roomNo || '').trim()
      if (!/^\d{6}$/.test(roomNo)) {
        balance.value = 0
        return
      }
      const res = await walletApi.balance({ roomNo })
      balance.value = Math.round((Number(res.balance) || 0) * 100) / 100
    } finally {
      loading.value = false
    }
  }

  function reset() {
    balance.value = 0
    loading.value = false
  }

  return { balance, loading, fetchBalance, reset }
})
