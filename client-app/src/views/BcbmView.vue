<template>
  <div class="stage-wrap" @pointerdown.once="onFirstInteract">
    <div class="stage" :style="stageStyle">
      <!-- 竖屏底图 480×820（用户底图 + 底部深色延展） -->
      <img class="bg" :src="H5.bg" alt="" draggable="false" />

      <!-- 官方：bg → speedEffectGroup → spinPanel → payoutGroup → betBoard -->
      <div id="bcbm-speed-fx-mount" class="fx-mount fx-mount-speed" />

      <div class="spin-anchor" :class="{ faded: ringFaded }">
        <BcbmSpinRing
          ref="ringRef"
          :hit-car-pos="hitIndexes"
          @stopped="onRingStopped"
          @status="onRingStatus"
        />
      </div>

      <div id="bcbm-payout-fx-mount" class="fx-mount fx-mount-payout" />
      <BcbmFxOverlay ref="fxRef" />
      <!-- 更多 → 官方 HistoryPanel（传统/车标/颜色） -->
      <BcbmHistoryPanel
        v-if="showHistoryPanel"
        :items="historyRaw"
        @close="showHistoryPanel = false"
        @item-tap="onHistoryItemTap"
      />

      <!-- 官方 historyList ITEM_TAP → popupGameRule(1) -->
      <BcbmRulesPanel
        v-if="showRulesPanel"
        :key="rulesOpenKey"
        :initial-page="rulesInitialPage"
        @close="showRulesPanel = false"
      />

      <BcbmRecordPanel
        v-if="showRecordPanel"
        :key="recordMode"
        :mode="recordMode"
        @close="showRecordPanel = false"
      />
      <BcbmSettingsPanel
        v-if="showSettingsPanel"
        @close="showSettingsPanel = false"
        @update:sound="onSoundFromSettings"
      />
      <BcbmChipSettingPanel
        v-if="showChipSetting"
        v-model="activeChips"
        @confirm="onChipSettingConfirm"
        @close="showChipSetting = false"
      />

      <!-- 坐标来自 benz.thm.d68a78f6 BetBoardPanelSkin / GamePageSkin -->
      <div class="panel" :style="panelStyle">
        <!-- EXML: yben_ui_panel bottom=0（426 高贴在 439 面板底部） -->
        <img class="panel-bg" :src="H5.panel" alt="" draggable="false" />
        <!-- 官方 maskEffectContainer：下注态周期性白光扫过 -->
        <BcbmPanelMaskFx :active="maskFxActive" />
        <!-- 官方：yben_bg_total_bet y=-7 HC=0；Label「总下注:」+ 金额 y=6 size=20 -->
        <img
          class="total-bet-bg"
          :src="H5.totalBetBg"
          alt=""
          draggable="false"
        />
        <div
          class="total-bet"
          :style="{
            top: PANEL_TOTAL_BET.y + 'px',
            fontSize: PANEL_TOTAL_BET.fontSize + 'px',
          }"
        >
          {{ TOTAL_BET_LABEL }} {{ totalBetDisplay }}
        </div>

        <!--
          官方 historyList @ (46,33) 345×50 + mask (17,20) 370×77
          HorizontalLayout gap=-1；item0=latest 用 l/62 右对齐，其余 s/45 居中
          特殊奖：主图 bonus + smallIconGroup 叠车标（latest 偏 -19,-5）
        -->
        <div class="history-mask" :style="xyStyle(PANEL_HISTORY_MASK)">
          <div
            class="history-list"
            :style="{
              left: PANEL_HISTORY.x - PANEL_HISTORY_MASK.x + 'px',
              top: PANEL_HISTORY.y - PANEL_HISTORY_MASK.y + 'px',
              width: PANEL_HISTORY.w + 'px',
              height: PANEL_HISTORY.h + 'px',
            }"
          >
            <div
              v-for="(h, i) in stripHistory"
              :key="i"
              class="his-item"
              :class="{ latest: i === 0, bonus: !!h.smallUrl }"
              role="button"
              tabindex="0"
              :aria-label="`历史开奖，查看玩法`"
              @click.stop="onHistoryItemTap(h.award)"
              @keydown.enter.prevent="onHistoryItemTap(h.award)"
            >
              <img
                class="his-main"
                :src="h.mainUrl"
                alt=""
                draggable="false"
              />
              <div v-if="h.smallUrl" class="his-small">
                <img
                  class="his-circle"
                  src="/images/games/bcbm/benz/spin/yben_bg_history_blk_circle.png"
                  alt=""
                  draggable="false"
                />
                <img
                  class="his-car"
                  :src="h.smallUrl"
                  alt=""
                  draggable="false"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- moreBtn：历史栏常驻，点开 HistoryPanel -->
        <button
          type="button"
          class="abs-btn more-btn"
          :style="xyStyle(PANEL_MORE)"
          :disabled="busy"
          aria-label="更多"
          @click="showHistoryPanel = true"
        >
          <img
            src="/images/games/bcbm/benz/txt/yben_btn_more_hans.png"
            alt="更多"
            draggable="false"
          />
        </button>

        <!-- 清零：按下光效 scaleX=-1；文字 HC=-10，原尺寸 57×35 -->
        <button
          type="button"
          class="abs-btn clear-btn"
          :style="xyStyle(PANEL_CLEAR)"
          :disabled="busy"
          @click="clearBets"
        >
          <img
            class="press-vfx flip-x"
            src="/images/games/bcbm/benz/bet/yben_vfx_auto_clear_auto_on.png"
            alt=""
            draggable="false"
          />
          <img
            class="btn-txt"
            :style="{ marginLeft: CLEAR_TXT_HC + 'px' }"
            src="/images/games/bcbm/benz/txt/yben_txt_clear_off_hans.png"
            alt="清零"
            draggable="false"
          />
        </button>

        <!--
          官方 autoBetBtn：点开 autoItemList；upAndSelected 时长亮光效 + 剩余局数
          文字 HC=+5 / bottom；label HC=+5 VC=12 size=24
        -->
        <button
          type="button"
          class="abs-btn auto-btn"
          :class="{ on: autoOn }"
          :style="xyStyle(PANEL_AUTO)"
          :disabled="busy && !autoOn"
          aria-label="自动"
          @click="openAutoMenu"
        >
          <img
            class="press-vfx"
            src="/images/games/bcbm/benz/bet/yben_vfx_auto_clear_auto_on.png"
            alt=""
            draggable="false"
          />
          <img
            v-if="!autoOn"
            class="btn-txt"
            :style="{ marginLeft: AUTO_TXT_HC + 'px' }"
            src="/images/games/bcbm/benz/txt/yben_txt_auto_off_hans.png"
            alt="自动"
            draggable="false"
          />
          <span v-else class="auto-round" :style="{ marginLeft: AUTO_TXT_HC + 'px' }">{{
            autoRoundLeft
          }}</span>
        </button>

        <!--
          官方 autoItemList @ (370,-169)，VerticalLayout gap=-36
          项：100 / 50 / 20 / 10；AutoItemRendererSkin 旋转 15.48°
        -->
        <div v-show="autoMenuOpen" class="auto-menu" :style="autoMenuStyle">
          <button
            v-for="round in AUTO_ROUNDS"
            :key="round"
            type="button"
            class="auto-opt"
            @click="pickAutoRound(round)"
          >
            <img
              class="auto-opt-bg"
              src="/images/games/bcbm/benz/bet/yben_btn_autoplay_off.png"
              alt=""
              draggable="false"
            />
            <img
              class="auto-opt-bg on"
              src="/images/games/bcbm/benz/bet/yben_btn_autoplay_on.png"
              alt=""
              draggable="false"
            />
            <span class="auto-opt-lbl">{{ round }}</span>
          </button>
        </div>
        <div
          v-show="autoMenuOpen"
          class="auto-menu-block"
          @click="closeAutoMenu"
        />

        <button
          type="button"
          class="abs-btn all-btn"
          :style="xyStyle(PANEL_ALL)"
          :disabled="busy"
          @click="betAll"
        >
          <img
            class="all-bg"
            src="/images/games/bcbm/benz/bet/yben_btn_allbet_off.png"
            alt=""
            draggable="false"
          />
          <img
            class="all-bg on"
            src="/images/games/bcbm/benz/bet/yben_btn_allbet_on.png"
            alt=""
            draggable="false"
          />
          <img
            v-if="betAllOption === 'all'"
            class="lbl"
            src="/images/games/bcbm/benz/txt/yben_txt_allbet_off_hans.png"
            alt="全选"
            draggable="false"
          />
          <img
            v-else
            class="brand-icon"
            :src="`/images/games/bcbm/benz/bet/yben_icon_select_${betAllOption}.png`"
            alt=""
            draggable="false"
          />
        </button>

        <button
          type="button"
          class="abs-btn undo-btn"
          :style="xyStyle(PANEL_UNDO)"
          :disabled="busy"
          @click="undoBet"
        >
          <img
            class="undo-circle"
            src="/images/games/bcbm/benz/spin/yben_bg_history_blk_circle.png"
            alt=""
            draggable="false"
          />
          <img
            class="undo-arrow"
            src="/images/games/bcbm/benz/bet/yben_btn_undo.png"
            alt="撤销"
            draggable="false"
          />
        </button>

        <button
          v-for="(slot, i) in PANEL_CHIP_SLOTS"
          :key="slot.x + '-' + activeChips[i]"
          type="button"
          class="abs-btn chip"
          :class="{ on: chipValue === activeChips[i] }"
          :style="xyStyle(slot)"
          :disabled="busy"
          @click="chipValue = activeChips[i]!"
        >
          <img
            :src="
              chipValue === activeChips[i]
                ? '/images/games/bcbm/benz/bet/yben_btn_chips_on.png'
                : '/images/games/bcbm/benz/bet/yben_btn_chips_off.png'
            "
            alt=""
            draggable="false"
          />
          <span>{{ activeChips[i] }}</span>
        </button>

        <!--
          官方 selectBetOptionBtn @ (2,104) 75×42
          arrowTop VC=-2.5 / arrowBottom VC=4.5，同为 yben_btn_arrow_1_on（均朝上）
          startAnimation：每 1s 交错 pingpong 闪一下；点开 betAllOptionItemList
        -->
        <button
          type="button"
          class="abs-btn select-btn"
          :class="{ anim: maskFxActive && !betAllMenuOpen, open: betAllMenuOpen }"
          :style="xyStyle(PANEL_SELECT)"
          :disabled="busy"
          aria-label="筛选全选范围"
          @click="toggleBetAllMenu"
        >
          <img
            class="select-bg"
            src="/images/games/bcbm/benz/bet/yben_btn_select_arrow_off.png"
            alt=""
            draggable="false"
          />
          <img
            class="select-bg on"
            src="/images/games/bcbm/benz/bet/yben_btn_select_arrow_on.png"
            alt=""
            draggable="false"
          />
          <img
            class="arrow top"
            src="/images/games/bcbm/benz/bet/yben_btn_arrow_1_on.png"
            alt=""
            draggable="false"
          />
          <img
            class="arrow bottom"
            src="/images/games/bcbm/benz/bet/yben_btn_arrow_1_on.png"
            alt=""
            draggable="false"
          />
        </button>

        <!--
          官方 betAllOptionItemList @ (-3,-62)，VerticalLayout gap=-20
          项高≈53（select 底图 sourceH），奔驰→宝马→奥迪→大众→全选
        -->
        <div
          v-show="betAllMenuOpen"
          class="bet-all-menu"
          :style="betAllMenuStyle"
        >
          <button
            v-for="(opt, idx) in BET_ALL_OPTIONS"
            :key="opt"
            type="button"
            class="opt"
            :class="[
              idx === 0 || idx === BET_ALL_OPTIONS.length - 1 ? 'cap' : 'mid',
              {
                flip: idx === BET_ALL_OPTIONS.length - 1,
                on: betAllOption === opt,
                [`opt-${opt}`]: true,
              },
            ]"
            @click="pickBetAllOption(opt)"
          >
            <img
              class="opt-bg"
              :src="optBgSrc(idx, betAllOption === opt)"
              alt=""
              draggable="false"
            />
            <img
              v-if="opt === 'all'"
              class="opt-lbl"
              src="/images/games/bcbm/benz/txt/yben_txt_select_allbet_on_hans.png"
              alt="全选"
              draggable="false"
            />
            <img
              v-else
              class="opt-icon"
              :class="`icon-${opt}`"
              :src="`/images/games/bcbm/benz/bet/yben_icon_select_${opt}.png`"
              alt=""
              draggable="false"
            />
          </button>
        </div>
        <!-- 点空白关闭菜单（官方 buttonBlock） -->
        <div
          v-show="betAllMenuOpen"
          class="bet-all-block"
          @click="closeBetAllMenu"
        />

        <button
          type="button"
          class="abs-btn chip-set-btn"
          :style="xyStyle(PANEL_CHIP_SETTING)"
          :disabled="busy"
          aria-label="选择筹码"
          @click="openChipSetting"
        >
          <!-- 官方：底下 40×40 黑圆 + yben_btn_chips_change -->
          <img
            class="chip-set-circle"
            src="/images/games/bcbm/benz/spin/yben_bg_history_blk_circle.png"
            alt=""
            draggable="false"
          />
          <img
            class="chip-set-arrow"
            src="/images/games/bcbm/benz/bet/yben_btn_chips_change.png"
            alt=""
            draggable="false"
          />
        </button>

        <!-- 官方：自动中 startBtn 隐藏，stopAutoBtn 同位置显示 -->
        <button
          v-show="!autoOn"
          type="button"
          class="abs-btn start-btn"
          :style="xyStyle(PANEL_START)"
          :disabled="busy || totalBet === 0"
          @click="doSpin"
        >
          <img
            class="start-vfx"
            src="/images/games/bcbm/benz/bet/yben_vfx_start_on.png"
            alt=""
            draggable="false"
          />
          <img
            class="start-txt"
            src="/images/games/bcbm/benz/txt/yben_txt_start_hans.png"
            alt="开始"
            draggable="false"
          />
        </button>
        <button
          v-show="autoOn"
          type="button"
          class="abs-btn stop-auto-btn"
          :style="xyStyle(PANEL_START)"
          aria-label="停止自动"
          @click="stopAutoBet(true)"
        >
          <img
            class="stop-circle"
            src="/images/games/bcbm/benz/spin/yben_bg_history_blk_circle.png"
            alt=""
            draggable="false"
          />
          <img
            class="stop-vfx"
            src="/images/games/bcbm/benz/bet/yben_vfx_stop_on.png"
            alt=""
            draggable="false"
          />
          <img
            class="stop-txt"
            src="/images/games/bcbm/benz/txt/yben_txt_stop_hans.png"
            alt="停止"
            draggable="false"
          />
        </button>

        <BcbmBetCell
          v-for="b in allBets"
          :key="b.betId"
          :bet="b"
          :amount="myBets[b.betId as BcbmBetId] || 0"
          :win="winSlots.has(b.betId)"
          :disabled="busy"
          @bet="addChip(b.betId as BcbmBetId)"
        />
      </div>

      <div class="hud">
        <button type="button" class="back" @click="goBack" aria-label="返回">
          <img
            src="/images/games/bcbm/benz/main/yben_btn_back.png"
            alt="返回"
            draggable="false"
          />
        </button>

        <!--
          官方 mobile SPUserProfile @ (60,20)
          外框 yben_icon_user + 头像环 yben_btn_user_own + 金币 + 余额
        -->
        <div class="user-profile">
          <img
            class="profile-frame"
            src="/images/games/bcbm/benz/main/yben_icon_user.png"
            alt=""
            draggable="false"
          />
          <div class="avatar">
            <img
              class="avatar-img"
              :src="avatarSrc"
              alt=""
              draggable="false"
            />
          </div>
          <img
            class="avatar-ring"
            src="/images/games/bcbm/benz/main/yben_btn_user_own.png"
            alt=""
            draggable="false"
          />
          <div class="amount">
            <img
              class="coin"
              src="/images/games/bcbm/benz/main/yben_icon_money.png"
              alt=""
              draggable="false"
            />
            <span id="bcbm-balance">{{ balanceDisplay }}</span>
          </div>
        </div>

        <!--
          官网 PC 顶栏 CommonBtnGrp：额度 / 下注记录 / 规则 / 设置
          （不做汉堡菜单，按需求直接平铺右侧）
        -->
        <div class="hud-actions">
          <button
            type="button"
            class="hud-btn"
            aria-label="额度记录"
            @click="openCreditRecord"
          >
            <img
              src="/images/games/bcbm/benz/main/yben_btn_bet.png"
              alt="额度记录"
              draggable="false"
            />
          </button>
          <button
            type="button"
            class="hud-btn"
            aria-label="下注记录"
            @click="openBetRecord"
          >
            <img
              src="/images/games/bcbm/benz/main/yben_btn_bet_record.png"
              alt="下注记录"
              draggable="false"
            />
          </button>
          <button
            type="button"
            class="hud-btn"
            aria-label="游戏规则"
            @click="openGameRules(0)"
          >
            <img
              src="/images/games/bcbm/benz/main/yben_btn_rule.png"
              alt="游戏规则"
              draggable="false"
            />
          </button>
          <button
            type="button"
            class="hud-btn"
            aria-label="设置"
            @click="openSettings"
          >
            <img
              src="/images/games/bcbm/benz/main/yben_btn_setting.png"
              alt="设置"
              draggable="false"
            />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWalletStore } from '@/stores/wallet'
