<template>
  <div class="lucky-wheel-game">
    <!-- 顶部导航 -->
    <div class="header">
      <button class="back-btn" @click="router.back()">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg>
      </button>
      <div class="title">幸运转盘</div>
      <div class="balance-box">
        <span class="balance-icon">💰</span>
        <span class="balance-text">{{ walletStore.balance.toLocaleString() }}</span>
      </div>
    </div>

    <!-- 游戏主体区域 -->
    <div class="game-container">
      <!-- 炫酷转盘区域 -->
      <div class="wheel-wrapper">
        <!-- 外围发光装饰 -->
        <div class="wheel-glow"></div>
        <div class="wheel-border">
          <!-- 装饰灯泡 -->
          <div class="bulb" v-for="n in 24" :key="n" :style="{ transform: `rotate(${n * 15}deg) translateY(-145px)` }"></div>
        </div>
        
        <!-- 转盘本体 -->
        <div class="wheel-inner" :style="{ transform: `rotate(${wheelDeg}deg)`, transition: spinning ? 'transform 4s cubic-bezier(0.15, 0.85, 0.15, 1)' : 'none' }">
          <svg viewBox="0 0 300 300" class="wheel-svg">
            <defs>
              <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.5"/>
              </filter>
              <!-- 扇形高光渐变 -->
              <radialGradient id="glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="white" stop-opacity="0.8"/>
                <stop offset="100%" stop-color="white" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <g v-for="(item, i) in PRIZES" :key="i">
              <path :d="slicePath(i)" :fill="COLORS[i % COLORS.length]" stroke="#ffd700" stroke-width="2"/>
              <!-- 扇形内的高光 -->
              <path :d="slicePath(i)" fill="url(#glow)" opacity="0.3"/>
              
              <!-- 奖项文字 -->
              <text :transform="labelTransform(i)" text-anchor="middle" dominant-baseline="middle"
                fill="#ffffff" font-size="16" font-weight="900" font-family="Arial Black" filter="url(#shadow)" letter-spacing="1">
                {{ item.label }}
              </text>
            </g>
          </svg>
        </div>

        <!-- 中心轴承 -->
        <div class="wheel-center">
          <div class="center-inner">
            <span>SPIN</span>
          </div>
        </div>

        <!-- 顶部指针 -->
        <div class="wheel-pointer">
          <div class="pointer-triangle"></div>
          <div class="pointer-circle"></div>
        </div>
      </div>
    </div>

    <!-- 底部控制区 -->
    <div class="controls-area">
      <div class="bet-presets">
        <button v-for="n in [10, 50, 100, 500]" :key="n" 
          class="preset-btn" :class="{ active: betAmount === n }" 
          @click="betAmount = n" :disabled="spinning">
          {{ n }}
        </button>
      </div>
      
      <div class="bet-custom">
        <input v-model.number="betAmount" type="number" class="bet-input" min="1" placeholder="自定义下注金额" :disabled="spinning">
      </div>

      <button class="spin-btn" :class="{ spinning: spinning }" :disabled="spinning || !betAmount" @click="doSpin">
        <div class="spin-btn-inner">
          {{ spinning ? '转动中...' : `下注 ${betAmount || 0} · 开始` }}
        </div>
      </button>
    </div>

    <!-- 结果弹窗 -->
    <Transition name="result-pop">
      <div v-if="result" class="result-overlay" @click="result=null">
        <div class="result-card" :class="{ 'is-win': result.won }">
          <div class="result-rays" v-if="result.won"></div>
          <div class="result-content">
            <div class="result-title">{{ result.won ? '大吉大利' : '再接再厉' }}</div>
            <div class="result-prize">{{ result.prize }}</div>
            <div class="result-amount" v-if="result.won">+{{ result.payout.toLocaleString() }}</div>
            <div class="result-hint">点击任意处继续</div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWalletStore } from '@/stores/wallet'
import { gamesApi } from '@/api/games'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const walletStore = useWalletStore()
const { toast } = useToast()

const PRIZES = [
  { label: '谢谢参与', multiplier: 0 },
  { label: '×1',      multiplier: 1 },
  { label: '×2',      multiplier: 2 },
  { label: '×5',      multiplier: 5 },
  { label: '×10',     multiplier: 10 },
  { label: '×20',     multiplier: 20 },
  { label: '×50',     multiplier: 50 },
]
// 赌场经典配色：红、紫、蓝、绿、橙
const COLORS = ['#8B0000', '#4B0082', '#00008B', '#006400', '#FF8C00', '#8B008B', '#B8860B']
const SLICE = 360 / PRIZES.length

const betAmount = ref(100)
const spinning = ref(false)
const wheelDeg = ref(0)
const result = ref(null)

onMounted(() => walletStore.fetchBalance())

