<template>
  <div class="screen-deco" aria-hidden="true">
    <img class="cd cd-tl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-tr" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-bl" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
    <img class="cd cd-br" src="/images/corner-flourish.webp" loading="lazy" decoding="async" alt="">
  </div>

  <div class="page staff-console-page">
    <div class="app-bar">
      <div class="back" @click="router.back()">‹</div>
      <div class="title">客服绩效</div>
      <div class="right sc-bar-act" @click="reload">{{ loading ? '…' : '刷新' }}</div>
    </div>

    <div class="page-body">
      <div class="sp-tabs sp-tabs--range" data-count="5">
        <button
          v-for="r in TIME_RANGES"
          :key="r.key"
          type="button"
          :class="{ on: range === r.key }"
          @click="switchRange(r.key)"
        >{{ r.label }}</button>
      </div>

      <!-- 原来是一行灰字，看着像说明不像能点；改成带图标的按钮，当前规则摘要放右边 -->
      <button type="button" class="cp-setting" @click="openPolicy">
        <span class="cp-setting-ic" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3.2"/>
            <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>
          </svg>
        </span>
        <span class="cp-setting-txt">
          <b>响应规则与奖惩</b>
          <em>{{ policyText || '点此设置时限与罚款' }}</em>
        </span>
        <span class="cp-setting-go">设 置</span>
      </button>

      <div v-if="loading && !rows.length" class="sp-empty">加载中…</div>
      <div v-else-if="!rows.length" class="sp-empty">名下还没有客服</div>

      <div v-for="r in rows" :key="r.csUserId" class="sp-row">
        <div class="top">
          <div class="name">
            {{ r.nickname }}
            <span class="cp-state" :class="r.locked ? 'lock' : (r.workStatus === 'IDLE' ? 'on' : '')">
              {{ r.locked ? '已锁号' : (r.workStatus === 'IDLE' ? '空闲' : '休息') }}
            </span>
          </div>
          <div class="bal" :class="r.fine > 0 ? 'down' : ''">{{ r.fine > 0 ? `-${fmt(r.fine)}` : '—' }}</div>
        </div>
        <div class="meta">{{ r.username }}</div>

        <div class="cp-grid">
          <div class="cp-cell">
            <span class="mk">接单</span>
            <span class="mv">{{ r.rounds }}</span>
          </div>
          <div class="cp-cell">
            <span class="mk">及时率</span>
            <span class="mv">{{ r.onTimeRate === null ? '—' : `${Math.round(r.onTimeRate * 100)}%` }}</span>
          </div>
          <div class="cp-cell">
            <span class="mk">超时</span>
            <span class="mv warn">{{ r.late }}</span>
          </div>
          <div class="cp-cell">
            <span class="mk">漏接</span>
            <span class="mv bad">{{ r.missed }}</span>
          </div>
          <div class="cp-cell">
            <span class="mk">今日空闲</span>
            <span class="mv">{{ hm(r.idleSec) }}</span>
          </div>
          <div class="cp-cell">
            <span class="mk">今日休息</span>
            <span class="mv">{{ hm(r.restSec) }}</span>
          </div>
        </div>

        <!-- 锁定整块提出来：原先解锁只是并排两个按钮之一，代理常找不到 -->
        <div v-if="r.locked" class="cp-locked">
          <div class="cp-locked-txt">
            <b>账号已锁定</b>
            <em>{{ r.lockReason || '漏接玩家消息' }}</em>
            <i>解锁前他登录不进去</i>
          </div>
          <button
            type="button"
            class="cp-unlock"
            :disabled="busyId === r.csUserId"
            @click="askUnlock(r)"
          >{{ busyId === r.csUserId ? '解锁中…' : '解 锁' }}</button>
        </div>

        <div class="ops">
          <button type="button" @click="openDetail(r)">罚款明细</button>
        </div>
      </div>
    </div>

    <!-- 超时明细 -->
    <div v-if="detailVisible" class="sp-sheet" @click.self="detailVisible = false">
      <div class="sp-sheet-panel cp-sheet">
        <h3>{{ detailTarget?.nickname }} · 罚款明细</h3>
        <div v-if="detailLoading" class="sp-empty tight">加载中…</div>
        <div v-else-if="!events.length" class="sp-empty tight">这段时间没有超时</div>
        <div v-for="e in events" :key="e.id" class="cp-ev">
          <div class="cp-ev-top">
            <span>{{ e.playerNickname || e.playerUid }}</span>
            <span :class="e.level === 'MISSED' ? 'bad' : 'warn'">
              {{ e.level === 'MISSED' ? '漏接' : '超时' }}
              {{ e.responseText || (e.responseSec === null ? '未回复' : '') }}
            </span>
          </div>
          <div class="cp-ev-sub">
            玩家 {{ fmtTime(e.askedAt) }} 发出
            <template v-if="e.waived"> · <b class="ok">已免除</b>{{ e.waiveReason ? `（${e.waiveReason}）` : '' }}</template>
            <template v-else> · 罚 {{ fmt(e.fine) }} · {{ e.responseText || '未回复' }}</template>
          </div>
          <button v-if="!e.waived" type="button" class="cp-waive" @click="askWaive(e)">撤销罚款</button>
        </div>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" @click="detailVisible = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 免除 -->
    <div v-if="waiveVisible" class="sp-sheet" @click.self="waiveVisible = false">
      <div class="sp-sheet-panel">
        <h3>撤销这笔罚款</h3>
        <p class="hint">报备原因必填，记在这一笔上。还没结清的当日罚款会把这笔减掉。</p>
        <input v-model="waiveReason" type="text" maxlength="40" placeholder="如：手机没电 / 断网">
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="waiveBusy" @click="waiveVisible = false">取消</button>
          <button type="button" class="ok" :disabled="waiveBusy || !waiveReason.trim()" @click="doWaive">确认撤销</button>
        </div>
      </div>
    </div>

    <!-- 解锁 -->
    <div v-if="unlockVisible" class="sp-sheet" @click.self="unlockVisible = false">
      <div class="sp-sheet-panel">
        <h3>解锁客服账号</h3>
        <p class="hint">{{ unlockTarget?.nickname }} 解锁后可以重新登录并接单</p>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="!!busyId" @click="unlockVisible = false">取消</button>
          <button type="button" class="ok" :disabled="!!busyId" @click="doUnlock">确认解锁</button>
        </div>
      </div>
    </div>

    <!-- 规则设置 -->
    <div v-if="policyVisible" class="sp-sheet" @click.self="policyVisible = false">
      <div class="sp-sheet-panel cp-sheet">
        <h3>响应规则与奖惩</h3>
        <label class="cp-f">
          <span>启用考核</span>
          <input v-model="form.enabled" type="checkbox">
        </label>
        <label class="cp-f"><span>提醒时限（分钟）</span><input v-model.number="remindMin" type="number" min="1"></label>
        <label class="cp-f"><span>踢下线时限（分钟）</span><input v-model.number="kickMin" type="number" min="2"></label>
        <label class="cp-f"><span>超时罚款</span><input v-model.number="form.lateFine" type="number" min="0"></label>
        <label class="cp-f"><span>漏接罚款</span><input v-model.number="form.missFine" type="number" min="0"></label>
        <label class="cp-f"><span>日奖及时率（%）</span><input v-model.number="bonusRatePct" type="number" min="0" max="100"></label>
        <label class="cp-f"><span>日奖最少接单</span><input v-model.number="form.bonusMinRounds" type="number" min="1"></label>
        <label class="cp-f"><span>日奖金额</span><input v-model.number="form.dailyBonus" type="number" min="0"></label>
        <label class="cp-f"><span>连续达标天数</span><input v-model.number="form.streakDays" type="number" min="1"></label>
        <label class="cp-f"><span>连续达标奖励</span><input v-model.number="form.streakBonus" type="number" min="0"></label>
        <div class="sp-sheet-actions">
          <button type="button" class="cancel" :disabled="policyBusy" @click="policyVisible = false">取消</button>
          <button type="button" class="ok" :disabled="policyBusy" @click="savePolicy">保存</button>
        </div>
      </div>
    </div>

    <StaffTabBar />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { formatDateTime, formatMoney } from '@gamebox/shared'