import { useUserStore } from '@/stores/user'
import { useToast } from '@/composables/useToast'
import { useGameSpinSession } from '@/composables/useGameSpinSession'
import { gamesApi } from '@/api/games'
import BcbmSpinRing from '@/components/BcbmSpinRing.vue'
import BcbmFxOverlay from '@/components/BcbmFxOverlay.vue'
import BcbmPanelMaskFx from '@/components/BcbmPanelMaskFx.vue'
import BcbmHistoryPanel from '@/components/BcbmHistoryPanel.vue'
import BcbmRulesPanel from '@/components/BcbmRulesPanel.vue'
import BcbmRecordPanel from '@/components/BcbmRecordPanel.vue'
import BcbmSettingsPanel from '@/components/BcbmSettingsPanel.vue'
import BcbmChipSettingPanel from '@/components/BcbmChipSettingPanel.vue'
import BcbmBetCell from '@/components/BcbmBetCell.vue'
import type { BcbmHistoryResult } from '@/games/bcbm/bcbmHistoryRoad'
import type { BcbmFxKind } from '@/components/BcbmFxOverlay.vue'
import {
  BCBM_BET_SLOTS,
  BCBM_CHIP_DEFAULT,
  bcbmRingIndexToCarPos,
  bcbmSpecialSpinUrl,
  type BcbmBetId,
  type BcbmAwardType,
} from '@/games/bcbm'
import {
  BCBM_PLAYTYPE_META,
  BCBM_WHEEL_PLAYTYPE,
} from '@/games/bcbm/bcbmSpinMath'
import {
  unlockBcbmAudio,
  playBcbmBet,
  playBcbmSfx,
  playBcbmSpinStartAndLoop,
  stopBcbmSpinLoop,
  playBcbmAnticipation,
  stopBcbmAnticipation,
  startBcbmBgm,
  stopBcbmBgm,
  startBcbmPayout,
  clearBcbmPayout,
  isBcbmBonusAward,
  bcbmPayoutLevel,
  initBcbmMuteFromStorage,
} from '@/games/bcbm/bcbmAudio'
import {
  MOBILE_STAGE_W,
  MOBILE_STAGE_H,
  MOBILE_PANEL_TOP,
  MOBILE_PANEL_TOP_SPIN,
  MOBILE_PANEL_TRANSFORM_MS,
  MOBILE_PANEL_H,
  H5,
  PANEL_TOP_BETS,
  PANEL_BOTTOM_BETS,
  PANEL_START,
  PANEL_CHIP_SLOTS,
  PANEL_CLEAR,
  PANEL_AUTO,
  PANEL_ALL,
  PANEL_UNDO,
  PANEL_HISTORY,
  PANEL_HISTORY_MASK,
  PANEL_TOTAL_BET,
  TOTAL_BET_LABEL,
  PANEL_SELECT,
  PANEL_CHIP_SETTING,
  PANEL_MORE,
  CLEAR_TXT_HC,
  AUTO_TXT_HC,
} from '@/games/bcbm/mobilePanelLayout'