function slicePath(i) {
  const r = 148, cx = 150, cy = 150
  const start = (i * SLICE - 90) * (Math.PI / 180)
  const end = ((i + 1) * SLICE - 90) * (Math.PI / 180)
  const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start)
  const x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end)
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2} Z`
}

function labelTransform(i) {
  const angle = (i + 0.5) * SLICE - 90
  const r = 95
  const x = 150 + r * Math.cos(angle * Math.PI / 180)
  const y = 150 + r * Math.sin(angle * Math.PI / 180)
  return `translate(${x},${y}) rotate(${angle + 90})`
}

async function doSpin() {
  if (!betAmount.value || betAmount.value < 1) { toast('请输入下注额'); return }
  if (walletStore.balance < betAmount.value) { toast('余额不足'); return }
  
  spinning.value = true
  result.value = null
  
  try {
    const res = await gamesApi.spin('lucky-wheel', Number(betAmount.value))
    const idx = res.outcome.index
    const prize = PRIZES[idx]

    // 转盘动画：转至对应奖项（至少转 8 圈增加刺激感）
    // 注意：指针在正上方（-90度），所以目标角度需要计算偏移
    const targetAngle = 360 * 8 + (360 - (idx * SLICE + SLICE / 2))
    wheelDeg.value += targetAngle

    // 等待动画结束 (4秒)
    await new Promise(r => setTimeout(r, 4200))

    walletStore.balance = res.balance
    result.value = {
      won: res.bets[0].won,
      prize: prize.label,
      payout: res.bets[0].payout,
    }
  } catch (e) {
    toast(e.message ?? '下注失败')
  } finally {
    spinning.value = false
  }
}
</script>

<style scoped>
.lucky-wheel-game {
  min-height: 100vh;
  background: radial-gradient(circle at center, #2a0845 0%, #0a0015 100%);
  display: flex;
  flex-direction: column;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  overflow: hidden;
}

/* 顶部导航 */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  background: linear-gradient(180deg, rgba(0,0,0,0.8) 0%, transparent 100%);
  z-index: 10;
}

.back-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px;
}

.title {
  color: #ffd700;
  font-size: 20px;
  font-weight: bold;
  text-shadow: 0 2px 4px rgba(0,0,0,0.8);
  letter-spacing: 2px;
}

.balance-box {
  background: rgba(0,0,0,0.6);
  border: 1px solid #ffd700;
  border-radius: 20px;
  padding: 4px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.balance-icon { font-size: 16px; }
.balance-text { color: #fff; font-weight: bold; font-family: monospace; }

/* 游戏主体 */
.game-container {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
}

/* 炫酷转盘 */
.wheel-wrapper {
  position: relative;
  width: 320px;
  height: 320px;
}

.wheel-glow {
  position: absolute;
  top: -10%; left: -10%;
  width: 120%; height: 120%;
  background: radial-gradient(circle, rgba(255,215,0,0.4) 0%, transparent 70%);
  animation: pulseGlow 2s infinite alternate;
  z-index: 0;
}

@keyframes pulseGlow {
  from { transform: scale(0.95); opacity: 0.8; }
  to { transform: scale(1.05); opacity: 1; }
}

.wheel-border {
  position: absolute;
  top: -15px; left: -15px; right: -15px; bottom: -15px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffd700, #b8860b, #ffd700);
  box-shadow: 0 10px 30px rgba(0,0,0,0.8), inset 0 5px 15px rgba(255,255,255,0.5);
  z-index: 1;
}

.bulb {
  position: absolute;
  top: 50%; left: 50%;
  width: 10px; height: 10px;
  background: #fff;
  border-radius: 50%;
  margin: -5px 0 0 -5px;
  box-shadow: 0 0 10px #fff, 0 0 20px #ffd700;
  animation: blink 1s infinite alternate;
}

.bulb:nth-child(even) { animation-delay: 0.5s; }

@keyframes blink {
  from { background: #fff; box-shadow: 0 0 5px #fff, 0 0 10px #ffd700; }
  to { background: #ffe600; box-shadow: 0 0 15px #fff, 0 0 30px #ff0000; }
}

.wheel-inner {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  border-radius: 50%;
  overflow: hidden;
  z-index: 2;
  box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
}

.wheel-svg {
  width: 100%; height: 100%;
}

.wheel-center {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 70px; height: 70px;
  background: radial-gradient(circle, #ffd700 0%, #b8860b 100%);
  border-radius: 50%;
  z-index: 3;
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: 0 5px 15px rgba(0,0,0,0.6), inset 0 2px 5px rgba(255,255,255,0.8);
  border: 3px solid #fff;
}

.center-inner {
  width: 50px; height: 50px;
  background: #111;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: inset 0 2px 5px rgba(0,0,0,0.8);
}

.center-inner span {
  color: #ffd700;
  font-weight: 900;
  font-size: 14px;
  letter-spacing: 1px;
}

.wheel-pointer {
  position: absolute;
  top: -25px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,0.6));
}

.pointer-circle {
  width: 20px; height: 20px;
  background: radial-gradient(circle, #ff3333 0%, #990000 100%);
  border-radius: 50%;
  border: 2px solid #ffd700;
  margin-bottom: -8px;
  z-index: 2;
}

.pointer-triangle {
  width: 0; height: 0;
  border-left: 15px solid transparent;
  border-right: 15px solid transparent;
  border-top: 35px solid #ffd700;
  position: relative;
}
.pointer-triangle::after {
  content: '';
  position: absolute;
  top: -32px; left: -11px;
  border-left: 11px solid transparent;
  border-right: 11px solid transparent;
  border-top: 28px solid #ff3333;
}

/* 控制区 */
.controls-area {
  background: rgba(0,0,0,0.6);
  padding: 20px;
  border-top: 1px solid rgba(255,215,0,0.3);
  display: flex;
  flex-direction: column;
  gap: 15px;
  backdrop-filter: blur(10px);
}

.bet-presets {
  display: flex;
  gap: 10px;
}

.preset-btn {
  flex: 1;
  padding: 10px 0;
  border-radius: 8px;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,215,0,0.3);
  color: #ffd700;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.preset-btn.active {
  background: rgba(255,215,0,0.2);
  border-color: #ffd700;
  box-shadow: 0 0 10px rgba(255,215,0,0.4);
}

.bet-input {
  width: 100%;
  padding: 12px;
  border-radius: 8px;
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(255,215,0,0.5);
  color: #fff;
  font-size: 16px;
  text-align: center;
  outline: none;
  box-sizing: border-box;
}

.spin-btn {
  background: linear-gradient(180deg, #ff3333 0%, #aa0000 100%);
  border: 2px solid #ffaaaa;
  border-radius: 50px;
  padding: 6px;
  cursor: pointer;
  box-shadow: 0 8px 15px rgba(0,0,0,0.5);
  transition: transform 0.1s;
}

.spin-btn:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.5);
}

.spin-btn:disabled {
  filter: grayscale(0.8);
  cursor: not-allowed;
}

.spin-btn-inner {
  border: 2px dashed rgba(255,255,255,0.5);
  border-radius: 40px;
  padding: 12px;
  color: #fff;
  font-size: 20px;
  font-weight: bold;
  letter-spacing: 2px;
  text-shadow: 0 2px 4px rgba(0,0,0,0.5);
}

/* 结果弹窗 */
.result-overlay {
  position: fixed;
  top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0,0,0,0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.result-card {
  background: linear-gradient(180deg, #2a0845 0%, #111 100%);
  border: 2px solid #555;
  border-radius: 20px;
  padding: 40px;
  text-align: center;
  position: relative;
  overflow: hidden;
  box-shadow: 0 20px 50px rgba(0,0,0,0.8);
  min-width: 280px;
}

.result-card.is-win {
  border-color: #ffd700;
  background: linear-gradient(180deg, #5a0000 0%, #111 100%);
  box-shadow: 0 0 50px rgba(255,0,0,0.4), inset 0 0 20px rgba(255,215,0,0.2);
}

.result-rays {
  position: absolute;
  top: 50%; left: 50%;
  width: 200%; height: 200%;
  background: repeating-conic-gradient(from 0deg, rgba(255,215,0,0.1) 0deg 15deg, transparent 15deg 30deg);
  transform: translate(-50%, -50%);
  animation: spinRays 10s linear infinite;
  z-index: 0;
}

@keyframes spinRays {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}

.result-content {
  position: relative;
  z-index: 1;
}

.result-title {
  font-size: 24px;
  color: #aaa;
  margin-bottom: 10px;
  font-weight: bold;
}

.is-win .result-title {
  color: #ffd700;
  text-shadow: 0 2px 4px rgba(0,0,0,0.8);
}

.result-prize {
  font-size: 48px;
  font-weight: 900;
  color: #fff;
  margin-bottom: 15px;
  text-shadow: 0 4px 8px rgba(0,0,0,0.8);
}

.is-win .result-prize {
  color: #ff3333;
  text-shadow: 0 0 20px #ffd700, 0 4px 8px rgba(0,0,0,0.8);
}

.result-amount {
  font-size: 32px;
  color: #00ff00;
  font-weight: bold;
  margin-bottom: 20px;
  text-shadow: 0 2px 4px rgba(0,0,0,0.8);
}

.result-hint {
  color: #666;
  font-size: 14px;
  margin-top: 20px;
}

.result-pop-enter-active { animation: popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.result-pop-leave-active { animation: popIn 0.2s reverse; }
@keyframes popIn {
  0% { transform: scale(0.5); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
</style>
