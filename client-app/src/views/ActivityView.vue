<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page act-page">
    <div class="app-bar">
      <div class="back" @click="goBack">‹</div>
      <div class="title">活动中心</div>
      <div class="right"></div>
    </div>

    <div class="page-body">
      <h1 class="act-hero-title">活 动 中 心</h1>

      <div class="act-balance-card">
        <span class="act-balance-label">当 前 积 分</span>
        <span class="act-balance-num">{{ balanceNum }}</span>
      </div>

      <div v-if="loading" class="act-empty">
        <div class="act-empty-icon">◇</div>
        <div class="act-empty-text">加 载 中 …</div>
      </div>

      <template v-else>
        <div v-if="!activities.length" class="act-empty">
          <div class="act-empty-icon">◇</div>
          <div class="act-empty-text">暂 无 进 行 中 的 活 动</div>
        </div>

        <div v-else class="act-list">
          <div
            v-for="act in activities"
            :key="act.id"
            class="act-card"
            :class="{ claimed: !!act.claim }"
          >
            <img v-if="act.bannerUrl" :src="act.bannerUrl" class="act-banner" alt="">

            <div class="act-body">
              <div class="act-type-badge" :class="badgeClass(act.type)">
                {{ typeLabel(act.type) }}
              </div>
              <div class="act-title">{{ act.title }}</div>

              <template v-if="act.type === 'NEWBIE'">
                <div class="act-desc">注册后 {{ act.config.expiresHours ?? 24 }} 小时内领取</div>
                <div class="act-reward">奖励 <b>+{{ act.config.reward }}</b> 分</div>
              </template>

              <template v-else-if="act.config.tiers">
                <div class="tier-table">
                  <div v-for="t in act.config.tiers" :key="t.minDeposit" class="tier-row">
                    <span class="tier-cond">充值满 {{ t.minDeposit }}</span>
                    <span class="tier-reward">送 {{ t.reward }} 分</span>
                  </div>
                </div>
              </template>

              <div class="act-footer">
                <div v-if="act.claim" class="claimed-tag">
                  已领取 +{{ act.claim.rewardPoints }} 分
                </div>
                <button
                  v-else
                  type="button"
                  class="claim-btn"
                  :disabled="claiming === act.id"
                  @click="doClaim(act)"
                >
                  {{ claiming === act.id ? '领取中…' : '立即领取' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <TabBar />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWalletStore } from '@/stores/wallet'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { activityApi, type ActivityItem } from '@/api/activity'
import TabBar from '@/components/TabBar.vue'
import '@/assets/activity.css'

useBodyClass('deco-bg')

const router = useRouter()
const walletStore = useWalletStore()
const { success: toastOk, error: toastErr } = useToast()

const balanceNum = computed(() => walletStore.balance.toLocaleString('en-US'))

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/lobby')
}

const loading = ref(true)
const activities = ref<ActivityItem[]>([])
const claiming = ref<string | null>(null)

async function loadList() {
  try {
    activities.value = await activityApi.list()
  } catch { /* 静默 */ } finally {
    loading.value = false
  }
}

async function doClaim(act: ActivityItem) {
  claiming.value = act.id
  try {
    const res = await activityApi.claim(act.id)
    toastOk(`领取成功！+${res.reward} 分`)
    act.claim = {
      id: res.claim.id,
      status: res.claim.status,
      rewardPoints: res.reward,
      claimedAt: new Date().toISOString(),
    }
    await walletStore.fetchBalance()
  } catch (e: unknown) {
    toastErr((e as Error).message)
  } finally {
    claiming.value = null
  }
}

function typeLabel(t: string) {
  return {
    NEWBIE: '新人礼',
    FIRST_DEPOSIT: '首充礼',
    VIP: 'VIP礼包',
    PROMO: '促销',
    WIN_STREAK: '连赢',
    ACCUMULATE: '累计',
  }[t] ?? t
}

function badgeClass(t: string) {
  return t.toLowerCase().replace(/_/g, '-')
}

onMounted(() => {
  void walletStore.fetchBalance()
  void loadList()
})
</script>
