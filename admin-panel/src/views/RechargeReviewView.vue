<template>
  <div class="cs-desk">
    <div v-if="isCs" class="cs-status-bar">
      <span>接单状态</span>
      <el-switch
        v-model="csIdle"
        inline-prompt
        active-text="接单"
        inactive-text="休息"
        :loading="csStatusBusy"
        @change="onCsStatusChange"
      />
      <span class="cs-bal">额度 {{ csBalanceText }}</span>
      <el-button text type="primary" size="small" @click="refreshCsMe">刷新</el-button>
      <el-button text type="primary" size="small" @click="openWageDialog">佣金记录</el-button>
      <el-button type="primary" plain size="small" class="cs-settings-btn" @click="openCsSettings">
        设置
      </el-button>
    </div>
    <div v-else-if="canDeskTools" class="cs-status-bar agent-tools">
      <span class="cs-bal">快捷话术与收款码</span>
      <el-button type="primary" plain size="small" class="cs-settings-btn" @click="openCsSettings">
        设置
      </el-button>
    </div>
    <!-- 代理三栏：名单 · 聊天 · 审核；客服两栏：会话 ·（对话+右侧资料/申请/充值） -->
    <div class="shell" :class="{ 'cs-only': isCs }">
        <!-- 联系人 / 流水 -->
        <aside class="contacts panel">
          <div class="contacts-tabs">
            <button
              type="button"
              class="ctab"
              :class="{ on: leftTab === 'sessions' }"
              @click="leftTab = 'sessions'"
            >
              会话
              <i v-if="unreadTotal" class="dot">{{ unreadTotal > 99 ? '99+' : unreadTotal }}</i>
            </button>
            <button
              v-if="!isCs"
              type="button"
              class="ctab"
              :class="{ on: leftTab === 'flow' }"
              @click="leftTab = 'flow'"
            >
              昨日流水
            </button>
            <button
              type="button"
              class="icon-btn"
              title="刷新"
              @click="leftTab === 'flow' && !isCs ? loadFlowBoard() : loadSessions()"
            >
              ↻
            </button>
          </div>

          <div v-show="leftTab === 'sessions'" class="clist" v-loading="sessionsLoading">
            <button
              v-for="s in sessions"
              :key="s.playerId"
              type="button"
              class="crow"
              :class="{ on: s.playerId === selectedPlayerId }"
              @click="selectSession(s)"
            >
              <span class="av">{{ (s.nickname || '?').slice(0, 1) }}</span>
              <span class="crow-body">
                <span class="crow-top">
                  <b>{{ s.nickname }}</b>
                  <em>{{ fmtShort(s.lastAt) }}</em>
                </span>
                <span class="crow-preview">
                  <i v-if="s.unread" class="dot sm">{{ s.unread > 99 ? '99+' : s.unread }}</i>
                  {{ previewSender(s.lastSender) }}{{ sessionPreviewText(s.lastText) }}
                </span>
              </span>
            </button>
            <div v-if="!sessionsLoading && !sessions.length" class="clist-empty">
              {{
                isCs
                  ? '等待系统派单：玩家咨询后会按接单权重随机分配'
                  : '暂无会话，去看昨日流水'
              }}
            </div>
          </div>

          <div v-if="!isCs" v-show="leftTab === 'flow'" class="clist" v-loading="flowLoading">
            <button
              v-for="(row, idx) in flowList"
              :key="row.playerId"
              type="button"
              class="crow flow"
              :class="{ on: row.playerId === selectedPlayerId }"
              @click="pickFlowPlayer(row)"
            >
              <span class="rank">{{ idx + 1 }}</span>
              <span class="crow-body">
                <span class="crow-top">
                  <b>{{ row.nickname }}</b>
                  <em class="gold">{{ fmtNum(row.validFlow) }}</em>
                </span>
                <span class="crow-preview">{{ row.uid }} · {{ row.betCount }} 注</span>
              </span>
              <span
                class="tea-hit"
                title="发早茶"
                @click.stop="openTeaDialog(row)"
              >早茶</span>
            </button>
            <div v-if="!flowLoading && !flowList.length" class="clist-empty">
              昨日暂无有效流水
            </div>
          </div>
        </aside>

        <!-- 聊天（客服时右侧嵌入基本信息/申请/充值） -->
        <section class="room panel" :class="{ 'with-side': isCs }">
          <div class="room-main">
            <header class="room-bar">
              <template v-if="selectedPlayerId">
                <span class="av lg">{{ avatarLetter }}</span>
                <div class="room-meta">
                  <div class="room-name">{{ selectedDisplay?.nickname || '玩家' }}</div>
                  <div class="room-sub">
                    {{ selectedDisplay?.uid }}
                    <template v-if="!isCs && selectedYesterdayFlow != null">
                      · 昨日流水 {{ fmtNum(selectedYesterdayFlow) }}
                    </template>
                  </div>
                </div>
                <div v-if="!isCs" class="room-ops">
                  <button type="button" class="ghost-btn" @click="openTeaForSelected">发早茶</button>
                  <button type="button" class="ghost-btn" @click="focusPlayerOrders">看申请</button>
                  <button
                    v-if="canDeskTools"
                    type="button"
                    class="ghost-btn"
                    @click="openCsSettings"
                  >设置</button>
                </div>
              </template>
              <template v-else>
                <div class="room-meta alone">
                  <div class="room-name">客服对话</div>
                  <div class="room-sub">在左侧点玩家后开始</div>
                </div>
                <div v-if="canDeskTools && !isCs" class="room-ops">
                  <button type="button" class="ghost-btn" @click="openCsSettings">设置</button>
                </div>
              </template>
            </header>

            <div class="msgs" ref="bubblesEl" v-loading="!!selectedPlayerId && messagesLoading">
              <div v-if="!selectedPlayerId" class="msgs-hint">
                {{ isCs ? '等待系统派单后，从左侧会话进入对话' : '← 选择玩家开始对话' }}
              </div>
              <div v-else-if="!messagesLoading && !messages.length" class="msgs-hint">
                {{ isCs ? '暂无消息' : '暂无消息，可点「发早茶」通知玩家' }}
              </div>
              <template v-else>
                <div
                  v-for="m in messages"
                  :key="m.id"
                  class="msg"
                  :class="m.sender === 'SYSTEM' ? 'sys' : bubbleSide(m.sender)"
                >
                  <div class="msg-bubble">
                    <p v-if="msgCaption(m.text)">{{ msgCaption(m.text) }}</p>
                    <PrivateMediaImage
                      v-if="msgImage(m.text)"
                      class="msg-img"
                      :src="msgImage(m.text)"
                      alt="收款码"
                    />
                    <time>{{ fmtClock(m.createdAt) }}</time>
                  </div>
                </div>
              </template>
            </div>

            <div v-if="canDeskTools && selectedPlayerId" class="quick-bar">
              <button
                v-for="(t, i) in csSettings.quickReplies"
                :key="`qr-${i}`"
                type="button"
                class="qchip"
                :disabled="replyLoading"
                @click="sendQuickText(t)"
              >
                {{ t.length > 10 ? `${t.slice(0, 10)}…` : t }}
              </button>
              <el-dropdown
                trigger="click"
                :disabled="replyLoading || !csSettings.wechatQrs.length"
                @command="(cmd: string) => onPayQrCommand('wechat', cmd)"
              >
                <button
                  type="button"
                  class="qchip pay wx"
                  :disabled="replyLoading || !csSettings.wechatQrs.length"
                >
                  发微信码 ▾
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item
                      v-if="csSettings.wechatQrs.length > 1"
                      command="__all__"
                    >
                      全部发送（{{ csSettings.wechatQrs.length }}张）
                    </el-dropdown-item>
                    <el-dropdown-item
                      v-for="(q, i) in csSettings.wechatQrs"
                      :key="q.id"
                      :command="q.id"
                      :divided="i === 0 && csSettings.wechatQrs.length > 1"
                    >
                      {{ q.name || `微信收款码 ${i + 1}` }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <el-dropdown
                trigger="click"
                :disabled="replyLoading || !csSettings.alipayQrs.length"
                @command="(cmd: string) => onPayQrCommand('alipay', cmd)"
              >
                <button
                  type="button"
                  class="qchip pay ali"
                  :disabled="replyLoading || !csSettings.alipayQrs.length"
                >
                  发支付宝码 ▾
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item
                      v-if="csSettings.alipayQrs.length > 1"
                      command="__all__"
                    >
                      全部发送（{{ csSettings.alipayQrs.length }}张）
                    </el-dropdown-item>
                    <el-dropdown-item
                      v-for="(q, i) in csSettings.alipayQrs"
                      :key="q.id"
                      :command="q.id"
                      :divided="i === 0 && csSettings.alipayQrs.length > 1"
                    >
                      {{ q.name || `支付宝收款码 ${i + 1}` }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>

            <footer class="composer">
              <textarea
                v-model="draft"
                rows="1"
                maxlength="500"
                :disabled="!selectedPlayerId"
                :placeholder="selectedPlayerId ? '输入消息，Enter 发送' : '请先选择玩家'"
                @keydown="onComposerKey"
                @input="autoGrow"
                ref="composerEl"
              />
              <button
                type="button"
                class="send"
                :disabled="!selectedPlayerId || !draft.trim() || replyLoading"
                @click="sendReply"
              >
                {{ replyLoading ? '…' : '发送' }}
              </button>
            </footer>
          </div>

          <!-- 客服：对话大框右侧 -->
          <aside v-if="isCs" class="room-side" ref="csRechargeEl">
            <div v-if="!selectedPlayerId" class="clist-empty pad">
              {{ isCs ? '系统派单后可在此审核上下分' : '选择玩家后显示资料与充值' }}
            </div>
            <template v-else>
              <div class="side-block player-card">
                <div class="cs-player">
                  <div class="av">{{ avatarLetter }}</div>
                  <div>
                    <div class="name">{{ selectedDisplay?.nickname || '玩家' }}</div>
                    <div class="uid">UID {{ selectedDisplay?.uid }}</div>
                  </div>
                </div>
              </div>

              <div class="side-block">
                <div class="side-title">
                  上下分申请
                  <button type="button" class="side-refresh" @click="() => loadCsPlayerOrders()">刷新</button>
                </div>
                <div v-loading="csOrdersLoading" class="side-orders">
                  <div v-if="!csPlayerOrders.length" class="side-empty">暂无待审申请</div>
                  <div
                    v-for="row in csPlayerOrders"
                    :key="row.id"
                    class="side-order"
                    role="button"
                    @click="fillFundFromOrder(row)"
                  >
                    <div class="side-order-top">
                      <el-tag size="small" :type="row.type === 'UP' ? 'success' : 'warning'">
                        {{ row.type === 'UP' ? '上分' : '下分' }}
                      </el-tag>
                      <b class="gold amt">{{ row.amount.toLocaleString() }}</b>
                      <el-tag
                        v-if="payChannelLabel(row.channel)"
                        size="small"
                        type="info"
                        effect="plain"
                      >
                        {{ payChannelLabel(row.channel) }}
                      </el-tag>
                      <span class="side-order-time">{{ fmtClock(row.createdAt) }}</span>
                    </div>
                    <div v-if="row.status === 'PENDING'" class="order-acts" @click.stop>
                      <button type="button" class="act ok" :disabled="opLoading" @click="approve(row)">通过</button>
                      <button type="button" class="act no" :disabled="opLoading" @click="openReject(row)">拒绝</button>
                    </div>
                  </div>
                </div>
              </div>

              <div class="side-block grow">
                <div class="side-title">{{ csFundMode === 'up' ? '充值' : '下分' }}</div>
                <el-radio-group v-model="csFundMode" size="small" class="cs-mode">
                  <el-radio-button label="up">充值</el-radio-button>
                  <el-radio-button label="down">下分</el-radio-button>
                </el-radio-group>

                <div class="cs-amt-label">金额</div>
                <el-input-number
                  v-model="csFundAmount"
                  :min="csFundMode === 'up' ? PLAYER_UP_MIN : PLAYER_DOWN_MIN"
                  :max="PLAYER_FUND_MAX"
                  :precision="0"
                  :controls="false"
                  class="cs-amt"
                />

                <div v-if="csFundHint" class="cs-preview warn">{{ csFundHint }}</div>

                <el-button
                  type="primary"
                  class="cs-submit"
                  :loading="csFundBusy"
                  :disabled="!csFundOk"
                  @click="submitCsFund"
                >
                  {{ csFundMode === 'up' ? '确认充值' : '确认下分' }}
                </el-button>
              </div>
            </template>
          </aside>
        </section>

      <!-- 审核（仅代理） -->
      <aside v-if="!isCs" class="queue panel">
        <div class="queue-bar">
          <div class="queue-title">
            上下分
            <span v-if="pendingHint != null" class="pill">{{ pendingHint }}</span>
          </div>
          <el-radio-group v-model="orderScope" size="small" @change="onScopeChange">
            <el-radio-button label="all">全部</el-radio-button>
            <el-radio-button label="player" :disabled="!selectedPlayerId">该玩家</el-radio-button>
          </el-radio-group>
        </div>

        <div v-if="selectedPlayerId" class="queue-chip">
          <span>{{ selectedDisplay?.nickname }}</span>
          <b>昨日 {{ selectedYesterdayFlow == null ? '…' : fmtNum(selectedYesterdayFlow) }}</b>
        </div>

        <div class="queue-filters">
          <el-select v-model="filter.type" placeholder="类型" clearable size="small" style="width:88px" @change="loadOrders()">
            <el-option label="上分" value="UP" /><el-option label="下分" value="DOWN" />
          </el-select>
          <el-select v-model="filter.status" placeholder="状态" clearable size="small" style="width:96px" @change="loadOrders()">
            <el-option label="待审核" value="PENDING" />
            <el-option label="已通过" value="APPROVED" />
            <el-option label="已拒绝" value="REJECTED" />
          </el-select>
          <el-button size="small" text type="primary" @click="loadOrders()">刷新</el-button>
        </div>

        <div class="queue-list" v-loading="ordersLoading">
          <button
            v-for="row in list"
            :key="row.id"
            type="button"
            class="qrow"
            @click="onOrderRowClick(row)"
          >
            <div class="qrow-top">
              <b>{{ row.player.nickname }}</b>
              <el-tag size="small" :type="row.type === 'UP' ? 'success' : 'warning'">
                {{ row.type === 'UP' ? '上分' : '下分' }}
              </el-tag>
            </div>
            <div class="qrow-mid">
              <span class="gold">{{ row.amount.toLocaleString() }}</span>
              <el-tag size="small" :type="statusType(row.status)" effect="plain">
                {{ statusText(row.status) }}
              </el-tag>
            </div>
            <div class="qrow-bot">
              <span>{{ row.channel }} · {{ fmtClock(row.createdAt) }}</span>
              <span v-if="row.status === 'PENDING'" class="qops" @click.stop>
                <a @click="approve(row)">通过</a>
                <a class="danger" @click="openReject(row)">拒绝</a>
              </span>
            </div>
          </button>
          <div v-if="!ordersLoading && !list.length" class="clist-empty">暂无申请</div>
        </div>

        <el-pagination
          class="queue-pager"
          small
          :total="total"
          :page-size="filter.pageSize"
          :current-page="filter.page"
          layout="prev,pager,next"
          @current-change="(p: number) => { filter.page = p; loadOrders() }"
        />
      </aside>
    </div>

    <!-- 拒绝改用 MessageBox，与通过同一套确认布局 -->

    <el-dialog v-model="teaVisible" title="发早茶通知" width="420px" @closed="onTeaClosed">
      <div v-if="teaTarget" class="tea-meta">
        <div><b>{{ teaTarget.nickname }}</b> · {{ teaTarget.uid }}</div>
        <div class="dim">
          昨日流水 <span class="gold">{{ fmtNum(teaTarget.validFlow) }}</span>
          · {{ teaTarget.betCount }} 注
        </div>
      </div>
      <div class="tea-field col">
        <div class="tea-amount-row">
          <label>金额</label>
          <el-input-number v-model="teaAmount" :min="1" :max="200000" :controls="false" />
        </div>
        <div class="tea-quick">
          <button
            v-for="n in TEA_QUICK_AMOUNTS"
            :key="n"
            type="button"
            class="tea-quick-btn"
            :class="{ on: teaAmount === n }"
            @click="teaAmount = n"
          >{{ n }}</button>
        </div>
      </div>
      <div class="tea-field col">
        <label>消息</label>
        <el-input v-model="teaText" type="textarea" :rows="3" maxlength="500" show-word-limit />
      </div>
      <template #footer>
        <el-button @click="teaVisible = false">取消</el-button>
        <el-button type="primary" :loading="teaSending" :disabled="!teaText.trim()" @click="sendTea">
          发送
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="wageVisible"
      title="佣金记录"
      width="860px"
      destroy-on-close
      class="cs-wage-dialog"
      @opened="loadWageList"
    >
      <div v-if="csPendingWage > 0" class="wage-pending-tip">
        未结佣金合计 <b>{{ fmtNum(csPendingWage) }}</b>（{{ csPendingWageCount }} 笔），待代理结清后入账
      </div>
      <el-table v-loading="wageLoading" :data="wageList" size="small" max-height="420" stripe>
        <el-table-column label="时间" width="140">
          <template #default="{ row }">{{ fmtShort(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="88" align="center">
          <template #default="{ row }">{{ row.kind === 'DOWN' ? '下分' : '上分' }}</template>
        </el-table-column>
        <el-table-column label="玩家" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.playerNickname || row.playerUid || '—' }}
          </template>
        </el-table-column>
        <el-table-column label="本金" width="100" align="right">
          <template #default="{ row }">{{ fmtNum(row.fundAmount) }}</template>
        </el-table-column>
        <el-table-column label="佣金" width="100" align="right">
          <template #default="{ row }">
            <span :class="row.status === 'PENDING' ? 'wage-amt-pending' : 'gold'">
              {{ row.status === 'SETTLED' ? '+' : '' }}{{ fmtNum(row.wageAmount) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="结清" width="88" align="center">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.status === 'SETTLED' ? 'success' : 'warning'"
              effect="plain"
            >{{ row.status === 'SETTLED' ? '已结' : '未结' }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!wageLoading && !wageList.length" class="wage-empty">暂无佣金记录</div>
      <div v-if="wageList.length < wageTotal" class="wage-more">
        <el-button size="small" :loading="wageLoading" @click="loadWageMore">加载更多</el-button>
      </div>
      <template #footer>
        <el-button @click="wageVisible = false">关闭</el-button>
        <el-button type="primary" :loading="wageLoading" @click="loadWageList">刷新</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="csSettingsVisible" title="客服设置" width="640px" destroy-on-close>
      <div class="set-sec">
        <div class="set-label">快捷话术（点击可直接发送）</div>
        <div v-for="(_, i) in csSettingsDraft.quickReplies" :key="i" class="set-row">
          <el-input v-model="csSettingsDraft.quickReplies[i]" maxlength="80" placeholder="输入话术" />
          <el-button text type="danger" @click="csSettingsDraft.quickReplies.splice(i, 1)">删</el-button>
        </div>
        <el-button
          size="small"
          :disabled="csSettingsDraft.quickReplies.length >= 8"
          @click="csSettingsDraft.quickReplies.push('')"
        >
          添加话术
        </el-button>
      </div>
      <div class="set-sec">
        <div class="set-label">收款码（可添加多张，一键发给玩家）</div>
        <div class="set-qr-cols">
          <div class="set-qr-col">
            <div class="set-qr-head">
              <span>微信</span>
              <el-button
                size="small"
                :loading="qrUploading === 'wechat'"
                :disabled="csSettingsDraft.wechatQrs.length >= 8"
                @click="pickPayQr('wechat')"
              >
                添加
              </el-button>
            </div>
            <div v-if="!csSettingsDraft.wechatQrs.length" class="set-qr-empty">暂无，点添加上传</div>
            <div
              v-for="(q, i) in csSettingsDraft.wechatQrs"
              :key="q.id"
              class="set-qr-item"
            >
              <PrivateMediaImage :src="q.url" alt="微信收款码" />
              <el-input v-model="q.name" size="small" maxlength="20" placeholder="备注，如：码1" />
              <el-button text type="danger" size="small" @click="csSettingsDraft.wechatQrs.splice(i, 1)">
                删除
              </el-button>
            </div>
          </div>
          <div class="set-qr-col">
            <div class="set-qr-head">
              <span>支付宝</span>
              <el-button
                size="small"
                :loading="qrUploading === 'alipay'"
                :disabled="csSettingsDraft.alipayQrs.length >= 8"
                @click="pickPayQr('alipay')"
              >
                添加
              </el-button>
            </div>
            <div v-if="!csSettingsDraft.alipayQrs.length" class="set-qr-empty">暂无，点添加上传</div>
            <div
              v-for="(q, i) in csSettingsDraft.alipayQrs"
              :key="q.id"
              class="set-qr-item"
            >
              <PrivateMediaImage :src="q.url" alt="支付宝收款码" />
              <el-input v-model="q.name" size="small" maxlength="20" placeholder="备注，如：码1" />
              <el-button text type="danger" size="small" @click="csSettingsDraft.alipayQrs.splice(i, 1)">
                删除
              </el-button>
            </div>
          </div>
        </div>
        <input
          ref="qrFileEl"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          class="hidden-file"
          @change="onPayQrFile"
        />
      </div>
      <template #footer>
        <el-button @click="csSettingsVisible = false">取消</el-button>
        <el-button type="primary" :loading="csSettingsSaving" @click="saveCsSettings">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  reactive,
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  nextTick,
  watch,
} from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  reviewApi,
  csConsoleApi,
  type ReviewOrder,
  type CsSession,
  type CsConsoleMessage,
} from '@/api/admin'
import { consoleApi, type CsWageBillRow, type PlayerFlowRow } from '@/api/console'
import { useAdminStore } from '@/stores/admin'
import { PLAYER_DOWN_MIN, PLAYER_FUND_MAX, PLAYER_UP_MIN } from '@gamebox/shared'
import { newFundOrderNo } from '@/utils/fundOrderNo'
import PrivateMediaImage from '@/components/PrivateMediaImage.vue'

const store = useAdminStore()
const isCs = computed(() => store.profile?.role === 'CS')
/** 客服 / 代理：快捷话术、收款码设置 */
const canDeskTools = computed(() => {
  const r = store.profile?.role
  return r === 'CS' || r === 'AGENT'
})
const csIdle = ref(false)
const csStatusBusy = ref(false)
const csBalance = ref<number | null>(null)
const csBalanceText = computed(() =>
  csBalance.value == null
    ? '—'
    : csBalance.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
)

const wageVisible = ref(false)
const wageLoading = ref(false)
const wageList = ref<CsWageBillRow[]>([])
const wagePage = ref(1)
const wageTotal = ref(0)
const csPendingWage = ref(0)
const csPendingWageCount = ref(0)

const csFundMode = ref<'up' | 'down'>('up')
const csFundAmount = ref(PLAYER_UP_MIN)
const csFundBusy = ref(false)
const csRechargeEl = ref<HTMLElement>()
const csOrdersLoading = ref(false)
const csPlayerOrders = ref<ReviewOrder[]>([])

type PayQrItem = { id: string; url: string; name: string }

type CsDeskSettings = {
  quickReplies: string[]
  wechatQrs: PayQrItem[]
  alipayQrs: PayQrItem[]
}

const DEFAULT_QUICK = [
  '请提供付款截图',
  '已为您上分，请查收',
  '请稍等，正在为您处理',
]

const MAX_PAY_QR = 8

function emptyCsSettings(): CsDeskSettings {
  return { quickReplies: [...DEFAULT_QUICK], wechatQrs: [], alipayQrs: [] }
}

function newPayQrId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizePayQrs(raw: unknown, legacyUrl?: string): PayQrItem[] {
  const list: PayQrItem[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const url = String((item as PayQrItem).url || '').trim()
      if (!url) continue
      list.push({
        id: String((item as PayQrItem).id || newPayQrId()),
        url,
        name: String((item as PayQrItem).name || '').trim(),
      })
    }
  }
  if (!list.length && legacyUrl) {
    list.push({ id: newPayQrId(), url: String(legacyUrl), name: '' })
  }
  return list.slice(0, MAX_PAY_QR)
}

