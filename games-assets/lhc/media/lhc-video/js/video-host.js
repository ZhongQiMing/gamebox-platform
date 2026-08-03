/**
 * 幸运六合彩 · 白框开奖宿主
 * - 单层 view_box：机台 GIF/静帧定点切换（status → each → idle）
 * - 出号条固定 7 槽按 index 填入
 */
(function (global) {
  'use strict';

  var STAGE_W = 641;
  var STAGE_H = 361;
  var SPIN_MS = 2500;
  var BALL_GAP_MS = 3800;
  var BALL_REVEAL_MS = 1900;
  var HOLD_MS = 1200;

  var GIF_STATUS = 'img/status.gif';
  var GIF_EACH = 'img/each.gif';
  var IMG_IDLE = 'img/0001.png';

  var playTimers = [];
  var playing = false;
  var machineMode = '';
  /** preload 完成前：父页 play 先排队；完成后勿再 idle+clearBalls 打断 */
  var booted = false;
  var pendingPlay = null;

  function pad2(n) {
    n = Number(n) || 0;
    return n < 10 ? '0' + n : String(n);
  }

  function numsOf(order) {
    var raw;
    if (Array.isArray(order)) {
      raw = order.map(function (n) { return parseInt(n, 10); });
    } else {
      raw = String(order || '')
        .split(/[,\s]+/)
        .map(function (s) { return parseInt(s, 10); });
    }
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var n = raw[i];
      if (n >= 1 && n <= 49) out.push(n);
      if (out.length >= 7) break;
    }
    return out;
  }

  function clearTimers() {
    for (var i = 0; i < playTimers.length; i++) clearTimeout(playTimers[i]);
    playTimers = [];
  }

  function el(id) {
    return document.getElementById(id);
  }

  /** 强制重播 GIF：换带时间戳的 src */
  function setMachineSrc(src, asGif) {
    var img = el('machineGif');
    if (!img) return;
    var next = src;
    if (asGif) {
      next = src + (src.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
    }
    /* 先清空再赋，避免部分 WebView 不重播 */
    try { img.removeAttribute('src'); } catch (e) { /* ignore */ }
    img.setAttribute('src', next);
  }

  function setStageMode(mode) {
    if (mode === machineMode && mode !== 'status' && mode !== 'each') return;
    machineMode = mode;
    if (mode === 'status') {
      setMachineSrc(GIF_STATUS, true);
    } else if (mode === 'each') {
      setMachineSrc(GIF_EACH, true);
    } else {
      setMachineSrc(IMG_IDLE, false);
    }
  }

  function ballSrc(n) {
    return '../../assets/balls/ball_' + pad2(n) + '.png';
  }

  function slotEls() {
    var list = el('numList');
    if (!list) return [];
    return Array.prototype.slice.call(list.children, 0, 7);
  }

  function clearBalls() {
    var slots = slotEls();
    for (var i = 0; i < slots.length; i++) {
      var li = slots[i];
      var img = li.querySelector('img');
      li.classList.add('is-empty');
      if (img) {
        try { img.removeAttribute('src'); } catch (e) { /* ignore */ }
        img.alt = '';
      }
    }
  }

  function setBallAt(idx, n) {
    var slots = slotEls();
    if (idx < 0 || idx >= slots.length) return;
    var num = Number(n);
    if (!(num >= 1 && num <= 49)) return;
    var li = slots[idx];
    var img = li.querySelector('img');
    if (!img) return;
    li.classList.remove('is-empty');
    img.alt = pad2(num);
    img.src = ballSrc(num);
  }

  function renderAll(nums) {
    clearBalls();
    for (var i = 0; i < 7; i++) {
      if (nums[i] != null) setBallAt(i, nums[i]);
    }
  }

  function fitStage() {
    try {
      var stage = el('stage');
      if (!stage) return;
      var w = global.innerWidth || document.documentElement.clientWidth || STAGE_W;
      var h = global.innerHeight || document.documentElement.clientHeight || STAGE_H;
      var s = Math.min(w / STAGE_W, h / STAGE_H);
      if (!(s > 0) || !isFinite(s)) s = 1;
      stage.style.transform = 'scale(' + s + ')';
      document.documentElement.style.background = '#0b1220';
      document.body.style.background = '#0b1220';
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';
    } catch (e) { /* ignore */ }
  }

  function readyPing() {
    try {
      if (window.parent && window.parent !== window) {
        parent.postMessage({ source: 'lhc-video', action: 'ready' }, location.origin);
      }
    } catch (e) { /* ignore */ }
  }

  function preload(urls, cb) {
    var left = urls.length;
    if (!left) {
      if (typeof cb === 'function') cb();
      return;
    }
    var done = function () {
      left -= 1;
      if (left <= 0 && typeof cb === 'function') cb();
    };
    urls.forEach(function (src) {
      var img = new Image();
      img.onload = done;
      img.onerror = done;
      img.src = src;
    });
    setTimeout(function () {
      if (left > 0) {
        left = 0;
        if (typeof cb === 'function') cb();
      }
    }, 5000);
  }

  function totalMs(spinMs, gapMs, holdMs) {
    return spinMs + gapMs * 7 + holdMs;
  }

  function play(order, opts) {
    opts = opts || {};
    var nums = numsOf(order);
    if (nums.length !== 7) {
      if (typeof opts.onDone === 'function') opts.onDone(false);
      return 0;
    }
    /* boot 未完成：先排队，避免随后 idle+clearBalls 掐死 GIF / 第一球 */
    if (!booted) {
      pendingPlay = { order: order, opts: opts };
      return totalMs(
        opts.spinMs != null ? Number(opts.spinMs) : SPIN_MS,
        opts.ballGapMs != null ? Number(opts.ballGapMs) : BALL_GAP_MS,
        opts.holdMs != null ? Number(opts.holdMs) : HOLD_MS
      );
    }
    pendingPlay = null;
    clearTimers();
    playing = true;
    machineMode = '';
    clearBalls();
    setStageMode('status');

    var spinMs = opts.spinMs != null ? Number(opts.spinMs) : SPIN_MS;
    var gapMs = opts.ballGapMs != null ? Number(opts.ballGapMs) : BALL_GAP_MS;
    var revealMs = opts.ballRevealMs != null ? Number(opts.ballRevealMs) : BALL_REVEAL_MS;
    var holdMs = opts.holdMs != null ? Number(opts.holdMs) : HOLD_MS;
    if (!(spinMs >= 0)) spinMs = SPIN_MS;
    if (!(gapMs >= 0)) gapMs = BALL_GAP_MS;
    if (!(revealMs >= 0)) revealMs = BALL_REVEAL_MS;
    if (!(holdMs >= 0)) holdMs = HOLD_MS;
    if (revealMs > gapMs - 200) revealMs = Math.max(0, gapMs - 200);

    var total = totalMs(spinMs, gapMs, holdMs);

    playTimers.push(setTimeout(function () {
      setStageMode('each');
    }, Math.min(800, spinMs)));

    for (var i = 0; i < 7; i++) {
      (function (idx, num) {
        var showAt = spinMs + idx * gapMs + revealMs;
        playTimers.push(setTimeout(function () {
          setBallAt(idx, num);
        }, showAt));
      })(i, nums[i]);
    }

    playTimers.push(setTimeout(function () {
      setStageMode('idle');
      /* 结束时再刷一遍，防止某一槽定时器丢失 */
      renderAll(nums);
      playing = false;
      if (typeof opts.onDone === 'function') opts.onDone(true);
    }, total));

    return total;
  }

  function settle(order) {
    pendingPlay = null;
    clearTimers();
    playing = false;
    machineMode = '';
    var nums = numsOf(order);
    setStageMode('idle');
    if (nums.length === 7) renderAll(nums);
    else clearBalls();
    return true;
  }

  function qParam(q, key) {
    var m = new RegExp('(?:\\?|&)' + key + '=([^&]*)').exec(q || '');
    return m && m[1] ? decodeURIComponent(m[1]) : '';
  }

  global.LhcVideo = {
    play: play,
    settle: settle,
    fitStage: fitStage,
    isPlaying: function () { return !!playing; },
    isReady: function () { return !!booted; },
    timing: {
      spinMs: SPIN_MS,
      ballGapMs: BALL_GAP_MS,
      ballRevealMs: BALL_REVEAL_MS,
      holdMs: HOLD_MS,
      totalMs: totalMs(SPIN_MS, BALL_GAP_MS, HOLD_MS),
    },
  };

  global.addEventListener('message', function (ev) {
    var data = ev && ev.data;
    if (!data || data.source !== 'lhc-video') return;
    if (data.action === 'play') {
      play(data.order, {
        spinMs: data.spinMs,
        ballGapMs: data.ballGapMs,
        ballRevealMs: data.ballRevealMs,
        holdMs: data.holdMs,
        onDone: function (ok) {
          try {
            ev.source && ev.source.postMessage(
              { source: 'lhc-video', action: 'done', ok: !!ok }, location.origin);
          } catch (e) { /* ignore */ }
        },
      });
    } else if (data.action === 'settle') {
      settle(data.order);
    }
  });

  function boot() {
    fitStage();
    global.addEventListener('resize', fitStage);
    global.addEventListener('orientationchange', fitStage);

    var q = global.location && global.location.search || '';
    var order = qParam(q, 'order');
    var settleNow = /(?:\?|&)settle=1(?:&|$)/.test(q);

    var preloadList = [
      IMG_IDLE,
      'img/empt.png',
      'img/bj222.png',
      'img/222.png',
      GIF_STATUS,
      GIF_EACH,
    ];
    for (var bi = 1; bi <= 49; bi++) {
      preloadList.push(ballSrc(bi));
    }
    preload(preloadList, function () {
      document.body.classList.add('is-ready');
      fitStage();

      /*
       * 关键：父页曾在 LhcVideo 一出现就 play，随后这里 idle+clearBalls
       * 会掐死搅珠 GIF，并清掉第 1 球（后几球定时器仍在 → 只剩 2–7）。
       * 顺序：先消化排队 play，再 readyPing；等父页 play 时不要 clearBalls。
       */
      var queued = pendingPlay;
      pendingPlay = null;
      booted = true;

      if (queued) {
        play(queued.order, queued.opts || {});
      } else if (playing) {
        /* 已在播 */
      } else if (order && settleNow) {
        settle(order);
      } else if (order && /(?:\?|&)autoplay=1(?:&|$)/.test(q)) {
        play(order, {});
      } else {
        setStageMode('idle');
        /* HTML 7 槽已是空的；有 order 时留给父页 play，禁止再 clear */
      }
      setTimeout(fitStage, 40);
      readyPing();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
