<template>
  <DeskDialog v-model="open" title="玩家画像" width="880px">
    <div v-loading="loading" class="pp">
      <template v-if="data">
        <header class="pp-hero">
          <div class="pp-hero-id">
            <div class="pp-hero-top">
              <b class="pp-hero-name">{{ data.member.nickname }}</b>
              <el-tag size="small" effect="plain" :type="data.member.status === 'ACTIVE' ? 'success' : 'info'">
                {{ data.member.status === 'ACTIVE' ? '正常' : '停用' }}
              </el-tag>
            </div>
            <div class="pp-hero-meta">
              <span><em>账号</em>{{ data.member.username }}</span>
              <span><em>UID</em>{{ data.member.uid }}</span>
              <span><em>IP</em>{{ data.member.lastLoginIp || '—' }}</span>
              <span><em>注册</em>{{ fmtTime(data.member.createdAt) }}</span>
              <span><em>最后登录</em>{{ fmtTime(data.member.lastLoginAt) }}</span>
            </div>
          </div>
          <div class="pp-hero-bal">
            <span class="pp-hero-bal-k">{{ scopeRoomId ? '本房余额' : '账户余额' }}</span>
            <span class="pp-hero-bal-v">{{ fmt(data.member.totalBalance) }}</span>
          </div>
        </header>

        <div v-if="data.member.rooms.length > 1" class="pp-scope">
          <span class="pp-scope-k">房间</span>
          <el-radio-group v-model="scopeRoomId" size="small" @change="load">
            <el-radio-button label="">各房合计</el-radio-button>
            <el-radio-button
              v-for="r in data.member.rooms"
              :key="r.roomId"
              :label="r.roomId"
            >{{ r.name }}（{{ r.roomNo }}）</el-radio-button>
          </el-radio-group>
        </div>

        <section class="pp-sec">
          <h4 class="pp-h">资金运营画像</h4>
          <div class="pp-money">
            <div class="pp-card">
              <span class="pp-card-k">历史累计充值</span>
              <span class="pp-card-v gold">{{ fmt(data.funds.upAmount) }}</span>
            </div>
            <div class="pp-card">
              <span class="pp-card-k">历史累计下注</span>
              <span class="pp-card-v">{{ fmt(data.funds.totalBet) }}</span>
            </div>
            <div class="pp-card">
              <span class="pp-card-k">中奖赢取金额</span>
              <span class="pp-card-v win">{{ fmt(data.funds.winAmount) }}</span>
            </div>
            <div class="pp-card">
              <span class="pp-card-k">未中奖扣减</span>
              <span class="pp-card-v lose">{{ fmt(data.funds.loseAmount) }}</span>
            </div>
          </div>

          <div class="pp-rip">
            <div class="pp-rip-head">
              <span class="pp-rip-k">充值返还比例 RIP</span>
              <span class="pp-rip-v" :style="{ color: ripColor }">{{ ripText }}</span>
              <span v-if="data.funds.rip != null" class="pp-rip-tag" :style="{ color: ripColor }">
                {{ data.funds.rip >= 100 ? '玩家赢' : '玩家输' }}
              </span>
              <span class="pp-rip-sub">
                下分 {{ fmt(data.funds.downAmount) }} ÷ 上分 {{ fmt(data.funds.upAmount) }}
              </span>
            </div>
            <template v-if="data.funds.rip != null">
              <div class="pp-pk">
                <i class="pk-out" :style="{ width: `${pkOutPct}%` }" />
                <i class="pk-keep" :style="{ width: `${100 - pkOutPct}%` }" />
              </div>
              <div class="pp-pk-legend">
                <span><u class="dot out" />玩家取回 {{ data.funds.rip }}%</span>
                <span :class="{ neg: keepPct < 0 }">
                  {{ keepPct < 0 ? `平台倒贴 ${-keepPct}%` : `平台留存 ${keepPct}%` }}
                  <u class="dot keep" />
                </span>
              </div>
            </template>
            <div v-else class="pp-empty">没有上分记录，算不出比例</div>
          </div>
        </section>

        <section class="pp-sec">
          <h4 class="pp-h">房间与代理</h4>
          <div v-if="!visibleRooms.length" class="pp-empty">未加入任何房间</div>
          <div v-else class="pp-rooms">
            <div v-for="r in visibleRooms" :key="r.roomId" class="pp-room">
              <span class="pp-room-tag" :class="r.bookMode === 'CREDIT' ? 'credit' : 'cash'">
                {{ r.bookMode === 'CREDIT' ? 'B 信用' : 'A 现金' }}
              </span>
              <div class="pp-room-main">
                <span class="pp-room-name">{{ r.name }}</span>
                <span class="pp-sub-l">{{ r.roomNo }}</span>
              </div>
              <div class="pp-room-agent">
                <span>{{ r.agentNickname || '—' }}</span>
                <span v-if="r.agentUsername" class="pp-sub-l">{{ r.agentUsername }}</span>
              </div>
              <div class="pp-room-bal">
                <span class="pp-sub-l">本房持分</span>
                <b>{{ fmt(r.balance) }}</b>
              </div>
            </div>
          </div>
        </section>

        <section class="pp-sec">
          <h4 class="pp-h">游戏偏好排行</h4>
          <div v-if="!data.preferences.length" class="pp-empty">暂无注单</div>
          <div v-else class="pp-prefs">
            <div v-for="(p, i) in data.preferences" :key="p.gameCode" class="pp-pref" :class="`r${i}`">
              <span class="pp-pref-rank">{{ PREF_LABELS[i] }}</span>
              <div class="pp-pref-name">{{ p.name }}</div>
              <div class="pp-sub-l">{{ categoryLabel(p.category) }} · {{ p.betCount }} 笔</div>
              <div class="pp-pref-amt">{{ fmt(p.amount) }}</div>
              <div class="pp-pref-bar"><i :style="{ width: `${Math.max(p.pct, 2)}%` }" /></div>
              <div class="pp-sub-l">占下注 {{ p.pct }}%</div>
            </div>
          </div>
        </section>

        <section class="pp-sec">
          <h4 class="pp-h">账号风险与异常</h4>
          <div class="pp-risk">
            <div class="pp-risk-col">
              <div class="pp-risk-t">
                风控告警
                <el-tag v-if="data.risk.alerts.length" size="small" type="danger" effect="plain">
                  {{ data.risk.alerts.length }}
                </el-tag>
              </div>
              <div v-if="!data.risk.alerts.length" class="pp-empty">无</div>
              <ul v-else class="pp-list">
                <li v-for="a in data.risk.alerts" :key="a.id">
                  <div class="pp-list-head">
                    <el-tag size="small" effect="plain" :type="a.level === 'CRITICAL' ? 'danger' : 'warning'">
                      {{ riskTypeLabel(a.type) }}
                    </el-tag>
                    <span class="pp-sub-l">{{ fmtTime(a.createdAt) }}{{ a.handled ? ' · 已处理' : '' }}</span>
                  </div>
                  <div v-if="a.summary" class="pp-list-txt">{{ a.summary }}</div>
                </li>
              </ul>
            </div>
            <div class="pp-risk-col">
              <div class="pp-risk-t">
                同 IP 其他账号
                <el-tag v-if="data.risk.sameIpAccounts.length" size="small" type="warning" effect="plain">
                  {{ data.risk.sameIpAccounts.length }}
                </el-tag>
              </div>
              <div v-if="!data.risk.sameIpAccounts.length" class="pp-empty">无</div>
              <ul v-else class="pp-list">
                <li v-for="u in data.risk.sameIpAccounts" :key="u.id">
                  <div class="pp-list-txt">{{ u.nickname }}</div>
                  <div class="pp-sub-l">{{ u.uid }} / {{ u.username }}</div>
                </li>
              </ul>
            </div>
            <div class="pp-risk-col">
              <div class="pp-risk-t">软控状态</div>
              <div v-if="!data.risk.softBias.length" class="pp-empty">未被盯</div>
              <ul v-else class="pp-list">
                <li v-for="b in data.risk.softBias" :key="b.id">
                  <div class="pp-list-head">
                    <el-tag size="small" effect="plain" :type="b.enabled ? 'danger' : 'info'">
                      {{ b.kind === 'PLAYER_LOSE' ? '偏输' : '偏赢' }}{{ b.enabled ? '' : '（已停）' }}
                    </el-tag>
                    <span class="pp-sub-l">{{ fmt(b.progressAmount) }} / {{ fmt(b.goalAmount) }}</span>
                  </div>
                  <div class="pp-sub-l">{{ b.roomName || '' }} {{ b.roomNo || '' }}</div>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </template>
    </div>

    <template #footer>
      <el-button @click="open = false">关闭</el-button>
      <span class="win-footer-grow" />
      <el-button v-if="canSoftControl" type="danger" :disabled="!data" @click="openBias">
        添加偏置
      </el-button>
    </template>
  </DeskDialog>

  <DeskDialog v-model="biasOpen" title="添加偏置" width="460px">
    <el-alert
      v-if="activeBias"
      type="warning"
      :closable="false"
      show-icon
      class="pp-alert"
      :title="`该玩家已有启用中的${activeBias.kind === 'PLAYER_LOSE' ? '偏输' : '偏赢'}策略，进度 ${fmt(activeBias.progressAmount)} / ${fmt(activeBias.goalAmount)}`"
    />
    <el-form label-width="86px">
      <el-form-item label="玩家">
        <b>{{ data?.member.nickname }}</b>
        <span class="pp-sub-l" style="margin-left:6px">{{ data?.member.uid }} / {{ data?.member.username }}</span>
      </el-form-item>
      <el-form-item label="房间" required>
        <el-select v-model="biasForm.roomId" placeholder="选择房间" style="width:100%">
          <el-option
            v-for="r in data?.member.rooms || []"
            :key="r.roomId"
            :label="`${r.name}（${r.roomNo}）`"
            :value="r.roomId"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="方向" required>
        <el-radio-group v-model="biasForm.kind">
          <el-radio-button label="PLAYER_LOSE">偏输</el-radio-button>
          <el-radio-button label="PLAYER_WIN">偏赢</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="目标金额" required>
        <el-input-number
          v-model="biasForm.goalAmount"
          :min="1"
          :max="10000000"
          :precision="0"
          controls-position="right"
          style="width:100%"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="biasForm.remark" maxlength="100" />
      </el-form-item>
      <el-form-item label="管理密码" required>
        <el-input v-model="biasForm.adminPassword" type="password" show-password autocomplete="off" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="biasOpen = false">取消</el-button>
      <span class="win-footer-grow" />
      <el-button type="danger" :loading="biasSaving" @click="submitBias">确认添加</el-button>
    </template>
  </DeskDialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DeskDialog from '@/components/DeskDialog.vue'
