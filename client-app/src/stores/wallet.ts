import { defineStore } from 'pinia'
import { ref } from 'vue'
import { walletApi } from '@/api/wallet'

export const useWalletStore = defineStore('wallet', () => {
  const balance = ref(0)
  const loading = ref(false)

  async function fetchBalance() {
    loading.value = true
    try {
      const res = await walletApi.balance()
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
