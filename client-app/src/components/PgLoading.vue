<template>
  <div class="pg-loading-container" v-if="visible">
    <div class="pg-logo">
      <div 
        v-for="(block, index) in blocks" 
        :key="index"
        class="pg-block"
        :style="{
          left: `${block.x * blockSize}px`,
          top: `${block.y * blockSize}px`,
          width: `${blockSize - blockGap}px`,
          height: `${blockSize - blockGap}px`,
          backgroundColor: block.color || '#ffffff',
          animationDelay: `${block.delay}s`,
          boxShadow: block.color ? `0 0 8px ${block.color}` : 'none'
        }"
      ></div>
    </div>
    <div class="pg-text">
      <span class="text-char" style="animation-delay: 1.5s">不</span>
      <span class="text-char" style="animation-delay: 1.6s">凡</span>
      <span class="text-char" style="animation-delay: 1.7s; margin-left: 10px;">成</span>
      <span class="text-char" style="animation-delay: 1.8s">就</span>
      <span class="text-char" style="animation-delay: 1.9s; margin-left: 10px;">非</span>
      <span class="text-char" style="animation-delay: 2.0s">凡</span>
    </div>
    <div class="pg-progress-container" v-if="showProgress">
      <div class="pg-progress-bar">
        <div class="pg-progress-fill" :style="{ width: `${progress}%` }"></div>
      </div>
      <div class="pg-progress-text">正在加载资源 [{{ Math.floor(progress) }}%]</div>
      <div class="pg-tips">关闭闲置网页，给我多点空间，还你更多惊喜！</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: true
  },
  showProgress: {
    type: Boolean,
    default: true
  },
  progress: {
    type: Number,
    default: 84
  }
});

const blockSize = 12; // Size of each block including gap
const blockGap = 2;   // Gap between blocks

// Generate blocks for P and G
const generateBlocks = () => {
  const blocksArray = [];
  const addBlock = (x, y, color = null) => {
    if (!blocksArray.find(b => b.x === x && b.y === y)) {
      // Random delay for the animation
      const delay = Math.random() * 0.8;
      blocksArray.push({ x, y, color, delay });
    }
  };

  const setColor = (x, y, color) => {
    const b = blocksArray.find(b => b.x === x && b.y === y);
    if (b) b.color = color;
  };

  // P (x: 0 to 11, y: 0 to 14)
  for (let y = 0; y <= 14; y++) {
    addBlock(0, y); addBlock(1, y); // Left stem
  }
  for (let x = 2; x <= 9; x++) {
    addBlock(x, 0); addBlock(x, 1); // Top
    addBlock(x, 7); addBlock(x, 8); // Middle
  }
  for (let y = 0; y <= 8; y++) {
    addBlock(10, y); addBlock(11, y); // Right loop
  }

  // G (x: 14 to 25, y: 0 to 14)
  const ox = 14;
  for (let y = 0; y <= 14; y++) {
    addBlock(ox + 0, y); addBlock(ox + 1, y); // Left stem
  }
  for (let x = 2; x <= 11; x++) {
    addBlock(ox + x, 0); addBlock(ox + x, 1); // Top
    addBlock(ox + x, 13); addBlock(ox + x, 14); // Bottom
  }
  for (let y = 7; y <= 14; y++) {
    addBlock(ox + 10, y); addBlock(ox + 11, y); // Right bottom stem
  }
  for (let y = 0; y <= 2; y++) {
    addBlock(ox + 10, y); addBlock(ox + 11, y); // Right top stem
  }
  for (let x = 5; x <= 9; x++) {
    addBlock(ox + x, 7); addBlock(ox + x, 8); // Middle horizontal
  }

  // Set colors based on the image
  // P colors
  setColor(0, 13, '#00e5ff');
  setColor(0, 14, '#00e5ff');
  setColor(1, 14, '#00e5ff');
  
  setColor(10, 0, '#ff9900');
  setColor(11, 0, '#ff9900');
  
  setColor(10, 8, '#ff00ff');
  setColor(11, 8, '#ff00ff');

  // G colors
  setColor(ox + 0, 0, '#ff9900');
  setColor(ox + 1, 0, '#ff9900');
  
  setColor(ox + 0, 14, '#00e5ff');
  setColor(ox + 1, 14, '#00e5ff');
  
  setColor(ox + 10, 14, '#ff9900');
  setColor(ox + 11, 14, '#ff9900');
  
  setColor(ox + 11, 7, '#ff0000'); // Outer red
  setColor(ox + 11, 8, '#ff0000');
  
  setColor(ox + 9, 7, '#00ff00'); // Inner green
  setColor(ox + 9, 8, '#00ff00');

  return blocksArray;
};

const blocks = ref(generateBlocks());
</script>

<style scoped>
.pg-loading-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: radial-gradient(circle at center, #2a2a2a 0%, #000000 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  font-family: sans-serif;
}

.pg-logo {
  position: relative;
  width: 312px; /* 26 columns * 12px */
  height: 180px; /* 15 rows * 12px */
  margin-bottom: 40px;
}

.pg-block {
  position: absolute;
  background-color: #fff;
  border-radius: 1px;
  opacity: 0;
  transform-origin: center;
  animation: formBlock 1.5s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
}

@keyframes formBlock {
  0% {
    transform: scaleY(15) scaleX(0.5);
    opacity: 0;
    filter: blur(4px);
  }
  30% {
    opacity: 0.8;
  }
  100% {
    transform: scaleY(1) scaleX(1);
    opacity: 1;
    filter: blur(0);
  }
}

.pg-text {
  color: #d1d1d1;
  font-size: 18px;
  letter-spacing: 4px;
  margin-bottom: 60px;
  display: flex;
  justify-content: center;
}

.text-char {
  opacity: 0;
  transform: translateY(10px);
  animation: fadeUp 0.5s ease forwards;
}

@keyframes fadeUp {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.pg-progress-container {
  width: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  opacity: 0;
  animation: fadeIn 1s ease 2s forwards;
}

.pg-progress-bar {
  width: 100%;
  height: 4px;
  background-color: #333;
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 15px;
}

.pg-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #ff0000, #ff9900);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.pg-progress-text {
  color: #444;
  font-size: 14px;
  margin-top: 10px;
}

.pg-tips {
  color: #333;
  font-size: 12px;
  margin-top: 20px;
}

@keyframes fadeIn {
  to {
    opacity: 1;
  }
}
</style>
