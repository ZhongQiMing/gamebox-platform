<template>
  <div class="laba-game-page">
    <!-- 顶部导航 -->
    <div class="header">
      <button class="back-btn" @click="router.back()">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg>
      </button>
      <div class="title">经典拉霸</div>
      <div class="balance-box">
        <span class="balance-icon">💰</span>
        <span class="balance-text">{{ walletStore.balance.toLocaleString() }}</span>
      </div>
    </div>

    <!-- 游戏主体区域 -->
    <div class="game-container">
      <!-- 老虎机机身 -->
      <div class="slot-machine">
        <div class="machine-top">
          <div class="jackpot-display">
            <span class="jp-label">GRAND JACKPOT</span>
            <span class="jp-amount">{{ jackpotAmount.toLocaleString() }}</span>
          </div>
        </div>

        <!-- 滚轮区域 -->
        <div class="reels-container">
          <div class="win-line"></div>
          <div class="reel" v-for="(reel, reelIdx) in reels" :key="reelIdx">
            <div class="reel-strip" :style="getReelStyle(reelIdx)">
              <div class="symbol" v-for="(sym, symIdx) in reel.strip" :key="symIdx">
                {{ sym }}
              </div>
            </div>
          </div>
        </div>

        <div class="machine-bottom">
          <div class="message-display" :class="{ win: lastWin > 0 }">
            {{ displayMessage }}
          </div>
        </div>
      </div>
    </div>

    <!-- 底部控制区 -->
    <div class="controls-area">
      <div class="bet-controls">
        <button class="bet-btn" @click="changeBet(-10)" :disabled="spinning || betAmount <= 10">-</button>
        <div class="bet-amount">
          <div class="bet-label">投注金额</div>
          <div class="bet-val">{{ betAmount }}</div>
        </div>
        <button class="bet-btn" @click="changeBet(10)" :disabled="spinning">+</button>
      </div>

      <button class="spin-btn" :class="{ spinning: spinning }" :disabled="spinning" @click="spin">
        <div class="spin-btn-inner">
          {{ spinning ? '旋转中...' : 'SPIN' }}
        </div>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useWalletStore } from '@/stores/wallet';
import { useToast } from '@/composables/useToast';

const router = useRouter();
const walletStore = useWalletStore();
const { toast, error: toastError } = useToast();

const SYMBOLS = ['🍒', '🍋', '🍊', '🍉', '🔔', '💎', '7️⃣'];
const SYMBOL_HEIGHT = 80; // 每个符号的高度 px
const STRIP_LENGTH = 40; // 滚轮条的长度（包含重复符号用于动画）

const betAmount = ref(50);
const spinning = ref(false);
const lastWin = ref(0);
const displayMessage = ref('祝你好运！');
const jackpotAmount = ref(888888);

// 3个滚轮的状态
const reels = ref([
  { strip: [], currentPos: 0, targetPos: 0 },
  { strip: [], currentPos: 0, targetPos: 0 },
  { strip: [], currentPos: 0, targetPos: 0 }
]);

