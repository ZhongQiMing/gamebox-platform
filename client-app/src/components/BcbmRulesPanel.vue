<template>
  <!--
    官方 GameRuleConfig mobile：480×715，4 页
    壳层固定；正文只在边框内 content-frame（480-52-59）×（715-48-73）
  -->
  <div class="rules-root" @click.self="emit('close')">
    <div class="rules-panel">
      <div class="border-outer" aria-hidden="true" />

      <button type="button" class="close-btn" aria-label="关闭" @click="emit('close')">
        <img :src="R.close" alt="" draggable="false" />
      </button>

      <button
        v-show="page > 0"
        type="button"
        class="nav prev"
        aria-label="上一页"
        @click="page--"
      >
        <img :src="R.arrow" alt="" draggable="false" />
      </button>
      <button
        v-show="page < 3"
        type="button"
        class="nav next"
        aria-label="下一页"
        @click="page++"
      >
        <img :src="R.arrow" alt="" draggable="false" />
      </button>

      <!-- 正文视口：严格落在边框内侧，翻页只在此区域内 -->
      <div class="content-frame">
        <div class="pages" :style="{ transform: `translateX(${-page * 100}%)` }">
          <!-- Page 0：玩法说明 -->
          <section class="page page--howto">
            <div class="top">
              <img class="title" :src="R.title" alt="游戏规则" draggable="false" />
            </div>
            <div class="body scroll">
              <p class="line">{{ T.p1_1 }}</p>
              <div class="brands">
                <img
                  v-for="b in brands"
                  :key="b.id"
                  class="brand-img"
                  :src="rul(`yben_rul_icon_large_${b.file}_blue.png`)"
                  :alt="b.label"
                  draggable="false"
                />
              </div>
              <p class="line" v-html="T.p1_2" />
              <p class="line">{{ T.p1_3 }}</p>
              <p class="line">{{ T.p1_payout }}</p>
              <div class="odds-sample">
                <img :src="rul('yben_rul_icon_rules_2000.png')" alt="2000" draggable="false" />
                <img :src="rul('yben_rul_icon_rules_x22.png')" alt="x22" draggable="false" />
              </div>
              <p class="line limit">{{ T.p1_limit }}</p>
              <div v-for="row in howtoRows" :key="row.desc" class="howto">
                <img class="howto-icon" :src="row.icon" alt="" draggable="false" />
                <div class="howto-desc">{{ row.desc }}</div>
              </div>
            </div>
          </section>

          <!-- Page 1：赔率 -->
          <section class="page page--odds">
            <div class="top">
              <img class="title" :src="R.title" alt="游戏规则" draggable="false" />
              <p class="section-title">{{ T.p1_8 }}</p>
            </div>
            <div class="body odds-page">
              <div class="odds-grid">
                <div v-for="row in oddsRows" :key="row[0]!.id" class="odds-row">
                  <div v-for="s in row" :key="s.id" class="odds-cell">
                    <img
                      :src="rul(`yben_rul_icon_${s.brandFile}_${s.color}.png`)"
                      alt=""
                      draggable="false"
                    />
                    <span>{{ s.mult }}</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- Page 2：特殊奖励 1–3 -->
          <section class="page page--bonus-a">
            <div class="top">
              <img class="title" :src="R.title" alt="游戏规则" draggable="false" />
              <p class="section-title">特殊奖励</p>
              <p class="line intro">{{ T.p2_7 }}</p>
            </div>
            <div class="body bonus-list">
              <div
                v-for="b in bonuses.slice(0, 3)"
                :key="b.key"
                class="bonus"
              >
                <div class="bonus-head">
                  <img class="bonus-icon" :src="b.icon" alt="" draggable="false" />
                  <img class="bonus-name" :src="b.name" alt="" draggable="false" />
                </div>
                <p class="bonus-desc">{{ b.desc }}</p>
              </div>
            </div>
          </section>

          <!-- Page 3：特殊奖励 4–6 -->
          <section class="page page--bonus-b">
            <div class="top">
              <img class="title" :src="R.title" alt="游戏规则" draggable="false" />
            </div>
            <div class="body bonus-list">
              <div
                v-for="b in bonuses.slice(3)"
                :key="b.key"
                class="bonus"
              >
                <div class="bonus-head">
                  <img class="bonus-icon" :src="b.icon" alt="" draggable="false" />
                  <img class="bonus-name" :src="b.name" alt="" draggable="false" />
                </div>
                <p class="bonus-desc">{{ b.desc }}</p>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class="dots" aria-hidden="true">
        <span
          v-for="i in 4"
          :key="i"
          class="dot"
          :class="{ on: page === i - 1 }"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { BCBM_BET_SLOTS } from '@/games/bcbm'

const props = withDefaults(
  defineProps<{
    /** 官方 popupGameRule(pageIndex)，历史条点击传 1=赔率页 */
    initialPage?: number
  }>(),
  { initialPage: 0 },
)

const emit = defineEmits<{ close: [] }>()

const RUL = '/images/games/bcbm/benz/rules'
const rul = (name: string) => `${RUL}/${name}`