const allBets = [...PANEL_TOP_BETS, ...PANEL_BOTTOM_BETS]

const router = useRouter()
const route = useRoute()
const walletStore = useWalletStore()
const userStore = useUserStore()
const { error: toastErr } = useToast()
const spinSession = useGameSpinSession('bcbm')
const bcbmMinBet = ref(1)
const bcbmMaxBet = ref(50_000)

const avatarSrc = computed(
  () => userStore.profile?.avatar || '/images/avatars/001.jpg',
)

const STAGE_W = MOBILE_STAGE_W
const STAGE_H = MOBILE_STAGE_H
const scale = ref(1)
/** Egret 手机常见 FIXED_WIDTH：按宽铺满；高度不够再整体缩小；顶部对齐。
 *  舞台加长后矮屏黑边减少；wrap 底色与底图底部一致，避免露出纯黑。 */
const stageStyle = computed(() => ({
  width: `${STAGE_W}px`,
  height: `${STAGE_H}px`,
  transform: `translateX(-50%) scale(${scale.value})`,
}))
/** 官方 transformPanel 位移差 229；下注 324 ↔ 开转 553 */
const panelTop = ref(MOBILE_PANEL_TOP)
const panelStyle = computed(() => ({
  top: `${panelTop.value}px`,
  height: `${MOBILE_PANEL_H}px`,
  transition: `top ${MOBILE_PANEL_TRANSFORM_MS}ms ease`,
}))
/** 官方 handleEffect：下注面板在位时跑 mask + 筛选箭头呼吸 */
const maskFxActive = computed(() => panelTop.value === MOBILE_PANEL_TOP)

function transformPanel(showBet: boolean) {
  panelTop.value = showBet ? MOBILE_PANEL_TOP : MOBILE_PANEL_TOP_SPIN
  return new Promise<void>((r) => {
    window.setTimeout(r, MOBILE_PANEL_TRANSFORM_MS)
  })
}

function xyStyle(b: { x: number; y: number; w: number; h: number }) {
  return {
    left: `${b.x}px`,
    top: `${b.y}px`,
    width: `${b.w}px`,
    height: `${b.h}px`,
  }
}

