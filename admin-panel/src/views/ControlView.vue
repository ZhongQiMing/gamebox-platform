<template>
  <div class="desk-work control-page">
    <div class="desk-panel">
      <PageHeader title="控奖中心">
        <template #actions>
          <el-button :loading="loading || gscLoading" @click="refresh">刷新</el-button>
          <el-button type="primary" @click="openBiasDlg()">新建偏置</el-button>
        </template>
      </PageHeader>

      <div class="gsc-toolbar" v-loading="gscLoading">
        <div class="gsc-title">
          <span class="gsc-title-main">全局软控</span>
          <span class="gsc-title-sub">{{ gscStatusLine }}</span>
        </div>
        <div class="gsc-actions">
          <span class="gsc-switch-label">{{ gscForm.enabled ? '已开启' : '已关闭' }}</span>
          <el-switch
            v-model="gscForm.enabled"
            :loading="gscSaving"
            @change="onToggleEnabled"
          />
          <el-button size="small" @click="openGscDlg">调整参数</el-button>
        </div>
      </div>

      <div class="control-scroll" v-loading="gscLoading">
        <!-- ① 共盘日账：彩票+牌桌 -->
        <section class="control-sec">
          <div class="sec-label">
            <span>① 共盘日账</span>
            <span class="sec-label-sub">彩票 + 牌桌 · 上海自然日 · 定调控档</span>
          </div>

          <div class="kpi-head">当日实绩</div>
          <div class="rooms-summary cols-6">
            <div class="sum-chip">
              <span class="sum-label">调控模式</span>
              <span class="sum-val" :class="modeTone">{{ gsc?.modeLabel || '—' }}</span>
              <span class="sum-note">{{ modeNote }}</span>
              <span v-if="gsc?.modeHour" class="sum-note">档位 {{ gsc.modeHour }}（上海）· 整点重核</span>
            </div>
            <div class="sum-chip">
              <span class="sum-label">当日流水 F</span>
              <span class="sum-val">{{ fmtMoney(gsc?.stats.stake ?? 0) }}</span>
              <span class="sum-note">有效投注 · {{ betCountNote }}</span>
            </div>
            <div class="sum-chip">
              <span class="sum-label">庄家盈亏 G</span>
              <span class="sum-val" :class="houseTone">{{ fmtSigned(gsc?.stats.house ?? 0) }}</span>
              <span class="sum-note">流水 − 派彩 · 正=庄赢</span>
            </div>
            <div class="sum-chip">
              <span class="sum-label">代理佣金 C</span>
              <span class="sum-val">{{ fmtMoney(gsc?.stats.commission ?? 0) }}</span>
              <span class="sum-note">回水总额 {{ gscForm.commissionRatePct }}% × F</span>
            </div>
            <div class="sum-chip">
              <span class="sum-label">日净利率 R</span>
              <span class="sum-val" :class="netTone">{{ netPctText }}</span>
              <span class="sum-note">(G − C) ÷ F</span>
            </div>
            <div class="sum-chip">
              <span class="sum-label">相对目标带</span>
              <span class="sum-val" :class="bandTone">{{ bandDeltaText }}</span>
              <span class="sum-note">{{ bandDeltaNote }}</span>
            </div>
          </div>

          <div class="kpi-head">对照中轴</div>
          <div class="rooms-summary cols-4">
            <div class="sum-chip">
              <span class="sum-label">目标庄家盈亏</span>
              <span class="sum-val">{{ fmtMoney(gsc?.stats.targetHouseNet ?? 0) }}</span>
              <span class="sum-note">F × {{ gscForm.targetNetPct }}% + C</span>
            </div>
            <div class="sum-chip">
              <span class="sum-label">相对中轴盈亏</span>
              <span class="sum-val" :class="gapTone">{{ overageText }}</span>
              <span class="sum-note">{{ overageNote }}</span>
            </div>
            <div class="sum-chip">
              <span class="sum-label">开盘门槛</span>
              <span class="sum-val" :class="gsc?.stats.underMinFlow ? 'warn' : 'ok'">
                {{ fmtMoney(gscForm.minFlowToControl) }}
              </span>
              <span class="sum-note">{{ gsc?.stats.underMinFlow ? '流水未达标 · 强制自然开奖' : '已达门槛 · 可进入调控' }}</span>
            </div>
            <div class="sum-chip">
              <span class="sum-label">单期开档线</span>
              <span class="sum-val iron-val">亏超{{ gscForm.maxPeriodLossPct }}% 才挑号</span>
              <span class="sum-note">只看本期总注与总派彩，不认玩法；覆盖打法亏得少，进不了这层</span>
            </div>
          </div>

          <div class="kpi-head">
            慢性失血档位（近 {{ gsc?.gear?.cycleHours || 48 }} 小时 · 按游戏独立 · 只收紧单期门槛）
          </div>
          <div class="cooldown-panel">
            <div class="cooldown-summary">
              <span class="cooldown-summary-label">开关</span>
              <span class="cooldown-summary-val" :class="gearTone">{{ gearHeadline }}</span>
              <span class="cooldown-summary-note">{{ gearNote }}</span>
            </div>
            <div v-if="gearGames.length" class="cooldown-games">
              <div
                v-for="g in gearGames"
                :key="g.gameCode"
                class="cooldown-game"
                :class="{ on: g.gear !== 'NORMAL', off: g.gear === 'NORMAL' }"
              >
                <span class="cooldown-game-name">{{ gearGameName(g) }}</span>
                <span class="cooldown-game-code">
                  {{ g.netPct == null ? '无流水' : `留存 ${g.netPct}%` }}
                </span>
                <span class="cooldown-game-st">{{ gearLabel(g.gear) }}</span>
              </div>
            </div>
            <div v-else class="cooldown-empty">暂无共盘游戏清单</div>
          </div>
        </section>

        <!-- ② 街机资金池：独立一块，不进共盘日账 -->
        <section class="control-sec">
          <div class="sec-label">
            <span>② 街机资金池</span>
            <span class="sec-label-sub">
              一游戏一口 · 只看近 {{ gscForm.arcadePoolWindowDays || 14 }} 天 · 不参与房间偏置 · 无控后冷却
            </span>
          </div>
          <template v-if="(gsc?.arcadePools || []).length">
            <div
              v-for="p in gsc?.arcadePools || []"
              :key="p.gameCode"
              class="rooms-summary cols-4 arcade-row"
            >
              <div class="sum-chip">
                <span class="sum-label">{{ p.name }}</span>
                <span class="sum-val code-val">{{ p.gameCode }}</span>
                <span class="sum-note">{{ p.betCount }} 笔 · 近 {{ p.windowDays }} 天</span>
              </div>
              <div class="sum-chip">
                <span class="sum-label">池余额</span>
                <span class="sum-val" :class="p.balance >= 0 ? 'ok' : 'warn'">{{ fmtSigned(p.balance) }}</span>
                <span class="sum-note">流水 {{ fmtMoney(p.stake) }} − 派彩 {{ fmtMoney(p.payout) }}</span>
              </div>
              <div class="sum-chip">
                <span class="sum-label">目标余额</span>
                <span class="sum-val">{{ fmtMoney(p.targetBalance) }}</span>
                <span class="sum-note">窗口流水 × {{ ((1 - (gscForm.arcadeRtpTarget || 0.92)) * 100).toFixed(0) }}% 留存</span>
              </div>
              <div class="sum-chip">
                <span class="sum-label">相对目标</span>
                <span class="sum-val" :class="Math.abs(p.balanceGap) < 0.01 ? 'ok' : 'warn'">
                  {{ p.balanceGap >= 0 ? `厚 ${fmtMoney(p.balanceGap)}` : `薄 ${fmtMoney(Math.abs(p.balanceGap))}` }}
                </span>
                <span class="sum-note">返还 {{ p.rtp == null ? '—' : `${(p.rtp * 100).toFixed(1)}%` }}</span>
              </div>
            </div>
          </template>
          <div v-else class="sec-empty">暂无街机池数据</div>
        </section>

        <!-- ③ 偏置策略：仅共盘 -->
        <section class="control-sec control-sec-bias">
          <div class="sec-label">
            <span>③ 偏置策略</span>
            <span class="sec-label-sub">仅彩票/牌桌 · 启用中最多 {{ MAX_ACTIVE_BIAS }} 条 · 达标自动停</span>
          </div>
          <div class="rooms-summary cols-3">
            <div class="sum-chip">
              <span class="sum-label">启用中</span>
              <span class="sum-val" :class="biasEnabledCount >= MAX_ACTIVE_BIAS ? 'warn' : 'ok'">
                {{ biasEnabledCount }}/{{ MAX_ACTIVE_BIAS }}
              </span>
              <span class="sum-note">满额后须先停用或删除旧策略</span>
            </div>
            <div class="sum-chip">
              <span class="sum-label">已停用</span>
              <span class="sum-val muted">{{ biasDisabledCount }}</span>
              <span class="sum-note">含已达标自动停</span>
            </div>
            <div class="sum-chip">
              <span class="sum-label">全部</span>
              <span class="sum-val">{{ biases.length }}</span>
              <span class="sum-note">列表含停用记录</span>
            </div>
          </div>

          <div class="panel-body bias-body">
            <el-table
              :data="biases"
              v-loading="loading"
              class="control-table"
              stripe
              border
              size="small"
              height="100%"
              empty-text="暂无偏置。房间亏三万→回血填三万；放水/玩家同样填金额。请先开启全局软控"
            >
          <el-table-column label="偏置类型" min-width="160">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ row.kindLabel }}</div>
              <div class="cell-meta">
                <template v-if="row.goalAmount != null">
                  进度 {{ row.strengthLabel }}
                  <template v-if="row.progressPct != null"> · {{ row.progressPct }}%</template>
                </template>
                <template v-else>目标 {{ row.strengthLabel || row.biasPctLabel || '—' }}</template>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="作用对象" min-width="200">
            <template #default="{ row }: { row: any }">
              <div class="cell-name">{{ row.room?.name || '—' }}</div>
              <div class="cell-meta">
                <template v-if="row.room">房号 {{ row.room.roomNo }}</template>
                <template v-if="row.player">
                  · {{ row.player.nickname || '玩家' }}（{{ row.player.uid }}）
                </template>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="120">
            <template #default="{ row }: { row: any }">
              <span class="cell-meta">{{ row.remark || '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }: { row: any }">
              <el-tag v-if="row.enabled" type="success" size="small" effect="plain">已启用</el-tag>
              <el-tag v-else-if="row.exhausted" type="warning" size="small" effect="plain">已达标</el-tag>
              <el-tag v-else type="info" size="small" effect="plain">已停用</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right" align="right">
            <template #default="{ row }: { row: any }">
              <el-button
                v-if="row.enabled"
                link
                type="warning"
                @click="toggleBias(row, false)"
              >停用</el-button>
              <el-button
                v-else
                link
                type="primary"
                @click="toggleBias(row, true)"
              >启用</el-button>
              <el-button link type="danger" @click="removeBias(row)">删除</el-button>
            </template>
          </el-table-column>
            </el-table>
          </div>
        </section>

        <section v-if="legacyList.length" class="control-sec">
          <div class="sec-label">
            <span>历史定向策略</span>
            <span class="sec-label-sub">已全部停用且开奖不再读取；仅可删除清理</span>
          </div>
          <div class="panel-body legacy-body">
            <el-table :data="legacyList" size="small" border stripe max-height="220">
              <el-table-column prop="name" label="名称" min-width="140" />
              <el-table-column label="类型" width="120">
                <template #default="{ row }: { row: any }">{{ legacyModeLabel(row) }}</template>
              </el-table-column>
              <el-table-column label="房间" min-width="120">
                <template #default="{ row }: { row: any }">{{ row.room?.name || '—' }}</template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }: { row: any }">{{ row.status }}</template>
              </el-table-column>
              <el-table-column label="操作" width="90" align="right">
                <template #default="{ row }: { row: any }">
                  <el-button link type="danger" @click="removeLegacy(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </section>
      </div>
    </div>

    <DeskDialog
      v-model="biasDlg"
      title="新建偏置策略"
      subtitle="填累计目标金额 · 正常开奖只按偏置挑 · 日账越界时日账优先"
      width="480px"
    >
      <div class="dlg-body">
        <el-form label-position="top" class="form">
          <el-form-item label="偏置类型" required>
            <div class="kind-grid">
              <button
                v-for="k in biasKindOpts"
                :key="k.value"
                type="button"
                class="kind-chip"
                :class="{ on: biasForm.kind === k.value }"
                @click="onBiasKindPick(k.value)"
              >
                <span class="kind-chip-name">{{ k.label }}</span>
                <span class="kind-chip-desc">{{ k.desc }}</span>
              </button>
            </div>
          </el-form-item>

          <div class="form-row">
            <el-form-item label="目标房间" required class="grow">
              <el-select
                v-model="biasForm.roomId"
                filterable
                placeholder="选择房间"
                style="width:100%"
                @change="onBiasRoomChange"
              >
                <el-option
                  v-for="r in rooms"
                  :key="r.id"
                  :label="`${r.name}（${r.roomNo}）`"
                  :value="r.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="累计目标" required class="weight-item">
              <div class="num-wrap">
                <el-input-number
                  v-model="biasForm.goalAmount"
                  :min="1"
                  :max="10000000"
                  :step="100"
                  controls-position="right"
                />
                <span class="unit">元</span>
              </div>
            </el-form-item>
          </div>

          <el-form-item v-if="isPlayerBias" label="目标玩家" required>
            <el-select
              v-model="biasForm.playerId"
              filterable
              remote
              clearable
              reserve-keyword
              :remote-method="searchPlayers"
              :loading="playerLoading"
              placeholder="搜索昵称 / UID / 账号"
              style="width:100%"
            >
              <el-option
                v-for="p in playerOpts"
                :key="p.id"
                :label="`${p.nickname || '—'} · ${p.username || '—'}（${p.uid}）`"
                :value="p.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="备注">
            <el-input
              v-model="biasForm.remark"
              maxlength="80"
              :placeholder="biasGoalHint"
              show-word-limit
            />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="biasDlg = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button type="primary" :loading="saving" @click="onCreateBias">创建</el-button>
      </template>
    </DeskDialog>

    <DeskDialog
      v-model="gscDlg"
      title="全局软控参数"
      :subtitle="gscUnlocked ? '已解锁 · 修改后点保存将重新上锁' : '已上锁 · 查看参数，修改请先解锁'"
      width="560px"
      @closed="lockGscEdit"
    >
      <div class="dlg-body">
        <div class="gsc-lock-bar" :class="{ on: gscUnlocked }">
          <span>{{ gscUnlocked ? '已解锁，可修改' : '已上锁，仅可查看' }}</span>
          <el-button
            v-if="!gscUnlocked"
            size="small"
            type="warning"
            :loading="gscUnlocking"
            @click="unlockGscEdit"
          >解锁</el-button>
          <el-button v-else size="small" @click="lockGscEdit">重新上锁</el-button>
        </div>
        <el-form label-position="top" class="form" :disabled="!gscUnlocked">
          <div class="dlg-block">
            <div class="dlg-block-hd">共盘日账目标（彩票+牌桌 · R = (G − C) ÷ F）</div>
            <div class="form-row">
              <el-form-item label="开盘流水门槛 F" class="grow" required>
                <div class="num-wrap">
                  <el-input-number
                    v-model="gscEdit.minFlowToControl"
                    :min="0"
                    :max="10000000"
                    :step="1000"
                    controls-position="right"
                  />
                </div>
              </el-form-item>
              <el-form-item label="目标中轴 R*" class="grow" required>
                <div class="num-wrap">
                  <el-input-number
                    v-model="gscEdit.targetNetPct"
                    :min="0"
                    :max="30"
                    :step="0.5"
                    controls-position="right"
                  />
                  <span class="unit">%</span>
                </div>
              </el-form-item>
            </div>
            <div class="form-row">
              <el-form-item label="目标带下限" class="grow">
                <div class="num-wrap">
                  <el-input-number v-model="gscEdit.bandLowPct" :step="0.5" controls-position="right" />
                  <span class="unit">%</span>
                </div>
              </el-form-item>
              <el-form-item label="目标带上限" class="grow">
                <div class="num-wrap">
                  <el-input-number v-model="gscEdit.bandHighPct" :step="0.5" controls-position="right" />
                  <span class="unit">%</span>
                </div>
              </el-form-item>
            </div>
            <div class="field-readonly-hint">中轴须落在目标带内（下限 ≤ 中轴 ≤ 上限），否则过热/偏低时会往带外拉</div>
            <el-form-item label="佣金估算率">
              <div class="num-wrap narrow">
                <el-input-number
                  :model-value="gscEdit.commissionRatePct"
                  disabled
                  controls-position="right"
                />
                <span class="unit">%</span>
              </div>
              <div class="field-readonly-hint">只读 · 同步「回水规则 → 回水总额」</div>
            </el-form-item>
          </div>

          <div class="dlg-block">
            <div class="dlg-block-hd">街机单游戏资金池（各游戏独立 · 只看窗口内）</div>
            <el-form-item label="目标返还率" required>
              <div class="num-wrap">
                <el-input-number
                  v-model="gscEdit.arcadeRtpTarget"
                  :min="0.3"
                  :max="0.99"
                  :step="0.01"
                  :precision="3"
                  controls-position="right"
                />
              </div>
              <div class="field-readonly-hint">
                例 0.92 → 希望池余额≈流水×8%；一游戏一口池，互不影响
              </div>
            </el-form-item>
            <div class="form-row">
              <el-form-item label="街机试号" class="grow">
                <div class="num-wrap">
                  <el-input-number
                    v-model="gscEdit.arcadeCandidateTries"
                    :min="1"
                    :max="50"
                    controls-position="right"
                  />
                  <span class="unit">次</span>
                </div>
                <div class="field-readonly-hint">与共盘试号分开；试号越多越压爆率</div>
              </el-form-item>
              <el-form-item label="统计窗口" class="grow">
                <div class="num-wrap">
                  <el-input-number
                    v-model="gscEdit.arcadePoolWindowDays"
                    :min="1"
                    :max="365"
                    controls-position="right"
                  />
                  <span class="unit">天</span>
                </div>
                <div class="field-readonly-hint">
                  窗口外的盈亏永久落袋，不会在之后的开奖里吐回去
                </div>
              </el-form-item>
            </div>
          </div>

          <div class="dlg-block">
            <div class="dlg-block-hd">共盘单期铁律（自然亏超触发线才挑号；候选亏超此线非法）</div>
            <div class="form-row">
              <el-form-item label="单期亏损触发线" class="grow">
                <div class="num-wrap">
                  <el-input-number
                    v-model="gscEdit.maxPeriodLossPct"
                    :min="1"
                    :max="100"
                    :step="1"
                    controls-position="right"
                  />
                  <span class="unit">%</span>
                </div>
              </el-form-item>
              <el-form-item label="庄赢上限（已停用）" class="grow">
                <div class="num-wrap">
                  <el-input-number
                    v-model="gscEdit.maxPeriodWinPct"
                    :min="5"
                    :max="100"
                    :step="1"
                    :disabled="true"
                    controls-position="right"
                  />
                  <span class="unit">%</span>
                </div>
              </el-form-item>
            </div>
            <div class="dlg-hint">
              挑号目标亏损约 30%（代码常量）。庄赢上限字段保留兼容，不再参与铁律过滤。
            </div>
          </div>

          <div class="dlg-block last">
            <div class="dlg-block-hd">试号与缓刹（仅共盘 · 不影响街机）</div>
            <div class="form-row">
              <el-form-item label="轻微试号" class="grow">
                <div class="num-wrap">
                  <el-input-number
                    v-model="gscEdit.candidateTries"
                    :min="1"
                    :max="50"
                    controls-position="right"
                  />
                  <span class="unit">次</span>
                </div>
              </el-form-item>
              <el-form-item label="偏热试号" class="grow">
                <div class="num-wrap">
                  <el-input-number
                    v-model="gscEdit.candidateTriesHalt"
                    :min="1"
                    :max="80"
                    controls-position="right"
                  />
                  <span class="unit">次</span>
                </div>
              </el-form-item>
              <el-form-item label="加强试号" class="grow">
                <div class="num-wrap">
                  <el-input-number
                    v-model="gscEdit.candidateTriesBoost"
                    :min="1"
                    :max="80"
                    controls-position="right"
                  />
                  <span class="unit">次</span>
                </div>
              </el-form-item>
            </div>
            <div class="form-row bottom">
              <el-form-item label="单人缓刹" class="switch-item">
                <el-switch v-model="gscEdit.playerBrakeEnabled" :disabled="!gscUnlocked" />
              </el-form-item>
              <el-form-item label="缓刹倍数" class="grow">
                <div class="num-wrap">
                  <el-input-number
                    v-model="gscEdit.playerBrakeMultiple"
                    :min="1"
                    :max="20"
                    :step="0.5"
                    :disabled="!gscUnlocked || !gscEdit.playerBrakeEnabled"
                    controls-position="right"
                  />
                  <span class="unit">倍</span>
                </div>
              </el-form-item>
            </div>
            <div class="field-readonly-hint" style="margin-top:-4px;margin-bottom:8px">
              按房计算：该房净赢≥该房净带入×倍数则碰线；共盘挑号在铁律内优先压碰线玩家派彩，不突破单期铁律
            </div>
            <div class="form-row bottom">
              <el-form-item label="失血档位" class="grow">
                <el-select v-model="gscEdit.gearMode" :disabled="!gscUnlocked">
                  <el-option label="自动（按 48 小时周期账）" value="AUTO" />
                  <el-option label="强制正常" value="FORCE_NORMAL" />
                  <el-option label="强制回收" value="FORCE_RECOVER" />
                </el-select>
              </el-form-item>
              <div class="field-readonly-hint" style="flex:1;padding-top:8px">
                回收档把开档线收到 30%、目标压到持平；强回收 15% / 庄赢 10%。
                控后冷却已停用：冷却期会把防爆权让出去，改由单期金额门约束干预频率
              </div>
            </div>
          </div>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="gscDlg = false">取消</el-button>
        <span class="win-footer-grow" />
        <el-button
          v-if="!gscUnlocked"
          type="warning"
          :loading="gscUnlocking"
          @click="unlockGscEdit"
        >解锁</el-button>
        <el-button
          v-else
          type="primary"
          :loading="gscSaving"
          @click="saveGsc"
        >保存</el-button>
      </template>
    </DeskDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '@/components/PageHeader.vue'
import DeskDialog from '@/components/DeskDialog.vue'
import {
  consoleApi,
  type ConsoleRoom,
  type ControlPolicy,
  type GlobalSoftBias,
  type GlobalSoftControlConfig,
  type GlobalSoftControlOverview,
} from '@/api/console'
import { gameLabel } from '@/utils/labels'

const rooms = ref<ConsoleRoom[]>([])
const biases = ref<GlobalSoftBias[]>([])
const legacyList = ref<ControlPolicy[]>([])
const loading = ref(false)
const saving = ref(false)
const biasDlg = ref(false)

const gsc = ref<GlobalSoftControlOverview | null>(null)
const gscLoading = ref(false)
const gscSaving = ref(false)
const gscDlg = ref(false)
const gscUnlocked = ref(false)
const gscUnlocking = ref(false)
const gscUnlockPwd = ref('')
const defaultGsc = (): GlobalSoftControlConfig => ({
  enabled: false,
  minFlowToControl: 50000,
  targetNetPct: 4,
  bandLowPct: 2,
  bandHighPct: 6,
  maxPeriodWinPct: 40,
  maxPeriodLossPct: 50,
  commissionRatePct: 5,
  candidateTries: 8,
  candidateTriesHalt: 16,
  candidateTriesBoost: 20,
  playerBrakeEnabled: true,
  playerBrakeMultiple: 4,
  arcadeRtpTarget: 0.92,
  arcadeCandidateTries: 3,
  arcadePoolWindowDays: 14,
  cooldownEnabled: false,
  gearMode: 'AUTO',
})
const gscForm = reactive(defaultGsc())
const gscEdit = reactive(defaultGsc())

type PlayerOpt = { id: string; nickname: string; username: string; uid: string }
const playerOpts = ref<PlayerOpt[]>([])
const playerLoading = ref(false)

type BiasKind = 'ROOM_RECOVER' | 'ROOM_RELEASE' | 'PLAYER_WIN' | 'PLAYER_LOSE'
const biasForm = reactive({
  kind: 'ROOM_RECOVER' as BiasKind,
  roomId: '',
  playerId: '',
  goalAmount: 30000,
  remark: '',
})
const biasKindOpts: Array<{ value: BiasKind; label: string; desc: string }> = [
  { value: 'ROOM_RECOVER', label: '房间回血', desc: '庄家累计净赢满额停' },
  { value: 'ROOM_RELEASE', label: '房间放水', desc: '庄家累计净亏满额停' },
  { value: 'PLAYER_WIN', label: '玩家偏赢', desc: '累计净赢满额停' },
  { value: 'PLAYER_LOSE', label: '玩家偏输', desc: '累计净输满额停' },
]
const biasGoalHint = computed(() => {
  if (biasForm.kind === 'ROOM_RECOVER') {
    return `该房庄家累计净赢满 ${biasForm.goalAmount} 元后自动停；每期尽量偏赢`
  }
  if (biasForm.kind === 'ROOM_RELEASE') {
    return `该房庄家累计净亏满 ${biasForm.goalAmount} 元后自动停；每期尽量偏输`
  }
  if (biasForm.kind === 'PLAYER_WIN') {
    return `累计净赢满 ${biasForm.goalAmount} 元后自动停；每期尽量偏赢，不保证单期金额`
  }
  if (biasForm.kind === 'PLAYER_LOSE') {
    return `累计净输满 ${biasForm.goalAmount} 元后自动停；每期尽量偏输`
  }
  return '选填备注'
})

const isPlayerBias = computed(() =>
  biasForm.kind === 'PLAYER_WIN' || biasForm.kind === 'PLAYER_LOSE',
)
/** 与后端 MAX_ACTIVE_SOFT_BIAS 一致 */
const MAX_ACTIVE_BIAS = 10
const biasEnabledCount = computed(() => biases.value.filter((b) => b.enabled).length)
const biasDisabledCount = computed(() => biases.value.filter((b) => !b.enabled).length)

const netPctText = computed(() => {
  const v = gsc.value?.stats.netPct
  if (v == null) return '—'
  return `${Number(v).toFixed(2)}%`
})
const netTone = computed(() => {
  const v = gsc.value?.stats.netPct
  if (v == null) return 'muted'
  if (v < 0) return 'warn'
  if (v >= gscForm.bandLowPct && v <= gscForm.bandHighPct) return 'ok'
  if (v > gscForm.bandHighPct) return 'warn'
  return ''
})
const houseTone = computed(() => {
  const h = gsc.value?.stats.house
  if (h == null) return 'muted'
  if (h > 0) return 'ok'
  if (h < 0) return 'warn'
  return 'muted'
})
const modeTone = computed(() => {
  const m = gsc.value?.mode
  if (m === 'OFF') return 'muted'
  if (m === 'IDLE') return 'ok'
  if (m === 'BOOST' || m === 'HALT') return 'warn'
  return ''
})
const modeNote = computed(() => {
  const m = gsc.value?.mode
  if (!gscForm.enabled || m === 'OFF') return '软控关闭 · 全品类自然开奖'
  if (gsc.value?.stats.underMinFlow) return '未达开盘门槛 · 自然开奖'
  if (m === 'IDLE') {
    return biasEnabledCount.value > 0
      ? 'R 在带内 · 偏置次级排序 · 档位本小时锁定'
      : 'R 在目标带内 · 自然开奖 · 档位本小时锁定'
  }
  if (m === 'STEER') return 'R 偏低 · 轻度调控 · 档位本小时锁定'
  if (m === 'BOOST') return 'R < 0 · 加强调控 · 档位本小时锁定'
  if (m === 'HALT') return 'R 偏高 · 过热回拉 · 档位本小时锁定'
  return '整点小时兜底重核'
})
const betCountNote = computed(() => {
  const n = gsc.value?.stats.betCount
  return n != null ? `${n} 笔` : '—'
})
/** 相对目标带：展示相对上下限的百分点差，不重复展示绝对 R */
const bandDeltaText = computed(() => {
  const v = gsc.value?.stats.netPct
  if (v == null) return '—'
  if (v > gscForm.bandHighPct) {
    return `高出上限 +${(v - gscForm.bandHighPct).toFixed(2)}pp`
  }
  if (v < gscForm.bandLowPct) {
    return `低于下限 −${(gscForm.bandLowPct - v).toFixed(2)}pp`
  }
  return '在带内'
})
const bandDeltaNote = computed(() => {
  const v = gsc.value?.stats.netPct
  const band = `目标带 ${gscForm.bandLowPct}%～${gscForm.bandHighPct}%`
  if (v == null) return band
  return `当前 R=${v.toFixed(2)}% · ${band}`
})
const bandTone = computed(() => {
  const v = gsc.value?.stats.netPct
  if (v == null) return 'muted'
  if (v >= gscForm.bandLowPct && v <= gscForm.bandHighPct) return 'ok'
  return 'warn'
})
/** 相对中轴：G − 目标庄家盈亏；正=多赢，负=少赢 */
const overage = computed(() => {
  const s = gsc.value?.stats
  if (!s || !s.stake) return null
  return Number(s.house) - Number(s.targetHouseNet)
})
const overageText = computed(() => {
  const v = overage.value
  if (v == null) return '—'
  if (Math.abs(v) < 0.01) return '0'
  return v > 0 ? `多赢 ${fmtMoney(v)}` : `少赢 ${fmtMoney(Math.abs(v))}`
})
const gapTone = computed(() => {
  const v = overage.value
  if (v == null) return 'muted'
  if (Math.abs(v) < 0.01) return 'ok'
  return 'warn'
})
const overageNote = computed(() => {
  const v = overage.value
  if (v == null) return '无流水时不计'
  if (Math.abs(v) < 0.01) return '已贴合中轴'
  if (v > 0) return '实际 G 高于中轴目标 · 需回落'
  return '实际 G 低于中轴目标 · 需回升'
})
const GEAR_LABEL: Record<string, string> = {
  NORMAL: '正常',
  RECOVER: '回收档',
  STRONG: '强回收',
}
function gearLabel(g: string) {
  return GEAR_LABEL[g] || g
}
/** 优先库内中文名；别名/缺名时用后台标签 */
function gearGameName(g: { gameCode: string; name: string }) {
  const n = String(g.name || '').trim()
  if (n && n !== g.gameCode) return n
  return gameLabel(g.gameCode)
}
const gearGames = computed(() => gsc.value?.gear?.games || [])
const gearActiveCount = computed(
  () => gearGames.value.filter((g) => g.gear !== 'NORMAL').length,
)
const gearTone = computed(() => {
  if (!gscForm.enabled) return 'muted'
  if (gscForm.gearMode === 'FORCE_RECOVER') return 'warn'
  return gearActiveCount.value > 0 ? 'warn' : 'ok'
})
const gearHeadline = computed(() => {
  if (gscForm.gearMode === 'FORCE_NORMAL') return '强制正常'
  if (gscForm.gearMode === 'FORCE_RECOVER') return '强制回收'
  const n = gearActiveCount.value
  return n ? `自动 · ${n} 个游戏收紧中` : '自动 · 全部正常'
})
const gearNote = computed(() => {
  const g = gsc.value?.gear
  if (!g) return '按 48 小时周期账定档'
  if (gscForm.gearMode !== 'AUTO') return '手动锁定中，忽略周期账'
  return `亏超 ${Math.abs(g.enterRecoverPct)}% 进回收、`
    + `亏超 ${Math.abs(g.enterStrongPct)}% 进强回收；`
    + `回到 ${g.exitPct}% 以上才退档（周期流水需满 ${fmtMoney(g.minCycleFlow)}）`
})
const gscStatusLine = computed(() => {
  if (!gscForm.enabled) return '已关闭：共盘日账与街机池均自然开奖'
  if (gsc.value?.stats.underMinFlow) {
    return `流水未达开盘门槛 ${fmtMoney(gscForm.minFlowToControl)}，维持自然开奖`
  }
  const m = gsc.value?.mode
  const r = netPctText.value
  if (m === 'IDLE') {
    return biasEnabledCount.value > 0
      ? `R=${r} 在目标带内 · 偏置次级`
      : `R=${r} 在目标带内 · 自然开奖`
  }
  if (m === 'STEER') return `R=${r} 低于目标带 · 轻度调控`
  if (m === 'BOOST') return `R=${r} < 0 · 加强调控`
  if (m === 'HALT') return `R=${r} 高于目标带 · 过热回拉`
  return '上海日账软控'
})

function fmtMoney(n: number) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}
function fmtSigned(n: number) {
  const v = Number(n || 0)
  const body = Math.abs(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  if (v > 0) return `+${body}`
  if (v < 0) return `−${body}`
  return body
}
function legacyModeLabel(row: ControlPolicy) {
  const m = row.mode || row.targetType
  return ({ HOUSE_HOLD_RATIO: '历史·房间留存', PLAYER_WIN: '历史·玩家偏赢', PLAYER_LOSE: '历史·玩家偏输' } as Record<string, string>)[m] || m
}

function applyGscOverview(o: GlobalSoftControlOverview) {
  gsc.value = o
  Object.assign(gscForm, o.config)
}

async function loadGsc() {
  gscLoading.value = true
  try {
    applyGscOverview(await consoleApi.globalSoftControl())
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '加载全局软控失败')
  } finally {
    gscLoading.value = false
  }
}

function openGscDlg() {
  Object.assign(gscEdit, { ...gscForm })
  lockGscEdit()
  gscDlg.value = true
}

function lockGscEdit() {
  gscUnlocked.value = false
  gscUnlockPwd.value = ''
}

async function unlockGscEdit() {
  try {
    const { value } = await ElMessageBox.prompt(
      '请输入当前管理员登录密码以解锁参数',
      '解锁全局软控参数',
      {
        confirmButtonText: '解锁',
        cancelButtonText: '取消',
        inputType: 'password',
        inputPlaceholder: '管理员密码',
        inputValidator: (v) => (!!v && String(v).length > 0) || '请输入密码',
      },
    )
    gscUnlocking.value = true
    await consoleApi.verifyAdminPassword(String(value))
    gscUnlockPwd.value = String(value)
    gscUnlocked.value = true
    ElMessage.success('已解锁，可修改参数')
  } catch (e: unknown) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error((e as { message?: string })?.message || '解锁失败')
  } finally {
    gscUnlocking.value = false
  }
}