const R = {
  close: rul('yben_msc_btn_close.png'),
  arrow: rul('yben_rul_btn_rule_arrow.png'),
  title: rul('yben_rul_txt_title_lang_hans.png'),
}

/** 文案对齐正版游戏规则截图（4 页） */
const T = {
  p1_1: '整个游戏共有12个下注区域，包括以下四种车标：',
  p1_2:
    '每种车标有<span class="c-red">红</span>、<span class="c-green">绿</span>、<span class="c-yellow">黄</span>3种颜色，一共12种车标进行押注，玩家可以任意选择一个或者多个车标进行押注',
  p1_3: '游戏开始，转圈开始转动，几圈以后转圈停下，显示于中央的车标为该次游戏开奖结果',
  p1_payout: '派彩金额为押注金额乘以赔率',
  p1_4: '可用于自动投注',
  p1_5: '清除当前押注，并返还相应的投注金额',
  p1_6: '撤销上一次投注操作',
  p1_7: '完成投注后，按下开始按钮开始转圈',
  p1_8: '赔率',
  p1_limit: '单局单门下注上限为2000',
  p2_1: '同一种车的三种颜色均为中奖',
  p2_2: '同一种颜色的四种车标均为中奖',
  p2_3: '从结果灯开始顺时针数的5个图案均为中奖图案',
  p2_4: '中奖结果和前后第五个图案均为中奖',
  p2_5: '使中奖金额翻倍',
  p2_6: '所有奖项均为中奖',
  p2_7: '本游戏有六个随机触发特殊奖励',
}

const page = ref(0)
watch(
  () => props.initialPage,
  (v) => {
    page.value = Math.max(0, Math.min(3, Number(v) || 0))
  },
  { immediate: true },
)

const brands = [
  { id: 'vw', file: 'volkswagen', label: '大众' },
  { id: 'bmw', file: 'bmw', label: '宝马' },
  { id: 'benz', file: 'benz', label: '奔驰' },
  { id: 'audi', file: 'audi', label: '奥迪' },
]

const howtoRows = [
  { icon: rul('yben_rul_btn_rules_auto_lang_hans.png'), desc: T.p1_4 },
  { icon: rul('yben_rul_btn_rules_clear_lang_hans.png'), desc: T.p1_5 },
  { icon: rul('yben_rul_btn_rules_undo.png'), desc: T.p1_6 },
  { icon: rul('yben_rul_btn_rules_start_lang_hans.png'), desc: T.p1_7 },
]

const brandFile = (brand: string) => (brand === 'vw' ? 'volkswagen' : brand)

const oddsFlat = BCBM_BET_SLOTS.map((s) => ({
  ...s,
  brandFile: brandFile(s.brand),
}))

const COLOR_ORDER = ['red', 'green', 'yellow'] as const
function oddsRow(brand: string) {
  return COLOR_ORDER.map(
    (c) => oddsFlat.find((s) => s.brand === brand && s.color === c)!,
  )
}
const oddsRows = [
  oddsRow('benz'),
  oddsRow('bmw'),
  oddsRow('audi'),
  oddsRow('vw'),
]

const bonuses = [
  {
    key: 'sanyuan',
    icon: rul('yben_rul_icon_three_great_scholars.png'),
    name: rul('yben_rul_txt_three_great_scholars_lang_hans.png'),
    desc: T.p2_1,
  },
  {
    key: 'sixi',
    icon: rul('yben_rul_icon_four_great_blessings.png'),
    name: rul('yben_rul_txt_four_great_blessings_lang_hans.png'),
    desc: T.p2_2,
  },
  {
    key: 'fast',
    icon: rul('yben_rul_icon_fast_and_furious.png'),
    name: rul('yben_rul_txt_fast_and_furious_lang_hans.png'),
    desc: T.p2_3,
  },
  {
    key: 'uturn',
    icon: rul('yben_rul_icon_U_turn.png'),
    name: rul('yben_rul_txt_u_turn_lang_hans.png'),
    desc: T.p2_4,
  },
  {
    key: 'lightning',
    icon: rul('yben_rul_icon_lightning_bolt.png'),
    name: rul('yben_rul_txt_lightning_bolt_lang_hans.png'),
    desc: T.p2_5,
  },
  {
    key: 'drift',
    icon: rul('yben_rul_icon_total_drift.png'),
    name: rul('yben_rul_txt_total_drift_lang_hans.png'),
    desc: T.p2_6,
  },
]
</script>

<style scoped>
/*
 * 布局契约（勿再混用 padding≈边框 + 页高 715）：
 * - panel = 480×715，overflow hidden
 * - border 占 top48 / right59 / bottom73 / left52
 * - content-frame = 边框内侧唯一正文视口（约 369×594）
 * - pages/page 高度 = 100% content-frame，永不画进底边框
 * - dots 落在底边框带内
 */