// 初始化滚轮条
const initReels = () => {
  reels.value.forEach(reel => {
    let strip = [];
    for (let i = 0; i < STRIP_LENGTH; i++) {
      strip.push(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
    }
    reel.strip = strip;
    // 初始位置在最底部附近
    reel.currentPos = STRIP_LENGTH - 3;
    reel.targetPos = reel.currentPos;
  });
};

const getReelStyle = (idx) => {
  const reel = reels.value[idx];
  return {
    transform: `translateY(-${reel.currentPos * SYMBOL_HEIGHT}px)`,
    transition: spinning.value ? `transform ${2 + idx * 0.5}s cubic-bezier(0.15, 0.85, 0.3, 1)` : 'none'
  };
};

const changeBet = (delta) => {
  const newBet = betAmount.value + delta;
  if (newBet >= 10 && newBet <= 1000) {
    betAmount.value = newBet;
  }
};

const spin = () => {
  if (spinning.value) return;
  if (walletStore.balance < betAmount.value) {
    toastError('余额不足');
    return;
  }

  // 扣除余额 (纯前端模拟)
  walletStore.balance -= betAmount.value;
  spinning.value = true;
  lastWin.value = 0;
  displayMessage.value = '旋转中...';

  // 决定结果
  const isWin = Math.random() < 0.3; // 30% 胜率
  let resultSymbols = [];
  
  if (isWin) {
    const winSym = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
    resultSymbols = [winSym, winSym, winSym];
  } else {
    resultSymbols = [
      SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
      SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
      SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]
    ];
    // 确保不全等
    if (resultSymbols[0] === resultSymbols[1] && resultSymbols[1] === resultSymbols[2]) {
      resultSymbols[2] = SYMBOLS[(SYMBOLS.indexOf(resultSymbols[2]) + 1) % SYMBOLS.length];
    }
  }

  // 设置目标位置并更新滚轮条
  reels.value.forEach((reel, idx) => {
    // 将结果符号放在滚轮条的顶部附近 (例如 index 2)
    const targetIndex = 2; 
    reel.strip[targetIndex] = resultSymbols[idx];
    
    // 瞬间把当前位置重置到底部，准备向上滚动
    reel.currentPos = STRIP_LENGTH - 3;
    
    // 强制重绘以应用无动画的重置
    setTimeout(() => {
      reel.targetPos = targetIndex;
      reel.currentPos = targetIndex; // 触发 CSS transition
    }, 50);
  });

  // 等待最长的一个滚轮停下
  setTimeout(() => {
    spinning.value = false;
    checkWin(resultSymbols);
  }, 3000);
};

const checkWin = (symbols) => {
  if (symbols[0] === symbols[1] && symbols[1] === symbols[2]) {
    const sym = symbols[0];
    let multiplier = 5;
    if (sym === '7️⃣') multiplier = 50;
    else if (sym === '💎') multiplier = 20;
    else if (sym === '🔔') multiplier = 10;

    const winAmount = betAmount.value * multiplier;
    lastWin.value = winAmount;
    walletStore.balance += winAmount;
    displayMessage.value = `大奖！赢取 ${winAmount} 分`;
    toast(`恭喜中奖！+${winAmount}`);
  } else {
    displayMessage.value = '再试一次！';
  }
};

let jpTimer;
onMounted(() => {
  initReels();
  walletStore.fetchBalance();
  // 模拟 Jackpot 增长
  jpTimer = setInterval(() => {
    jackpotAmount.value += Math.floor(Math.random() * 100);
  }, 2000);
});

onUnmounted(() => {
  clearInterval(jpTimer);
});
</script>

<style scoped>
.laba-game-page {
  min-height: 100vh;
  background: radial-gradient(circle at center, #3a0000 0%, #1a0000 100%);
  display: flex;
  flex-direction: column;
  font-family: 'Arial Black', Impact, sans-serif;
  overflow: hidden;
}

/* 顶部导航 */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  background: linear-gradient(180deg, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 100%);
  border-bottom: 2px solid #ffcc00;
  box-shadow: 0 4px 15px rgba(0,0,0,0.5);
  z-index: 10;
}

.back-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px;
}

.title {
  color: #ffcc00;
  font-size: 20px;
  font-weight: bold;
  text-shadow: 0 2px 4px rgba(0,0,0,0.8);
  letter-spacing: 2px;
}