function csSettingsKey() {
  return `cs_desk_settings_${store.profile?.id || 'anon'}`
}

function cacheCsSettingsLocal(next: CsDeskSettings) {
  localStorage.setItem(csSettingsKey(), JSON.stringify(next))
}

function loadCsSettingsLocal(): CsDeskSettings {
  try {
    const raw = localStorage.getItem(csSettingsKey())
    if (!raw) return emptyCsSettings()
    const parsed = JSON.parse(raw) as Partial<CsDeskSettings> & {
      wechatQrUrl?: string
      alipayQrUrl?: string
    }
    return {
      quickReplies: Array.isArray(parsed.quickReplies) && parsed.quickReplies.length
        ? parsed.quickReplies.map(String).filter(Boolean).slice(0, 8)
        : [...DEFAULT_QUICK],
      wechatQrs: normalizePayQrs(parsed.wechatQrs, parsed.wechatQrUrl),
      alipayQrs: normalizePayQrs(parsed.alipayQrs, parsed.alipayQrUrl),
    }
  } catch {
    return emptyCsSettings()
  }
}

function hasLocalPayData(s: CsDeskSettings) {
  return (
    s.wechatQrs.length > 0 ||
    s.alipayQrs.length > 0 ||
    (s.quickReplies.length > 0 && JSON.stringify(s.quickReplies) !== JSON.stringify(DEFAULT_QUICK))
  )
}

