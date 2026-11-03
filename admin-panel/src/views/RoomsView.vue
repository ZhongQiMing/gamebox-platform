<template>
  <div class="desk-work rooms-page" v-loading="loading">
    <div class="desk-panel">
      <PageHeader title="房间中心">
        <template #actions>
          <el-button v-if="!redirecting" :loading="loading" @click="load">刷新</el-button>
          <el-button v-if="canCreate" type="primary" @click="openCreate">创建房间</el-button>
        </template>
      </PageHeader>

      <div v-if="!redirecting" class="rooms-summary">
        <template v-if="!isAgentSide">
          <div class="sum-chip">
            <span class="sum-label">房间</span>
            <span class="sum-val">{{ roomStats.total }}</span>
          </div>
          <div class="sum-chip">
            <span class="sum-label">营业中</span>
            <span class="sum-val ok">{{ roomStats.open }}</span>
          </div>
          <div class="sum-chip">
            <span class="sum-label">A 现金盘</span>
            <span class="sum-val">{{ roomStats.cash }}</span>
          </div>
          <div class="sum-chip">
            <span class="sum-label">B 信用盘</span>
            <span class="sum-val warn">{{ roomStats.credit }}</span>
          </div>
          <div class="sum-chip" :class="{ hot: roomStats.alert > 0 }">
            <span class="sum-label">需关注</span>
            <span class="sum-val" :class="{ hot: roomStats.alert > 0 }">{{ roomStats.alert }}</span>
          </div>
        </template>
        <div class="sum-chip hot">
          <span class="sum-label">今日流水</span>
          <span class="sum-val">{{ fmtMoney(flowTotals.betFlow) }}</span>
        </div>
        <div v-if="!isAdminOrBranch" class="sum-chip">
          <span class="sum-label">飞盘</span>
          <span class="sum-val">{{ fmtMoney(flowTotals.flown) }}</span>
        </div>
        <div v-if="!isAdminOrBranch" class="sum-chip">
          <span class="sum-label">关盘</span>
          <span class="sum-val">{{ fmtMoney(flowTotals.closed) }}</span>
        </div>
      </div>

      <div v-if="!isAgentSide" class="panel-toolbar">
        <el-input
          v-model="keyword"
          clearable
          size="small"
          placeholder="搜进房码 / 房间名 / 代理账号 / 总代账号"
          class="filter-search"
        />
        <el-select v-model="statusFilter" clearable size="small" placeholder="全部状态" class="filter-status">
          <el-option label="营业中" value="OPEN" />
          <el-option label="维护中" value="MAINTENANCE" />
          <el-option label="已冻结" value="FROZEN" />
          <el-option v-if="includeClosed" label="已关闭" value="CLOSED" />
        </el-select>
        <el-select v-model="bookFilter" clearable size="small" placeholder="全部盘口" class="filter-book">
          <el-option label="A 现金盘" value="CASH" />
          <el-option label="B 信用盘" value="CREDIT" />
        </el-select>
        <el-select
          v-if="!isGeneralUser"
          v-model="generalFilter"
          clearable
          size="small"
          placeholder="全部总代"
          class="filter-book"
        >
          <el-option label="未挂总代" value="none" />
          <el-option
            v-for="g in generalOptions"
            :key="g.userId"
            :label="`${g.nickname}${g.username ? `（${g.username}）` : ''}`"
            :value="g.userId"
          />
        </el-select>
        <el-checkbox v-if="isAdminOrBranch" v-model="includeClosed" @change="load">
          显示已关闭
        </el-checkbox>
      </div>
      <div v-if="isAgentSide && !loading && !redirecting && filteredList.length === 0" class="agent-empty">
        暂无绑定房间
      </div>

      <div v-else-if="!redirecting && narrow && grouped" class="panel-body room-cards">
        <section v-for="g in generalGroups" :key="g._key" class="general-card">
          <header class="general-card__hd">
            <div class="general-card__who">
              <div class="cell-name">{{ rowTitle(g) }}</div>
              <div class="cell-meta">
                {{ rowChain(g) }}
                <template v-if="g.userId"> · 占成 {{ Math.round(Number(g.shareRate || 0) * 100) }}%</template>
              </div>
            </div>
            <div class="general-card__nums">
              <span>流水 {{ fmtMoney(g.stats.betFlow) }}</span>
              <span :style="{ color: pnlColor(g.stats.housePnl) }">盈亏 {{ fmtMoney(g.stats.housePnl) }}</span>
              <button v-if="g.userId" type="button" class="card-link" @click="goGeneral(g.userId)">总代详情</button>
            </div>
          </header>
          <button
            v-for="room in g.children"
            :key="room.id"
            type="button"
            class="room-card"
            @click="goDetail(room.id)"
          >
            <div>
              <div class="cell-name">{{ room.name }}</div>
              <div class="cell-meta">{{ room.roomNo }} · 代理 {{ room.agent?.nickname || '未绑定' }}</div>
            </div>
            <div class="room-card__side">
              <span>{{ roomStatusLabel(room.status) }}</span>
              <span>流水 {{ fmtMoney(room.todayStats?.betFlow) }}</span>
              <span :style="{ color: pnlColor(room.todayStats?.housePnl) }">{{ fmtMoney(room.todayStats?.housePnl) }}</span>
            </div>
          </button>
        </section>
      </div>
      <div v-else-if="!redirecting && narrow" class="panel-body room-cards">
        <button
          v-for="room in flatRooms"
          :key="room.id"
          type="button"
          class="room-card"
          @click="goDetail(room.id)"
        >
          <div>
            <div class="cell-name">{{ room.name }}</div>
            <div class="cell-meta">{{ room.roomNo }} · 代理 {{ room.agent?.nickname || '未绑定' }}</div>
            <div v-if="room.general" class="cell-meta">总代 {{ room.general.nickname }}</div>
          </div>
          <div class="room-card__side">
            <span>{{ roomStatusLabel(room.status) }}</span>
            <span>流水 {{ fmtMoney(room.todayStats?.betFlow) }}</span>
            <span :style="{ color: pnlColor(room.todayStats?.housePnl) }">{{ fmtMoney(room.todayStats?.housePnl) }}</span>
          </div>
        </button>
      </div>
      <div v-else-if="!redirecting" class="panel-body">
        <el-table
          ref="roomsTableRef"
          :data="displayList"
          v-loading="loading"
          class="rooms-table"
          :class="{ 'chain-table': grouped }"
          empty-text="暂无房间"
          :stripe="!grouped"
          border
          size="small"
          height="100%"
          row-key="_key"
          :tree-props="{ children: 'children' }"
          :indent="8"
          default-expand-all
          :row-class-name="rowClassName"
          @row-click="onGroupRowClick"
        >
          <el-table-column label="链路" min-width="280">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ rowTitle(row) }}</div>
              <div class="cell-meta">
                {{ rowChain(row) }}
                <button
                  v-if="!row._group"
                  type="button"
                  class="copy-chip"
                  @click.stop="copyText(row.roomNo)"
                >复制</button>
              </div>
            </template>
          </el-table-column>
          <el-table-column v-if="grouped" label="下级" min-width="140">
            <template #default="{ row }: { row: any }">
              <span class="count-line">{{ rowCountText(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" min-width="118">
            <template #default="{ row }: { row: any }">
              <span v-if="row._group" class="muted">营业 {{ row.openCount }} / {{ row.children.length }}</span>
              <div v-else class="status-cell">
                <el-tag size="small" :type="roomStatusTagType(row.status)" effect="light">
                  {{ roomStatusLabel(row.status) }}
                </el-tag>
                <div v-if="roomAlerts(row).length" class="alert-row">
                  <el-tag
                    v-for="a in roomAlerts(row).slice(0, 2)"
                    :key="a.text"
                    size="small"
                    :type="a.type"
                    effect="plain"
                  >{{ a.text }}</el-tag>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="成员" min-width="88" align="right">
            <template #default="{ row }: { row: any }">
              <template v-if="row._group">
                <div class="stat-val group-stat">{{ row.stats.memberCount }}</div>
                <div v-if="row.stats.activePlayers" class="sub">今日 {{ row.stats.activePlayers }} 人下注</div>
              </template>
              <template v-else>
                <div>{{ row.memberCount }}</div>
                <div v-if="row.todayStats?.activePlayers" class="sub">今日 {{ row.todayStats.activePlayers }} 人</div>
              </template>
            </template>
          </el-table-column>
          <el-table-column label="今日流水" min-width="120" align="right">
            <template #default="{ row }: { row: any }">
              <span
                class="stat-val"
                :class="{ 'group-stat': row._group }"
                :style="{ color: 'var(--desk-accent, #38bdf8)' }"
              >{{ fmtMoney(rowStats(row).betFlow) }}</span>
              <!-- 三个角色同一套措辞：飞＝我飞给上家的，关＝我自己坐庄的 -->
              <div v-if="!row._group && !isAdminOrBranch" class="sub">
                飞 {{ fmtMoney(row.todayStats?.flownBetFlow) }}
                · <span class="closed-flow">关 {{ fmtMoney(row.todayStats?.closedBetFlow) }}</span>
              </div>
              <div v-if="!row._group && Number(row.todayStats?.pendingBetFlow || 0)" class="sub">
                未开奖 {{ fmtMoney(row.todayStats.pendingBetFlow) }}
              </div>
            </template>
          </el-table-column>
          <el-table-column label="庄家盈亏" min-width="100" align="right">
            <template #default="{ row }: { row: any }">
              <span
                class="stat-val"
                :class="{ 'group-stat': row._group }"
                :style="{ color: pnlColor(rowStats(row).housePnl) }"
              >{{ fmtMoney(rowStats(row).housePnl) }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="!isAgentSide && !grouped && !isGeneralUser" label="总代" min-width="120">
            <template #default="{ row }: { row: any }">
              <template v-if="row.general">
                <div class="agent-name">{{ row.general.nickname }}</div>
                <div class="sub">{{ row.general.username }} · 占成 {{ Math.round(Number(row.general.shareRate || 0) * 100) }}%</div>
              </template>
              <span v-else class="muted">直挂平台</span>
            </template>
          </el-table-column>
          <el-table-column v-if="!isAgentSide" label="代理" min-width="128">
            <template #default="{ row }: { row: any }">
              <span v-if="row._group" class="muted">—</span>
              <template v-else-if="row.agent">
                <div class="agent-name">{{ row.agent.nickname }}</div>
                <div class="sub">{{ row.agent.username }}</div>
              </template>
              <span v-else class="muted">未绑定</span>
            </template>
          </el-table-column>
          <el-table-column label="盘口合同" min-width="148">
            <template #default="{ row }: { row: any }">
              <div v-if="row._group" class="book-cell">
                <template v-if="row.userId">
                  <el-tag size="small" :type="row.bookMode === 'CREDIT' ? 'warning' : 'success'" effect="plain">
                    {{ row.bookMode === 'CREDIT' ? 'B · 信用盘' : 'A · 现金盘' }}
                  </el-tag>
                  <div class="sub">占成 {{ Math.round(Number(row.shareRate || 0) * 100) }}%</div>
                </template>
                <span v-else class="muted">—</span>
              </div>
              <div v-else class="book-cell">
                <el-tag size="small" :type="row.bookMode === 'CREDIT' ? 'warning' : 'success'" effect="plain">
                  {{ row.bookMode === 'CREDIT' ? 'B · 信用盘' : 'A · 现金盘' }}
                </el-tag>
                <div class="sub">占成 {{ sharePct(row) }}% · {{ settleShort(row) }}</div>
                <div v-if="row.bookMode === 'CREDIT'" class="sub">合同额度 {{ fmtMoney(row.creditLimit) }}</div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="月费" min-width="120">
            <template #default="{ row }: { row: any }">
              <span v-if="row._group" class="muted">—</span>
              <template v-else-if="row.monthlyFee > 0">
                <div :class="billDueSoon(row) ? 'warn-text' : 'fee'">{{ Math.floor(row.monthlyFee) }}/月</div>
                <div class="sub">{{ formatDate(row.nextBillAt) }}</div>
              </template>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" :width="canStatus || canDelete ? 220 : 72" fixed="right">
            <template #default="{ row }: { row: any }">
              <div v-if="row._group" class="ops" @click.stop>
                <el-button v-if="row.userId" link type="primary" @click="goGeneral(row.userId)">详情</el-button>
                <span v-else class="muted">—</span>
              </div>
              <div v-else class="ops" @click.stop>
                <el-button link type="primary" @click="goDetail(row.id)">详情</el-button>
                <el-dropdown v-if="canStatus && row.status !== 'CLOSED'" trigger="click">
                  <el-button link type="primary">状态</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item @click="onStatus(row.id, 'OPEN')">营业中</el-dropdown-item>
                      <el-dropdown-item @click="onStatus(row.id, 'MAINTENANCE')">维护中</el-dropdown-item>
                      <el-dropdown-item @click="onStatus(row.id, 'FROZEN')">已冻结</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-button
                  v-if="canDelete && row.status !== 'CLOSED'"
                  link
                  type="danger"
                  @click="onDelete(row)"
                >删除</el-button>
                <el-button
                  v-if="canDelete && row.status === 'CLOSED'"
                  link
                  type="danger"
                  @click="onPurge(row)"
                >彻底删除</el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <DeskDialog
      v-model="showCreate"
      title="创建房间"
      subtitle="设置向导"
      width="920px"
      variant="bare"
    >
      <div class="win-body">
        <aside class="win-nav">
          <button
            v-for="(t, i) in createTabs"
            :key="t.key"
            type="button"
            class="win-nav-item"
            :class="{
              active: createTab === t.key,
              done: i < createTabIndex,
              locked: i > createMaxStep,
            }"
            :disabled="i > createMaxStep"
            @click="goCreateTab(t.key)"
          >
            <span class="win-nav-idx">{{ t.idx }}</span>
            <b>{{ t.title }}</b>
          </button>
        </aside>
        <div class="win-content">
          <el-form label-width="92px" label-position="right" class="create-form" size="default">
            <template v-if="createTab === 'basic'">
              <div class="win-pane-title">基本信息</div>
              <div class="form-row2">
                <el-form-item label="进房码" required>
                  <div class="row-inline">
                    <el-input
                      v-model="form.roomNo"
                      placeholder="6 位数字进房码"
                      maxlength="6"
                      inputmode="numeric"
                      @input="onRoomNoInput"
                    />
                    <el-button @click="regenRoomNo">随机</el-button>
                  </div>
                </el-form-item>
                <el-form-item label="房间名称" required>
                  <el-input
                    v-model="form.name"
                    placeholder="例如：一号厅"
                    maxlength="40"
                    @blur="suggestAgentUsername"
                  />
                </el-form-item>
              </div>
              <el-form-item label="房间图标">
                <div class="create-icon-row">
                  <img class="create-icon-preview" :src="form.iconPreview || roomIconUrl(null)" alt="房间图标预览">
                  <div class="create-icon-actions">
                    <el-button size="small" @click="pickCreateIcon">选择图片</el-button>
                    <el-button v-if="form.iconImage" size="small" text type="danger" @click="clearCreateIcon">恢复默认</el-button>
                  </div>
                  <input
                    ref="createIconInput"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    @change="onCreateIconPicked"
                  >
                </div>
              </el-form-item>
              <el-form-item label="初始状态">
                <el-radio-group v-model="form.status">
                  <el-radio-button label="OPEN">营业中</el-radio-button>
                  <el-radio-button label="MAINTENANCE">维护中</el-radio-button>
                  <el-radio-button label="FROZEN">已冻结</el-radio-button>
                </el-radio-group>
              </el-form-item>
            </template>

            <template v-else-if="createTab === 'book'">
              <div class="win-pane-title">盘口、流水与占成</div>
              <el-form-item v-if="!isGeneralUser" label="挂靠总代">
                <el-select
                  v-model="form.generalAgentUserId"
                  clearable
                  filterable
                  placeholder="可不挂，直接归平台"
                  class="field-control"
                  style="width:100%"
                  @change="onGeneralPicked"
                >
                  <el-option
                    v-for="g in generalList"
                    :key="g.id"
                    :label="`${g.nickname}（流水 ${pctNum(g.flowRate)}% · 占成 ${pctNum(g.shareRate)}%）`"
                    :value="g.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="盘口类型" required>
                <el-radio-group v-model="form.bookMode">
                  <el-radio-button label="CASH">A · 现金盘</el-radio-button>
                  <el-radio-button label="CREDIT">B · 信用盘</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <div class="form-row2">
                <el-form-item label="代理流水" required>
                  <div class="row-inline">
                    <el-input-number
                      v-model="form.agentFlowPercent"
                      :min="agentFlowMin"
                      :max="agentFlowMax"
                      :step="0.1"
                      :precision="1"
                      controls-position="right"
                      class="field-control"
                    />
                    <span class="field-unit">%</span>
                  </div>
                </el-form-item>
                <el-form-item label="代理占成" required>
                  <div class="row-inline">
                    <el-input-number
                      v-model="form.agentSharePercent"
                      :min="0"
                      :max="agentShareMax"
                      :precision="0"
                      controls-position="right"
                      class="field-control"
                    />
                    <span class="field-unit">%</span>
                  </div>
                </el-form-item>
              </div>
              <div class="create-note">
                上限 流水 {{ agentFlowMax }}% · 占成 {{ agentShareMax }}%，{{ capSourceText }}。
              </div>
              <el-form-item v-if="form.bookMode === 'CREDIT'" label="合同额度" required>
                <el-input-number
                  v-model="form.creditLimit"
                  :min="1"
                  :max="100000000"
                  :precision="0"
                  :step="1000"
                  controls-position="right"
                  class="field-control"
                />
              </el-form-item>
              <div v-if="form.bookMode === 'CREDIT'" class="create-note">
                <template v-if="hungToGeneral">
                  建房时<b>从总代的剩余信用里划出</b>这笔额度给本房代理。
                  总代额度不够也照划，会变成负数——那就是他超发，结账时找他要。
                </template>
                <template v-else>
                  直挂房由<b>平台直接授信</b>，不扣任何人的额度。
                </template>
              </div>
              <el-form-item label="结账日" required>
                <el-select v-model="form.settleCycle" class="field-control" style="width:100%">
                  <el-option label="礼拜一" value="WEEKLY_MON" />
                  <el-option label="每月 15 号与月末" value="MONTHLY_15_30" />
                  <el-option label="每月 1 号" value="MONTHLY_1" />
                </el-select>
                <div class="create-note" style="margin-top:6px">
                  本房代理跟<b>{{ hungToGeneral ? '总代' : '平台' }}</b>按这个周期结账。
                  <template v-if="hungToGeneral">
                    总代跟平台另有自己的账期，互不影响。
                  </template>
                </div>
              </el-form-item>
            </template>

            <template v-else-if="createTab === 'agent'">
              <div class="win-pane-title">绑定代理</div>
              <div class="form-row2">
                <el-form-item label="用户名" required>
                  <div class="row-inline">
                    <el-input v-model="form.agentUsername" placeholder="8-20 位小写字母数字" maxlength="20" />
                    <el-button @click="regenUsername">随机</el-button>
                  </div>
                </el-form-item>
                <el-form-item label="密码" required>
                  <div class="row-inline">
                    <el-input v-model="form.agentPassword" :placeholder="OPS_PASSWORD_HINT" maxlength="32" show-password />
                    <el-button @click="regenPassword">随机</el-button>
                  </div>
                </el-form-item>
              </div>
              <el-form-item label="昵称">
                <el-input v-model="form.agentNickname" placeholder="默认：代理+uid后四位" maxlength="24" />
              </el-form-item>
              <template v-if="isAdmin">
                <div class="win-pane-title" style="margin-top:18px">可见总监</div>
                <!--
                  挂总代的房不按房设可见性，整块藏掉比摆一个锁死的勾选框清楚：
                  留着只会让人以为「这里还是能设的，只是这次不行」。
                -->
                <el-form-item v-if="form.generalAgentUserId" label="可见范围">
                  <div class="muted" style="line-height:1.5">
                    本房挂了总代，可见性由该总代统一决定——他对哪些总监可见，名下所有房间就对哪些总监可见，
                    不能按房单独关。要改请到「账号中心 → 该总代详情 → 可见总监」，那里一改名下所有房跟着变。
                  </div>
                </el-form-item>
                <el-form-item v-else label="授权总监">
                  <el-checkbox-group
                    v-if="branchList.length"
                    v-model="form.ownerUserIds"
                    class="check-grid"
                  >
                    <el-checkbox v-for="a in branchList" :key="a.id" :value="a.id">
                      {{ a.nickname }}
                    </el-checkbox>
                  </el-checkbox-group>
                  <span v-else class="muted">暂无总监账号</span>
                </el-form-item>
              </template>
            </template>

            <template v-else-if="createTab === 'games'">
              <div class="win-pane-title">游戏与机器人</div>
              <el-form-item label="开通游戏" required>
                <el-checkbox-group v-model="form.enabledGames" class="check-grid">
                  <el-checkbox v-for="g in GAME_OPTIONS" :key="g.value" :value="g.value">
                    {{ g.label }}
                  </el-checkbox>
                </el-checkbox-group>
              </el-form-item>
              <el-form-item label="机器人托">
                <div class="robot-default-tip">
                  <ul>
                    <li>6 点–10 点：3–8 人</li>
                    <li>10 点–12 点：5–12 人</li>
                    <li>12 点–18 点：25–35 人</li>
                    <li>18 点–24 点：40–50 人</li>
                    <li>0 点–6 点：35–45 人</li>
                  </ul>
                </div>
              </el-form-item>
            </template>

            <template v-else-if="createTab === 'billing'">
              <div class="win-pane-title">月费账单</div>
              <div class="form-row2">
                <el-form-item label="月费金额">
                  <div class="row-inline">
                    <el-input-number
                      v-model="form.monthlyFee"
                      :min="roomFeeFloor"
                      :max="10000000"
                      :precision="0"
                      :step="1"
                      controls-position="right"
                      class="field-control"
                    />
                    <span v-if="roomFeeFloor > 0" class="field-unit">最低 {{ roomFeeFloor }}</span>
                  </div>
                </el-form-item>
                <el-form-item label="首次月费日">
                  <el-date-picker
                    v-model="form.billStartDate"
                    type="date"
                    placeholder="默认建房当天"
                    value-format="YYYY-MM-DD"
                    class="field-control"
                    @change="onBillStartChange"
                  />
                </el-form-item>
              </div>
            </template>

            <template v-else>
              <div class="win-pane-title">确认创建</div>
              <el-alert type="warning" :closable="false" show-icon class="mb12">
                <template #title>建好之后这几件事就已经发生了，不能撤回</template>
                <ul class="create-warn-list">
                  <li>会开出一个<b>真的代理账号</b>，密码只在建完那一次显示</li>
                  <li v-if="form.bookMode === 'CREDIT' && hungToGeneral">
                    会从总代「{{ pickedGeneralName }}」的剩余信用里
                    <b>划走 {{ form.creditLimit }}</b> 作为本房期初额度（额度不够会变成负数，即他超发）
                  </li>
                  <li v-else-if="form.bookMode === 'CREDIT'">
                    平台直接给本房代理 <b>{{ form.creditLimit }}</b> 期初信用额度，不扣任何人
                  </li>
                  <li v-if="hungToGeneral">
                    平台从<b>今天起</b>按每间房单价向总代收月费
                  </li>
                  <li>房间号建好后不可更改</li>
                </ul>
              </el-alert>

              <el-descriptions :column="2" border size="small" class="create-review">
                <el-descriptions-item label="进房码">{{ form.roomNo || '—' }}</el-descriptions-item>
                <el-descriptions-item label="房间名称">{{ form.name || '—' }}</el-descriptions-item>
                <el-descriptions-item label="挂靠">
                  <el-tag v-if="hungToGeneral" size="small" type="warning">
                    总代 · {{ pickedGeneralName }}
                  </el-tag>
                  <el-tag v-else size="small">直挂平台</el-tag>
                </el-descriptions-item>
                <el-descriptions-item label="盘口">
                  {{ form.bookMode === 'CREDIT' ? 'B · 信用盘' : 'A · 现金盘' }}
                </el-descriptions-item>
                <el-descriptions-item label="代理流水">{{ form.agentFlowPercent }}%</el-descriptions-item>
                <el-descriptions-item label="代理占成">{{ form.agentSharePercent }}%</el-descriptions-item>
                <el-descriptions-item v-if="form.bookMode === 'CREDIT'" label="合同额度">
                  {{ form.creditLimit }}
                </el-descriptions-item>
                <el-descriptions-item label="结账">
                  {{ settleCycleText }} · 跟{{ hungToGeneral ? '总代' : '平台' }}结
                </el-descriptions-item>
                <el-descriptions-item label="代理账号">
                  <span class="mono">{{ form.agentUsername || '—' }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="月费">
                  {{ form.monthlyFee > 0 ? `${form.monthlyFee} / 月` : '不收' }}
                  <span class="muted">（{{ hungToGeneral ? '交总代' : '交平台' }}）</span>
                </el-descriptions-item>
                <el-descriptions-item label="开通游戏">
                  {{ form.enabledGames.length }} / {{ GAME_OPTIONS.length }} 款
                </el-descriptions-item>
                <el-descriptions-item label="可见总监">{{ visibilityText }}</el-descriptions-item>
              </el-descriptions>
            </template>
          </el-form>
        </div>
      </div>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button v-if="createTab !== 'basic'" @click="prevCreateTab">上一步</el-button>
        <el-button v-if="createTab !== 'review'" type="primary" @click="nextCreateTab">下一步</el-button>
        <el-button v-else type="primary" :loading="saving" @click="onCreate">确认创建</el-button>
      </template>
    </DeskDialog>

    <DeskDialog
      v-model="showCreds"
      title="代理账号已创建"
      width="440px"
      :close-on-click-modal="false"
    >
      <el-alert type="warning" :closable="false" show-icon class="cred-alert">
        密码仅展示一次，请立即复制交给代理
      </el-alert>
      <div class="cred-box" v-if="createdCreds">
        <div class="cred-row"><span>房间</span><b>{{ createdCreds.roomName }}</b></div>
        <div class="cred-row"><span>盘口</span><b>{{ createdCreds.bookLabel }}</b></div>
        <div class="cred-row"><span>占成</span><b>{{ createdCreds.shareLabel }}</b></div>
        <div class="cred-row"><span>进房码</span><b>{{ createdCreds.roomNo }}</b></div>
        <div class="cred-row"><span>用户名</span><b>{{ createdCreds.username }}</b></div>
        <div class="cred-row"><span>密码</span><b>{{ createdCreds.password }}</b></div>
      </div>
      <template #footer>
        <el-button @click="showCreds = false">我已保存</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" @click="copyCreds">复制账号密码</el-button>
      </template>
    </DeskDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { formatMoney, formatShanghaiDate, isGeneralSide, OPS_PASSWORD_HINT, validateOpsPassword } from '@gamebox/shared'
import PageHeader from '@/components/PageHeader.vue'
import DeskDialog from '@/components/DeskDialog.vue'
import { consoleApi, type ConsoleRoom, type WalletMe } from '@/api/console'
import { useAdminStore } from '@/stores/admin'
import { roomIconUrl } from '@/utils/roomIcon'
import {
  GAME_OPTIONS, roomStatusLabel, roomStatusTagType,
} from '@/utils/labels'

type StaffOpt = {
  id: string
  uid: string
  nickname: string
  role: string
  flowRate?: number
  shareRate?: number
  pendingShareRate?: number | null
  pendingShareFrom?: string | Date | null
  downlineFlowRate?: number
  bookMode?: string
  /** 平台向该总代收的每间房月费单价；也是名下房间月费的下限 */
  roomMonthlyFee?: number
}
type CreateTabKey = 'basic' | 'book' | 'agent' | 'games' | 'billing' | 'review'
type AlertTag = { text: string; type: 'danger' | 'warning' | 'info' }

const store = useAdminStore()
const router = useRouter()
const roomsTableRef = ref<{ toggleRowExpansion: (row: unknown) => void } | null>(null)
const list = ref<ConsoleRoom[]>([])
const staffList = ref<StaffOpt[]>([])
/** 总代登录时的自身档案：费率决定建房表单上限，额度用于提示 */
const myGeneral = ref<WalletMe | null>(null)
const loading = ref(false)
const redirecting = ref(false)
const showCreate = ref(false)
const showCreds = ref(false)
const saving = ref(false)
const keyword = ref('')
const statusFilter = ref('')
const bookFilter = ref('')
const generalFilter = ref('')
const includeClosed = ref(false)
const createTab = ref<CreateTabKey>('basic')
const createMaxStep = ref(0)
const createdCreds = ref<{
  roomName: string
  roomNo: string
  username: string
  password: string
  bookLabel: string
  shareLabel: string
} | null>(null)

const allGameCodes = GAME_OPTIONS.map((g) => g.value)
const createTabs = [
  { key: 'basic' as const, idx: '1', title: '基本信息' },
  { key: 'book' as const, idx: '2', title: '盘口占成' },
  { key: 'agent' as const, idx: '3', title: '绑定代理' },
  { key: 'games' as const, idx: '4', title: '游戏机器人' },
  { key: 'billing' as const, idx: '5', title: '月费账单' },
  /* 建房会开真账号、扣总代额度，都是不可撤回的，最后一步先摆出来对一遍 */
  { key: 'review' as const, idx: '6', title: '确认创建' },
]
const createTabOrder = createTabs.map((t) => t.key)
const createTabIndex = computed(() => createTabOrder.indexOf(createTab.value))

const form = reactive({
  roomNo: '',
  name: '',
  agentUsername: '',
  agentPassword: '',
  agentNickname: '',
  ownerUserIds: [] as string[],
  generalAgentUserId: '' as string,
  enabledGames: [...allGameCodes] as string[],
  status: 'OPEN',
  monthlyFee: 0,
  billingDay: 1,
  billStartDate: '' as string,
  bookMode: 'CASH' as 'CASH' | 'CREDIT',
  agentFlowPercent: 5,
  agentSharePercent: 50,
  settleCycle: 'WEEKLY_MON' as 'WEEKLY_MON' | 'MONTHLY_1' | 'MONTHLY_15_30',
  creditLimit: 100000,
  iconImage: '' as string,
  iconPreview: '' as string,
})

const isAdmin = computed(() => store.profile?.role === 'ADMIN')
const isAdminOrBranch = computed(() => {
  const r = store.profile?.role
  return r === 'ADMIN' || r === 'BRANCH'
})
const isGeneralUser = computed(() => isGeneralSide(store.profile?.role, store.profile?.parentRole))
const isAgentSide = computed(() => {
  const r = store.profile?.role
  if (r === 'AGENT') return true
  if (r === 'PROXY' && !isGeneralUser.value) return list.value.length <= 1
  return false
})
const canCreate = computed(() => isAdminOrBranch.value || isGeneralUser.value)
const flowTotals = computed(() => {
  let betFlow = 0
  let flown = 0
  let closed = 0
  for (const r of list.value) {
    const s = r.todayStats
    if (!s) continue
    betFlow += Number(s.betFlow || 0)
    flown += Number(s.flownBetFlow || 0)
    closed += Number(s.closedBetFlow || 0)
  }
  return { betFlow, flown, closed }
})

const canDelete = computed(() => isAdmin.value)
const canStatus = computed(() => {
  const r = store.profile?.role
  return r === 'ADMIN' || r === 'BRANCH' || isGeneralUser.value || r === 'AGENT'
})
const branchList = computed(() => staffList.value.filter((a) => a.role === 'BRANCH'))
const generalList = computed(() => staffList.value.filter((a) => a.role === 'GENERAL'))
const generalOptions = computed(() => {
  const map = new Map<string, { userId: string; nickname: string; username?: string }>()
  for (const r of list.value) {
    if (r.general?.userId) {
      map.set(r.general.userId, {
        userId: r.general.userId,
        nickname: r.general.nickname,
        username: r.general.username,
      })
    }
  }
  return [...map.values()].sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh-CN'))
})
const pickedGeneral = computed(() =>
  generalList.value.find((g) => g.id === form.generalAgentUserId) || null,
)
function pctNum(n?: number | null) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Number(((v > 1 ? v : v * 100)).toFixed(1))
}
const rebateBounds = reactive({
  agentMin: 1.8,
  agentMax: 7,
  agentDefault: 5,
})
const agentFlowMin = computed(() => rebateBounds.agentMin)
function generalShareCapPct(g?: { shareRate?: number; pendingShareRate?: number | null } | null) {
  const live = Math.round(pctNum(g?.shareRate) || 50)
  const pending = g?.pendingShareRate == null ? null : Math.round(pctNum(g.pendingShareRate))
  const cap = pending == null ? live : Math.min(live, pending)
  return Math.min(70, cap)
}

/* 总代自己建房时，上限是他自己的成数与整包；后端也按这两个值卡 */
const agentShareMax = computed(() => {
  if (isGeneralUser.value) return generalShareCapPct(myGeneral.value)
  const g = pickedGeneral.value
  if (!g) return 50
  return generalShareCapPct(g)
})
const agentFlowMax = computed(() => {
  const platMax = rebateBounds.agentMax
  if (isGeneralUser.value) {
    return Math.min(platMax, pctNum(myGeneral.value?.flowRate) || platMax)
  }
  const g = pickedGeneral.value
  if (!g) return platMax
  return Math.min(platMax, pctNum(g.flowRate) || platMax)
})
/**
 * 挂总代的房，月费下限 = 平台给该总代定的每间房单价。
 * 低于它总代每月要倒贴差额，所以后端直接拒；直挂房没有这层，下限是 0。
 */
const roomFeeFloor = computed(() => {
  const g = isGeneralUser.value ? myGeneral.value : pickedGeneral.value
  return Math.max(0, Math.floor(Number(g?.roomMonthlyFee ?? 0) || 0))
})

/* ── 确认页用的几个说明文案 ── */
const hungToGeneral = computed(() => isGeneralUser.value || !!form.generalAgentUserId)
const pickedGeneralName = computed(() => {
  if (isGeneralUser.value) return store.profile?.nickname || '本人'
  return pickedGeneral.value?.nickname || '—'
})
const settleCycleText = computed(() => {
  const map: Record<string, string> = {
    WEEKLY_MON: '每周一',
    MONTHLY_1: '每月 1 号',
    MONTHLY_15_30: '每月 15 号与月末',
  }
  return map[form.settleCycle] || form.settleCycle
})
/** 可见范围：挂总代跟着总代那份名单，直挂房才看这里勾了谁 */
const visibilityText = computed(() => {
  if (hungToGeneral.value) return '跟随该总代的可见总监名单'
  if (!isAdmin.value) return '全部总监可见'
  const picked = form.ownerUserIds.length
  if (!picked) return '无总监可见（仅管理直管）'
  if (picked === branchList.value.length) return `全部 ${picked} 位总监可见`
  return `${picked} 位总监可见`
})
/** 流水/占成上限的来路，写在输入框旁边，别让人猜为什么是这个数 */
const capSourceText = computed(() => {
  const g = isGeneralUser.value ? myGeneral.value : pickedGeneral.value
  if (!g) return `平台上限 ${agentFlowMax.value}% / 50%`
  const cap = generalShareCapPct(g)
  const pending = g.pendingShareRate == null ? '' : `，下期 ${pctNum(g.pendingShareRate)}%`
  return `不超过总代（整包 ${pctNum(g.flowRate)}% · 成数 ${cap}%${pending}）`
})

const filteredList = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  const st = statusFilter.value
  const book = bookFilter.value
  const gf = generalFilter.value
  const rows = list.value.filter((r) => {
    if (st && r.status !== st) return false
    if (book && (r.bookMode || 'CASH') !== book) return false
    if (gf === 'none' && r.general) return false
    if (gf && gf !== 'none' && r.general?.userId !== gf) return false
    if (!q) return true
    const hay = [
      r.roomNo, r.name,
      r.agent?.nickname, r.agent?.username, r.agent?.uid,
      r.general?.nickname, r.general?.username,
    ].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
  return [...rows].sort((a, b) => {
    const ga = a.general?.nickname || '～未挂'
    const gb = b.general?.nickname || '～未挂'
    const c = ga.localeCompare(gb, 'zh-CN')
    if (c !== 0) return c
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
  })
})

/*
 * 管理/总监：按总代分组成两级，父节点是总代，展开是名下房间。
 * 总代登录只看自己名下房间，不再套一层总代父项。
 * 房间代理侧只有自己那几间，分组反而多一层，保持平铺。
 */
const grouped = computed(() => isAdminOrBranch.value)
const narrow = ref(false)
let narrowQuery: MediaQueryList | null = null
function syncNarrow() {
  narrow.value = narrowQuery?.matches ?? window.innerWidth <= 720
}
const generalGroups = computed(() =>
  displayList.value.filter((row): row is GroupRow => Boolean((row as GroupRow)._group)),
)
const flatRooms = computed(() =>
  displayList.value.filter((row): row is ConsoleRoom & { _key: string } => !(row as GroupRow)._group),
)

type GroupRow = {
  _key: string
  _group: true
  userId: string | null
  nickname: string
  bookMode?: string
  shareRate?: number
  openCount: number
  stats: { betFlow: number; housePnl: number; memberCount: number; activePlayers: number }
  children: (ConsoleRoom & { _key: string })[]
}

function aggregateRoomStats(children: ConsoleRoom[]) {
  let betFlow = 0
  let housePnl = 0
  let memberCount = 0
  let activePlayers = 0
  for (const r of children) {
    memberCount += Number(r.memberCount || 0)
    const s = r.todayStats
    if (!s) continue
    betFlow += Number(s.betFlow || 0)
    housePnl += Number(s.housePnl || 0)
    activePlayers += Number(s.activePlayers || 0)
  }
  return { betFlow, housePnl, memberCount, activePlayers }
}

function rowStats(row: GroupRow | ConsoleRoom) {
  if ((row as GroupRow)._group) return (row as GroupRow).stats
  const s = (row as ConsoleRoom).todayStats
  return {
    betFlow: Number(s?.betFlow || 0),
    housePnl: Number(s?.housePnl || 0),
    memberCount: Number((row as ConsoleRoom).memberCount || 0),
    activePlayers: Number(s?.activePlayers || 0),
  }
}

const displayList = computed((): Array<GroupRow | (ConsoleRoom & { _key: string })> => {
  const rows = filteredList.value.map((r) => ({ ...r, _key: `room:${r.id}` }))
  if (!grouped.value) return rows

  const selfId = isGeneralUser.value
    ? (store.profile?.role === 'GENERAL' ? store.profile.id : store.profile?.parentId || '')
    : ''
  const groups = new Map<string, GroupRow>()
  for (const r of rows) {
    const key = r.general?.userId || (selfId || '__none__')
    let g = groups.get(key)
    if (!g) {
      g = {
        _key: `general:${key}`,
        _group: true,
        userId: r.general?.userId ?? (selfId || null),
        nickname: r.general?.nickname || store.profile?.nickname || '直挂平台（未挂总代）',
        bookMode: generalBookOf(r.general?.userId || selfId),
        shareRate: r.general?.shareRate,
        openCount: 0,
        stats: { betFlow: 0, housePnl: 0, memberCount: 0, activePlayers: 0 },
        children: [],
      }
      groups.set(key, g)
    }
    g.children.push(r)
    if (r.status === 'OPEN') g.openCount += 1
  }
  for (const g of groups.values()) {
    g.stats = aggregateRoomStats(g.children)
  }
  /* 未挂总代的那一组固定排最后 */
  return [...groups.values()].sort((a, b) => {
    if (!a.userId) return 1
    if (!b.userId) return -1
    return a.nickname.localeCompare(b.nickname, 'zh-CN')
  })
})

function generalBookOf(userId?: string | null) {
  if (!userId) return undefined
  const fromStaff = staffList.value.find((s) => s.id === userId)?.bookMode
  if (fromStaff) return fromStaff
  if (isGeneralUser.value) return myGeneral.value?.bookMode
  return undefined
}

function rowClassName({ row }: { row: GroupRow | ConsoleRoom }) {
  if ((row as GroupRow)._group) {
    return (row as GroupRow).userId ? 'is-general is-fold' : 'is-group is-fold'
  }
  return 'is-child'
}

function onGroupRowClick(row: GroupRow | ConsoleRoom, _col: unknown, ev: Event) {
  if ((ev.target as HTMLElement | null)?.closest?.('.el-table__expand-icon, .ops, .copy-chip, button, a')) return
  if (!(row as GroupRow)._group) return
  roomsTableRef.value?.toggleRowExpansion(row)
}

function rowTitle(row: GroupRow | ConsoleRoom) {
  if ((row as GroupRow)._group) {
    const g = row as GroupRow
    return g.userId ? `总代 · ${g.nickname}` : `直挂平台（${g.children.length}）`
  }
  return (row as ConsoleRoom).name
}

function rowChain(row: GroupRow | ConsoleRoom) {
  if ((row as GroupRow)._group) {
    const g = row as GroupRow
    if (!g.userId) return '平台直对代理，不经总代'
    const book = g.bookMode === 'CREDIT' ? '信用盘' : '现金盘'
    return `平台 → 总代${g.nickname} · ${book}`
  }
  const r = row as ConsoleRoom
  const agent = r.agent?.nickname ? `代理${r.agent.nickname}` : '未绑定代理'
  return `${r.roomNo} · ${agent}`
}

function rowCountText(row: GroupRow | ConsoleRoom) {
  if (!(row as GroupRow)._group) return '—'
  const g = row as GroupRow
  return `房间 ${g.children.length} · 营业 ${g.openCount}`
}

const roomStats = computed(() => {
  const rows = list.value.filter((r) => includeClosed.value || r.status !== 'CLOSED')
  let open = 0
  let cash = 0
  let credit = 0
  let alert = 0
  for (const r of rows) {
    if (r.status === 'OPEN') open += 1
    if (r.bookMode === 'CREDIT') credit += 1
    else cash += 1
    if (roomAlerts(r).length) alert += 1
  }
  return { total: rows.length, open, cash, credit, alert }
})

function fmtMoney(n?: number) {
  return formatMoney(n ?? 0)
}
function pnlColor(n?: number | null) {
  const v = Number(n || 0)
  if (v > 0) return '#16a34a'
  if (v < 0) return '#ef4444'
  return 'var(--el-text-color-regular)'
}
function sharePct(row: ConsoleRoom) {
  return Math.round(Number(row.agentShareRate ?? 0) * 100)
}
function settleShort(row: ConsoleRoom) {
  if (row.settleCycle === 'MONTHLY_15_30' || row.settleCycle === 'MONTHLY_15' || row.settleCycle === 'MONTHLY_30') {
    return '半月结'
  }
  if (row.settleCycle === 'MONTHLY_1') return '月结'
  return '礼拜一'
}
function formatDate(v?: string | null) {
  return formatShanghaiDate(v)
}
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择')
  }
}
function billDueSoon(row: ConsoleRoom) {
  const fee = Number(row.monthlyFee || 0)
  if (fee <= 0 || !row.nextBillAt) return false
  const next = new Date(row.nextBillAt).getTime()
  if (Number.isNaN(next)) return false
  return (next - Date.now()) / 86400000 <= 3
}
function roomAlerts(row: ConsoleRoom): AlertTag[] {
  const tags: AlertTag[] = []
  const a = row.agent
  if (row.bookMode === 'CREDIT') {
    const limit = Number(row.creditLimit || 0)
    if (limit <= 0) tags.push({ text: '无合同额度', type: 'danger' })
  }
  if (a) {
    const bal = Number(a.balance || 0)
    if (bal < Number(row.monthlyFee || 0) && Number(row.monthlyFee || 0) > 0) {
      tags.push({ text: '余额不够月费', type: 'danger' })
    }
  }
  if (billDueSoon(row)) tags.push({ text: '将扣月费', type: 'warning' })
  return tags.slice(0, 3)
}
function randHex(n: number) {
  const arr = new Uint8Array(n)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}
function regenRoomNo() {
  form.roomNo = String(100000 + Math.floor(Math.random() * 900000))
}
function onRoomNoInput(v: string) {
  form.roomNo = String(v ?? '').replace(/\D/g, '').slice(0, 6)
}
function regenUsername() {
  const base = form.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'agent'
  form.agentUsername = `${base}${randHex(3)}`.slice(0, 20)
}
function regenPassword() {
  form.agentPassword = `Ag${randHex(4)}9`
}
function suggestAgentUsername() {
  if (!form.agentUsername.trim()) regenUsername()
}
function pad2(n: number) {
  return String(n).padStart(2, '0')
}
/* 月费锚在建房那天：第一次结账就收第一笔，之后每满一个自然月收一笔 */
function defaultBillStart() {
  const d = new Date()
  form.billingDay = Math.min(28, d.getDate())
  form.billStartDate = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function onBillStartChange(v: string | null) {
  if (!v) return
  const day = Number(v.slice(8, 10))
  form.billingDay = day >= 1 && day <= 28 ? day : 28
}

function validateCreateStep(key: CreateTabKey): string | null {
  if (key === 'basic') {
    if (!/^\d{6}$/.test(form.roomNo.trim())) return '请填写 6 位数字进房码'
    if (!form.name.trim()) return '请填写房间名称'
    return null
  }
  if (key === 'book') {
    if (form.agentFlowPercent < agentFlowMin.value - 1e-9 || form.agentFlowPercent > agentFlowMax.value + 1e-9) {
      return `代理流水须在 ${agentFlowMin.value}%～${agentFlowMax.value}%`
    }
    if (form.agentSharePercent < 0 || form.agentSharePercent > agentShareMax.value) {
      return `代理占成须在 0%～${agentShareMax.value}%`
    }
    if (!['WEEKLY_MON', 'MONTHLY_1', 'MONTHLY_15_30'].includes(form.settleCycle)) {
      return '请选择结账日'
    }
    if (form.bookMode === 'CREDIT' && form.creditLimit < 1) return '信用盘须填写合同额度'
    return null
  }
  if (key === 'agent') {
    if (!/^[a-z0-9]{8,20}$/.test(form.agentUsername.trim())) {
      return '代理用户名须 8-20 位小写字母数字'
    }
    const agentPwdErr = validateOpsPassword(form.agentPassword.trim(), '代理密码')
    if (agentPwdErr) return agentPwdErr
    return null
  }
  if (key === 'games') {
    if (!form.enabledGames.length) return '请至少开通一个游戏'
    return null
  }
  if (key === 'billing') {
    if (form.monthlyFee < 0) return '月费不能为负数'
    /* 挂总代的房：月费低于平台单价的话总代每月倒贴，后端也会拒 */
    if (roomFeeFloor.value > 0 && form.monthlyFee < roomFeeFloor.value) {
      return `该总代名下房间月费不得低于平台单价 ${roomFeeFloor.value}`
    }
    return null
  }
  return null
}
function goCreateTab(key: CreateTabKey) {
  const idx = createTabOrder.indexOf(key)
  if (idx <= createMaxStep.value) createTab.value = key
}
function prevCreateTab() {
  const i = createTabOrder.indexOf(createTab.value)
  if (i > 0) createTab.value = createTabOrder[i - 1]
}
function nextCreateTab() {
  const err = validateCreateStep(createTab.value)
  if (err) return ElMessage.warning(err)
  const i = createTabOrder.indexOf(createTab.value)
  if (i < createTabOrder.length - 1) {
    createMaxStep.value = Math.max(createMaxStep.value, i + 1)
    createTab.value = createTabOrder[i + 1]
    if (createTab.value === 'billing') applyRoomFeeFloor()
  }
}

async function load() {
  loading.value = true
  redirecting.value = false
  try {
    list.value = await consoleApi.rooms({
      includeClosed: includeClosed.value && isAdminOrBranch.value,
    })
    if (isAgentSide.value && list.value.length === 1) {
      redirecting.value = true
      await router.replace({ name: 'room-detail', params: { id: list.value[0].id } })
      return
    }
  } catch {
    ElMessage.error('加载房间失败')
  } finally {
    loading.value = false
  }
}
/** 总代登录时读自己的费率与可用额度，作为建房表单的上限 */
async function loadMyGeneral() {
  if (!isGeneralUser.value) return
  try {
    myGeneral.value = await consoleApi.walletMe()
  } catch {
    myGeneral.value = null
  }
}
async function loadRebateBounds() {
  try {
    const p = await consoleApi.rebatePolicy()
    const plat = p.chain?.platform
    rebateBounds.agentMin = Number((((plat?.agentMin ?? p.agentMinRate ?? 0.018) * 100)).toFixed(1))
    rebateBounds.agentMax = Number((((plat?.agentMax ?? p.agentMaxRate ?? 0.07) * 100)).toFixed(1))
    rebateBounds.agentDefault = Number((((plat?.agentDefault ?? p.agentDefaultRate ?? 0.05) * 100)).toFixed(1))
  } catch {
    /* keep defaults */
  }
}
function defaultAgentFlowPercent() {
  if (isGeneralUser.value) {
    const mine = pctNum(myGeneral.value?.downlineFlowRate)
    if (mine > 0) return Math.min(mine, agentFlowMax.value)
  }
  const g = pickedGeneral.value
  const fromGeneral = pctNum(g?.downlineFlowRate)
  if (fromGeneral > 0) return Math.min(fromGeneral, agentFlowMax.value)
  return Math.min(rebateBounds.agentDefault, agentFlowMax.value)
}
async function loadStaff() {
  if (!isAdminOrBranch.value) return
  try {
    const [branches, generals] = await Promise.all([
      isAdmin.value
        ? consoleApi.agentsAll({ role: 'BRANCH', boundOnly: false })
        : Promise.resolve({ list: [] as { id: string; uid: string; nickname: string; role: string; flowRate?: number; shareRate?: number }[] }),
      consoleApi.agentsAll({ role: 'GENERAL', boundOnly: false }),
    ])
    staffList.value = [
      ...branches.list.map((a) => ({
        id: a.id, uid: a.uid, nickname: a.nickname, role: a.role,
        flowRate: a.flowRate, shareRate: a.shareRate,
      })),
      ...generals.list.map((a) => ({
        id: a.id, uid: a.uid, nickname: a.nickname, role: a.role,
        flowRate: a.flowRate, shareRate: a.shareRate,
        pendingShareRate: a.pendingShareRate, pendingShareFrom: a.pendingShareFrom,
        bookMode: a.bookMode,
        downlineFlowRate: a.downlineFlowRate,
        roomMonthlyFee: a.roomMonthlyFee,
      })),
    ]
  } catch {
    staffList.value = []
  }
}
function goDetail(id: string) { router.push({ name: 'room-detail', params: { id } }) }
function goGeneral(userId: string) { router.push({ name: 'general-detail', params: { id: userId } }) }

const createIconInput = ref<HTMLInputElement | null>(null)
function pickCreateIcon() {
  createIconInput.value?.click()
}
function clearCreateIcon() {
  form.iconImage = ''
  form.iconPreview = ''
}
function readCreateIconAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}
async function onCreateIconPicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    return ElMessage.warning('请选择 JPG / PNG / WEBP 图片')
  }
  if (file.size > 800 * 1024) {
    return ElMessage.warning('图片请小于 800KB')
  }
  try {
    const dataUrl = await readCreateIconAsDataUrl(file)
    form.iconImage = dataUrl
    form.iconPreview = dataUrl
  } catch {
    ElMessage.error('读取图片失败')
  }
}

