<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page settings-page">

    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">我 的</div>
      <div class="right"></div>
    </div>

    <div class="page-body">

      <!-- 卡片 1：用户名片（点头像可上传） -->
      <div class="user-card user-bar" title="个人资料">
        <button type="button" class="avatar-luxe-wrap avatar-luxe-wrap--btn" aria-label="更换头像" @click="pickAvatar">
          <img class="avatar-img" :src="avatarSrc" alt="">
          <img class="avatar-frame" src="/images/avatar-ring.webp" alt="">
        </button>
        <div class="user-info">
          <div class="user-name">{{ userStore.profile?.nickname ?? '———' }}</div>
          <div class="user-divider" aria-hidden="true"><span class="user-divider-gem"></span></div>
          <div class="user-id">
            <span class="id-dot"></span>ID&nbsp;<span id="userId">{{ userStore.profile?.uid ?? '———' }}</span>
          </div>
        </div>
      </div>

      <!-- 卡片 2：钱包中心 -->
      <div :class="['settings-card', 'wallet-card', hidden ? 'is-hidden' : '']">
        <div class="wc-title-row">
          <span class="wc-title">钱 包 中 心</span>
          <button class="wc-eye" type="button" aria-label="显示/隐藏余额" @click="toggleHidden">
            <svg class="wc-eye-show" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <svg class="wc-eye-hide" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 3l18 18"/>
              <path d="M2 12s4-7 10-7c2.4 0 4.4 1 6 2"/>
              <path d="M22 12s-4 7-10 7c-2.4 0-4.4-1-6-2"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>
        <div class="wc-balance-row">
          <span class="wc-balance">{{ hidden ? '*****' : fmtNum(walletStore.balance) }}</span>
          <span class="wc-currency">积 分</span>
        </div>
        <div class="wc-stats-row">
          <div class="wc-stat">
            <span class="ws-label">今日流水</span>
            <span class="ws-value">{{ hidden ? '***' : fmtInt(stats.turnover) }}</span>
          </div>
          <div class="wc-stat">
            <span class="ws-label">今日回水</span>
            <span class="ws-value">{{ hidden ? '***' : fmtInt(stats.rebate) }}</span>
          </div>
          <div class="wc-stat">
            <span class="ws-label">今日盈亏</span>
            <span :class="['ws-value', !hidden && stats.pnl < 0 ? 'is-neg' : '', !hidden && stats.pnl > 0 ? 'is-pos' : '']">
              {{ hidden ? '***' : fmtPnl(stats.pnl) }}
            </span>
          </div>
        </div>
      </div>

      <!-- 卡片 3：2 行 3 列网格（图标做差异化） -->
      <div class="settings-card grid-card grid-3col">
        <button type="button" class="gc-item" @click="router.push('/account')">
          <span class="gc-icon gc-icon--account">
            <!-- 钥匙+人：账号安全 -->
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="8" r="3.2"/>
              <path d="M3.5 20c0-3.2 2.5-5.5 5.5-5.5"/>
              <path d="M14 11.5h6.5l-1.2 1.8H18v2.2h-1.6V17H14.8v-2.5H14z"/>
              <circle cx="15.6" cy="11.5" r="1.1"/>
            </svg>
          </span>
          <span class="gc-text">账 号 管 理</span>
        </button>
        <button type="button" class="gc-item" @click="router.push('/apply-records')">
          <span class="gc-icon gc-icon--apply">
            <!-- 印章申请单 -->
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 3.5h7l3.5 3.5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z"/>
              <path d="M14 3.5V7h3.5"/>
              <circle cx="12" cy="14.5" r="3"/>
              <path d="M12 12.8v1.7l1.2.7"/>
            </svg>
          </span>
          <span class="gc-text">申 请 记 录</span>
        </button>
        <button type="button" class="gc-item" @click="router.push('/bets')">
          <span class="gc-icon gc-icon--bets">
            <!-- 骰子：竞猜 -->
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="4" width="16" height="16" rx="3"/>
              <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none"/>
              <circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none"/>
            </svg>
          </span>
          <span class="gc-text">竞 猜 记 录</span>
        </button>
        <button type="button" class="gc-item" @click="router.push('/activities')">
          <span class="gc-icon gc-icon--gift">
            <!-- 礼盒：活动 -->
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 11h16v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20v-9z"/>
              <path d="M3 7.5h18V11H3z"/>
              <path d="M12 7.5v14"/>
              <path d="M12 7.5c-2.2 0-3.5-1.6-3.5-3S10 2.5 12 4.2C14 2.5 15.5 3 15.5 4.5s-1.3 3-3.5 3z"/>
            </svg>
          </span>
          <span class="gc-text">活 动 中 心</span>
        </button>
        <button type="button" class="gc-item" @click="router.push('/points-log')">
          <span class="gc-icon gc-icon--ledger">
            <!-- 账本：账变明细 -->
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 4h10a2 2 0 0 1 2 2v14l-3-1.5L12 20l-3-1.5L6 20V6a2 2 0 0 1 2-2z" transform="translate(-1 0)"/>
              <path d="M9 9h6M9 12h4"/>
              <path d="M17.5 8.5l2 2-2 2"/>
              <path d="M19.5 10.5H15"/>
            </svg>
          </span>
          <span class="gc-text">账 变 明 细</span>
        </button>
        <button type="button" class="gc-item" @click="router.push('/agent')">
          <span class="gc-icon gc-icon--agent">
            <!-- 树状：推广 -->
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="5.5" r="2.4"/>
              <circle cx="6" cy="17.5" r="2.2"/>
              <circle cx="18" cy="17.5" r="2.2"/>
              <path d="M12 8v3.5M12 11.5L6.5 15.2M12 11.5l5.5 3.7"/>
            </svg>
          </span>
          <span class="gc-text">推 广 中 心</span>
        </button>
      </div>

      <!-- 卡片 4：1 行 4 列网格 -->
      <div class="settings-card grid-card grid-4col">
        <button type="button" class="gc-item" @click="router.push('/rebate')">
          <span class="gc-icon gc-icon--rebate">
            <!-- 回水：水滴+箭头 -->
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.5c3.2 4.2 5.5 7.2 5.5 10a5.5 5.5 0 1 1-11 0c0-2.8 2.3-5.8 5.5-10z"/>
              <path d="M12 13v5"/>
              <path d="M9.8 16.2L12 18.5l2.2-2.3"/>
            </svg>
          </span>
          <span class="gc-text">自助回水</span>
        </button>
        <button type="button" class="gc-item" @click="checkUpdate">
          <span class="gc-icon gc-icon--update">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13-6.2"/><path d="M17 2.5v3.5h-3.5"/><path d="M20 12a8 8 0 0 1-13 6.2"/><path d="M7 21.5v-3.5h3.5"/></svg>
          </span>
          <span class="gc-text">检查更新</span>
        </button>
        <button type="button" class="gc-item" @click="router.push('/game-intro')">
          <span class="gc-icon gc-icon--intro">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none"/></svg>
          </span>
          <span class="gc-text">游戏介绍</span>
        </button>
        <button type="button" class="gc-item" @click="router.push('/cs')">
          <span class="gc-icon gc-icon--cs">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 1 0-15.1 5.4L4 21l4.1-1.9A8.5 8.5 0 0 0 21 11.5z"/></svg>
          </span>
          <span class="gc-text">在线客服</span>
        </button>
      </div>

      <!-- 卡片 5：退出登录 -->
      <div class="settings-card logout-card">
        <button type="button" class="logout-btn" @click="openLogout">退 出 登 录</button>
      </div>

      <div class="lobby-spacer"></div>
    </div>
  </div>

  <input
    ref="fileInput"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    class="avatar-file-hidden"
    @change="onFilePicked"
  >

  <AppModal
    :visible="showLogoutModal"
    title="退出登录"
    message="确定要退出当前账号吗？"
    ok-text="确定退出"
    cancel-text="再玩一会"
    :danger="true"
    @ok="confirmLogout"
    @cancel="showLogoutModal = false"
  />

  <TabBar />