function fromServerDesk(remote: {
  quickReplies: string[]
  wechatQrs: Array<{ id: string; url: string; name?: string }>
  alipayQrs: Array<{ id: string; url: string; name?: string }>
}): CsDeskSettings {
  return {
    quickReplies:
      Array.isArray(remote.quickReplies) && remote.quickReplies.length
        ? remote.quickReplies.map(String).filter(Boolean).slice(0, 8)
        : [...DEFAULT_QUICK],
    wechatQrs: normalizePayQrs(remote.wechatQrs),
    alipayQrs: normalizePayQrs(remote.alipayQrs),
  }
}

/** 服务端权威；本地仅缓存，空服务端时一次性迁上本地旧数据 */
async function fetchCsSettingsRemote(): Promise<CsDeskSettings> {
  const remote = await csConsoleApi.deskSettings()
  const server = fromServerDesk(remote)
  const local = loadCsSettingsLocal()
  const serverEmpty = !server.wechatQrs.length && !server.alipayQrs.length
  if (serverEmpty && hasLocalPayData(local)) {
    const migrated = await csConsoleApi.saveDeskSettings(local)
    const next = fromServerDesk(migrated)
    cacheCsSettingsLocal(next)
    return next
  }
  cacheCsSettingsLocal(server)
  return server
}

const csSettings = ref<CsDeskSettings>(loadCsSettingsLocal())
const csSettingsVisible = ref(false)
const csSettingsDraft = ref<CsDeskSettings>(loadCsSettingsLocal())
const csSettingsSaving = ref(false)
const qrUploading = ref<'wechat' | 'alipay' | ''>('')
const qrFileEl = ref<HTMLInputElement>()
const qrUploadKind = ref<'wechat' | 'alipay'>('wechat')

function payChannelLabel(channel?: string | null) {
  const c = String(channel || '').trim().toLowerCase()
  if (!c || c === 'cs' || c === '人工' || c === 'default') return ''
  if (c === 'wechat' || c === 'wx' || c === '微信') return '微信'
  if (c === 'alipay' || c === '支付宝') return '支付宝'
  if (c === 'unionpay' || c === '银联') return '银联'
  return String(channel)
}

function msgImage(text: string) {
  const m = String(text || '').match(/\[img\](\S+)/i)
  const url = String(m?.[1] || '').trim()
  return /^\/api\/cs\/media\/[A-Za-z0-9_-]{10,64}$/.test(url) ? url : ''
}

function msgCaption(text: string) {
  const raw = String(text || '')
  const cleaned = raw.replace(/\[img\]\S+/gi, '').trim()
  return cleaned
}

function sessionPreviewText(text: string) {
  if (msgImage(text)) return msgCaption(text) || '【收款码】'
  return text
}

function cloneCsSettings(src: CsDeskSettings): CsDeskSettings {
  return {
    quickReplies: [...src.quickReplies],
    wechatQrs: src.wechatQrs.map((q) => ({ ...q })),
    alipayQrs: src.alipayQrs.map((q) => ({ ...q })),
  }
}

