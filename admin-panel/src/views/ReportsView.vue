<template>
  <div class="desk-work reports-page" v-loading="loading">
    <div class="desk-panel">
      <PageHeader title="报表中心">
        <template #actions>
          <el-button :loading="loading" @click="load">刷新</el-button>
          <el-button v-if="!isAgentSide" type="primary" :loading="exporting" @click="onExport">
            导出 CSV
          </el-button>
        </template>
      </PageHeader>

      <div class="panel-toolbar">
        <div class="filter-item">
          <span class="filter-label">时间</span>
          <el-radio-group v-model="rangeKey" size="small" @change="onRangePreset">
            <el-radio-button label="today">今日</el-radio-button>
            <el-radio-button label="yesterday">昨日</el-radio-button>
            <el-radio-button label="thisweek">本周</el-radio-button>
            <el-radio-button label="lastweek">上周</el-radio-button>
            <el-radio-button label="thismonth">本月</el-radio-button>
            <el-radio-button label="custom">自定义</el-radio-button>
          </el-radio-group>
        </div>

        <div v-if="isAgentSide" class="filter-item">
          <span class="filter-label">房间</span>
          <template v-if="rooms.length <= 1">
            <span class="room-fixed">
              {{ rooms[0] ? `${rooms[0].name}（${rooms[0].roomNo}）` : '暂无房间' }}
            </span>
          </template>
          <el-select
            v-else
            v-model="agentRoomId"
            size="small"
            class="filter-room"
            @change="load"
          >
            <el-option
              v-for="r in rooms"
              :key="r.id"
              :label="`${r.name}（${r.roomNo}）`"
              :value="r.id"
            />
          </el-select>
        </div>

        <div v-else class="filter-item">
          <span class="filter-label">算账房间</span>
          <el-button size="small" @click="openRoomDlg">
            已选 {{ selectedRoomIds.length }} / {{ rooms.length }} 房 · 点击选择
          </el-button>
        </div>

        <span class="toolbar-grow" />
        <el-button type="primary" size="small" :loading="loading" @click="load">查询</el-button>
      </div>

      <div v-if="rangeKey === 'custom'" class="toolbar-custom">
        <el-date-picker
          v-model="customRange"
          type="datetimerange"
          unlink-panels
          clearable
          size="small"
          :editable="false"
          :shortcuts="customShortcuts"
          :default-time="customDefaultTime"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          format="YYYY-MM-DD HH:mm"
          time-format="HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss+08:00"
          class="custom-picker"
          @change="onCustomRangeChange"
        />
        <span class="tip">上海时间 · 左闭右开</span>
      </div>

      <div v-if="summary?.range" class="range-bar">
        <span>
          统计区间
          <b>{{ summary.range.fromText || formatDt(summary.range.from) }}</b>
          ～
          <b>{{ summary.range.toText || formatDt(summary.range.to) }}</b>
        </span>
        <span class="muted">
          <template v-if="isAgentSide">{{ currentRoomLabel }} · 上海时间</template>
          <template v-else>已选 {{ selectedRoomIds.length }} 房 · 上海时间</template>
        </span>
      </div>

      <div class="desk-panel__scroll">
        <!-- ========== 代理 / 子账号：与工作台、经营概况同一套统计条 ========== -->
        <template v-if="isAgentSide">
          <section class="report-sec">
            <h3 class="sec-title">核心指标</h3>
            <div class="report-summary" :style="summaryCols(agentCoreKpis.length)">
              <div v-for="k in agentCoreKpis" :key="k.label" class="sum-chip">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section class="report-sec">
            <h3 class="sec-title">玩家上下分</h3>
            <div class="report-summary" :style="summaryCols(agentCashKpis.length)">
              <div
                v-for="k in agentCashKpis"
                :key="k.label"
                class="sum-chip"
                :class="{ hot: k.hot }"
              >
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section class="report-sec">
            <h3 class="sec-title">注单概况</h3>
            <div class="report-summary" :style="summaryCols(agentBetKpis.length)">
              <div v-for="k in agentBetKpis" :key="k.label" class="sum-chip">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <div class="bet-cols">
            <section class="report-sec">
              <div class="sec-head">
                <h3 class="sec-title">注单明细（按游戏）</h3>
                <el-button size="small" type="primary" plain @click="openGameDetailDlg">明细</el-button>
              </div>
              <div class="table-panel bet-panel">
                <el-table
                  :data="summary?.byGame || []"
                  stripe
                  border
                  empty-text="该区间暂无注单"
                  size="small"
                  show-summary
                  :summary-method="agentGameSummary"
                  max-height="360"
                >
                  <el-table-column label="游戏" min-width="96" show-overflow-tooltip>
                    <template #default="{ row }">{{ row.gameName || gameLabel(row.gameCode) }}</template>
                  </el-table-column>
                  <el-table-column prop="betCount" label="注单" width="70" align="right" />
                  <el-table-column label="流水" min-width="90" align="right">
                    <template #default="{ row }">{{ fmt(row.betFlow) }}</template>
                  </el-table-column>
                  <el-table-column label="派彩" min-width="90" align="right">
                    <template #default="{ row }">{{ fmt(row.payout) }}</template>
                  </el-table-column>
                  <el-table-column label="玩家盈亏" min-width="90" align="right">
                    <template #default="{ row }">
                      <span :style="{ color: pnlColor(gamePnl(row)) }">{{ fmt(gamePnl(row)) }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="本房盈亏" min-width="90" align="right">
                    <template #default="{ row }">
                      <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </section>

            <section class="report-sec">
              <div class="sec-head">
                <h3 class="sec-title">最近注单</h3>
                <el-button size="small" type="primary" plain @click="openBetDetailDlg">明细</el-button>
              </div>
              <div class="table-panel bet-panel">
                <el-table
                  v-loading="betLoading"
                  :data="betRows"
                  stripe
                  border
                  size="small"
                  empty-text="该区间暂无注单"
                  max-height="360"
                >
                  <el-table-column label="时间" width="96">
                    <template #default="{ row }">{{ formatDtShort(row.createdAt) }}</template>
                  </el-table-column>
                  <el-table-column label="玩家" min-width="100" show-overflow-tooltip>
                    <template #default="{ row }">
                      <div class="cell-name">{{ row.playerNickname }}</div>
                      <div class="cell-meta">{{ row.playerUid || '—' }}</div>
                    </template>
                  </el-table-column>
                  <el-table-column label="游戏" min-width="80" show-overflow-tooltip>
                    <template #default="{ row }">{{ row.gameName || gameLabel(row.gameCode) }}</template>
                  </el-table-column>
                  <el-table-column label="玩法" min-width="72" show-overflow-tooltip>
                    <template #default="{ row }">{{ row.betType || '—' }}</template>
                  </el-table-column>
                  <el-table-column label="下注" width="80" align="right">
                    <template #default="{ row }">{{ fmt(row.amount) }}</template>
                  </el-table-column>
                  <el-table-column label="派彩" width="80" align="right">
                    <template #default="{ row }">{{ fmt(row.payout) }}</template>
                  </el-table-column>
                  <el-table-column label="盈亏" width="80" align="right">
                    <template #default="{ row }">
                      <span :style="{ color: pnlColor(row.playerPnl) }">{{ fmt(row.playerPnl) }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="状态" width="68" align="center">
                    <template #default="{ row }">
                      <el-tag size="small" :type="betStatusType(row.status)" effect="plain">
                        {{ betStatusLabel(row.status) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                </el-table>
                <div v-if="betTotal > betRows.length" class="bet-more">
                  仅展示最近 {{ betRows.length }} 笔，共 {{ betTotal }} 笔 · 点明细查看更多
                </div>
              </div>
            </section>
          </div>
        </template>

        <!-- ========== 超管 / 房主：与代理同一套统计条 ========== -->
        <template v-else>
          <section class="report-sec">
            <h3 class="sec-title">核心指标</h3>
            <div class="report-summary" :style="summaryCols(adminCoreKpis.length)">
              <div v-for="k in adminCoreKpis" :key="k.label" class="sum-chip">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section class="report-sec">
            <h3 class="sec-title">活跃概况</h3>
            <div class="report-summary" :style="summaryCols(activeKpis.length)">
              <div v-for="k in activeKpis" :key="k.label" class="sum-chip">
                <span class="sum-label">{{ k.label }}</span>
                <span class="sum-val" :style="{ color: k.color || undefined }">{{ k.value }}</span>
              </div>
            </div>
          </section>

          <section class="report-sec">
            <div class="sec-head">
              <h3 class="sec-title">分房间明细</h3>
              <el-checkbox v-model="hideIdleRooms">隐藏无数据房间</el-checkbox>
            </div>
            <div class="table-panel">
            <el-table
              class="room-by-table"
              :data="displayRoomList"
              stripe
              border
              empty-text="该区间暂无房间数据"
              size="small"
              show-summary
              :summary-method="roomSummary"
              table-layout="fixed"
            >
              <el-table-column label="房间" min-width="90" align="center" header-align="center">
                <template #default="{ row }">
                  <el-button link type="primary" @click="goRoom(row.roomId)">{{ row.roomNo }}</el-button>
                  <div class="room-name">{{ row.name }}</div>
                </template>
              </el-table-column>
              <el-table-column label="状态" min-width="90" align="center" header-align="center">
                <template #default="{ row }">
                  <el-tag size="small" :type="roomStatusType(row.status)" effect="plain">
                    {{ roomStatusText(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="代理" min-width="90" align="center" header-align="center">
                <template #default="{ row }">{{ row.agentNickname || row.agentUsername || '—' }}</template>
              </el-table-column>
              <el-table-column label="流水" min-width="90" align="center" header-align="center" sortable :sort-method="(a: ReportByRoomRow, b: ReportByRoomRow) => a.betFlow - b.betFlow">
                <template #default="{ row }">{{ fmt(row.betFlow) }}</template>
              </el-table-column>
              <el-table-column label="派彩" min-width="90" align="center" header-align="center">
                <template #default="{ row }">{{ fmt(row.payout) }}</template>
              </el-table-column>
              <el-table-column label="庄家盈亏" min-width="90" align="center" header-align="center" sortable :sort-method="(a: ReportByRoomRow, b: ReportByRoomRow) => a.housePnl - b.housePnl">
                <template #default="{ row }">
                  <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="玩家盈亏" min-width="90" align="center" header-align="center">
                <template #default="{ row }">
                  <span :style="{ color: pnlColor(row.playerPnl) }">{{ fmt(row.playerPnl) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="挂靠支出" min-width="90" align="center" header-align="center">
                <template #default="{ row }">
                  <span class="gold">{{ fmt(row.commissionAmount) }}</span>
                </template>
              </el-table-column>
              <el-table-column
                label="平台占成"
                min-width="90"
                align="center"
                header-align="center"
                sortable
                :sort-method="(a: ReportByRoomRow, b: ReportByRoomRow) => (a.platformShareAmount ?? 0) - (b.platformShareAmount ?? 0)"
              >
                <template #default="{ row }">
                  <span :style="{ color: pnlColor(row.platformShareAmount) }">{{ fmt(row.platformShareAmount) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="净盈亏" min-width="90" align="center" header-align="center" sortable :sort-method="(a: ReportByRoomRow, b: ReportByRoomRow) => a.netPnl - b.netPnl">
                <template #default="{ row }">
                  <span :style="{ color: pnlColor(row.netPnl) }">{{ fmt(row.netPnl) }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="betCount" label="注单" min-width="90" align="center" header-align="center" />
              <el-table-column prop="activePlayers" label="活跃" min-width="90" align="center" header-align="center" />
              <el-table-column prop="memberCount" label="成员" min-width="90" align="center" header-align="center" />
            </el-table>
            </div>
          </section>

          <section class="report-sec">
            <h3 class="sec-title">游戏明细</h3>
            <div class="table-panel">
            <el-table
              :data="summary?.byGame || []"
              stripe
              border
              empty-text="该区间暂无注单"
              size="small"
              show-summary
              :summary-method="gameSummary"
            >
              <el-table-column label="游戏" min-width="140">
                <template #default="{ row }">{{ row.gameName || row.gameCode }}</template>
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
              <el-table-column label="玩家盈亏" min-width="120">
                <template #default="{ row }">
                  <span :style="{ color: pnlColor(-(row.housePnl || 0)) }">{{ fmt(-(row.housePnl || 0)) }}</span>
                </template>
              </el-table-column>
            </el-table>
            </div>
          </section>
        </template>
      </div>
    </div>

    <DeskDialog
      v-model="showRoomDlg"
      title="选择算账房间"
      width="640px"
      append-to-body
    >
      <div class="dlg-room-hd">
        <span>已选 {{ dlgRoomIds.length }} / {{ rooms.length }}</span>
        <div class="dlg-room-actions">
          <el-button link type="primary" @click="dlgSelectAll">全选</el-button>
          <el-button link type="primary" @click="dlgInvert">反选</el-button>
          <el-button link @click="dlgRoomIds = []">清空</el-button>
        </div>
      </div>
      <el-checkbox-group v-model="dlgRoomIds" class="room-checks">
        <el-checkbox
          v-for="r in rooms"
          :key="r.id"
          :value="r.id"
          border
          class="room-check"
        >
          <span class="rc-no">{{ r.roomNo }}</span>
          <span class="rc-name">{{ r.name }}</span>
        </el-checkbox>
      </el-checkbox-group>
      <div v-if="!rooms.length" class="room-empty">暂无可选房间</div>
      <template #footer>
        <el-button @click="showRoomDlg = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" @click="confirmRoomDlg">确定</el-button>
      </template>
    </DeskDialog>

    <!-- 注单明细（按游戏） -->
    <DeskDialog
      v-model="showGameDetailDlg"
      title="注单明细（按游戏）"
      width="900px"
      append-to-body
    >
      <div class="dlg-filter-bar">
        <div class="filter-item">
          <span class="filter-label">时间</span>
          <el-radio-group v-model="gameDlgRangeKey" size="small" @change="onGameDlgRangePreset">
            <el-radio-button label="today">今日</el-radio-button>
            <el-radio-button label="yesterday">昨日</el-radio-button>
            <el-radio-button label="thisweek">本周</el-radio-button>
            <el-radio-button label="lastweek">上周</el-radio-button>
            <el-radio-button label="thismonth">本月</el-radio-button>
            <el-radio-button label="custom">自定义</el-radio-button>
          </el-radio-group>
        </div>
        <div class="filter-item">
          <span class="filter-label">类别</span>
          <el-select
            v-model="gameDlgGameCode"
            size="small"
            clearable
            placeholder="全部游戏"
            class="dlg-game-select"
            @change="loadGameDetail"
          >
            <el-option
              v-for="g in gameFilterOptions"
              :key="g.value"
              :label="g.label"
              :value="g.value"
            />
          </el-select>
        </div>
        <el-button type="primary" size="small" :loading="gameDlgLoading" @click="loadGameDetail">
          查询
        </el-button>
      </div>
      <div v-if="gameDlgRangeKey === 'custom'" class="dlg-filter-custom">
        <el-date-picker
          v-model="gameDlgCustomRange"
          type="datetimerange"
          unlink-panels
          clearable
          size="small"
          :editable="false"
          :shortcuts="customShortcuts"
          :default-time="customDefaultTime"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          format="YYYY-MM-DD HH:mm"
          time-format="HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss+08:00"
          class="custom-picker"
          @change="loadGameDetail"
        />
      </div>
      <div class="table-panel">
        <el-table
          v-loading="gameDlgLoading"
          :data="gameDlgRows"
          stripe
          border
          empty-text="该区间暂无注单"
          size="small"
          show-summary
          :summary-method="agentGameSummary"
          max-height="480"
        >
          <el-table-column label="游戏" min-width="120">
            <template #default="{ row }">{{ row.gameName || gameLabel(row.gameCode) }}</template>
          </el-table-column>
          <el-table-column prop="betCount" label="注单" width="90" />
          <el-table-column label="流水" min-width="110">
            <template #default="{ row }">{{ fmt(row.betFlow) }}</template>
          </el-table-column>
          <el-table-column label="派彩" min-width="110">
            <template #default="{ row }">{{ fmt(row.payout) }}</template>
          </el-table-column>
          <el-table-column label="玩家盈亏" min-width="110">
            <template #default="{ row }">
              <span :style="{ color: pnlColor(gamePnl(row)) }">{{ fmt(gamePnl(row)) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="本房盈亏" min-width="110">
            <template #default="{ row }">
              <span :style="{ color: pnlColor(row.housePnl) }">{{ fmt(row.housePnl) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </DeskDialog>

    <!-- 最近注单明细 -->
    <DeskDialog
      v-model="showBetDetailDlg"
      title="最近注单"
      width="980px"
      append-to-body
    >
      <div class="dlg-filter-bar">
        <div class="filter-item">
          <span class="filter-label">时间</span>
          <el-radio-group v-model="betDlgRangeKey" size="small" @change="onBetDlgRangePreset">
            <el-radio-button label="today">今日</el-radio-button>
            <el-radio-button label="yesterday">昨日</el-radio-button>
            <el-radio-button label="thisweek">本周</el-radio-button>
            <el-radio-button label="lastweek">上周</el-radio-button>
            <el-radio-button label="thismonth">本月</el-radio-button>
            <el-radio-button label="custom">自定义</el-radio-button>
          </el-radio-group>
        </div>
        <div class="filter-item">
          <span class="filter-label">类别</span>
          <el-select
            v-model="betDlgGameCode"
            size="small"
            clearable
            placeholder="全部游戏"
            class="dlg-game-select"
            @change="() => { betDlgPage = 1; loadBetDetail() }"
          >
            <el-option
              v-for="g in gameFilterOptions"
              :key="g.value"
              :label="g.label"
              :value="g.value"
            />
          </el-select>
        </div>
        <el-button
          type="primary"
          size="small"
          :loading="betDlgLoading"
          @click="() => { betDlgPage = 1; loadBetDetail() }"
        >
          查询
        </el-button>
      </div>
      <div v-if="betDlgRangeKey === 'custom'" class="dlg-filter-custom">
        <el-date-picker
          v-model="betDlgCustomRange"
          type="datetimerange"
          unlink-panels
          clearable
          size="small"
          :editable="false"
          :shortcuts="customShortcuts"
          :default-time="customDefaultTime"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          format="YYYY-MM-DD HH:mm"
          time-format="HH:mm"
          value-format="YYYY-MM-DDTHH:mm:ss+08:00"
          class="custom-picker"
          @change="() => { betDlgPage = 1; loadBetDetail() }"
        />
      </div>
      <div class="table-panel">
        <el-table
          v-loading="betDlgLoading"
          :data="betDlgRows"
          stripe
          border
          size="small"
          empty-text="该区间暂无注单"
          max-height="480"
        >
          <el-table-column label="时间" width="110">
            <template #default="{ row }">{{ formatDtShort(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="玩家" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <div class="cell-name">{{ row.playerNickname }}</div>
              <div class="cell-meta">{{ row.playerUid || '—' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="游戏" min-width="100" show-overflow-tooltip>
            <template #default="{ row }">{{ row.gameName || gameLabel(row.gameCode) }}</template>
          </el-table-column>
          <el-table-column label="玩法" min-width="90" show-overflow-tooltip>
            <template #default="{ row }">{{ row.betType || '—' }}</template>
          </el-table-column>
          <el-table-column label="下注" width="96" align="right">
            <template #default="{ row }">{{ fmt(row.amount) }}</template>
          </el-table-column>
          <el-table-column label="派彩" width="96" align="right">
            <template #default="{ row }">{{ fmt(row.payout) }}</template>
          </el-table-column>
          <el-table-column label="玩家盈亏" width="100" align="right">
            <template #default="{ row }">
              <span :style="{ color: pnlColor(row.playerPnl) }">{{ fmt(row.playerPnl) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="betStatusType(row.status)" effect="plain">
                {{ betStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div class="dlg-pager">
        <el-pagination
          v-model:current-page="betDlgPage"
          v-model:page-size="betDlgPageSize"
          :total="betDlgTotal"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
          small
          @current-change="loadBetDetail"
          @size-change="() => { betDlgPage = 1; loadBetDetail() }"
        />
      </div>
    </DeskDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import DeskDialog from '@/components/DeskDialog.vue'
import {
  consoleApi,
  type ConsoleRoom,
  type ReportByRoomRow,
  type ReportRoomBetRow,
  type ReportSummary,
} from '@/api/console'
import { useAdminStore } from '@/stores/admin'
import { GAME_OPTIONS, gameLabel, type KpiChip } from '@/utils/labels'

const store = useAdminStore()
const router = useRouter()
const isAgentSide = computed(() => {
  const r = store.profile?.role
  return r === 'AGENT' || r === 'PROXY'
})

const loading = ref(false)
const exporting = ref(false)
const betLoading = ref(false)
const summary = ref<ReportSummary | null>(null)
const byRoomList = ref<ReportByRoomRow[]>([])
const betRows = ref<ReportRoomBetRow[]>([])
const betTotal = ref(0)
const rooms = ref<ConsoleRoom[]>([])
const rangeKey = ref('today')
const selectedRoomIds = ref<string[]>([])
const agentRoomId = ref('')
const customRange = ref<[string, string] | null>(null)
const showRoomDlg = ref(false)
const dlgRoomIds = ref<string[]>([])
const hideIdleRooms = ref(false)

/** 注单明细弹窗 */
const showGameDetailDlg = ref(false)
const gameDlgLoading = ref(false)
const gameDlgRangeKey = ref('today')
const gameDlgCustomRange = ref<[string, string] | null>(null)
const gameDlgGameCode = ref('')
const gameDlgRows = ref<ReportSummary['byGame']>([])

/** 最近注单弹窗 */
const showBetDetailDlg = ref(false)
const betDlgLoading = ref(false)
const betDlgRangeKey = ref('today')
const betDlgCustomRange = ref<[string, string] | null>(null)
const betDlgGameCode = ref('')
const betDlgRows = ref<ReportRoomBetRow[]>([])
const betDlgTotal = ref(0)
const betDlgPage = ref(1)
const betDlgPageSize = ref(50)

const customDefaultTime: [Date, Date] = [
  new Date(2000, 0, 1, 0, 0, 0),
  new Date(2000, 0, 1, 0, 0, 0),
]

const SH_MS = 8 * 3600 * 1000
const DAY_MS = 86400000

function pad2(n: number) {
  return String(n).padStart(2, '0')
}
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

function fmt(n?: number | null) {
  if (n == null) return '—'
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
}
function pnlColor(n?: number | null) {
  if (n == null) return '#0f172a'
  return n >= 0 ? '#67c23a' : '#f56c6c'
}
function formatDt(v?: string | null) {
  if (!v) return '—'
  return String(v).replace('T', ' ').slice(0, 19)
}
function formatDtShort(v?: string | null) {
  if (!v) return '—'
  const s = String(v)
  if (s.length >= 16) return `${s.slice(5, 10)} ${s.slice(11, 16)}`
  if (s.length >= 10) return s.slice(5, 10)
  return s
}
function roomStatusText(s: string) {
  const map: Record<string, string> = {
    OPEN: '营业',
    MAINTENANCE: '维护',
    FROZEN: '冻结',
    CLOSED: '关闭',
  }
  return map[s] || s || '—'
}
function roomStatusType(s: string) {
  if (s === 'OPEN') return 'success'
  if (s === 'FROZEN') return 'danger'
  if (s === 'MAINTENANCE') return 'warning'
  return 'info'
}
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

const currentRoomLabel = computed(() => {
  const r = rooms.value.find((x) => x.id === agentRoomId.value)
  if (!r) return '本房'
  return `${r.name} · ${r.roomNo}`
})

/** 弹窗类别：本房启用游戏 + 当前汇总已出现的游戏 */
const gameFilterOptions = computed(() => {
  const room = rooms.value.find((x) => x.id === agentRoomId.value)
  const codes = new Set<string>()
  for (const c of room?.enabledGames || []) {
    if (c) codes.add(c)
  }
  for (const g of summary.value?.byGame || []) {
    if (g.gameCode) codes.add(g.gameCode)
  }
  if (!codes.size) return GAME_OPTIONS
  return [...codes].map((value) => ({
    value,
    label: gameLabel(value),
  }))
})

const netPnl = computed(() => {
  if (summary.value?.netPnl != null) return summary.value.netPnl
  const base = summary.value?.platformShareAmount ?? summary.value?.housePnl
  const commission = summary.value?.commissionAmount
  if (base == null && commission == null) return null
  return Number(base ?? 0) - Number(commission ?? 0)
})

function summaryCols(n: number) {
  const cols = Math.max(1, Math.min(6, n || 1))
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
}

/** 代理：与经营概况同一套核心指标 */
const agentCoreKpis = computed(() => [
  { label: '挂靠支出', value: fmt(summary.value?.commissionAmount), color: '#f59e0b' },
  { label: '玩家盈亏', value: fmt(summary.value?.playerPnl), color: pnlColor(summary.value?.playerPnl) },
  { label: '本房盈亏', value: fmt(summary.value?.housePnl), color: pnlColor(summary.value?.housePnl) },
  { label: '流水', value: fmt(summary.value?.betFlow), color: 'var(--desk-accent, #38bdf8)' },
  { label: '派彩', value: fmt(summary.value?.payout) },
  { label: '活跃玩家', value: String(summary.value?.activePlayers ?? '—') },
])

const agentBetKpis = computed<KpiChip[]>(() => [
  { label: '注单数', value: String(summary.value?.betCount ?? '—') },
  { label: '佣金笔数', value: String(summary.value?.commissionCount ?? '—') },
  { label: '未结算注单', value: String(summary.value?.pendingBetCount ?? '—') },
  { label: '未结算流水', value: fmt(summary.value?.pendingBetFlow) },
])

const agentCashKpis = computed(() => [
  { label: '上分合计', value: fmt(summary.value?.upAmount), color: '#f59e0b' },
  { label: '上分笔数', value: String(summary.value?.upCount ?? '—') },
  { label: '下分合计', value: fmt(summary.value?.downAmount), color: '#f56c6c' },
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

/** 管理/房主：核心指标（净盈亏已扣占成与佣金） */
const adminCoreKpis = computed(() => [
  { label: '净盈亏', value: fmt(netPnl.value), color: pnlColor(netPnl.value) },
  { label: '庄家盈亏', value: fmt(summary.value?.housePnl), color: pnlColor(summary.value?.housePnl) },
  { label: '玩家盈亏', value: fmt(summary.value?.playerPnl), color: pnlColor(summary.value?.playerPnl) },
  { label: '流水', value: fmt(summary.value?.betFlow), color: 'var(--desk-accent, #38bdf8)' },
  { label: '派彩', value: fmt(summary.value?.payout) },
  { label: '挂靠支出', value: fmt(summary.value?.commissionAmount), color: '#f59e0b' },
])

const activeKpis = computed((): Array<{ label: string; value: string; color?: string }> => [
  { label: '注单数', value: String(summary.value?.betCount ?? '—') },
  { label: '活跃玩家', value: String(summary.value?.activePlayers ?? '—') },
  { label: '房间成员', value: String(summary.value?.playerCount ?? '—') },
  {
    label: '有流水房间',
    value: String(byRoomList.value.filter((r) => r.betFlow > 0 || r.commissionAmount > 0).length),
  },
])

const displayRoomList = computed(() => {
  if (!hideIdleRooms.value) return byRoomList.value
  return byRoomList.value.filter((r) => r.betCount > 0 || r.commissionAmount > 0)
})

function sumField(list: ReportByRoomRow[], key: keyof ReportByRoomRow) {
  return list.reduce((acc, r) => acc + Number(r[key] || 0), 0)
}

function roomSummary({ columns }: { columns: { property?: string }[] }) {
  const list = displayRoomList.value
  const moneyIdx: Record<number, keyof ReportByRoomRow> = {
    3: 'betFlow',
    4: 'payout',
    5: 'housePnl',
    6: 'playerPnl',
    7: 'commissionAmount',
    8: 'platformShareAmount',
    9: 'netPnl',
    10: 'betCount',
    11: 'activePlayers',
    12: 'memberCount',
  }
  return columns.map((_col, i) => {
    if (i === 0) return '合计'
    const key = moneyIdx[i]
    if (!key) return ''
    const n = sumField(list, key)
    if (key === 'betCount' || key === 'activePlayers' || key === 'memberCount') return String(n)
    return fmt(n)
  })
}

function gameSummary({ columns, data }: { columns: unknown[]; data: ReportSummary['byGame'] }) {
  const list = data || []
  const flow = list.reduce((a, r) => a + Number(r.betFlow || 0), 0)
  const pay = list.reduce((a, r) => a + Number(r.payout || 0), 0)
  const house = list.reduce((a, r) => a + Number(r.housePnl || 0), 0)
  const bets = list.reduce((a, r) => a + Number(r.betCount || 0), 0)
  void columns
  return ['合计', String(bets), fmt(flow), fmt(pay), fmt(house), fmt(-house)]
}

function agentGameSummary({ columns, data }: { columns: unknown[]; data: ReportSummary['byGame'] }) {
  const list = data || []
  const flow = list.reduce((a, r) => a + Number(r.betFlow || 0), 0)
  const pay = list.reduce((a, r) => a + Number(r.payout || 0), 0)
  const house = list.reduce((a, r) => a + Number(r.housePnl || 0), 0)
  const bets = list.reduce((a, r) => a + Number(r.betCount || 0), 0)
  void columns
  return ['合计', String(bets), fmt(flow), fmt(pay), fmt(-house), fmt(house)]
}

function timeParams(): { range?: string; from?: string; to?: string } | null {
  if (rangeKey.value === 'custom') {
    if (!customRange.value?.[0] || !customRange.value?.[1]) {
      ElMessage.warning('请选择自定义起止时间')
      return null
    }
    return { from: customRange.value[0], to: customRange.value[1] }
  }
  return { range: rangeKey.value }
}

function queryParams() {
  if (isAgentSide.value) {
    if (!agentRoomId.value) {
      ElMessage.warning('暂无房间')
      return null
    }
    const t = timeParams()
    if (!t) return null
    return { roomId: agentRoomId.value, ...t }
  }
  if (!selectedRoomIds.value.length) {
    ElMessage.warning('请至少勾选一个房间')
    return null
  }
  const t = timeParams()
  if (!t) return null
  return { roomIds: selectedRoomIds.value.join(','), ...t }
}

function openRoomDlg() {
  dlgRoomIds.value = [...selectedRoomIds.value]
  showRoomDlg.value = true
}
function dlgSelectAll() {
  dlgRoomIds.value = rooms.value.map((r) => r.id)
}
function dlgInvert() {
  const set = new Set(dlgRoomIds.value)
  dlgRoomIds.value = rooms.value.map((r) => r.id).filter((id) => !set.has(id))
}
function confirmRoomDlg() {
  if (!dlgRoomIds.value.length) {
    ElMessage.warning('请至少勾选一个房间')
    return
  }
  selectedRoomIds.value = [...dlgRoomIds.value]
  showRoomDlg.value = false
  load()
}

async function loadRoomBets(roomId: string, time: { range?: string; from?: string; to?: string }) {
  betLoading.value = true
  try {
    const res = await consoleApi.reportRoomBets({
      roomId,
      ...time,
      page: 1,
      pageSize: 50,
    })
    betRows.value = res.list
    betTotal.value = res.total
  } catch {
    betRows.value = []
    betTotal.value = 0
  } finally {
    betLoading.value = false
  }
}

function dlgTimeParams(
  key: string,
  custom: [string, string] | null,
): { range?: string; from?: string; to?: string } | null {
  if (key === 'custom') {
    if (!custom?.[0] || !custom?.[1]) {
      ElMessage.warning('请选择自定义起止时间')
      return null
    }
    return { from: custom[0], to: custom[1] }
  }
  return { range: key }
}

function openGameDetailDlg() {
  gameDlgRangeKey.value = rangeKey.value
  gameDlgCustomRange.value = customRange.value ? [...customRange.value] as [string, string] : null
  gameDlgGameCode.value = ''
  showGameDetailDlg.value = true
  void loadGameDetail()
}

function onGameDlgRangePreset() {
  if (gameDlgRangeKey.value === 'custom') {
    if (!gameDlgCustomRange.value?.[0] || !gameDlgCustomRange.value?.[1]) {
      gameDlgCustomRange.value = shanghaiBoundPair(0, 1)
    }
  }
  void loadGameDetail()
}

async function loadGameDetail() {
  if (!agentRoomId.value) {
    ElMessage.warning('暂无房间')
    return
  }
  const time = dlgTimeParams(gameDlgRangeKey.value, gameDlgCustomRange.value)
  if (!time) return
  gameDlgLoading.value = true
  try {
    const s = await consoleApi.reportSummary({ roomId: agentRoomId.value, ...time })
    const list = s.byGame || []
    const code = gameDlgGameCode.value.trim()
    gameDlgRows.value = code ? list.filter((g) => g.gameCode === code) : list
  } catch (e: unknown) {
    gameDlgRows.value = []
    ElMessage.error((e as Error).message || '加载注单明细失败')
  } finally {
    gameDlgLoading.value = false
  }
}

function openBetDetailDlg() {
  betDlgRangeKey.value = rangeKey.value
  betDlgCustomRange.value = customRange.value ? [...customRange.value] as [string, string] : null
  betDlgGameCode.value = ''
  betDlgPage.value = 1
  showBetDetailDlg.value = true
  void loadBetDetail()
}

function onBetDlgRangePreset() {
  if (betDlgRangeKey.value === 'custom') {
    if (!betDlgCustomRange.value?.[0] || !betDlgCustomRange.value?.[1]) {
      betDlgCustomRange.value = shanghaiBoundPair(0, 1)
    }
  }
  betDlgPage.value = 1
  void loadBetDetail()
}

async function loadBetDetail() {
  if (!agentRoomId.value) {
    ElMessage.warning('暂无房间')
    return
  }
  const time = dlgTimeParams(betDlgRangeKey.value, betDlgCustomRange.value)
  if (!time) return
  betDlgLoading.value = true
  try {
    const res = await consoleApi.reportRoomBets({
      roomId: agentRoomId.value,
      ...time,
      page: betDlgPage.value,
      pageSize: betDlgPageSize.value,
      gameCode: betDlgGameCode.value.trim() || undefined,
    })
    betDlgRows.value = res.list
    betDlgTotal.value = res.total
  } catch (e: unknown) {
    betDlgRows.value = []
    betDlgTotal.value = 0
    ElMessage.error((e as Error).message || '加载注单失败')
  } finally {
    betDlgLoading.value = false
  }
}

async function load() {
  const params = queryParams()
  if (!params) return
  loading.value = true
  try {
    if (isAgentSide.value) {
      const roomId = (params as { roomId: string }).roomId
      const time = {
        range: (params as { range?: string }).range,
        from: (params as { from?: string }).from,
        to: (params as { to?: string }).to,
      }
      const s = await consoleApi.reportSummary({ roomId, ...time })
      summary.value = s
      byRoomList.value = []
      await loadRoomBets(roomId, time)
    } else {
      const [s, byRoom] = await Promise.all([
        consoleApi.reportSummary(params),
        consoleApi.reportByRoom(params),
      ])
      summary.value = s
      byRoomList.value = byRoom.list
      betRows.value = []
      betTotal.value = 0
    }
  } catch (e: unknown) {
    ElMessage.error(
      (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
      || (e as Error).message
      || '加载报表失败',
    )
  } finally {
    loading.value = false
  }
}

function onCustomRangeChange(val: [string, string] | null) {
  if (val?.[0] && val?.[1]) load()
}

function onRangePreset() {
  if (rangeKey.value === 'custom') {
    if (!customRange.value?.[0] || !customRange.value?.[1]) {
      customRange.value = shanghaiBoundPair(0, 1)
    }
  }
  load()
}

function goRoom(id: string) {
  router.push({ name: 'room-detail', params: { id } })
}

async function onExport() {
  const params = queryParams()
  if (!params) return
  exporting.value = true
  try {
    const res = await consoleApi.exportReport(params)
    const body = res.csv.startsWith('\uFEFF') ? res.csv : `\uFEFF${res.csv}`
    const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = res.filename || '报表.csv'
    a.click()
    URL.revokeObjectURL(a.href)
    ElMessage.success('已导出，可用 Excel 打开')
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  try {
    rooms.value = await consoleApi.rooms({ includeClosed: isAgentSide.value ? false : true })
    if (isAgentSide.value) {
      const open = rooms.value.find((r) => r.status === 'OPEN') || rooms.value[0]
      agentRoomId.value = open?.id || ''
      selectedRoomIds.value = agentRoomId.value ? [agentRoomId.value] : []
    } else {
      selectedRoomIds.value = rooms.value.map((r) => r.id)
    }
  } catch {
    rooms.value = []
    selectedRoomIds.value = []
    agentRoomId.value = ''
  }
  await load()
})
</script>

<style scoped>
.reports-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
  flex-shrink: 0;
}

.panel-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.toolbar-grow { flex: 1; min-width: 8px; }
.filter-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}
.filter-label {
  font-size: 13px;
  color: #64748b;
  white-space: nowrap;
}
.filter-room { width: 220px; }
.room-fixed {
  font-size: 13px;
  color: #0f172a;
  font-weight: 600;
}

.toolbar-custom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.custom-picker {
  flex: 1 1 420px;
  min-width: 280px;
  max-width: 560px;
}
.custom-picker :deep(.el-input__wrapper) { width: 100%; }
.tip { font-size: 12px; color: #64748b; }

.range-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 16px;
  padding: 7px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  font-size: 12px;
  color: #64748b;
  flex-shrink: 0;
}
.range-bar b {
  margin: 0 3px;
  color: #0f172a;
  font-weight: 600;
}
.muted { color: #94a3b8; }

.desk-panel__scroll {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.bet-cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 1100px) {
  .bet-cols { grid-template-columns: 1fr; }
}

.report-sec {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sec-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}
.bet-panel { min-height: 0; }
.dlg-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-bottom: 12px;
}
.dlg-filter-custom {
  margin: -4px 0 12px;
}
.dlg-game-select { width: 160px; }
.dlg-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
.sec-title {
  margin: 0;
  padding-left: 10px;
  border-left: 3px solid var(--desk-accent, #38bdf8);
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.2;
}

/* 代理统计条：对齐工作台 / 经营概况 */
.report-summary {
  display: grid;
  gap: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.report-summary .sum-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 52px;
  padding: 0 16px;
  border-right: 1px solid #f1f5f9;
}
.report-summary .sum-chip:last-child { border-right: none; }
.report-summary .sum-chip.hot { background: #fff7f7; }
.report-summary .sum-label {
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
}
.report-summary .sum-val {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.kpi-grid {
  display: grid;
  gap: 12px;
}
.kpi-grid.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.kpi-grid.cols-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.kpi-grid.cols-6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.kpi-grid.fluid { grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); }

.kpi-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 88px;
  padding: 14px 16px;
  overflow: hidden;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.04);
}
.kpi-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--desk-accent, #38bdf8);
  opacity: 0.85;
}
.kpi-card.hero { min-height: 104px; }
.kpi-card.meta {
  min-height: 76px;
  background: #fff;
  box-shadow: none;
}
.kpi-card.meta::before {
  background: #94a3b8;
  opacity: 0.55;
}
.kpi-label {
  font-size: 12px;
  color: #64748b;
  line-height: 1.3;
}
.kpi-value {
  margin-top: 10px;
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
  letter-spacing: -0.02em;
}
.kpi-value.lg { font-size: 26px; }
.gold { color: var(--ops-gold, #f59e0b); font-weight: 700; }

.table-panel {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.table-panel :deep(.el-table) {
  --el-table-header-bg-color: #f1f5f9;
  --el-table-row-hover-bg-color: #eff6ff;
  --el-table-border-color: #e2e8f0;
}
.table-panel :deep(.el-table th.el-table__cell) {
  color: #475569;
  font-weight: 600;
  background: #f1f5f9 !important;
}
.table-panel :deep(.el-table--border::after),
.table-panel :deep(.el-table--border::before),
.table-panel :deep(.el-table__inner-wrapper::before) {
  display: none;
}
.table-panel :deep(.el-table--border) {
  border: 0;
}
.table-panel :deep(.room-by-table) {
  width: 100%;
}
.table-panel :deep(.room-by-table .cell) {
  padding-left: 6px;
  padding-right: 6px;
  text-align: center;
}
.table-panel :deep(.room-by-table th.el-table__cell > .cell) {
  justify-content: center;
}
.table-panel :deep(.room-by-table .caret-wrapper) {
  margin-left: 2px;
}

@media (max-width: 1280px) {
  .report-summary { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
  .report-summary .sum-chip { border-bottom: 1px solid #f1f5f9; }
  .report-summary .sum-chip:nth-child(3n) { border-right: none; }
}
@media (max-width: 1200px) {
  .kpi-grid.cols-6 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .kpi-grid.cols-5 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .kpi-grid.cols-4,
  .kpi-grid.cols-5,
  .kpi-grid.cols-6 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .report-summary { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .report-summary .sum-chip:nth-child(3n) { border-right: 1px solid #f1f5f9; }
  .report-summary .sum-chip:nth-child(2n) { border-right: none; }
}

.cell-name {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.35;
}
.cell-meta {
  margin-top: 2px;
  font-size: 11px;
  color: #64748b;
  line-height: 1.35;
}
.room-name {
  margin-top: 2px;
  font-size: 12px;
  color: #64748b;
}
.bet-more {
  margin-top: 8px;
  font-size: 12px;
  color: #64748b;
  text-align: right;
}

.dlg-room-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 13px;
  color: #64748b;
}
.dlg-room-actions { display: flex; gap: 4px 8px; }
.room-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 360px;
  overflow: auto;
}
.room-check {
  margin: 0 !important;
  height: auto !important;
  padding: 7px 10px !important;
}
.room-check .rc-no {
  font-weight: 600;
  color: #0f172a;
  margin-right: 6px;
}
.room-check .rc-name {
  color: #64748b;
  font-size: 12px;
}
.room-empty { font-size: 13px; color: #94a3b8; }

@media (max-width: 1200px) {
  .kpi-grid.cols-5,
  .kpi-grid.cols-4 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .kpi-grid .sum-chip { border-right: 1px solid #f1f5f9; }
  .kpi-grid .sum-chip:nth-child(3n) { border-right: none; }
}
@media (max-width: 720px) {
  .kpi-grid.cols-5,
  .kpi-grid.cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kpi-grid .sum-chip:nth-child(3n) { border-right: 1px solid #f1f5f9; }
  .kpi-grid .sum-chip:nth-child(2n) { border-right: none; }
  .kpi-hero { flex-direction: column; align-items: flex-start; gap: 4px; }
}
</style>