function applyRoomFeeFloor() {
  if (form.monthlyFee < roomFeeFloor.value) form.monthlyFee = roomFeeFloor.value
}

function onGeneralPicked() {
  if (form.agentSharePercent > agentShareMax.value) form.agentSharePercent = agentShareMax.value
  form.agentFlowPercent = defaultAgentFlowPercent()
  applyRoomFeeFloor()
}

async function openCreate() {
  form.name = ''
  form.agentNickname = ''
  form.generalAgentUserId = ''
  form.enabledGames = [...allGameCodes]
  form.status = 'OPEN'
  form.monthlyFee = 0
  form.bookMode = 'CASH'
  form.agentSharePercent = 50
  form.settleCycle = 'WEEKLY_MON'
  form.creditLimit = 100000
  createTab.value = 'basic'
  createMaxStep.value = 0
  defaultBillStart()
  regenRoomNo()
  regenUsername()
  regenPassword()
  showCreate.value = true
  await loadRebateBounds()
  if (isAdminOrBranch.value) {
    await loadStaff()
    form.ownerUserIds = branchList.value.map((a) => a.id)
    form.agentFlowPercent = defaultAgentFlowPercent()
    onGeneralPicked()
  } else {
    form.ownerUserIds = []
    /* 总代：上限跟着自己的费率，开窗前先取一次，免得停在默认值 */
    await loadMyGeneral()
    form.agentFlowPercent = defaultAgentFlowPercent()
    form.agentSharePercent = Math.min(form.agentSharePercent, agentShareMax.value)
    applyRoomFeeFloor()
  }
}