async function onToggleEnabled(v: string | number | boolean) {
  const enabled = !!v
  gscSaving.value = true
  try {
    applyGscOverview(await consoleApi.saveGlobalSoftControl({ enabled }))
    ElMessage.success(enabled ? '全局软控已开启' : '全局软控已关闭')
  } catch (e: unknown) {
    gscForm.enabled = !enabled
    ElMessage.error((e as { message?: string })?.message || '切换失败')
  } finally {
    gscSaving.value = false
  }
}

async function saveGsc() {
  if (!gscUnlocked.value || !gscUnlockPwd.value) {
    ElMessage.warning('请先解锁再保存')
    return
  }
  const low = Number(gscEdit.bandLowPct)
  const high = Number(gscEdit.bandHighPct)
  const mid = Number(gscEdit.targetNetPct)
  if (!(low < high)) {
    ElMessage.warning('目标带下限须小于上限')
    return
  }
  if (mid < low || mid > high) {
    ElMessage.warning(`目标中轴须落在目标带内（${low}%～${high}%）`)
    return
  }
  gscSaving.value = true
  try {
    const {
      commissionRatePct: _ignoreCommission,
      ...gscPatch
    } = gscEdit
    applyGscOverview(await consoleApi.saveGlobalSoftControl({
      ...gscPatch,
      enabled: gscForm.enabled,
      adminPassword: gscUnlockPwd.value,
    }))
    lockGscEdit()
    gscDlg.value = false
    ElMessage.success('参数已保存并重新上锁')
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '保存失败')
  } finally {
    gscSaving.value = false
  }
}

