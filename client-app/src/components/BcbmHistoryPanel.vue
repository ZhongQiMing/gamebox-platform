<template>
  <!-- 官方 Benz.HistoryPanelSkin 480×715：更多 → 历史（传统/车标/颜色） -->
  <div class="hist-overlay" @click.self="emit('close')">
    <div class="hist-panel">
      <!-- scale9Grid=52,48,70,43 → slice T48 R59 B73 L52 -->
      <div class="border-outer" aria-hidden="true" />
      <img
        class="title"
        src="/images/games/bcbm/benz/txt/yben_txt_history_hans.webp"
        alt="历史"
        draggable="false"
      />

      <div class="tabs">
        <button
          v-for="(t, i) in tabs"
          :key="t.key"
          type="button"
          class="tab"
          :class="{ on: tab === i }"
          :style="{ left: t.x + 'px' }"
          @click="tab = i"
        >
          <img
            class="tab-bg"
            :src="
              tab === i
                ? '/images/games/bcbm/benz/bet/yben_ui_geniric_border3_selected.webp'
                : '/images/games/bcbm/benz/bet/yben_ui_geniric_border3.webp'
            "
            alt=""
            draggable="false"
          />
          <span>{{ t.label }}</span>
        </button>
      </div>

      <!-- scale9Grid=19,18,87,75 → slice T18 R19 B18 L19 -->
      <div class="border-inner" aria-hidden="true" />

      <div class="list-mask">
        <!-- 传统：图标平铺 -->
        <div v-show="tab === 0" class="classic-scroll">
          <div class="classic-grid">
            <div
              v-for="(h, i) in items"
              :key="'c' + i"
              class="classic-cell"
              role="button"
              tabindex="0"
              @click="emit('item-tap', h.award)"
              @keydown.enter.prevent="emit('item-tap', h.award)"
            >
              <img class="main" :src="iconOf(h).mainUrl" alt="" draggable="false" />
              <div v-if="iconOf(h).smallUrl" class="small">
                <img
                  class="circle"
                  src="/images/games/bcbm/benz/spin/yben_bg_history_blk_circle.webp"
                  alt=""
                />
                <img class="car" :src="iconOf(h).smallUrl!" alt="" />
              </div>
            </div>
          </div>
        </div>

        <!-- 车标路 -->
        <div v-show="tab === 1" class="road-wrap">
          <div class="road-head car">
            <div class="col round">局数</div>
            <div v-for="b in CAR_ROAD_HEADERS" :key="b" class="col">
              <img
                :src="`/images/games/bcbm/benz/bet/yben_icon_history_${b}.webp`"
                alt=""
                draggable="false"
              />
            </div>
          </div>
          <div class="road-scroll">
            <div
              class="road-body"
              :style="{ height: carRows.length * ROAD_ROW_H + 'px' }"
            >
              <!-- 官方 YPUi.HistoryRoadItemRendererBase：linkColor=0xFF00FF linkWidth=4 -->
              <svg
                v-if="carLinePoints"
                class="road-link"
                :viewBox="`0 0 ${ROAD_W} ${carRows.length * ROAD_ROW_H}`"
                preserveAspectRatio="none"
              >
                <polyline
                  :points="carLinePoints"
                  fill="none"
                  stroke="#ff00ff"
                  stroke-width="4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <div
                v-for="row in carRows"
                :key="'car' + row.index"
                class="road-row car"
              >
                <div class="col round">{{ row.index }}</div>
                <div v-for="(age, ci) in row.ages" :key="ci" class="col">
                  <template v-if="age === -1">
                    <img
                      class="bead"
                      :src="iconOf(row.result).mainUrl"
                      alt=""
                      draggable="false"
                    />
                    <div v-if="iconOf(row.result).smallUrl" class="small bead-s">
                      <img
                        class="circle"
                        src="/images/games/bcbm/benz/spin/yben_bg_history_blk_circle.webp"
                        alt=""
                      />
                      <img class="car" :src="iconOf(row.result).smallUrl!" alt="" />
                    </div>
                  </template>
                  <span v-else class="age">{{ age }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 颜色路 -->
        <div v-show="tab === 2" class="road-wrap">
          <div class="road-head color">
            <div class="col round">局数</div>
            <div v-for="c in COLOR_ROAD_HEADERS" :key="c" class="col">
              <img
                :src="`/images/games/bcbm/benz/bet/yben_icon_history_${c}.webp`"
                alt=""
                draggable="false"
              />
            </div>
          </div>
          <div class="road-scroll">
            <div
              class="road-body"
              :style="{ height: colorRows.length * ROAD_ROW_H + 'px' }"
            >
              <svg
                v-if="colorLinePoints"
                class="road-link"
                :viewBox="`0 0 ${ROAD_W} ${colorRows.length * ROAD_ROW_H}`"
                preserveAspectRatio="none"
              >
                <polyline
                  :points="colorLinePoints"
                  fill="none"
                  stroke="#ff00ff"
                  stroke-width="4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <div
                v-for="row in colorRows"
                :key="'col' + row.index"
                class="road-row color"
              >
                <div class="col round">{{ row.index }}</div>
                <div v-for="(age, ci) in row.ages" :key="ci" class="col">
                  <template v-if="age === -1">
                    <img
                      class="bead"
                      :src="iconOf(row.result).mainUrl"
                      alt=""
                      draggable="false"
                    />
                    <div v-if="iconOf(row.result).smallUrl" class="small bead-s">
                      <img
                        class="circle"
                        src="/images/games/bcbm/benz/spin/yben_bg_history_blk_circle.webp"
                        alt=""
                      />
                      <img class="car" :src="iconOf(row.result).smallUrl!" alt="" />
                    </div>
                  </template>
                  <span v-else class="age">{{ age }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <button type="button" class="confirm" @click="emit('close')">
        <img
          class="btn-bg"
          src="/images/games/bcbm/benz/main/yben_btn_geniric_blue.webp"
          alt=""
          draggable="false"
        />
        <img
          class="btn-txt"
          src="/images/games/bcbm/benz/txt/yben_txt_confirm_hans.webp"
          alt="确定"
          draggable="false"
        />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  buildHistoryRoad,
  carRoadCol,
  colorRoadCol,
  historyPanelIcons,
  CAR_ROAD_HEADERS,
  COLOR_ROAD_HEADERS,
  type BcbmHistoryResult,
  type BcbmRoadRow,
} from '@/games/bcbm/bcbmHistoryRoad'

const props = defineProps<{
  items: BcbmHistoryResult[]
}>()

const emit = defineEmits<{
  close: []
  /** 点历史图标 → 与 strip 一致打开玩法规则 */
  'item-tap': [award: BcbmHistoryResult['award']]
}>()

const tab = ref(0)
const tabs = [
  { key: 'classic', label: '传统', x: 20 },
  { key: 'car', label: '车标', x: 165 },
  { key: 'color', label: '颜色', x: 310 },
] as const

/** 与 HistoryCar/ColorRoadItemRendererSkin 一致：宽 420、行高 60、局数列 72 */
const ROAD_W = 420
const ROAD_ROW_H = 60
const ROAD_ROUND_W = 72
/** 官网 lineItemWidth：车标 87；颜色约 115（420-72）/3≈116 铺满 */
const CAR_COL_W = 87
const COLOR_COL_W = (ROAD_W - ROAD_ROUND_W) / 3

const carRows = computed(() =>
  buildHistoryRoad(props.items, 4, (r) => carRoadCol(r.carPos)),
)
const colorRows = computed(() =>
  buildHistoryRoad(props.items, 3, (r) => colorRoadCol(r.carPos)),
)

/**
 * 官网竖向路：从当前开出格中心连到上一局（更旧、下一行）开出格中心
 * linkColor=0xFF00FF，按行序拼成折线
 */
function roadPolyline(rows: BcbmRoadRow[], colW: number): string {
  if (rows.length < 2) return ''
  const pts: string[] = []
  for (let r = 0; r < rows.length; r++) {
    const col = rows[r]!.ages.indexOf(-1)
    if (col < 0) continue
    const x = ROAD_ROUND_W + col * colW + colW / 2
    const y = r * ROAD_ROW_H + ROAD_ROW_H / 2
    pts.push(`${x},${y}`)
  }
  return pts.length >= 2 ? pts.join(' ') : ''
}

const carLinePoints = computed(() => roadPolyline(carRows.value, CAR_COL_W))
const colorLinePoints = computed(() =>
  roadPolyline(colorRows.value, COLOR_COL_W),
)

function iconOf(r: BcbmHistoryResult) {
  return historyPanelIcons(r)
}
</script>

<style scoped>
.hist-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: stretch;
  justify-content: center;
}
.hist-panel {
  position: relative;
  width: 480px;
  height: 100%;
  min-height: 715px;
  pointer-events: auto;
}
.border-outer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-style: solid;
  border-width: 48px 59px 73px 52px;
  border-image-source: url('/images/games/bcbm/benz/main/yben_ui_geniric_border.webp');
  border-image-slice: 48 59 73 52 fill;
  border-image-repeat: stretch;
  background: #061828;
}
.title {
  position: absolute;
  left: 50%;
  top: 10px;
  width: 182px;
  height: 56px;
  margin-left: -91px;
  object-fit: fill;
  z-index: 2;
  pointer-events: none;
}
.tabs {
  position: absolute;
  left: 0;
  top: 52px;
  width: 480px;
  height: 62px;
  z-index: 3;
}
.tab {
  position: absolute;
  top: 0;
  width: 150px;
  height: 62px;
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.tab .tab-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
}
.tab span {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: 24px;
  color: #5ba2ef;
  font-weight: 600;
  pointer-events: none;
}
.tab.on span {
  color: #fff;
}
.border-inner {
  position: absolute;
  left: 50%;
  top: 103px;
  bottom: 83px;
  width: 440px;
  margin-left: -220px;
  pointer-events: none;
  z-index: 1;
  border-style: solid;
  border-width: 18px 19px 18px 19px;
  border-image-source: url('/images/games/bcbm/benz/main/yben_ui_geniric_border2.webp');
  border-image-slice: 18 19 18 19 fill;
  border-image-repeat: stretch;
  background: rgba(0, 20, 40, 0.65);
}
.list-mask {
  position: absolute;
  left: 50%;
  top: 114px;
  bottom: 93px;
  width: 418px;
  margin-left: -209px;
  z-index: 2;
  overflow: hidden;
  border-radius: 11px;
}
.classic-scroll,
.road-scroll {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}
.classic-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 18px 2px;
  padding: 20px 0 20px 6px;
  align-content: flex-start;
}
.classic-cell {
  position: relative;
  width: 50px;
  height: 50px;
  flex: 0 0 50px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.classic-cell:active {
  filter: brightness(1.2);
  transform: scale(0.96);
}
.classic-cell .main {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 45px;
  height: 45px;
  margin: -22.5px 0 0 -22.5px;
  object-fit: contain;
}
.classic-cell .small,
.road-row .small {
  position: absolute;
  left: -8px;
  top: -4px;
  width: 22px;
  height: 22px;
  z-index: 2;
}
.classic-cell .small .circle,
.classic-cell .small .car,
.road-row .small .circle,
.road-row .small .car {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
}
.road-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.road-head {
  flex: 0 0 60px;
  display: flex;
  width: 420px;
  margin: 0 auto;
}
.road-scroll {
  flex: 1;
  width: 420px;
  margin: 0 auto;
}
.road-body {
  position: relative;
  width: 420px;
}
.road-link {
  position: absolute;
  left: 0;
  top: 0;
  width: 420px;
  height: 100%;
  z-index: 0;
  pointer-events: none;
  overflow: visible;
}
.road-row {
  position: relative;
  z-index: 1;
  display: flex;
  width: 420px;
  height: 60px;
  flex: 0 0 60px;
}
.road-head .col,
.road-row .col {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-left: 1.5px solid #5ba2ef;
}
.road-head.car .col,
.road-row.car .col {
  flex: 1 1 0;
  min-width: 0;
}
.road-head.color .col,
.road-row.color .col {
  flex: 1 1 0;
  min-width: 0;
}
.road-head .col.round,
.road-row .col.round {
  flex: 0 0 72px;
  color: #8ccffd;
  font-size: 26px;
  font-weight: 600;
  border-left: 0;
}
.road-row .col.round {
  color: #5ba2ef;
}
.road-head .col img {
  max-width: 48px;
  max-height: 48px;
  object-fit: contain;
}
.road-row .age {
  position: relative;
  z-index: 1;
  color: #5ba2ef;
  font-size: 20px;
}
.road-row .bead {
  position: relative;
  z-index: 2;
  width: 40px;
  height: 40px;
  object-fit: contain;
}
.road-row .bead-s {
  left: 2px;
  top: 2px;
  width: 18px;
  height: 18px;
}
.confirm {
  position: absolute;
  left: 50%;
  bottom: 9px;
  width: 194px;
  height: 88px;
  margin-left: -97px;
  border: 0;
  padding: 0;
  background: transparent;
  z-index: 3;
  cursor: pointer;
}
.confirm .btn-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
}
.confirm .btn-txt {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 81px;
  height: 47px;
  margin: -23.5px 0 0 -40.5px;
  object-fit: fill;
  z-index: 1;
}
</style>