const myBets = ref<Partial<Record<BcbmBetId, number>>>({})
const betHistory = ref<Partial<Record<BcbmBetId, number>>[]>([])
const CHIP_STORAGE_KEY = 'bcbm_active_chips'
function loadActiveChips(): number[] {
  try {
    const raw = localStorage.getItem(CHIP_STORAGE_KEY)
    if (!raw) return [...BCBM_CHIP_DEFAULT]
    const arr = JSON.parse(raw) as number[]
    if (
      Array.isArray(arr) &&
      arr.length === 4 &&
      arr.every((n) => typeof n === 'number' && n > 0)
    ) {
      return [...arr].sort((a, b) => a - b)
    }
  } catch {
    /* ignore */
  }
  return [...BCBM_CHIP_DEFAULT]
}
/** 面板展示的 4 枚筹码，默认 1/5/10/100 */
const activeChips = ref<number[]>(loadActiveChips())
const chipValue = ref(activeChips.value.includes(10) ? 10 : activeChips.value[0]!)
const busy = ref(false)
/** 官方 _autoRoundLeft：-1=关闭；>=0 自动中并显示剩余局数 */
const autoRoundLeft = ref(-1)
const autoOn = computed(() => autoRoundLeft.value >= 0)
/** 官方 autoItemList 局数：100 / 50 / 20 / 10 */
const AUTO_ROUNDS = [100, 50, 20, 10] as const
const autoMenuOpen = ref(false)
/**
 * 官方 mobile autoItemList @ (370, -169)，VerticalLayout gap=-36
 * item≈110×75 → 4 项步进 39，总高约 192
 */
const autoMenuStyle = computed(() => ({
  left: '370px',
  top: '-169px',
  width: '110px',
}))
/** 官方 selectedBetAllOption，默认 all（列表 selectedIndex=4） */
type BetAllOption = 'benz' | 'bmw' | 'audi' | 'volkswagen' | 'all'
const BET_ALL_OPTIONS: BetAllOption[] = [
  'benz',
  'bmw',
  'audi',
  'volkswagen',
  'all',
]
const betAllOption = ref<BetAllOption>('all')
const betAllMenuOpen = ref(false)

/**
 * 官方 betAllOptionItemList @ (-3, -62)，VerticalLayout gap=-20
 * 底图 source 87×53；5 项步进 33 → 总高 ≈185，底边贴近箭头
 */
const betAllMenuStyle = computed(() => ({
  left: '-3px',
  top: '-62px',
  width: '75px',
}))

function optBgSrc(idx: number, on: boolean) {
  // 官方：index 0/4 用 cap(_1)，中间用 mid(_2)；末项再 scaleY=-1
  const cap = idx === 0 || idx === BET_ALL_OPTIONS.length - 1
  if (cap) {
    return on
      ? '/images/games/bcbm/benz/bet/yben_btn_allbet_select_on_1.png'
      : '/images/games/bcbm/benz/bet/yben_btn_allbet_select_off_1.png'
  }
  return on
    ? '/images/games/bcbm/benz/bet/yben_btn_allbet_select_on_2.png'
    : '/images/games/bcbm/benz/bet/yben_btn_allbet_select_off_2.png'
}
const winSlots = ref<Set<string>>(new Set())
const hitIndexes = ref<number[]>([])
type HistoryEntry = {
  carPos: number
  award: BcbmAwardType
  mainUrl: string
  smallUrl: string | null
}
/** 官方 historyDatasource，最多 200，最新在前 */
const historyRaw = ref<BcbmHistoryResult[]>([])
/**
 * 缩略条：列表宽 345、item 50、gap -1 → 约 7 格
 * item0=latest（l/62），其余 normal（s/45）
 */
const STRIP_HISTORY_MAX = 7
const stripHistory = computed(() =>
  historyRaw.value
    .slice(0, STRIP_HISTORY_MAX)
    .map((h, i) => makeHistoryEntry(h.carPos, h.award, i === 0)),
)
const showHistoryPanel = ref(false)
const showRulesPanel = ref(false)
const rulesInitialPage = ref(0)
/** 每次打开规则弹窗递增，强制 remount 到目标页 */
const rulesOpenKey = ref(0)
const showRecordPanel = ref(false)
const recordMode = ref<'credit' | 'bet'>('credit')
const showSettingsPanel = ref(false)
const showChipSetting = ref(false)

/**
 * 官方 historyList ITEM_TAP → popupGameRule(1)（赔率页）
 * 特殊奖图标再跳到特殊奖励页，方便直接看该玩法介绍
 */
function rulesPageForAward(award: BcbmAwardType | string): number {
  const a = String(award)
  if (a.startsWith('sanyuan_') || a.startsWith('sixi_') || a === 'fast') return 2
  if (a === 'uturn' || a === 'lightning' || a === 'free' || a === 'drift') return 3
  return 1
}

/** 官方 onHistoryItemTap */
function onHistoryItemTap(award: BcbmAwardType | string) {
  openGameRules(rulesPageForAward(award))
}

function openGameRules(page = 0) {
  // 历史点开规则：下注中也可看；开转中仍可（与官网一致不拦）
  showHistoryPanel.value = false
  showRecordPanel.value = false
  showSettingsPanel.value = false
  rulesInitialPage.value = Math.max(0, Math.min(3, page))
  rulesOpenKey.value += 1
  showRulesPanel.value = true
  playBcbmSfx('bet', 0.3)
}

function openCreditRecord() {
  if (busy.value) return
  showRulesPanel.value = false
  showHistoryPanel.value = false
  showSettingsPanel.value = false
  recordMode.value = 'credit'
  showRecordPanel.value = true
  playBcbmSfx('bet', 0.3)
}

function openBetRecord() {
  if (busy.value) return
  showRulesPanel.value = false
  showHistoryPanel.value = false
  showSettingsPanel.value = false
  recordMode.value = 'bet'
  showRecordPanel.value = true
  playBcbmSfx('bet', 0.3)
}

function openSettings() {
  if (busy.value) return
  showRulesPanel.value = false
  showHistoryPanel.value = false
  showRecordPanel.value = false
  showSettingsPanel.value = true
  playBcbmSfx('bet', 0.3)
}

function onSoundFromSettings(_on: boolean) {
  /* 分轨状态已在 SettingsPanel / bcbmAudio 内持久化 */
}

function openChipSetting() {
  if (busy.value) return
  betAllMenuOpen.value = false
  autoMenuOpen.value = false
  showChipSetting.value = true
  playBcbmSfx('bet', 0.3)
}

function onChipSettingConfirm(chips: number[]) {
  activeChips.value = [...chips].sort((a, b) => a - b)
  try {
    localStorage.setItem(CHIP_STORAGE_KEY, JSON.stringify(activeChips.value))
  } catch {
    /* ignore */
  }
  if (!activeChips.value.includes(chipValue.value)) {
    chipValue.value = activeChips.value[0]!
  }
}
const fxRef = ref<InstanceType<typeof BcbmFxOverlay> | null>(null)
const ringRef = ref<InstanceType<typeof BcbmSpinRing> | null>(null)
/** 官方 Start：tween_spinPanelAlpha0 → 灯环淡出 */
const ringFaded = ref(false)
let stopResolve: (() => void) | null = null

const totalBet = computed(() =>
  Object.values(myBets.value).reduce((s, v) => s + (v ?? 0), 0),
)
/** 官方 Utils.formatNumShortStr：小数额直接显示 */
const totalBetDisplay = computed(() => {
  const n = totalBet.value
  if (n >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(2).replace(/\.?0+$/, '') + '万'
  return String(n)
})
/** 顶栏余额：千分位，贴合官方 balanceLabel */
const balanceDisplay = computed(() =>
  Number(walletStore.balance || 0).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  }),
)

function fit() {
  // 设计稿 480×820；优先铺满宽度，高度不够再压（FIXED_WIDTH）
  const sx = window.innerWidth / STAGE_W
  const sy = window.innerHeight / STAGE_H
  scale.value = Math.min(sx, sy)
}

function goBack() {
  fxRef.value?.stop()
  panelTop.value = MOBILE_PANEL_TOP
  stopAutoBet()
  stopBcbmBgm()
  stopBcbmSpinLoop()
  stopBcbmAnticipation()
  router.back()
}

function onFirstInteract() {
  unlockBcbmAudio()
  startBcbmBgm()
}

