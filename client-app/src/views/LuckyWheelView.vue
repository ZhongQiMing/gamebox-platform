<template>
  <div class="page lucky-page deco-bg">
    <button class="lobby-back" @click="router.back()" aria-label="返回"></button>

    <div class="page-body lucky-body">
      <h1 class="lucky-title">幸 运 转 盘</h1>

      <!-- 余额 -->
      <div class="lw-balance">
        余额：<span>{{ walletStore.balance.toLocaleString() }}</span> 积分
      </div>

      <!-- 转盘 SVG -->
      <div class="wheel-wrap">
        <div class="wheel-container" :style="{ transform: `rotate(${wheelDeg}deg)`, transition: spinning ? 'transform 3.5s cubic-bezier(0.17,0.67,0.12,0.99)' : 'none' }">
          <svg viewBox="0 0 300 300" class="wheel-svg">
            <g v-for="(item, i) in PRIZES" :key="i">
              <path :d="slicePath(i)" :fill="COLORS[i % COLORS.length]" stroke="#1a1000" stroke-width="2"/>
              <text :transform="labelTransform(i)" text-anchor="middle" dominant-baseline="middle"
                fill="#fff" font-size="11" font-weight="600">{{ item.label }}</text>
            </g>
            <!-- 中心圆 -->
            <circle cx="150" cy="150" r="28" fill="#1a1000" stroke="rgba(200,160,40,.8)" stroke-width="3"/>
            <text x="150" y="155" text-anchor="middle" fill="#e8c032" font-size="11" font-weight="700">SPIN</text>
          </svg>
        </div>
        <!-- 指针 -->
        <div class="wheel-pointer">▼</div>
      </div>

      <!-- 下注区 -->
      <div class="lw-bet">
        <div class="lw-presets">
          <button v-for="n in [10,50,100,500]" :key="n" :class="['preset-btn', betAmount===n ? 'active':'']" @click="betAmount=n">{{ n }}</button>
        </div>
        <input v-model.number="betAmount" type="number" class="bet-input" min="1" placeholder="自定义积分">
        <button class="btn btn-primary btn-block spin-btn" :disabled="spinning || !betAmount" @click="doSpin">
          <span class="ruby ruby-l"></span>
          <span class="btn-text">{{ spinning ? '转动中...' : `下注 ${betAmount || 0} 积分 · 开转` }}</span>
          <span class="ruby ruby-r"></span>
        </button>
      </div>

      <!-- 结果弹窗 -->
      <Transition name="result">
        <div v-if="result" class="result-overlay" @click="result=null">
          <div class="result-card">
            <div class="result-icon">{{ result.won ? '🏆' : '😢' }}</div>
            <div class="result-prize">{{ result.prize }}</div>
            <div v-if="result.won" class="result-payout">+{{ result.payout }} 积分</div>
            <div v-else class="result-payout neg">谢谢参与</div>
            <div class="result-balance">当前余额：{{ walletStore.balance.toLocaleString() }}</div>
            <p class="result-hint">点击任意处关闭</p>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWalletStore } from '@/stores/wallet'
import { gamesApi } from '@/api/games'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const walletStore = useWalletStore()
const { toast } = useToast()

// 和后端 seed.ts payTable 保持一致
const PRIZES = [
  { label: '谢谢参与', multiplier: 0 },
  { label: '×1',      multiplier: 1 },
  { label: '×2',      multiplier: 2 },
  { label: '×5',      multiplier: 5 },
  { label: '×10',     multiplier: 10 },
  { label: '×20',     multiplier: 20 },
  { label: '×50',     multiplier: 50 },
]
const COLORS = ['#8B1A1A','#1a4a8B','#1a6B2a','#6B4a1a','#5a1a6B','#1a5a6B','#6B1a4a']
const SLICE = 360 / PRIZES.length

const betAmount = ref<number | ''>(100)
const spinning = ref(false)
const wheelDeg = ref(0)
const result = ref<{ won: boolean; prize: string; payout: number } | null>(null)

onMounted(() => walletStore.fetchBalance())