async function onCreate() {
  for (const key of createTabOrder) {
    const err = validateCreateStep(key)
    if (err) {
      createTab.value = key
      return ElMessage.warning(err)
    }
  }
  saving.value = true
  try {
    const nextBillAt = form.billStartDate
      ? `${form.billStartDate}T00:00:00+08:00`
      : undefined
    const bookMode = form.bookMode
    const sharePct = form.agentSharePercent
    const flowPct = form.agentFlowPercent
    const res = await consoleApi.createRoom({
      name: form.name.trim(),
      roomNo: form.roomNo.trim(),
      agentUsername: form.agentUsername.trim(),
      agentPassword: form.agentPassword.trim(),
      agentNickname: form.agentNickname.trim() || undefined,
      ownerUserIds: isAdmin.value ? form.ownerUserIds : undefined,
      generalAgentUserId: isGeneralUser.value
        ? undefined
        : (form.generalAgentUserId || undefined),
      enabledGames: form.enabledGames,
      status: form.status,
      monthlyFee: form.monthlyFee,
      billingDay: form.billingDay,
      nextBillAt: form.monthlyFee > 0 ? nextBillAt : undefined,
      bookMode,
      agentFlowRate: flowPct,
      agentShareRate: sharePct,
      creditLimit: bookMode === 'CREDIT' ? form.creditLimit : 0,
      settleCycle: form.settleCycle,
      iconImage: form.iconImage || undefined,
    })
    ElMessage.success('房间已创建')
    showCreate.value = false
    if (res?.agent?.username && res?.agent?.password) {
      createdCreds.value = {
        roomName: res.name,
        roomNo: res.roomNo,
        username: res.agent.username,
        password: res.agent.password,
        bookLabel: bookMode === 'CREDIT' ? 'B · 信用盘' : 'A · 现金盘',
        shareLabel: form.settleCycle === 'MONTHLY_15_30'
          ? `半月结(15/月末) · 流水 ${flowPct}% · 占成 ${sharePct}%`
          : form.settleCycle === 'MONTHLY_1'
            ? `月结(1号) · 流水 ${flowPct}% · 占成 ${sharePct}%`
            : `礼拜一结 · 流水 ${flowPct}% · 占成 ${sharePct}%`,
      }
      showCreds.value = true
    }
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '创建失败',
    )
  } finally {
    saving.value = false
  }
}

