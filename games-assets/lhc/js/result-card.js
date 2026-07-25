/**
 * 幸运六合彩 · 开奖结果卡（简洁版）
 * 七球依次停定 → 正下方出对应生肖 → 再出底部汇总
 */
(function (global) {
  const CNY_ZODIAC = [
    [2023, 1, 22, '兔'], [2024, 2, 10, '龙'], [2025, 1, 29, '蛇'], [2026, 2, 17, '马'],
    [2027, 2, 6, '羊'], [2028, 1, 26, '猴'], [2029, 2, 13, '鸡'], [2030, 2, 3, '狗'],
    [2031, 1, 23, '猪'], [2032, 2, 11, '鼠'], [2033, 1, 31, '牛'], [2034, 2, 19, '虎'],
    [2035, 2, 8, '兔'], [2036, 1, 28, '龙'],
  ];
  const ZODIAC_CYCLE = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
  function yearZodiacAt(date) {
    const d = date || new Date();
    let zodiac = '马';
    CNY_ZODIAC.forEach(([y, m, day, z]) => {
      if (d.getFullYear() > y || (d.getFullYear() === y && (d.getMonth() + 1 > m || (d.getMonth() + 1 === m && d.getDate() >= day)))) zodiac = z;
    });
    return zodiac;
  }
  function zodiacOrder() {
    const start = ZODIAC_CYCLE.indexOf(yearZodiacAt());
    return Array.from({ length: 12 }, (_, i) => ZODIAC_CYCLE[(start - i + 12) % 12]);
  }
  const RED = [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46];
  const BLUE = [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function zodiacOf(n) {
    return zodiacOrder()[(n - 1) % 12];
  }
  function waveColor(n) {
    if (RED.includes(n)) return '红';
    if (BLUE.includes(n)) return '蓝';
    return '绿';
  }
  function ballSrc(n) {
    return './assets/balls/ball_' + pad2(n) + '.png';
  }
  function waveClass(wave) {
    if (wave === '红') return 'is-red';
    if (wave === '蓝') return 'is-blue';
    return 'is-green';
  }
  function temaMeta(nums) {
    const sp = nums[6];
    const sum = nums.reduce((a, b) => a + b, 0);
    const size = sp >= 25 ? '大' : '小';
    const oe = sp % 2 ? '单' : '双';
    const wave = waveColor(sp);
    return {
      sum,
      size,
      oe,
      side: `${size}${oe}`,
      wave,
      zodiac: zodiacOf(sp),
    };
  }

  function buildResultCardHtml(nums, issue) {
    const meta = temaMeta(nums);
    const full = String(issue || '');
    const slots = Array.from({ length: 7 }, (_, i) => {
      const isTe = i === 6 ? ' is-te' : '';
      return `<div class="lhc-roll-slot${isTe}" data-idx="${i}">
        <img class="lhc-roll-slot__ball" src="${ballSrc(1 + (i % 49))}" alt="" draggable="false">
        <span class="lhc-zx-cell"><i></i></span>
      </div>`;
    }).join('');

    return `<div class="lhc-result-card is-drawing" data-issue="${full}">
      <div class="lhc-result-card__head">
        <span class="lhc-result-card__title">幸运六合彩</span>
        <span class="lhc-result-card__issue">${full}</span>
      </div>
      <div class="lhc-result-card__body">
        <div class="lhc-result-card__rolls">${slots}</div>
      </div>
      <div class="lhc-result-card__foot is-hidden">
        <div class="lhc-result-stat"><span class="k">期号</span><span class="v is-issue" title="${full}">${full}</span></div>
        <div class="lhc-result-stat"><span class="k">总和</span><span class="v">${meta.sum}</span></div>
        <div class="lhc-result-stat"><span class="k">两面</span><span class="v">${meta.side}</span></div>
      </div>
    </div>`;
  }

  function bindReveal(root, nums, onDone) {
    const card = root && root.classList && root.classList.contains('lhc-result-card')
      ? root
      : root && root.querySelector && root.querySelector('.lhc-result-card');
    if (!card || !nums || nums.length !== 7) {
      if (typeof onDone === 'function') onDone();
      return 0;
    }

    const slots = card.querySelectorAll('.lhc-roll-slot');
    const foot = card.querySelector('.lhc-result-card__foot');
    const startGap = 200;
    const spinBase = 480;
    const spinStep = 80;
    const total = Math.min(7, slots.length || 0);
    let settled = 0;
    let doneFired = false;

    function finishReveal() {
      if (doneFired) return;
      doneFired = true;
      card.classList.remove('is-drawing');
      card.classList.add('is-reveal');
      if (foot) {
        foot.classList.remove('is-hidden');
        foot.classList.add('is-show');
      }
      if (typeof onDone === 'function') setTimeout(onDone, 280);
    }

    if (!total) {
      finishReveal();
      return 0;
    }

    slots.forEach((slot, i) => {
      if (i >= 7) return;
      const img = slot.querySelector('.lhc-roll-slot__ball');
      const zxEl = slot.querySelector('.lhc-zx-cell');
      const target = nums[i];
      if (!img || target == null) {
        settled += 1;
        if (settled >= total) finishReveal();
        return;
      }
      const startDelay = i * startGap;
      const spinMs = spinBase + i * spinStep;

      setTimeout(() => {
        slot.classList.add('is-rolling');
        const t0 = performance.now();
        let lastSwap = 0;
        function frame(now) {
          const elapsed = now - t0;
          if (elapsed < spinMs) {
            if (now - lastSwap > 55) {
              lastSwap = now;
              img.src = ballSrc(1 + Math.floor(Math.random() * 49));
            }
            requestAnimationFrame(frame);
          } else {
            img.src = ballSrc(target);
            slot.classList.remove('is-rolling');
            slot.classList.add('is-settled');
            if (zxEl) {
              zxEl.innerHTML = '<i>' + zodiacOf(target) + '</i>';
              zxEl.classList.add('is-show');
            }
            settled += 1;
            if (settled >= total) finishReveal();
          }
        }
        requestAnimationFrame(frame);
      }, startDelay);
    });

    return 6 * startGap + spinBase + 6 * spinStep + 400;
  }

  /** 进房历史：立刻落定，不重播滚球 */
  function settle(root, nums) {
    const cardEl = root && root.classList && root.classList.contains('lhc-result-card')
      ? root
      : root && root.querySelector && root.querySelector('.lhc-result-card');
    if (!cardEl || !nums || nums.length !== 7) return;
    const slots = cardEl.querySelectorAll('.lhc-roll-slot');
    const foot = cardEl.querySelector('.lhc-result-card__foot');
    slots.forEach(function (slot, i) {
      const img = slot.querySelector('.lhc-roll-slot__ball');
      const zxEl = slot.querySelector('.lhc-zx-cell');
      const target = nums[i];
      if (img) img.src = ballSrc(target);
      slot.classList.remove('is-rolling');
      slot.classList.add('is-settled');
      if (zxEl) {
        zxEl.innerHTML = '<i>' + zodiacOf(target) + '</i>';
        zxEl.classList.add('is-show');
      }
    });
    cardEl.classList.remove('is-drawing');
    cardEl.classList.add('is-reveal');
    if (foot) {
      foot.classList.remove('is-hidden');
      foot.classList.add('is-show');
    }
  }

  global.LhcResultCard = {
    build: buildResultCardHtml,
    bindReveal,
    settle,
    temaMeta,
    zodiacOf,
    waveColor,
  };
})(typeof window !== 'undefined' ? window : this);