import StaffTabBar from '@/components/StaffTabBar.vue'
import {
  staffConsoleApi,
  type CsSlaEventRow,
  type CsSlaPolicy,
  type CsSlaStatRow,
} from '@/api/staffConsole'
import { useToast } from '@/composables/useToast'
import { useBodyClass } from '@/composables/useBodyClass'
import { TIME_RANGES } from '@/composables/timeRange'
import '@/assets/staff-console.css'

useBodyClass('deco-bg')

const router = useRouter()
const { toast } = useToast()

const range = ref('today')
const loading = ref(false)
const rows = ref<CsSlaStatRow[]>([])
const busyId = ref<string | null>(null)

const detailVisible = ref(false)
const detailLoading = ref(false)
const detailTarget = ref<CsSlaStatRow | null>(null)
const events = ref<CsSlaEventRow[]>([])

const waiveVisible = ref(false)
const waiveBusy = ref(false)
const waiveTarget = ref<CsSlaEventRow | null>(null)
const waiveReason = ref('')

const unlockVisible = ref(false)
const unlockTarget = ref<CsSlaStatRow | null>(null)

const policyVisible = ref(false)
const policyBusy = ref(false)
const policy = ref<CsSlaPolicy | null>(null)
const form = ref<CsSlaPolicy>({
  enabled: true,
  remindSec: 180,
  kickSec: 480,
  lateFine: 10,
  missFine: 50,
  bonusMinRate: 0.95,
  bonusMinRounds: 20,
  dailyBonus: 100,
  streakDays: 7,
  streakBonus: 500,
})