function addChip(id: BcbmBetId) {
  if (busy.value) return
  const nextTotal = totalBet.value + chipValue.value
  if (nextTotal > bcbmMaxBet.value) {
    toastErr(`总押注不能超过 ${bcbmMaxBet.value}`)
    return
  }
  if (nextTotal > Number(walletStore.balance || 0)) {
    toastErr('余额不足')
    return
  }
  betHistory.value.push({ ...myBets.value })
  myBets.value = { ...myBets.value, [id]: (myBets.value[id] ?? 0) + chipValue.value }
  playBcbmBet()
}
function clearBets() {
  if (busy.value) return
  betHistory.value.push({ ...myBets.value })
  myBets.value = {}
  playBcbmSfx('bet', 0.4)
}
function undoBet() {
  if (busy.value || betHistory.value.length === 0) return
  myBets.value = betHistory.value.pop() ?? {}
  playBcbmSfx('bet', 0.35)
}
function brandPrefix(opt: BetAllOption): string | null {
  if (opt === 'all') return null
  if (opt === 'volkswagen') return 'vw_'
  return opt + '_'
}

function betAll() {
  if (busy.value) return
  const next: Partial<Record<BcbmBetId, number>> = { ...myBets.value }
  const prefix = brandPrefix(betAllOption.value)
  for (const s of BCBM_BET_SLOTS) {
    if (prefix && !s.id.startsWith(prefix)) continue
    next[s.id] = (next[s.id] ?? 0) + chipValue.value
  }
  const nextTotal = Object.values(next).reduce((s, v) => s + (v ?? 0), 0)
  if (nextTotal > bcbmMaxBet.value) {
    toastErr(`总押注不能超过 ${bcbmMaxBet.value}`)
    return
  }
  if (nextTotal > Number(walletStore.balance || 0)) {
    toastErr('余额不足')
    return
  }
  betHistory.value.push({ ...myBets.value })
  myBets.value = next
  playBcbmBet()
}

function toggleBetAllMenu() {
  if (busy.value) return
  autoMenuOpen.value = false
  betAllMenuOpen.value = !betAllMenuOpen.value
  playBcbmSfx('bet', 0.3)
}
function closeBetAllMenu() {
  betAllMenuOpen.value = false
}
function pickBetAllOption(opt: BetAllOption) {
  betAllOption.value = opt
  betAllMenuOpen.value = false
  playBcbmSfx('bet', 0.35)
}

/** 官方：点 autoBetBtn → buttonBlock + autoItemList */
function openAutoMenu() {
  if (busy.value && !autoOn.value) return
  betAllMenuOpen.value = false
  autoMenuOpen.value = true
  playBcbmSfx('bet', 0.3)
}
function closeAutoMenu() {
  autoMenuOpen.value = false
}
/** 官方 refreshAutoBtn(e)：e>=0 选中态显示剩余局数 + stop；e=-1 恢复 */
function refreshAutoBtn(left: number) {
  autoRoundLeft.value = left
}
function stopAutoBet(withSfx = false) {
  refreshAutoBtn(-1)
  spinSession.clearScheduled()
  if (withSfx) playBcbmSfx('bet', 0.35)
}
/**
 * 官方 onAutoItemSelected：hideList → startBet() && refreshAutoBtn(round-1)
 * 首局立刻开转，按钮显示 round-1
 */
function pickAutoRound(round: number) {
  closeAutoMenu()
  if (busy.value || totalBet.value <= 0) return
  playBcbmSfx('bet', 0.35)
  refreshAutoBtn(round - 1)
  void doSpin()
}
/** 官方 startNextBet：再开一局并剩余-1；失败则 stop */
function startNextBet() {
  if (busy.value || totalBet.value <= 0) {
    stopAutoBet()
    return
  }
  refreshAutoBtn(autoRoundLeft.value - 1)
  void doSpin()
}

/** 官方 ResultBonus 0–5 → 特效 kind */
function awardToFx(award: string): Exclude<BcbmFxKind, 'win' | 'none'> | null {
  if (award.startsWith('sanyuan_')) return 'sanyuan'
  if (award.startsWith('sixi_')) return 'sixi'
  if (award === 'fast') return 'fast'
  if (award === 'uturn') return 'uturn'
  if (award === 'lightning' || award === 'free') return 'lightning'
  if (award === 'drift') return 'drift'
  return null
}

/**
 * 官方 getResultPositionSet(carPos, carResult) → 灯位高亮
 * 大三元 6 点 / 大四喜 8 点 / 激情连续 5 / 掉头 ±5 / 闪电单点 / 漂移全环
 */
function resolveHitCarPositions(carPos: number, award: string): number[] {
  const e = ((carPos % 24) + 24) % 24
  if (award.startsWith('sanyuan_')) {
    const brand = award.replace('sanyuan_', '')
    const brandFile = brand === 'vw' ? 'volkswagen' : brand
    const hits: number[] = []
    for (let i = 0; i < 24; i++) {
      const m = BCBM_PLAYTYPE_META[BCBM_WHEEL_PLAYTYPE[i]]
      if (m.brand === brandFile || m.betId.startsWith(brand + '_')) hits.push(i)
    }
    return hits.length ? hits : [e]
  }
  if (award.startsWith('sixi_')) {
    const color = award.replace('sixi_', '')
    const hits: number[] = []
    for (let i = 0; i < 24; i++) {
      if (BCBM_PLAYTYPE_META[BCBM_WHEEL_PLAYTYPE[i]].color === color) hits.push(i)
    }
    return hits.length ? hits : [e]
  }
  if (award === 'fast') {
    return [0, 1, 2, 3, 4].map((n) => (e + n) % 24)
  }
  if (award === 'uturn') {
    return [(((e - 5) % 24) + 24) % 24, e, (e + 5) % 24]
  }
  if (award === 'drift') {
    return Array.from({ length: 24 }, (_, i) => i)
  }
  // lightning / free / normal
  return [e]
}

/** 服务端 26 格 stopIndex → YoPlay 24 格 carPos（shared 权威映射） */
function resolveCarPos(res: { stopIndex: number; winnerKind: string }): number {
  return bcbmRingIndexToCarPos(res.stopIndex, res.winnerKind)
}

/** 官方 getCarImageResByCarPos(carPos, "l"|"s") */
function historyCarUrl(carPos: number, size: 'l' | 's') {
  const pt = BCBM_WHEEL_PLAYTYPE[((carPos % 24) + 24) % 24]
  const m = BCBM_PLAYTYPE_META[pt]
  return `/images/games/bcbm/benz/main/yben_icon_history_${size}_${m.brand}_${m.color}.png`
}

/** 官方 getBonusImageResByCarResult → 特殊奖大图标，右下叠小车标 */
function historyBonusUrl(award: BcbmAwardType): string | null {
  const a = String(award)
  if (a.startsWith('sanyuan_')) return bcbmSpecialSpinUrl('sanyuan')
  if (a.startsWith('sixi_')) return bcbmSpecialSpinUrl('sixi')
  if (a === 'fast') return bcbmSpecialSpinUrl('fast')
  if (a === 'uturn') return bcbmSpecialSpinUrl('uturn')
  if (a === 'lightning' || a === 'free') return bcbmSpecialSpinUrl('lightning')
  if (a === 'drift') return bcbmSpecialSpinUrl('drift')
  return null
}

/**
 * 官方 HistoryItemRenderer.dataChanged：
 * pos = getCarImageResByCarPos(carPos, itemIndex==0 ? "l" : "s")
 * 有 bonus → icon=bonus、smallIcon=pos；否则 icon=pos
 */
function makeHistoryEntry(
  carPos: number,
  award: BcbmAwardType,
  latest: boolean,
): HistoryEntry {
  const size = latest ? 'l' : 's'
  const posUrl = historyCarUrl(carPos, size)
  const bonus = historyBonusUrl(award)
  if (bonus) {
    return {
      carPos,
      award,
      mainUrl: bonus,
      smallUrl: posUrl,
    }
  }
  return {
    carPos,
    award,
    mainUrl: posUrl,
    smallUrl: null,
  }
}