async function copyCreds() {
  if (!createdCreds.value) return
  const t = [
    `房间：${createdCreds.value.roomName}`,
    `盘口：${createdCreds.value.bookLabel}`,
    `占成：${createdCreds.value.shareLabel}`,
    `进房码：${createdCreds.value.roomNo}`,
    `用户名：${createdCreds.value.username}`,
    `密码：${createdCreds.value.password}`,
  ].join('\n')
  try {
    await navigator.clipboard.writeText(t)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择')
  }
}

async function onStatus(id: string, status: string) {
  const label: Record<string, string> = {
    OPEN: '营业中', MAINTENANCE: '维护中', FROZEN: '已冻结', CLOSED: '已关闭',
  }
  try {
    await ElMessageBox.confirm(
      `确认将房间状态改为「${label[status] || status}」？`,
      '变更房间状态',
      { type: status === 'FROZEN' || status === 'CLOSED' ? 'warning' : 'info' },
    )
  } catch {
    return
  }
  try {
    await consoleApi.setRoomStatus(id, status)
    ElMessage.success('状态已更新')
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '状态更新失败',
    )
  }
}

async function onDelete(row: ConsoleRoom) {
  let pwd: string
  try {
    /* 服务端要求二次验密：删房牵动该房账本，只认 JWT 太轻 */
    const { value } = await ElMessageBox.prompt(
      `确认关闭房间「${row.name}」？关闭后玩家不可进入，数据保留。\n请输入管理员密码确认。`,
      '关闭房间',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: '管理员登录密码',
        inputValidator: (v: string) => (v ? true : '请输入管理员密码'),
      },
    )
    pwd = value
  } catch {
    return
  }
  try {
    const res = await consoleApi.deleteRoom(row.id, pwd)
    ElMessage.success(res.message || '房间已关闭')
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '删除失败',
    )
    await load()
  }
}

