<template>
  <div class="laba-cover" v-if="visible">
    <!-- 真正的竖屏背景图（经典拉霸） -->
    <img src="/images/games/laba-cover-custom.png" class="cover-bg" alt="经典拉霸" />
    
    <!-- UI 交互层 -->
    <div class="ui-layer">
      <!-- 真实的 HTML/CSS 开始按钮 -->
      <button class="start-btn" @click="handleStart">
        <span class="btn-text">开始</span>
      </button>

      <!-- 底部版权与认证信息 -->
      <div class="footer-container">
        <div class="footer-top">
          <div class="pg-brand">
            <div class="pg-logo-txt">PG</div>
            <div class="pg-logo-sub">POCKET GAMES SOFT®</div>
          </div>
          <div class="cert-group">
            <div class="cert-box">
              <div class="cert-label">权威机构</div>
              <div class="cert-val">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="white" style="margin-right:2px"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                MGA
              </div>
              <div class="cert-txt">全球最高规格牌照机构颁发牌照：<br>马耳他 (证书号: C76195)，<br>业务覆盖全球</div>
            </div>
            <div class="cert-box">
              <div class="cert-label">公平认证</div>
              <div class="cert-val">
                <i style="margin-right:2px">ga</i> bmm <span style="font-size:8px; font-weight:normal;">testlabs</span>
              </div>
              <div class="cert-txt">由最严苛的RTP认证机构颁发<br>游戏证书：GA 和 BMM，<br>所有游戏保证100%公平，赔付有保障</div>
            </div>
          </div>
        </div>
        <div class="footer-bottom">
          PGSOFT.COM 2026 © PG SOFT® 版权所有
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  visible: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['start']);

const handleStart = () => {
  emit('start');
};
</script>

<style scoped>
.laba-cover {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 9998;
  background-color: #1a0000;
  overflow: hidden;
  font-family: 'PingFang SC', 'Helvetica Neue', Helvetica, Arial, sans-serif;
}

/* 背景图：真正的竖屏图，完美贴合屏幕四边 */
.cover-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  animation: coverScaleIn 0.8s ease-out forwards;
}

@keyframes coverScaleIn {
  from { transform: scale(1.05); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

/* UI 交互层：悬浮在背景图之上 */
.ui-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  padding-bottom: 20px;
  pointer-events: none; /* 让层本身不阻挡点击 */
}

/* ================= AI 生成的真实 3D 按钮 ================= */
.start-btn {
  pointer-events: auto;
  margin-bottom: 45px;
  width: 260px; /* 调整为更协调的黄金比例尺寸 */
  height: 95px;
  background-image: url('/images/games/start-btn-ai.png');
  background-size: 100% 100%;
  background-position: center;
  background-repeat: no-repeat;
  background-color: transparent;
  border: none;
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  /* 优化呼吸发光效果，加入轻微的缩放，更具生命力 */
  animation: btnBreathe 2.5s infinite alternate ease-in-out;
}

@keyframes btnBreathe {
  from { 
    filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5)) brightness(1); 
    transform: scale(1); 
  }
  to { 
    filter: drop-shadow(0 8px 25px rgba(255, 204, 0, 0.7)) brightness(1.08); 
    transform: scale(1.03); 
  }
}

.btn-text {
  font-size: 26px; /* 字体小一号 */
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-weight: bold;
  color: #ffffff;
  letter-spacing: 12px;
  margin-left: 12px; /* 补偿字间距带来的偏移 */
  position: relative;
  z-index: 2;
  
  /* 恢复干净、清爽的高级质感，去掉夸张的 3D 厚度 */
  text-shadow: 
    0 2px 4px rgba(0, 0, 0, 0.6),
    0 4px 10px rgba(100, 0, 0, 0.8);
  transition: all 0.1s;
}

/* 按下时的真实物理反馈 */
.start-btn:active {
  transform: translateY(4px) scale(0.96); /* 按钮被按下去并稍微缩小 */
  animation: none; /* 按下时停止呼吸 */
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8)) brightness(0.9);
}

/* 文字在按下时也要有对应的下压厚度变化 */
.start-btn:active .btn-text {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  transform: translateY(2px);
}

/* ================= 底部信息 ================= */
.footer-container {
  pointer-events: auto;
  width: 100%;
  background: linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 70%, transparent 100%);
  padding: 20px 15px 10px;
  box-sizing: border-box;
}

.footer-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  max-width: 600px;
  margin: 0 auto 15px;
}

.pg-brand {
  display: flex;
  flex-direction: column;
}

.pg-logo-txt {
  font-size: 32px;
  font-weight: 900;
  color: #fff;
  letter-spacing: 2px;
  line-height: 1;
}

.pg-logo-sub {
  color: #aaa;
  font-size: 9px;
  margin-top: 4px;
  letter-spacing: 0.5px;
}

.cert-group {
  display: flex;
  gap: 15px;
}

.cert-box {
  display: flex;
  flex-direction: column;
}

.cert-label {
  color: #999;
  font-size: 10px;
  margin-bottom: 2px;
}

.cert-val {
  color: #fff;
  font-weight: bold;
  font-size: 12px;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
}

.cert-txt {
  color: #666;
  font-size: 9px;
  line-height: 1.3;
  transform: scale(0.85);
  transform-origin: left top;
  width: 115%;
}

.footer-bottom {
  text-align: center;
  color: #555;
  font-size: 10px;
  border-top: 1px solid rgba(255,255,255,0.05);
  padding-top: 8px;
  max-width: 600px;
  margin: 0 auto;
}
</style>
