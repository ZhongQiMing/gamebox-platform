<template>
  <div v-loading="loading" class="room-detail">
    <!-- 副项：房间内各功能页（整页切换，不挤在小滚动区） -->
    <nav class="room-subnav" aria-label="房间副项">
      <div class="room-subnav-tabs">
        <button
          v-for="t in detailTabs"
          :key="t.key"
          type="button"
          class="room-tab-btn"
          :class="{
            active: tab === t.key,
            alert: t.key === 'join' && pendingJoinCount > 0,
          }"
          @click="setTab(t.key)"
        >
          {{ t.label }}
          <span v-if="t.key === 'join' && pendingJoinCount > 0" class="tab-badge">
            {{ pendingJoinCount > 99 ? '99+' : pendingJoinCount }}
          </span>
        </button>
      </div>
      <div class="room-subnav-meta">
        <div class="room-subnav-id">
          <b>{{ room?.name || '房间详情' }}</b>
          <span v-if="room">进房码 {{ room.roomNo }}</span>
        </div>
        <el-button size="small" @click="goBackFromDetail">
          {{ isAgent || isProxy ? '返回工作台' : '返回房间中心' }}
        </el-button>
        <el-button v-if="canGoSettleCenter" size="small" @click="goSettleCenter">去结算中心</el-button>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
    </nav>

    <div class="room-page" :class="{ 'is-fill': tab === 'players' }">
    <!-- 基础信息：房间资料 + 本房额度 -->
    <div v-show="tab === 'basic'" class="room-page-pane">
      <section v-if="room" class="basic-info">
        <div class="basic-info-hd">
          <div class="basic-info-title">
            <button
              v-if="canEditRoomIcon"
              type="button"
              class="room-icon-btn editable"
              title="修改房间图标"
              :disabled="iconBusy"
              @click="pickRoomIcon"
            >
              <img class="room-icon-preview" :src="roomIconUrl(room.icon)" alt="房间图标">
            </button>
            <img
              v-else
              class="room-icon-preview"
              :src="roomIconUrl(room.icon)"
              alt="房间图标"
            >
            <el-button
              v-if="canEditRoomIcon"
              size="small"
              :loading="iconBusy"
              @click="pickRoomIcon"
            >修改</el-button>
            <h2>{{ room.name }}</h2>
            <input
              ref="roomIconInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              @change="onRoomIconPicked"
            >
          </div>
          <el-tag size="small" :type="roomStatusTagType(room.status)">
            {{ roomStatusLabel(room.status) }}
          </el-tag>
          <el-dropdown
            v-if="canSetRoomStatus"
            trigger="click"
            @command="(s: string) => setRoomStatus(s)"
          >
            <el-button size="small" plain :loading="statusBusy">房间状态</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="OPEN" :disabled="room.status === 'OPEN'">营业中</el-dropdown-item>
                <el-dropdown-item command="MAINTENANCE" :disabled="room.status === 'MAINTENANCE'">维护中</el-dropdown-item>
                <el-dropdown-item command="FROZEN" :disabled="room.status === 'FROZEN'">已冻结</el-dropdown-item>
                <el-dropdown-item
                  v-if="store.profile?.role === 'ADMIN'"
                  command="CLOSED"
                  :disabled="room.status === 'CLOSED'"
                >已关闭</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div class="kv-grid basic-kv">
          <div class="kv">
            <div class="k">进房码</div>
            <div class="v mono">{{ room.roomNo }}</div>
          </div>
          <div class="kv">
            <div class="k">挂靠总代</div>
            <div class="v">
              <el-button
                v-if="room.general?.userId && (isAdmin || isBranch)"
                link
                type="primary"
                @click="goGeneralFromRoom"
              >{{ generalBrief }}</el-button>
              <span v-else>{{ generalBrief }}</span>
            </div>
          </div>
          <div class="kv">
            <div class="k">绑定代理</div>
            <div class="v">{{ agentBrief }}</div>
          </div>
          <div class="kv">
            <div class="k">盘口 / 占成</div>
            <div class="v">{{ bookBrief }}</div>
          </div>
          <div class="kv">
            <div class="k">结账日</div>
            <div class="v">{{ settleBrief }}</div>
          </div>
          <div class="kv">
            <div class="k">月费</div>
            <div class="v">{{ feeText }}</div>
            <div v-if="room.monthlyFee && room.monthlyFee > 0" class="kv-sub">
              下次月费 {{ formatDate(room.nextBillAt) }}
            </div>
          </div>
          <div v-if="room.bookMode === 'CREDIT'" class="kv">
            <!-- 外层 v-if 已限定信用盘，else 分支永远走不到，直接写死 -->
            <div class="k">合同额度</div>
            <div class="v">{{ fmt(room.creditLimit) }}</div>
          </div>
          <div class="kv">
            <div class="k">成员 / 对局</div>
            <div class="v">{{ room.memberCount ?? 0 }} / {{ room.roundCount ?? 0 }}</div>
          </div>
          <div class="kv">
            <div class="k">创建时间</div>
            <div class="v">{{ formatDt(room.createdAt) }}</div>
          </div>
        </div>

        <div v-if="room.ownerAgent?.user" class="basic-quota">
          <div class="basic-quota-hd">
            <span class="basic-quota-title">{{ room.bookMode === 'CREDIT' ? '本房信用账本' : '本房代理额度' }}</span>
            <div v-if="canFundMainAgent" class="basic-quota-actions">
              <el-button type="primary" size="small" @click="openAgentFund('up')">上分</el-button>
              <el-button type="warning" size="small" @click="openAgentFund('down')">下分</el-button>
            </div>
            <div v-else-if="room.general?.userId && (isAdmin || isBranch)" class="basic-quota-actions">
              <el-button type="primary" size="small" @click="goGeneralFromRoom">去总代账户</el-button>
            </div>
          </div>
          <div v-if="room.bookMode === 'CREDIT'" class="money-strip credit-grid">
            <div class="money-card">
              <div class="money-label">代理余额</div>
              <div class="money-val gold">{{ fmt(creditAgentBalance) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">客服额度</div>
              <div class="money-val">{{ fmt(csQuotaTotal) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">上盘可飞</div>
              <div class="money-val">{{ fmt(room.ownerAgent.flyCover) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">玩家持分</div>
              <div class="money-val">{{ fmt(room.playerPointsTotal) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">合同额度</div>
              <div class="money-val">{{ fmt(room.creditLimit) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">占成比例</div>
              <div class="money-val">{{ sharePctText }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">超出</div>
              <div
                class="money-val"
                :class="creditExcess > 0 ? 'down' : creditExcess < 0 ? 'up' : ''"
              >{{ fmt(creditExcess) }}</div>
            </div>
          </div>
          <div v-else-if="isLandlordSide" class="money-strip">
            <div class="money-card">
              <div class="money-label">代理余额</div>
              <div class="money-val gold">{{ fmt(room.ownerAgent.balance) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">客服额度</div>
              <div class="money-val">{{ fmt(csQuotaTotal) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">上盘可飞</div>
              <div class="money-val">{{ fmt(room.ownerAgent.flyCover) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">玩家持分</div>
              <div class="money-val">{{ fmt(room.playerPointsTotal) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">本房人数</div>
              <div class="money-val">{{ room.memberCount ?? 0 }}</div>
            </div>
          </div>
          <div v-else class="money-strip">
            <div class="money-card">
              <div class="money-label">代理余额</div>
              <div class="money-val gold">{{ fmt(room.ownerAgent.balance) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">客服额度</div>
              <div class="money-val">{{ fmt(csQuotaTotal) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">上盘可飞</div>
              <div class="money-val">{{ fmt(room.ownerAgent.flyCover) }}</div>
            </div>
            <div class="money-card">
              <div class="money-label">玩家持分</div>
              <div class="money-val">{{ fmt(room.playerPointsTotal) }}</div>
            </div>
          </div>
          <div v-if="canSetGeneralFly" class="fly-room-bar" :class="room.generalFlyEnabled !== false ? 'is-on' : 'is-off'">
            <div class="fly-room-left">
              <span class="fly-room-title">总代整房飞盘</span>
              <span class="fly-room-now" :class="room.generalFlyEnabled !== false ? 'tone-on' : 'tone-off'">
                {{ room.generalFlyEnabled !== false ? '开 · 可飞平台' : '关 · 总代坐庄' }}
              </span>
            </div>
            <div class="fly-room-actions">
              <button
                type="button"
                class="fly-seg fly-seg-on"
                :class="{ active: room.generalFlyEnabled !== false }"
                :disabled="generalFlyBusy || room.generalFlyEnabled !== false"
                @click="setGeneralRoomFly(true)"
              >全开</button>
              <button
                type="button"
                class="fly-seg fly-seg-off"
                :class="{ active: room.generalFlyEnabled === false }"
                :disabled="generalFlyBusy || room.generalFlyEnabled === false"
                @click="setGeneralRoomFly(false)"
              >全关</button>
            </div>
          </div>
          <div v-if="canSetRoomFly" class="fly-room-bar" :class="`is-${roomFlyMode}`">
            <div class="fly-room-left">
              <span class="fly-room-title">整房飞盘</span>
              <span class="fly-room-now" :class="`tone-${roomFlyMode}`">
                {{ roomFlyModeLabel }}
              </span>
              <span
                v-if="cashFlySoftClosed"
                class="fly-room-stat"
                style="color: var(--el-color-warning)"
              >上盘额度耗尽·已软关盘</span>
              <span v-else-if="roomFlyMode === 'mixed'" class="fly-room-stat">
                开 {{ room.fly?.onCount ?? 0 }} · 关 {{ room.fly?.offCount ?? 0 }}
              </span>
              <span v-else class="fly-room-stat">
                共 {{ room.fly?.memberCount ?? 0 }} 人
              </span>
            </div>
            <div class="fly-room-actions">
              <button
                type="button"
                class="fly-seg fly-seg-on"
                :class="{ active: roomFlyMode === 'on' }"
                :disabled="flyBusy || roomFlyMode === 'on'"
                @click="setRoomFly(true)"
              >全开</button>
              <button
                type="button"
                class="fly-seg fly-seg-off"
                :class="{ active: roomFlyMode === 'off' }"
                :disabled="flyBusy || roomFlyMode === 'off'"
                @click="setRoomFly(false)"
              >全关</button>
            </div>
          </div>
        </div>
      </section>
      <div v-else class="empty-box">房间加载中…</div>
    </div>

    <!-- 经营概况：仅输赢统计 -->
    <div v-show="tab === 'overview'" class="room-page-pane">

          <div class="ov">
            <div class="ov-toolbar">
              <el-radio-group v-model="rangeKey" size="small" @change="onRangePreset">
                <el-radio-button label="today">今日</el-radio-button>
                <el-radio-button label="yesterday">昨日</el-radio-button>
                <el-radio-button label="thisweek">本周</el-radio-button>
                <el-radio-button label="lastweek">上周</el-radio-button>
                <el-radio-button label="thismonth">本月</el-radio-button>
                <el-radio-button label="custom">自定义</el-radio-button>
              </el-radio-group>
              <el-button
                v-if="rangeKey !== 'custom'"
                size="small"
                :loading="summaryLoading"
                @click="loadSummary"
              >
                刷新
              </el-button>
            </div>

            <div v-if="rangeKey === 'custom'" class="ov-custom">
              <div class="ov-custom-row">
                <el-date-picker
                  ref="customPickerRef"
                  v-model="customRange"
                  type="datetimerange"
                  unlink-panels
                  clearable
                  :editable="false"
                  :shortcuts="customShortcuts"
                  :default-time="customDefaultTime"
                  range-separator="至"
                  start-placeholder="开始时间"
                  end-placeholder="结束时间"
                  format="YYYY-MM-DD HH:mm"
                  time-format="HH:mm"
                  value-format="YYYY-MM-DDTHH:mm:ss+08:00"
                  class="ov-custom-picker"
                  @change="onCustomRangeChange"
                />
                <el-button type="primary" size="default" :loading="summaryLoading" @click="loadSummary">
                  查询
                </el-button>
              </div>
            </div>

            <div class="ov-range" v-if="summary?.range">
              统计区间（上海时间）
              <b>{{ summary.range.fromText || formatDt(summary.range.from) }}</b>
              ～
              <b>{{ summary.range.toText || formatDt(summary.range.to) }}</b>
            </div>

            <!-- 代理：统计条对齐房间中心 / 工作台 -->
            <template v-if="isAgentSide">
              <section class="ov-block">
                <div class="ov-block-hd">
                  <h4>本期经营</h4>
                </div>
                <div class="ov-summary" :style="ovSummaryCols(coreKpis.length)">
                  <div v-for="k in coreKpis" :key="k.label" class="sum-chip" :class="{ hot: k.hot }">
                    <span class="sum-label">{{ k.label }}</span>
                    <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
                  </div>
                </div>
              </section>

              <section class="ov-block">
                <div class="ov-block-hd">
                  <h4>本期上下分</h4>
                </div>
                <div class="ov-summary" :style="ovSummaryCols(cashKpis.length)">
                  <div
                    v-for="k in cashKpis"
                    :key="k.label"
                    class="sum-chip"
                    :class="{ hot: k.hot }"
                  >
                    <span class="sum-label">{{ k.label }}</span>
                    <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
                  </div>
                </div>
              </section>

              <section class="ov-block">
                <div class="ov-block-hd">
                  <h4>注单与活跃</h4>
                </div>
                <div class="ov-summary" :style="ovSummaryCols(betKpis.length)">
                  <div v-for="k in betKpis" :key="k.label" class="sum-chip">
                    <span class="sum-label">{{ k.label }}</span>
                    <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
                  </div>
                </div>
              </section>

              <div class="ov-split ov-split-tables">
                <section class="ov-block ov-pane">
                  <div class="ov-pane-hd">
                    <h4>注单明细</h4>
                    <el-button size="small" type="primary" plain @click="openGameDetailDlg">查看全部</el-button>
                  </div>
                  <div class="ov-pane-body">
                    <el-table
                      :data="summary?.byGame || []"
                      stripe
                      size="small"
                      empty-text="该区间暂无注单"
                      class="ov-fit-table"
                      table-layout="fixed"
                    >
                      <el-table-column label="游戏" show-overflow-tooltip>
                        <template #default="{ row }: { row: any }">{{ row.gameName || gameLabel(row.gameCode) }}</template>
                      </el-table-column>
                      <el-table-column prop="betCount" label="注单" width="56" align="right" />
                      <el-table-column label="流水" width="88" align="right">
                        <template #default="{ row }: { row: any }">{{ fmt(row.betFlow) }}</template>
                      </el-table-column>
                      <el-table-column label="玩家盈亏" width="88" align="right">
                        <template #default="{ row }: { row: any }">
                          <span :style="{ color: pnlColor(gamePnl(row)) }">{{ fmt(gamePnl(row)) }}</span>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </section>

                <section class="ov-block ov-pane">
                  <div class="ov-pane-hd">
                    <h4>资金流水</h4>
                    <el-button
                      v-if="room?.ownerAgent?.userId"
                      size="small"
                      type="primary"
                      plain
                      @click="openFundDetailDlg"
                    >查看全部</el-button>
                  </div>
                  <div class="ov-pane-body">
                    <el-table
                      v-loading="fundLoading"
                      :data="fundRows"
                      stripe
                      size="small"
                      empty-text="该区间暂无流水"
                      class="ov-fit-table"
                      table-layout="fixed"
                    >
                      <el-table-column label="时间" width="88">
                        <template #default="{ row }: { row: any }">{{ formatDtShort(row.createdAt) }}</template>
                      </el-table-column>
                      <el-table-column label="方式" width="64">
                        <template #default="{ row }: { row: any }">{{ row.method || row.actionLabel }}</template>
                      </el-table-column>
                      <el-table-column label="订单号" min-width="120" show-overflow-tooltip>
                        <template #default="{ row }: { row: any }">{{ row.orderNo || '—' }}</template>
                      </el-table-column>
                      <el-table-column label="明细" show-overflow-tooltip>
                        <template #default="{ row }: { row: any }">
                          <div class="fund-sub">
                            {{ row.operator?.nickname || '—' }}
                            <template v-if="row.counterparty?.nickname"> → {{ row.counterparty.nickname }}</template>
                          </div>
                        </template>
                      </el-table-column>
                      <el-table-column label="金额" width="96" align="right">
                        <template #default="{ row }: { row: any }">
                          <span :class="fundAmtClass(row)">{{ fundAmtText(row) }}</span>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </section>
              </div>
            </template>

            <!-- 管理员 / 房主：与代理同一套统计条 -->
            <template v-else>
              <section class="ov-block">
                <div class="ov-block-hd">
                  <h4>本期经营</h4>
                </div>
                <div class="ov-summary" :style="ovSummaryCols(coreKpis.length)">
                  <div v-for="k in coreKpis" :key="k.label" class="sum-chip" :class="{ hot: k.hot }">
                    <span class="sum-label">{{ k.label }}</span>
                    <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
                  </div>
                </div>
              </section>

              <section class="ov-block">
                <div class="ov-block-hd">
                  <h4>本期上下分</h4>
                </div>
                <div class="ov-summary" :style="ovSummaryCols(cashKpis.length)">
                  <div
                    v-for="k in cashKpis"
                    :key="k.label"
                    class="sum-chip"
                    :class="{ hot: k.hot }"
                  >
                    <span class="sum-label">{{ k.label }}</span>
                    <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
                  </div>
                </div>
              </section>

              <section class="ov-block">
                <div class="ov-block-hd">
                  <h4>注单与活跃</h4>
                </div>
                <div class="ov-summary" :style="ovSummaryCols(betKpis.length)">
                  <div v-for="k in betKpis" :key="k.label" class="sum-chip">
                    <span class="sum-label">{{ k.label }}</span>
                    <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
                  </div>
                </div>
              </section>

              <div class="ov-split ov-split-tables">
                <section class="ov-block ov-pane">
                  <div class="ov-pane-hd">
                    <h4>游戏明细</h4>
                    <el-button size="small" type="primary" plain @click="openGameDetailDlg">查看全部</el-button>
                  </div>
                  <div class="ov-pane-body">
                    <el-table
                      :data="summary?.byGame || []"
                      stripe
                      size="small"
                      empty-text="该区间暂无注单"
                      class="ov-fit-table"
                      table-layout="fixed"
                    >
                      <el-table-column label="游戏" show-overflow-tooltip>
                        <template #default="{ row }: { row: any }">{{ row.gameName || gameLabel(row.gameCode) }}</template>
                      </el-table-column>
                      <el-table-column prop="betCount" label="注单" width="56" align="right" />
                      <el-table-column label="流水" width="88" align="right">
                        <template #default="{ row }: { row: any }">{{ fmt(row.betFlow) }}</template>
                      </el-table-column>
                      <el-table-column label="庄家盈亏" width="88" align="right">
                        <template #default="{ row }: { row: any }">
                          <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </section>

                <section class="ov-block ov-pane">
                  <div class="ov-pane-hd">
                    <h4>资金流水</h4>
                    <el-button
                      v-if="room?.ownerAgent?.userId"
                      size="small"
                      type="primary"
                      plain
                      @click="openFundDetailDlg"
                    >查看全部</el-button>
                  </div>
                  <div class="ov-pane-body">
                    <el-table
                      v-loading="fundLoading"
                      :data="fundRows"
                      stripe
                      size="small"
                      empty-text="该区间暂无流水"
                      class="ov-fit-table"
                      table-layout="fixed"
                    >
                      <el-table-column label="时间" width="88">
                        <template #default="{ row }: { row: any }">{{ formatDtShort(row.createdAt) }}</template>
                      </el-table-column>
                      <el-table-column label="方式" width="64">
                        <template #default="{ row }: { row: any }">{{ row.method || row.actionLabel }}</template>
                      </el-table-column>
                      <el-table-column label="订单号" min-width="120" show-overflow-tooltip>
                        <template #default="{ row }: { row: any }">{{ row.orderNo || '—' }}</template>
                      </el-table-column>
                      <el-table-column label="明细" show-overflow-tooltip>
                        <template #default="{ row }: { row: any }">
                          <div class="fund-sub">
                            {{ row.operator?.nickname || '—' }}
                            <template v-if="row.counterparty?.nickname"> → {{ row.counterparty.nickname }}</template>
                          </div>
                        </template>
                      </el-table-column>
                      <el-table-column label="金额" width="96" align="right">
                        <template #default="{ row }: { row: any }">
                          <span :class="fundAmtClass(row)">{{ fundAmtText(row) }}</span>
                        </template>
                      </el-table-column>
                    </el-table>
                  </div>
                </section>
              </div>
            </template>
          </div>
    </div>

    <div v-show="tab === 'players'" class="room-page-pane players-pane">
      <PlayersPanel
        v-if="room"
        :room-id="room.id"
        :book-mode="room.bookMode"
        :agent-flow-rate="room.ownerAgent?.flowRate ?? null"
        :initial-q="playersInitialQ"
      />
    </div>

    <div v-show="tab === 'agent'" class="room-page-pane">
          <template v-if="room?.ownerAgent?.user">
            <div class="agent-head">
              <div class="agent-id">
                <div class="agent-name">{{ room.ownerAgent.user.nickname }}</div>
                <div class="agent-meta mono">
                  {{ room.ownerAgent.user.username }}
                  <span v-if="room.ownerAgent.user.uid"> · {{ room.ownerAgent.user.uid }}</span>
                </div>
              </div>
              <div class="agent-actions">
                <el-button
                  v-if="canResetAgentPwd"
                  size="small"
                  @click="openResetAgentPwd"
                >改主号密码</el-button>
              </div>
            </div>

            <div class="agent-lists">
              <div class="agent-sec">
                <div class="agent-sec-hd">
                  <span>子账号 <em>{{ agentChildren.length }}</em></span>
                  <el-button
                    v-if="canAddProxy"
                    size="small"
                    type="primary"
                    @click="proxyVisible = true"
                  >开子账号</el-button>
                </div>
                <el-table
                  v-if="agentChildren.length"
                  :data="agentChildren"
                  stripe
                  size="small"
                  :row-class-name="agentChildRowClass"
                >
                  <el-table-column label="名字" min-width="140">
                    <template #default="{ row }: { row: any }">
                      <div>
                        {{ row.nickname }}
                      </div>
                      <div class="sub">{{ row.username }}</div>
                    </template>
                  </el-table-column>
                  <el-table-column label="最近登录" width="120">
                    <template #default="{ row }: { row: any }">{{ formatDt(row.lastLoginAt) }}</template>
                  </el-table-column>
                  <el-table-column label="状态" width="72">
                    <template #default="{ row }: { row: any }">
                      <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" size="small" effect="plain">
                        {{ row.status === 'ACTIVE' ? '正常' : '停用' }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column
                    v-if="canRenameProxy || canHardManageProxy"
                    label="操作"
                    min-width="120"
                    align="right"
                  >
                    <template #default="{ row }: { row: any }">
                      <el-button v-if="canRenameProxy" link type="primary" @click="renameProxy(row)">改名字</el-button>
                      <template v-if="canHardManageProxy">
                        <el-button link @click="resetProxyPwd(row)">重置密码</el-button>
                        <el-button
                          link
                          :type="row.status === 'ACTIVE' ? 'danger' : 'success'"
                          @click="toggleProxyStatus(row)"
                        >{{ row.status === 'ACTIVE' ? '停用' : '启用' }}</el-button>
                      </template>
                    </template>
                  </el-table-column>
                </el-table>
                <div v-else class="empty-line">
                  <span>{{ canAddProxy ? '暂无子账号' : '暂无子账号' }}</span>
                  <el-button
                    v-if="canAddProxy"
                    size="small"
                    type="primary"
                    @click="proxyVisible = true"
                  >开子账号</el-button>
                </div>
              </div>

              <div class="agent-sec">
                <div class="agent-sec-hd">
                  <span>客服账号 <em>{{ csStaffRows.length }}</em></span>
                  <el-button
                    v-if="canAddProxy"
                    size="small"
                    type="primary"
                    plain
                    @click="openCreateCs"
                  >开客服账号</el-button>
                </div>
                <el-table
                  v-if="csStaffRows.length"
                  :data="csStaffRows"
                  stripe
                  size="small"
                  v-loading="csListLoading"
                >
                  <el-table-column label="名字" min-width="140">
                    <template #default="{ row }: { row: any }">
                      <div>{{ row.nickname }}</div>
                      <div class="sub mono">{{ row.username }} · {{ row.uid }}</div>
                    </template>
                  </el-table-column>
                  <el-table-column label="额度" width="88" align="right">
                    <template #default="{ row }: { row: any }">{{ fmt(row.balance) }}</template>
                  </el-table-column>
                  <el-table-column label="接单" width="72">
                    <template #default="{ row }: { row: any }">
                      <el-tag
                        size="small"
                        :type="row.workStatus === 'IDLE' ? 'success' : 'info'"
                        effect="plain"
                      >
                        {{ row.workStatus === 'IDLE' ? '接单中' : '休息' }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="状态" width="72">
                    <template #default="{ row }: { row: any }">
                      <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'" size="small" effect="plain">
                        {{ row.status === 'ACTIVE' ? '正常' : '停用' }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column
                    v-if="canHardManageProxy"
                    label="操作"
                    min-width="120"
                    align="right"
                  >
                    <template #default="{ row }: { row: any }">
                      <el-button link @click="resetCsPwd(row)">重置密码</el-button>
                      <el-button
                        link
                        :type="row.status === 'ACTIVE' ? 'danger' : 'success'"
                        @click="toggleCsStatus(row)"
                      >{{ row.status === 'ACTIVE' ? '停用' : '启用' }}</el-button>
                    </template>
                  </el-table-column>
                </el-table>
                <div v-else class="empty-line">
                  <span>暂无客服</span>
                  <el-button
                    v-if="canAddProxy"
                    size="small"
                    type="primary"
                    plain
                    @click="openCreateCs"
                  >开客服账号</el-button>
                </div>
              </div>
            </div>
          </template>
          <div v-else class="empty-box">本房尚未绑定代理</div>
    </div>

    <div v-show="tab === 'billing'" class="room-page-pane">
      <section class="billing-panel" :class="{ editable: canEditBilling }">
        <div class="billing-head">
          <span class="billing-h-k">项目</span>
          <span class="billing-h-cur">当前</span>
          <span v-if="canEditBilling" class="billing-h-edit">调整</span>
        </div>
        <div class="billing-row">
          <div class="billing-k">月费金额</div>
          <div class="billing-cur em">{{ feeText }}</div>
          <div v-if="canEditBilling" class="billing-edit">
            <el-input-number
              v-model="billingForm.monthlyFee"
              :min="0"
              :max="10000000"
              :precision="0"
              :step="100"
              controls-position="right"
              class="billing-control"
            />
            <el-button
              v-if="billingForm.monthlyFee > 0"
              size="small"
              @click="billingForm.monthlyFee = 0"
            >关闭月费</el-button>
          </div>
        </div>
        <div class="billing-row">
          <div class="billing-k">下次月费日</div>
          <div class="billing-cur">{{ formatDate(room?.nextBillAt) }}</div>
          <div v-if="canEditBilling" class="billing-edit">
            <el-date-picker
              v-model="billingForm.nextBillAt"
              type="date"
              placeholder="选择日期"
              value-format="YYYY-MM-DD"
              :disabled="billingForm.monthlyFee <= 0"
              class="billing-control"
            />
          </div>
        </div>
        <div class="billing-row">
          <div class="billing-k">收费入口</div>
          <div class="billing-cur">结算中心 · 本房占成</div>
          <div v-if="canEditBilling" class="billing-edit muted">—</div>
        </div>
        <div class="billing-row">
          <div class="billing-k">上次收费</div>
          <div class="billing-cur">{{ formatDt(room?.lastBilledAt) }}</div>
          <div v-if="canEditBilling" class="billing-edit muted">—</div>
        </div>
        <div v-if="canEditBilling" class="billing-foot">
          <el-button type="primary" :loading="savingBilling" @click="onSaveBilling">保存调整</el-button>
        </div>
      </section>
    </div>

    <div v-show="tab === 'owners' && isAdmin" class="room-page-pane">
      <!--
        挂了总代的房不能按房单独设可见性：整体跟着总代那份名单走。
        这里摆成只读并把入口指过去，而不是留个点了就报错的按钮。
      -->
      <div v-if="!roomVisibilitySettable" class="owners-panel">
        <el-alert type="info" :closable="false" show-icon>
          <template #title>本房挂了总代，可见性由总代统一决定</template>
          总代对某个总监可见，他名下所有房间就都可见，不能再单独关掉某一间——
          总监是按总代账期结账的，只放开一半房间，他拉出来的总表会少掉另一半的流水和月费，
          照着那个数结账必然算错。
        </el-alert>
        <div class="owners-toolbar" style="margin-top:12px">
          <el-button
            v-if="room?.general?.userId"
            type="primary"
            size="small"
            @click="goGeneralFromRoom"
          >去总代详情改可见范围</el-button>
        </div>
      </div>

      <template v-else>
      <div class="owners-toolbar">
        <el-select
          v-model="ownerUserId"
          filterable
          clearable
          size="small"
          placeholder="选择总监账号"
          class="owners-select"
        >
          <el-option
            v-for="a in branchOptions"
            :key="a.id"
            :label="`${a.nickname}（${a.username} · ${a.uid}）`"
            :value="a.id"
          />
        </el-select>
        <el-button type="primary" size="small" @click="onGrant">授权可见</el-button>
      </div>
      <div class="owners-panel">
        <el-table
          :data="ownerRows"
          stripe
          size="small"
          empty-text="暂无授权总监，上方选择后点「授权可见」"
          class="owners-table"
        >
          <el-table-column label="总监" min-width="160">
            <template #default="{ row }: { row: any }">
              <span class="cell-name">{{ row.nickname }}</span>
            </template>
          </el-table-column>
          <el-table-column label="账号" min-width="140">
            <template #default="{ row }: { row: any }">
              <span class="cell-text">{{ row.username }}</span>
            </template>
          </el-table-column>
          <el-table-column label="UID" min-width="120">
            <template #default="{ row }: { row: any }">
              <span class="cell-text">{{ row.uid }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" align="right">
            <template #default="{ row }: { row: any }">
              <el-button
                v-if="row.userId"
                link
                type="danger"
                @click="onRevoke(row.userId, row.nickname)"
              >取消可见</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      </template>
    </div>

    <div v-show="tab === 'games'" class="room-page-pane">
          <div class="games-toolbar">
            <div class="games-summary">
              已开放 <b>{{ openGameCount }}</b> / {{ gameRows.length }} 款
            </div>
            <div class="games-policy">
              玩家回水框 {{ pctText(rebatePolicy.playerMinRate) }}～{{ pctText(rebatePolicy.playerMaxRate) }}
              · 默认 {{ pctText(agentDefaultRebate) }}
            </div>
          </div>
          <div class="game-list">
            <div
              v-for="row in gameRows"
              :key="row.gameCode"
              class="game-row"
              :class="{ off: !row.enabled }"
            >
              <div class="gr-name">
                <div class="gr-title">{{ row.label }}</div>
                <el-switch
                  v-if="!roomReadonly"
                  :model-value="row.enabled"
                  inline-prompt
                  active-text="开"
                  inactive-text="关"
                  :loading="togglingGame === row.gameCode"
                  @change="(v: string | number | boolean) => toggleGameEnabled(row, !!v)"
                />
                <el-tag v-else size="small" :type="row.enabled ? 'success' : 'info'" effect="plain">
                  {{ row.enabled ? '已开放' : '已关闭' }}
                </el-tag>
              </div>

              <div class="gr-stats">
                <div class="gr-stat">
                  <span class="gk">玩家回水</span>
                  <span class="gv">{{ row.enabled ? `${row.rebatePct}%` : '—' }}</span>
                </div>
                <div class="gr-stat">
                  <span class="gk">代理回水</span>
                  <span class="gv gold">{{ row.enabled ? `${agentRebatePct(row.rebatePct)}%` : '—' }}</span>
                </div>
              </div>

              <div class="gr-action">
                <el-button
                  :disabled="!row.enabled && roomReadonly"
                  @click="openGameDetail(row)"
                >{{ rebateReadonly ? '查看回水' : '设置回水' }}</el-button>
              </div>
            </div>
          </div>
    </div>

    <div v-show="tab === 'robots'" class="room-page-pane">
          <RoomRobotsPanel v-if="room" :room-id="room.id" :readonly="roomReadonly || isGeneral" />
    </div>

    <div v-show="tab === 'settle'" class="room-page-pane">
          <RoomSettlePanel v-if="room" :room-id="room.id" :readonly="settleReadonly" />
    </div>

    <div v-show="tab === 'join'" class="room-page-pane">
      <JoinReviewPanel
        v-if="room"
        :room-id="room.id"
        :readonly="!canReviewJoin"
        @pending="onJoinPending"
        @changed="onJoinChanged"
      />
    </div>
    </div>

    <DeskDialog
      v-model="showGameDlg"
      :title="gameDlg.label ? `游戏设置 · ${gameDlg.label}` : '游戏设置'"
      width="480px"
      dialog-class="game-dlg"
    >
      <div class="gd-section">
        <div class="gd-sec-h">开放与回水</div>
        <div class="gd-basic">
          <div class="gd-basic-item">
            <div class="gd-k">对本房开放</div>
            <el-switch v-model="gameDlg.enabled" active-text="开放" inactive-text="关闭" :disabled="roomReadonly" />
          </div>
        </div>
      </div>

      <div class="gd-section" :class="{ dim: !gameDlg.enabled }">
        <div class="gd-sec-h">回水分配</div>

        <div class="gd-metrics">
          <div class="gd-metric">
            <div class="gd-metric-k">代理整包</div>
            <div class="gd-metric-v">{{ pctText(rebatePolicy.totalRate) }}</div>
          </div>
          <div class="gd-metric main">
            <div class="gd-metric-k">默认玩家回水</div>
            <div class="gd-metric-edit">
              <el-input-number
                v-model="gameDlg.rebatePct"
                :min="playerMinPct"
                :max="playerMaxPct"
                :step="0.1"
                :precision="2"
                :disabled="!gameDlg.enabled || rebateReadonly"
                controls-position="right"
                size="small"
              />
              <span class="unit">%</span>
            </div>
            <div class="gd-metric-range">可调 {{ playerMinPct }}% ~ {{ playerMaxPct }}%</div>
          </div>
          <div class="gd-metric">
            <div class="gd-metric-k">代理回水</div>
            <div class="gd-metric-v gold">{{ agentRebatePct(gameDlg.rebatePct) }}%</div>
          </div>
        </div>

        <div class="gd-bar" aria-hidden="true">
          <div class="gd-bar-p" :style="{ width: playerBarWidth }" />
          <div class="gd-bar-a" :style="{ width: agentBarWidth }" />
        </div>
        <div class="gd-bar-legend">
          <span><i class="dot p" />玩家 {{ Number(gameDlg.rebatePct || 0).toFixed(2) }}%</span>
          <span><i class="dot a" />代理 {{ agentRebatePct(gameDlg.rebatePct) }}%</span>
        </div>

        <div class="gd-example">
          <div class="gd-ex-label">流水 10,000 时</div>
          <div class="gd-ex-nums">
            <span>玩家 <b>{{ examplePlayer }}</b></span>
            <span>代理 <b>{{ exampleAgent }}</b></span>
            <span>合计 <b>{{ exampleTotal }}</b></span>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="showGameDlg = false">{{ roomReadonly ? '关闭' : '取消' }}</el-button>
        <span class="win-footer-grow" />
        <el-button v-if="!roomReadonly" type="primary" :loading="savingGame" @click="saveGameDetail">保存</el-button>
      </template>
    </DeskDialog>

    <DeskDialog
      v-model="showResetPwd"
      title="重置主号密码"
      width="420px"
      @closed="resetPwd = ''"
    >
      <el-form label-position="top">
        <el-form-item label="账号">
          <el-input :model-value="room?.ownerAgent?.user?.username || '—'" disabled />
        </el-form-item>
        <el-form-item label="新密码" required>
          <div class="row" style="width:100%;gap:8px">
            <el-input
              v-model="resetPwd"
              type="password"
              show-password
              maxlength="32"
              :placeholder="OPS_PASSWORD_HINT"
              style="flex:1"
            />
            <el-button @click="regenResetPwd">随机</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showResetPwd = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="resettingPwd" @click="onResetPwd">确认重置</el-button>
      </template>
    </DeskDialog>

    <DeskDialog
      v-model="showProxyResetPwd"
      :title="staffResetKind === 'CS' ? '重置客服密码' : '重置子账号密码'"
      width="420px"
      @closed="proxyResetPwd = ''; staffResetKind = 'PROXY'"
    >
      <el-form label-position="top">
        <el-form-item label="账号">
          <el-input
            :model-value="proxyResetTarget
              ? `${proxyResetTarget.username}${proxyResetTarget.nickname ? `（${proxyResetTarget.nickname}）` : ''}`
              : '—'"
            disabled
          />
        </el-form-item>
        <el-form-item label="新密码" required>
          <div class="row" style="width:100%;gap:8px">
            <el-input
              v-model="proxyResetPwd"
              type="password"
              show-password
              maxlength="32"
              :placeholder="OPS_PASSWORD_HINT"
              style="flex:1"
            />
            <el-button @click="regenProxyResetPwd">随机</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showProxyResetPwd = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="proxyResetBusy" @click="doResetProxyPwd">确认重置</el-button>
      </template>
    </DeskDialog>

    <DeskDialog v-model="showResetCreds" title="密码已重置" width="420px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon class="cred-alert">
        请立即复制交给对方，此密码仅展示一次
      </el-alert>
      <div v-if="resetCreds" class="cred-box">
        <div class="cred-row"><span>用户名</span><b>{{ resetCreds.username }}</b></div>
        <div class="cred-row"><span>新密码</span><b>{{ resetCreds.password }}</b></div>
      </div>
      <template #footer>
        <el-button @click="showResetCreds = false">我已保存</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" @click="copyResetCreds">复制</el-button>
      </template>
    </DeskDialog>

    <DeskDialog
      v-model="fundVisible"
      :title="fundMode === 'up' ? '上分' : '下分'"
      width="400px"
    >
      <el-form label-width="72px">
        <el-form-item label="金额">
          <el-input-number v-model="fundAmount" :min="1" :max="10000000" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fundVisible = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button :type="fundMode === 'up' ? 'primary' : 'warning'" :loading="fundBusy" @click="doAgentFund">
          确认{{ fundMode === 'up' ? '上分' : '下分' }}
        </el-button>
      </template>
    </DeskDialog>

    <DeskDialog v-model="proxyVisible" title="开通子账号" width="420px">
      <el-form label-width="88px">
        <el-form-item label="登录账号" required>
          <el-input v-model="proxyForm.username" placeholder="8-20位小写字母数字" />
        </el-form-item>
        <el-form-item label="密码" required>
          <div class="row" style="width:100%;gap:8px">
            <el-input v-model="proxyForm.password" type="password" show-password style="flex:1" />
            <el-button @click="regenProxyPwd">随机</el-button>
          </div>
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="proxyForm.nickname" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="proxyVisible = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="fundBusy" @click="doCreateProxy">确认开通</el-button>
      </template>
    </DeskDialog>

    <DeskDialog v-model="showProxyCreds" title="子账号账号密码" width="420px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon class="cred-alert">
        请立即复制交给对方，此密码仅展示一次
      </el-alert>
      <div v-if="proxyCreds" class="cred-box">
        <div class="cred-row"><span>用户名</span><b>{{ proxyCreds.username }}</b></div>
        <div class="cred-row"><span>密码</span><b>{{ proxyCreds.password }}</b></div>
      </div>
      <template #footer>
        <el-button @click="showProxyCreds = false">我已保存</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" @click="copyProxyCreds">复制</el-button>
      </template>
    </DeskDialog>

    <DeskDialog
      v-model="csVisible"
      title="开客服账号"
      width="460px"
      @closed="resetCsForm"
    >
      <el-form label-width="100px">
        <el-form-item label="显示名">
          <el-input v-model="csForm.nickname" maxlength="20" placeholder="如：早班 / 晚班" />
        </el-form-item>
        <el-form-item label="登录用户名">
          <el-input v-model="csForm.username" placeholder="可选 · 8-20 小写字母数字" />
        </el-form-item>
        <el-form-item label="登录密码">
          <el-input v-model="csForm.password" placeholder="可选 · 默认随机" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="csVisible = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="csBusy" @click="doCreateCs">确认开通</el-button>
      </template>
    </DeskDialog>

    <DeskDialog v-model="showCsCreds" title="客服账号密码" width="420px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon class="cred-alert">
        请立即复制交给客服，此密码仅展示一次
      </el-alert>
      <div v-if="csCreds" class="cred-box">
        <div class="cred-row"><span>用户名</span><b>{{ csCreds.username }}</b></div>
        <div class="cred-row"><span>密码</span><b>{{ csCreds.password }}</b></div>
        <div v-if="csCreds.nickname" class="cred-row"><span>显示名</span><b>{{ csCreds.nickname }}</b></div>
      </div>
      <template #footer>
        <el-button @click="showCsCreds = false">我已保存</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" @click="copyCsCreds">复制</el-button>
      </template>
    </DeskDialog>

    <!-- 游戏明细大弹窗：独立日期 + 游戏类型 -->
    <DeskDialog
      v-model="gameDetailVisible"
      title="游戏明细"
      width="920px"
      top="4vh"
      :align-center="false"
      dialog-class="ov-detail-dlg"
      @opened="loadGameDetail"
    >
      <div class="dlg-toolbar">
        <el-date-picker
          v-model="gameDlgRange"
          type="datetimerange"
          unlink-panels
          :editable="false"
          :shortcuts="customShortcuts"
          :default-time="customDefaultTime"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          format="YYYY-MM-DD HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss+08:00"
          style="width: 360px"
        />
        <el-select v-model="gameDlgGameCode" clearable placeholder="全部游戏" style="width: 160px">
          <el-option
            v-for="g in GAME_OPTIONS"
            :key="g.value"
            :label="g.label"
            :value="g.value"
          />
        </el-select>
        <el-button type="primary" :loading="gameDlgLoading" @click="onGameDlgQuery">查询</el-button>
      </div>
      <div v-if="gameDlgByGame.length" class="dlg-game-sum">
        <el-table :data="gameDlgByGame" stripe size="small" max-height="200">
          <el-table-column label="游戏" min-width="120" show-overflow-tooltip>
            <template #default="{ row }: { row: any }">{{ row.gameName || gameLabel(row.gameCode) }}</template>
          </el-table-column>
          <el-table-column prop="betCount" label="注单" width="72" align="right" />
          <el-table-column label="流水" width="110" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.betFlow) }}</template>
          </el-table-column>
          <el-table-column label="派彩" width="110" align="right">
            <template #default="{ row }: { row: any }">{{ fmt(row.payout) }}</template>
          </el-table-column>
          <el-table-column label="庄家盈亏" width="110" align="right">
            <template #default="{ row }: { row: any }">
              <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div class="dlg-sec-title">注单列表 · 共 {{ gameDlgBetTotal }} 笔</div>
      <el-table
        v-loading="gameDlgLoading"
        :data="gameDlgBets"
        stripe
        size="small"
        max-height="380"
        empty-text="该筛选条件下暂无注单"
      >
        <el-table-column label="时间" width="140">
          <template #default="{ row }: { row: any }">{{ formatDt(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="玩家" min-width="120" show-overflow-tooltip>
          <template #default="{ row }: { row: any }">
            <div>{{ row.playerNickname }}</div>
            <div class="fund-sub">{{ row.playerUid || row.playerUsername || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="游戏" width="110" show-overflow-tooltip>
          <template #default="{ row }: { row: any }">{{ row.gameName || gameLabel(row.gameCode) }}</template>
        </el-table-column>
        <el-table-column label="玩法" min-width="90" show-overflow-tooltip>
          <template #default="{ row }: { row: any }">{{ row.betType || '—' }}</template>
        </el-table-column>
        <el-table-column label="下注" width="96" align="right">
          <template #default="{ row }: { row: any }">{{ fmt(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="派彩" width="96" align="right">
          <template #default="{ row }: { row: any }">{{ fmt(row.payout) }}</template>
        </el-table-column>
        <el-table-column label="玩家盈亏" width="100" align="right">
          <template #default="{ row }: { row: any }">
            <span :style="{ color: pnlColor(row.playerPnl) }">{{ fmt(row.playerPnl) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="72" align="center">
          <template #default="{ row }: { row: any }">
            <el-tag size="small" :type="betStatusType(row.status)" effect="plain">
              {{ betStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="gameDlgBetTotal > gameDlgPageSize" class="fund-pager">
        <el-pagination
          background
          layout="prev, pager, next"
          :total="gameDlgBetTotal"
          :page-size="gameDlgPageSize"
          :current-page="gameDlgPage"
          @current-change="onGameDlgPage"
        />
      </div>
    </DeskDialog>

    <!-- 资金流水大弹窗：独立日期 + 类型 + 汇总 -->
    <DeskDialog
      v-model="fundDetailVisible"
      title="资金流水明细"
      width="960px"
      top="4vh"
      :align-center="false"
      dialog-class="ov-detail-dlg"
      @opened="loadFundDetail"
    >
      <div class="dlg-toolbar">
        <el-date-picker
          v-model="fundDlgRange"
          type="datetimerange"
          unlink-panels
          :editable="false"
          :shortcuts="customShortcuts"
          :default-time="customDefaultTime"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          format="YYYY-MM-DD HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss+08:00"
          style="width: 360px"
        />
        <el-select v-model="fundDlgType" style="width: 160px">
          <el-option label="全部类型" value="all" />
          <el-option label="额度（下发+回收）" value="quota" />
          <el-option label="下发额度" value="quota_in" />
          <el-option label="回收额度" value="quota_out" />
          <el-option label="玩家上下分" value="player" />
          <el-option label="玩家上分" value="player_up" />
          <el-option label="玩家下分" value="player_down" />
          <el-option label="客服划额" value="cs" />
          <el-option label="划给客服" value="cs_alloc" />
          <el-option label="收回客服" value="cs_recall" />
        </el-select>
        <el-button type="primary" :loading="fundDlgLoading" @click="onFundDlgQuery">查询</el-button>
        <span class="fund-toolbar-hint">共 {{ fundDlgTotal }} 笔</span>
      </div>
      <div v-if="fundDlgTotals" class="fund-totals dlg-fund-totals">
        <div class="ft">
          <span class="ft-k">下发额度</span>
          <b class="up">{{ fmt(fundDlgTotals.quotaIn) }}</b>
        </div>
        <div class="ft">
          <span class="ft-k">回收额度</span>
          <b class="down">{{ fmt(fundDlgTotals.quotaOut) }}</b>
        </div>
        <div class="ft">
          <span class="ft-k">玩家上分</span>
          <b class="up">{{ fmt(fundDlgTotals.playerUp) }}</b>
        </div>
        <div class="ft">
          <span class="ft-k">玩家下分</span>
          <b class="down">{{ fmt(fundDlgTotals.playerDown) }}</b>
        </div>
        <div class="ft">
          <span class="ft-k">划给客服</span>
          <b class="down">{{ fmt(fundDlgTotals.csAlloc) }}</b>
        </div>
        <div class="ft">
          <span class="ft-k">收回客服</span>
          <b class="up">{{ fmt(fundDlgTotals.csRecall) }}</b>
        </div>
      </div>
      <el-table
        v-loading="fundDlgLoading"
        :data="fundDlgRows"
        stripe
        size="small"
        max-height="420"
        empty-text="该筛选条件下暂无记录"
      >
        <el-table-column label="时间" width="140">
          <template #default="{ row }: { row: any }">{{ formatDt(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="方式" width="80" show-overflow-tooltip>
          <template #default="{ row }: { row: any }">{{ row.method || row.actionLabel }}</template>
        </el-table-column>
        <el-table-column label="订单号" min-width="150" show-overflow-tooltip>
          <template #default="{ row }: { row: any }">{{ row.orderNo || '—' }}</template>
        </el-table-column>
        <el-table-column label="明细" min-width="160" show-overflow-tooltip>
          <template #default="{ row }: { row: any }">
            <div>
              {{ row.operator?.nickname || '—' }}
              <template v-if="row.counterparty?.nickname"> → {{ row.counterparty.nickname }}</template>
            </div>
            <div v-if="row.remark" class="fund-sub">{{ row.remark }}</div>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }: { row: any }">
            <span :class="fundAmtClass(row)">{{ fundAmtText(row) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="fundDlgTotal > fundDlgPageSize" class="fund-pager">
        <el-pagination
          background
          layout="prev, pager, next"
          :total="fundDlgTotal"
          :page-size="fundDlgPageSize"
          :current-page="fundDlgPage"
          @current-change="onFundDlgPage"
        />
      </div>
    </DeskDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { formatMoney, isGeneralSide, OPS_PASSWORD_HINT, validateOpsPassword } from '@gamebox/shared'
import DeskDialog from '@/components/DeskDialog.vue'
import {
  consoleApi,
  type AgentAuditFundTotals,
  type AgentAuditRow,
  type AgentDetail,
  type CsStaffCreated,
  type CsStaffRow,
  type ReportRoomBetRow,
  type ReportSummary,
  type RoomGameCfg,
} from '@/api/console'
import { useAdminStore } from '@/stores/admin'
import { roomIconUrl } from '@/utils/roomIcon'
import { newFundOrderNo } from '@/utils/fundOrderNo'
import RoomRobotsPanel from '@/views/room-detail/RoomRobotsPanel.vue'
import RoomSettlePanel from '@/views/room-detail/RoomSettlePanel.vue'
import JoinReviewPanel from '@/views/room-detail/JoinReviewPanel.vue'
import PlayersPanel from '@/views/PlayersPanel.vue'
import {
  CLOSED_FLOW_COLOR, GAME_OPTIONS, gameLabel, roomStatusLabel, roomStatusTagType, type KpiChip,
} from '@/utils/labels'

type RoomDetail = {
  icon?: string | null
  id: string
  roomNo?: string
  name?: string
  status?: string
  enabledGames?: string[]
  monthlyFee?: number
  billingDay?: number
  nextBillAt?: string | null
  lastBilledAt?: string | null
  overIssueEnabled?: boolean
  overIssueLimit?: number
  overIssueUsed?: number
  bookMode?: 'CASH' | 'CREDIT'
  agentShareRate?: number
  creditLimit?: number
  settleCycle?: 'WEEKLY_MON' | 'MONTHLY_1' | 'MONTHLY_15_30' | string
  settleWeekday?: number
  createdAt?: string
  memberCount?: number
  roundCount?: number
  /** 本房玩家当前余额合计 */
  playerPointsTotal?: number
  generalFlyEnabled?: boolean
  general?: {
    agentId?: string
    userId?: string
    uid?: string
    nickname?: string
    username?: string
    flowRate?: number
    shareRate?: number
  } | null
  fly?: {
    onCount: number
    offCount: number
    memberCount: number
    effective: boolean
    flyCover: number
  }
  /** 能否按房单独设可见总监；挂了总代就不能，改由总代那边统一决定 */
  roomVisibilitySettable?: boolean
  ownerAgent?: {
    agentId?: string
    userId?: string
    balance?: number | null
    /** 对外唯一的「代理余额」：信用盘=剩余信用+未结佣金 */
    agentBalance?: number
    unsettledWage?: number
    pointsQuota?: number
    diskPoolRemaining?: number
    csBalances?: number
    pointsUsed?: number
    flyCover?: number
    rebateRate?: number | null
    flowRate?: number
    shareRate?: number
    user?: {
      id?: string
      nickname?: string
      uid?: string
      username?: string
      status?: string
    } | null
  } | null
  ownerGrants?: Array<{
    ownerId?: string
    owner?: { id?: string; uid?: string; nickname?: string; username?: string }
  }>
}

type StaffOpt = { id: string; uid: string; username: string; nickname: string; role: string }

const route = useRoute()
const router = useRouter()
const store = useAdminStore()
const id = computed(() => String(route.params.id))
const isAdmin = computed(() => store.profile?.role === 'ADMIN')
const isBranch = computed(() => store.profile?.role === 'BRANCH')
const isGeneral = computed(() => isGeneralSide(store.profile?.role, store.profile?.parentRole))
const isAgent = computed(() => store.profile?.role === 'AGENT')
const isProxy = computed(() =>
  store.profile?.role === 'PROXY' && !isGeneral.value,
)
/** 代理 / 子账号：经营概况用玩家视角 */
const isAgentSide = computed(() => isAgent.value || isProxy.value)
/** 管理员 / 房主：额度条用发分视角（上盘额度 / 剩余信用） */
const isLandlordSide = computed(() => isAdmin.value || isBranch.value)
/** 代分：房间信息只读 */
const roomReadonly = computed(() => isProxy.value)
/** 总代可开关本房游戏，但不能改玩家回水；管理只定框，实际比例由代理填 */
const rebateReadonly = computed(() => !isAgent.value)
/** 直挂房：管理/总监可结。挂了总代的房是总代跟代理结，管理不代清。 */
const settleReadonly = computed(() => {
  const r = store.profile?.role
  if (r === 'ADMIN' || r === 'BRANCH') return !!room.value?.general?.userId
  return !isGeneral.value
})
const canGoSettleCenter = computed(() => {
  const r = store.profile?.role
  return r === 'ADMIN' || r === 'BRANCH' || isGeneral.value
})
const canResetAgentPwd = computed(() => {
  const me = store.profile?.role
  return me === 'ADMIN' || me === 'BRANCH' || isGeneral.value
})
const canEditBilling = computed(() => store.profile?.role === 'ADMIN' || store.profile?.role === 'BRANCH')
const canFundMainAgent = computed(() => {
  const me = store.profile?.role
  /* 挂了总代：由总代给房间代理加减分。直挂平台：管理/总监直接加减分。 */
  if (isGeneral.value) return true
  if (me === 'ADMIN' || me === 'BRANCH') return !room.value?.general?.userId
  return false
})
/** 信用盘房间上分仍走房间接口，避免多房串欠款 */
/** 进房通过/拒绝：主代理、管理/总监、名下总代；子账号只读 */
const canReviewJoin = computed(() => {
  const me = store.profile?.role
  return me === 'AGENT' || me === 'ADMIN' || me === 'BRANCH' || isGeneral.value
})
/** 管理/总监/名下总代可给本房开子账号和客服；代理本人不能开 */
const canAddProxy = computed(() => {
  if (!room.value?.ownerAgent?.userId) return false
  const me = store.profile?.role
  if (me === 'ADMIN' || me === 'BRANCH') return true
  if (!isGeneral.value) return false
  const gid = room.value?.general?.userId
  return gid === store.profile?.id || gid === store.profile?.parentId
})
/** 重置密码/停用子账号和客服：管理、总监、名下总代 */
const canHardManageProxy = computed(() => canAddProxy.value)
/** 改名字：仅主代理本人（管理员/房主不改名） */
const canRenameProxy = computed(() => {
  if (!room.value?.ownerAgent?.userId) return false
  return store.profile?.role === 'AGENT' && room.value.ownerAgent.userId === store.profile?.id
})
/** 整房飞盘/关盘：仅本房主代理可见可改（信用盘也可开关） */
const canSetRoomFly = computed(() => {
  if (store.profile?.role !== 'AGENT') return false
  return !!room.value?.ownerAgent?.userId
    && room.value.ownerAgent.userId === store.profile?.id
})
/** 总代整房飞盘：仅本房挂靠总代可改 */
const canSetGeneralFly = computed(() => {
  if (!isGeneral.value) return false
  const gid = room.value?.general?.userId
  if (!gid) return false
  return gid === store.profile?.id || gid === store.profile?.parentId
})
/** 开盘状态：管理员/房主/总代（含分身）/代理 */
const canSetRoomStatus = computed(() => {
  const me = store.profile?.role
  return me === 'ADMIN' || me === 'BRANCH' || isGeneral.value || me === 'AGENT'
})
/** 房间图标：管理/总监/总代（含分身）/代理可改；房间代理子账号只看 */
const canEditRoomIcon = computed(() => {
  const me = store.profile?.role
  return me === 'ADMIN' || me === 'BRANCH' || isGeneral.value || me === 'AGENT'
})
const roomIconInput = ref<HTMLInputElement | null>(null)
const iconBusy = ref(false)

function pickRoomIcon() {
  if (!canEditRoomIcon.value || iconBusy.value) return
  roomIconInput.value?.click()
}

function readRoomIconAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

async function onRoomIconPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !room.value) return
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    ElMessage.warning('请选择 JPG / PNG / WEBP 图片')
    return
  }
  if (file.size > 800 * 1024) {
    ElMessage.warning('图片请小于 800KB')
    return
  }
  iconBusy.value = true
  try {
    const image = await readRoomIconAsDataUrl(file)
    const res = await consoleApi.uploadRoomIcon(room.value.id, image)
    room.value = { ...room.value, icon: res.icon || '/images/rooms/default-room.webp' }
    ElMessage.success('房间图标已更新')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '上传失败')
  } finally {
    iconBusy.value = false
  }
}


/** 整房飞盘当前态：全开 / 全关 / 有人开有人关 */
const roomFlyMode = computed<'on' | 'off' | 'mixed'>(() => {
  const on = room.value?.fly?.onCount ?? 0
  const off = room.value?.fly?.offCount ?? 0
  if (on > 0 && off === 0) return 'on'
  if (off > 0 && on === 0) return 'off'
  if (on > 0 && off > 0) return 'mixed'
  return 'off'
})
const roomFlyModeLabel = computed(() => {
  if (roomFlyMode.value === 'on') return '全开'
  if (roomFlyMode.value === 'off') return '全关'
  return '部分开启'
})
/** 现金盘：开关仍开但占用=0 → 实际已走关盘记账 */
const cashFlySoftClosed = computed(() => {
  const r = room.value
  if (!r || r.bookMode === 'CREDIT') return false
  if (roomFlyMode.value === 'off') return false
  return Number(r.ownerAgent?.flyCover || 0) <= 0
})

const loading = ref(false)
const flyBusy = ref(false)
const generalFlyBusy = ref(false)
const statusBusy = ref(false)
const summaryLoading = ref(false)
const betLoading = ref(false)
const betRows = ref<ReportRoomBetRow[]>([])
const betTotal = ref(0)
const resettingPwd = ref(false)
const savingBilling = ref(false)
const billingForm = reactive({
  monthlyFee: 0,
  billingDay: 1,
  nextBillAt: '' as string,
})
const room = ref<RoomDetail | null>(null)
const games = ref<RoomGameCfg[]>([])
const summary = ref<ReportSummary | null>(null)
const tab = ref('basic')
/** 本房待审进房人数；>0 时副导航「进房审核」高亮 */
const pendingJoinCount = ref(0)
let joinPollTimer: ReturnType<typeof setInterval> | null = null

const detailTabs = computed(() => {
  const items = [
    { key: 'basic', label: '基础信息' },
    { key: 'overview', label: '经营概况' },
    { key: 'players', label: '玩家' },
    { key: 'join', label: '进房审核' },
    { key: 'agent', label: '绑定代理' },
    { key: 'billing', label: '月费账单' },
    { key: 'games', label: '游戏设置' },
    { key: 'robots', label: '机器人托' },
    ...(isAdmin.value ? [{ key: 'owners', label: '可见总监' }] : []),
  ]
  /* 代理没有结算中心，单房对账只留在房间里；管理/总代统一去结算中心 */
  if (isAgentSide.value) {
    items.push({ key: 'settle', label: '占成对账' })
  }
  return items
})

function onJoinPending(n: number) {
  pendingJoinCount.value = Math.max(0, Number(n) || 0)
}

function onJoinChanged() {
  void loadJoinPending()
}

async function loadJoinPending() {
  const rid = room.value?.id || id.value
  if (!rid) {
    pendingJoinCount.value = 0
    return
  }
  try {
    const res = await consoleApi.joinPending()
    pendingJoinCount.value = (res.list || []).filter((r) => r.roomId === rid).length
  } catch {
    /* 保留上次数量，避免闪断 */
  }
}

const playersInitialQ = computed(() => {
  const q = route.query.q
  return typeof q === 'string' ? q : ''
})

function setTab(key: string) {
  if (tab.value === key) return
  tab.value = key
  const q = { ...route.query, tab: key }
  void router.replace({ query: q })
}

const highlightAgentId = ref('')
const rangeKey = ref('today')
const customRange = ref<[string, string] | null>(null)
const customPickerRef = ref<{ focus?: () => void; handleOpen?: () => void } | null>(null)
const customDefaultTime: [Date, Date] = [
  new Date(2000, 0, 1, 0, 0, 0),
  new Date(2000, 0, 1, 0, 0, 0),
]

const SH_MS = 8 * 3600 * 1000
const DAY_MS = 86400000

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

/** 绝对时间 → 上海偏移 ISO（与后端左闭右开一致） */
function toShanghaiOffsetIso(date: Date): string {
  const u = new Date(date.getTime() + SH_MS)
  return `${u.getUTCFullYear()}-${pad2(u.getUTCMonth() + 1)}-${pad2(u.getUTCDate())}T${pad2(u.getUTCHours())}:${pad2(u.getUTCMinutes())}:${pad2(u.getUTCSeconds())}+08:00`
}

function shanghaiDay0(offsetDays = 0): Date {
  const sh = new Date(Date.now() + SH_MS)
  const y = sh.getUTCFullYear()
  const m = sh.getUTCMonth()
  const d = sh.getUTCDate()
  return new Date(Date.UTC(y, m, d) - SH_MS + offsetDays * DAY_MS)
}

function shanghaiBoundPair(fromDayOffset: number, toDayOffset: number): [string, string] {
  return [
    toShanghaiOffsetIso(shanghaiDay0(fromDayOffset)),
    toShanghaiOffsetIso(shanghaiDay0(toDayOffset)),
  ]
}

const customShortcuts = [
  { text: '今日', value: () => [shanghaiDay0(0), shanghaiDay0(1)] },
  { text: '昨日', value: () => [shanghaiDay0(-1), shanghaiDay0(0)] },
  { text: '近 7 天', value: () => [shanghaiDay0(-6), shanghaiDay0(1)] },
  { text: '近 30 天', value: () => [shanghaiDay0(-29), shanghaiDay0(1)] },
  {
    text: '本月',
    value: () => {
      const sh = new Date(Date.now() + SH_MS)
      const month0 = new Date(Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), 1) - SH_MS)
      return [month0, shanghaiDay0(1)]
    },
  },
]
const ownerUserId = ref('')
const resetPwd = ref('')
const showResetCreds = ref(false)
const showResetPwd = ref(false)
const resetCreds = ref<{ username: string; password: string } | null>(null)
const showProxyCreds = ref(false)
const proxyCreds = ref<{ username: string; password: string } | null>(null)
const showProxyResetPwd = ref(false)
const proxyResetPwd = ref('')
const proxyResetBusy = ref(false)
const proxyResetTarget = ref<{ id: string; nickname: string; username: string } | null>(null)
/** 复用重置密码弹窗：子账号 / 客服 */
const staffResetKind = ref<'PROXY' | 'CS'>('PROXY')
const staffList = ref<StaffOpt[]>([])
const agentChildren = ref<AgentDetail['children']>([])
const csStaffRows = ref<CsStaffRow[]>([])
const csListLoading = ref(false)
const csQuotaTotal = computed(() => {
  const fromApi = room.value?.ownerAgent?.csBalances
  if (fromApi != null) return Number(fromApi)
  return csStaffRows.value.reduce((s, r) => s + Number(r.balance || 0), 0)
})
const creditAgentBalance = computed(() => {
  const a = room.value?.ownerAgent
  if (!a) return 0
  if (a.agentBalance != null) return Number(a.agentBalance)
  return Number(a.balance || 0)
})
/* 老数据没这个字段时按「没挂总代就能设」兜底 */
const roomVisibilitySettable = computed(() => {
  const r = room.value
  if (!r) return false
  if (r.roomVisibilitySettable != null) return r.roomVisibilitySettable
  return !r.general?.userId
})
const creditSum = computed(() => {
  if (!room.value) return 0
  return Number(room.value.ownerAgent?.pointsQuota || 0)
    + Number(room.value.playerPointsTotal || 0)
    + csQuotaTotal.value
})
const creditExcess = computed(() =>
  creditSum.value - Number(room.value?.creditLimit || 0),
)
const fundRows = ref<AgentAuditRow[]>([])
const fundLoading = ref(false)
const fundPreviewPageSize = 12
/** 资金明细弹窗 */
const fundDetailVisible = ref(false)
const fundDlgLoading = ref(false)
const fundDlgType = ref('all')
const fundDlgPage = ref(1)
const fundDlgPageSize = 20
const fundDlgTotal = ref(0)
const fundDlgTotals = ref<AgentAuditFundTotals | null>(null)
const fundDlgRows = ref<AgentAuditRow[]>([])
const fundDlgRange = ref<[string, string] | null>(null)
/** 游戏明细弹窗 */
const gameDetailVisible = ref(false)
const gameDlgLoading = ref(false)
const gameDlgGameCode = ref('')
const gameDlgRange = ref<[string, string] | null>(null)
const gameDlgByGame = ref<NonNullable<ReportSummary['byGame']>>([])
const gameDlgBets = ref<ReportRoomBetRow[]>([])
const gameDlgBetTotal = ref(0)
const gameDlgPage = ref(1)
const gameDlgPageSize = 30
const fundVisible = ref(false)
const fundMode = ref<'up' | 'down'>('up')
const fundAmount = ref(1000)
const fundTargetId = ref('')
const fundBusy = ref(false)
const fundOrderNo = ref('')
const proxyVisible = ref(false)
const proxyForm = reactive({ username: '', password: '', nickname: '' })
const csVisible = ref(false)
const csBusy = ref(false)
const csForm = reactive({ username: '', password: '', nickname: '' })
const showCsCreds = ref(false)
const csCreds = ref<CsStaffCreated | null>(null)
const showGameDlg = ref(false)
const savingGame = ref(false)
const rebatePolicy = reactive({
  totalRate: 0.07,
  playerMinRate: 0.018,
  playerMaxRate: 0.05,
  agentDefaultRate: 0.05,
  agentPkg: 0.05,
  games: [] as Array<{
    gameCode: string
    minRate: number
    maxRate: number
    playerRate: number
    playerMin?: number
    playerMax?: number
  }>,
})

const gameDlg = reactive({
  gameCode: '',
  label: '',
  enabled: false,
  robotCount: 10,
  rebatePct: 1.8,
})

type GameRow = {
  gameCode: string
  label: string
  enabled: boolean
  robotCount: number
  rebateRate: number | null
  rebatePct: number
}

const gameRows = ref<GameRow[]>([])
const openGameCount = computed(() => gameRows.value.filter((g) => g.enabled).length)

const currentGameRule = computed(() =>
  rebatePolicy.games.find((g) => g.gameCode === gameDlg.gameCode),
)
const playerMinPct = computed(() => {
  const r = currentGameRule.value
  if (r) return Number(((r.minRate ?? r.playerMin) * 100).toFixed(2))
  return Number((rebatePolicy.playerMinRate * 100).toFixed(2))
})
const playerMaxPct = computed(() => {
  const r = currentGameRule.value
  if (r) return Number(((r.maxRate ?? r.playerMax) * 100).toFixed(1))
  return Number((rebatePolicy.playerMaxRate * 100).toFixed(1))
})
const agentDefaultRebate = computed(() => {
  const r = room.value?.ownerAgent?.rebateRate
  if (r == null || Number.isNaN(Number(r))) return rebatePolicy.playerMinRate
  return Number(r)
})
const defaultPlayerPct = computed(() => Number((agentDefaultRebate.value * 100).toFixed(2)))

const exampleFlow = 10000
const examplePlayer = computed(() =>
  Math.round(exampleFlow * (Number(gameDlg.rebatePct) || 0) / 100 * 100) / 100,
)
const exampleAgent = computed(() =>
  Math.round(exampleFlow * Number(agentRebatePct(gameDlg.rebatePct)) / 100 * 100) / 100,
)
const exampleTotal = computed(() =>
  Math.round(exampleFlow * rebatePolicy.agentPkg * 100) / 100,
)

const playerBarWidth = computed(() => {
  const t = rebatePolicy.agentPkg * 100
  if (t <= 0) return '0%'
  const p = Math.min(Number(gameDlg.rebatePct) || 0, t)
  return `${(p / t) * 100}%`
})
const agentBarWidth = computed(() => {
  const t = rebatePolicy.agentPkg * 100
  if (t <= 0) return '0%'
  const a = Math.max(0, t - (Number(gameDlg.rebatePct) || 0))
  return `${(a / t) * 100}%`
})

function pctText(rate: number) {
  return `${(Number(rate || 0) * 100).toFixed(2)}%`
}
function agentRebatePct(playerPct: number) {
  const t = Number((rebatePolicy.agentPkg * 100).toFixed(2))
  const p = Number(playerPct || 0)
  return Number(Math.max(0, t - p).toFixed(2))
}

const branchOptions = computed(() => staffList.value.filter((a) => a.role === 'BRANCH'))

const ownerRows = computed(() =>
  (room.value?.ownerGrants || []).map((g, i) => ({
    key: g.owner?.uid || g.ownerId || String(i),
    userId: g.ownerId || g.owner?.id || '',
    nickname: g.owner?.nickname || '—',
    username: g.owner?.username || '—',
    uid: g.owner?.uid || '—',
  })),
)

const generalBrief = computed(() => {
  const g = room.value?.general
  if (!g) return '直挂平台'
  const share = Math.round(Number(g.shareRate || 0) * 100)
  return g.username ? `${g.nickname}（占成 ${share}%）` : `${g.nickname} · 占成 ${share}%`
})

const agentBrief = computed(() => {
  const u = room.value?.ownerAgent?.user
  if (!u) return '未绑定'
  return u.username ? `${u.nickname}（${u.username}）` : `${u.nickname}（${u.uid}）`
})

const feeText = computed(() => {
  const fee = room.value?.monthlyFee
  if (!fee || fee <= 0) return '不收费'
  return `${Math.floor(fee)} / 月`
})

const sharePctText = computed(() => {
  const rate = room.value?.agentShareRate
  if (rate == null) return '—'
  const pct = rate <= 1 ? rate * 100 : rate
  return `${Math.round(pct * 10) / 10}%`
})

const bookBrief = computed(() => {
  const r = room.value
  if (!r) return '—'
  const mode = r.bookMode === 'CREDIT' ? 'B 信用盘' : 'A 现金盘'
  return `${mode} · 占成 ${sharePctText.value}`
})

const settleBrief = computed(() => {
  const c = room.value?.settleCycle
  if (c === 'MONTHLY_15_30' || c === 'MONTHLY_15' || c === 'MONTHLY_30') return '每月 15 号与月末'
  if (c === 'MONTHLY_1') return '每月 1 号'
  return '礼拜一'
})

const togglingGame = ref('')

function ovSummaryCols(n: number) {
  const cols = Math.max(1, Math.min(6, n || 1))
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
}

function stakeFlow(s?: { betFlow?: number; pendingBetFlow?: number } | null) {
  return Number(s?.betFlow || 0) + Number(s?.pendingBetFlow || 0)
}
function displayFlownFlow(s?: {
  flownBetFlow?: number
  agentFlyBetFlow?: number
  flownBetFlowLive?: number
  agentFlyBetFlowLive?: number
} | null) {
  if (isLandlordSide.value || isGeneral.value) return Number(s?.flownBetFlowLive ?? s?.flownBetFlow ?? 0)
  return Number(s?.agentFlyBetFlowLive ?? s?.agentFlyBetFlow ?? s?.flownBetFlow ?? 0)
}

/**
 * 与工作台、报表中心完全同一套六格：三个角色看到的格子数、名字、顺序一致，
 * 取数范围由后端按各自账本算好。
 */
const coreKpis = computed<KpiChip[]>(() => {
  const v = summary.value
  return [
    { label: '流水', value: fmt(stakeFlow(v)), color: 'var(--desk-accent, #38bdf8)' },
    { label: '飞盘', value: fmt(displayFlownFlow(v)), color: 'var(--desk-accent, #38bdf8)' },
    { label: '关盘', value: fmt(v?.closedBetFlow), color: CLOSED_FLOW_COLOR },
    { label: '庄家盈亏', value: fmt(v?.satHousePnl), color: pnlColor(v?.satHousePnl) },
    { label: '我的占成', value: fmt(v?.myShareAmount), color: pnlColor(v?.myShareAmount) },
    { label: '我本期净赚', value: fmt(v?.myNetEarning), color: pnlColor(v?.myNetEarning), hot: true },
  ]
})

const cashKpis = computed<KpiChip[]>(() => [
  { label: '上分合计', value: fmt(summary.value?.upAmount), color: 'var(--ops-gold)' },
  { label: '上分笔数', value: String(summary.value?.upCount ?? '—') },
  { label: '下分合计', value: fmt(summary.value?.downAmount), color: '#ef4444' },
  { label: '下分笔数', value: String(summary.value?.downCount ?? '—') },
  {
    label: '待审上分',
    value: String(summary.value?.pendingUp ?? '—'),
    color: (summary.value?.pendingUp ?? 0) > 0 ? '#ef4444' : undefined,
    hot: (summary.value?.pendingUp ?? 0) > 0,
  },
  {
    label: '待审下分',
    value: String(summary.value?.pendingDown ?? '—'),
    color: (summary.value?.pendingDown ?? 0) > 0 ? '#d97706' : undefined,
    hot: (summary.value?.pendingDown ?? 0) > 0,
  },
])

const betKpis = computed<KpiChip[]>(() => [
  { label: '注单数', value: String(summary.value?.betCount ?? '—') },
  { label: '派彩', value: fmt(summary.value?.payout) },
  { label: '玩家盈亏', value: fmt(summary.value?.playerPnl), color: pnlColor(summary.value?.playerPnl) },
  { label: '挂靠支出', value: fmt(summary.value?.commissionAmount), color: '#f59e0b' },
  { label: '未结算流水', value: fmt(summary.value?.pendingBetFlow) },
  { label: '活跃玩家', value: String(summary.value?.activePlayers ?? '—') },
])

function gamePnl(row: { housePnl?: number | null; playerPnl?: number | null }) {
  if (row.playerPnl != null) return Number(row.playerPnl)
  if (row.housePnl == null) return null
  return -Number(row.housePnl)
}

function betStatusLabel(s?: string) {
  if (s === 'WON') return '赢'
  if (s === 'LOST') return '输'
  if (s === 'PENDING') return '未结'
  if (s === 'CANCELLED' || s === 'CANCELED') return '取消'
  return s || '—'
}
function betStatusType(s?: string): 'success' | 'danger' | 'info' | 'warning' {
  if (s === 'WON') return 'success'
  if (s === 'LOST') return 'danger'
  if (s === 'PENDING') return 'warning'
  return 'info'
}

function fmt(n?: number | null) {
  if (n == null) return '—'
  return formatMoney(n)
}
function pnlColor(n?: number | null) {
  if (n == null) return '#0f172a'
  return n >= 0 ? '#67c23a' : '#f56c6c'
}
function formatDate(v?: string | null) {
  if (!v) return '—'
  return String(v).slice(0, 10)
}
function formatDt(v?: string | null) {
  if (!v) return '—'
  const s = String(v)
  if (s.length >= 16) return `${s.slice(0, 10)} ${s.slice(11, 16)}`
  return s.slice(0, 10)
}
/** 经营概况右侧流水：MM-DD HH:mm，避免撑出横向滚动 */
function formatDtShort(v?: string | null) {
  if (!v) return '—'
  const s = String(v)
  if (s.length >= 16) return `${s.slice(5, 10)} ${s.slice(11, 16)}`
  if (s.length >= 10) return s.slice(5, 10)
  return s
}

async function loadStaff() {
  if (!isAdmin.value) return
  try {
    const res = await consoleApi.agentsAll({ role: 'BRANCH', boundOnly: false })
    staffList.value = res.list.map((a) => ({
      id: a.id, uid: a.uid, username: a.username, nickname: a.nickname, role: a.role,
    }))
  } catch {
    staffList.value = []
  }
}

function regenResetPwd() {
  const arr = new Uint8Array(4)
  crypto.getRandomValues(arr)
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
  resetPwd.value = `Ag${hex}9`
}

function summaryRangeParams() {
  const params: { roomId: string; range?: string; from?: string; to?: string } = {
    roomId: id.value,
  }
  if (rangeKey.value === 'custom') {
    if (!customRange.value?.[0] || !customRange.value?.[1]) return null
    params.from = customRange.value[0]
    params.to = customRange.value[1]
  } else {
    params.range = rangeKey.value
  }
  return params
}

async function loadRoomBets() {
  if (!isAgentSide.value) {
    betRows.value = []
    betTotal.value = 0
    return
  }
  const params = summaryRangeParams()
  if (!params) return
  betLoading.value = true
  try {
    const res = await consoleApi.reportRoomBets({ ...params, page: 1, pageSize: 50 })
    betRows.value = res.list || []
    betTotal.value = res.total || 0
  } catch {
    betRows.value = []
    betTotal.value = 0
  } finally {
    betLoading.value = false
  }
}

async function loadSummary() {
  summaryLoading.value = true
  try {
    const params = summaryRangeParams()
    if (!params) {
      if (rangeKey.value === 'custom') ElMessage.warning('请选择自定义起止时间')
      return
    }
    summary.value = await consoleApi.reportSummary(params)
    await Promise.all([loadRoomBets(), loadFundPreview()])
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '加载报表失败',
    )
  } finally {
    summaryLoading.value = false
  }
}

/** 侧栏预览：跟上方汇总区间，仅最近几条 */
async function loadFundPreview() {
  const uid = room.value?.ownerAgent?.userId
  if (!uid) {
    fundRows.value = []
    return
  }
  fundLoading.value = true
  try {
    const range = summary.value?.range
    const res = await consoleApi.agentAudit(uid, {
      page: 1,
      pageSize: fundPreviewPageSize,
      tab: 'fund',
      from: range?.from,
      to: range?.to,
    })
    fundRows.value = res.list || []
  } catch {
    fundRows.value = []
  } finally {
    fundLoading.value = false
  }
}

function defaultDlgRange(): [string, string] {
  const r = summary.value?.range
  if (r?.from && r?.to) return [r.from, r.to]
  return shanghaiBoundPair(0, 1) as [string, string]
}

function openGameDetailDlg() {
  gameDlgRange.value = defaultDlgRange()
  gameDlgGameCode.value = ''
  gameDlgPage.value = 1
  gameDetailVisible.value = true
}

function openFundDetailDlg() {
  fundDlgRange.value = defaultDlgRange()
  fundDlgType.value = 'all'
  fundDlgPage.value = 1
  fundDetailVisible.value = true
}

async function loadGameDetail() {
  if (!gameDlgRange.value?.[0] || !gameDlgRange.value?.[1]) {
    ElMessage.warning('请选择日期区间')
    return
  }
  gameDlgLoading.value = true
  try {
    const from = gameDlgRange.value[0]
    const to = gameDlgRange.value[1]
    const code = gameDlgGameCode.value.trim()
    const [sum, bets] = await Promise.all([
      consoleApi.reportSummary({ roomId: id.value, from, to }),
      consoleApi.reportRoomBets({
        roomId: id.value,
        from,
        to,
        page: gameDlgPage.value,
        pageSize: gameDlgPageSize,
        gameCode: code || undefined,
      }),
    ])
    const games = sum.byGame || []
    gameDlgByGame.value = code ? games.filter((g) => g.gameCode === code) : games
    gameDlgBets.value = bets.list || []
    gameDlgBetTotal.value = bets.total || 0
  } catch (e: unknown) {
    gameDlgByGame.value = []
    gameDlgBets.value = []
    gameDlgBetTotal.value = 0
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '加载游戏明细失败',
    )
  } finally {
    gameDlgLoading.value = false
  }
}

function onGameDlgQuery() {
  gameDlgPage.value = 1
  void loadGameDetail()
}

function onGameDlgPage(p: number) {
  gameDlgPage.value = p
  void loadGameDetail()
}

async function loadFundDetail() {
  const uid = room.value?.ownerAgent?.userId
  if (!uid) return
  if (!fundDlgRange.value?.[0] || !fundDlgRange.value?.[1]) {
    ElMessage.warning('请选择日期区间')
    return
  }
  fundDlgLoading.value = true
  try {
    const res = await consoleApi.agentAudit(uid, {
      page: fundDlgPage.value,
      pageSize: fundDlgPageSize,
      tab: 'fund',
      from: fundDlgRange.value[0],
      to: fundDlgRange.value[1],
      fundType: fundDlgType.value === 'all' ? undefined : fundDlgType.value,
    })
    fundDlgRows.value = res.list || []
    fundDlgTotal.value = res.total || 0
    fundDlgTotals.value = res.fundTotals || null
  } catch (e: unknown) {
    fundDlgRows.value = []
    fundDlgTotal.value = 0
    fundDlgTotals.value = null
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '加载资金流水失败',
    )
  } finally {
    fundDlgLoading.value = false
  }
}

function onFundDlgQuery() {
  fundDlgPage.value = 1
  void loadFundDetail()
}

function onFundDlgPage(p: number) {
  fundDlgPage.value = p
  void loadFundDetail()
}

function onCustomRangeChange(val: [string, string] | null) {
  if (val?.[0] && val?.[1]) {
    loadSummary()
  }
}

async function onRangePreset() {
  if (rangeKey.value !== 'custom') {
    loadSummary()
    return
  }
  if (!customRange.value?.[0] || !customRange.value?.[1]) {
    customRange.value = shanghaiBoundPair(0, 1)
  }
  await nextTick()
  customPickerRef.value?.focus?.()
  customPickerRef.value?.handleOpen?.()
  loadSummary()
}

function syncBillingForm() {
  const r = room.value
  billingForm.monthlyFee = Math.floor(Number(r?.monthlyFee ?? 0) || 0)
  billingForm.billingDay = Math.min(28, Math.max(1, Number(r?.billingDay ?? 1) || 1))
  billingForm.nextBillAt = r?.nextBillAt ? String(r.nextBillAt).slice(0, 10) : ''
}

async function load() {
  loading.value = true
  try {
    room.value = await consoleApi.room(id.value) as RoomDetail
    syncBillingForm()
    await loadRebatePolicy()
    games.value = await consoleApi.roomGames(id.value)
    syncGameRows()
    await Promise.all([loadSummary(), loadStaff(), loadAgentOps(), loadJoinPending()])
  } catch {
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

async function loadAgentOps() {
  const uid = room.value?.ownerAgent?.userId
  if (!uid) {
    agentChildren.value = []
    csStaffRows.value = []
    return
  }
  csListLoading.value = true
  try {
    const [detail, csList] = await Promise.all([
      consoleApi.agentDetail(uid),
      consoleApi.csStaffList({ parentAgentUserId: uid }).catch(() => [] as CsStaffRow[]),
    ])
    agentChildren.value = detail.children || []
    csStaffRows.value = csList || []
  } catch {
    agentChildren.value = []
    csStaffRows.value = []
  } finally {
    csListLoading.value = false
  }
}

function goBackFromDetail() {
  // 代理侧「我的房间」会直达详情；返回列表会再次被跳转，故回工作台
  if (isAgent.value || isProxy.value) {
    router.push({ name: 'dashboard' })
    return
  }
  router.push({ name: 'rooms' })
}
function goSettleCenter() {
  const rid = room.value?.id || id.value
  router.push({ name: 'settle', query: rid ? { roomId: rid } : {} })
}
function goGeneralFromRoom() {
  const uid = room.value?.general?.userId
  if (!uid) return
  const rid = room.value?.id || id.value
  router.push({
    name: 'general-detail',
    params: { id: uid },
    query: { from: 'room', tab: 'basic', ...(rid ? { roomId: rid } : {}) },
  })
}

async function setRoomFly(flyEnabled: boolean) {
  try {
    await ElMessageBox.confirm(
      flyEnabled
        ? (room.value?.bookMode === 'CREDIT'
          ? '将把本房所有玩家飞盘设为「开」。信用盘开盘后输赢跟平台，结账按飞盘上缴+已发佣金，未结上分每周不冲；个人仍可在「玩家」页单独关掉。'
          : '将把本房所有玩家飞盘设为「开」。上盘额度大于 0 时跟平台结算；额度耗尽则软关盘只动玩家分；个人仍可在「玩家」页单独关掉。')
        : (room.value?.bookMode === 'CREDIT'
          ? '将把本房所有玩家飞盘设为「关」。信用关盘输赢跟代理，不再进平台占成；个人仍可在「玩家」页单独开启。'
          : '将把本房所有玩家飞盘设为「关」。之后只改玩家房间分，不动上盘额度；个人仍可在「玩家」页单独开启。'),
      flyEnabled ? '整房开盘' : '整房关盘',
      {
        type: 'warning',
        confirmButtonText: flyEnabled ? '确认开盘' : '确认关盘',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }
  flyBusy.value = true
  try {
    const res = await consoleApi.setRoomFly(id.value, flyEnabled)
    ElMessage.success(res.message || (flyEnabled ? '已整房开启' : '已整房关闭'))
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '操作失败',
    )
  } finally {
    flyBusy.value = false
  }
}

async function setGeneralRoomFly(flyEnabled: boolean) {
  try {
    await ElMessageBox.confirm(
      flyEnabled
        ? '将本房总代飞盘设为「开」。代理开盘的注会飞向平台；代理关盘仍由代理坐庄。'
        : '将本房总代飞盘设为「关」。代理开盘的注由总代坐庄，不再飞向平台。',
      flyEnabled ? '总代整房开盘' : '总代整房关盘',
      {
        type: 'warning',
        confirmButtonText: flyEnabled ? '确认开盘' : '确认关盘',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }
  generalFlyBusy.value = true
  try {
    const res = await consoleApi.setGeneralRoomFly(id.value, flyEnabled)
    ElMessage.success(res.message || (flyEnabled ? '已开启（飞向平台）' : '已关闭（总代坐庄）'))
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '操作失败',
    )
  } finally {
    generalFlyBusy.value = false
  }
}

async function setRoomStatus(status: string) {
  const label: Record<string, string> = {
    OPEN: '营业中（开盘）',
    MAINTENANCE: '维护中',
    FROZEN: '已冻结',
    CLOSED: '已关闭',
  }
  const tip =
    status === 'FROZEN' || status === 'CLOSED'
      ? `确认将房间设为「${label[status] || status}」？玩家将无法正常进入/游戏。`
      : `确认将房间状态改为「${label[status] || status}」？`
  try {
    await ElMessageBox.confirm(tip, '变更开盘状态', {
      type: status === 'FROZEN' || status === 'CLOSED' ? 'warning' : 'info',
      confirmButtonText: '确认变更',
    })
  } catch {
    return
  }
  statusBusy.value = true
  try {
    await consoleApi.setRoomStatus(id.value, status)
    ElMessage.success('开盘状态已更新')
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '状态更新失败',
    )
  } finally {
    statusBusy.value = false
  }
}

async function renameProxy(row: { id: string; nickname: string }) {
  try {
    const { value } = await ElMessageBox.prompt('显示名字（最多 20 字）', '改名字', {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: row.nickname || '',
      inputPattern: /^.{1,20}$/,
      inputErrorMessage: '请输入 1～20 个字',
    })
    const name = String(value || '').trim()
    if (!name) return
    await consoleApi.renameProxyNickname(row.id, name)
    ElMessage.success('已改名')
    await loadAgentOps()
  } catch (e: unknown) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '改名失败',
    )
  }
}

async function toggleProxyStatus(row: { id: string; nickname: string; status: string }) {
  const next = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  try {
    await ElMessageBox.confirm(
      next === 'DISABLED'
        ? `停用「${row.nickname}」后将无法登录。确定？`
        : `启用「${row.nickname}」？`,
      next === 'DISABLED' ? '停用子账号' : '启用子账号',
      { type: 'warning', confirmButtonText: next === 'DISABLED' ? '停用' : '启用' },
    )
  } catch {
    return
  }
  try {
    await consoleApi.setProxyStatus(row.id, next)
    ElMessage.success(next === 'DISABLED' ? '已停用' : '已启用')
    await loadAgentOps()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '操作失败',
    )
  }
}

function openResetAgentPwd() {
  regenResetPwd()
  showResetPwd.value = true
}

function resetProxyPwd(row: { id: string; nickname: string; username: string }) {
  staffResetKind.value = 'PROXY'
  proxyResetTarget.value = row
  regenProxyResetPwd()
  showProxyResetPwd.value = true
}

function regenProxyResetPwd() {
  const arr = new Uint8Array(4)
  crypto.getRandomValues(arr)
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
  proxyResetPwd.value = staffResetKind.value === 'CS' ? `Cs${hex}9` : `Px${hex}9`
}

async function doResetProxyPwd() {
  if (!proxyResetTarget.value) return
  const proxyResetErr = validateOpsPassword(proxyResetPwd.value.trim())
  if (proxyResetErr) return ElMessage.warning(proxyResetErr)
  proxyResetBusy.value = true
  try {
    const pwd = proxyResetPwd.value.trim()
    const res = staffResetKind.value === 'CS'
      ? await consoleApi.csStaffResetPassword(proxyResetTarget.value.id, pwd)
      : await consoleApi.resetProxyPassword(proxyResetTarget.value.id, pwd)
    showProxyResetPwd.value = false
    if (staffResetKind.value === 'CS') {
      resetCreds.value = { username: res.username, password: res.password }
      showResetCreds.value = true
    } else {
      proxyCreds.value = { username: res.username, password: res.password }
      showProxyCreds.value = true
    }
    ElMessage.success(res.message || '已重置')
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '重置失败',
    )
  } finally {
    proxyResetBusy.value = false
  }
}

async function toggleCsStatus(row: { id: string; nickname: string; status: string }) {
  const next = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
  try {
    await ElMessageBox.confirm(
      next === 'DISABLED'
        ? `停用「${row.nickname}」后将无法登录，并自动切到休息。确定？`
        : `启用「${row.nickname}」？`,
      next === 'DISABLED' ? '停用客服' : '启用客服',
      { type: 'warning', confirmButtonText: next === 'DISABLED' ? '停用' : '启用' },
    )
  } catch {
    return
  }
  try {
    await consoleApi.csStaffSetStatus(row.id, next)
    ElMessage.success(next === 'DISABLED' ? '已停用' : '已启用')
    await loadAgentOps()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '操作失败',
    )
  }
}

function resetCsPwd(row: { id: string; nickname: string; username: string }) {
  staffResetKind.value = 'CS'
  proxyResetTarget.value = row
  regenProxyResetPwd()
  showProxyResetPwd.value = true
}

function regenProxyPwd() {
  const arr = new Uint8Array(4)
  crypto.getRandomValues(arr)
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
  proxyForm.password = `Px${hex}9`
}

async function copyProxyCreds() {
  if (!proxyCreds.value) return
  const t = `用户名：${proxyCreds.value.username}\n密码：${proxyCreds.value.password}`
  try {
    await navigator.clipboard.writeText(t)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择')
  }
}

function fundAmtText(row: AgentAuditRow) {
  const n = Number(row.amount || 0)
  const sign = fundAmtNegative(row) ? '-' : '+'
  return `${sign}${fmt(n)}`
}

function fundAmtNegative(row: AgentAuditRow) {
  return (
    row.action === 'QUOTA_RECALL'
    || row.action === 'CONSOLE_DEBIT'
    || row.action === 'CS_STAFF_ALLOC'
  )
}

function fundAmtClass(row: AgentAuditRow) {
  return fundAmtNegative(row) ? 'down' : 'up'
}

function openAgentFund(mode: 'up' | 'down', targetId?: string) {
  const uid = targetId || room.value?.ownerAgent?.userId
  if (!uid) return
  fundTargetId.value = uid
  fundMode.value = mode
  fundAmount.value = 1000
  /* 订单号在开弹窗时定死，连点复用同一键由服务端去重 */
  fundOrderNo.value = newFundOrderNo(mode)
  fundVisible.value = true
}

async function doAgentFund() {
  if (!fundTargetId.value || fundBusy.value) return
  const amount = Number(fundAmount.value)
  if (!Number.isInteger(amount) || amount <= 0) {
    ElMessage.warning('金额须为正整数')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认给该代理${fundMode.value === 'up' ? '上分' : '下分回收'} ${formatMoney(amount)}？订单号 ${fundOrderNo.value}`,
      fundMode.value === 'up' ? '代理上分' : '代理下分',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  fundBusy.value = true
  try {
    if (room.value?.bookMode === 'CREDIT') {
      if (!id.value) return
      const res = await consoleApi.bumpCreditLimit(id.value, {
        amount,
        direction: fundMode.value === 'up' ? 'up' : 'down',
        clientRequestId: fundOrderNo.value,
      })
      ElMessage.success(res.message || (fundMode.value === 'up' ? '已上分' : '已下分'))
    } else if (fundMode.value === 'up') {
      await consoleApi.issue(fundTargetId.value, amount, fundOrderNo.value)
      ElMessage.success('已上分')
    } else {
      await consoleApi.recall(fundTargetId.value, amount, fundOrderNo.value)
      ElMessage.success('已下分回收')
    }
    fundVisible.value = false
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '失败',
    )
  } finally {
    fundBusy.value = false
  }
}

async function doCreateProxy() {
  const parentId = room.value?.ownerAgent?.userId
  if (!parentId) return
  if (!/^[a-z0-9]{8,20}$/.test(proxyForm.username.trim())) {
    ElMessage.warning('账号须 8-20 位小写字母数字')
    return
  }
  const proxyCreateErr = validateOpsPassword(proxyForm.password || '')
  if (proxyCreateErr) {
    ElMessage.warning(proxyCreateErr)
    return
  }
  const username = proxyForm.username.trim().toLowerCase()
  const password = proxyForm.password
  fundBusy.value = true
  try {
    await consoleApi.createAgent({
      role: 'PROXY',
      username,
      password,
      nickname: proxyForm.nickname.trim() || undefined,
      parentAgentUserId: parentId,
    })
    ElMessage.success('已开通子账号')
    proxyVisible.value = false
    proxyCreds.value = { username, password }
    showProxyCreds.value = true
    proxyForm.username = ''
    proxyForm.password = ''
    proxyForm.nickname = ''
    await loadAgentOps()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '失败',
    )
  } finally {
    fundBusy.value = false
  }
}

function openCreateCs() {
  resetCsForm()
  csVisible.value = true
}
function resetCsForm() {
  csForm.username = ''
  csForm.password = ''
  csForm.nickname = ''
}

async function doCreateCs() {
  const parentId = room.value?.ownerAgent?.userId
  if (!parentId) {
    ElMessage.warning('本房无绑定代理')
    return
  }
  const username = csForm.username.trim()
  if (username && !/^[a-z0-9]{8,20}$/.test(username)) {
    ElMessage.warning('用户名须 8-20 位小写字母数字')
    return
  }
  const csPwdErr = csForm.password.trim() ? validateOpsPassword(csForm.password.trim()) : null
  if (csPwdErr) {
    ElMessage.warning(csPwdErr)
    return
  }
  csBusy.value = true
  try {
    const res = await consoleApi.csStaffCreate({
      parentAgentUserId: parentId,
      username: username || undefined,
      password: csForm.password.trim() || undefined,
      nickname: csForm.nickname.trim() || undefined,
    })
    csVisible.value = false
    csCreds.value = res
    showCsCreds.value = true
    ElMessage.success('已开通客服')
    await loadAgentOps()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '开通失败',
    )
  } finally {
    csBusy.value = false
  }
}

async function copyCsCreds() {
  if (!csCreds.value) return
  const text = `用户名：${csCreds.value.username}\n密码：${csCreds.value.password}`
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选中')
  }
}

async function onSaveBilling() {
  if (billingForm.monthlyFee > 0 && !billingForm.nextBillAt) {
    return ElMessage.warning('请设置下次月费日')
  }
  savingBilling.value = true
  try {
    const res = await consoleApi.updateRoomBilling(id.value, {
      monthlyFee: billingForm.monthlyFee,
      nextBillAt: billingForm.monthlyFee > 0
        ? `${billingForm.nextBillAt}T00:00:00+08:00`
        : null,
    })
    if (room.value) {
      room.value.monthlyFee = res.monthlyFee
      room.value.nextBillAt = res.nextBillAt
      room.value.lastBilledAt = res.lastBilledAt
    }
    syncBillingForm()
    ElMessage.success('月费已更新，下期按新金额收取')
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '保存失败',
    )
  } finally {
    savingBilling.value = false
  }
}

function syncGameRows() {
  const map = new Map(games.value.map((g) => [g.gameCode, g]))
  const inherited = defaultPlayerPct.value
  gameRows.value = GAME_OPTIONS.map((opt) => {
    const cfg = map.get(opt.value)
    const rate = cfg?.rebateRate
    const rule = rebatePolicy.games.find((g) => g.gameCode === opt.value)
    const fallback = rule ? Number((rule.playerRate * 100).toFixed(2)) : inherited
    const rebatePct = rate == null || Number.isNaN(Number(rate))
      ? fallback
      : Number((Number(rate) * 100).toFixed(2))
    return {
      gameCode: opt.value,
      label: opt.label,
      enabled: cfg?.enabled ?? false,
      robotCount: cfg?.robotCount ?? 10,
      rebateRate: rate ?? null,
      rebatePct,
    }
  })
}

async function loadRebatePolicy() {
  try {
    const p = await consoleApi.rebatePolicy(room.value?.id)
    rebatePolicy.totalRate = p.chain?.effective.agentPkg
      ?? p.agentDefaultRate
      ?? 0.05
    rebatePolicy.playerMinRate = p.chain?.effective.playerMin ?? p.playerMinRate ?? 0.018
    rebatePolicy.playerMaxRate = p.chain?.effective.playerMax ?? p.playerMaxRate ?? 0.05
    rebatePolicy.agentDefaultRate = p.agentDefaultRate ?? 0.05
    rebatePolicy.agentPkg = p.chain?.effective.agentPkg
      ?? Number(room.value?.ownerAgent?.flowRate ?? p.agentDefaultRate ?? 0.05)
    rebatePolicy.games = p.games ?? []
  } catch {
    rebatePolicy.totalRate = 0.05
    rebatePolicy.playerMinRate = 0.018
    rebatePolicy.playerMaxRate = 0.05
    rebatePolicy.agentPkg = 0.05
  }
}

function openGameDetail(row: GameRow) {
  gameDlg.gameCode = row.gameCode
  gameDlg.label = row.label
  gameDlg.enabled = row.enabled
  gameDlg.robotCount = row.robotCount
  let pct = row.rebatePct ?? defaultPlayerPct.value
  if (pct < playerMinPct.value) pct = playerMinPct.value
  if (pct > playerMaxPct.value) pct = playerMaxPct.value
  gameDlg.rebatePct = pct
  showGameDlg.value = true
}

async function toggleGameEnabled(row: GameRow, enabled: boolean) {
  if (roomReadonly.value) return
  togglingGame.value = row.gameCode
  try {
    await consoleApi.patchRoomGame(id.value, row.gameCode, { enabled })
    games.value = await consoleApi.roomGames(id.value)
    syncGameRows()
    if (room.value) {
      room.value.enabledGames = games.value.filter((g) => g.enabled).map((g) => g.gameCode)
    }
    ElMessage.success(enabled ? `已开放 ${row.label}` : `已关闭 ${row.label}`)
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '操作失败',
    )
  } finally {
    togglingGame.value = ''
  }
}

async function saveGameDetail() {
  if (!gameDlg.gameCode) return
  if (rebateReadonly.value) {
    savingGame.value = true
    try {
      await consoleApi.patchRoomGame(id.value, gameDlg.gameCode, {
        enabled: gameDlg.enabled,
      })
      games.value = await consoleApi.roomGames(id.value)
      syncGameRows()
      if (room.value) {
        room.value.enabledGames = games.value.filter((g) => g.enabled).map((g) => g.gameCode)
      }
      showGameDlg.value = false
      ElMessage.success(gameDlg.enabled ? `已开放 ${gameDlg.label}` : `已关闭 ${gameDlg.label}`)
    } catch (e: unknown) {
      ElMessage.error(
        (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        || (e as Error).message
        || '保存失败',
      )
    } finally {
      savingGame.value = false
    }
    return
  }
  const pct = Number(gameDlg.rebatePct)
  if (Number.isNaN(pct)) return ElMessage.warning('请填写默认玩家回水')
  if (pct < playerMinPct.value || pct > playerMaxPct.value) {
    return ElMessage.warning(`默认玩家回水须在 ${playerMinPct.value}% ~ ${playerMaxPct.value}%`)
  }
  savingGame.value = true
  try {
    const payload: { enabled: boolean; rebateRate?: number } = {
      enabled: gameDlg.enabled,
      rebateRate: Number((pct / 100).toFixed(4)),
    }
    await consoleApi.patchRoomGame(id.value, gameDlg.gameCode, payload)
    games.value = await consoleApi.roomGames(id.value)
    syncGameRows()
    if (room.value) {
      room.value.enabledGames = games.value.filter((g) => g.enabled).map((g) => g.gameCode)
      if (room.value.ownerAgent) room.value.ownerAgent.rebateRate = payload.rebateRate
    }
    showGameDlg.value = false
    ElMessage.success(`已保存：玩家回水 ${pct}% · 代理回水 ${agentRebatePct(pct)}%`)
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '保存失败',
    )
  } finally {
    savingGame.value = false
  }
}

/** 挂总代的房整体联动，说清楚影响范围再动手 */
const visibilityScopeTip = computed(() => {
  const g = room.value?.general
  return g?.userId
    ? `本房挂在总代「${g.nickname}」名下，可见性按总代整体生效，会同时作用于该总代的全部房间。`
    : ''
})

async function onGrant() {
  if (!ownerUserId.value.trim()) return ElMessage.warning('请选择总监')
  if (visibilityScopeTip.value) {
    try {
      await ElMessageBox.confirm(visibilityScopeTip.value, '授权可见', {
        type: 'warning',
        confirmButtonText: '确认授权',
        cancelButtonText: '返回',
      })
    } catch {
      return
    }
  }
  try {
    await consoleApi.grantOwner(id.value, ownerUserId.value.trim())
    ElMessage.success('已授权可见')
    ownerUserId.value = ''
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '授权失败',
    )
  }
}

async function onRevoke(userId: string, nickname: string) {
  try {
    await ElMessageBox.confirm(
      visibilityScopeTip.value
        ? `取消后「${nickname}」将看不见该总代的全部房间。\n${visibilityScopeTip.value}`
        : `取消后「${nickname}」将看不见本房间，确定？`,
      '取消可见',
      { type: 'warning', confirmButtonText: '取消可见', cancelButtonText: '返回' },
    )
  } catch {
    return
  }
  try {
    await consoleApi.revokeOwner(id.value, userId)
    ElMessage.success('已取消可见')
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '操作失败',
    )
  }
}

async function onResetPwd() {
  const resetErr = validateOpsPassword(resetPwd.value.trim())
  if (resetErr) return ElMessage.warning(resetErr)
  resettingPwd.value = true
  try {
    const res = await consoleApi.resetAgentPassword(id.value, resetPwd.value.trim())
    showResetPwd.value = false
    resetCreds.value = { username: res.username, password: res.password }
    showResetCreds.value = true
    resetPwd.value = ''
    ElMessage.success(res.message || '已重置')
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '重置失败',
    )
  } finally {
    resettingPwd.value = false
  }
}

async function copyResetCreds() {
  if (!resetCreds.value) return
  const t = `用户名：${resetCreds.value.username}\n密码：${resetCreds.value.password}`
  try {
    await navigator.clipboard.writeText(t)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择')
  }
}

function applyTabFromQuery() {
  const q = String(route.query.tab || '')
  if (q === 'settle' && canGoSettleCenter.value) {
    tab.value = 'basic'
    const rid = String(route.params.id || '')
    void router.replace({ name: 'settle', query: rid ? { roomId: rid } : {} })
    return
  }
  if (q === 'owners' && !isAdmin.value) {
    tab.value = 'basic'
  } else if (
    q === 'basic' || q === 'agent' || q === 'overview' || q === 'players' || q === 'join'
    || q === 'billing' || q === 'games' || q === 'owners' || q === 'robots' || q === 'settle'
  ) {
    tab.value = q
  } else if (!q) {
    tab.value = 'basic'
  }
  const aid = String(route.query.agentId || '')
  if (aid) highlightAgentId.value = aid
}

function agentChildRowClass({ row }: { row: { id: string } }) {
  return highlightAgentId.value && row.id === highlightAgentId.value ? 'agent-row-hl' : ''
}

watch(tab, async (t) => {
  if (t === 'owners' && !isAdmin.value) {
    tab.value = 'basic'
    return
  }
  if (t === 'settle' && canGoSettleCenter.value) {
    goSettleCenter()
    return
  }
  if (t === 'overview') {
    loadSummary()
    void loadAgentOps()
  }
  if (t === 'billing') syncBillingForm()
  if (t === 'agent') loadAgentOps()
  if (t === 'games' || t === 'robots') {
    await loadRebatePolicy()
    syncGameRows()
  }
})

watch(
  () => [route.query.tab, route.query.agentId],
  () => { applyTabFromQuery() },
)

/* 20 秒一次的入房待审轮询，标签页藏起来就先停，切回来立刻补一次 */
function onVisibilityChange() {
  if (!document.hidden) void loadJoinPending()
}

onMounted(() => {
  applyTabFromQuery()
  void load()
  joinPollTimer = setInterval(() => {
    if (!document.hidden) void loadJoinPending()
  }, 20_000)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  if (joinPollTimer) {
    clearInterval(joinPollTimer)
    joinPollTimer = null
  }
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<style scoped src="./room-detail/room-detail.css"></style>

<style scoped>
.basic-info-hd .room-icon-preview {
  width: 36px;
  height: 36px;
  max-width: 36px;
  max-height: 36px;
  object-fit: cover;
  display: block;
}
</style>

<style src="./room-detail/room-detail-dialog.css"></style>
