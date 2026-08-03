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

  const LHC_VIDEO_SRC = './media/lhc-video/embed.html?v=11&embed=1';
  /** 与官网报号节奏对齐（父页 LhcAudio 同轴） */
  const SPIN_MS = 2500;
  const BALL_GAP_MS = 3800;
  const BALL_REVEAL_MS = 1900;
  const HOLD_MS = 1200;

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

  function revealDurationMs() {
    return SPIN_MS + BALL_GAP_MS * 7 + HOLD_MS;
  }

  function ceremonyOpts() {
    return {
      spinMs: SPIN_MS,
      ballGapMs: BALL_GAP_MS,
      ballRevealMs: BALL_REVEAL_MS,
      holdMs: HOLD_MS,
    };
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
    card.classList.remove('is-drawing');
    card.classList.add('is-reveal', 'is-result-shown');
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
    const total = opts.durationMs > 0 ? Number(opts.durationMs) : revealDurationMs();
    const timing = ceremonyOpts();
    card.classList.add('is-playing', 'is-drawing');
    card.setAttribute('data-playing', '1');

    const footAt = Math.max(0, total - HOLD_MS);
    const footTimer = setTimeout(function () { revealFoot(card); }, footAt);

    const doneWrap = function (ok) {
      clearTimeout(footTimer);
      revealFoot(card);
      card.classList.remove('is-playing');
      card.removeAttribute('data-playing');
      if (window.LhcAudio && LhcAudio.endDrawCeremony) LhcAudio.endDrawCeremony();
      if (typeof onDone === 'function') onDone(ok);
    };

    whenReady(frame, function () {
      if (window.LhcAudio) {
        if (LhcAudio.unlock) LhcAudio.unlock();
        if (LhcAudio.startDrawCeremony) {
          LhcAudio.startDrawCeremony(Object.assign({ nums: nums }, timing));
        }
      }
      const w = frame && frame.contentWindow;
      if (w && w.LhcVideo && typeof w.LhcVideo.play === 'function') {
        w.LhcVideo.play(order, Object.assign({}, timing, { onDone: doneWrap }));
        return;
      }
      try {
        frame.contentWindow.postMessage(
          Object.assign({ source: 'lhc-video', action: 'play', order: order }, timing), location.origin);
      } catch (e) { /* ignore */ }
      setTimeout(function () { doneWrap(true); }, total);
    });

    return total;
  }

  function settle(root, nums) {
    const card = root && root.classList && root.classList.contains('lhc-video-card')
      ? root
      : root && root.querySelector && root.querySelector('.lhc-video-card, .lhc-result-card');
    if (!card || !nums || nums.length !== 7) return;
    if (card.classList.contains('is-playing') || card.getAttribute('data-playing') === '1') return;

    const frame = card.querySelector('.lhc-video-card__frame');
    const order = orderStr(nums);
    revealFoot(card);
    card.classList.add('is-frame-ready');

    if (!frame) return;
    try {
      const cur = String(frame.getAttribute('src') || '');
      if (cur.indexOf('settle=1') < 0) {
        let next = cur;
        if (next.indexOf('order=') < 0) next += '&order=' + encodeURIComponent(order);
        if (next.indexOf('settle=1') < 0) next += '&settle=1';
        frame.setAttribute('src', next);
        return;
      }
    } catch (e) { /* ignore */ }

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

  global.LhcResultCard = {
    build: function (nums, issue, opts) {
      return buildResultCardHtml(nums, issue, opts);
    },
    bindReveal: bindReveal,
    settle: settle,
    temaMeta: temaMeta,
    zodiacOf: zodiacOf,
    waveColor: waveColor,
    ballSrc: ballSrc,
    revealDurationMs: revealDurationMs,
  };
})(typeof window !== 'undefined' ? window : this);