/** 扇形路径 */
function slicePath(i: number) {
  const r = 148, cx = 150, cy = 150
  const start = (i * SLICE - 90) * (Math.PI / 180)
  const end = ((i + 1) * SLICE - 90) * (Math.PI / 180)
  const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start)
  const x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end)
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2} Z`
}

function labelTransform(i: number) {
  const angle = (i + 0.5) * SLICE - 90
  const r = 95
  const x = 150 + r * Math.cos(angle * Math.PI / 180)
  const y = 150 + r * Math.sin(angle * Math.PI / 180)
  return `translate(${x},${y}) rotate(${angle + 90})`
}

async function doSpin() {
  if (!betAmount.value || betAmount.value < 1) { toast('请输入下注额'); return }
  spinning.value = true
  result.value = null
  try {
    const res = await gamesApi.spin('lucky-wheel', Number(betAmount.value))
    const idx = res.outcome.index
    const prize = PRIZES[idx]

    // 转盘动画：转至对应奖项（至少 5 圈）
    const targetAngle = 360 * 5 + (360 - idx * SLICE - SLICE / 2)
    wheelDeg.value += targetAngle

    // 等动画结束
    await new Promise(r => setTimeout(r, 3800))

    walletStore.balance = res.balance
    result.value = {
      won: res.bets[0].won,
      prize: prize.label,
      payout: res.bets[0].payout,
    }
  } catch (e: any) {
    toast(e.message ?? '下注失败')
  } finally {
    spinning.value = false
  }
}
</script>

<style scoped>
.lucky-page { min-height: 100vh; overflow: hidden; }
.lucky-body { display: flex; flex-direction: column; align-items: center; padding: 0 16px 80px; }
.lucky-title { color: #e8c032; font-size: 22px; letter-spacing: .3em; margin: 20px 0 10px; }
.lw-balance { color: rgba(255,255,255,.6); font-size: 14px; margin-bottom: 20px; }
.lw-balance span { color: #e8c032; font-size: 18px; font-weight: 700; }

.wheel-wrap { position: relative; width: 300px; height: 300px; margin-bottom: 24px; }
.wheel-container { width: 100%; height: 100%; transform-origin: center; }
.wheel-svg { width: 100%; height: 100%; filter: drop-shadow(0 8px 24px rgba(0,0,0,.6)); }
.wheel-pointer {
  position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
  color: #e8c032; font-size: 24px; text-shadow: 0 2px 8px rgba(0,0,0,.8); z-index: 10;
}

.lw-bet { width: 100%; max-width: 300px; display: flex; flex-direction: column; gap: 12px; }
.lw-presets { display: flex; gap: 8px; }
.preset-btn {
  flex: 1; padding: 8px 0; border-radius: 8px; font-size: 14px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(200,160,40,.3);
  color: rgba(200,160,40,.9); cursor: pointer; transition: all .2s;
}
.preset-btn.active { background: rgba(200,160,40,.2); border-color: #e8c032; color: #e8c032; }
.bet-input {
  background: rgba(255,255,255,.06); border: 1px solid rgba(200,160,40,.35);
  border-radius: 10px; padding: 10px 16px; color: #fff; font-size: 16px; width: 100%;
  outline: none; text-align: center;
}
.spin-btn { margin-top: 4px; }

/* 结果弹窗 */
.result-overlay {
  position: fixed; inset: 0; z-index: 8000;
  background: rgba(0,0,0,.7); display: flex; align-items: center; justify-content: center;
}
.result-card {
  background: linear-gradient(160deg, #1e1505, #0d0902);
  border: 1px solid rgba(200,160,40,.5); border-radius: 20px;
  padding: 40px 32px; text-align: center; min-width: 260px;
  box-shadow: 0 8px 40px rgba(0,0,0,.8);
}
.result-icon  { font-size: 52px; margin-bottom: 8px; }
.result-prize { color: #e8c032; font-size: 24px; font-weight: 700; margin-bottom: 8px; }
.result-payout { font-size: 20px; font-weight: 700; margin-bottom: 12px; color: #4caf50; }
.result-payout.neg { color: rgba(255,255,255,.4); }
.result-balance { color: rgba(255,255,255,.5); font-size: 13px; margin-bottom: 16px; }
.result-hint { color: rgba(255,255,255,.25); font-size: 12px; }

.result-enter-active, .result-leave-active { transition: opacity .2s; }
.result-enter-from, .result-leave-to { opacity: 0; }
</style>
