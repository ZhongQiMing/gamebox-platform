/** 开奖结果卡片 HTML（ffc.js 共用） */
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

  function buildResultCardHtml(nums, issue) {
    const meta = gyMeta(nums);
    const sideText = meta.text.replace(/^\d+\s*/, '');
    const balls = nums.map((n, i) => {
      const delay = (i * 0.16).toFixed(2);
      return `<div class="ffc-bot-result__ball-col" style="--roll-delay:${delay}s">
        <div class="ffc-bot-result__ball-roll">
          <span class="ffc-bot-result__ball-num">0</span>
        </div>
        <span class="ffc-bot-result__ball-pos">${POS_LABELS[i]}</span>
      </div>`;
    }).join('');
    const chipBase = 1.15 + nums.length * 0.22;
    const sideVal = sideText.replace(/\s+/g, '');
    const chip = (label, val, delay) =>
      `<span class="ffc-bot-result__chip ffc-bot-chip-pop" style="--pop-delay:${delay}s">` +
      `<span class="ffc-bot-result__chip-k">${label}</span>` +
      `<span class="ffc-bot-result__chip-v">${val}</span></span>`;
    return `<div class="ffc-bot-card ffc-bot-card--result is-reveal" data-nums="${nums.join(',')}">
      <div class="ffc-bot-card__head"><span class="ffc-bot-card__title">开奖结果</span><span class="ffc-bot-card__issue">${issue}</span></div>
      <div class="ffc-bot-result__body">
        <div class="ffc-bot-result__glow" aria-hidden="true"></div>
        <div class="ffc-bot-result__balls">${balls}</div>
        <div class="ffc-bot-result__meta">
          ${chip('和值', meta.sum, chipBase.toFixed(2))}
          ${chip('双面', sideVal, (chipBase + 0.14).toFixed(2))}
          ${chip('龙虎', dragonTigerOf(nums), (chipBase + 0.28).toFixed(2))}
          ${chip('斗牛', lhRow(nums), (chipBase + 0.42).toFixed(2))}
        </div>
      </div>
    </div>`;
  }

  /** 立刻落定球号（进房恢复历史卡用，不做滚号） */
  function settle(root, nums) {
    if (!root || !nums || nums.length !== 5) return;
    root.setAttribute('data-nums', nums.join(','));
    const rolls = root.querySelectorAll('.ffc-bot-result__ball-roll');
    rolls.forEach((roll, i) => {
      const numEl = roll.querySelector('.ffc-bot-result__ball-num');
      if (!numEl) return;
      numEl.textContent = nums[i];
      roll.classList.remove('is-rolling');
      roll.classList.add('is-settled');
    });
    root.classList.add('is-settled');
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

  function bindReveal(root, nums, onDone) {
    if (!root || !nums || nums.length !== 5) {
      if (typeof onDone === 'function') onDone();
      return;
    }
    root.setAttribute('data-nums', nums.join(','));
    const rolls = root.querySelectorAll('.ffc-bot-result__ball-roll');
    let left = rolls.length;
    if (!left) {
      if (typeof onDone === 'function') onDone();
      return;
    }
    rolls.forEach((roll, i) => {
      const numEl = roll.querySelector('.ffc-bot-result__ball-num');
      if (!numEl) {
        left -= 1;
        if (left <= 0 && typeof onDone === 'function') onDone();
        return;
      }
      const target = nums[i];
      const startDelay = i * 180;
      const spinMs = 480 + i * 70;
      setTimeout(() => {
        roll.classList.add('is-rolling');
        const t0 = performance.now();
        function frame(now) {
          const elapsed = now - t0;
          if (elapsed < spinMs) {
            numEl.textContent = Math.floor(Math.random() * 10);
            requestAnimationFrame(frame);
          } else {
            numEl.textContent = target;
            roll.classList.remove('is-rolling');
            roll.classList.add('is-settled');
            left -= 1;
            if (left <= 0) {
              root.classList.add('is-settled');
              if (typeof onDone === 'function') onDone();
            }
          }
        }
        requestAnimationFrame(frame);
      }, startDelay);
    });
  }

  global.FfcResultCard = {
    build: buildResultCardHtml,
    bindReveal,
    settle,
    parseNums,
    gyMeta,
    lhRow
  };
})(typeof window !== 'undefined' ? window : this);