</template>

<script setup lang="ts">
import { ref, computed, reactive, onActivated, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useWalletStore } from '@/stores/wallet'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { rangeBounds } from '@/composables/timeRange'
import { userApi } from '@/api/user'
import { rebateApi } from '@/api/rebate'
import http from '@/api/http'
import { formatMoney, formatSignedMoney } from '@gamebox/shared'
import TabBar from '@/components/TabBar.vue'
import AppModal from '@/components/AppModal.vue'
import '@/assets/settings.css'

useBodyClass('deco-bg')

const router = useRouter()
const userStore = useUserStore()
const walletStore = useWalletStore()
const { toast } = useToast()

const avatarSrc = computed(() => userStore.profile?.avatar || '/images/avatars/001.jpg')
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

function pickAvatar() {
  fileInput.value?.click()
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    toast('请选择 JPG / PNG / WEBP 图片')
    return
  }
  if (file.size > 800 * 1024) {
    toast('图片请小于 800KB')
    return
  }
  if (uploading.value) return
  uploading.value = true
  try {
    const dataUrl = await readAsDataUrl(file)
    const profile = await userApi.updateAvatar(dataUrl)
    userStore.profile = profile
    toast('头像已更新')
  } catch (err: any) {
    toast(err?.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

const WALLET_STORE = computed(() => `wallet_hidden_${userStore.profile?.uid ?? ''}`)
const hidden = ref(false)

function toggleHidden() {
  hidden.value = !hidden.value
  localStorage.setItem(WALLET_STORE.value, hidden.value ? '1' : '0')
}

const stats = reactive({ turnover: 0, rebate: 0, pnl: 0 })

const fmtNum = (n: number) => formatMoney(n)
const fmtInt = (n: number) => formatMoney(n)
const fmtPnl = (n: number) => formatSignedMoney(n)

async function loadWalletStats() {
  const [from, to] = rangeBounds('today')
  try {
    const [report, rebate] = await Promise.all([
      http.get<{
        validFlow: number
        playerSettle: number
      }, {
        validFlow: number
        playerSettle: number
      }>(`/bet/report-summary?range=today&from=${from}&to=${to}`),
      rebateApi.status('today'),
    ])
    /* 流水/盈亏：与竞猜报表全量汇总一致；回水：与自助回水「今日累计·预计回水」一致 */
    stats.turnover = Number(report?.validFlow) || 0
    stats.pnl = Number(report?.playerSettle) || 0
    stats.rebate = Number(rebate?.today?.estimatedRebate) || 0
  } catch {
    /* 保持上次数值，不弹错打断个人页 */
  }
}

function checkUpdate() {
  toast('当前已是最新版本 v1.0.0')
}

const showLogoutModal = ref(false)

function openLogout() {
  showLogoutModal.value = true
}

async function confirmLogout() {
  showLogoutModal.value = false
  await userStore.logout()
  window.location.replace('/login')
}

onMounted(() => {
  hidden.value = localStorage.getItem(WALLET_STORE.value) === '1'
  void walletStore.fetchBalance()
  void loadWalletStats()
})

/* 页面被 keep-alive 缓存，重新进入不会走 onMounted，余额与统计得在这里补。
   首次挂载时 onActivated 紧跟 onMounted，跳过一次否则每次首进都双发请求。 */
let skipFirstActivate = true
onActivated(() => {
  if (skipFirstActivate) {
    skipFirstActivate = false
    return
  }
  void walletStore.fetchBalance()
  void loadWalletStats()
})
</script>