async function openCsSettings() {
  try {
    csSettings.value = await fetchCsSettingsRemote()
  } catch {
    /* 离线用本地缓存 */
  }
  csSettingsDraft.value = cloneCsSettings(csSettings.value)
  csSettingsVisible.value = true
}

async function saveCsSettings() {
  const next: CsDeskSettings = {
    quickReplies: csSettingsDraft.value.quickReplies.map((s) => s.trim()).filter(Boolean).slice(0, 8),
    wechatQrs: csSettingsDraft.value.wechatQrs
      .map((q) => ({ id: q.id, url: q.url, name: q.name.trim() }))
      .filter((q) => q.url)
      .slice(0, MAX_PAY_QR),
    alipayQrs: csSettingsDraft.value.alipayQrs
      .map((q) => ({ id: q.id, url: q.url, name: q.name.trim() }))
      .filter((q) => q.url)
      .slice(0, MAX_PAY_QR),
  }
  if (!next.quickReplies.length) next.quickReplies = [...DEFAULT_QUICK]
  csSettingsSaving.value = true
  try {
    const saved = fromServerDesk(await csConsoleApi.saveDeskSettings(next))
    csSettings.value = saved
    cacheCsSettingsLocal(saved)
    csSettingsVisible.value = false
    ElMessage.success('设置已保存（手机/电脑同步）')
  } catch (e: unknown) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    csSettingsSaving.value = false
  }
}

function pickPayQr(kind: 'wechat' | 'alipay') {
  const list = kind === 'wechat' ? csSettingsDraft.value.wechatQrs : csSettingsDraft.value.alipayQrs
  if (list.length >= MAX_PAY_QR) {
    ElMessage.warning(`最多添加 ${MAX_PAY_QR} 张`)
    return
  }
  qrUploadKind.value = kind
  qrFileEl.value?.click()
}

async function onPayQrFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (!files.length) return

  const kind = qrUploadKind.value
  const list = kind === 'wechat' ? csSettingsDraft.value.wechatQrs : csSettingsDraft.value.alipayQrs
  const room = MAX_PAY_QR - list.length
  if (room <= 0) {
    ElMessage.warning(`最多添加 ${MAX_PAY_QR} 张`)
    return
  }
  const picked = files.slice(0, room)
  qrUploading.value = kind
  try {
    for (const file of picked) {
      if (file.size > 8_000_000) {
        ElMessage.error(`${file.name} 超过 8MB，已跳过`)
        continue
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('读取失败'))
        reader.readAsDataURL(file)
      })
      const res = await csConsoleApi.uploadPayQr(kind, dataUrl)
      list.push({
        id: newPayQrId(),
        url: res.url,
        name: '',
      })
    }
    ElMessage.success('上传成功，请点保存')
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '上传失败')
  } finally {
    qrUploading.value = ''
  }
}

async function sendQuickText(text: string) {
  const t = text.trim()
  const request = selectionRequest()
  if (!t || !request || replyLoading.value) return
  replyLoading.value = true
  try {
    const res = await csConsoleApi.reply(request.playerId, t)
    if (!isCurrentSelection(request)) return
    if (res.message) messages.value.push(res.message)
    scrollBubbles()
    void loadSessions(true)
  } catch (e: unknown) {
    if (isCurrentSelection(request)) ElMessage.error((e as Error).message)
  } finally {
    if (isCurrentSelection(request)) replyLoading.value = false
  }
}

/** 发收款码后的固定提示（每次务必向客服索取最新码） */
const PAY_QR_FOLLOW_UP =
  '温馨提示：每次上下分请先联系客服获取最新收款码后再付款。未按指引转账或认错收款码造成的损失，需自行承担。'

async function appendPayQrFollowUp(request: SelectionRequest) {
  const res = await csConsoleApi.reply(request.playerId, PAY_QR_FOLLOW_UP)
  if (isCurrentSelection(request) && res.message) messages.value.push(res.message)
}

async function sendPayQrById(kind: 'wechat' | 'alipay', id: string) {
  const list = kind === 'wechat' ? csSettings.value.wechatQrs : csSettings.value.alipayQrs
  const item = list.find((q) => q.id === id)
  if (!item?.url) {
    ElMessage.warning('请先在设置里上传收款码')
    openCsSettings()
    return
  }
  const request = selectionRequest()
  if (!request || replyLoading.value) return
  const caption =
    kind === 'wechat'
      ? `请使用微信扫码支付${item.name ? `（${item.name}）` : ''}`
      : `请使用支付宝扫码支付${item.name ? `（${item.name}）` : ''}`
  replyLoading.value = true
  try {
    const res = await csConsoleApi.reply(request.playerId, `${caption}\n[img]${item.url}`)
    if (!isCurrentSelection(request)) return
    if (res.message) messages.value.push(res.message)
    await appendPayQrFollowUp(request)
    if (!isCurrentSelection(request)) return
    scrollBubbles()
    void loadSessions(true)
    ElMessage.success('已发送收款码')
  } catch (e: unknown) {
    if (isCurrentSelection(request)) ElMessage.error((e as Error).message)
  } finally {
    if (isCurrentSelection(request)) replyLoading.value = false
  }
}

function onPayQrCommand(kind: 'wechat' | 'alipay', cmd: string) {
  if (cmd === '__all__') void sendAllPayQr(kind)
  else void sendPayQrById(kind, cmd)
}

async function sendAllPayQr(kind: 'wechat' | 'alipay') {
  const list = kind === 'wechat' ? csSettings.value.wechatQrs : csSettings.value.alipayQrs
  if (!list.length) {
    ElMessage.warning('请先在设置里上传收款码')
    openCsSettings()
    return
  }
  const request = selectionRequest()
  if (!request || replyLoading.value) return
  replyLoading.value = true
  let ok = 0
  try {
    for (let i = 0; i < list.length; i++) {
      const item = list[i]
      if (!item?.url) continue
      const caption =
        kind === 'wechat'
          ? `请使用微信扫码支付（${item.name || `码${i + 1}`}）`
          : `请使用支付宝扫码支付（${item.name || `码${i + 1}`}）`
      const res = await csConsoleApi.reply(request.playerId, `${caption}\n[img]${item.url}`)
      if (!isCurrentSelection(request)) return
      if (res.message) messages.value.push(res.message)
      ok += 1
    }
    if (ok > 0) await appendPayQrFollowUp(request)
    if (!isCurrentSelection(request)) return
    scrollBubbles()
    void loadSessions(true)
    ElMessage.success(`已发送 ${ok} 张收款码`)
  } catch (e: unknown) {
    if (isCurrentSelection(request)) {
      ElMessage.error((e as Error).message || `已发送 ${ok} 张，后续失败`)
    }
  } finally {
    if (isCurrentSelection(request)) replyLoading.value = false
  }
}

const csFundHint = computed(() => {
  if (!selectedPlayerId.value) return '请先选择玩家'
  const amt = Number(csFundAmount.value) || 0
  if (csFundMode.value === 'up') {
    if (amt < PLAYER_UP_MIN) return `充值最低 ${PLAYER_UP_MIN}`
    if (amt > PLAYER_FUND_MAX) return `单笔不超过 ${PLAYER_FUND_MAX}`
    if (csBalance.value != null && amt > csBalance.value + 1e-9) {
      return `额度不足（可用 ${csBalanceText.value}）`
    }
  } else {
    if (amt < PLAYER_DOWN_MIN) return `下分最低 ${PLAYER_DOWN_MIN}`
    if (amt > PLAYER_FUND_MAX) return `单笔不超过 ${PLAYER_FUND_MAX}`
  }
  return ''
})

const csFundOk = computed(() => {
  if (!selectedPlayerId.value) return false
  return !csFundHint.value
})

async function loadCsPlayerOrders(silent = false, fromPoll = false) {
  const request = selectionRequest()
  if (!isCs.value || !request) {
    invalidateLane(csOrdersLane)
    csPlayerOrders.value = []
    csOrdersLoading.value = false
    return
  }
  if (skipBackgroundOverlap(csOrdersLane, fromPoll)) return
  const sequence = beginRequest(csOrdersLane)
  if (!silent) csOrdersLoading.value = true
  try {
    const res = await reviewApi.list({
      playerId: request.playerId,
      status: 'PENDING',
      page: 1,
      pageSize: 20,
    })
    if (!isCurrentSelection(request) || !isLatestRequest(csOrdersLane, sequence)) return
    const prev = csPlayerOrders.value.map((o) => `${o.id}:${o.amount}:${o.status}`).join('|')
    csPlayerOrders.value = res.list || []
    const next = csPlayerOrders.value.map((o) => `${o.id}:${o.amount}:${o.status}`).join('|')
    if (prev !== next) syncFundFromPendingOrders()
  } catch {
    if (isCurrentSelection(request) && isLatestRequest(csOrdersLane, sequence)) {
      csPlayerOrders.value = []
    }
  } finally {
    finishRequest(csOrdersLane)
    if (isCurrentSelection(request) && isLatestRequest(csOrdersLane, sequence)) {
      csOrdersLoading.value = false
    }
  }
}

function fillFundFromOrder(row: ReviewOrder) {
  const nextMode = row.type === 'UP' ? 'up' : 'down'
  const amt = Number(row.amount) || (nextMode === 'up' ? PLAYER_UP_MIN : PLAYER_DOWN_MIN)
  if (csFundMode.value === nextMode) {
    csFundAmount.value = amt
  } else {
    pendingFundAmount.value = amt
    csFundMode.value = nextMode
  }
}

/** 有待审单时，充值/下分默认带上最新一笔申请金额与方向 */
function syncFundFromPendingOrders() {
  const first = csPlayerOrders.value.find((o) => o.status === 'PENDING')
  if (!first) return
  fillFundFromOrder(first)
}