function openBiasDlg() {
  if (biasEnabledCount.value >= MAX_ACTIVE_BIAS) {
    ElMessage.warning(`启用中偏置已达上限 ${MAX_ACTIVE_BIAS} 条，请先停用或删除旧策略`)
    return
  }
  biasForm.kind = 'ROOM_RECOVER'
  biasForm.roomId = rooms.value[0]?.id || ''
  biasForm.playerId = ''
  biasForm.goalAmount = 30000
  biasForm.remark = ''
  playerOpts.value = []
  biasDlg.value = true
}

function onBiasKindPick(kind: BiasKind) {
  biasForm.kind = kind
  if (kind !== 'PLAYER_WIN' && kind !== 'PLAYER_LOSE') {
    biasForm.playerId = ''
    return
  }
  if (biasForm.roomId) void searchPlayers('')
}

function onBiasRoomChange() {
  biasForm.playerId = ''
  playerOpts.value = []
  if (isPlayerBias.value && biasForm.roomId) void searchPlayers('')
}

async function searchPlayers(q: string) {
  if (!biasForm.roomId) {
    playerOpts.value = []
    return
  }
  playerLoading.value = true
  try {
    const res = await consoleApi.players({
      page: 1,
      pageSize: 20,
      q: q?.trim() || undefined,
      roomId: biasForm.roomId,
    })
    playerOpts.value = (res.list || []).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      username: p.username,
      uid: p.uid,
    }))
  } catch {
    playerOpts.value = []
  } finally {
    playerLoading.value = false
  }
}