.balance-box {
  background: rgba(0,0,0,0.6);
  border: 1px solid #ffcc00;
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

/* 老虎机机身 */
.slot-machine {
  width: 100%;
  max-width: 400px;
  background: linear-gradient(180deg, #ffd700 0%, #b8860b 20%, #8b6508 80%, #daa520 100%);
  border-radius: 20px;
  padding: 15px;
  box-shadow: 
    0 20px 50px rgba(0,0,0,0.8),
    inset 0 5px 15px rgba(255,255,255,0.6),
    inset 0 -5px 15px rgba(0,0,0,0.6);
  border: 4px solid #fff8dc;
}

.machine-top {
  background: #111;
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 15px;
  border: 2px solid #555;
  box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
}

.jackpot-display {
  text-align: center;
  background: repeating-linear-gradient(45deg, #222, #222 10px, #333 10px, #333 20px);
  border: 2px solid #ff0000;
  border-radius: 6px;
  padding: 8px;
  box-shadow: 0 0 10px rgba(255,0,0,0.5);
}

.jp-label {
  display: block;
  color: #ffcc00;
  font-size: 12px;
  letter-spacing: 2px;
  margin-bottom: 4px;
}

.jp-amount {
  display: block;
  color: #ff3333;
  font-size: 28px;
  text-shadow: 0 0 10px #ff0000;
}

/* 滚轮区域 */
.reels-container {
  background: #111;
  border-radius: 10px;
  padding: 10px;
  display: flex;
  justify-content: space-between;
  height: 240px; /* 3个符号的高度 */
  position: relative;
  border: 3px solid #333;
  box-shadow: inset 0 0 30px rgba(0,0,0,0.9);
  overflow: hidden;
}

.win-line {
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  height: 4px;
  background: rgba(255, 0, 0, 0.6);
  transform: translateY(-50%);
  z-index: 10;
  box-shadow: 0 0 10px red;
  pointer-events: none;
}

.reel {
  width: 30%;
  height: 100%;
  background: #fff;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
  box-shadow: inset 0 0 15px rgba(0,0,0,0.5);
}

.reel::after {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.6) 100%);
  pointer-events: none;
  z-index: 5;
}

.reel-strip {
  width: 100%;
  /* transform 由 JS 控制 */
}

.symbol {
  width: 100%;
  height: 80px;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 50px;
  border-bottom: 1px solid #eee;
  box-sizing: border-box;
  background: #fcfcfc;
}

/* 消息显示 */
.machine-bottom {
  margin-top: 15px;
}

.message-display {
  background: #000;
  color: #00ff00;
  text-align: center;
  padding: 12px;
  border-radius: 8px;
  border: 2px solid #333;
  font-size: 16px;
  letter-spacing: 2px;
  font-family: monospace;
}

.message-display.win {
  color: #ffcc00;
  animation: flash 0.5s infinite alternate;
}

@keyframes flash {
  from { background: #000; }
  to { background: #5a0000; }
}

/* 控制区 */
.controls-area {
  background: rgba(0,0,0,0.8);
  padding: 20px;
  border-top: 2px solid #555;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.bet-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #222;
  border-radius: 50px;
  padding: 5px;
  border: 1px solid #444;
}

.bet-btn {
  width: 50px;
  height: 50px;
  border-radius: 25px;
  background: linear-gradient(180deg, #555, #222);
  border: 2px solid #777;
  color: #fff;
  font-size: 24px;
  font-weight: bold;
  cursor: pointer;
}

.bet-btn:active:not(:disabled) {
  background: #111;
}

.bet-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bet-amount {
  text-align: center;
}

.bet-label {
  color: #aaa;
  font-size: 12px;
}

.bet-val {
  color: #ffcc00;
  font-size: 24px;
}

.spin-btn {
  background: linear-gradient(180deg, #ff3333 0%, #aa0000 100%);
  border: 4px solid #ffaaaa;
  border-radius: 60px;
  padding: 10px;
  cursor: pointer;
  box-shadow: 0 10px 20px rgba(0,0,0,0.5);
  transition: transform 0.1s;
}

.spin-btn:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: 0 5px 10px rgba(0,0,0,0.5);
}

.spin-btn:disabled {
  filter: grayscale(0.8);
  cursor: not-allowed;
}

.spin-btn-inner {
  border: 2px dashed #ffaaaa;
  border-radius: 50px;
  padding: 15px;
  color: #fff;
  font-size: 32px;
  text-shadow: 0 2px 4px rgba(0,0,0,0.5);
  letter-spacing: 4px;
}

.spin-btn.spinning .spin-btn-inner {
  font-size: 24px;
}
</style>