async function onPurge(row: ConsoleRoom) {
  let pwd: string
  try {
    const { value } = await ElMessageBox.prompt(
      `彻底删除「${row.name}」？空房和空壳代理会从库里抹掉，不可恢复。\n有过注单或账本的房间不能真删。\n请输入管理员密码确认。`,
      '彻底删除',
      {
        type: 'warning',
        confirmButtonText: '确认抹掉',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: '管理员登录密码',
        inputValidator: (v: string) => (v ? true : '请输入管理员密码'),
      },
    )
    pwd = value
  } catch {
    return
  }
  try {
    const res = await consoleApi.purgeRoom(row.id, pwd)
    ElMessage.success(res.message || '已彻底删除')
    await load()
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '彻底删除失败',
    )
    await load()
  }
}

onMounted(async () => {
  narrowQuery = window.matchMedia('(max-width: 720px)')
  syncNarrow()
  narrowQuery.addEventListener('change', syncNarrow)
  await load()
  await Promise.all([loadStaff(), loadMyGeneral()])
})

onBeforeUnmount(() => {
  narrowQuery?.removeEventListener('change', syncNarrow)
})
</script>

<style scoped>
.rooms-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
  flex-shrink: 0;
}
.rooms-summary {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0;
  flex-shrink: 0;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.sum-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 48px;
  padding: 0 16px;
  border-right: 1px solid #f1f5f9;
}
.sum-chip:last-child { border-right: none; }
.sum-chip.hot { background: #fff7f7; }
.sum-label { font-size: 12px; color: #64748b; white-space: nowrap; }
.sum-val {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}
.sum-val.ok { color: #16a34a; }
.sum-val.warn { color: #f59e0b; }
.sum-val.hot { color: #ef4444; }
.panel-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 10px 12px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.filter-search { width: 220px; }
.filter-status { width: 120px; }
.filter-book { width: 130px; }
.panel-body {
  flex: 1;
  min-height: 0;
  padding: 0;
  background: #fff;
}
.panel-body :deep(.el-table) {
  --el-table-header-bg-color: #f1f5f9;
  --el-table-row-hover-bg-color: #eff6ff;
}
.panel-body :deep(.el-table th.el-table__cell) { color: #475569; font-weight: 600; }
.rooms-table { width: 100%; }
.rooms-table :deep(.el-table__cell) { padding: 12px 14px; }
.rooms-table :deep(.el-table__row) { cursor: default; }
.rooms-table.chain-table :deep(.is-fold) { cursor: pointer; }
.rooms-table.chain-table :deep(.el-table__body .el-table__row > td) {
  border-bottom: 8px solid #e8edf3 !important;
}
.rooms-table.chain-table :deep(.el-table__row--level-1 > td:first-child) {
  border-left: 22px solid #e8edf3 !important;
}
.rooms-table.chain-table :deep(.el-table__row--level-2 > td:first-child) {
  border-left: 44px solid #e8edf3 !important;
}
.rooms-table.chain-table :deep(.is-group td) {
  background: #f8fafc !important;
}
.rooms-table.chain-table :deep(.is-general td) {
  background: #e8eef6 !important;
  font-weight: 650;
}
.rooms-table.chain-table :deep(.is-child td) {
  background: #f0f7ff !important;
}
.rooms-table.chain-table :deep(.is-child td:first-child) {
  box-shadow: inset 3px 0 0 #38bdf8;
}
.rooms-table.chain-table :deep(.is-child .cell-name) {
  font-size: 13px;
  font-weight: 600;
}
.rooms-table.chain-table :deep(.is-child:hover td) {
  background: #e0f2fe !important;
}
.cell-name {
  font-size: 14px;
  font-weight: 650;
  color: #0f172a;
  line-height: 1.35;
}
.cell-meta {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.35;
  display: flex;
  align-items: center;
  gap: 8px;
}
.count-line {
  font-size: 13px;
  color: #334155;
  font-variant-numeric: tabular-nums;
}
.stat-val { font-variant-numeric: tabular-nums; }
.group-stat { font-weight: 700; }
.agent-empty {
  margin: 48px 0;
  text-align: center;
  color: #6b7385;
  font-size: 14px;
}
.room-cell { min-height: 40px; display: flex; flex-direction: column; justify-content: center; }
.room-name {
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
  line-height: 1.35;
}
.room-code {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.status-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.alert-row { display: flex; flex-wrap: wrap; gap: 4px; }
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: #64748b;
  letter-spacing: 0.04em;
}
.copy-chip {
  border: none;
  background: #f2f3f5;
  color: #64748b;
  font-size: 11px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 4px;
  cursor: pointer;
}
.copy-chip:hover { background: #ebecef; color: #475569; }
.agent-name { font-size: 13px; color: #0f172a; line-height: 1.35; }
.book-cell { line-height: 1.35; }
.sub { font-size: 12px; color: #64748b; line-height: 1.35; margin-top: 2px; }
.fee { font-size: 13px; color: #0f172a; }
.warn-text { color: #f59e0b; font-weight: 600; font-size: 13px; }
.muted { color: #94a3b8; }
.robot-default-tip {
  font-size: 13px;
  color: #475569;
  line-height: 1.55;
}
.robot-default-tip ul {
  margin: 8px 0 0;
  padding-left: 18px;
}
.ops {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  white-space: nowrap;
}
.ops :deep(.el-button) { margin: 0; padding: 0 2px; }
.row-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.row-inline .el-input { flex: 1; min-width: 0; }
.field-unit {
  font-size: 13px;
  color: #475569;
  white-space: nowrap;
}
.field-control { width: 100% !important; }
.form-row2 {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 20px;
  align-items: start;
}
.create-form :deep(.el-form-item) {
  margin-bottom: 14px;
  align-items: flex-start;
}
.create-form :deep(.el-form-item__label) {
  height: 32px;
  line-height: 32px !important;
  padding: 0 12px 0 0 !important;
  box-sizing: border-box;
}
.create-form :deep(.el-form-item__content) {
  line-height: 32px;
  min-width: 0;
}
.check-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px 10px;
  width: 100%;
  padding-top: 4px;
}
.check-grid :deep(.el-checkbox) {
  margin-right: 0;
  height: auto;
  align-items: center;
}
.check-grid :deep(.el-checkbox__label) {
  line-height: 1.3;
  white-space: nowrap;
}
@media (max-width: 1100px) {
  .rooms-summary { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .sum-chip { border-bottom: 1px solid #f1f5f9; }
}
@media (max-width: 720px) {
  .rooms-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sum-chip {
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 2px;
    min-height: 56px;
    padding: 8px 12px;
  }
  .sum-val { font-size: 16px; }
}
.room-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow: auto;
}
.general-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}
.general-card__hd {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.general-card__who { min-width: 0; }
.general-card__nums {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 12px;
  color: #475569;
  white-space: nowrap;
}
.card-link {
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  font-size: 12px;
  padding: 0;
  cursor: pointer;
}
.room-card {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: 0;
  border-top: 1px solid #f1f5f9;
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.room-card:first-of-type { border-top: 0; }
.room-card__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-size: 12px;
  color: #475569;
  white-space: nowrap;
}
.create-icon-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
}
.create-icon-preview {
  width: 64px;
  height: 64px;
  border-radius: 10px;
  object-fit: cover;
  border: 1px solid var(--el-border-color);
  flex-shrink: 0;
  background: #111;
}
.create-icon-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.create-icon-hint {
  width: 100%;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

/*
 * 字段下方的口径说明。缩进对齐 label 宽度（92px + 12px 间距），
 * 让它看着是挂在上面那一行下面，而不是另起一段无主的文字。
 */
.create-note {
  margin: -6px 0 14px 104px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.create-note b {
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.create-warn-list {
  margin: 6px 0 0;
  padding-left: 18px;
  line-height: 1.7;
}
.create-review {
  margin-top: 4px;
}
.create-review :deep(.el-descriptions__label) {
  width: 92px;
  white-space: nowrap;
}
.mb12 { margin-bottom: 12px; }
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
