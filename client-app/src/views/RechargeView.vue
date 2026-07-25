<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.png" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.png" alt="">
  </div>

  <div class="page recharge-page">

    <div class="app-bar">
      <div class="back" @click="goBack">‹</div>
      <div class="title">线 上 支 付</div>
      <div class="right"></div>
    </div>

    <h1 class="recharge-title">线 上 支 付</h1>

    <div class="page-body">

      <!-- 卡片 1：账户信息 -->
      <div class="r-card r-account">
        <div class="ra-row">
          <div class="ra-avatar"><img :src="avatarSrc" alt=""></div>
          <div class="ra-info">
            <div class="ra-name">{{ userStore.profile?.nickname ?? '—' }}</div>
            <div class="ra-id">
              <span class="dot"></span>ID&nbsp;<span>{{ userStore.profile?.uid ?? '———' }}</span>
            </div>
          </div>
          <div class="ra-balance">
            <div class="rb-label">当 前 积 分</div>
            <div class="rb-num">{{ walletStore.balance.toLocaleString('en-US') }}</div>
          </div>
        </div>
      </div>

      <!-- 卡片 2：上 / 下分 + 金额 -->
      <div class="r-card r-main">

        <div class="r-tabs">
          <div :class="['rt-item', curType === 'up' ? 'active' : '']" @click="switchType('up')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 19V5"/>
              <path d="M6 11l6-6 6 6"/>
            </svg>
            <span>上 分</span>
          </div>
          <div :class="['rt-item', curType === 'down' ? 'active' : '']" @click="switchType('down')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14"/>
              <path d="M6 13l6 6 6-6"/>
            </svg>
            <span>下 分</span>
          </div>
        </div>

        <div class="r-field">
          <div class="rf-label">
            <span>{{ curType === 'up' ? '上 分 金 额' : '下 分 金 额' }}</span>
            <span class="rf-hint">{{ amountHint }}</span>
          </div>
          <div class="rf-input">
            <span class="rf-prefix">¥</span>
            <input
              v-model="amountStr"
              type="text"
              inputmode="numeric"
              placeholder="请 输 入 金 额"
              maxlength="9"
              @input="onAmountInput"
            />
            <button v-show="amountStr" class="rf-clear" type="button" aria-label="清空" @click="clearAmount">×</button>
          </div>
          <div class="r-quick">
            <button
              v-for="q in QUICK"
              :key="q"
              type="button"
              :class="['rq-item', quickActive === q ? 'active' : '']"
              @click="pickQuick(q)"
            >{{ q.toLocaleString('en-US') }}</button>
          </div>
        </div>

      </div>

      <!-- 上分 / 下分类型（单选） -->
      <div class="r-card r-paytype">
        <div class="rpt-head">{{ curType === 'up' ? '上 分 类 型' : '下 分 类 型' }}</div>
        <div class="rpt-options" role="radiogroup">
          <button
            v-for="(name, key) in PAY_NAMES"
            :key="key"
            type="button"
            :class="['rpt-item', curPayType === key ? 'active' : '']"
            :aria-pressed="curPayType === key"
            @click="curPayType = key"
          >{{ name.split('').join(' ') }}</button>
        </div>
      </div>

      <!-- 提交按钮 -->
      <button type="button" class="r-submit" :disabled="loading" @click="submit">
        {{ loading ? '提 交 中 …' : (curType === 'up' ? '提 交 上 分 申 请' : '提 交 下 分 申 请') }}
      </button>

      <div class="r-foot">
        还 有 疑 问 ？ 请 联 系
        <a class="rf-link" @click="router.push('/cs')">人 工 客 服</a>
      </div>

    </div>
  </div>

  <!-- 提交结果抽屉 -->
  <div :class="['r-sheet-mask', sheetShow ? 'show' : '']" @click="closeResult"></div>
  <div :class="['r-sheet', sheetShow ? 'show' : '']" :aria-hidden="!sheetShow">
    <div class="rs-handle"></div>

    <div class="rs-icon-wrap">
      <div :class="['rs-icon', result?.type === 'down' ? 'is-down' : '']">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <path d="M7.5 12.5l3 3 6-7"/>
        </svg>
      </div>
    </div>

    <div class="rs-title">{{ result?.type === 'up' ? '上 分 申 请 已 提 交' : '下 分 申 请 已 提 交' }}</div>
    <div class="rs-subtitle">{{ result?.type === 'up' ? '请联系客服取得收款账号' : '已立即扣除积分，客服审核后将线下转账' }}</div>

    <div class="rs-detail">
      <div class="rsd-row">
        <span class="rsd-k">申 请 内 容</span>
        <span class="rsd-v rsd-v-gold">{{ result?.label ?? '—' }}</span>
      </div>
      <div class="rsd-row">
        <span class="rsd-k">时 间</span>
        <span class="rsd-v">{{ result?.time ?? '—' }}</span>
      </div>
      <div class="rsd-row">
        <span class="rsd-k">状 态</span>
        <span class="rsd-v rsd-status">待 审 核</span>
      </div>
    </div>

    <div class="rs-actions">
      <button type="button" class="rs-btn rs-btn-ghost" @click="closeResult">稍 后 再 说</button>
      <button type="button" class="rs-btn rs-btn-primary" @click="goCs">立 即 联 系 客 服</button>
    </div>
  </div>

  <TabBar />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useWalletStore } from '@/stores/wallet'