import { consoleApi, type PlayerProfile } from '@/api/console'
import { useAdminStore } from '@/stores/admin'
import { formatMoney } from '@gamebox/shared'

const props = defineProps<{ modelValue: boolean; playerId: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const PREF_LABELS = ['首要偏好', '次要偏好', '备用游戏']
const RISK_LABELS: Record<string, string> = {
  BIG_WIN: '大额中奖',
  SAME_IP: '同 IP 多号',
  SUSPECT_WASH: '疑似刷分',
  COLLUSION: '疑似对刷',
}
const CATEGORY_LABELS: Record<string, string> = {
  LOTTERY: '彩票',
  TABLE: '棋牌',
  SLOT: '电子',
  ARCADE: '街机',
}

const store = useAdminStore()
const loading = ref(false)
const data = ref<PlayerProfile | null>(null)
/** 空串=各房合计；选了房，资金与偏好都只算那一间 */
const scopeRoomId = ref('')

const visibleRooms = computed(() => {
  const rooms = data.value?.member.rooms ?? []
  return scopeRoomId.value ? rooms.filter((r) => r.roomId === scopeRoomId.value) : rooms
})

/* 偏置写操作本来就只对超管开放；总监能看画像但不给这个按钮 */
const canSoftControl = computed(() => store.profile?.role === 'ADMIN')

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const activeBias = computed(() => data.value?.risk.softBias.find((b) => b.enabled) ?? null)

const ripText = computed(() => {
  const v = data.value?.funds.rip
  return v == null ? '—' : `${v}%`
})
const ripColor = computed(() => {
  const v = data.value?.funds.rip
  if (v == null) return '#94a3b8'
  return v >= 100 ? '#ef4444' : '#16a34a'
})
/*
 * PK 条：左边玩家取回、右边平台留存，两段永远加起来铺满整条。
 * 取回超过 100% 时左边顶满，差额转成「平台倒贴」写在图例上。
 */
const pkOutPct = computed(() => {
  const v = data.value?.funds.rip
  if (v == null || v <= 0) return 0
  return Math.min(100, v)
})
const keepPct = computed(() => {
  const v = data.value?.funds.rip
  if (v == null) return 0
  return Math.round((100 - v) * 10) / 10
})

const biasOpen = ref(false)
const biasSaving = ref(false)
const biasForm = reactive({
  roomId: '',
  kind: 'PLAYER_LOSE',
  goalAmount: 1000,
  remark: '',
  adminPassword: '',
})

function fmt(n?: number | null) {
  if (n == null) return '—'
  return formatMoney(n)
}
function fmtTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function riskTypeLabel(t: string) {
  return RISK_LABELS[t] || t
}
function categoryLabel(c: string | null) {
  return c ? CATEGORY_LABELS[c] || c : '—'
}

function openBias() {
  const rooms = data.value?.member.rooms || []
  if (!rooms.length) {
    return ElMessage.warning('该玩家没有已通过的房间，无法添加')
  }
  /* 只有一间房直接带上；多房时若正在看某一间，就带那间，否则必须自己选 */
  biasForm.roomId = rooms.length === 1 ? rooms[0].roomId : scopeRoomId.value
  biasForm.kind = 'PLAYER_LOSE'
  biasForm.goalAmount = 1000
  biasForm.remark = ''
  biasForm.adminPassword = ''
  biasOpen.value = true
}

async function submitBias() {
  const m = data.value?.member
  if (!m) return
  if (!biasForm.roomId) return ElMessage.warning('请选择房间')
  if (!biasForm.goalAmount || biasForm.goalAmount <= 0) return ElMessage.warning('请填写目标金额')
  if (!biasForm.adminPassword) return ElMessage.warning('请输入管理密码')

  const room = m.rooms.find((r) => r.roomId === biasForm.roomId)
  const dir = biasForm.kind === 'PLAYER_LOSE' ? '偏输' : '偏赢'
  try {
    /* 把人念一遍再落库，这一步就是防搞错人 */
    await ElMessageBox.confirm(
      `玩家：${m.nickname}（${m.uid} / ${m.username}）\n`
      + `房间：${room?.name || ''}（${room?.roomNo || ''}）\n`
      + `方向：${dir}，目标金额 ${biasForm.goalAmount}`,
      '确认添加偏置',
      { type: 'warning', confirmButtonText: '确认添加' },
    )
  } catch {
    return
  }

  biasSaving.value = true
  try {
    await consoleApi.softBiasCreate({
      kind: biasForm.kind,
      roomId: biasForm.roomId,
      playerId: m.id,
      goalAmount: biasForm.goalAmount,
      remark: biasForm.remark.trim() || `玩家画像添加·${dir}`,
      enabled: true,
      adminPassword: biasForm.adminPassword,
    })
    ElMessage.success('偏置已添加')
    biasOpen.value = false
    await load()
  } catch (e: unknown) {
    const msg = (e as { response?: { data?: { message?: string } }; message?: string })
    ElMessage.error(msg?.response?.data?.message || msg?.message || '添加失败')
  } finally {
    biasSaving.value = false
  }
}

async function load() {
  if (!props.playerId) return
  loading.value = true
  try {
    data.value = await consoleApi.playerProfile(props.playerId, scopeRoomId.value || undefined)
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
    data.value = null
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.modelValue, props.playerId],
  ([shown]) => {
    if (!shown) return
    /* 换人重开先回到各房合计，免得带着上一个人选的房去查 */
    scopeRoomId.value = ''
    void load()
  },
)
</script>

<style scoped>
.pp {
  min-height: 200px;
  --pp-line: #e5e9f0;
  --pp-muted: #8a94a6;
}

.pp-hero {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--pp-line);
  border-radius: 6px;
  background: #f9fafb;
}
.pp-hero-id { flex: 1; min-width: 0; }
.pp-hero-top { display: flex; align-items: center; gap: 8px; }
.pp-hero-name { font-size: 14px; font-weight: 700; color: #0f172a; }
.pp-hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 14px;
  margin-top: 4px;
  font-size: 11px;
  color: #475569;
}
.pp-hero-meta em {
  font-style: normal;
  color: var(--pp-muted);
  margin-right: 4px;
}
.pp-hero-bal {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-left: 14px;
  border-left: 1px solid var(--pp-line);
}
.pp-hero-bal-k { font-size: 11px; color: var(--pp-muted); }
.pp-hero-bal-v {
  font-size: 16px;
  font-weight: 700;
  color: var(--ops-gold, #d97706);
  font-variant-numeric: tabular-nums;
}

.pp-scope {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.pp-scope-k { font-size: 11px; font-weight: 600; color: #475569; }

/* 分区之间只用一条分隔线；边框只留给最里层的卡片，不做框里套框 */
.pp-sec {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--pp-line);
}
.pp-h {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 700;
  color: #0f172a;
}

.pp-money {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.pp-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--pp-line);
  border-radius: 6px;
  background: #fbfcfd;
  min-width: 0;
}
.pp-card-k { font-size: 11px; color: var(--pp-muted); }
.pp-card-v {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.gold { color: var(--ops-gold, #d97706); }
.win { color: #16a34a; }
.lose { color: #ef4444; }

/* RIP：PK 条，左取回右留存，两段永远铺满。跟着上面四张卡片走，不再自套一个框 */
.pp-rip { margin-top: 10px; }
.pp-rip-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 2px 8px;
}
.pp-rip-k { font-size: 11px; font-weight: 600; color: #475569; }
.pp-rip-v {
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.pp-rip-tag { font-size: 11px; font-weight: 700; }
.pp-rip-sub {
  margin-left: auto;
  font-size: 11px;
  color: var(--pp-muted);
}
.pp-pk {
  display: flex;
  height: 8px;
  margin-top: 7px;
  border-radius: 3px;
  overflow: hidden;
  background: #eef1f5;
}
.pp-pk i {
  display: block;
  height: 100%;
  transition: width 0.25s ease;
}
.pp-pk .pk-out { background: #ef4444; }
.pp-pk .pk-keep { background: #16a34a; }
.pp-pk-legend {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 11px;
  color: #475569;
  font-variant-numeric: tabular-nums;
}
.pp-pk-legend .neg { color: #ef4444; font-weight: 600; }
.pp-pk-legend .dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 2px;
  margin: 0 5px;
  vertical-align: middle;
  text-decoration: none;
}
.pp-pk-legend .dot.out { background: #ef4444; margin-left: 0; }
.pp-pk-legend .dot.keep { background: #16a34a; margin-right: 0; }

/* 房间：一间一条长条 */
.pp-rooms { display: flex; flex-direction: column; gap: 6px; }
/* 定宽三段，多间房时上下对齐，不会一行一个位置 */
.pp-room {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border: 1px solid var(--pp-line);
  border-radius: 6px;
  background: #fbfcfd;
}
.pp-room-tag {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
}
.pp-room-tag.cash { color: #166534; background: #dcfce7; }
.pp-room-tag.credit { color: #92400e; background: #fef3c7; }
.pp-room-main {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.pp-room-name { font-size: 12px; font-weight: 600; color: #0f172a; }
.pp-room-agent {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
  color: #475569;
}
.pp-room-bal {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.pp-room-bal b {
  font-size: 13px;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.pp-sub-l { font-size: 11px; color: var(--pp-muted); }
.pp-empty { font-size: 11px; color: var(--pp-muted); padding: 4px 0; }

/* 偏好：三个方块一行 */
.pp-prefs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.pp-pref {
  padding: 9px 10px;
  border: 1px solid var(--pp-line);
  border-radius: 6px;
  background: #fbfcfd;
  min-width: 0;
}
.pp-pref-rank {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  color: #92400e;
  background: #fef3c7;
}
.pp-pref.r1 .pp-pref-rank { color: #3730a3; background: #e0e7ff; }
.pp-pref.r2 .pp-pref-rank { color: #475569; background: #e8ecf1; }
.pp-pref-name {
  margin-top: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pp-pref-amt {
  margin-top: 6px;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.pp-pref-bar {
  width: 100%;
  height: 4px;
  margin: 5px 0 3px;
  border-radius: 2px;
  background: #eef1f5;
  overflow: hidden;
}
.pp-pref-bar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: #6366f1;
}

.pp-risk {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.pp-risk-t {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 5px;
  color: #475569;
}
.pp-list { margin: 0; padding: 0; list-style: none; max-height: 150px; overflow-y: auto; }
.pp-list li {
  padding: 5px 0;
  border-bottom: 1px dashed #eef1f5;
}
.pp-list li:last-child { border-bottom: none; }
.pp-list-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pp-list-txt { font-size: 11px; color: #0f172a; margin-top: 2px; line-height: 1.45; }

.pp-alert { margin-bottom: 12px; }

@media (max-width: 900px) {
  .pp-money { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pp-prefs { grid-template-columns: minmax(0, 1fr); }
  .pp-risk { grid-template-columns: minmax(0, 1fr); }
  .pp-hero { flex-wrap: wrap; }
  .pp-hero-bal { padding-left: 0; border-left: none; }
  .pp-room { flex-wrap: wrap; }
  .pp-room-agent { width: auto; }
}
</style>
