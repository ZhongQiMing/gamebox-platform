<template>
  <div class="mahjong-game-page">
    <!-- 游戏画布 720×1280 竖屏（灵光素材） -->
    <div class="game-container">

      <!-- PS 叠层：底图 → 顶栏 UI → 牌面 → 底栏 UI → 按钮 -->

      <!-- ① 底图 -->
      <div class="layer layer-base z-bg">
        <img class="layer-img" :src="`${LG}/bg-base.png`" alt="" />
      </div>

      <!-- 游戏层：麻将牌（在底图之上、UI 框之下；边框已烘焙在 bg-base 内） -->
      <svg style="width:0;height:0;position:absolute;" aria-hidden="true" focusable="false">
        <defs>
          <filter id="carve-effect" color-interpolation-filters="sRGB">
            <!-- 获取透明度 -->
            <feComponentTransfer in="SourceAlpha" result="alpha">
              <feFuncA type="linear" slope="1"/>
            </feComponentTransfer>

            <!-- 内部阴影 (刻痕左上侧) -->
            <feGaussianBlur in="alpha" stdDeviation="1.2" result="blur_inner_shadow"/>
            <feOffset in="blur_inner_shadow" dx="1.5" dy="1.5" result="offset_inner_shadow"/>
            <feComposite in="alpha" in2="offset_inner_shadow" operator="out" result="inner_shadow_shape"/>
            <feFlood flood-color="#000000" flood-opacity="0.9" result="dark_color"/>
            <feComposite in="dark_color" in2="inner_shadow_shape" operator="in" result="inner_shadow"/>

            <!-- 内部高光 (刻痕右下侧) -->
            <feGaussianBlur in="alpha" stdDeviation="0.8" result="blur_inner_highlight"/>
            <feOffset in="blur_inner_highlight" dx="-1.5" dy="-1.5" result="offset_inner_highlight"/>
            <feComposite in="alpha" in2="offset_inner_highlight" operator="out" result="inner_highlight_shape"/>
            <feFlood flood-color="#ffffff" flood-opacity="0.6" result="light_color"/>
            <feComposite in="light_color" in2="inner_highlight_shape" operator="in" result="inner_highlight"/>

            <!-- 原图压暗加深 -->
            <feComponentTransfer in="SourceGraphic" result="darkened_source">
              <feFuncR type="linear" slope="0.7"/>
              <feFuncG type="linear" slope="0.7"/>
              <feFuncB type="linear" slope="0.7"/>
            </feComponentTransfer>

            <!-- 外部高光 (雕刻边缘右下侧受光) -->
            <feGaussianBlur in="alpha" stdDeviation="0.5" result="blur_outer"/>
            <feOffset in="blur_outer" dx="1" dy="1" result="offset_outer"/>
            <feComposite in="offset_outer" in2="alpha" operator="out" result="outer_highlight_shape"/>
            <feFlood flood-color="#ffffff" flood-opacity="0.8" result="outer_light_color"/>
            <feComposite in="outer_light_color" in2="outer_highlight_shape" operator="in" result="outer_highlight"/>

            <!-- 合并 -->
            <feMerge>
              <feMergeNode in="outer_highlight"/>
              <feMergeNode in="darkened_source"/>
              <feMergeNode in="inner_shadow"/>
              <feMergeNode in="inner_highlight"/>
            </feMerge>
          </filter>
        </defs>
      </svg>

      <!-- ①b 麻将牌（在底图之上、顶栏 UI 之下） -->
      <div class="layer-board game-board-area z-board" :style="boardStyle">
        <div id="grid-container" class="grid-container">
          
          <div v-if="showWinEffect" id="svg-overlay-container" class="svg-overlay-container" :class="{ 'is-turbo': isTurbo }">
             <div class="play-area-frame" :style="playAreaStyle"></div>
             <svg width="100%" height="100%">
               <path 
                 v-for="(d, idx) in lightningPaths" 
                 :key="idx" 
                 :d="d" 
                 fill="none" 
                 stroke="#ffd700" 
                 stroke-width="5" 
                 class="lightning-path"
               />
               <path 
                 v-for="(d, idx) in lightningPaths" 
                 :key="'core-'+idx" 
                 :d="d" 
                 fill="none" 
                 stroke="#fff8dc" 
                 stroke-width="2" 
                 class="lightning-core"
               />
             </svg>
          </div>

          <div
            class="grid-col"
            v-for="(col, colIndex) in 5"
            :key="colIndex"
            :class="{ 'is-spinning-col': isSpinning }"
          >
            <div 
              class="col-inner" 
              :class="{ 
                'is-spinning': isSpinning, 
                'is-turbo': isTurbo,
              }" 
              :style="{ animationDelay: `${colIndex * (isTurbo ? 0.015 : 0.05)}s` }"
            >
              <MahjongTile 
                v-for="(tile, rowIndex) in (isSpinning ? spinningCols[colIndex] : gridData[colIndex])" 
                :key="`${colIndex}-${rowIndex}-${tile.symbol}`"
                :id="!isSpinning && isVisibleRow(rowIndex) ? `tile-${colIndex}-${rowIndex}` : undefined"
                :symbol="tile.symbol"
                :is-golden="tile.isGolden"
                :is-exploding="explodingCells.has(`${colIndex}-${rowIndex}`)"
                :asset-base="symbolAssetBase"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- ② 倍数框 -->
      <div class="layer z-mult-bar" :style="layerStyle(L.multBar.y, L.multBar.h)">
        <img class="layer-img" :src="`${LG}/multiplier-bar-bg.png`" alt="" />
      </div>

      <!-- ③ 1024框 -->
      <div class="layer z-title1024" :style="layerStyle(L.title1024.y, L.title1024.h)">
        <img class="layer-img" :src="`${LG}/top-title-1024.png`" alt="" />
      </div>

      <!-- ④ 倍数：常规扁平 + 当前档位特效叠加 -->
      <div class="layer z-mult-values" :style="layerStyle(L.multValues.y, L.multValues.h)">
        <div class="mult-values-stack">
          <img class="mult-values-img" :src="`${LG}/multiplier-values.png`" alt="" />
          <img
            class="mult-values-img mult-values-active"
            :src="`${LG}/multiplier-values-active.png`"
            alt=""
            :style="activeMultClipStyle"
          />
        </div>
        <div class="multiplier-area">
          <div
            v-for="(mult, index) in activeMultiplierLadder"
            :key="index"
            class="mult-slot-glow"
            :class="{ 'is-current': activeMultiplierIndex === index }"
            :style="{ left: multiplierPositions[index] + '%' }"
          >
            <span class="mult-slot-label">×{{ mult }}</span>
          </div>
        </div>
      </div>

      <!-- ⑤ 底图2 -->
      <div class="layer z-wood" :style="layerStyle(L.woodFooter.y, L.woodFooter.h)">
        <img class="layer-img" :src="`${LG}/wood-top-panel.png`" alt="" />
      </div>

      <!-- ⑥ 下框 -->
      <div class="layer z-bottom-frame" :style="layerStyle(L.bottomFrame.y, L.bottomFrame.h)">
        <img class="layer-img" :src="`${LG}/bottom-frame-bar.png`" alt="" />
      </div>

      <!-- ⑦ 广告框 -->
      <div class="layer layer-copy z-message" :style="layerStyle(L.message.y, L.message.h)">
        <img class="layer-img layer-img--ribbon" :src="`${LG}/message-ribbon.png`" alt="" />
        <div class="info-ticker-bar">
          <Transition name="slide-left">
            <div :key="currentInfoIndex" class="neon-info-text" v-html="infoMessages[currentInfoIndex]"></div>
          </Transition>
        </div>
      </div>

      <!-- ⑧ 最底部色块 -->
      <div class="layer z-bottom-control" :style="layerStyle(L.bottomControl.y, L.bottomControl.h)">
        <img class="layer-img" :src="`${LG}/bottom-control-bg.png`" alt="" />
      </div>

      <!-- ⑨b 按钮边框 -->
      <div class="layer z-btn-frame" :style="btnFrameStyle">
        <img class="layer-img" :src="`${BTN}/btn-frame.png`" alt="" />
      </div>

      <!-- 交互层：金额框（落在外框条上，不遮挡牌面） -->
      <div class="layer layer-hud z-hud" :style="layerStyle(L.statusHud.y, L.statusHud.h)">
        <div class="layer-hud__bar">
          <div class="layer-hud__values">
            <div class="hud-icon-box clickable" @click="togglePopup('wallet')">
              <span class="hud-icon hud-icon--wallet" aria-hidden="true"></span>
              <span class="hud-value">¥{{ balance.toFixed(2) }}</span>
            </div>
            <div class="hud-icon-box clickable" @click="togglePopup('bet')">
              <span class="hud-icon hud-icon--chip" aria-hidden="true"></span>
              <span class="hud-value">¥{{ betAmount.toFixed(2) }}</span>
            </div>
            <div class="hud-icon-box clickable" @click="togglePopup('win')">
              <span class="hud-icon hud-icon--win" aria-hidden="true"></span>
              <span class="hud-value">¥{{ winAmount.toFixed(2) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 免费旋转提示 -->
      <Transition name="fade">
        <div v-if="isFreeSpinMode" class="free-spin-banner z-hud">
          <span class="free-spin-banner__title">免费旋转</span>
          <span class="free-spin-banner__count">剩余 {{ freeSpinsRemaining }} 次</span>
        </div>
      </Transition>

      <!-- 交互层：按钮 -->
      <div class="btn-interactive-layer z-buttons">
        <Transition name="slide-left-page">
          <div class="bottom-action-bar" v-if="!showMenuPage" :style="btnBarStyle">
            <button class="action-btn small-btn turbo-btn" :class="{ 'is-active': isTurbo }" @click="toggleTurbo"></button>
            <button class="action-btn small-btn minus-btn" @click="decreaseBet"></button>
            <button class="action-btn spin-btn" :class="{ 'is-spinning': isSpinning }" @click="handleSpinClick"></button>
            <button class="action-btn small-btn plus-btn" @click="increaseBet"></button>
            <button class="action-btn small-btn auto-btn" :class="{ 'is-active': autoSpinCount > 0 }" @click="autoSpinCount > 0 ? stopAutoSpin() : togglePopup('auto')">
              <div v-if="autoSpinCount > 0" class="auto-count-badge">{{ autoSpinCount }}</div>
            </button>
          </div>
        </Transition>

        <Transition name="slide-right-page">
          <div class="bottom-action-menu-page" v-if="showMenuPage" :style="btnBarStyle">
            <button class="action-btn menu-page-btn exit-btn" @click="router.back()"></button>
            <button
              class="action-btn menu-page-btn sound-btn"
              :class="soundEnabled ? 'is-on' : 'is-off'"
              @click="toggleSound"
            ></button>
            <button class="action-btn menu-page-btn paytable-btn" @click="openInfoSheet('pay')"></button>
            <button class="action-btn menu-page-btn rules-btn" @click="openInfoSheet('rules')"></button>
            <button class="action-btn menu-page-btn history-btn" @click="showHistoryModal = true"></button>
            <button class="action-btn menu-page-btn close-menu-btn" @click="showMenuPage = false"></button>
          </div>
        </Transition>

        <button
          v-if="!showMenuPage"
          class="menu-hamburger"
          :style="menuBtnStyle"
          aria-label="菜单"
          @click="showMenuPage = true"
        >
          <img :src="`${ASSET}/buttons/icon-menu.png`" alt="" class="menu-hamburger__icon" />
        </button>
      </div>

      <MahjongInfoSheet
        :visible="infoSheetVisible"
        :initial-tab="infoSheetTab"
        :bet-amount="betAmount"
        @close="infoSheetVisible = false"
      />

      <!-- 底部上拉框 (点击金额格子弹出) -->
      <Transition name="slide-up">
        <div v-if="activePopup" class="hud-popup-drawer" :class="{ 'bet-popup-style': activePopup === 'bet' }">
          
          <!-- 只有投注入置才使用全新的弹窗结构 -->
          <div v-if="activePopup === 'bet'" class="bet-settings-container">
            <div class="bet-popup-header">
              <span class="popup-title">投注设置</span>
              <button class="close-popup-btn" @click="closePopup">×</button>
            </div>
            
            <div class="bet-table">
              <div class="bet-thead">
                <div>投注大小</div>
                <div>投注倍数</div>
                <div>基础投注</div>
                <div>投注总额</div>
              </div>
              
              <div class="bet-tbody">
                <div class="bet-highlight-row"></div>
                
                <!-- 投注大小列 -->
                <div class="bet-wheel">
                  <div class="bet-wheel-item" v-for="offset in [-2, -1, 0, 1, 2]" :key="`size-${offset}`"
                       :class="{'is-active': offset === 0, 'fade-1': Math.abs(offset)===1, 'fade-2': Math.abs(offset)===2}"
                       @click="currentSizeIdx + offset >= 0 && currentSizeIdx + offset < betSizes.length ? currentSizeIdx += offset : null">
                    {{ currentSizeIdx + offset >= 0 && currentSizeIdx + offset < betSizes.length ? '￥' + betSizes[currentSizeIdx + offset].toFixed(2) : '-' }}
                  </div>
                </div>
                
                <div class="bet-separator-col">
                  <div class="bet-wheel-item" v-for="offset in [-2, -1, 0, 1, 2]" :key="`sep1-${offset}`">
                    <span v-if="offset === 0">x</span>
                  </div>
                </div>
                
                <!-- 投注倍数列 -->
                <div class="bet-wheel">
                  <div class="bet-wheel-item" v-for="offset in [-2, -1, 0, 1, 2]" :key="`mult-${offset}`"
                       :class="{'is-active': offset === 0, 'fade-1': Math.abs(offset)===1, 'fade-2': Math.abs(offset)===2}"
                       @click="currentMultIdx + offset >= 0 && currentMultIdx + offset < betMultipliers.length ? currentMultIdx += offset : null">
                    {{ currentMultIdx + offset >= 0 && currentMultIdx + offset < betMultipliers.length ? betMultipliers[currentMultIdx + offset] : '-' }}
                  </div>
                </div>
                
                <div class="bet-separator-col">
                  <div class="bet-wheel-item" v-for="offset in [-2, -1, 0, 1, 2]" :key="`sep2-${offset}`">
                    <span v-if="offset === 0">x</span>
                  </div>
                </div>
                
                <!-- 基础投注列 -->
                <div class="bet-wheel">
                  <div class="bet-wheel-item" v-for="offset in [-2, -1, 0, 1, 2]" :key="`base-${offset}`"
                       :class="{'is-active': offset === 0, 'fade-1': Math.abs(offset)===1, 'fade-2': Math.abs(offset)===2}">
                    {{ offset === 0 ? baseBet : '' }}
                  </div>
                </div>
                
                <div class="bet-separator-col">
                  <div class="bet-wheel-item" v-for="offset in [-2, -1, 0, 1, 2]" :key="`sep3-${offset}`">
                    <span v-if="offset === 0">=</span>
                  </div>
                </div>
                
                <!-- 投注总额列 -->
                <div class="bet-wheel">
                  <div class="bet-wheel-item total-text" v-for="offset in [-2, -1, 0, 1, 2]" :key="`total-${offset}`"
                       :class="{'is-active': offset === 0, 'fade-1': Math.abs(offset)===1, 'fade-2': Math.abs(offset)===2}"
                       @click="currentTotalIdx + offset >= 0 && currentTotalIdx + offset < validTotals.length ? increaseBet() /* simplified click */ : null">
                    {{ currentTotalIdx + offset >= 0 && currentTotalIdx + offset < validTotals.length ? '￥' + validTotals[currentTotalIdx + offset].toFixed(2) : '-' }}
                  </div>
                </div>
              </div>
            </div>
            
            <div class="bet-popup-footer">
              <button class="cyber-btn cancel-btn" @click="closePopup">取 消</button>
              <button class="cyber-btn confirm-btn" @click="closePopup">确 定</button>
            </div>
          </div>

          <!-- 自动旋转设置弹窗 -->
          <div v-if="activePopup === 'auto'" class="bet-settings-container">
            <div class="bet-popup-header">
              <span class="popup-title">自动旋转</span>
              <button class="close-popup-btn" @click="closePopup">×</button>
            </div>
            
            <div class="auto-spin-section">
              <div class="auto-spin-label">自动旋转次数</div>
              <div class="auto-spin-options">
                <button 
                  v-for="opt in autoSpinOptions" 
                  :key="opt"
                  class="auto-opt-btn"
                  :class="{ 'is-selected': selectedAutoSpinCount === opt }"
                  @click="selectedAutoSpinCount = opt"
                >
                  {{ opt }}
                </button>
              </div>
            </div>

            <div class="bet-popup-footer" style="margin-top: 25px;">
              <button class="auto-start-btn" @click="startAutoSpin">开始自动旋转</button>
            </div>
          </div>
          <div v-if="activePopup === 'wallet'">
            <div class="popup-header">
              <span class="popup-title">账户余额详情</span>
              <button class="close-popup-btn" @click="closePopup">×</button>
            </div>
            <div class="popup-content">
              <div class="popup-item">
                <span class="label">可用余额:</span>
                <span class="value cyan-text">￥{{ balance.toFixed(2) }}</span>
              </div>
            </div>
          </div>

          <!-- 赢取详情弹窗 (赛博风格) -->
          <div v-if="activePopup === 'win'" class="win-popup-container">
            <div class="bet-popup-header">
              <span class="popup-title">赢取详情</span>
              <button class="close-popup-btn" @click="closePopup">×</button>
            </div>
            
            <div class="recent-history-list">
              <div class="history-list-header">
                <span>时间</span>
                <span style="text-align: right;">盈利</span>
              </div>
              <div class="history-list-body">
                <div class="history-row" v-for="record in historyRecords.slice(0, 10)" :key="record.id">
                  <span class="history-time">{{ record.time }}</span>
                  <span class="history-profit" :class="record.profit > 0 ? 'text-win' : 'text-lose'">
                    {{ record.profit > 0 ? '+' : '' }}{{ record.profit.toFixed(2) }}
                  </span>
                </div>
              </div>
            </div>

            <div class="bet-popup-footer" style="margin-top: 15px;">
              <button class="cyber-btn confirm-btn" style="width: 100%;" @click="showHistoryModal = true; closePopup()">查看更多</button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 历史记录全屏弹窗 -->
      <Transition name="fade">
        <div v-if="showHistoryModal" class="full-modal-overlay">
          <div class="full-modal-content">
            <div class="modal-header">
              <span class="modal-title">今日记录</span>
              <button class="close-modal-btn" @click="showHistoryModal = false">×</button>
            </div>
            <div class="modal-body">
              <table class="cyber-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>交易单号</th>
                    <th>投注</th>
                    <th>盈利</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="record in historyRecords" :key="record.id">
                    <td>{{ record.time }}</td>
                    <td class="txn-id">{{ record.id }}</td>
                    <td>￥{{ record.bet.toFixed(2) }}</td>
                    <td :class="record.profit > 0 ? 'text-win' : 'text-lose'">
                      {{ record.profit > 0 ? '+' : '' }}{{ record.profit.toFixed(2) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Transition>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import MahjongTile from '../components/MahjongTile.vue'
import MahjongInfoSheet from '../components/MahjongInfoSheet.vue'
import {
  BASE_BET,
  COLS,
  TOTAL_ROWS,
  VISIBLE_ROWS,
  VISIBLE_ROW_INDICES,
  CASCADE_MULTIPLIERS,
  FREE_SPIN_MULTIPLIERS,
  type TileCell,
  type GridPos,
  createEmptyGrid,
  evaluateWins,
  rollColumn,
  rollTile,
  applyGoldenToWild,
  getCellsToRemove,
  dropAndRefill,
  freeSpinsFromScatters,
} from '../games/mahjong/mahjongWays1'

const router = useRouter()
const LG = '/images/games/mahjong/lingguang'
const BTN = `${LG}/buttons`
const ASSET = '/images/games/mahjong/classic'
const symbolAssetBase = `${ASSET}/symbols`

/** 画布设计稿 720×1280 — Y 坐标按 PS 稿像素值 */
const CANVAS_W = 720
const CANVAS_H = 1280

const L = {
  title1024: { y: 0, h: 143 },
  multBar: { y: 69, h: 134 },
  multValues: { y: 109, h: 82 },
  board: { y: 234, h: 592, left: 7.5, width: 85 },
  bottomFrame: { y: 850, h: 129 },
  message: { y: 929, h: 85 },
  woodFooter: { y: 952, h: 170 },
  bottomControl: { y: CANVAS_H - 177, h: 177 },
  statusHud: { y: 856, h: 52 },
}

/** 按钮区：边框 596×120，水平居中，Y=1137 */
const BTN_FRAME = { x: 62, y: 1137, w: 596, h: 120 }

function layerStyle(y: number, h: number) {
  return {
    top: `${(y / CANVAS_H) * 100}%`,
    height: `${(h / CANVAS_H) * 100}%`,
  }
}

function boxStyle(x: number, y: number, w: number, h: number) {
  return {
    top: `${(y / CANVAS_H) * 100}%`,
    left: `${(x / CANVAS_W) * 100}%`,
    width: `${(w / CANVAS_W) * 100}%`,
    height: `${(h / CANVAS_H) * 100}%`,
  }
}

const btnFrameStyle = computed(() => boxStyle(BTN_FRAME.x, BTN_FRAME.y, BTN_FRAME.w, BTN_FRAME.h))
const btnBarStyle = computed(() => btnFrameStyle.value)
/** 汉堡按钮：按钮边框右缘与页面右缘之间水平居中，垂直与边框居中 */
const menuBtnStyle = computed(() => {
  const frameRight = BTN_FRAME.x + BTN_FRAME.w
  const centerX = (frameRight + CANVAS_W) / 2
  const centerY = BTN_FRAME.y + BTN_FRAME.h / 2
  return {
    left: `${(centerX / CANVAS_W) * 100}%`,
    top: `${(centerY / CANVAS_H) * 100}%`,
  }
})

const boardStyle = computed(() => {
  const rowH = (L.board.h - 3 * (VISIBLE_ROWS - 1)) / VISIBLE_ROWS
  const sixRowH = rowH * TOTAL_ROWS + 3 * (TOTAL_ROWS - 1)
  return {
    top: `${(L.board.y / CANVAS_H) * 100}%`,
    left: `${L.board.left}%`,
    width: `${L.board.width}%`,
    height: `${(sixRowH / CANVAS_H) * 100}%`,
  }
})

const isVisibleRow = (row: number) =>
  (VISIBLE_ROW_INDICES as readonly number[]).includes(row)

/** 倍数图内各档位裁切边界（与 569×82 素材实测对齐） */
const MULT_CLIP_BOUNDS = [
  { left: 0, right: 80.0 },   // x1: 0%–20%
  { left: 26.4, right: 53.1 }, // x2: 26.4%–46.9%
  { left: 52.4, right: 27.1 }, // x3: 52.4%–72.9%
  { left: 79.4, right: 0 },   // x5: 79.4%–100%
] as const

const multiplierPositions = ref([9.9, 36.6, 62.6, 89.6])

const activeMultClipStyle = computed(() => {
  const bounds = MULT_CLIP_BOUNDS[activeMultiplierIndex.value]
  return { clipPath: `inset(0 ${bounds.right}% 0 ${bounds.left}%)` }
})

// 中奖连线与发光特效状态
const showWinEffect = ref(false)
const lightningPaths = ref<string[]>([])
const playAreaStyle = ref({})

// 自动旋转状态
const autoSpinCount = ref(0)
const selectedAutoSpinCount = ref(10)
const autoSpinOptions = [10, 30, 50, 80, 1000]

// 菜单页状态
const showMenuPage = ref(false)

const soundEnabled = ref(localStorage.getItem('sound_off') !== '1')

const toggleSound = () => {
  soundEnabled.value = !soundEnabled.value
  if (soundEnabled.value) {
    localStorage.removeItem('sound_off')
  } else {
    localStorage.setItem('sound_off', '1')
  }
}

const startAutoSpin = () => {
  autoSpinCount.value = selectedAutoSpinCount.value
  closePopup()
  if (!isSpinning.value) {
    handleSpinClick()
  }
}

const stopAutoSpin = () => {
  autoSpinCount.value = 0
}

const checkNextAutoSpin = () => {
  if (isFreeSpinMode.value && freeSpinsRemaining.value > 0) return
  if (autoSpinCount.value > 0) {
    autoSpinCount.value--
    if (autoSpinCount.value > 0 && balance.value >= betAmount.value) {
      setTimeout(() => {
        handleSpinClick()
      }, 500)
    } else {
      autoSpinCount.value = 0
    }
  }
}

// 赔付表 / 规则弹窗
const infoSheetVisible = ref(false)
const infoSheetTab = ref<'pay' | 'rules'>('pay')
const openInfoSheet = (tab: 'pay' | 'rules') => {
  infoSheetTab.value = tab
  infoSheetVisible.value = true
  showMenuPage.value = false
}

// 免费旋转（官方：3 胡 = 12 次，每多 1 个 +2）
const isFreeSpinMode = ref(false)
const freeSpinsRemaining = ref(0)

const activeMultiplierLadder = computed(() =>
  isFreeSpinMode.value ? [...FREE_SPIN_MULTIPLIERS] : [...CASCADE_MULTIPLIERS],
)

const explodingCells = ref<Set<string>>(new Set())
const isResolving = ref(false)

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const triggerFreeSpins = (scatterCount: number) => {
  const added = freeSpinsFromScatters(scatterCount)
  if (added <= 0) return
  isFreeSpinMode.value = true
  freeSpinsRemaining.value += added
}

const finishRound = () => {
  historyRecords.value.unshift({
    id: currentRecordId.value,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    bet: isFreeSpinMode.value ? 0 : betAmount.value,
    profit: winAmount.value,
  })
  checkNextAutoSpin()
}

const showWinLightning = async (winCells: GridPos[]) => {
  if (!winCells.length) return

  const colSet = new Set(winCells.map((c) => c.col))
  let maxCol = 0
  for (let c = 0; c < COLS; c++) {
    if (colSet.has(c)) maxCol = c
    else break
  }
  const pathCells: GridPos[] = []
  for (let c = 0; c <= maxCol; c++) {
    const inCol = winCells.filter((w) => w.col === c)
    if (inCol.length) pathCells.push(inCol[0])
  }

  showWinEffect.value = true
  await nextTick()

  const getTileCenter = (c: number, r: number) => {
    const el = document.getElementById(`tile-${c}-${r}`)
    const container = document.getElementById('grid-container')
    if (el && container) {
      const rect = el.getBoundingClientRect()
      const contRect = container.getBoundingClientRect()
      return {
        x: rect.left - contRect.left + rect.width / 2,
        y: rect.top - contRect.top + rect.height / 2,
      }
    }
    return { x: 0, y: 0 }
  }

  const tlTile = document.getElementById(`tile-0-${VISIBLE_ROW_INDICES[0]}`)
  const brTile = document.getElementById(`tile-4-${VISIBLE_ROW_INDICES[VISIBLE_ROW_INDICES.length - 1]}`)
  const cont = document.getElementById('grid-container')
  if (tlTile && brTile && cont) {
    const tl = tlTile.getBoundingClientRect()
    const br = brTile.getBoundingClientRect()
    const cr = cont.getBoundingClientRect()
    playAreaStyle.value = {
      top: `${tl.top - cr.top - 8}px`,
      left: `${tl.left - cr.left - 8}px`,
      width: `${br.right - tl.left + 16}px`,
      height: `${br.bottom - tl.top + 16}px`,
    }
  }

  let pathD = ''
  pathCells.forEach((node, idx) => {
    const center = getTileCenter(node.col, node.row)
    if (idx === 0) {
      pathD += `M ${center.x} ${center.y} `
    } else {
      const prev = getTileCenter(pathCells[idx - 1].col, pathCells[idx - 1].row)
      const midX1 = prev.x + (center.x - prev.x) * 0.33 + (Math.random() * 20 - 10)
      const midY1 = prev.y + (center.y - prev.y) * 0.33 + (Math.random() * 20 - 10)
      const midX2 = prev.x + (center.x - prev.x) * 0.66 + (Math.random() * 20 - 10)
      const midY2 = prev.y + (center.y - prev.y) * 0.66 + (Math.random() * 20 - 10)
      pathD += `L ${midX1} ${midY1} L ${midX2} ${midY2} L ${center.x} ${center.y} `
    }
  })
  lightningPaths.value = pathD ? [pathD] : []
  await sleep(isTurbo.value ? 280 : 550)
  showWinEffect.value = false
  lightningPaths.value = []
}

/** 官方级联：中奖 → 结算 → 镀金转百搭 → 消除下落 → 连击倍数递增 */
const runCascadeResolution = async () => {
  isResolving.value = true
  let cascadeStep = 0
  let totalScatter = 0

  while (true) {
    activeMultiplierIndex.value = Math.min(cascadeStep, 3)

    const { totalWin, winCells, scatterCount } = evaluateWins(
      gridData.value,
      betAmount.value,
      cascadeStep,
      isFreeSpinMode.value,
    )
    totalScatter = Math.max(totalScatter, scatterCount)

    if (totalWin <= 0 || winCells.length === 0) break

    winAmount.value += totalWin
    balance.value += totalWin

    await showWinLightning(winCells)

    const toRemove = getCellsToRemove(gridData.value, winCells)
    applyGoldenToWild(gridData.value, winCells)

    explodingCells.value = new Set(toRemove.map(({ col, row }) => `${col}-${row}`))
    await sleep(isTurbo.value ? 320 : 480)

    dropAndRefill(gridData.value, toRemove)
    explodingCells.value.clear()
    await nextTick()
    await sleep(isTurbo.value ? 180 : 320)

    cascadeStep++
  }

  isResolving.value = false
  finishRound()

  if (totalScatter >= 3) {
    triggerFreeSpins(totalScatter)
  }

  if (isFreeSpinMode.value && freeSpinsRemaining.value > 0) {
    setTimeout(() => handleSpinClick(), isTurbo.value ? 400 : 800)
  }
}

// 旋转状态
const isSpinning = ref(false)

// 极速模式状态
const isTurbo = ref(false)
const toggleTurbo = () => {
  if (isSpinning.value) return // 旋转中不允许切换
  isTurbo.value = !isTurbo.value
}

// 投注逻辑
const betSizes = [0.01, 0.03, 0.10, 1.00, 5.00]
const betMultipliers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const baseBet = BASE_BET

const validCombinations = []
for(let s=0; s<betSizes.length; s++) {
  for(let m=0; m<betMultipliers.length; m++) {
    validCombinations.push({
      sizeIdx: s,
      multIdx: m,
      total: betSizes[s] * betMultipliers[m] * baseBet
    })
  }
}
validCombinations.sort((a, b) => a.total - b.total)
const validTotals = Array.from(new Set(validCombinations.map(c => c.total))).sort((a,b) => a-b)

const currentSizeIdx = ref(1) // 默认 0.03
const currentMultIdx = ref(2) // 默认 3

const betAmount = computed(() => betSizes[currentSizeIdx.value] * betMultipliers[currentMultIdx.value] * baseBet)
const currentTotalIdx = computed(() => validTotals.indexOf(betAmount.value))

const increaseBet = () => {
  const currentTotal = betAmount.value;
  const nextCombo = validCombinations.find(c => c.total > currentTotal + 0.001);
  if (nextCombo) {
    currentSizeIdx.value = nextCombo.sizeIdx;
    currentMultIdx.value = nextCombo.multIdx;
  }
}
const decreaseBet = () => {
  const currentTotal = betAmount.value;
  const prevCombos = validCombinations.filter(c => c.total < currentTotal - 0.001);
  if (prevCombos.length > 0) {
    const prevCombo = prevCombos[prevCombos.length - 1];
    currentSizeIdx.value = prevCombo.sizeIdx;
    currentMultIdx.value = prevCombo.multIdx;
  }
}

// 金额状态
const balance = ref(10000.00)
const winAmount = ref(0.00)

// 历史记录数据结构
interface GameRecord {
  id: string;
  time: string;
  bet: number;
  profit: number;
}
const historyRecords = ref<GameRecord[]>([])
const showHistoryModal = ref(false)

// 生成一些初始的假数据，让列表看起来有内容
for(let i=0; i<15; i++) {
  const isWin = Math.random() > 0.6;
  const dummyWin = isWin ? (Math.random() * 100 + 20) : 0;
  historyRecords.value.push({
    id: 'TXN' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0'),
    time: new Date(Date.now() - i * 60000).toLocaleTimeString('zh-CN', { hour12: false }),
    bet: 20.00,
    profit: dummyWin
  })
}

const currentRecordId = ref('')

// 底部上拉框状态 (wallet, bet, win)
const activePopup = ref<string | null>(null)
const togglePopup = (type: string) => {
  if (activePopup.value === type) {
    activePopup.value = null
  } else {
    activePopup.value = type
  }
}
const closePopup = () => {
  activePopup.value = null
}

// 底部霓虹走马灯提示信息
const infoMessages = [
  '赢得高达 1024 路！',
  '获得镀金符号，有机会赢得 <img src="/images/games/mahjong/classic/symbols/wild.png" style="height: 26px; vertical-align: middle; margin: 0 4px; filter: drop-shadow(0 0 4px rgba(255,215,0,0.8));" />',
  '3 个「胡」符号触发 12 次免费旋转！',
  '免费旋转中连击倍数 ×2 → ×4 → ×6 → ×10',
]
const currentInfoIndex = ref(0)
setInterval(() => {
  currentInfoIndex.value = (currentInfoIndex.value + 1) % infoMessages.length
}, 5000) // 每 5 秒切换一次

// 当前激活的乘数 (索引: 0->X1, 1->X2, 2->X3, 3->X5)
const activeMultiplierIndex = ref(0)

// 官方 MW1 牌面：5 轴 × 6 行（中间 4 行可见区参与中奖）
const gridData = ref<TileCell[][]>(createEmptyGrid())
const spinningCols = ref<TileCell[][]>(Array.from({ length: COLS }, () => []))

const handleSpinClick = () => {
  if (isSpinning.value || isResolving.value) return

  const inFreeSpin = isFreeSpinMode.value && freeSpinsRemaining.value > 0
  if (inFreeSpin) {
    freeSpinsRemaining.value--
    if (freeSpinsRemaining.value <= 0) {
      isFreeSpinMode.value = false
    }
  } else if (balance.value < betAmount.value) {
    return
  } else {
    balance.value -= betAmount.value
  }
  winAmount.value = 0
  activeMultiplierIndex.value = 0
  currentRecordId.value = 'TXN' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')

  const blurTileCount = 20

  spinningCols.value = Array.from({ length: COLS }, (_, colIndex) => {
    const finalTiles = rollColumn(colIndex)
    const blurTiles = Array.from({ length: blurTileCount }, () => rollTile(colIndex))
    return [...finalTiles, ...blurTiles]
  })

  spinningCols.value.forEach((col, idx) => {
    gridData.value[idx] = col.slice(0, TOTAL_ROWS).map((t) => ({ ...t }))
  })

  isSpinning.value = true

  const timeoutDuration = isTurbo.value ? 350 : 1000

  setTimeout(async () => {
    isSpinning.value = false
    await runCascadeResolution()
  }, timeoutDuration)
}
</script>

<style scoped>
.mahjong-game-page {
  position: fixed;
  inset: 0;
  z-index: 100;
  overflow: hidden;
  background-color: #1a1008;
  width: 100%;
  height: 100%;
}

.game-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: #fff;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

/* 通用图层 */
.layer {
  position: absolute;
  left: 0;
  width: 100%;
  pointer-events: none;
}

/* PS 叠层：底图 → 牌面 → 顶栏 UI → 底栏 */
.z-bg { z-index: 1; }
.z-board { z-index: 2; }
.z-mult-bar { z-index: 3; }
.z-title1024 { z-index: 4; }
.z-mult-values { z-index: 5; }
.z-wood { z-index: 6; }
.z-bottom-frame { z-index: 7; }
.z-message { z-index: 8; }
.z-bottom-control { z-index: 9; }
.z-btn-frame { z-index: 10; }
.z-hud { z-index: 11; }
.z-buttons { z-index: 12; }

.z-mult-bar,
.z-title1024,
.z-mult-values {
  overflow: hidden;
}

.layer-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  user-select: none;
}

.layer-img--mult-values {
  width: 76.7%;
  height: 100%;
  margin: 0 auto;
  display: block;
  object-fit: fill;
}

.mult-values-stack {
  position: relative;
  width: 76.7%;
  height: 100%;
  margin: 0 auto;
}

.mult-values-stack .mult-values-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
}

.mult-values-active {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.layer-img--ribbon {
  width: 89.9%;
  height: 100%;
  margin: 0 auto;
  display: block;
  object-fit: fill;
}

.layer-base {
  position: absolute;
  inset: 0;
}

.z-mult-values .multiplier-area {
  position: absolute;
  inset: 0 11.5%;
}

/* 麻将区 */
.layer-board {
  position: absolute;
  overflow: visible;
  pointer-events: none;
}

.layer-board .grid-container {
  pointer-events: auto;
}

.layer-hud__bar {
  position: absolute;
  inset: 0;
  left: 7.5%;
  width: 85%;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(72, 48, 18, 0.92) 0%, rgba(38, 24, 8, 0.88) 100%);
  border: 1px solid rgba(255, 210, 120, 0.45);
  box-shadow:
    inset 0 1px 0 rgba(255, 230, 160, 0.25),
    0 2px 8px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.layer-hud__bar .layer-hud__values {
  pointer-events: auto;
}

.layer-hud__frame {
  display: none;
}

.layer-copy {
  display: flex;
  align-items: center;
  justify-content: center;
}

.layer-copy .info-ticker-bar {
  position: absolute;
  inset: 20% 10% 18%;
  overflow: hidden;
}

.mult-slot-glow.is-current {
  opacity: 1;
  background: radial-gradient(ellipse at center, rgba(255, 235, 140, 0.65) 0%, transparent 70%);
  box-shadow: 0 0 8px rgba(255, 200, 80, 0.4);
}

.mult-slot-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: bold;
  color: #ffd700;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}

.free-spin-banner {
  position: absolute;
  top: 18%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 24px;
  background: linear-gradient(180deg, rgba(120, 20, 20, 0.92) 0%, rgba(60, 10, 10, 0.88) 100%);
  border: 2px solid #ffd700;
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(255, 215, 0, 0.35);
  pointer-events: none;
}

.free-spin-banner__title {
  font-size: 16px;
  font-weight: bold;
  color: #ffd700;
  letter-spacing: 2px;
}

.free-spin-banner__count {
  font-size: 13px;
  color: #fff;
}

.layer-hud__values {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 4%;
  box-sizing: border-box;
}

.multiplier-area {
  box-sizing: border-box;
}

.mult-slot-glow {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 21%;
  height: 95%;
  border-radius: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
}

@keyframes gold-transition-flash {
  0% { filter: brightness(1.3); }
  100% { filter: brightness(1); }
}

/* 麻将滑动区域（layer-board 已定位，此处只保留内部样式） */
.game-board-area {
  /* position 由 .layer-board 控制 */
}

.grid-container {
  display: flex;
  gap: 3px;
  width: 100%;
  height: 100%;
  position: relative;
  z-index: 2;
  top: 0;
}

.grid-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.grid-col.is-spinning-col {
  overflow: hidden;
}

/* 内部滚动容器 */
.col-inner {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  height: 100%;
}

.col-inner > :deep(.mahjong-tile) {
  flex: 0 0 calc((100% - 15px) / 6);
  min-height: 0;
}

.col-inner.is-spinning > :deep(.mahjong-tile) {
  flex: 0 0 calc((100% - 15px) / 6);
}

/* 旋转状态的滚动动画 */
.col-inner.is-spinning {
  animation: slot-spin 0.75s cubic-bezier(0.15, 0.85, 0.35, 1) forwards;
}

/* 极速模式下的滚动动画：更快结束 */
.col-inner.is-spinning.is-turbo {
  animation: slot-spin 0.25s cubic-bezier(0.15, 0.85, 0.35, 1) forwards;
}

@keyframes slot-spin {
  0% { transform: translateY(calc(-600% - 15px)); }
  100% { transform: translateY(0); }
}

.hud-icon-box {
  width: 32%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background: transparent;
  border: none;
  box-shadow: none;
  transition: all 0.2s ease-out;
  box-sizing: border-box;
}

/* 鼠标放上去的整体交互反馈 */
.hud-icon-box.clickable {
  cursor: pointer;
}
.hud-icon-box.clickable:hover {
  transform: translateY(-1px);
  filter: brightness(1.15);
}
.hud-icon-box.clickable:active {
  transform: translateY(1px) scale(0.97);
  filter: brightness(0.92);
}

.hud-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid rgba(255, 215, 120, 0.55);
  background: radial-gradient(circle at 35% 30%, #fff6d0 0%, #d4a832 45%, #8a6018 100%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  position: relative;
}

.hud-icon::after {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  border: 1px solid rgba(120, 70, 10, 0.35);
}

.hud-icon--wallet::before {
  content: '¥';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
  color: #5a3208;
}

.hud-icon--chip::before {
  content: '注';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 800;
  color: #5a3208;
}

.hud-icon--win::before {
  content: '赢';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 800;
  color: #5a3208;
}

.hud-icon-box.clickable:hover .hud-icon {
  transform: scale(1.08);
  filter: brightness(1.12);
}

/* 屏幕上的金额文字 */
.hud-value {
  font-family: 'Arial Black', sans-serif;
  font-size: clamp(10px, 2.6vh, 14px);
  color: #fff5dc;
  margin-left: 6px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  letter-spacing: 0.3px;
  transition: color 0.2s;
}

/* 上拉框样式 */
.hud-popup-drawer {
  position: absolute;
  bottom: 13.7%;
  left: 10%;
  width: 80%;
  background: rgba(0, 15, 30, 0.95);
  border: 2px solid #d4af37;
  border-radius: 12px;
  box-shadow: 0 0 20px rgba(212, 175, 55, 0.3), inset 0 0 15px rgba(212, 175, 55, 0.2);
  z-index: 50;
  padding: 15px;
  backdrop-filter: blur(10px);
  box-sizing: border-box;
}

.popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(212, 175, 55, 0.3);
  padding-bottom: 10px;
  margin-bottom: 15px;
}

.popup-title {
  font-family: 'Arial Black', sans-serif;
  color: #d4af37;
  font-size: 16px;
  text-shadow: 0 0 5px #d4af37;
  margin: 0;
}

.close-popup-btn {
  background: none;
  border: none;
  color: #c41e3a;
  font-size: 24px;
  cursor: pointer;
  text-shadow: 0 0 5px #c41e3a;
  line-height: 1;
  padding: 0 5px;
}

.popup-content {
  color: #ffffff;
  font-family: sans-serif;
  font-size: 14px;
}

.popup-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.popup-item .label {
  color: #88ccff;
}

/* 自动旋转弹窗样式 */
.auto-spin-section {
  display: flex;
  flex-direction: column;
  padding: 0 10px;
}

.auto-spin-label {
  color: #ffffff;
  font-size: 15px;
  margin-bottom: 15px;
}

.auto-spin-options {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.auto-opt-btn {
  flex: 1;
  background: rgba(0, 15, 30, 0.6); /* 深色半透明底座 */
  border: 1px solid rgba(212, 175, 55, 0.3); /* 明显的青色赛博边框 */
  box-shadow: inset 0 0 5px rgba(212, 175, 55, 0.1); /* 轻微的内发光 */
  color: #88ccff;
  border-radius: 8px;
  padding: 12px 0;
  font-size: 18px;
  font-family: 'Arial Black', sans-serif;
  cursor: pointer;
  transition: all 0.2s;
}

.auto-opt-btn:hover {
  background: rgba(212, 175, 55, 0.1);
  border-color: rgba(212, 175, 55, 0.8);
  box-shadow: 0 0 8px rgba(212, 175, 55, 0.3), inset 0 0 10px rgba(212, 175, 55, 0.2);
  transform: translateY(-2px);
}

.auto-opt-btn.is-selected {
  background: rgba(196, 30, 58, 0.15); /* 选中时变成耀眼的紫红色主题 */
  border-color: #c41e3a;
  border-width: 2px; /* 选中时边框加粗 */
  color: #ffffff;
  text-shadow: 0 0 5px #c41e3a, 0 0 10px #c41e3a;
  box-shadow: 0 0 15px rgba(196, 30, 58, 0.4), inset 0 0 15px rgba(196, 30, 58, 0.3);
  transform: scale(1.05); /* 选中时稍微放大 */
}

.auto-start-btn {
  background: rgba(212, 175, 55, 0.15); /* 使用亮青色背景 */
  color: #ffffff; /* 纯白文字 */
  border: 1px solid #d4af37; /* 发光青色边框 */
  border-radius: 8px;
  padding: 14px;
  font-size: 18px;
  font-family: 'Arial Black', sans-serif;
  width: 100%;
  cursor: pointer;
  transition: all 0.2s;
  text-shadow: 0 0 5px #d4af37, 0 0 10px #d4af37; /* 赛博青色文字发光 */
  box-shadow: 0 0 10px rgba(212, 175, 55, 0.3), inset 0 0 10px rgba(212, 175, 55, 0.2); /* 按钮整体内外发光 */
}

.auto-start-btn:hover {
  background: rgba(212, 175, 55, 0.3);
  box-shadow: 0 0 20px rgba(212, 175, 55, 0.5), inset 0 0 15px rgba(212, 175, 55, 0.4);
  transform: scale(1.02);
}

.auto-start-btn:active {
  transform: scale(0.98);
  filter: brightness(1.2);
}

/* 按钮右上角的数字徽章 */
.auto-count-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  background: #c41e3a;
  color: #ffffff;
  font-size: 12px;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 10px;
  border: 1px solid #ffffff;
  box-shadow: 0 0 5px #c41e3a;
}

/* 历史记录简略列表 (在小弹窗中) */
.win-popup-container {
  display: flex;
  flex-direction: column;
}

.recent-history-list {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 10px;
  max-height: 250px;
  overflow-y: auto;
}

.history-list-header {
  display: flex;
  justify-content: space-between;
  color: #88ccff;
  font-size: 13px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(212, 175, 55, 0.2);
  margin-bottom: 8px;
}

.history-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 14px;
}

.history-time { color: #cccccc; }
.text-win { color: #c41e3a; font-weight: bold; text-shadow: 0 0 5px #c41e3a; }
.text-lose { color: #888888; }

/* 全屏模态框 */
.full-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 10, 20, 0.95);
  backdrop-filter: blur(10px);
  z-index: 100;
  display: flex;
  justify-content: center;
  align-items: center;
}

.full-modal-content {
  width: 90%;
  max-width: 600px;
  height: 80vh;
  background: #1a1b26;
  border: 2px solid #d4af37;
  border-radius: 16px;
  box-shadow: 0 0 30px rgba(212, 175, 55, 0.3), inset 0 0 20px rgba(212, 175, 55, 0.2);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  border-bottom: 1px solid rgba(212, 175, 55, 0.3);
}

.modal-title {
  color: #d4af37;
  font-family: 'Arial Black', sans-serif;
  font-size: 20px;
  text-shadow: 0 0 8px #d4af37;
}

.close-modal-btn {
  background: none;
  border: none;
  color: #c41e3a;
  font-size: 30px;
  cursor: pointer;
  text-shadow: 0 0 8px #c41e3a;
  line-height: 1;
}

.modal-body {
  flex: 1;
  padding: 15px;
  overflow-y: auto;
}

.cyber-table {
  width: 100%;
  border-collapse: collapse;
  color: #ffffff;
  font-size: 14px;
}

.cyber-table th {
  text-align: left;
  padding: 12px 8px;
  color: #88ccff;
  border-bottom: 2px solid rgba(212, 175, 55, 0.3);
  font-weight: normal;
}

.cyber-table td {
  padding: 12px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.cyber-table .txn-id {
  color: #aaaaaa;
  font-family: monospace;
  font-size: 12px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.cyan-text { color: #d4af37; font-family: 'Arial Black', sans-serif; font-size: 24px; text-shadow: 0 0 10px #d4af37;}
.magenta-text { color: #c41e3a; font-family: 'Arial Black', sans-serif; font-size: 24px; text-shadow: 0 0 10px #c41e3a;}
.desc-text { color: #88ccff; font-size: 12px; margin-top: 5px; }

.bet-controls {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.cyber-btn {
  flex: 1;
  padding: 10px;
  background: rgba(212, 175, 55, 0.1);
  border: 1px solid #d4af37;
  color: #d4af37;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  text-shadow: 0 0 3px #d4af37;
  transition: all 0.2s;
}

.cyber-btn:active {
  background: rgba(212, 175, 55, 0.3);
  transform: scale(0.95);
}

/* 投注设置全新界面专属样式 - 赛博朋克风 */
.hud-popup-drawer.bet-popup-style {
  background: rgba(0, 10, 20, 0.95);
  border: none;
  border-top: 2px solid #d4af37;
  box-shadow: 0 -10px 30px rgba(212, 175, 55, 0.2), inset 0 20px 20px -20px rgba(212, 175, 55, 0.3);
  border-radius: 16px 16px 0 0;
  bottom: 0;
  left: 0;
  width: 100%;
  padding: 20px 10px 30px 10px;
  backdrop-filter: blur(10px);
}

.bet-settings-container {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.bet-popup-header {
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  margin-bottom: 20px;
}

.bet-popup-header .popup-title {
  font-family: 'Arial Black', sans-serif;
  color: #d4af37;
  font-size: 18px;
  text-shadow: 0 0 5px #d4af37, 0 0 10px #d4af37;
}

.bet-popup-header .close-popup-btn {
  position: absolute;
  right: 10px;
  background: transparent;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  justify-content: center;
  align-items: center;
  color: #c41e3a;
  font-size: 24px;
  text-shadow: 0 0 8px #c41e3a;
  cursor: pointer;
  border: none;
  transition: transform 0.2s;
}

.bet-popup-header .close-popup-btn:hover {
  transform: scale(1.2);
}

.bet-table {
  width: 100%;
  color: #88ccff;
  font-size: 13px;
  font-family: 'Arial Black', sans-serif;
}

.bet-thead {
  display: flex;
  justify-content: space-between;
  margin-bottom: 15px;
  padding: 0;
  color: #d4af37;
  text-shadow: 0 0 5px #d4af37;
}

.bet-thead div {
  flex: 1;
  text-align: center;
}

.bet-thead div:last-child {
  color: #c41e3a; /* 投注总额标题颜色 */
  text-shadow: 0 0 5px #c41e3a;
}

.bet-tbody {
  position: relative;
  display: flex;
  justify-content: space-between;
  height: 200px; /* 5 rows * 40px */
  overflow: hidden;
}

.bet-highlight-row {
  position: absolute;
  top: 50%;
  left: -10px;
  right: -10px;
  transform: translateY(-50%);
  height: 44px;
  background: linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.15), transparent);
  border-top: 1px solid rgba(212, 175, 55, 0.5);
  border-bottom: 1px solid rgba(212, 175, 55, 0.5);
  box-shadow: inset 0 0 15px rgba(212, 175, 55, 0.2);
  border-radius: 4px;
  pointer-events: none;
  z-index: 1;
}

.bet-wheel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 2;
}

.bet-separator-col {
  width: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #d4af37;
  text-shadow: 0 0 5px #d4af37;
  z-index: 2;
  font-weight: bold;
}

.bet-wheel-item {
  height: 40px;
  line-height: 40px;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  cursor: pointer;
  transition: all 0.2s;
  font-family: 'Arial Black', sans-serif;
  font-size: 16px;
  color: #66aacc;
}

.bet-wheel-item.is-active {
  color: #ffffff;
  font-size: 18px;
  text-shadow: 0 0 5px #d4af37, 0 0 10px #d4af37;
}

.bet-wheel-item.fade-1 { opacity: 0.6; }
.bet-wheel-item.fade-2 { opacity: 0.2; }

.bet-wheel-item.total-text {
  color: #cc66ff;
}
.bet-wheel-item.total-text.is-active {
  color: #ffffff;
  text-shadow: 0 0 5px #c41e3a, 0 0 10px #c41e3a;
}

.bet-popup-footer {
  display: flex;
  justify-content: center;
  gap: 30px;
  margin-top: 25px;
}

.bet-popup-footer .cyber-btn {
  flex: none;
  width: 140px;
  padding: 12px;
  font-size: 16px;
  letter-spacing: 2px;
  border-radius: 8px;
}

.bet-popup-footer .cancel-btn {
  background: transparent;
  border: 1px solid rgba(196, 30, 58, 0.5);
  color: #c41e3a;
  text-shadow: 0 0 5px #c41e3a;
}
.bet-popup-footer .cancel-btn:hover {
  background: rgba(196, 30, 58, 0.1);
  border-color: #c41e3a;
}

.bet-popup-footer .confirm-btn {
  background: rgba(212, 175, 55, 0.15);
  border: 1px solid #d4af37;
  color: #ffffff;
  text-shadow: 0 0 5px #d4af37, 0 0 10px #d4af37;
  box-shadow: 0 0 10px rgba(212, 175, 55, 0.3), inset 0 0 10px rgba(212, 175, 55, 0.2);
}
.bet-popup-footer .confirm-btn:hover {
  background: rgba(212, 175, 55, 0.3);
  box-shadow: 0 0 20px rgba(212, 175, 55, 0.5), inset 0 0 15px rgba(212, 175, 55, 0.4);
}
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

/* 跑马灯（位于 layer-copy 内） */
.info-ticker-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  background: transparent;
  border: none;
  box-shadow: none;
  overflow: hidden;
}

.neon-info-text {
  position: absolute;
  width: 100%;
  font-family: 'Microsoft YaHei', sans-serif;
  font-size: clamp(10px, 2.4vw, 13px);
  font-weight: 600;
  color: #fff8e7;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  letter-spacing: 0.5px;
  text-align: center;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 霓虹字从右向左滑动特效 - 跑马灯风格 */
.slide-left-enter-active,
.slide-left-leave-active {
  transition: transform 1.5s linear; /* 匀速滑动，不加透明度渐变，模拟真实的物理跑马灯 */
}
.slide-left-enter-from {
  transform: translateX(120vw); /* 从右侧更远的地方开始进入，避免长句重叠 */
}
.slide-left-leave-to {
  transform: translateX(-120vw); /* 滑动到左侧更远的地方，确保长句完全消失后再裁剪 */
}

/* 底部按钮区 */
.btn-interactive-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 12;
}

.bottom-action-bar,
.bottom-action-menu-page {
  position: absolute;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 3.2%;
  box-sizing: border-box;
  pointer-events: auto;
}

.bottom-action-menu-page {
  gap: 2%;
  padding: 0 1%;
}

.action-btn {
  background-color: transparent;
  border: none;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  box-shadow: none;
  transition: transform 0.1s, filter 0.1s;
  outline: none;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  flex-shrink: 0;
}

.action-btn:active {
  transform: scale(0.95);
  filter: brightness(1.08);
}

.small-btn {
  width: 12.75%;
  height: 64%;
  aspect-ratio: 76 / 77;
}

.turbo-btn,
.auto-btn {
  aspect-ratio: 76 / 77;
}

.minus-btn,
.plus-btn {
  aspect-ratio: 1;
}

.turbo-btn {
  background-image: url('/images/games/mahjong/lingguang/buttons/btn-turbo.png');
}

.turbo-btn.is-active {
  filter: brightness(1.5) drop-shadow(0 0 15px rgba(255, 200, 0, 0.8));
  transform: scale(1.1);
}

.turbo-btn.is-active:active {
  transform: scale(0.95);
}

.minus-btn {
  background-image: url('/images/games/mahjong/lingguang/buttons/btn-minus.png');
}

.plus-btn {
  background-image: url('/images/games/mahjong/lingguang/buttons/btn-plus.png');
}

.auto-btn {
  background-image: url('/images/games/mahjong/lingguang/buttons/btn-auto.png');
}

/* 汉堡菜单：CSS 三横线，居中对齐在按钮边框右缘与页面右缘之间 */
.menu-hamburger {
  position: absolute;
  width: 5.6%;
  height: 2.8%;
  min-width: 32px;
  min-height: 32px;
  padding: 0;
  box-sizing: border-box;
  background: transparent;
  border: none;
  cursor: pointer;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 13;
  transform: translate(-50%, -50%);
}

.menu-hamburger__icon {
  width: 100%;
  height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.6));
}

.menu-hamburger:active {
  transform: translate(-50%, -50%) scale(0.92);
  filter: brightness(1.15);
}

.menu-page-btn {
  width: 12.75%;
  height: 64%;
  aspect-ratio: 76 / 77;
  mix-blend-mode: normal;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  background-color: transparent;
  border: none;
  cursor: pointer;
  transition: transform 0.2s, filter 0.2s;
}

.menu-page-btn:active {
  transform: scale(0.95);
}

.exit-btn { background-image: url('/images/games/mahjong/lingguang/buttons/btn-exit.png'); }
.sound-btn.is-on { background-image: url('/images/games/mahjong/lingguang/buttons/btn-sound-on.png'); }
.sound-btn.is-off { background-image: url('/images/games/mahjong/lingguang/buttons/btn-sound-off.png'); }
.paytable-btn { background-image: url('/images/games/mahjong/lingguang/buttons/btn-paytable.png'); }
.rules-btn { background-image: url('/images/games/mahjong/lingguang/buttons/btn-rules.png'); }
.history-btn { background-image: url('/images/games/mahjong/lingguang/buttons/btn-history.png'); }
.close-menu-btn { background-image: url('/images/games/mahjong/lingguang/buttons/btn-back.png'); }

.spin-btn {
  width: 25.2%;
  height: 100%;
  aspect-ratio: 1;
  background-color: transparent;
  border: none;
  box-shadow: none;
  background-image: url('/images/games/mahjong/lingguang/buttons/btn-spin.png');
}

/* 页面左右推拉切换动画 */
.slide-left-page-enter-active,
.slide-left-page-leave-active,
.slide-right-page-enter-active,
.slide-right-page-leave-active {
  transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.slide-left-page-enter-from,
.slide-left-page-leave-to {
  opacity: 0;
  transform: translateX(-30vw);
}

.slide-right-page-enter-from,
.slide-right-page-leave-to {
  opacity: 0;
  transform: translateX(30vw);
}

/* 如果正在旋转，给按钮本身加上发光和旋转动画 */
.spin-btn.is-spinning {
  /* 快速旋转一圈（360度）就停下，不再无限打转 */
  animation: fast-spin-anim 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}

@keyframes fast-spin-anim {
  0% { transform: rotate(0deg) scale(1.05); filter: drop-shadow(0 0 15px rgba(255, 200, 0, 0.8)) brightness(1.2); }
  50% { transform: rotate(180deg) scale(1.1); filter: drop-shadow(0 0 25px rgba(255, 230, 100, 0.9)) brightness(1.5); }
  100% { transform: rotate(360deg) scale(1); filter: drop-shadow(0 0 10px rgba(255, 180, 0, 0.6)) brightness(1); }
}

/* ================= 连线与闪电特效 ================= */
.svg-overlay-container {
  position: absolute;
  top: 0; 
  left: 0; 
  width: 100%; 
  height: 100%;
  z-index: 30; /* 必须盖在麻将上面 */
  pointer-events: none; /* 防止阻挡点击事件 */
}

/* 中间有效区域（4行）的外边框闪烁 */
.play-area-frame {
  position: absolute;
  border: 4px solid rgba(255, 215, 0, 0.9);
  box-shadow: 0 0 15px rgba(255, 200, 0, 0.8), inset 0 0 15px rgba(255, 230, 100, 0.4);
  border-radius: 12px;
  /* 动画改为单次闪半秒，然后保持透明（消失） */
  animation: frame-flash 0.5s ease-out forwards;
}

/* 极速模式：外框闪烁动画翻倍加速 */
.svg-overlay-container.is-turbo .play-area-frame {
  animation: frame-flash 0.25s ease-out forwards;
}

@keyframes frame-flash {
  0% { opacity: 0; transform: scale(1.02); box-shadow: 0 0 50px rgba(255, 200, 0, 0.9); }
  50% { opacity: 1; transform: scale(1); box-shadow: 0 0 30px rgba(255, 215, 0, 0.8), inset 0 0 20px rgba(255, 240, 180, 0.5); }
  100% { opacity: 0; }
}

/* 连线的霓虹外圈发光 */
.lightning-path {
  filter: drop-shadow(0 0 8px rgba(255, 200, 0, 0.8)) drop-shadow(0 0 15px rgba(255, 160, 0, 0.5));
  stroke-dasharray: 2500;
  stroke-dashoffset: 2500;
  animation: 
    draw-line 0.2s ease-out forwards,
    lightning-strike 0.125s 4; /* 精准控制：正常模式只抖动4下 */
}

/* 极速模式：连线动画加速 */
.svg-overlay-container.is-turbo .lightning-path {
  animation: 
    draw-line 0.1s ease-out forwards,
    lightning-strike 0.125s 2; /* 精准控制：极速模式只抖动2下 */
}

/* 连线的核心高光 */
.lightning-core {
  filter: blur(1px);
  stroke-dasharray: 2500;
  stroke-dashoffset: 2500;
  animation: 
    draw-line 0.2s ease-out forwards,
    lightning-strike-core 0.125s 4; /* 精准控制：正常模式只抖动4下 */
}

/* 极速模式：核心连线动画加速 */
.svg-overlay-container.is-turbo .lightning-core {
  animation: 
    draw-line 0.1s ease-out forwards,
    lightning-strike-core 0.125s 2; /* 精准控制：极速模式只抖动2下 */
}

@keyframes draw-line {
  to {
    stroke-dashoffset: 0;
  }
}

@keyframes lightning-strike {
  0%, 100% { opacity: 0.8; stroke-width: 4; }
  50% { opacity: 1; stroke-width: 8; }
}
@keyframes lightning-strike-core {
  0%, 100% { opacity: 1; stroke-width: 2; }
  50% { opacity: 0.8; stroke-width: 1; }
}
</style>