/** 官方 updateHistoryList：插到最前，超过 200 裁掉尾部；moreBtn 显示 */
function pushHistory(carPos: number, award: BcbmAwardType) {
  historyRaw.value = [{ carPos, award }, ...historyRaw.value].slice(0, 200)
}

function onRingStopped() {
  stopResolve?.()
  stopResolve = null
}

function waitRingStop() {
  return new Promise<void>((r) => {
    stopResolve = r
  })
}

/**
 * 官方 onSpinStatusChanged：
 * STARTING → spin_start + spin_loop
 * SPINNING → 弱速度特效
 * STOPED → 停 anticipation / 速度特效（loop 在 startPayout 停）
 */
function onRingStatus(st: string) {
  if (st === 'starting') {
    playBcbmSpinStartAndLoop()
  } else if (st === 'spinning') {
    fxRef.value?.startSpeedWeak()
  }
}

let anticipTimer: number | null = null
function clearAnticipTimer() {
  if (anticipTimer != null) {
    window.clearTimeout(anticipTimer)
    anticipTimer = null
  }
}

async function doSpin() {
  if (busy.value || totalBet.value <= 0) return
  const betSum = totalBet.value
  if (betSum < bcbmMinBet.value || betSum > bcbmMaxBet.value) {
    toastErr(`总押注须在 ${bcbmMinBet.value}~${bcbmMaxBet.value} 之间`)
    stopAutoBet()
    return
  }
  if (betSum > Number(walletStore.balance || 0)) {
    toastErr('余额不足')
    stopAutoBet()
    return
  }

  busy.value = true
  betAllMenuOpen.value = false
  autoMenuOpen.value = false
  winSlots.value = new Set()
  hitIndexes.value = []
  clearAnticipTimer()
  stopBcbmAnticipation()

  const bets: Record<string, number> = {}
  for (const [k, v] of Object.entries(myBets.value)) {
    if (v && v > 0) bets[k] = v
  }

  // 官方：点开始立刻 Idle→Spin，等 payoutResp 再允许停；不要先等接口
  void transformPanel(false)
  const stopP = waitRingStop()
  await ringRef.value?.start(-1, { delayMs: 0, deferTarget: true })

  try {
    if (spinSession.disposed.value) return
    const clientRequestId = spinSession.currentOrNewClientRequestId()
    const res = await gamesApi.bcbmSpin(bets, clientRequestId)
    spinSession.clearClientRequestId()
    if (spinSession.disposed.value) return
    walletStore.balance = res.balance
    const award = res.awardType as BcbmAwardType
    const fxKind = awardToFx(award)
    const carPos = resolveCarPos(res)
    /** 官方 payoutLevel：>2（倍投>3）才开期待 */
    const payoutLevel = bcbmPayoutLevel(res.totalPayout, betSum)
    const highAnticipation = payoutLevel > 2

    if (highAnticipation) {
      // 官方：delaySpining(2500)；Delay(2s)→anticipation+强特效+setTarget
      ringRef.value?.delayStop(2500)
      anticipTimer = window.setTimeout(() => {
        playBcbmAnticipation()
        fxRef.value?.startSpeedStrong()
        ringRef.value?.setTarget(carPos)
      }, 2000)
    } else {
      // 官方：立刻 targetPos=carPos，canStop 默认 true，勿人为再拖 1.2s
      ringRef.value?.setTarget(carPos)
    }

    await stopP
    if (spinSession.disposed.value) return
    clearAnticipTimer()
    stopBcbmAnticipation()
    fxRef.value?.stopSpeed()
    stopBcbmSpinLoop()

    // 官方 getResultPositionSet：高亮全部中奖灯位
    hitIndexes.value = resolveHitCarPositions(carPos, award)
    pushHistory(carPos, award)

    winSlots.value = new Set(res.wins.map((w) => w.position))

    // 官方 startPayout：有 ResultBonus → bonus_loop（旁白在横幅出现时播）；高倍 → payout_loop；小奖 ding
    const isBonus = !!fxKind || isBcbmBonusAward(award)
    startBcbmPayout({
      isBonus,
      payoutLevel,
      payout: res.totalPayout,
      awardType: award,
    })

    // 官方：有 ResultBonus 或 payoutLevel>1 → Start→Bonus→ShowAmount
    const clones = ringRef.value?.getClonePayload(hitIndexes.value) ?? []
    if (fxKind || payoutLevel > 1) {
      ringFaded.value = true
      await fxRef.value?.playPayout({
        kind: fxKind,
        clones,
        payout: res.totalPayout,
        payoutLevel,
        awardType: award,
        totalBet: betSum,
      })
      ringFaded.value = false
    } else if (res.totalPayout > 0) {
      // 官方 SmallPrize → FastJumpAmount：ding×2 与跳分同时
      await fxRef.value?.playWin(res.totalPayout)
      clearBcbmPayout()
    } else {
      clearBcbmPayout()
    }

    // 官方派彩结束：spinPanel.transformToIdel() + betBoardPanel.transformPanel(true)
    await Promise.all([ringRef.value?.transformToIdle(), transformPanel(true)])
    hitIndexes.value = []
    winSlots.value = new Set()

    // 官方：0 < autoRoundLeft → startNextBet；==0 → stopAutoBet
    if (autoRoundLeft.value > 0) {
      spinSession.schedule(() => {
        if (autoRoundLeft.value > 0 && !busy.value) startNextBet()
      }, 600)
    } else if (autoRoundLeft.value === 0) {
      stopAutoBet()
    }
  } catch (e: unknown) {
    const msg =
      e && typeof e === 'object' && 'message' in e
        ? String((e as { message: string }).message)
        : '开奖失败'
    toastErr(msg)
    clearAnticipTimer()
    stopBcbmAnticipation()
    stopAutoBet()
    // 释放 waitRingStop，避免卡死
    stopResolve?.()
    stopResolve = null
    ringFaded.value = false
    await Promise.all([ringRef.value?.transformToIdle(), transformPanel(true)])
    hitIndexes.value = []
  } finally {
    clearAnticipTimer()
    stopBcbmAnticipation()
    fxRef.value?.stopSpeed()
    stopBcbmSpinLoop()
    ringFaded.value = false
    busy.value = false
  }
}

onMounted(() => {
  const code = String(route.params.gameCode || '').toLowerCase()
  if (code && code !== 'bcbm') {
    void router.replace('/lobby')
    return
  }
  initBcbmMuteFromStorage()
  unlockBcbmAudio()
  fit()
  window.addEventListener('resize', fit)
  void walletStore.fetchBalance()
  void gamesApi
    .list()
    .then((games) => {
      const cfg = games.find((g) => g.code === 'bcbm')
      if (!cfg) return
      bcbmMinBet.value = Math.max(1, Number(cfg.minBet) || 1)
      bcbmMaxBet.value = Math.max(bcbmMinBet.value, Number(cfg.maxBet) || 50_000)
    })
    .catch(() => {
      /* 用默认限额 */
    })
})

onBeforeUnmount(() => {
  stopAutoBet()
  clearAnticipTimer()
  window.removeEventListener('resize', fit)
  fxRef.value?.stop()
  stopBcbmSpinLoop()
  stopBcbmBgm()
  void walletStore.fetchBalance()
})
</script>

<style scoped>
.stage-wrap {
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  /* 与底图底部延展色一致，缩放后上下/两侧空隙不再是纯黑 */
  background: #04001a;
  position: relative;
}
.stage {
  position: absolute;
  left: 50%;
  top: 0;
  width: 480px;
  /* 高度由 stageStyle 绑定 MOBILE_STAGE_H */
  transform-origin: top center;
  overflow: hidden;
}
.bg {
  position: absolute;
  left: 0;
  top: 0;
  width: 480px;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  z-index: 0;
}
.fx-mount {
  position: absolute;
  left: 0;
  top: 0;
  width: 480px;
  height: 100%;
  pointer-events: none;
}
/* 与模板 class="fx-mount-speed|fx-mount-payout" 对齐；官方 GamePageSkin：
   bg → speedEffectGroup → spinPanel → payoutGroup → betBoard */