import { rechargeApi } from '@/api/recharge'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { pushCsScoreApply } from '@/composables/csLocalChat'
import TabBar from '@/components/TabBar.vue'
import '@/assets/recharge.css'

useBodyClass('deco-bg')

const router = useRouter()
const userStore = useUserStore()
const walletStore = useWalletStore()
const { toast } = useToast()

const avatarSrc = computed(() => userStore.profile?.avatar || '/images/avatars/001.jpg')

/** 上分快捷；下分无 200（低于最低额），含 2000 */
const QUICK_UP = [200, 500, 1000, 2000, 3000, 5000, 10000]
const QUICK_DOWN = [500, 1000, 2000, 3000, 5000, 10000]
const PAY_NAMES: Record<string, string> = { wechat: '微信', alipay: '支付宝', unionpay: '银联' }

const curType = ref<'up' | 'down'>('up')
const curPayType = ref('wechat')
const amountStr = ref('')
const quickActive = ref<number | null>(null)
const loading = ref(false)

const sheetShow = ref(false)
const result = ref<{ type: 'up' | 'down'; label: string; time: string } | null>(null)

const QUICK = computed(() => (curType.value === 'up' ? QUICK_UP : QUICK_DOWN))

const amountHint = computed(() =>
  curType.value === 'up'
    ? '（请输入整数积分，最低 200）'
    : `（最低 500，最多可下 ${walletStore.balance.toLocaleString('en-US')} 积分）`
)

function switchType(t: 'up' | 'down') {
  if (t === curType.value) return
  curType.value = t
  // 切换类型时清掉不在当前快捷列表里的选中态
  if (quickActive.value != null && !(t === 'up' ? QUICK_UP : QUICK_DOWN).includes(quickActive.value)) {
    quickActive.value = null
  }
}

function onAmountInput() {
  let v = amountStr.value.replace(/[^\d]/g, '')
  if (v.length > 1) v = v.replace(/^0+/, '')
  amountStr.value = v.slice(0, 9)
  quickActive.value = null
}

function clearAmount() {
  amountStr.value = ''
  quickActive.value = null
}

function pickQuick(v: number) {
  amountStr.value = String(v)
  quickActive.value = v
}

function buildLabel(amount: number) {
  return `${PAY_NAMES[curPayType.value]}${curType.value === 'up' ? '上分' : '下分'}（${amount}）`
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function submit() {
  const amount = parseInt(amountStr.value, 10)
  if (!amountStr.value) { toast('请输入金额'); return }
  if (!amount || amount <= 0) { toast('金额格式有误'); return }
  if (curType.value === 'up' && amount < 200) { toast('上分最低 200 积分'); return }
  if (curType.value === 'down') {
    if (amount < 500) { toast('下分最低 500 积分'); return }
    if (amount > walletStore.balance) { toast('下分金额不能大于当前积分'); return }
  }

  loading.value = true
  try {
    if (curType.value === 'up') {
      await rechargeApi.apply(amount, curPayType.value)
      pushCsScoreApply({
        uid: userStore.profile?.uid,
        kind: 'up',
        amount,
        channel: curPayType.value,
      })
    } else {
      await rechargeApi.withdraw(amount)
      await walletStore.fetchBalance()
      pushCsScoreApply({
        uid: userStore.profile?.uid,
        kind: 'down',
        amount,
      })
    }
    const label = buildLabel(amount)
    result.value = { type: curType.value, label, time: formatTime(Date.now()) }
    amountStr.value = ''
    quickActive.value = null
    toast(label)
    sheetShow.value = true
  } catch (e: any) {
    toast(e.message ?? '提交失败')
  } finally {
    loading.value = false
  }
}

function closeResult() {
  sheetShow.value = false
}

function goCs() {
  closeResult()
  router.push('/cs')
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/lobby')
}

onMounted(() => walletStore.fetchBalance())
</script>
