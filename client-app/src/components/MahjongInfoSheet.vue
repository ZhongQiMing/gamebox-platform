<template>
  <Transition name="fade">
    <div v-if="visible" class="mj-sheet-mask" @click.self="emit('close')">
      <div class="mj-sheet">
        <div class="mj-sheet__tabs">
          <button
            type="button"
            class="mj-sheet__tab"
            :class="{ 'is-active': tab === 'pay' }"
            @click="tab = 'pay'"
          >
            赔付表
          </button>
          <button
            type="button"
            class="mj-sheet__tab"
            :class="{ 'is-active': tab === 'rules' }"
            @click="tab = 'rules'"
          >
            规则
          </button>
          <button type="button" class="mj-sheet__close" aria-label="关闭" @click="emit('close')">
            ×
          </button>
        </div>

        <div class="mj-sheet__body">
          <!-- 赔付表 -->
          <div v-if="tab === 'pay'" class="mj-pay">
            <p class="mj-pay__hint">
              当前投注 ¥{{ betAmount.toFixed(2) }} · 1024 路 · 基础投注 {{ baseBet }}
            </p>

            <section class="mj-pay__section">
              <h3>特殊符号</h3>
              <div class="mj-pay__special">
                <div class="mj-pay__special-item">
                  <img :src="`${symBase}/wild.png`" alt="" />
                  <div>
                    <strong>百搭</strong>
                    <span>可替代除「胡」外所有符号</span>
                  </div>
                </div>
                <div class="mj-pay__special-item">
                  <img :src="`${symBase}/hu.png`" alt="" />
                  <div>
                    <strong>胡（Scatter）</strong>
                    <span>3 个触发 12 次免费旋转，每多 1 个 +2 次</span>
                  </div>
                </div>
              </div>
            </section>

            <section class="mj-pay__section">
              <h3>符号赔付（×3 / ×4 / ×5 连）</h3>
              <table class="mj-pay__table">
                <thead>
                  <tr>
                    <th>符号</th>
                    <th>3 连</th>
                    <th>4 连</th>
                    <th>5 连</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="id in paySymbols" :key="id">
                    <td>
                      <img :src="`${symBase}/${id}.png`" class="mj-pay__icon" alt="" />
                      {{ labels[id] }}
                    </td>
                    <td>{{ formatPay(id, 0) }}</td>
                    <td>{{ formatPay(id, 1) }}</td>
                    <td>{{ formatPay(id, 2) }}</td>
                  </tr>
                </tbody>
              </table>
              <p class="mj-pay__note">
                中奖金额 =（投注总额 ÷ 20）× 符号赔付 × 中奖路数 × 连击倍数
              </p>
            </section>
          </div>

          <!-- 规则 -->
          <div v-else class="mj-rules">
            <section>
              <h3>游戏简介</h3>
              <p>
                《麻将胡了》为 5 轴 4 行视频老虎机，共 1024 条固定中奖路。符号从左至右连续出现在相邻转轴即可中奖，位置不限行。
              </p>
            </section>
            <section>
              <h3>级联消除</h3>
              <p>
                中奖符号消除后，上方符号下落补位，可连续触发新的中奖。每轮连击倍数递增：主游戏 ×1 → ×2 → ×3 → ×5；免费旋转 ×2 → ×4 → ×6 → ×10。
              </p>
            </section>
            <section>
              <h3>镀金符号</h3>
              <p>
                第 2、3、4 轴上的普通符号可能带金色边框。参与中奖后转为百搭，帮助延续连击。
              </p>
            </section>
            <section>
              <h3>免费旋转</h3>
              <p>
                任意位置出现 3 个及以上「胡」符号触发免费旋转（含级联过程中）。基础 12 次，每多 1 个 Scatter 额外 +2 次，可重复触发。
              </p>
            </section>
            <section>
              <h3>投注设置</h3>
              <p>
                投注总额 = 投注大小 × 投注倍数 × 基础投注（20）。点击底部金额栏可调整投注。
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  BASE_BET,
  PAY_SYMBOLS,
  PAYTABLE,
  SYMBOL_LABELS,
  type PaySymbolId,
} from '../games/mahjong/mahjongWays1'

const props = defineProps<{
  visible: boolean
  initialTab?: 'pay' | 'rules'
  betAmount: number
}>()

const emit = defineEmits<{ close: [] }>()

const symBase = '/images/games/mahjong/classic/symbols'
const baseBet = BASE_BET
const paySymbols = PAY_SYMBOLS
const labels = SYMBOL_LABELS
const tab = ref<'pay' | 'rules'>(props.initialTab ?? 'pay')

watch(
  () => props.initialTab,
  (v) => {
    if (v) tab.value = v
  },
)

function formatPay(id: PaySymbolId, idx: 0 | 1 | 2): string {
  const unit = props.betAmount / BASE_BET
  return (unit * PAYTABLE[id][idx]).toFixed(2)
}
</script>

<style scoped>
.mj-sheet-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}

.mj-sheet {
  width: min(420px, 100%);
  max-height: 85vh;
  background: linear-gradient(180deg, #2a1810 0%, #1a0f08 100%);
  border: 2px solid #c9a227;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.mj-sheet__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.35);
  border-bottom: 1px solid rgba(201, 162, 39, 0.35);
}

.mj-sheet__tab {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #c9a227;
  font-size: 14px;
  cursor: pointer;
}

.mj-sheet__tab.is-active {
  background: rgba(201, 162, 39, 0.2);
  border-color: #c9a227;
  color: #fff;
}

.mj-sheet__close {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
}

.mj-sheet__body {
  overflow-y: auto;
  padding: 16px;
  color: #e8dcc8;
  font-size: 13px;
  line-height: 1.55;
}

.mj-pay__hint {
  text-align: center;
  color: #c9a227;
  margin: 0 0 14px;
  font-size: 12px;
}

.mj-pay__section {
  margin-bottom: 18px;
}

.mj-pay__section h3,
.mj-rules section h3 {
  color: #ffd700;
  font-size: 14px;
  margin: 0 0 8px;
}

.mj-pay__special {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mj-pay__special-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 8px;
}

.mj-pay__special-item img {
  width: 44px;
  height: 44px;
  object-fit: contain;
}

.mj-pay__special-item strong {
  display: block;
  color: #fff;
}

.mj-pay__special-item span {
  font-size: 11px;
  color: #aaa;
}

.mj-pay__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.mj-pay__table th,
.mj-pay__table td {
  padding: 6px 4px;
  text-align: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.mj-pay__table th {
  color: #c9a227;
  font-weight: 600;
}

.mj-pay__icon {
  width: 32px;
  height: 32px;
  vertical-align: middle;
  margin-right: 4px;
}

.mj-pay__note {
  margin-top: 10px;
  font-size: 11px;
  color: #888;
}

.mj-rules section {
  margin-bottom: 16px;
}

.mj-rules p {
  margin: 0;
  color: #ccc;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
