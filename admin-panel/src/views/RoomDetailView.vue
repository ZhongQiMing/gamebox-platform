<template>
  <div v-loading="loading" class="room-detail">
    <PageHeader :title="room?.name || '房间详情'" :subtitle="room ? `进房码 ${room.roomNo}` : '加载中…'">
      <template #actions>
        <el-button @click="router.push({ name: 'rooms' })">返回房间中心</el-button>
        <el-button @click="load">刷新</el-button>
      </template>
    </PageHeader>

    <!-- 顶部：仅基本信息 -->
    <section v-if="room" class="basic">
      <div class="basic-left">
        <div class="code-block">
          <span class="k">进房码（固定）</span>
          <span class="code mono">{{ room.roomNo }}</span>
        </div>
        <div class="name-row">
          <h2>{{ room.name }}</h2>
          <el-tag size="small" :type="roomStatusTagType(room.status)">
            {{ roomStatusLabel(room.status) }}
          </el-tag>
        </div>
      </div>
      <div class="basic-right">
        <div class="basic-item">
          <span class="k">绑定代理</span>
          <span class="v">{{ agentBrief }}</span>
        </div>
        <div class="basic-item">
          <span class="k">月费</span>
          <span class="v">{{ feeText }}</span>
          <span v-if="room.monthlyFee && room.monthlyFee > 0" class="v-sub">
            下次扣费 {{ formatDate(room.nextBillAt) }} 00:00
          </span>
        </div>
        <div class="basic-item">
          <span class="k">成员 / 对局</span>
          <span class="v">{{ room.memberCount ?? 0 }} / {{ room.roundCount ?? 0 }}</span>
        </div>
        <div class="basic-item">
          <span class="k">创建时间</span>
          <span class="v">{{ formatDt(room.createdAt) }}</span>
        </div>
        <div class="basic-item">
          <span class="k">房间彩池</span>
          <span class="v gold">{{ fmt(poolBalance) }}</span>
          <el-button
            v-if="canFundRoomPool"
            size="small"
            type="primary"
            plain
            style="margin-top:6px"
            @click="openPoolFund"
          >注资</el-button>
        </div>
      </div>
      <div class="basic-games">
        <span class="k">开通游戏</span>
        <div class="chips" v-if="enabledGameLabels.length">
          <span v-for="g in enabledGameLabels" :key="g" class="chip">{{ g }}</span>
        </div>
        <span v-else class="muted">暂无</span>
      </div>
    </section>

    <!-- 下方 Tab：详细信息 -->
    <el-card shadow="never" class="detail-card">
      <el-tabs v-model="tab">
        <el-tab-pane label="经营概况" name="overview">
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
              <div class="ov-custom-tip">上海时间 · 左闭右开（结束时刻不含）· 可选快捷区间后点查询</div>
            </div>

            <div class="ov-range" v-if="summary?.range">
              统计区间（上海时间）
              <b>{{ summary.range.fromText || formatDt(summary.range.from) }}</b>
              ～
              <b>{{ summary.range.toText || formatDt(summary.range.to) }}</b>
              <span class="muted">左闭右开</span>
            </div>

            <section class="ov-block">
              <div class="ov-block-hd">
                <h4>输赢汇总</h4>
                <span class="ov-block-sub">净盈亏 = 庄家盈亏 − 代理佣金（多级分佣记账，非即时返水）</span>
              </div>
              <div class="ov-pnl">
                <div class="kpi hero">
                  <div class="kpi-k">净盈亏</div>
                  <div class="kpi-v" :style="{ color: pnlColor(netPnl) }">{{ fmt(netPnl) }}</div>
                </div>
                <div class="kpi-row cols-4">
                  <div class="kpi" v-for="k in pnlSideKpis" :key="k.label">
                    <div class="kpi-k">{{ k.label }}</div>
                    <div class="kpi-v" :style="{ color: k.color || undefined }">{{ k.value }}</div>
                  </div>
                </div>
              </div>
            </section>

            <div class="ov-split">
              <section class="ov-block">
                <div class="ov-block-hd">
                  <h4>资金进出</h4>
                </div>
                <div class="kpi-row cols-4">
                  <div class="kpi" v-for="k in cashKpis" :key="k.label">
                    <div class="kpi-k">{{ k.label }}</div>
                    <div class="kpi-v" :style="{ color: k.color || undefined }">{{ k.value }}</div>
                  </div>
                </div>
              </section>

              <section class="ov-block">
                <div class="ov-block-hd">
                  <h4>代理佣金与活跃</h4>
                  <span class="ov-block-sub">多级代理分佣记账；与飞盘即时返水不是同一笔账</span>
                </div>
                <div class="kpi-row cols-2">
                  <div class="kpi" v-for="k in extraKpis" :key="k.label">
                    <div class="kpi-k">{{ k.label }}</div>
                    <div class="kpi-v" :style="{ color: k.color || undefined }">{{ k.value }}</div>
                  </div>
                </div>
              </section>
            </div>

            <section class="ov-block">
              <div class="ov-block-hd">
                <h4>游戏明细</h4>
              </div>
              <el-table :data="summary?.byGame || []" stripe empty-text="该区间暂无注单" size="small">
                <el-table-column label="游戏" min-width="120">
                  <template #default="{ row }">{{ row.gameName || gameLabel(row.gameCode) }}</template>
                </el-table-column>
                <el-table-column prop="betCount" label="注单" width="90" />
                <el-table-column label="流水" min-width="120">
                  <template #default="{ row }">{{ fmt(row.betFlow) }}</template>
                </el-table-column>
                <el-table-column label="派彩" min-width="120">
                  <template #default="{ row }">{{ fmt(row.payout) }}</template>
                </el-table-column>
                <el-table-column label="庄家盈亏" min-width="120">
                  <template #default="{ row }">
                    <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
                  </template>
                </el-table-column>
              </el-table>
            </section>
          </div>
        </el-tab-pane>

        <el-tab-pane label="绑定代理" name="agent">
          <p class="agent-ops-tip">代理上下分与子账号只在此操作</p>
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
                <el-button v-if="canFundMainAgent" type="primary" size="small" @click="openAgentFund('up')">上分</el-button>
                <el-button v-if="canFundMainAgent" type="warning" size="small" @click="openAgentFund('down')">下分</el-button>
                <el-button v-if="canAddProxy" size="small" @click="proxyVisible = true">开子账号</el-button>
                <el-button
                  v-if="canResetAgentPwd"
                  size="small"
                  text
                  @click="showResetPwd = !showResetPwd"
                >{{ showResetPwd ? '收起' : '改密码' }}</el-button>
              </div>
            </div>

            <div class="money-strip">
              <div class="money-card primary">
                <div class="money-label">
                  可发额度
                  <el-tooltip placement="top" :show-after="200">
                    <template #content>
                      还能给玩家发多少真分<br />上分会加 · 发给玩家会减<br />关盘玩家输一点，额度加回一点 · 飞盘输不加
                    </template>
                    <span class="tip-q">?</span>
                  </el-tooltip>
                </div>
                <div class="money-val" :class="quotaTone(room.ownerAgent.pointsQuota)">
                  {{ fmt(room.ownerAgent.pointsQuota) }}
                </div>
              </div>
              <div class="money-card">
                <div class="money-label">
                  飞盘占用
                  <el-tooltip placement="top" :show-after="200">
                    <template #content>
                      已发给玩家、还在桌上的飞盘暴露<br />发给玩家会加 · 玩家输了或下分会减<br />占用为 0 时自动关飞盘
                    </template>
                    <span class="tip-q">?</span>
                  </el-tooltip>
                </div>
                <div class="money-val">{{ fmt(room.ownerAgent.flyCover) }}</div>
              </div>
              <div class="money-card">
                <div class="money-label">
                  代理余额
                  <el-tooltip placement="top" :show-after="200">
                    <template #content>
                      代理自己口袋（不是玩家余额）<br />上分会加 · 发给玩家会减<br />关盘输赢、返水、月费都走这里
                    </template>
                    <span class="tip-q">?</span>
                  </el-tooltip>
                </div>
                <div class="money-val gold">{{ fmt(room.ownerAgent.balance) }}</div>
              </div>
              <div class="money-card soft">
                <div class="money-label">
                  已发真分
                  <el-tooltip content="一共给玩家发过多少真分（净额）" placement="top" :show-after="200">
                    <span class="tip-q">?</span>
                  </el-tooltip>
                </div>
                <div class="money-val muted">{{ fmt(room.ownerAgent.pointsUsed) }}</div>
              </div>
            </div>

            <p class="mode-line">
              飞盘开：跟房间盘口池结算，主要动「飞盘占用」· 关盘：跟代理余额赌，玩家输一点可发额度加回一点
            </p>

            <div v-if="canSetDuty" class="duty-bar">
              <span class="duty-label">值班</span>
              <el-select
                :model-value="agentDutyUserId || ''"
                clearable
                placeholder="代理自己接"
                size="small"
                style="width: 200px"
                :loading="dutyBusy"
                @change="onDutyChange"
              >
                <el-option
                  v-for="c in agentChildren"
                  :key="c.id"
                  :label="`${c.nickname}（${c.username}）`"
                  :value="c.id"
                  :disabled="c.status !== 'ACTIVE'"
                />
              </el-select>
            </div>

            <div v-if="showResetPwd && canResetAgentPwd" class="reset-inline">
              <el-input
                v-model="resetPwd"
                placeholder="新密码至少 6 位"
                maxlength="32"
                show-password
                size="small"
                style="width: 220px"
              />
              <el-button size="small" @click="regenResetPwd">随机</el-button>
              <el-button type="primary" size="small" :loading="resettingPwd" @click="onResetPwd">确认重置</el-button>
            </div>

            <div class="agent-sec">
              <div class="agent-sec-hd">
                <span>子账号 <em>{{ agentChildren.length }}</em></span>
                <el-button v-if="canAddProxy && !agentChildren.length" link type="primary" @click="proxyVisible = true">
                  开通
                </el-button>
              </div>
              <el-table
                v-if="agentChildren.length"
                :data="agentChildren"
                stripe
                size="small"
                :row-class-name="agentChildRowClass"
              >
                <el-table-column label="名字" min-width="140">
                  <template #default="{ row }">
                    <div>
                      {{ row.nickname }}
                      <el-tag v-if="row.onDuty" size="small" type="success" effect="plain" style="margin-left:6px">值班</el-tag>
                      <el-tag v-if="highlightAgentId === row.id" size="small" type="warning" effect="plain" style="margin-left:6px">定位</el-tag>
                    </div>
                    <div class="sub">{{ row.username }}</div>
                  </template>
                </el-table-column>
                <el-table-column label="余额" width="110">
                  <template #default="{ row }">{{ fmt(row.balance) }}</template>
                </el-table-column>
                <el-table-column label="状态" width="80">
                  <template #default="{ row }">{{ row.status === 'ACTIVE' ? '正常' : '停用' }}</template>
                </el-table-column>
                <el-table-column label="" width="160">
                  <template #default="{ row }">
                    <el-button
                      link
                      type="primary"
                      @click="highlightAgentId = row.id"
                    >定位</el-button>
                    <el-button
                      v-if="canAgentFund"
                      link
                      type="primary"
                      @click="openAgentFund('up', row.id)"
                    >上分</el-button>
                    <el-button
                      v-if="canAgentFund"
                      link
                      type="warning"
                      @click="openAgentFund('down', row.id)"
                    >下分</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <div v-else class="empty-line">暂无 · 可代分上下分</div>
            </div>

            <div class="agent-sec">
              <div class="agent-sec-hd">
                <span>最近资金流水</span>
              </div>
              <el-table v-loading="fundLoading" :data="fundRows" stripe size="small" empty-text="暂无记录">
                <el-table-column label="时间" width="140">
                  <template #default="{ row }">{{ formatDt(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column label="类型" min-width="120">
                  <template #default="{ row }">{{ row.actionLabel }}</template>
                </el-table-column>
                <el-table-column label="金额" width="110">
                  <template #default="{ row }">
                    <span :class="row.action === 'QUOTA_RECALL' || row.action === 'CONSOLE_DEBIT' ? 'down' : 'up'">
                      {{ fundAmtText(row) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="操作人" min-width="120">
                  <template #default="{ row }">{{ row.operator?.nickname || '—' }}</template>
                </el-table-column>
                <el-table-column label="对方" min-width="120">
                  <template #default="{ row }">{{ row.counterparty?.nickname || '—' }}</template>
                </el-table-column>
              </el-table>
            </div>
          </template>
          <div v-else class="empty-box">该房间无专属代理（历史数据）；新房间请在创建时生成</div>
        </el-tab-pane>

        <el-tab-pane label="月费账单" name="billing">
          <el-alert
            v-if="billingNearDue"
            type="warning"
            :closable="false"
            show-icon
            style="margin-bottom:12px"
            :title="billingNearDue"
          />
          <div class="kv-grid">
            <div class="kv">
              <div class="k">月费金额</div>
              <div class="v em">{{ feeText }}</div>
            </div>
            <div class="kv">
              <div class="k">扣费规则</div>
              <div class="v">{{ feeRuleText }}</div>
            </div>
            <div class="kv">
              <div class="k">下次扣费</div>
              <div class="v">{{ formatDate(room?.nextBillAt) }}</div>
            </div>
            <div class="kv">
              <div class="k">上次扣费</div>
              <div class="v">{{ formatDt(room?.lastBilledAt) }}</div>
            </div>
          </div>
          <div v-if="canEditBilling" class="sub-block" style="margin-top:0;padding-top:0;border-top:none">
            <div class="sub-title">调整月费</div>
            <el-form label-width="100px" style="max-width:480px">
              <el-form-item label="月费金额">
                <el-input-number v-model="billingForm.monthlyFee" :min="0" :max="10000000" :precision="0" :step="1" />
              </el-form-item>
              <el-form-item v-if="billingForm.monthlyFee > 0" label="扣费日">
                <el-input-number v-model="billingForm.billingDay" :min="1" :max="28" />
              </el-form-item>
              <el-form-item v-if="billingForm.monthlyFee > 0" label="下次扣费">
                <el-date-picker
                  v-model="billingForm.nextBillAt"
                  type="date"
                  placeholder="选择日期"
                  value-format="YYYY-MM-DD"
                  style="width:180px"
                />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" :loading="savingBilling" @click="onSaveBilling">保存调整</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <el-tab-pane v-if="isAdmin || ownerRows.length" label="可见房主" name="owners">
          <el-alert
            type="info"
            :closable="false"
            show-icon
            style="margin-bottom:12px"
            title="只有列表里的房主能看见并管理本房。去掉后立即不可见。超管始终可见全部房间。"
          />
          <div v-if="ownerRows.length" class="owner-list">
            <div v-for="o in ownerRows" :key="o.key" class="owner-item">
              <div>
                <div class="owner-name">{{ o.nickname }}</div>
                <div class="owner-meta">
                  <span>账号 {{ o.username }}</span>
                  <span>UID {{ o.uid }}</span>
                </div>
              </div>
              <el-button
                v-if="isAdmin && o.userId"
                link
                type="danger"
                @click="onRevoke(o.userId, o.nickname)"
              >取消可见</el-button>
            </div>
          </div>
          <div v-else class="empty-box">
            尚未授权任何房主（仅超管可见）
          </div>

          <div v-if="isAdmin" class="sub-block">
            <div class="sub-title">授权房主可见</div>
            <el-form label-width="100px" style="max-width:480px">
              <el-form-item label="选择房主">
                <el-select
                  v-model="ownerUserId"
                  filterable
                  clearable
                  placeholder="请选择房主账号"
                  style="width:100%"
                >
                  <el-option
                    v-for="a in branchOptions"
                    :key="a.id"
                    :label="`${a.nickname}（${a.uid}）`"
                    :value="a.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="onGrant">授权可见</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>

        <el-tab-pane label="游戏设置" name="games">
          <div class="games-toolbar">
            <div class="games-summary">
              本房已开放 <b>{{ openGameCount }}</b> / {{ gameRows.length }} 款
            </div>
            <div class="games-policy">
              回水总额 T = {{ pctText(rebatePolicy.totalRate) }}（平台规则）
              · 默认玩家 P = {{ pctText(agentDefaultRebate) }}（未单独设置的玩家按此）
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
                <el-tag size="small" :type="row.enabled ? 'success' : 'info'" effect="plain">
                  {{ row.enabled ? '已开放' : '已关闭' }}
                </el-tag>
              </div>

              <div class="gr-stats">
                <div class="gr-stat">
                  <span class="gk">机器人</span>
                  <span class="gv">{{ row.enabled ? row.robotCount : '—' }}</span>
                </div>
                <div class="gr-stat">
                  <span class="gk">总额 T</span>
                  <span class="gv">{{ row.enabled ? pctText(rebatePolicy.totalRate) : '—' }}</span>
                </div>
                <div class="gr-stat">
                  <span class="gk">默认 P</span>
                  <span class="gv">{{ row.enabled ? `${row.rebatePct}%` : '—' }}</span>
                </div>
                <div class="gr-stat">
                  <span class="gk">代理 A</span>
                  <span class="gv gold">{{ row.enabled ? `${agentRebatePct(row.rebatePct)}%` : '—' }}</span>
                </div>
              </div>

              <div class="gr-action">
                <el-button @click="openGameDetail(row)">{{ roomReadonly ? '查看' : '详情' }}</el-button>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane v-if="isAgent || isProxy" label="玩家" name="players">
          <PlayersPanel :room-id="id" />
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog
      v-model="showGameDlg"
      :title="gameDlg.label ? `游戏设置 · ${gameDlg.label}` : '游戏设置'"
      width="480px"
      align-center
      destroy-on-close
      class="game-dlg"
    >
      <el-alert
        v-if="roomReadonly"
        type="info"
        :closable="false"
        show-icon
        title="代分账号只读：可查看配置，修改请使用代理主账号"
        style="margin-bottom:12px"
      />
      <div class="gd-section">
        <div class="gd-sec-h">基础</div>
        <div class="gd-basic">
          <div class="gd-basic-item">
            <div class="gd-k">对本房开放</div>
            <el-switch v-model="gameDlg.enabled" active-text="开放" inactive-text="关闭" :disabled="roomReadonly" />
          </div>
          <div class="gd-basic-item">
            <div class="gd-k">氛围机器人</div>
            <el-input-number
              v-model="gameDlg.robotCount"
              :min="0"
              :max="50"
              :disabled="!gameDlg.enabled || roomReadonly"
            />
          </div>
        </div>
      </div>

      <div class="gd-section" :class="{ dim: !gameDlg.enabled }">
        <div class="gd-sec-h">
          回水分配
          <span class="gd-sec-tip">默认 P 写入房主代理；玩家列表可再单独覆盖</span>
        </div>

        <div class="gd-metrics">
          <div class="gd-metric">
            <div class="gd-metric-k">总额 T</div>
            <div class="gd-metric-v">{{ pctText(rebatePolicy.totalRate) }}</div>
          </div>
          <div class="gd-metric main">
            <div class="gd-metric-k">默认玩家 P</div>
            <div class="gd-metric-edit">
              <el-input-number
                v-model="gameDlg.rebatePct"
                :min="playerMinPct"
                :max="playerMaxPct"
                :step="0.1"
                :precision="2"
                :disabled="!gameDlg.enabled || roomReadonly"
                controls-position="right"
                size="small"
              />
              <span class="unit">%</span>
            </div>
            <div class="gd-metric-range">{{ playerMinPct }}% ~ {{ playerMaxPct }}%</div>
          </div>
          <div class="gd-metric">
            <div class="gd-metric-k">代理 A</div>
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
          <div class="gd-ex-label">举例（流水 10,000）</div>
          <div class="gd-ex-nums">
            <span>玩家 <b>{{ examplePlayer }}</b></span>
            <span>代理 <b>{{ exampleAgent }}</b></span>
            <span>合计 <b>{{ exampleTotal }}</b></span>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="showGameDlg = false">{{ roomReadonly ? '关闭' : '取消' }}</el-button>
        <el-button v-if="!roomReadonly" type="primary" :loading="savingGame" @click="saveGameDetail">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showResetCreds" title="密码已重置" width="420px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon style="margin-bottom:12px">
        请立即复制交给代理，此密码仅展示一次
      </el-alert>
      <div v-if="resetCreds" class="cred-box">
        <div class="cred-row"><span>用户名</span><b>{{ resetCreds.username }}</b></div>
        <div class="cred-row"><span>新密码</span><b>{{ resetCreds.password }}</b></div>
      </div>
      <template #footer>
        <el-button type="primary" @click="copyResetCreds">复制</el-button>
        <el-button @click="showResetCreds = false">我已保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="fundVisible"
      :title="fundMode === 'up' ? '上分（可发额度 + 代理余额一起加）' : '下分（从可发额度与代理余额扣回）'"
      width="400px"
      destroy-on-close
    >
      <el-form label-width="72px">
        <el-form-item label="金额">
          <el-input-number v-model="fundAmount" :min="1" :max="10000000" style="width:100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fundVisible = false">取消</el-button>
        <el-button :type="fundMode === 'up' ? 'primary' : 'warning'" :loading="fundBusy" @click="doAgentFund">
          确认{{ fundMode === 'up' ? '上分' : '下分' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="poolDlg" title="房间彩池注资" width="420px" destroy-on-close align-center>
      <p class="dialog-hint">从你的账户转入本房间盘口池，供飞盘开启时房间侧结算使用。</p>
      <el-form label-position="top">
        <el-form-item label="当前彩池">
          <b class="gold">{{ fmt(poolBalance) }}</b>
        </el-form-item>
        <el-form-item label="注资金额" required>
          <el-input-number v-model="poolAmount" :min="1" :precision="2" style="width:100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="poolRemark" maxlength="40" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="poolDlg = false">取消</el-button>
        <el-button type="primary" :loading="poolSaving" @click="doPoolFund">确认注资</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="proxyVisible" title="开通子账号" width="420px" destroy-on-close>
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
        <el-button type="primary" :loading="fundBusy" @click="doCreateProxy">确认开通</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showProxyCreds" title="子账号已开通" width="420px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" show-icon style="margin-bottom:12px">
        请立即复制交给值班/代分人员，此密码仅展示一次
      </el-alert>
      <div v-if="proxyCreds" class="cred-box">
        <div class="cred-row"><span>用户名</span><b>{{ proxyCreds.username }}</b></div>
        <div class="cred-row"><span>密码</span><b>{{ proxyCreds.password }}</b></div>
      </div>
      <template #footer>
        <el-button type="primary" @click="copyProxyCreds">复制</el-button>
        <el-button @click="showProxyCreds = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  consoleApi,
  type AgentAuditRow,
  type AgentDetail,
  type ReportSummary,
  type RoomGameCfg,
} from '@/api/console'
import { useAdminStore } from '@/stores/admin'
import PageHeader from '@/components/PageHeader.vue'
import PlayersPanel from '@/views/PlayersPanel.vue'
import {
  GAME_OPTIONS, gameLabel, roomStatusLabel, roomStatusTagType,
} from '@/utils/labels'

type RoomDetail = {
  id?: string
  roomNo?: string
  name?: string
  status?: string
  enabledGames?: string[]
  monthlyFee?: number
  billingDay?: number
  nextBillAt?: string | null
  lastBilledAt?: string | null
  createdAt?: string
  memberCount?: number
  roundCount?: number
  ownerAgent?: {
    agentId?: string
    userId?: string
    balance?: number | null
    pointsQuota?: number
    pointsUsed?: number
    flyCover?: number
    rebateRate?: number | null
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

type StaffOpt = { id: string; uid: string; nickname: string; role: string }

const route = useRoute()
const router = useRouter()
const store = useAdminStore()
const id = computed(() => String(route.params.id))
const isAdmin = computed(() => store.profile?.role === 'ADMIN')
const isAgent = computed(() => store.profile?.role === 'AGENT')
const isProxy = computed(() => store.profile?.role === 'PROXY')
/** 代分：房间信息只读 */
const roomReadonly = computed(() => isProxy.value)
const canResetAgentPwd = computed(() => store.profile?.role === 'ADMIN' || store.profile?.role === 'BRANCH')
const canEditBilling = computed(() => store.profile?.role === 'ADMIN' || store.profile?.role === 'BRANCH')
const canFundMainAgent = computed(() => {
  const me = store.profile?.role
  return me === 'ADMIN' || me === 'BRANCH'
})
const canFundRoomPool = computed(() => store.profile?.role === 'ADMIN' || store.profile?.role === 'BRANCH')
const poolBalance = ref(0)
const poolDlg = ref(false)
const poolAmount = ref(1000)
const poolRemark = ref('')
const poolSaving = ref(false)
const canAgentFund = computed(() => {
  const me = store.profile?.role
  return me === 'ADMIN' || me === 'BRANCH' || me === 'AGENT'
})
const canAddProxy = computed(() => {
  if (!room.value?.ownerAgent?.userId) return false
  const me = store.profile?.role
  if (me === 'ADMIN' || me === 'BRANCH') return true
  return me === 'AGENT' && room.value.ownerAgent.userId === store.profile?.id
})
/** 值班仅代理本人可设 */
const canSetDuty = computed(() => {
  if (store.profile?.role !== 'AGENT') return false
  return !!room.value?.ownerAgent?.userId
    && room.value.ownerAgent.userId === store.profile?.id
})

const loading = ref(false)
const summaryLoading = ref(false)
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
const tab = ref('overview')
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
const agentDutyUserId = ref<string | null>(null)
const dutyBusy = ref(false)
const staffList = ref<StaffOpt[]>([])
const agentChildren = ref<AgentDetail['children']>([])
const fundRows = ref<AgentAuditRow[]>([])
const fundLoading = ref(false)
const fundVisible = ref(false)
const fundMode = ref<'up' | 'down'>('up')
const fundAmount = ref(1000)
const fundTargetId = ref('')
const fundBusy = ref(false)
const proxyVisible = ref(false)
const proxyForm = reactive({ username: '', password: '', nickname: '' })
const showGameDlg = ref(false)
const savingGame = ref(false)
const rebatePolicy = reactive({ totalRate: 0.05, playerMinRate: 0.018 })

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

const playerMinPct = computed(() => Number((rebatePolicy.playerMinRate * 100).toFixed(2)))
const playerMaxPct = computed(() => Number(((rebatePolicy.totalRate / 2) * 100).toFixed(2)))
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
  Math.round(exampleFlow * rebatePolicy.totalRate * 100) / 100,
)

const playerBarWidth = computed(() => {
  const t = rebatePolicy.totalRate * 100
  if (t <= 0) return '0%'
  const p = Math.min(Number(gameDlg.rebatePct) || 0, t)
  return `${(p / t) * 100}%`
})
const agentBarWidth = computed(() => {
  const t = rebatePolicy.totalRate * 100
  if (t <= 0) return '0%'
  const a = Math.max(0, t - (Number(gameDlg.rebatePct) || 0))
  return `${(a / t) * 100}%`
})

function pctText(rate: number) {
  return `${(Number(rate || 0) * 100).toFixed(2)}%`
}
function agentRebatePct(playerPct: number) {
  const t = Number((rebatePolicy.totalRate * 100).toFixed(2))
  const p = Number(playerPct || 0)
  return Number(Math.max(0, t - p).toFixed(2))
}

const branchOptions = computed(() => staffList.value.filter((a) => a.role === 'BRANCH'))

const enabledGameLabels = computed(() => {
  const codes = room.value?.enabledGames?.length
    ? room.value.enabledGames
    : games.value.filter((g) => g.enabled).map((g) => g.gameCode)
  return codes.map((c) => gameLabel(c))
})

const ownerRows = computed(() =>
  (room.value?.ownerGrants || []).map((g, i) => ({
    key: g.owner?.uid || g.ownerId || String(i),
    userId: g.ownerId || g.owner?.id || '',
    nickname: g.owner?.nickname || '—',
    username: g.owner?.username || '—',
    uid: g.owner?.uid || '—',
  })),
)

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

const feeRuleText = computed(() => {
  if (!room.value?.monthlyFee || room.value.monthlyFee <= 0) return '—'
  return `每月 ${room.value.billingDay || 1} 日 上海 0 点`
})

function quotaTone(n?: number | null) {
  const v = Number(n || 0)
  if (v <= 0) return 'tone-danger'
  if (v < 100) return 'tone-warn'
  return ''
}

/** 3 天内到期或余额不足提示 */
const billingNearDue = computed(() => {
  const fee = Number(room.value?.monthlyFee || 0)
  if (fee <= 0 || !room.value?.nextBillAt) return ''
  const next = new Date(room.value.nextBillAt).getTime()
  if (Number.isNaN(next)) return ''
  const days = (next - Date.now()) / DAY_MS
  if (days > 3) return ''
  if (days < 0) return `月费已过期未扣成功，房间可能被冻结；请尽快上分（月费 ${Math.floor(fee)}）`
  if (days <= 1) return `明天将扣月费 ${Math.floor(fee)}，请确认代理余额充足`
  return `${Math.ceil(days)} 天内将扣月费 ${Math.floor(fee)}，请确认代理余额充足`
})

const netPnl = computed(() => {
  const house = summary.value?.housePnl
  const commission = summary.value?.commissionAmount
  if (house == null && commission == null) return null
  return Number(house ?? 0) - Number(commission ?? 0)
})

const pnlSideKpis = computed(() => [
  { label: '庄家盈亏', value: fmt(summary.value?.housePnl), color: pnlColor(summary.value?.housePnl) },
  { label: '玩家盈亏', value: fmt(summary.value?.playerPnl), color: pnlColor(summary.value?.playerPnl) },
  { label: '流水合计', value: fmt(summary.value?.betFlow) },
  { label: '派彩合计', value: fmt(summary.value?.payout) },
])

const cashKpis = computed(() => [
  { label: '上分合计', value: fmt(summary.value?.upAmount), color: '#d4a93c' },
  { label: '上分笔数', value: String(summary.value?.upCount ?? '—') },
  { label: '下分合计', value: fmt(summary.value?.downAmount), color: '#f56c6c' },
  { label: '下分笔数', value: String(summary.value?.downCount ?? '—') },
  { label: '待审上分', value: String(summary.value?.pendingUp ?? '—') },
  { label: '待审下分', value: String(summary.value?.pendingDown ?? '—') },
  { label: '资金净变动', value: fmt(summary.value?.netChange), color: pnlColor(summary.value?.netChange) },
  { label: '房间成员', value: String(summary.value?.playerCount ?? room.value?.memberCount ?? '—') },
])

const extraKpis = computed(() => [
  { label: '代理佣金', value: fmt(summary.value?.commissionAmount), color: '#e6a23c' },
  { label: '佣金笔数', value: String(summary.value?.commissionCount ?? '—') },
  { label: '活跃玩家', value: String(summary.value?.activePlayers ?? '—') },
  { label: '注单数', value: String(summary.value?.betCount ?? '—') },
])

function fmt(n?: number | null) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
}
function pnlColor(n?: number | null) {
  if (n == null) return '#303133'
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

async function loadStaff() {
  if (!isAdmin.value) return
  try {
    const res = await consoleApi.agents({ page: 1, pageSize: 200, role: 'BRANCH', boundOnly: false })
    staffList.value = res.list.map((a) => ({
      id: a.id, uid: a.uid, nickname: a.nickname, role: a.role,
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

async function loadSummary() {
  summaryLoading.value = true
  try {
    const params: { roomId: string; range?: string; from?: string; to?: string } = {
      roomId: id.value,
    }
    if (rangeKey.value === 'custom') {
      if (!customRange.value?.[0] || !customRange.value?.[1]) {
        ElMessage.warning('请选择自定义起止时间')
        return
      }
      params.from = customRange.value[0]
      params.to = customRange.value[1]
    } else {
      params.range = rangeKey.value
    }
    summary.value = await consoleApi.reportSummary(params)
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

function onCustomRangeChange(val: [string, string] | null) {
  if (val?.[0] && val?.[1]) loadSummary()
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
    await loadSummary()
    await loadStaff()
    await loadAgentOps()
    await loadPool()
  } catch {
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

async function loadPool() {
  try {
    const res = await consoleApi.roomPool(id.value) as { balance?: number }
    poolBalance.value = Number(res?.balance ?? 0)
  } catch {
    poolBalance.value = 0
  }
}

function openPoolFund() {
  poolAmount.value = 1000
  poolRemark.value = ''
  poolDlg.value = true
}

async function doPoolFund() {
  if (!(poolAmount.value > 0)) return ElMessage.warning('请填写注资金额')
  poolSaving.value = true
  try {
    const res = await consoleApi.fundRoom(id.value, poolAmount.value, poolRemark.value || undefined) as {
      poolBalance?: number
    }
    poolBalance.value = Number(res?.poolBalance ?? poolBalance.value)
    ElMessage.success('房间彩池已注资')
    poolDlg.value = false
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '注资失败')
  } finally {
    poolSaving.value = false
  }
}

async function loadAgentOps() {
  const uid = room.value?.ownerAgent?.userId
  if (!uid) {
    agentChildren.value = []
    fundRows.value = []
    agentDutyUserId.value = null
    return
  }
  fundLoading.value = true
  try {
    const [detail, audit] = await Promise.all([
      consoleApi.agentDetail(uid),
      consoleApi.agentAudit(uid, { page: 1, pageSize: 15, tab: 'fund' }),
    ])
    agentChildren.value = detail.children || []
    agentDutyUserId.value = detail.dutyUserId || null
    fundRows.value = audit.list || []
  } catch {
    agentChildren.value = []
    fundRows.value = []
    agentDutyUserId.value = null
  } finally {
    fundLoading.value = false
  }
}

async function onDutyChange(val: string | null) {
  const root = room.value?.ownerAgent?.userId
  if (!root) return
  dutyBusy.value = true
  try {
    await consoleApi.setCsDuty(root, val || null)
    agentDutyUserId.value = val || null
    ElMessage.success(val ? '已设值班' : '已清值班（代理自己接）')
    await loadAgentOps()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data?.message
      || (e as Error).message
      || '设置失败',
    )
  } finally {
    dutyBusy.value = false
  }
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
  if (row.action === 'QUOTA_RECALL' || row.action === 'CONSOLE_DEBIT') return `-${fmt(n)}`
  if (row.action === 'QUOTA_SELL' || row.action === 'CONSOLE_CREDIT') return `+${fmt(n)}`
  return fmt(n)
}

function openAgentFund(mode: 'up' | 'down', targetId?: string) {
  const uid = targetId || room.value?.ownerAgent?.userId
  if (!uid) return
  fundTargetId.value = uid
  fundMode.value = mode
  fundAmount.value = 1000
  fundVisible.value = true
}

async function doAgentFund() {
  if (!fundTargetId.value) return
  fundBusy.value = true
  try {
    if (fundMode.value === 'up') {
      await consoleApi.issue(fundTargetId.value, fundAmount.value)
      ElMessage.success('已上分')
    } else {
      await consoleApi.recall(fundTargetId.value, fundAmount.value)
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
  if ((proxyForm.password || '').length < 6) {
    ElMessage.warning('密码至少 6 位')
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

async function onSaveBilling() {
  if (billingForm.monthlyFee > 0 && !billingForm.nextBillAt) {
    return ElMessage.warning('请设置下次扣费日期')
  }
  savingBilling.value = true
  try {
    const res = await consoleApi.updateRoomBilling(id.value, {
      monthlyFee: billingForm.monthlyFee,
      billingDay: billingForm.billingDay,
      nextBillAt: billingForm.monthlyFee > 0
        ? `${billingForm.nextBillAt}T00:00:00+08:00`
        : null,
    })
    if (room.value) {
      room.value.monthlyFee = res.monthlyFee
      room.value.billingDay = res.billingDay
      room.value.nextBillAt = res.nextBillAt
      room.value.lastBilledAt = res.lastBilledAt
    }
    syncBillingForm()
    ElMessage.success('月费已更新，下期按新金额扣费')
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
  const fallback = defaultPlayerPct.value
  gameRows.value = GAME_OPTIONS.map((opt) => {
    const cfg = map.get(opt.value)
    const rate = cfg?.rebateRate
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
    const p = await consoleApi.rebatePolicy()
    rebatePolicy.totalRate = p.totalRate ?? 0.05
    rebatePolicy.playerMinRate = p.playerMinRate ?? 0.018
  } catch {
    rebatePolicy.totalRate = 0.05
    rebatePolicy.playerMinRate = 0.018
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

async function saveGameDetail() {
  if (!gameDlg.gameCode) return
  const pct = Number(gameDlg.rebatePct)
  if (Number.isNaN(pct)) return ElMessage.warning('请填写默认玩家回水')
  if (pct < playerMinPct.value || pct > playerMaxPct.value) {
    return ElMessage.warning(`默认玩家回水须在 ${playerMinPct.value}% ~ ${playerMaxPct.value}%`)
  }
  savingGame.value = true
  try {
    const rebateRate = Number((pct / 100).toFixed(4))
    await consoleApi.patchRoomGame(id.value, gameDlg.gameCode, {
      enabled: gameDlg.enabled,
      robotCount: Number(gameDlg.robotCount || 0),
      rebateRate,
    })
    games.value = await consoleApi.roomGames(id.value)
    syncGameRows()
    if (room.value) {
      room.value.enabledGames = games.value.filter((g) => g.enabled).map((g) => g.gameCode)
      if (room.value.ownerAgent) room.value.ownerAgent.rebateRate = rebateRate
    }
    showGameDlg.value = false
    ElMessage.success(`已保存默认 P ${pct}%（代理份额 ${agentRebatePct(pct)}%）；玩家可在列表单独改`)
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

async function onGrant() {
  if (!ownerUserId.value.trim()) return ElMessage.warning('请选择房主')
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
      `取消后「${nickname}」将看不见本房间，确定？`,
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
  if (resetPwd.value.trim().length < 6) return ElMessage.warning('密码至少 6 位')
  try {
    await ElMessageBox.confirm(
      '重置后旧密码立即失效，代理需用新密码重新登录。是否继续？',
      '重置代理密码',
      { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  resettingPwd.value = true
  try {
    const res = await consoleApi.resetAgentPassword(id.value, resetPwd.value.trim())
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
  if (q === 'agent' || q === 'overview' || q === 'billing' || q === 'games' || q === 'owners' || q === 'players') {
    tab.value = q
  }
  const aid = String(route.query.agentId || '')
  if (aid) highlightAgentId.value = aid
}

function agentChildRowClass({ row }: { row: { id: string } }) {
  return highlightAgentId.value && row.id === highlightAgentId.value ? 'agent-row-hl' : ''
}

watch(tab, async (t) => {
  if (t === 'overview') loadSummary()
  if (t === 'billing') syncBillingForm()
  if (t === 'agent') loadAgentOps()
  if (t === 'games') {
    await loadRebatePolicy()
    syncGameRows()
  }
})

watch(
  () => [route.query.tab, route.query.agentId],
  () => { applyTabFromQuery() },
)

onMounted(() => {
  applyTabFromQuery()
  void load()
})
</script>

<style scoped src="./room-detail/room-detail.css"></style>

<style src="./room-detail/room-detail-dialog.css"></style>