const pendingFundAmount = ref<number | null>(null)

watch(csFundMode, (mode) => {
  if (pendingFundAmount.value != null) {
    csFundAmount.value = pendingFundAmount.value
    pendingFundAmount.value = null
    return
  }
  const pending = csPlayerOrders.value.find(
    (o) => o.status === 'PENDING' && (mode === 'up' ? o.type === 'UP' : o.type === 'DOWN'),
  )
  csFundAmount.value = pending
    ? Number(pending.amount)
    : mode === 'up'
      ? PLAYER_UP_MIN
      : PLAYER_DOWN_MIN
})

async function submitCsFund() {
  const request = selectionRequest()
  if (!request || !csFundOk.value) return
  const amt = Number(csFundAmount.value)
  const dir = csFundMode.value === 'up' ? '充值' : '下分'
  try {
    await ElMessageBox.confirm(
      `确认给 ${selectedDisplay.value?.nickname || '该玩家'} ${dir} ${amt.toLocaleString()}？`,
      `${dir}确认`,
      { type: 'warning', confirmButtonText: `确认${dir}`, cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  if (!isCurrentSelection(request)) return
  csFundBusy.value = true
  try {
    const detail = await consoleApi.playerDetail(request.playerId)
    if (!isCurrentSelection(request)) return
    const roomId = String(detail.roomId || detail.room?.id || '').trim()
    if (!roomId) {
      ElMessage.error('无法确定玩家房间，请稍后重试')
      return
    }
    const rid = newFundOrderNo(csFundMode.value === 'up' ? 'up' : 'down')
    if (csFundMode.value === 'up') {
      const res = await consoleApi.creditPlayer(request.playerId, amt, roomId, undefined, rid)
      if (!isCurrentSelection(request)) return
      ElMessage.success(`充值成功 · 订单 ${res?.orderNo || rid}`)
    } else {
      const res = await consoleApi.debitPlayer(request.playerId, amt, roomId, undefined, rid)
      if (!isCurrentSelection(request)) return
      ElMessage.success(`下分成功 · 订单 ${res?.orderNo || rid}`)
    }
    await Promise.all([refreshCsMe(), loadCsPlayerOrders()])
  } catch (e: unknown) {
    if (isCurrentSelection(request)) ElMessage.error((e as Error).message || '操作失败')
  } finally {
    if (isCurrentSelection(request)) csFundBusy.value = false
  }
}

function applyCsMe(me: {
  workStatus?: string
  balance?: number
  pendingWage?: number
  pendingWageCount?: number
}) {
  csIdle.value = me.workStatus === 'IDLE'
  csBalance.value = me.balance ?? null
  csPendingWage.value = Number(me.pendingWage || 0)
  csPendingWageCount.value = Number(me.pendingWageCount || 0)
}

async function refreshCsMe() {
  if (!isCs.value) return
  const sequence = beginRequest(csMeLane)
  try {
    const me = await consoleApi.csStaffMe()
    if (isLatestRequest(csMeLane, sequence)) applyCsMe(me)
  } catch {
    /* ignore */
  } finally {
    finishRequest(csMeLane)
  }
}

function openWageDialog() {
  wageVisible.value = true
}

async function loadWageList() {
  if (!isCs.value || !store.profile?.id) return
  wageLoading.value = true
  try {
    await refreshCsMe()
    const res = await consoleApi.csWageBills({
      page: 1,
      pageSize: 30,
      status: 'ALL',
    })
    wagePage.value = 1
    wageTotal.value = res.total
    wageList.value = res.list || []
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载佣金记录失败')
  } finally {
    wageLoading.value = false
  }
}

async function loadWageMore() {
  if (!isCs.value || !store.profile?.id || wageLoading.value) return
  wageLoading.value = true
  try {
    const next = wagePage.value + 1
    const res = await consoleApi.csWageBills({
      page: next,
      pageSize: 30,
      status: 'ALL',
    })
    wagePage.value = next
    wageTotal.value = res.total
    wageList.value = [...wageList.value, ...(res.list || [])]
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '加载失败')
  } finally {
    wageLoading.value = false
  }
}

async function onCsStatusChange(val: string | number | boolean) {
  if (!isCs.value || !store.profile?.id) return
  invalidateLane(csMeLane)
  csStatusBusy.value = true
  try {
    const workStatus = val ? 'IDLE' : 'REST'
    applyCsMe(await consoleApi.csStaffPatch(store.profile.id, { workStatus }))
    ElMessage.success(workStatus === 'IDLE' ? '已开始接单' : '已设为休息')
  } catch (e: unknown) {
    csIdle.value = !val
    ElMessage.error((e as Error).message || '切换失败')
  } finally {
    csStatusBusy.value = false
  }
}

const leftTab = ref<'sessions' | 'flow'>('sessions')

const sessions = ref<CsSession[]>([])
const sessionsLoading = ref(false)
const selectedPlayerId = ref('')
const selectedMeta = ref<{ uid: string; nickname: string } | null>(null)
const messages = ref<CsConsoleMessage[]>([])
const messagesLoading = ref(false)
const draft = ref('')
const replyLoading = ref(false)
const bubblesEl = ref<HTMLElement>()
const composerEl = ref<HTMLTextAreaElement>()

const flowList = ref<PlayerFlowRow[]>([])
const flowLoading = ref(false)
const flowByPlayer = ref<Record<string, number>>({})
const selectedYesterdayFlow = ref<number | null>(null)
let flowLoadedAt = 0

const list = ref<ReviewOrder[]>([])
const total = ref(0)
const ordersLoading = ref(false)
const opLoading = ref(false)
const orderScope = ref<'all' | 'player'>('all')
const pendingHint = ref<number | null>(null)

const TEA_QUICK_AMOUNTS = [68, 88, 128, 168, 288] as const

const teaVisible = ref(false)
const teaSending = ref(false)
const teaTarget = ref<PlayerFlowRow | null>(null)
const teaAmount = ref(288)
const teaText = ref('')

const filter = reactive({
  type: '',
  status: 'PENDING',
  page: 1,
  pageSize: 20,
})

const selectedSession = computed(() =>
  sessions.value.find((s) => s.playerId === selectedPlayerId.value),
)

const selectedDisplay = computed(() => {
  const s = selectedSession.value
  if (s) return { uid: s.uid, nickname: s.nickname }
  if (selectedMeta.value) return selectedMeta.value
  const f = flowList.value.find((x) => x.playerId === selectedPlayerId.value)
  if (f) return { uid: f.uid, nickname: f.nickname }
  return null
})

const unreadTotal = computed(() =>
  sessions.value.reduce((n, s) => n + (s.unread || 0), 0),
)

const avatarLetter = computed(() => {
  const name = selectedDisplay.value?.nickname || ''
  return name ? name.slice(0, 1) : '?'
})

let pollTimer: ReturnType<typeof setInterval> | undefined
let flowTimer: ReturnType<typeof setInterval> | undefined
let selectionGeneration = 0
let mounted = false
let deactivated = false

interface RequestLane {
  sequence: number
  inFlight: number
}

function requestLane(): RequestLane {
  return { sequence: 0, inFlight: 0 }
}

const sessionsLane = requestLane()
const flowLane = requestLane()
const selectedFlowLane = requestLane()
const messagesLane = requestLane()
const ordersLane = requestLane()
const csOrdersLane = requestLane()
const csMeLane = requestLane()

function beginRequest(lane: RequestLane): number {
  lane.inFlight += 1
  lane.sequence += 1
  return lane.sequence
}

function finishRequest(lane: RequestLane) {
  lane.inFlight = Math.max(0, lane.inFlight - 1)
}

function isLatestRequest(lane: RequestLane, sequence: number): boolean {
  return lane.sequence === sequence
}

function invalidateLane(lane: RequestLane) {
  lane.sequence += 1
}

function invalidateReadRequests() {
  for (const lane of [
    sessionsLane,
    flowLane,
    selectedFlowLane,
    messagesLane,
    ordersLane,
    csOrdersLane,
    csMeLane,
  ]) {
    invalidateLane(lane)
  }
  sessionsLoading.value = false
  flowLoading.value = false
  messagesLoading.value = false
  ordersLoading.value = false
  csOrdersLoading.value = false
}

function skipBackgroundOverlap(lane: RequestLane, fromPoll: boolean): boolean {
  return fromPoll && lane.inFlight > 0
}

interface SelectionRequest {
  playerId: string
  generation: number
}

function selectionRequest(): SelectionRequest | null {
  return selectedPlayerId.value
    ? { playerId: selectedPlayerId.value, generation: selectionGeneration }
    : null
}

function isCurrentSelection(request: SelectionRequest): boolean {
  return request.generation === selectionGeneration
    && selectedPlayerId.value === request.playerId
}

function previewSender(sender: string) {
  if (sender === 'PLAYER') return ''
  if (sender === 'AGENT') return '我：'
  if (sender === 'SYSTEM') return '[系统] '
  return ''
}
function bubbleSide(sender: string) {
  return sender === 'PLAYER' ? 'left' : 'right'
}
function fmtNum(n: number) {
  return Number(n || 0).toLocaleString('zh-CN')
}
function teaTemplate(amount: number) {
  return `您的早茶 ${amount}，请回复「上分${amount}」申请`
}

async function loadSessions(silent = false, fromPoll = false) {
  if (skipBackgroundOverlap(sessionsLane, fromPoll)) return
  const sequence = beginRequest(sessionsLane)
  if (!silent) sessionsLoading.value = true
  try {
    const res = await csConsoleApi.sessions()
    if (!isLatestRequest(sessionsLane, sequence)) return
    sessions.value = res.list || []
  } catch (e: unknown) {
    if (!silent && isLatestRequest(sessionsLane, sequence)) {
      const msg = e instanceof Error ? e.message : ''
      if (msg && msg !== 'AUTH_EXPIRED') ElMessage.error(msg)
    }
  } finally {
    finishRequest(sessionsLane)
    if (isLatestRequest(sessionsLane, sequence)) sessionsLoading.value = false
  }
}

async function loadFlowBoard(silent = false, fromPoll = false) {
  if (skipBackgroundOverlap(flowLane, fromPoll)) return
  const sequence = beginRequest(flowLane)
  if (!silent) flowLoading.value = true
  try {
    const res = await consoleApi.playerFlow({ range: 'yesterday', limit: 100 })
    if (!isLatestRequest(flowLane, sequence)) return
    flowList.value = res.list || []
    const map: Record<string, number> = {}
    for (const r of flowList.value) map[r.playerId] = r.validFlow
    flowByPlayer.value = map
    flowLoadedAt = Date.now()
    if (selectedPlayerId.value && selectedPlayerId.value in map) {
      selectedYesterdayFlow.value = map[selectedPlayerId.value]
    }
  } catch (e: unknown) {
    if (!silent && isLatestRequest(flowLane, sequence)) {
      const msg = e instanceof Error ? e.message : ''
      if (msg && msg !== 'AUTH_EXPIRED') ElMessage.error(msg)
    }
  } finally {
    finishRequest(flowLane)
    if (isLatestRequest(flowLane, sequence)) flowLoading.value = false
  }
}

async function refreshSelectedFlow() {
  const request = selectionRequest()
  if (!request) {
    invalidateLane(selectedFlowLane)
    selectedYesterdayFlow.value = null
    return
  }
  const sequence = beginRequest(selectedFlowLane)
  const cached = flowByPlayer.value[request.playerId]
  if (cached != null && Date.now() - flowLoadedAt < 60_000) {
    if (isCurrentSelection(request) && isLatestRequest(selectedFlowLane, sequence)) {
      selectedYesterdayFlow.value = cached
    }
    finishRequest(selectedFlowLane)
    return
  }
  try {
    const res = await consoleApi.playerFlow({
      range: 'yesterday',
      playerId: request.playerId,
    })
    if (
      !isCurrentSelection(request)
      || !isLatestRequest(selectedFlowLane, sequence)
    ) return
    const row = res.list?.[0]
    selectedYesterdayFlow.value = row ? row.validFlow : 0
    if (row) flowByPlayer.value[row.playerId] = row.validFlow
  } catch {
    if (isCurrentSelection(request) && isLatestRequest(selectedFlowLane, sequence)) {
      selectedYesterdayFlow.value = null
    }
  } finally {
    finishRequest(selectedFlowLane)
  }
}

async function loadMessages(
  silent = false,
  fixedRequest?: SelectionRequest,
  fromPoll = false,
) {
  const request = fixedRequest || selectionRequest()
  if (!request) {
    invalidateLane(messagesLane)
    messages.value = []
    messagesLoading.value = false
    return
  }
  if (!isCurrentSelection(request)) return
  if (skipBackgroundOverlap(messagesLane, fromPoll)) return
  const sequence = beginRequest(messagesLane)
  if (!silent) messagesLoading.value = true
  try {
    const res = await csConsoleApi.messages(request.playerId)
    if (!isCurrentSelection(request) || !isLatestRequest(messagesLane, sequence)) return
    const next = res.list || []
    const prevLast = messages.value[messages.value.length - 1]?.id
    const nextLast = next[next.length - 1]?.id
    messages.value = next
    if (!silent || prevLast !== nextLast) scrollBubbles()
  } catch (e: unknown) {
    if (
      !silent
      && isCurrentSelection(request)
      && isLatestRequest(messagesLane, sequence)
    ) {
      const msg = e instanceof Error ? e.message : ''
      if (msg && msg !== 'AUTH_EXPIRED') ElMessage.error(msg)
    }
  } finally {
    finishRequest(messagesLane)
    if (isCurrentSelection(request) && isLatestRequest(messagesLane, sequence)) {
      messagesLoading.value = false
    }
  }
}

async function loadOrders(silent = false, fromPoll = false) {
  if (skipBackgroundOverlap(ordersLane, fromPoll)) return
  const scopedRequest = orderScope.value === 'player' ? selectionRequest() : null
  const sequence = beginRequest(ordersLane)
  if (!silent) ordersLoading.value = true
  try {
    const playerId =
      orderScope.value === 'player' && scopedRequest
        ? scopedRequest.playerId
        : undefined
    const res = await reviewApi.list({
      ...filter,
      type: filter.type || undefined,
      status: filter.status || undefined,
      playerId,
    })
    if (
      !isLatestRequest(ordersLane, sequence)
      || (scopedRequest && !isCurrentSelection(scopedRequest))
    ) return
    list.value = res.list
    total.value = res.total
    if (!filter.status || filter.status === 'PENDING') {
      pendingHint.value = res.total
    }
  } catch (e: unknown) {
    if (
      !silent
      && isLatestRequest(ordersLane, sequence)
      && (!scopedRequest || isCurrentSelection(scopedRequest))
    ) {
      const msg = e instanceof Error ? e.message : ''
      if (msg && msg !== 'AUTH_EXPIRED') ElMessage.error(msg)
    }
  } finally {
    finishRequest(ordersLane)
    if (
      isLatestRequest(ordersLane, sequence)
      && (!scopedRequest || isCurrentSelection(scopedRequest))
    ) {
      ordersLoading.value = false
    }
  }
}

function scrollBubbles() {
  nextTick(() => {
    const el = bubblesEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function autoGrow() {
  const el = composerEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 96) + 'px'
}

function onComposerKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void sendReply()
  }
}

async function selectPlayer(playerId: string, meta?: { uid: string; nickname: string }) {
  selectionGeneration += 1
  invalidateLane(messagesLane)
  invalidateLane(selectedFlowLane)
  invalidateLane(csOrdersLane)
  invalidateLane(ordersLane)
  selectedPlayerId.value = playerId
  if (meta) selectedMeta.value = meta
  messages.value = []
  csPlayerOrders.value = []
  selectedYesterdayFlow.value = null
  messagesLoading.value = false
  csOrdersLoading.value = false
  replyLoading.value = false
  csFundBusy.value = false
  const request = selectionRequest()
  if (!request) return
  if (!isCs.value) {
    if (orderScope.value === 'player') filter.page = 1
    void loadOrders(orderScope.value !== 'player')
  }
  void refreshSelectedFlow()
  if (isCs.value) {
    void loadCsPlayerOrders()
  }
  await loadMessages(false, request)
  if (!isCurrentSelection(request) || !canPollNow()) return
  try {
    await csConsoleApi.read(request.playerId)
    if (!isCurrentSelection(request) || !canPollNow()) return
    const row = sessions.value.find((x) => x.playerId === playerId)
    if (row) row.unread = 0
  } catch {
    /* ignore */
  }
}

async function selectSession(s: CsSession) {
  await selectPlayer(s.playerId, { uid: s.uid, nickname: s.nickname })
}

/** 流水榜点人选人，留在流水 Tab 方便连发早茶 */
async function pickFlowPlayer(row: PlayerFlowRow) {
  await selectPlayer(row.playerId, { uid: row.uid, nickname: row.nickname })
}

function openTeaDialog(row: PlayerFlowRow) {
  teaTarget.value = row
  teaAmount.value = 288
  teaText.value = teaTemplate(288)
  teaVisible.value = true
}

function openTeaForSelected() {
  if (!selectedPlayerId.value) return
  const fromBoard = flowList.value.find((x) => x.playerId === selectedPlayerId.value)
  const row: PlayerFlowRow = fromBoard || {
    playerId: selectedPlayerId.value,
    uid: selectedDisplay.value?.uid || '',
    nickname: selectedDisplay.value?.nickname || '玩家',
    avatar: null,
    validFlow: selectedYesterdayFlow.value ?? 0,
    betCount: 0,
  }
  openTeaDialog(row)
}

function onTeaClosed() {
  teaTarget.value = null
}

watch(teaAmount, (n) => {
  if (!teaVisible.value) return
  const amount = Math.floor(Number(n) || 0)
  if (amount > 0) teaText.value = teaTemplate(amount)
})

async function sendTea() {
  if (!teaTarget.value || !teaText.value.trim() || teaSending.value) return
  teaSending.value = true
  try {
    const pid = teaTarget.value.playerId
    const meta = { uid: teaTarget.value.uid, nickname: teaTarget.value.nickname }
    const res = await csConsoleApi.reply(pid, teaText.value.trim())
    teaVisible.value = false
    await selectPlayer(pid, meta)
    if (res.message) {
      const exists = messages.value.some((m) => m.id === res.message.id)
      if (!exists) messages.value.push(res.message)
      scrollBubbles()
    }
    void loadSessions(true)
    ElMessage.success('已发送')
  } catch (e: unknown) {
    ElMessage.error((e as Error).message)
  } finally {
    teaSending.value = false
  }
}

function focusPlayerOrders() {
  if (!selectedPlayerId.value) return
  orderScope.value = 'player'
  filter.status = 'PENDING'
  filter.page = 1
  void loadOrders()
}

function onScopeChange() {
  filter.page = 1
  void loadOrders()
}

async function onOrderRowClick(row: ReviewOrder) {
  const pid = row.playerId
  if (!pid) {
    const hit = sessions.value.find((s) => s.uid === row.player.uid)
    if (hit) await selectSession(hit)
    return
  }
  leftTab.value = 'sessions'
  await selectPlayer(pid, { uid: row.player.uid, nickname: row.player.nickname })
}

async function sendReply() {
  const text = draft.value.trim()
  const request = selectionRequest()
  if (!text || !request || replyLoading.value) return
  replyLoading.value = true
  try {
    const res = await csConsoleApi.reply(request.playerId, text)
    if (!isCurrentSelection(request)) return
    if (res.message) messages.value.push(res.message)
    draft.value = ''
    nextTick(() => {
      if (composerEl.value) composerEl.value.style.height = 'auto'
    })
    scrollBubbles()
    void loadSessions(true)
  } catch (e: unknown) {
    if (isCurrentSelection(request)) ElMessage.error((e as Error).message)
  } finally {
    if (isCurrentSelection(request)) replyLoading.value = false
  }
}

async function approve(row: ReviewOrder) {
  if (opLoading.value) return
  const kind = row.type === 'UP' ? '上分' : '下分'
  try {
    await ElMessageBox.confirm(
      `确认通过该 ${kind} 订单？金额 ${row.amount.toLocaleString()}`,
      `${kind}确认`,
      {
        type: 'success',
        confirmButtonText: '确认通过',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--success',
      },
    )
  } catch {
    return
  }
  opLoading.value = true
  try {
    await reviewApi.approve(row.id)
    ElMessage.success('已通过')
    await Promise.all([
      isCs.value ? loadCsPlayerOrders() : loadOrders(),
      loadMessages(true),
      loadSessions(true),
      refreshCsMe(),
    ])
  } catch (e: unknown) {
    ElMessage.error((e as Error).message)
  } finally {
    opLoading.value = false
  }
}

async function openReject(row: ReviewOrder) {
  if (opLoading.value) return
  const kind = row.type === 'UP' ? '上分' : '下分'
  try {
    await ElMessageBox.confirm(
      `确认拒绝该 ${kind} 订单？金额 ${row.amount.toLocaleString()}`,
      `${kind}确认`,
      {
        type: 'error',
        confirmButtonText: '确认拒绝',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }
  opLoading.value = true
  try {
    await reviewApi.reject(row.id, '')
    ElMessage.success('已拒绝')
    await Promise.all([
      isCs.value ? loadCsPlayerOrders() : loadOrders(),
      loadMessages(true),
      loadSessions(true),
    ])
  } catch (e: unknown) {
    ElMessage.error((e as Error).message)
  } finally {
    opLoading.value = false
  }
}

function statusType(s: string) {
  return s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'danger' : 'warning'
}
function statusText(s: string) {
  return s === 'APPROVED' ? '已通过' : s === 'REJECTED' ? '已拒绝' : '待审'
}
function fmtShort(s: string) {
  const d = new Date(s)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtClock(s: string) {
  return fmtShort(s)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
  if (flowTimer) {
    clearInterval(flowTimer)
    flowTimer = undefined
  }
}

function poll() {
  if (!canPollNow()) {
    stopPolling()
    invalidateReadRequests()
    return
  }
  void loadSessions(true, true)
  if (!isCs.value) {
    void loadOrders(true, true)
  } else if (selectedPlayerId.value) {
    void loadCsPlayerOrders(true, true)
  }
  if (selectedPlayerId.value) void loadMessages(true, undefined, true)
}

function canPollNow() {
  return mounted && !deactivated && document.visibilityState !== 'hidden' && store.isLoggedIn
}

function refreshVisibleData() {
  void loadSessions(true)
  if (isCs.value) {
    void refreshCsMe()
    if (selectedPlayerId.value) void loadCsPlayerOrders(true)
  } else {
    void loadOrders(true)
    void loadFlowBoard(true)
  }
  if (selectedPlayerId.value) {
    void loadMessages(true)
    void refreshSelectedFlow()
  }
}

function syncPollingState() {
  if (!canPollNow()) {
    stopPolling()
    invalidateReadRequests()
    return
  }
  if (pollTimer) return
  refreshVisibleData()
  pollTimer = setInterval(poll, 4000)
  if (!isCs.value) {
    flowTimer = setInterval(() => {
      if (canPollNow()) void loadFlowBoard(true, true)
    }, 30_000)
  }
}

function onVisibilityChange() {
  syncPollingState()
}

watch(selectedPlayerId, (id) => {
  if (!id && orderScope.value === 'player') {
    orderScope.value = 'all'
    if (!isCs.value) void loadOrders()
  }
})

watch(leftTab, (tab) => {
  if (!isCs.value && tab === 'flow' && !flowList.value.length) void loadFlowBoard()
})

onMounted(() => {
  leftTab.value = isCs.value ? 'sessions' : 'flow'
  mounted = true
  document.addEventListener('visibilitychange', onVisibilityChange)
  syncPollingState()
  if (canDeskTools.value) {
    void fetchCsSettingsRemote()
      .then((settings) => {
        if (mounted && !deactivated) csSettings.value = settings
      })
      .catch(() => {
        if (mounted && !deactivated) csSettings.value = loadCsSettingsLocal()
      })
  }
})

onActivated(() => {
  deactivated = false
  if (mounted) syncPollingState()
})

onDeactivated(() => {
  deactivated = true
  syncPollingState()
})

onUnmounted(() => {
  mounted = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopPolling()
  invalidateReadRequests()
})
</script>

<style scoped>
.cs-desk {
  max-width: none;
  height: 100%;
  min-height: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cs-status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 12px;
  font-size: 13px;
  color: #475569;
  flex-shrink: 0;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}
.cs-settings-btn { margin-left: auto; }
.cs-status-bar.agent-tools {
  justify-content: flex-end;
  gap: 12px;
}
.cs-status-bar.agent-tools .cs-bal {
  margin-right: auto;
}
.cs-bal {
  margin-left: 8px;
  font-weight: 600;
  color: #0f172a;
}
.gold {
  color: #b45309;
  font-weight: 650;
}
.wage-amt-pending {
  color: #b45309;
  font-weight: 650;
  opacity: 0.72;
}
.wage-pending-tip {
  margin-bottom: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 13px;
}
.wage-pending-tip b {
  font-weight: 700;
}
.wage-empty {
  text-align: center;
  color: #94a3b8;
  padding: 24px 0 8px;
  font-size: 13px;
}
.wage-more {
  margin-top: 10px;
  text-align: center;
}

.shell {
  height: 100%;
  flex: 1;
  min-height: 0;
  display: grid;
  /* 左名单 · 中聊天 · 右审核 — 约 26 : 34 : 26，中间不再吃满剩余宽度 */
  grid-template-columns: minmax(280px, 26fr) minmax(380px, 34fr) minmax(300px, 26fr);
  gap: 12px;
  min-height: 0;
}
.shell.cs-only {
  grid-template-columns: minmax(220px, 24fr) minmax(560px, 76fr);
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border: 1px solid var(--ops-border, #e8eaef);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--ops-shadow, 0 1px 2px rgba(31, 35, 41, 0.04));
}

.contacts {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #f7f8fa;
}
.contacts-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 10px 8px 8px;
  border-bottom: 1px solid #e8eaef;
  background: #fff;
}
.ctab {
  border: 0;
  background: transparent;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: #8f959e;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ctab.on {
  background: #fffbeb;
  color: #1f2329;
  font-weight: 650;
}
.icon-btn {
  margin-left: auto;
  border: 0;
  background: transparent;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: #8f959e;
  cursor: pointer;
}
.icon-btn:hover { background: #f0f2f5; color: #1f2329; }

.clist {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.clist-empty {
  padding: 28px 16px;
  text-align: center;
  font-size: 12px;
  color: #c0c4cc;
}
.clist-empty.pad { padding: 40px 16px; }

.cs-player {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cs-player .name { font-weight: 650; }
.cs-player .uid {
  margin-top: 2px;
  font-size: 12px;
  color: #64748b;
}
.cs-mode {
  width: 100%;
  display: flex;
}
.cs-mode :deep(.el-radio-button) { flex: 1; }
.cs-mode :deep(.el-radio-button__inner) { width: 100%; }
.cs-amt-label {
  font-size: 13px;
  color: #606266;
}
.cs-amt { width: 100%; }
.cs-amt :deep(.el-input__inner) { text-align: left; }
.cs-preview {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
}
.cs-preview.warn {
  background: #fef0f0;
  color: #c45656;
}
.cs-submit { width: 100%; margin-top: 4px; }
.order-acts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}
.order-acts .act {
  height: 34px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  transition: background .15s, border-color .15s, transform .1s;
}
.order-acts .act:active {
  transform: scale(0.98);
}
.order-acts .act.ok {
  border: 1px solid #67c23a;
  background: #67c23a;
  color: #fff;
  box-shadow: 0 1px 2px rgba(103, 194, 58, 0.28);
}
.order-acts .act.ok:hover {
  background: #5daf34;
  border-color: #5daf34;
}
.order-acts .act.no {
  border: 1px solid #f56c6c;
  background: #fff;
  color: #f56c6c;
}
.order-acts .act.no:hover {
  background: #fef0f0;
  border-color: #f56c6c;
}
.quick-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid #eef0f3;
  background: #fafbfc;
  flex-shrink: 0;
}
.quick-bar .qchip {
  border: 1px solid #e8eaef;
  background: #fff;
  color: #606266;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.quick-bar .qchip:hover:not(:disabled) {
  border-color: #f59e0b;
  color: #b8902e;
}
.quick-bar .qchip:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.quick-bar .qchip.pay.wx {
  border-color: #95d475;
  color: #529b2e;
  background: #f0f9eb;
}
.quick-bar .qchip.pay.ali {
  border-color: #79bbff;
  color: #337ecc;
  background: #ecf5ff;
}
.msg-img {
  display: block;
  max-width: 180px;
  width: 100%;
  border-radius: 8px;
  margin: 4px 0 2px;
  background: #fff;
}
.hidden-file { display: none; }
.set-sec { margin-bottom: 18px; }
.set-label {
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
  margin-bottom: 10px;
}
.set-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.set-qr-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.set-qr-col {
  border: 1px solid #eef0f3;
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 120px;
}
.set-qr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 650;
}
.set-qr-item {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 6px;
  background: #f8f9fb;
  border-radius: 8px;
}
.set-qr-item img {
  width: 64px;
  height: 64px;
  object-fit: contain;
  border-radius: 6px;
  background: #fff;
}
.set-qr-empty {
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f6f8;
  border-radius: 8px;
  color: #c0c4cc;
  font-size: 12px;
  text-align: center;
  padding: 8px;
}
.side-block.player-card { padding: 14px 12px; }

.crow {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid #eef0f3;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.crow:hover { background: #eef0f3; }
.crow.on { background: #fff; box-shadow: inset 3px 0 0 #f59e0b; }
.av {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #e5e7eb;
  color: #606266;
  font-size: 14px;
  font-weight: 650;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.av.lg { width: 40px; height: 40px; border-radius: 12px; background: #f0e6c8; color: #b8902e; }
.rank {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: #e8eaef;
  color: #606266;
  font-size: 11px;
  font-weight: 650;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.crow-body { flex: 1; min-width: 0; }
.crow-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}
.crow-top b {
  font-weight: 600;
  color: #1f2329;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.crow-top em {
  font-style: normal;
  font-size: 11px;
  color: #c0c4cc;
  flex-shrink: 0;
}
.crow-top em.gold { color: #c9952a; font-weight: 650; }
.crow-preview {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: #8f959e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tea-hit {
  flex-shrink: 0;
  font-size: 11px;
  color: #b8902e;
  padding: 2px 6px;
  border-radius: 4px;
  background: #fffbeb;
  opacity: 0;
  transition: opacity .15s;
}
.crow.flow:hover .tea-hit,
.crow.flow.on .tea-hit { opacity: 1; }
.tea-hit:hover { background: #f7ebcc; }

.dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: #f56c6c;
  color: #fff;
  font-size: 10px;
  font-style: normal;
}
.dot.sm { min-width: 14px; height: 14px; margin-right: 4px; }

/* ── 聊天室 ── */
.room {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #fff;
}
.room.with-side {
  flex-direction: row;
  overflow: hidden;
}
.room-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.room-side {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid #eef0f3;
  background: #fafbfc;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  gap: 12px;
}
.side-block {
  background: #fff;
  border: 1px solid #eef0f3;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.side-block.grow { flex: 1; }
.side-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 650;
  color: #1f2329;
}
.side-refresh {
  border: 0;
  background: transparent;
  color: #f59e0b;
  font-size: 12px;
  cursor: pointer;
  font-weight: 500;
}
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.info-item {
  background: #f8f9fb;
  border-radius: 8px;
  padding: 8px 10px;
}
.info-item .k {
  display: block;
  font-size: 11px;
  color: #64748b;
  margin-bottom: 2px;
}
.info-item .v {
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
}
.info-item .v.gold { color: #f59e0b; }
.side-orders {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 260px;
  overflow: auto;
  min-height: 48px;
}
.side-empty {
  font-size: 12px;
  color: #c0c4cc;
  text-align: center;
  padding: 12px 0;
}
.side-order {
  padding: 12px;
  background: #f8f9fb;
  border: 1px solid #eef0f3;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.side-order:hover {
  background: #fff;
  border-color: #e5d4a3;
}
.side-order-top {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.side-order-top .amt {
  font-size: 16px;
  letter-spacing: 0.2px;
}
.side-order-time {
  margin-left: auto;
  font-size: 11px;
  color: #64748b;
}
.side-order-bot {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #64748b;
}
.room-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #eef0f3;
  flex-shrink: 0;
}
.room-meta { flex: 1; min-width: 0; }
.room-meta.alone { padding-left: 2px; }
.room-name { font-size: 15px; font-weight: 650; color: #1f2329; }
.room-sub { margin-top: 2px; font-size: 12px; color: #8f959e; }
.room-ops { display: flex; gap: 6px; }
.ghost-btn {
  border: 1px solid #e8eaef;
  background: #fff;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  color: #606266;
  cursor: pointer;
}
.ghost-btn:hover {
  border-color: #f59e0b;
  color: #b8902e;
}

.msgs {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px 20px;
  background: #f5f6f8;
}
.msgs-hint {
  height: 100%;
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c0c4cc;
  font-size: 13px;
}
.msg {
  display: flex;
  margin-bottom: 12px;
}
.msg.left { justify-content: flex-start; }
.msg.right { justify-content: flex-end; }
.msg.sys { justify-content: center; }
.msg-bubble {
  max-width: min(85%, 520px);
  padding: 9px 12px 6px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(31, 35, 41, 0.06);
}
.msg.left .msg-bubble { border-top-left-radius: 3px; }
.msg.right .msg-bubble {
  background: #fffbeb;
  border: 1px solid #f0e6c8;
  border-top-right-radius: 3px;
}
.msg.sys .msg-bubble {
  background: transparent;
  box-shadow: none;
  border: 0;
  padding: 4px 10px;
  max-width: 90%;
}
.msg.sys .msg-bubble p {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.05);
  color: #8f959e;
  font-size: 12px;
}
.msg.sys time { display: none; }
.msg-bubble p {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: #1f2329;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-bubble time {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  color: #c0c4cc;
  text-align: right;
}

.composer {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 10px 14px 12px;
  border-top: 1px solid #eef0f3;
  background: #fff;
  flex-shrink: 0;
}
.composer textarea {
  flex: 1;
  border: 1px solid #e8eaef;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  outline: none;
  min-height: 40px;
  max-height: 96px;
  line-height: 1.4;
  background: #f7f8fa;
}
.composer textarea:focus {
  border-color: #e8c878;
  background: #fff;
}
.composer textarea:disabled {
  color: #c0c4cc;
  cursor: not-allowed;
}
.send {
  height: 40px;
  min-width: 72px;
  border: 0;
  border-radius: 8px;
  background: #f59e0b;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
.send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.send:not(:disabled):hover { background: #b8902e; }

/* ── 审核侧栏 ── */
.queue {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.queue-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #eef0f3;
}
.queue-title {
  font-size: 14px;
  font-weight: 650;
  display: flex;
  align-items: center;
  gap: 6px;
}
.pill {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #fdf6ec;
  color: #e6a23c;
  font-size: 11px;
  font-weight: 650;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.queue-chip {
  margin: 8px 10px 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fffbeb;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #606266;
}
.queue-chip b { color: #c9952a; }
.queue-filters {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  align-items: center;
}
.queue-list {
  flex: 1;
  overflow: auto;
  min-height: 0;
  padding: 0 6px 6px;
}
.qrow {
  width: 100%;
  text-align: left;
  border: 1px solid #eef0f3;
  background: #fff;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 6px;
  cursor: pointer;
}
.qrow:hover { border-color: #e8c878; }
.qrow-top, .qrow-mid, .qrow-bot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.qrow-top b { font-size: 13px; }
.qrow-mid { margin-top: 6px; }
.qrow-bot {
  margin-top: 8px;
  font-size: 11px;
  color: #c0c4cc;
}
.qops { display: flex; gap: 10px; }
.qops a {
  color: #67c23a;
  cursor: pointer;
  font-size: 12px;
}
.qops a.danger { color: #f56c6c; }
.gold { color: #c9952a; font-weight: 650; }
.dim { font-size: 12px; color: #8f959e; margin-top: 4px; }
.queue-pager {
  padding: 8px;
  display: flex;
  justify-content: center;
  border-top: 1px solid #eef0f3;
}

.tea-meta { margin-bottom: 14px; }
.tea-field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.tea-field.col { align-items: flex-start; flex-direction: column; }
.tea-field label {
  width: 40px;
  font-size: 13px;
  color: #606266;
  flex-shrink: 0;
}
.tea-field.col label { width: auto; }
.tea-field .el-input-number { width: 160px; }
.tea-field.col .el-textarea { width: 100%; }
.tea-amount-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
}
.tea-amount-row label { width: 40px; margin: 0; }
.tea-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-left: 50px;
}
.tea-quick-btn {
  min-width: 52px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  background: #fff;
  color: #606266;
  font-size: 13px;
  cursor: pointer;
  transition: border-color .15s, color .15s, background .15s;
}
.tea-quick-btn:hover {
  border-color: #c9a227;
  color: #8a6d12;
}
.tea-quick-btn.on {
  border-color: #c9a227;
  background: #fbf6e8;
  color: #8a6d12;
  font-weight: 600;
}

@media (max-width: 1280px) {
  .shell {
    grid-template-columns: minmax(240px, 24fr) minmax(320px, 32fr) minmax(260px, 24fr);
  }
  .shell.cs-only {
    grid-template-columns: minmax(200px, 26fr) minmax(500px, 74fr);
  }
}
@media (max-width: 1024px) {
  .shell:not(.cs-only) {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: minmax(420px, 1fr) minmax(300px, 38%);
  }
  .shell:not(.cs-only) .room,
  .shell:not(.cs-only) .queue {
    grid-column: 1 / -1;
  }
  .shell.cs-only {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }
}
@media (max-width: 720px) {
  .cs-desk { height: auto; min-height: 0; }
  .shell {
    height: auto;
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }
  .contacts { max-height: 280px; }
  .room, .queue { min-height: 360px; }
  .room.with-side {
    flex-direction: column;
  }
  .room-side {
    width: 100%;
    max-height: 42vh;
    border-left: 0;
    border-top: 1px solid #eef0f3;
  }
}
</style>