/**
 * 偏置/控奖写操作前要管理员密码。
 * 这类操作能直接左右开奖结果，只认 JWT 的话 token 外泄就等于把盘口交出去。
 * 返回 null 表示用户取消。
 */
async function askAdminPassword(title: string): Promise<string | null> {
  try {
    const { value } = await ElMessageBox.prompt('请输入管理员密码以确认操作', title, {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      inputType: 'password',
      inputPlaceholder: '管理员登录密码',
      inputValidator: (v: string) => (v && v.length >= 6 ? true : '请输入管理员密码'),
    })
    return value || null
  } catch {
    return null
  }
}

async function onCreateBias() {
  if (!biasForm.roomId) return ElMessage.warning('请指定目标房间')
  if (isPlayerBias.value && !biasForm.playerId) return ElMessage.warning('请指定目标玩家')
  if (!(biasForm.goalAmount > 0)) return ElMessage.warning('请设置目标金额')
  const pwd = await askAdminPassword('创建偏置策略')
  if (!pwd) return
  saving.value = true
  try {
    biases.value = await consoleApi.softBiasCreate({
      kind: biasForm.kind,
      roomId: biasForm.roomId,
      playerId: isPlayerBias.value ? biasForm.playerId : undefined,
      goalAmount: biasForm.goalAmount,
      remark: biasForm.remark || undefined,
      enabled: true,
      adminPassword: pwd,
    })
    ElMessage.success('偏置策略已创建')
    biasDlg.value = false
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '创建失败')
  } finally {
    saving.value = false
  }
}