.rules-root {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
.rules-panel {
  position: relative;
  width: 480px;
  height: 715px;
  flex: 0 0 auto;
  overflow: hidden;
  color: #fff;
}
.border-outer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  border-style: solid;
  border-width: 48px 59px 73px 52px;
  border-image-source: url('/images/games/bcbm/benz/main/yben_ui_geniric_border.png');
  border-image-slice: 48 59 73 52 fill;
  border-image-repeat: stretch;
  background: #061828;
}
.close-btn {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 5;
  border: 0;
  padding: 0;
  background: transparent;
  width: 40px;
  height: 40px;
  cursor: pointer;
}
.close-btn img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.nav {
  position: absolute;
  top: 50%;
  z-index: 5;
  border: 0;
  padding: 0;
  background: transparent;
  width: 36px;
  height: 56px;
  margin-top: -28px;
  cursor: pointer;
}
.nav img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.nav.prev {
  left: 8px;
}
.nav.next {
  right: 8px;
}
.nav.next img {
  transform: scaleX(-1);
}

/* 边框内侧正文视口 */
.content-frame {
  position: absolute;
  top: 48px;
  right: 56px;
  bottom: 73px;
  left: 52px;
  z-index: 1;
  overflow: hidden;
}
.pages {
  display: flex;
  width: 100%;
  height: 100%;
  transition: transform 0.28s ease;
}
.page {
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 4px 2px 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.top {
  text-align: center;
  flex: 0 0 auto;
}
.title {
  display: block;
  margin: 0 auto 2px;
  width: 200px;
  height: auto;
  filter: drop-shadow(0 0 10px rgba(80, 200, 255, 0.75));
}
.body {
  flex: 1 1 auto;
  min-height: 0;
}
.scroll {
  overflow-y: auto;
  padding-right: 2px;
}
.line {
  margin: 6px 0;
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
  color: #fff;
}
.line.intro {
  text-align: center;
  margin: 2px 0 0;
  font-size: 13px;
}
.section-title {
  margin: 2px 0 4px;
  font-size: 17px;
  font-weight: 700;
  text-align: center;
  color: #5ec8ff;
  text-shadow: 0 0 8px rgba(80, 200, 255, 0.55);
}
.brands {
  display: flex;
  justify-content: center;
  gap: 16px;
  margin: 8px 0 10px;
}
.brand-img {
  width: 48px;
  height: 48px;
  object-fit: contain;
}
.odds-sample {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: flex-start;
  margin: 8px 0 4px;
}
.odds-sample img {
  height: 32px;
  width: auto;
  object-fit: contain;
}
.line.limit {
  margin: 4px 0 12px;
}
.howto {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 8px 0;
}
.howto-icon {
  width: 68px;
  height: 44px;
  object-fit: contain;
  flex: 0 0 auto;
}
.howto-desc {
  flex: 1;
  font-size: 13px;
  line-height: 1.35;
  color: #fff;
}

/* 赔率：4 等分行，永不超出 content-frame */
.page--odds .section-title {
  margin: 4px 0 8px;
}
.odds-page {
  min-height: 0;
}
.odds-grid {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: repeat(4, 1fr);
  align-items: center;
}
.odds-row {
  display: flex;
  justify-content: space-around;
  align-items: center;
  min-height: 0;
}
.odds-cell {
  width: 100px;
  text-align: center;
}
.odds-cell img {
  width: 70px;
  height: 70px;
  object-fit: contain;
  display: block;
  margin: 0 auto 2px;
}
.odds-cell span {
  display: block;
  font-size: 16px;
  line-height: 1.1;
  color: #fff;
  font-weight: 600;
}

/*
 * 特殊奖励：标题区固定；列表 3 等分行
 * 每行：图标+名称同行，规则单独一行居中
 */
.page--bonus-a .top,
.page--bonus-b .top {
  padding-bottom: 4px;
}
.bonus-list {
  display: grid;
  grid-template-rows: repeat(3, 1fr);
  align-items: center;
  min-height: 0;
  flex: 1 1 auto;
}
.bonus {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 0;
  overflow: hidden;
}
.bonus-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  max-width: 100%;
}
.bonus-icon {
  width: 92px;
  height: 92px;
  object-fit: contain;
  flex: 0 0 auto;
}
.bonus-name {
  width: 176px;
  max-height: 58px;
  height: auto;
  object-fit: contain;
  flex: 0 0 auto;
  filter: drop-shadow(0 0 6px rgba(80, 200, 255, 0.65));
}
.bonus-desc {
  margin: 0;
  width: 100%;
  font-size: 14px;
  line-height: 1.35;
  color: #fff;
  text-align: center;
}

.dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 28px;
  display: flex;
  justify-content: center;
  gap: 10px;
  z-index: 6;
  pointer-events: none;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-sizing: border-box;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  background: transparent;
}
.dot.on {
  width: 11px;
  height: 11px;
  border-color: #3aa0ff;
  background: #3aa0ff;
  box-shadow: 0 0 8px rgba(58, 160, 255, 0.8);
}
:deep(.c-red) {
  color: #ff3030;
}
:deep(.c-green) {
  color: #85ff00;
}
:deep(.c-yellow) {
  color: #feef00;
}
</style>