.fx-mount-speed {
  z-index: 1; /* 官方 speedEffectGroup：在灯环下（含 speedEffectMask α=0.6） */
}
.fx-mount-payout {
  z-index: 3; /* 官方 payoutGroup：在灯环上、押注板下 */
}
.fx-mount-payout.fx-mount-amount-up {
  /* 滚分/飞顶时盖过押注板；飞顶还要盖过 HUD，否则 y=44 会被顶栏挡住 */
  z-index: 9;
}
.spin-anchor {
  position: absolute;
  left: 240px;
  top: 168px; /* GamePageSkin spinPanel y */
  width: 0;
  height: 0;
  z-index: 2;
  transition: opacity 0.5s ease;
}
.spin-anchor.faded {
  opacity: 0;
}
.total-bet {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: 4;
  color: #fff;
  font-weight: 400;
  pointer-events: none;
  white-space: nowrap;
  line-height: 1.2;
  letter-spacing: 0;
}
.panel {
  position: absolute;
  left: 0;
  width: 480px;
  z-index: 5;
  /* top 由 transformPanel 动画：下注 324 ↔ 开转 553（位移同官网 229） */
  will-change: top;
}
.panel-bg {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 480px;
  height: 426px;
  object-fit: fill;
  pointer-events: none;
}
.total-bet-bg {
  position: absolute;
  left: 50%;
  top: -7px;
  width: 193px;
  height: 45px;
  margin-left: -96.5px;
  object-fit: fill;
  pointer-events: none;
  z-index: 1;
}
.history-mask {
  position: absolute;
  z-index: 6;
  overflow: hidden;
  /* 官方 historyList 可点 → popupGameRule；盖过底板保证可点 */
  pointer-events: auto;
}
.history-list {
  position: absolute;
  display: flex;
  flex-direction: row;
  align-items: center; /* VerticalAlign middle */
  overflow: visible;
  gap: 0;
  margin: 0;
  padding: 0;
}
/* HistoryItemRendererSkin 50×50；gap=-1 */
.his-item {
  position: relative;
  flex: 0 0 50px;
  width: 50px;
  height: 50px;
  margin-right: -1px;
  overflow: visible;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.his-item:active {
  filter: brightness(1.25);
  transform: scale(0.96);
}
/* normal：max 45×45，horizontalCenter + verticalCenter */
.his-item .his-main {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 45px;
  height: 45px;
  margin-left: -22.5px;
  margin-top: -22.5px;
  object-fit: contain;
  image-rendering: auto;
  pointer-events: none;
}
/* latest：history_l / bonus 62×62，right=0 y=0（向左、向下溢出由 mask 裁） */
.his-item.latest .his-main {
  left: auto;
  right: 0;
  top: 0;
  width: 62px;
  height: 62px;
  margin: 0;
}
/* 特殊奖小车标：normal 默认 (0,0)；latest 偏 (-19,-5) */
.his-small {
  position: absolute;
  left: 0;
  top: 0;
  width: 30px;
  height: 30px;
  z-index: 2;
  pointer-events: none;
}
.his-item.latest .his-small {
  left: -19px;
  top: -5px;
}
.his-small .his-circle,
.his-small .his-car {
  position: absolute;
  left: 0;
  top: 0;
  width: 30px;
  height: 30px;
  object-fit: fill;
}
.abs-btn {
  position: absolute;
  z-index: 3;
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
  line-height: 0;
  font-size: 0;
  overflow: visible;
}
.more-btn img {
  width: 50px;
  height: 45px;
  display: block;
  object-fit: fill;
}
/* 清零/自动：光效 126×37 铺满，文字原尺寸居中+HC 偏移 */
.clear-btn,
.auto-btn {
  display: flex;
  align-items: center;
  justify-content: center;
}
.clear-btn .press-vfx,
.auto-btn .press-vfx {
  position: absolute;
  left: 0;
  top: 0;
  width: 126px;
  height: 37px;
  object-fit: fill;
  opacity: 0;
  pointer-events: none;
}
.clear-btn .press-vfx.flip-x {
  transform: scaleX(-1);
}
.clear-btn:not(:disabled):active .press-vfx,
.auto-btn:not(:disabled):active .press-vfx,
.auto-btn.on .press-vfx {
  opacity: 1;
}
.clear-btn .btn-txt,
.auto-btn .btn-txt {
  position: relative;
  z-index: 1;
  width: auto;
  height: auto;
  max-width: none;
  object-fit: contain;
  pointer-events: none;
}
.auto-btn .auto-round {
  position: relative;
  z-index: 1;
  color: #fff;
  font-size: 24px;
  font-weight: 700;
  line-height: 37px;
  text-shadow: 0 0 6px #3af;
  pointer-events: none;
}
/* 官方 autoItemList：竖排 gap=-36，菱形按钮 + 斜字 */
.auto-menu {
  position: absolute;
  z-index: 22;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
}
.auto-menu .auto-opt {
  position: relative;
  width: 110px;
  height: 75px;
  margin-bottom: -36px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  flex: 0 0 auto;
}
.auto-menu .auto-opt:last-child {
  margin-bottom: 0;
}
.auto-menu .auto-opt-bg {
  position: absolute;
  left: 0;
  top: 0;
  width: 110px;
  height: 75px;
  object-fit: fill;
  pointer-events: none;
  /* 素材黑底，screen 只留蓝光 */
  mix-blend-mode: screen;
}
.auto-menu .auto-opt-bg.on {
  opacity: 0;
}
.auto-menu .auto-opt:active .auto-opt-bg:not(.on) {
  opacity: 0;
}
.auto-menu .auto-opt:active .auto-opt-bg.on {
  opacity: 1;
}
.auto-menu .auto-opt-lbl {
  position: absolute;
  left: 50%;
  top: 50%;
  /* 官方 Label rotation=15.48 HC=9.5 VC=-1 size=28 */
  transform: translate(calc(-50% + 9.5px), calc(-50% - 1px)) rotate(15.48deg);
  z-index: 1;
  color: #fff;
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  text-shadow: 0 0 4px #1af, 0 1px 2px #000;
  pointer-events: none;
  max-width: 51px;
  max-height: 30px;
}
.auto-menu-block {
  position: absolute;
  left: -12px;
  right: -12px;
  top: -280px;
  height: 720px;
  z-index: 21;
  background: transparent;
}
.all-btn .all-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: fill;
}
.all-btn .all-bg.on {
  opacity: 0;
}
.all-btn:not(:disabled):active .all-bg:not(.on) {
  opacity: 0;
}
.all-btn:not(:disabled):active .all-bg.on {
  opacity: 1;
}
.all-btn .lbl {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 55px;
  height: 32px;
  transform: translate(-50%, -50%);
  object-fit: fill;
  pointer-events: none;
  z-index: 1;
}
.undo-btn {
  z-index: 6;
  overflow: visible;
}
.undo-btn .undo-circle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 40px;
  height: 40px;
  margin-left: -20px;
  margin-top: -20px;
  object-fit: fill;
  pointer-events: none;
}
.undo-btn .undo-arrow {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  mix-blend-mode: screen;
  pointer-events: none;
}
.chip img {
  width: 62px;
  height: 62px;
  object-fit: fill;
  mix-blend-mode: screen;
}
.chip span {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 800;
  font-size: 18px;
  text-shadow: 0 1px 2px #000;
  pointer-events: none;
}
.chip.on span {
  color: #ffe08a;
}
.chip-set-btn {
  z-index: 6;
  overflow: visible;
}
.chip-set-btn .chip-set-circle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 40px;
  height: 40px;
  margin-left: -20px;
  margin-top: -20px;
  object-fit: fill;
  pointer-events: none;
}
.chip-set-btn .chip-set-arrow {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  /* 素材黑底 → screen 抠黑，只留青色上箭头 */
  mix-blend-mode: screen;
  pointer-events: none;
}
.select-btn {
  z-index: 6;
  overflow: visible;
}
.select-btn .select-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
}
.select-btn .select-bg.on {
  opacity: 0;
}
.select-btn.open .select-bg:not(.on),
.select-btn:not(:disabled):active .select-bg:not(.on) {
  opacity: 0;
}
.select-btn.open .select-bg.on,
.select-btn:not(:disabled):active .select-bg.on {
  opacity: 1;
}
/*
 * EXML：source 37×23；arrowTop VC=-2.5 / arrowBottom VC=4.5；均朝上不翻转
 * startAnimation：每 1s，bottom 立刻 1↔0.5（200ms×2），top 延迟 200ms 同样 pingpong 一次
 */
