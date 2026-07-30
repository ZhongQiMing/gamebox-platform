/** 开奖结果卡片 — 金玉开盘（ssc.js 共用） */
(function (global) {
  function sumOf(nums) {
    return nums.reduce((a, b) => a + b, 0);
  }

  function gyMeta(nums) {
    const s = sumOf(nums);
    return { text: `${s} ${s >= 23 ? '大' : '小'} ${s % 2 ? '单' : '双'}`, sum: s };
  }

  function niuValue(nums) {
    const total = sumOf(nums);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 4; j++) {
        for (let k = j + 1; k < 5; k++) {
          if ((nums[i] + nums[j] + nums[k]) % 10 === 0) {
            const v = (total - nums[i] - nums[j] - nums[k]) % 10;
            return v === 0 ? 10 : v;
          }
        }
      }
    }
    return -1;
  }

  function niuLabel(v) {
    if (v === -1) return '无牛';
    if (v === 10) return '牛牛';
    return '牛' + v;
  }

  function lhRow(nums) {
    return niuLabel(niuValue(nums));
  }

  function dragonTigerOf(nums) {
    const wan = nums[0];
    const ge = nums[4];
    return wan > ge ? '龙' : wan < ge ? '虎' : '和';
  }

  const POS_LABELS = ['万', '千', '百', '十', '个'];
  /* 停止顺序：个 → 十 → 百 → 千 → 万（对齐正版按位产生） */
  const STOP_ORDER = [4, 3, 2, 1, 0];
  /* 默认短揭晓（历史瞬落估算）；直播由 bindReveal(durationMs) 拉长到封盘窗口 */
  const DROP_START_MS = 200;
  const DROP_STAGGER_MS = 80;
  const SPIN_BASE_MS = 520;
  const SPIN_STEP_MS = 90;
  const META_REVEAL_MS = 520;

  function revealDurationMs(n, durationMs) {
    const forced = Number(durationMs) || 0;
    if (forced > 0) return forced;
    const count = n || 5;
    const lastStart = DROP_START_MS + (count - 1) * DROP_STAGGER_MS;
    const lastSpin = SPIN_BASE_MS + (count - 1) * SPIN_STEP_MS;
    return lastStart + lastSpin + META_REVEAL_MS + 120;
  }

  function timingForDuration(count, durationMs) {
    const n = Math.max(1, count || 5);
    const total = Math.max(2800, Number(durationMs) || revealDurationMs(n));
    const meta = Math.min(900, Math.max(480, Math.floor(total * 0.08)));
    const body = Math.max(2000, total - meta);
    /* 五球几乎同时落下开转，刹停按个→万错峰 */
    const dropStart = Math.min(320, Math.floor(body * 0.04));
    const dropStagger = n > 1 ? Math.min(90, Math.floor(body * 0.02)) : 0;
    const stopGap = n > 1 ? Math.floor((body * 0.48) / (n - 1)) : 0;
    const spinBase = Math.max(700, Math.floor(body * 0.28));
    return { dropStart, dropStagger, stopGap, spinBase, meta, total };
  }

  function buildResultCardHtml(nums, issue) {
    const meta = gyMeta(nums);
    const sideText = meta.text.replace(/^\d+\s*/, '');
    const balls = nums.map((n, i) => {
      const stopStep = STOP_ORDER.indexOf(i);
      const delay = ((DROP_START_MS + Math.max(0, stopStep) * DROP_STAGGER_MS) / 1000).toFixed(2);
      return `<div class="ssc-bot-result__ball-col" style="--roll-delay:${delay}s">
        <div class="ssc-bot-result__ball-roll">
          <span class="ssc-bot-result__ball-ring" aria-hidden="true"></span>
          <span class="ssc-bot-result__ball-spark" aria-hidden="true"></span>
          <span class="ssc-bot-result__ball-num">0</span>
        </div>
        <span class="ssc-bot-result__ball-pos">${POS_LABELS[i]}</span>
      </div>`;
    }).join('');
    const sideVal = sideText.replace(/\s+/g, '');
    const chip = (label, val, idx, extraAttr) =>
      `<span class="ssc-bot-result__chip" style="--chip-i:${idx}"${extraAttr || ''}>` +
      `<span class="ssc-bot-result__chip-k">${label}</span>` +
      `<span class="ssc-bot-result__chip-v">${val}</span></span>`;
    return `<div class="ssc-bot-card ssc-bot-card--result is-reveal" data-nums="${nums.join(',')}" data-sum="${meta.sum}">
      <div class="ssc-bot-card__head">
        <span class="ssc-bot-card__title">开奖结果</span>
        <span class="ssc-bot-result__badge" aria-hidden="true">开奖中</span>
        <span class="ssc-bot-card__issue">${issue}</span>
      </div>
      <div class="ssc-bot-result__body">
        <div class="ssc-bot-result__sweep" aria-hidden="true"></div>
        <div class="ssc-bot-result__glow" aria-hidden="true"></div>
        <div class="ssc-bot-result__tray">
          <div class="ssc-bot-result__balls">${balls}</div>
        </div>
        <div class="ssc-bot-result__meta">
          ${chip('和值', '0', 0, ' data-chip="sum"')}
          ${chip('双面', sideVal, 1)}
          ${chip('龙虎', dragonTigerOf(nums), 2)}
          ${chip('斗牛', lhRow(nums), 3)}
        </div>
      </div>
    </div>`;
  }

  function settle(root, nums) {
    if (!root || !nums || nums.length !== 5) return;
    root.setAttribute('data-nums', nums.join(','));
    root.setAttribute('data-sum', String(sumOf(nums)));
    root.classList.remove('is-reveal', 'is-meta-reveal');
    root.classList.add('is-settled', 'is-instant');
    const rolls = root.querySelectorAll('.ssc-bot-result__ball-roll');
    rolls.forEach((roll, i) => {
      const numEl = roll.querySelector('.ssc-bot-result__ball-num');
      if (!numEl) return;
      numEl.textContent = nums[i];
      roll.classList.remove('is-rolling', 'is-dropping');
      roll.classList.add('is-settled');
    });
    const sumEl = root.querySelector('[data-chip="sum"] .ssc-bot-result__chip-v');
    if (sumEl) sumEl.textContent = String(sumOf(nums));
  }

  function parseNums(text) {
    const parts = String(text || '')
      .split(/[,，\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length !== 5) return null;
    const nums = parts.map(n => parseInt(n, 10));
    if (nums.some(n => Number.isNaN(n) || n < 0 || n > 9)) return null;
    return nums;
  }

  function animateSumCount(el, target, ms) {
    if (!el) return;
    const end = Number(target) || 0;
    const t0 = performance.now();
    const dur = Math.max(180, ms || 360);
    function frame(now) {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 2);
      el.textContent = String(Math.round(end * eased));
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = String(end);
    }
    requestAnimationFrame(frame);
  }

  /**
   * @param {HTMLElement} root
   * @param {number[]} nums
   * @param {Function} [onDone]
   * @param {{ durationMs?: number }} [opts] 直播仪式总时长（含落球滚号+摘要），默认短揭晓
   */
  function bindReveal(root, nums, onDone, opts) {
    if (!root || !nums || nums.length !== 5) {
      if (typeof onDone === 'function') onDone();
      return;
    }
    opts = opts || {};
    const timing = timingForDuration(5, opts.durationMs);
    root.setAttribute('data-nums', nums.join(','));
    root.setAttribute('data-sum', String(sumOf(nums)));
    root.classList.remove('is-instant', 'is-settled', 'is-meta-reveal');
    root.classList.add('is-reveal');

    const rolls = root.querySelectorAll('.ssc-bot-result__ball-roll');
    let left = rolls.length;
    if (!left) {
      if (typeof onDone === 'function') onDone();
      return;
    }

    function finishMeta() {
      root.classList.add('is-settled', 'is-meta-reveal');
      const sumEl = root.querySelector('[data-chip="sum"] .ssc-bot-result__chip-v');
      animateSumCount(sumEl, sumOf(nums), Math.min(600, timing.meta));
      setTimeout(() => {
        if (typeof onDone === 'function') onDone();
      }, timing.meta);
    }

    rolls.forEach((roll, i) => {
      const numEl = roll.querySelector('.ssc-bot-result__ball-num');
      if (!numEl) {
        left -= 1;
        if (left <= 0) finishMeta();
        return;
      }
      const target = nums[i];
      /* 个位先停：stopStep 0=个 … 4=万 */
      const stopStep = STOP_ORDER.indexOf(i);
      const startDelay = timing.dropStart + Math.max(0, stopStep) * timing.dropStagger;
      const spinMs = timing.spinBase + Math.max(0, stopStep) * timing.stopGap;
      roll.style.setProperty('--roll-delay', (startDelay / 1000).toFixed(2) + 's');
      setTimeout(() => {
        roll.classList.add('is-dropping', 'is-rolling');
        const t0 = performance.now();
        let lastTick = -1;
        let cur = Math.floor(Math.random() * 10);
        function frame(now) {
          const elapsed = now - t0;
          const p = Math.min(1, elapsed / spinMs);
          /* 前段快滚，末段减速，像滚轮刹停 */
          const tickMs = p < 0.62 ? 28 : p < 0.85 ? 55 : 95;
          if (lastTick < 0 || now - lastTick >= tickMs) {
            lastTick = now;
            if (p < 0.9) {
              cur = (cur + 1 + Math.floor(Math.random() * 3)) % 10;
              if (cur === target) cur = (cur + 1) % 10;
              numEl.textContent = String(cur);
              if (global.SscAudio && SscAudio.rollTick) SscAudio.rollTick();
            } else {
              numEl.textContent = String(target);
            }
          }
          if (elapsed < spinMs) {
            requestAnimationFrame(frame);
          } else {
            numEl.textContent = String(target);
            roll.classList.remove('is-rolling', 'is-dropping');
            void roll.offsetWidth;
            roll.classList.add('is-settled');
            if (global.SscAudio && SscAudio.ballStop) SscAudio.ballStop();
            left -= 1;
            if (left <= 0) finishMeta();
          }
        }
        requestAnimationFrame(frame);
      }, startDelay);
    });
  }

  global.SscResultCard = {
    build: buildResultCardHtml,
    bindReveal,
    settle,
    parseNums,
    gyMeta,
    lhRow,
    revealDurationMs
  };
})(typeof window !== 'undefined' ? window : this);