async function toggleBias(row: GlobalSoftBias, enabled: boolean) {
  if (enabled && !row.enabled && biasEnabledCount.value >= MAX_ACTIVE_BIAS) {
    ElMessage.warning(`启用中偏置已达上限 ${MAX_ACTIVE_BIAS} 条，请先停用或删除旧策略`)
    return
  }
  const pwd = await askAdminPassword(enabled ? '启用偏置' : '停用偏置')
  if (!pwd) {
    /* 取消后把开关拨回去，否则界面与后端不一致 */
    biases.value = [...biases.value]
    return
  }
  try {
    biases.value = await consoleApi.softBiasSetEnabled(row.id, enabled, pwd)
    ElMessage.success(enabled ? '已启用' : '已停用')
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '操作失败')
    biases.value = [...biases.value]
  }
}

async function removeBias(row: GlobalSoftBias) {
  try {
    await ElMessageBox.confirm(`确认删除偏置策略「${row.kindLabel}」？`, '删除偏置', {
      type: 'warning',
      confirmButtonText: '确认删除',
    })
  } catch {
    return
  }
  const pwd = await askAdminPassword('删除偏置策略')
  if (!pwd) return
  try {
    await consoleApi.softBiasDelete(row.id, pwd)
    biases.value = biases.value.filter((b) => b.id !== row.id)
    ElMessage.success('已删除')
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '删除失败')
  }
}