/* 界面用分钟和百分比，接口用秒和小数，两边在这里换算 */
const remindMin = computed({
  get: () => Math.round(form.value.remindSec / 60),
  set: (v: number) => { form.value.remindSec = Math.max(1, Math.round(v)) * 60 },
})
const kickMin = computed({
  get: () => Math.round(form.value.kickSec / 60),
  set: (v: number) => { form.value.kickSec = Math.max(2, Math.round(v)) * 60 },
})
const bonusRatePct = computed({
  get: () => Math.round(form.value.bonusMinRate * 100),
  set: (v: number) => { form.value.bonusMinRate = Math.min(100, Math.max(0, v)) / 100 },
})

const policyText = computed(() => {
  const p = policy.value
  if (!p) return ''
  if (!p.enabled) return '已关闭'
  return `${Math.round(p.remindSec / 60)} 分提醒 / ${Math.round(p.kickSec / 60)} 分踢`
})

function fmt(n?: number | null) {
  return formatMoney(n ?? 0)
}
function fmtTime(iso: string) {
  return formatDateTime(iso)
}
/** 秒 → 「2小时13分」，值班时长看的是量级不是精确到秒 */
function hm(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}时${m}分` : `${m}分`
}

async function reload() {
  loading.value = true
  try {
    const [stats, pol] = await Promise.all([
      staffConsoleApi.csSlaStats(range.value),
      staffConsoleApi.csSlaPolicy(),
    ])
    rows.value = stats.list || []
    policy.value = pol
    form.value = { ...pol }
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function switchRange(next: string) {
  if (range.value === next) return
  range.value = next
  void reload()
}

async function openDetail(r: CsSlaStatRow) {
  detailTarget.value = r
  detailVisible.value = true
  detailLoading.value = true
  events.value = []
  try {
    const res = await staffConsoleApi.csSlaEvents(r.csUserId, range.value)
    events.value = res.list || []
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '加载失败')
  } finally {
    detailLoading.value = false
  }
}

function askWaive(e: CsSlaEventRow) {
  waiveTarget.value = e
  waiveReason.value = ''
  waiveVisible.value = true
}

async function doWaive() {
  const target = waiveTarget.value
  const reason = waiveReason.value.trim()
  if (!target || !reason) return
  waiveBusy.value = true
  try {
    await staffConsoleApi.csSlaWaive(target.id, reason)
    const row = events.value.find((x) => x.id === target.id)
    if (row) {
      row.waived = true
      row.waiveReason = reason
    }
    waiveVisible.value = false
    toast('已撤销')
    void reload()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    waiveBusy.value = false
  }
}

function askUnlock(r: CsSlaStatRow) {
  unlockTarget.value = r
  unlockVisible.value = true
}

async function doUnlock() {
  const target = unlockTarget.value
  if (!target) return
  busyId.value = target.csUserId
  try {
    await staffConsoleApi.csSlaUnlock(target.csUserId)
    unlockVisible.value = false
    toast('已解锁')
    void reload()
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '操作失败')
  } finally {
    busyId.value = null
  }
}

function openPolicy() {
  if (policy.value) form.value = { ...policy.value }
  policyVisible.value = true
}

async function savePolicy() {
  policyBusy.value = true
  try {
    const saved = await staffConsoleApi.saveCsSlaPolicy(form.value)
    policy.value = saved
    form.value = { ...saved }
    policyVisible.value = false
    toast('已保存')
  } catch (e: unknown) {
    toast(e instanceof Error ? e.message : '保存失败')
  } finally {
    policyBusy.value = false
  }
}

onMounted(() => { void reload() })
</script>

<style scoped>
/* 规则设置入口：整块可点，右侧固定一个「设置」按钮，一眼看出是能改的 */
.cp-setting {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  text-align: left;
  cursor: pointer;
  border: 1px solid rgba(244, 211, 107, 0.42);
  background:
    radial-gradient(120% 90% at 100% 0%, rgba(245, 200, 66, 0.14), transparent 60%),
    linear-gradient(180deg, rgba(52, 40, 22, 0.6) 0%, rgba(20, 14, 8, 0.92) 100%);
}
.cp-setting:active { filter: brightness(1.12); }
.cp-setting-ic {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid rgba(244, 211, 107, 0.45);
  background: linear-gradient(160deg, rgba(90, 68, 28, 0.95), rgba(36, 26, 12, 0.98));
}
.cp-setting-ic svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: #ffe9a8;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.cp-setting-txt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.cp-setting-txt b {
  font-size: 14px;
  letter-spacing: 1px;
  color: rgba(255, 236, 179, 0.95);
}
.cp-setting-txt em {
  font-style: normal;
  font-size: 12px;
  color: rgba(244, 211, 107, 0.6);
}
.cp-setting-go {
  flex-shrink: 0;
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #1a1408;
  background: linear-gradient(180deg, #f4d36b 0%, var(--gold) 55%, #8a6f1f 100%);
}
.cp-state {
  margin-left: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-muted);
  border: 1px solid rgba(244, 211, 107, 0.25);
}
.cp-state.on {
  color: #bbf7d0;
  border-color: rgba(134, 239, 172, 0.5);
}
.cp-state.lock {
  color: #fecaca;
  border-color: rgba(252, 165, 165, 0.5);
}
.cp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  margin: 10px 0;
}
.cp-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.26);
  border: 1px solid rgba(212, 175, 55, 0.14);
}
.cp-cell .mk {
  font-size: 11px;
  color: var(--text-muted);
}
.cp-cell .mv {
  font-size: var(--money-third);
  font-weight: 800;
  color: #fff4c2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.cp-cell .mv.warn { color: #fbbf24; }
.cp-cell .mv.bad { color: #fca5a5; }
/* 锁定条：红底整块 + 右侧解锁按钮，代理不用在两个小按钮里找 */
.cp-locked {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(252, 165, 165, 0.45);
  background: rgba(127, 29, 29, 0.4);
}
.cp-locked-txt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cp-locked-txt b {
  font-size: 13px;
  letter-spacing: 1px;
  color: #fecaca;
}
.cp-locked-txt em,
.cp-locked-txt i {
  font-style: normal;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(254, 202, 202, 0.75);
}
.cp-unlock {
  flex-shrink: 0;
  padding: 9px 16px;
  border-radius: 999px;
  border: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 1px;
  cursor: pointer;
  color: #06281a;
  background: linear-gradient(180deg, #86efac 0%, #22c55e 60%, #15803d 100%);
}
.cp-unlock:disabled { opacity: 0.6; }
.cp-sheet {
  overflow-y: auto;
}
.cp-ev {
  padding: 10px 0;
  border-bottom: 1px dashed rgba(212, 175, 55, 0.16);
}
.cp-ev-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  color: rgba(255, 236, 179, 0.9);
}
.cp-ev-top .warn { color: #fbbf24; }
.cp-ev-top .bad { color: #fca5a5; }
.cp-ev-sub {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted);
}
.cp-ev-sub .ok { color: #86efac; }
.cp-waive {
  margin-top: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  color: rgba(244, 211, 107, 0.85);
  background: transparent;
  border: 1px solid rgba(244, 211, 107, 0.4);
  cursor: pointer;
}
.cp-f {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  font-size: 13px;
  color: rgba(255, 236, 179, 0.85);
  border-bottom: 1px dashed rgba(212, 175, 55, 0.14);
}
.cp-f input[type="number"] {
  width: 96px;
  text-align: right;
}
</style>
