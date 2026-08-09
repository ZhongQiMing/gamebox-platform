/**
 * 幸运六合彩 · 开奖结果卡
 * 白框开奖动画（官网 view_box：摇珠机 + 底部出号条），不要外层紫底双屏
 */
(function (global) {
  const CNY_ZODIAC = [
    [2023, 1, 22, '兔'], [2024, 2, 10, '龙'], [2025, 1, 29, '蛇'], [2026, 2, 17, '马'],
    [2027, 2, 6, '羊'], [2028, 1, 26, '猴'], [2029, 2, 13, '鸡'], [2030, 2, 3, '狗'],
    [2031, 1, 23, '猪'], [2032, 2, 11, '鼠'], [2033, 1, 31, '牛'], [2034, 2, 19, '虎'],
    [2035, 2, 8, '兔'], [2036, 1, 28, '龙'],
  ];
  const ZODIAC_CYCLE = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
  const RED = [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46];
  const BLUE = [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48];

  const LHC_VIDEO_SRC = './media/lhc-video/embed.html?v=14699&embed=1';
  /** 与官网报号节奏对齐（父页 LhcAudio 同轴） */
  const SPIN_MS = 2500;
  const BALL_GAP_MS = 3800;
  const BALL_REVEAL_MS = 1900;
  const HOLD_MS = 1200;
  /** 与 lhc.js PREP_SEC=35 对齐：出号后仍留 hold，gap 只许拉长 */
  const PREP_MS = 35000;
  const GAP_MAX_MS = Math.max(
    BALL_GAP_MS,
    Math.floor((PREP_MS - HOLD_MS - SPIN_MS - BALL_REVEAL_MS - 500) / 6)
  );

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

  function orderStr(nums) {
    return (nums || []).map(function (n) { return pad2(n); }).join(',');
  }

  function revealDurationMs(gapMs) {
    const g = gapMs != null && gapMs >= 0 ? Number(gapMs) : BALL_GAP_MS;
    return SPIN_MS + g * 7 + HOLD_MS;
  }

  function ceremonyOpts(gapMs) {
    return {
      spinMs: SPIN_MS,
      ballGapMs: gapMs != null && gapMs >= 0 ? Number(gapMs) : BALL_GAP_MS,
      ballRevealMs: BALL_REVEAL_MS,
      holdMs: HOLD_MS,
    };
  }

  /** 第 7 球落地时刻（出号点） */
  function numbersAtMs(gapMs) {
    const g = gapMs != null && gapMs >= 0 ? Number(gapMs) : BALL_GAP_MS;
    return SPIN_MS + 6 * g + BALL_REVEAL_MS;
  }

  /**
   * mid/gap 只许拉长：第 7 球出号对齐 openAt，hold 收尾仍原速。
   */
  function resolveGapMs(opts) {
    opts = opts || {};
    let gapMs = opts.ballGapMs != null ? Number(opts.ballGapMs) : BALL_GAP_MS;
    if (!(gapMs >= 0)) gapMs = BALL_GAP_MS;
    if (opts.ballGapMs != null) return Math.min(GAP_MAX_MS, Math.max(BALL_GAP_MS, gapMs));
    const openAt = opts.openAt != null ? Number(opts.openAt) : NaN;
    if (!Number.isFinite(openAt)) return gapMs;
    const remain = openAt - Date.now();
    const targetGap = (remain - SPIN_MS - BALL_REVEAL_MS - 200) / 6;
    if (Number.isFinite(targetGap) && targetGap >= BALL_GAP_MS) {
      gapMs = Math.min(GAP_MAX_MS, targetGap);
    }
    return gapMs;
  }

  function buildResultCardHtml(nums, issue, opts) {
    opts = opts || {};
    const meta = temaMeta(nums);
    const full = String(issue || '');
    const order = orderStr(nums);
    const settled = !!opts.settle;
    let src = LHC_VIDEO_SRC + '&order=' + encodeURIComponent(order);
    if (full) src += '&issue=' + encodeURIComponent(full);
    if (settled) src += '&settle=1';

    return (
      '<div class="lhc-video-card lhc-result-card' + (settled ? ' is-result-shown is-frame-ready is-reveal' : ' is-drawing') +
        '" data-issue="' + full + '" data-nums="' + order +
        '" data-sum="' + meta.sum + '" data-side="' + meta.side + '">' +
        '<div class="lhc-video-card__head">' +
          '<span class="lhc-video-card__title">幸运六合彩</span>' +
          '<span class="lhc-video-card__issue">' + full + '</span>' +
        '</div>' +
        '<div class="lhc-video-card__stage">' +
          '<iframe class="lhc-video-card__frame" title="幸运六合彩开奖动画" src="' + src +
            '" data-nums="' + order + '" allow="autoplay" loading="eager"></iframe>' +
        '</div>' +
        '<footer class="lhc-video-card__foot' + (settled ? ' is-show' : ' is-hidden') + '">' +
          '<div class="lhc-result-stat"><span class="k">期号</span><span class="v is-issue" title="' + full + '">' + full + '</span></div>' +
          '<div class="lhc-result-stat"><span class="k">总和</span><span class="v">' + (settled ? meta.sum : '—') + '</span></div>' +
          '<div class="lhc-result-stat"><span class="k">两面</span><span class="v">' + (settled ? meta.side : '—') + '</span></div>' +
        '</footer>' +
      '</div>'
    );
  }

  function revealFoot(card) {
    if (!card) return;
    const sum = card.getAttribute('data-sum') || '—';
    const side = card.getAttribute('data-side') || '—';
    const foot = card.querySelector('.lhc-video-card__foot');
    const vs = card.querySelectorAll('.lhc-result-stat .v');
    if (vs[1]) vs[1].textContent = sum;
    if (vs[2]) vs[2].textContent = side;
    if (foot) {
      foot.classList.remove('is-hidden');
      foot.classList.add('is-show');
    }
    card.classList.remove('is-drawing', 'is-hold-black');
    card.classList.add('is-reveal', 'is-result-shown');
    card.removeAttribute('data-hold-black');
    card._holdBlackExempt = true;
    /* 揭底栏即出结果：必须清掉「正在开奖」遮罩（forceSettle→settle 路径此前会漏清） */
    if (window.LotteryHoldTip) LotteryHoldTip.clear(card);
  }

  function whenReady(frame, cb) {
    if (!frame) {
      if (typeof cb === 'function') cb(false);
      return;
    }
    let done = false;
    let poll = null;
    const finish = function (ok) {
      if (done) return;
      done = true;
      if (poll) clearInterval(poll);
      window.removeEventListener('message', onMsg);
      try {
        const card = frame.closest && frame.closest('.lhc-video-card');
        if (card) card.classList.add('is-frame-ready');
      } catch (e) { /* ignore */ }
      if (typeof cb === 'function') cb(!!ok);
    };
    /* 必须等 iframe boot/preload 完成（ready），不能仅凭 LhcVideo 存在就 play */
    const isBootReady = function () {
      try {
        const api = frame.contentWindow && frame.contentWindow.LhcVideo;
        return !!(api && typeof api.isReady === 'function' && api.isReady());
      } catch (e) {
        return false;
      }
    };
    const onMsg = function (ev) {
      const d = ev && ev.data;
      if (!d || d.source !== 'lhc-video') return;
      if (d.action === 'ready' && ev.source === frame.contentWindow) finish(true);
    };
    window.addEventListener('message', onMsg);
    if (isBootReady()) {
      finish(true);
      return;
    }
    let n = 0;
    poll = setInterval(function () {
      n += 1;
      if (isBootReady()) {
        finish(true);
        return;
      }
      /* 最长约 8s；超时仍尝试，play 内部会排队到 boot */
      if (n >= 160) finish(true);
    }, 50);
  }

  function bindReveal(root, nums, onDone, opts) {
    opts = opts || {};
    const card = root && root.classList && root.classList.contains('lhc-video-card')
      ? root
      : root && root.querySelector && root.querySelector('.lhc-video-card, .lhc-result-card');
    if (!card || !nums || nums.length !== 7) {
      if (typeof onDone === 'function') onDone();
      return 0;
    }
    const frame = card.querySelector('.lhc-video-card__frame');
    const order = orderStr(nums);
    const gapMs = resolveGapMs(opts);
    const timing = ceremonyOpts(gapMs);
    const total = revealDurationMs(gapMs);
    const numbersAt = numbersAtMs(gapMs);
    if (window.LotteryHoldTip) LotteryHoldTip.clear(card);
    card.classList.add('is-playing', 'is-drawing');
    card.setAttribute('data-playing', '1');
    card._lhcNumsNotified = false;
    card._lhcDoneOnce = false;

    const notifyNumbers = function () {
      if (card._lhcNumsNotified) return;
      card._lhcNumsNotified = true;
      revealFoot(card);
      if (typeof opts.onNumbers === 'function') {
        try { opts.onNumbers(); } catch (eN) { /* ignore */ }
      }
    };
    const onMsg = function (ev) {
      const d = ev && ev.data;
      if (!d || d.source !== 'lhc-video' || d.action !== 'numbers') return;
      if (ev.source !== (frame && frame.contentWindow)) return;
      notifyNumbers();
    };
    const doneWrap = function (ok) {
      if (card._lhcDoneOnce) return;
      card._lhcDoneOnce = true;
      clearTimeout(footTimer);
      window.removeEventListener('message', onMsg);
      revealFoot(card);
      notifyNumbers();
      card.classList.remove('is-playing', 'is-hold-black');
      card.removeAttribute('data-playing');
      card.removeAttribute('data-hold-black');
      card._holdBlackExempt = true;
      if (window.LotteryHoldTip) LotteryHoldTip.clear(card);
      if (window.LhcAudio && LhcAudio.endDrawCeremony) LhcAudio.endDrawCeremony();
      if (typeof onDone === 'function') onDone(ok);
    };

    window.addEventListener('message', onMsg);
    /* 兜底：iframe 未回 numbers 时按时间轴揭脚 */
    const footTimer = setTimeout(notifyNumbers, numbersAt);

    whenReady(frame, function () {
      /* 真开播后再通知父页排揭晓倒计时，避免 iframe 慢加载导致提前掐动画 */
      if (typeof opts.onStarted === 'function') {
        try { opts.onStarted(total, numbersAt); } catch (e0) { /* ignore */ }
      }
      if (window.LhcAudio) {
        if (LhcAudio.unlock) LhcAudio.unlock();
        if (LhcAudio.startDrawCeremony) {
          LhcAudio.startDrawCeremony(Object.assign({ nums: nums }, timing));
        }
      }
      const w = frame && frame.contentWindow;
      if (w && w.LhcVideo && typeof w.LhcVideo.play === 'function') {
        try {
          w.LhcVideo.play(order, Object.assign({}, timing, {
            onNumbers: notifyNumbers,
            onDone: doneWrap,
          }));
          return;
        } catch (ePlay) { /* 改走 postMessage */ }
      }
      try {
        frame.contentWindow.postMessage(
          Object.assign({ source: 'lhc-video', action: 'play', order: order }, timing), location.origin);
      } catch (e) { /* ignore */ }
      setTimeout(function () { doneWrap(true); }, total);
    });

    return total;
  }

  /**
   * 软落定：只调 iframe API + 露脚，禁止改 src。
   * 改 src 加 settle=1 会整页重载，表现为「出号后再闪一下」。
   */
  function settle(root, nums) {
    const card = root && root.classList && root.classList.contains('lhc-video-card')
      ? root
      : root && root.querySelector && root.querySelector('.lhc-video-card, .lhc-result-card');
    if (!card || !nums || nums.length !== 7) return;
    if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1') return;

    const alreadySettled = !!(card.classList.contains('is-result-shown') && card.classList.contains('is-reveal'));
    const frame = card.querySelector('.lhc-video-card__frame');
    const order = orderStr(nums);
    /* revealFoot 内已清 tip / hold；此处再保一次 */
    if (window.LotteryHoldTip) LotteryHoldTip.clear(card);
    revealFoot(card);
    card.classList.add('is-frame-ready', 'is-settled');
    card.removeAttribute('data-hold-black');
    card.classList.remove('is-hold-black');
    card._holdBlackExempt = true;
    if (alreadySettled || !frame) return;

    whenReady(frame, function () {
      const w = frame.contentWindow;
      if (w && w.LhcVideo && typeof w.LhcVideo.settle === 'function') {
        w.LhcVideo.settle(order);
        return;
      }
      try {
        frame.contentWindow.postMessage({ source: 'lhc-video', action: 'settle', order: order }, location.origin);
      } catch (e2) { /* ignore */ }
    });
  }

  /**
   * 中途离房再进 / 历史重放：仪式未完时压成黑卡（不出号、不露脚），避免泄底。
   * 播放中的卡不动。
   */
  function holdBlack(root) {
    const card = root && root.classList && root.classList.contains('lhc-video-card')
      ? root
      : root && root.querySelector && root.querySelector('.lhc-video-card, .lhc-result-card');
    if (!card) return false;
    if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1') return false;
    /* 本页已播完/揭晓：禁止快照再压黑 */
    if (card._holdBlackExempt || card.classList.contains('is-result-shown') || card.classList.contains('is-reveal') || card.classList.contains('is-settled')) return false;
    if (card.getAttribute('data-hold-black') === '1' && card.classList.contains('is-drawing')) {
      if (window.LotteryHoldTip) LotteryHoldTip.ensure(card, '.lhc-video-card__stage');
      return true;
    }

    const order = String(card.getAttribute('data-nums') || '').trim();
    const issue = String(card.getAttribute('data-issue') || '').trim();
    card.setAttribute('data-hold-black', '1');
    card.classList.remove('is-reveal', 'is-result-shown', 'is-settled', 'is-frame-ready');
    card.classList.add('is-drawing');
    const foot = card.querySelector('.lhc-video-card__foot');
    if (foot) {
      foot.classList.add('is-hidden');
      foot.classList.remove('is-show');
      const vs = card.querySelectorAll('.lhc-result-stat .v');
      if (vs[1]) vs[1].textContent = '—';
      if (vs[2]) vs[2].textContent = '—';
    }
    const frame = card.querySelector('.lhc-video-card__frame');
    if (frame && order) {
      let src = LHC_VIDEO_SRC + '&order=' + encodeURIComponent(order) + '&hold=1';
      if (issue) src += '&issue=' + encodeURIComponent(issue);
      frame.setAttribute('src', src);
    }
    if (window.LotteryHoldTip) LotteryHoldTip.ensure(card, '.lhc-video-card__stage');
    return true;
  }

  global.LhcResultCard = {
    build: function (nums, issue, opts) {
      return buildResultCardHtml(nums, issue, opts);
    },
    bindReveal: bindReveal,
    settle: settle,
    holdBlack: holdBlack,
    temaMeta: temaMeta,
    zodiacOf: zodiacOf,
    waveColor: waveColor,
    ballSrc: ballSrc,
    revealDurationMs: revealDurationMs,
    revealFoot: revealFoot,
  };
})(typeof window !== 'undefined' ? window : this);