async function removeLegacy(row: ControlPolicy) {
  try {
    await ElMessageBox.confirm(`确认删除历史策略「${row.name}」？`, '删除策略', {
      type: 'warning',
      confirmButtonText: '确认删除',
    })
  } catch {
    return
  }
  const pwd = await askAdminPassword('删除历史策略')
  if (!pwd) return
  try {
    await consoleApi.controlDelete(row.id, pwd)
    legacyList.value = legacyList.value.filter((r) => r.id !== row.id)
    ElMessage.success('已删除')
  } catch (e: unknown) {
    ElMessage.error((e as { message?: string })?.message || '删除失败')
  }
}

async function refresh() {
  loading.value = true
  void loadGsc()
  try {
    const [biasRows, roomList, legacy] = await Promise.all([
      consoleApi.softBiasList().catch(() => [] as GlobalSoftBias[]),
      consoleApi.rooms().catch(() => [] as ConsoleRoom[]),
      consoleApi.controlList().catch(() => [] as ControlPolicy[]),
    ])
    biases.value = biasRows
    rooms.value = roomList
    legacyList.value = legacy
  } catch {
    ElMessage.error('无权或加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
</script>

<style scoped>
.control-page :deep(.ops-header) {
  margin: 0;
  padding: 14px 18px 12px;
  flex-shrink: 0;
}
.gsc-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.gsc-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gsc-title-main { font-size: 14px; font-weight: 700; color: #0f172a; }
.gsc-title-sub {
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gsc-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.gsc-switch-label { font-size: 12px; color: #64748b; }
.control-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #fff;
}
.control-sec {
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
}
.control-sec:last-child { border-bottom: none; }
.control-sec-bias {
  display: flex;
  flex-direction: column;
  min-height: 360px;
}
.kpi-head {
  padding: 10px 16px 0;
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: 0.04em;
  background: #fff;
}
.sec-empty {
  padding: 16px;
  font-size: 12px;
  color: #94a3b8;
}
.field-readonly-hint {
  margin-top: 4px;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.35;
}
.sec-label-sub {
  margin-left: 10px;
  font-size: 12px;
  font-weight: 400;
  color: #64748b;
}
.sec-label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  flex-shrink: 0;
  padding: 14px 16px 0;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.02em;
  background: #fff;
}
.rooms-summary {
  display: grid;
  gap: 0;
  flex-shrink: 0;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.rooms-summary.cols-6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.rooms-summary.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.rooms-summary.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.arcade-row { border-bottom: 1px solid #f1f5f9; }
.arcade-row:last-child { border-bottom: 1px solid #e2e8f0; }
.cooldown-panel {
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
}
.cooldown-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
  padding: 10px 16px 8px;
  border-bottom: 1px solid #f1f5f9;
}
.cooldown-summary-label {
  font-size: 12px;
  color: #64748b;
}
.cooldown-summary-val {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}
.cooldown-summary-val.ok { color: #15803d; }
.cooldown-summary-val.warn { color: #b45309; }
.cooldown-summary-val.muted { color: #94a3b8; }
.cooldown-summary-note {
  font-size: 12px;
  color: #94a3b8;
}
.cooldown-games {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0;
}
.cooldown-game {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 2px 8px;
  padding: 10px 14px;
  border-right: 1px solid #f1f5f9;
  border-bottom: 1px solid #f1f5f9;
  background: #fff;
}
.cooldown-game.on { background: #fffbeb; }
.cooldown-game-name {
  font-size: 13px;
  font-weight: 650;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cooldown-game-code {
  font-size: 11px;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
  justify-self: end;
}
.cooldown-game-st {
  grid-column: 1 / -1;
  font-size: 11px;
  color: #94a3b8;
}
.cooldown-game.on .cooldown-game-st {
  color: #b45309;
  font-weight: 650;
}
.cooldown-empty {
  padding: 12px 16px;
  font-size: 12px;
  color: #94a3b8;
}
.sum-chip {
  padding: 10px 14px 12px;
  border-right: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.sum-chip:last-child { border-right: none; }
.sum-label { font-size: 12px; color: #64748b; white-space: nowrap; }
.sum-val {
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sum-val.code-val { font-size: 14px; font-weight: 650; }
.sum-val.ok { color: #15803d; }
.sum-val.warn { color: #b45309; }
.sum-val.muted { color: #94a3b8; }
.sum-val.iron-val {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}
.sum-note {
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel-body.bias-body {
  flex: 1;
  min-height: 240px;
  padding: 0 0 12px;
  display: flex;
  flex-direction: column;
  background: #fff;
}
.panel-body :deep(.el-table) {
  --el-table-header-bg-color: #f1f5f9;
  --el-table-row-hover-bg-color: #eff6ff;
}
.panel-body :deep(.el-table th.el-table__cell) { color: #475569; font-weight: 600; }
.control-table { width: 100%; }
.control-table :deep(.el-table__cell) { padding: 12px 16px; }
.legacy-body { padding: 0 0 12px; }
.cell-name { font-weight: 650; color: #0f172a; }
.cell-meta { font-size: 12px; color: #64748b; margin-top: 2px; }
.dlg-body { display: flex; flex-direction: column; gap: 0; }
.dlg-block {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid #f1f5f9;
}
.dlg-block.last {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}
.dlg-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.dlg-block-hd {
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
  letter-spacing: 0.02em;
  margin-bottom: 10px;
}
.form :deep(.el-form-item) { margin-bottom: 12px; }
.form :deep(.el-form-item__label) {
  margin-bottom: 4px !important;
  font-weight: 600;
  color: #475569;
}
.form-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.form-row.bottom { align-items: flex-end; }
.form-row .grow { flex: 1; min-width: 0; }
.weight-item { width: 148px; flex-shrink: 0; }
.switch-item { width: 96px; flex-shrink: 0; }
.kind-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  width: 100%;
}
.kind-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.kind-chip:hover { border-color: #93c5fd; }
.kind-chip.on {
  border-color: #93c5fd;
  background: #eff6ff;
}
.kind-chip-name {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}
.kind-chip.on .kind-chip-name { color: #1d4ed8; }
.kind-chip-desc {
  font-size: 11px;
  color: #64748b;
  line-height: 1.3;
}
.num-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.num-wrap :deep(.el-input-number) { flex: 1; width: 100%; }
.num-wrap.narrow { max-width: 200px; }
.unit {
  flex-shrink: 0;
  font-size: 13px;
  color: #64748b;
  min-width: 1.2em;
}
@media (max-width: 1100px) {
  .rooms-summary.cols-6 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .rooms-summary.cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .sum-chip { border-bottom: 1px solid #f1f5f9; }
}
@media (max-width: 560px) {
  .rooms-summary.cols-6,
  .rooms-summary.cols-4,
  .rooms-summary.cols-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cooldown-games { grid-template-columns: 1fr; }
  .form-row { flex-direction: column; }
  .weight-item { width: 100%; }
  .kind-grid { grid-template-columns: 1fr; }
  .sum-note { white-space: normal; }
}
</style>