.select-btn .arrow {
  position: absolute;
  left: 50%;
  width: 37px;
  height: 23px;
  transform: translate(-50%, -50%);
  object-fit: fill;
  pointer-events: none;
  z-index: 2;
  opacity: 1;
  image-rendering: auto;
}
.select-btn .arrow.top {
  top: calc(50% - 2.5px);
}
.select-btn .arrow.bottom {
  top: calc(50% + 4.5px);
}
.select-btn.anim .arrow.bottom {
  animation: arrowBottomFlash 1s linear infinite;
}
.select-btn.anim .arrow.top {
  animation: arrowTopFlash 1s linear infinite;
}
@keyframes arrowBottomFlash {
  0% {
    opacity: 1;
  }
  20% {
    opacity: 0.5;
  }
  40% {
    opacity: 1;
  }
  100% {
    opacity: 1;
  }
}
@keyframes arrowTopFlash {
  0%,
  20% {
    opacity: 1;
  }
  40% {
    opacity: 0.5;
  }
  60% {
    opacity: 1;
  }
  100% {
    opacity: 1;
  }
}
/* 官方 betAllOptionItemList：竖排 gap=-20，项≈87×53，贴筛选箭头上方 */
.bet-all-menu {
  position: absolute;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: auto;
}
.bet-all-menu .opt {
  position: relative;
  width: 75px;
  height: 53px;
  margin-bottom: -20px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  flex: 0 0 auto;
}
.bet-all-menu .opt:last-child {
  margin-bottom: 0;
}
.bet-all-menu .opt .opt-bg {
  position: absolute;
  left: 50%;
  top: 50%;
  /* 官网 source 87×53；off 贴图仅 67×34（offX=10,offY=9），on 接近满幅 */
  width: 67px;
  height: 34px;
  margin-left: -33.5px;
  margin-top: -17px;
  object-fit: fill;
  pointer-events: none;
}
.bet-all-menu .opt.on .opt-bg {
  width: 87px;
  height: 53px;
  margin-left: -43.5px;
  margin-top: -26.5px;
}
.bet-all-menu .opt.flip .opt-bg {
  transform: scaleY(-1);
}
.bet-all-menu .opt .opt-icon,
.bet-all-menu .opt .opt-lbl {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  pointer-events: none;
}
.bet-all-menu .opt .opt-icon {
  object-fit: contain;
  mix-blend-mode: normal;
}
/* 官网各车标原尺寸：benz/vw≈28–32，bmw=32，audi 扁宽 41×15 */
.bet-all-menu .opt .icon-benz {
  width: 28px;
  height: 28px;
}
.bet-all-menu .opt .icon-bmw {
  width: 32px;
  height: 32px;
}
.bet-all-menu .opt .icon-audi {
  width: 41px;
  height: 15px;
}
.bet-all-menu .opt .icon-volkswagen {
  width: 29px;
  height: 29px;
}
.bet-all-menu .opt .opt-lbl {
  width: 49px;
  height: 28px;
  object-fit: fill;
}
.bet-all-block {
  position: absolute;
  left: -12px;
  right: -12px;
  top: -280px;
  height: 720px;
  z-index: 19;
  background: transparent;
}
.all-btn .brand-icon {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 28px;
  height: 28px;
  transform: translate(-50%, -50%);
  object-fit: contain;
  z-index: 1;
  pointer-events: none;
  mix-blend-mode: normal;
}
.start-btn,
.stop-auto-btn {
  overflow: visible;
}
.start-btn:disabled {
  opacity: 0.45;
}
/* 官方：yben_vfx_start_on 默认 alpha=0，按下才亮；文字 73×39 居中 */
.start-vfx {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 120px;
  height: 120px;
  margin-left: -60px;
  margin-top: -60px;
  object-fit: fill;
  opacity: 0;
  pointer-events: none;
}
.start-btn:not(:disabled):active .start-vfx {
  opacity: 1;
}
/* 官方 stopAutoBtn：黑圆 + yben_vfx_stop_on + yben_txt_stop */
.stop-auto-btn .stop-circle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 90px;
  height: 90px;
  margin-left: -45px;
  margin-top: -45px;
  object-fit: fill;
  pointer-events: none;
  mix-blend-mode: screen;
  opacity: 0.85;
}
.stop-auto-btn .stop-vfx {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 120px;
  height: 120px;
  margin-left: -60px;
  margin-top: -60px;
  object-fit: fill;
  pointer-events: none;
  mix-blend-mode: screen;
}
.stop-auto-btn:active .stop-vfx {
  opacity: 0;
}
.stop-auto-btn .stop-txt {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 74px;
  height: 40px;
  margin-left: -37px;
  margin-top: -15px; /* 官方 VC=5 */
  object-fit: fill;
  pointer-events: none;
  z-index: 1;
}
.start-txt {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 73px;
  height: 39px;
  margin-left: -36.5px;
  margin-top: -19.5px;
  object-fit: fill;
  pointer-events: none;
}
.hud {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  height: 110px;
  z-index: 8;
  pointer-events: none;
}
.hud > * {
  pointer-events: auto;
}
/* 官方 backBtn @ left=0 top=10；略上移避免压住灯环顶部车标 */
.back {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 40px;
  height: 40px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.back img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: screen;
}
/*
  紧贴返回键右侧；圆孔内显示用户头像
*/
.user-profile {
  position: absolute;
  left: 38px;
  top: 2px;
  width: 216px;
  height: 92px;
}
.user-profile .profile-frame {
  position: absolute;
  left: 0;
  top: 0;
  width: 216px;
  height: 92px;
  object-fit: fill;
  pointer-events: none;
  mix-blend-mode: screen;
}
.user-profile .avatar {
  position: absolute;
  left: 25px;
  top: 25px;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  overflow: hidden;
  pointer-events: none;
  z-index: 1;
}
.user-profile .avatar-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}
.user-profile .avatar-ring {
  position: absolute;
  left: 25.5px;
  top: 25.5px;
  width: 41px;
  height: 41px;
  object-fit: contain;
  mix-blend-mode: screen;
  pointer-events: none;
  z-index: 2;
}
.user-profile .amount {
  position: absolute;
  left: 70px;
  top: 42px;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 132px;
  height: 20px;
}
.user-profile .coin {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  object-fit: contain;
  mix-blend-mode: screen;
  pointer-events: none;
}
.user-profile #bcbm-balance {
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.3px;
  font-variant-numeric: tabular-nums;
  text-shadow:
    0 0 8px rgba(37, 206, 216, 0.55),
    0 1px 2px rgba(0, 0, 0, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hud-actions {
  position: absolute;
  right: 4px;
  top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.hud-btn {
  width: 40px;
  height: 40px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.hud-btn img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  mix-blend-mode: screen;
}
.hud-btn:active img {
  filter: brightness(1.25);
}
</style>
