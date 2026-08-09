/**
 * 幸运时时彩开奖动画宿主控制
 * 严格走正版 victor：animate.sscAnimate / animate.sscAnimateEnd / videoTools.showNUM
 * 父页通过 window.SscVideo / postMessage(source: ssc-video) 驱动。
 */
(function (global) {
  'use strict';

  function jq() {
    return global.jQuery || global.$;
  }

  function numsOf(order) {
    if (Array.isArray(order)) {
      return order.map(function (n) { return parseInt(n, 10); }).filter(function (n) {
        return n >= 0 && n <= 9;
      });
    }
    return String(order || '')
      .split(/[,\s]+/)
      .map(function (s) { return parseInt(s, 10); })
      .filter(function (n) { return n >= 0 && n <= 9; });
  }

  function metaFrom(nums, issue) {
    var sum = 0;
    for (var i = 0; i < nums.length; i++) sum += nums[i];
    var wan = nums[0];
    var ge = nums[4];
    var lh = wan > ge ? '龙' : wan < ge ? '虎' : '和';
    return {
      preDrawCode: nums.slice(),
      id: '#numBig',
      counttime: 75,
      preDrawIssue: String(issue || ''),
      drawTime: '',
      sumNum: String(sum),
      sumSingleDouble: sum % 2 ? '单' : '双',
      sumBigSmall: sum >= 23 ? '大' : '小',
      dragonTiger: lh,
    };
  }

  function ensureOpen() {
    try { global.ifopen = true; } catch (e) { /* ignore */ }
  }

  /** 嵌入/续播：立刻藏掉 LOADING，避免刷新后先闪英文 loading */
  function hideLoading() {
    try {
      var $ = jq();
      if ($) $('.loading').stop(true, true).hide();
      else {
        var ld = document.querySelector('.loading');
        if (ld) ld.style.display = 'none';
      }
    } catch (e) { /* ignore */ }
  }

  /** 滚号控制器（须在 settle 之前声明） */
  var rollCtrl = {
    sel: '#numBig',
    timer: 0,
    gapMs: 90,
    running: false,
  };
  /** play 世代：重叠 play 时旧 mid/after 定时器作废 */
  var playGen = 0;

  function setMuted(muted) {
    try {
      var btn = document.getElementById('soundbtn');
      if (!btn) return;
      if (muted) btn.classList.add('closesoundbtn');
      else btn.classList.remove('closesoundbtn');
      if (muted) {
        var a = document.getElementById('bgsound');
        if (a) {
          a.pause();
          a.setAttribute('src', '');
        }
      }
    } catch (e) { /* ignore */ }
  }

  /** 清掉模板里的占位号（原 HTML 写死 21096 / 16双小虎），避免刷新先闪假结果 */
  function scrubPlaceholderDigits() {
    var $ = jq();
    try {
      var scramble = function (sel) {
        var nodes = document.querySelectorAll(sel);
        for (var i = 0; i < nodes.length; i++) {
          var n = Math.floor(Math.random() * 10);
          nodes[i].className = 'num' + n;
          nodes[i].textContent = '';
        }
      };
      scramble('#numBig .box > span');
      scramble('#litNum .box > span');
      if ($) {
        $('#sumNum').text('—');
        $('#sumSingleDouble').text('—');
        $('#sumBigSmall').text('—');
        $('#dragonTiger').text('—');
      } else {
        ['sumNum', 'sumSingleDouble', 'sumBigSmall', 'dragonTiger'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.textContent = '—';
        });
      }
    } catch (e) { /* ignore */ }
  }

  /**
   * 同步盖牌：上下行翻到 afterbg（正版滚号中状态）
   * 不走 xz3D 的 225ms 动画，避免进房闪三行结果。
   */
  function coverFacesSync() {
    var $ = jq();
    scrubPlaceholderDigits();
    if (!$ || typeof videoTools === 'undefined') return;
    try {
      $('.codeboxl .perspectiveView').each(function () {
        var $box = $(this);
        $box.children('.flip').eq(0)
          .show().css('display', 'inline-block')
          .addClass('in').removeClass('out');
        $box.children('.flip').eq(1)
          .hide().css('display', 'none')
          .addClass('out').removeClass('in');
      });
      $('.oping').show();
      $('.djs').hide();
    } catch (e) { /* ignore */ }
  }

  /** 待机/历史/落定：滚号中走平滑收尾，否则走正版 sscAnimateEnd */
  function settle(order, opts) {
    opts = opts || {};
    ensureOpen();
    if (opts.muted != null) setMuted(!!opts.muted);
    var nums = numsOf(order);
    if (nums.length !== 5) return false;
    var payload = metaFrom(nums, opts.issue);
    if (typeof opts.counttime === 'number') payload.counttime = opts.counttime;
    if (opts.drawTime) payload.drawTime = opts.drawTime;
    try {
      if (rollCtrl.running || rollCtrl.timer) {
        settleSmooth(nums, opts);
      } else if (typeof animate !== 'undefined' && animate.sscAnimateEnd) {
        animate.sscAnimateEnd(nums, '#numBig', payload.counttime, true);
      }
      if (typeof videoTools !== 'undefined' && videoTools.inseartData) {
        videoTools.inseartData(payload);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function stopRollTimer() {
    if (rollCtrl.timer) {
      clearTimeout(rollCtrl.timer);
      rollCtrl.timer = 0;
    }
    rollCtrl.running = false;
    try {
      if (global.animateID) {
        clearInterval(global.animateID[rollCtrl.sel]);
        clearTimeout(global.animateID[rollCtrl.sel]);
        global.animateID[rollCtrl.sel] = 0;
      }
    } catch (e) { /* ignore */ }
  }

  function rollTickOnce($, sel) {
    $(sel).find('.box').each(function () {
      var $span = $(this).children('span').first();
      if (!$span.length) return;
      var n = videoTools.excutenum();
      var shake = rollCtrl.gapMs >= 160 ? 55 : 75;
      var sizeTo = rollCtrl.gapMs >= 160 ? '82%' : '72%';
      var dx = rollCtrl.gapMs >= 160 ? '22px' : '36px';
      var dy = rollCtrl.gapMs >= 160 ? '-12px' : '-20px';
      $span
        .stop(true, true)
        .text(String(n))
        .removeClass()
        .addClass('num' + n)
        .css({
          backgroundPositionY: '0px',
          backgroundPositionX: '0px',
          backgroundSize: '100%',
        })
        .animate(
          {
            backgroundPositionY: dy,
            backgroundPositionX: dx,
            backgroundSize: sizeTo,
          },
          shake
        );
    });
  }

  function scheduleRollTick($, sel) {
    if (!rollCtrl.running) return;
    rollCtrl.timer = setTimeout(function () {
      rollCtrl.timer = 0;
      if (!rollCtrl.running) return;
      rollTickOnce($, sel);
      scheduleRollTick($, sel);
    }, rollCtrl.gapMs);
    try {
      if (!global.animateID) global.animateID = [];
      global.animateID[sel] = rollCtrl.timer;
    } catch (e) { /* ignore */ }
  }

  /**
   * 修补正版滚号：短促抖动 + 可减速；收尾不再硬停在偏移态。
   */
  function patchRollAnimate() {
    if (typeof animate === 'undefined' || !animate.sscAnimate || animate.sscAnimate.__gbPatched) {
      return;
    }
    var $ = jq();
    if (!$ || typeof videoTools === 'undefined') return;

    animate.sscAnimate = function (sel) {
      ensureOpen();
      stopRollTimer();
      rollCtrl.sel = sel || '#numBig';
      rollCtrl.gapMs = 90;
      rollCtrl.running = true;

      try {
        var muted = false;
        var btn = document.getElementById('soundbtn');
        if (btn && btn.classList.contains('closesoundbtn')) muted = true;
        if (!muted && videoTools.ifsund && videoTools.ifsund() && global.ifopen) {
          $('#bgsound').attr('src', 'sound/opening.mp3');
          if (videoTools.sounds && videoTools.sounds.soundsT) {
            videoTools.sounds.soundsT.play('bgsound');
          }
        }
      } catch (e1) { /* ignore */ }

      try {
        var pv = $('.codeboxl .perspectiveView');
        pv.each(function (i) {
          videoTools.xz3D(pv[i], false);
        });
        $('.oping').show();
        $('.djs').hide();
      } catch (e2) { /* ignore */ }

      rollTickOnce($, rollCtrl.sel);
      scheduleRollTick($, rollCtrl.sel);
    };
    animate.sscAnimate.__gbPatched = true;
  }

  /** 末段减速：间隔拉长、抖动变小，像滚轮慢下来 */
  function decelerateRoll() {
    if (!rollCtrl.running) return;
    rollCtrl.gapMs = 150;
    setTimeout(function () {
      if (rollCtrl.running) rollCtrl.gapMs = 200;
    }, 280);
    setTimeout(function () {
      if (rollCtrl.running) rollCtrl.gapMs = 260;
    }, 520);
  }

  /**
   * 平滑落定：先停滚并回到正位，再轻弹 + 按列翻上下行（比正版硬切更自然）
   */
  function settleSmooth(nums, opts) {
    opts = opts || {};
    var $ = jq();
    if (!$ || nums.length !== 5) return false;

    stopRollTimer();
    try {
      if (opts.muted != null) setMuted(!!opts.muted);
      else {
        var btn = document.getElementById('soundbtn');
        if (btn && btn.classList.contains('closesoundbtn')) setMuted(true);
      }
    } catch (e0) { /* ignore */ }

    try {
      var muted = false;
      var btn2 = document.getElementById('soundbtn');
      if (btn2 && btn2.classList.contains('closesoundbtn')) muted = true;
      if (!muted && videoTools.ifsund && videoTools.ifsund() && global.ifopen) {
        $('#bgsound').attr('src', 'sound/over.mp3');
        if (videoTools.sounds && videoTools.sounds.soundsT) {
          videoTools.sounds.soundsT.play('bgsound');
        }
      }
    } catch (e1) { /* ignore */ }

    $('.oping').hide();
    $('.djs').show();

    var $spans = $(rollCtrl.sel).find('.box').map(function () {
      return $(this).children('span').get(0);
    }).get();
    if (!$spans.length) $spans = $(rollCtrl.sel + ' span').get();

    $($spans).each(function (i) {
      var n = nums[i];
      if (n == null) return;
      $(this)
        .stop(true, false)
        .text('')
        .removeClass()
        .addClass('num' + n);
    });

    /* 先从抖动态收回正位 */
    var pending = $spans.length;
    var landed = false;
    function afterLand() {
      if (landed) return;
      landed = true;
      revealColumns(nums);
      /* 号码真正落到画面后再通知父页（比 settle 返回瞬间更准） */
      if (typeof opts.onNumbers === 'function') {
        try { opts.onNumbers(true); } catch (eNum) { /* ignore */ }
      }
    }

    if (!pending) {
      afterLand();
      return true;
    }

    $($spans).each(function () {
      $(this).animate(
        {
          backgroundPositionY: '0px',
          backgroundPositionX: '0px',
          backgroundSize: '100%',
        },
        200,
        function () {
          pending -= 1;
          if (pending <= 0) afterLand();
        }
      );
    });
    /* 兜底，防止 animate 回调丢失 */
    setTimeout(afterLand, 320);
    return true;
  }

  /** 落定后轻弹 + 按列翻开大小/单双（节奏对齐正版 150ms 间隔） */
  function revealColumns(nums) {
    var $ = jq();
    if (!$ || typeof videoTools === 'undefined') return;

    var $tl = $('.tl .perspectiveView');
    var $bl = $('.bl .perspectiveView');
    var spans = [];
    $(rollCtrl.sel).find('.box').each(function () {
      spans.push($(this).children('span').first());
    });

    /* 同步上下行结果 class（正版 showNUM 同款） */
    $('.tl').find('.box').each(function (o) {
      var $face = $(this).find('span').eq(1);
      var cls = $face.attr('class') || '';
      if (nums[o] >= 5) {
        if (cls.indexOf('bigbg') === -1) cls = cls.replace('smallbg', 'bigbg');
      } else if (cls.indexOf('smallbg') === -1) {
        cls = cls.replace('bigbg', 'smallbg');
      }
      $face.attr('class', cls);
    });
    $('.bl').find('.box').each(function (o) {
      var $face = $(this).find('span').eq(1);
      var cls = $face.attr('class') || '';
      if (nums[o] % 2 === 0) {
        if (cls.indexOf('doublebg') === -1) cls = cls.replace('singlebg', 'doublebg');
      } else if (cls.indexOf('singlebg') === -1) {
        cls = cls.replace('doublebg', 'singlebg');
      }
      $face.attr('class', cls);
    });

    function softPop($el) {
      if (!$el || !$el.length) return;
      $el.stop(true, true).css({
        backgroundPositionY: '0px',
        backgroundPositionX: '0px',
        backgroundSize: '100%',
      }).animate(
        { backgroundSize: '118%' },
        140,
        function () {
          $el.animate(
            {
              backgroundPositionY: '0px',
              backgroundPositionX: '0px',
              backgroundSize: '100%',
            },
            160
          );
        }
      );
    }

    for (var i = 0; i < 5; i++) {
      (function (idx, delay) {
        setTimeout(function () {
          softPop(spans[idx]);
          try {
            if ($tl[idx]) videoTools.xz3D($tl[idx], true);
            if ($bl[idx]) videoTools.xz3D($bl[idx], true);
          } catch (e) { /* ignore */ }
        }, delay);
      })(i, 80 + i * 150);
    }
  }

  /** 开奖中：滚号 + 上下行盖牌（iframe 静音时由父页播 opening） */
  function startDraw(opts) {
    opts = opts || {};
    ensureOpen();
    hideLoading();
    if (opts.muted != null) setMuted(!!opts.muted);
    patchRollAnimate();
    try {
      if (typeof animate !== 'undefined' && animate.sscAnimate) {
        animate.sscAnimate('#numBig');
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  /**
   * 完整仪式：滚号 → 末段减速 → 平滑落定 → 轻弹 + 按列翻面
   */
  function play(order, opts) {
    opts = opts || {};
    var nums = numsOf(order);
    if (nums.length !== 5) {
      if (typeof opts.onDone === 'function') opts.onDone(false);
      return 0;
    }
    ensureOpen();
    hideLoading();
    if (opts.muted != null) setMuted(!!opts.muted);
    var mid = opts.midMs != null ? Number(opts.midMs) : 6000;
    if (!(mid >= 0)) mid = 6000;
    var gen = ++playGen;
    startDraw(opts);

    var slowAt = Math.max(0, mid - 780);
    setTimeout(function () {
      if (gen !== playGen) return;
      decelerateRoll();
    }, slowAt);

    var after = opts.afterMs != null ? Number(opts.afterMs) : 3400;
    if (!(after >= 0)) after = 3400;
    setTimeout(function () {
      if (gen !== playGen) return;
      /* 平滑落定：onNumbers 在 afterLand；硬落定/无滚号：这里补一次 */
      var wasRolling = !!(rollCtrl.running || rollCtrl.timer);
      var ok = settle(nums, opts);
      if ((!wasRolling || !ok) && typeof opts.onNumbers === 'function') {
        try { opts.onNumbers(true); } catch (eNum) { /* ignore */ }
      }
      if (typeof opts.onDone === 'function') {
        setTimeout(function () {
          if (gen !== playGen) return;
          opts.onDone(true);
        }, after);
      }
    }, mid);
    return mid + after;
  }

  function readyPing() {
    try {
      if (window.parent && window.parent !== window) {
        parent.postMessage({ source: 'ssc-video', action: 'ready' }, location.origin);
      }
    } catch (e) { /* ignore */ }
  }

  global.SscVideo = {
    ensureOpen: ensureOpen,
    setMuted: setMuted,
    coverFaces: coverFacesSync,
    settle: settle,
    startDraw: startDraw,
    play: play,
    /** 父页须等 boot 完成再 play，否则滚号 DOM/补丁未就绪会「没动画」 */
    __ready: false,
  };

  global.addEventListener('message', function (ev) {
    var data = ev && ev.data;
    if (!data || data.source !== 'ssc-video') return;
    if (data.action === 'play') {
      play(data.order, {
        issue: data.issue,
        midMs: data.midMs,
        afterMs: data.afterMs,
        muted: data.muted,
        onNumbers: function () {
          try {
            ev.source && ev.source.postMessage(
              { source: 'ssc-video', action: 'numbers', ok: true, issue: data.issue || '' }, location.origin);
          } catch (e0) { /* ignore */ }
        },
        onDone: function (ok) {
          try {
            ev.source && ev.source.postMessage(
              { source: 'ssc-video', action: 'done', ok: !!ok, issue: data.issue || '' }, location.origin);
          } catch (e) { /* ignore */ }
        },
      });
    } else if (data.action === 'settle') {
      settle(data.order, { issue: data.issue, muted: data.muted });
    } else if (data.action === 'startDraw') {
      startDraw({ muted: data.muted });
    } else if (data.action === 'cover') {
      coverFacesSync();
    } else if (data.action === 'mute') {
      setMuted(true);
    } else if (data.action === 'unmute') {
      setMuted(false);
    }
  });

  function applyLogoFromQuery(q) {
    var m = /(?:\?|&)logo=([a-z0-9_-]+)/i.exec(q || '');
    var key = m && m[1] ? String(m[1]).toLowerCase() : '';
    var map = {
      kl: 'nameLogo_kl',
      yf: 'nameLogo_yf',
      xy: 'nameLogo_xy',
      kuaile: 'nameLogo_kl',
      yifen: 'nameLogo_yf',
      xingyun: 'nameLogo_xy',
    };
    var cls = map[key];
    if (!cls) return;
    var el = document.querySelector('.nameLogo');
    if (!el) return;
    el.className = 'nameLogo ' + cls;
  }

  /** 正版画布 880×586.67 → 按宿主视口等比缩放（摇号像素位移才能正确） */
  var STAGE_W = 880;
  var STAGE_H = 586.6667;

  function fitStage() {
    try {
      var inner = document.querySelector('.cqsscAnimate .stage-inner');
      if (!inner) return;
      var w = global.innerWidth || document.documentElement.clientWidth || STAGE_W;
      var h = global.innerHeight || document.documentElement.clientHeight || STAGE_H;
      /* 只缩小不放大，避免大屏把 200px 条带/翻面布局撑乱 */
      var s = Math.min(w / STAGE_W, h / STAGE_H, 1);
      if (!(s > 0) || !isFinite(s)) s = 1;
      inner.style.setProperty('--ssc-stage-scale', String(s));
    } catch (e) { /* ignore */ }
  }

  function boot() {
    ensureOpen();
    patchRollAnimate();
    fitStage();
    if (global.addEventListener) {
      global.addEventListener('resize', fitStage);
      global.addEventListener('orientationchange', fitStage);
    }
    var q = global.location && global.location.search || '';
    applyLogoFromQuery(q);
    var muted = /(?:\?|&)mute=1(?:&|$)/.test(q);
    if (muted) setMuted(true);
    var mo = /(?:\?|&)order=([^&]*)/.exec(q);
    var mi = /(?:\?|&)issue=([^&]*)/.exec(q);
    var settleNow = /(?:\?|&)settle=1(?:&|$)/.test(q);
    var embed = /(?:\?|&)embed=1(?:&|$)/.test(q);

    /* embed/settle：进页即藏 LOADING */
    if (embed || settleNow) hideLoading();

    if (mo && mo[1] && settleNow) {
      scrubPlaceholderDigits();
      settle(decodeURIComponent(mo[1]), {
        issue: mi && mi[1] ? decodeURIComponent(mi[1]) : '',
        muted: muted,
      });
    } else if (embed) {
      /* 直播卡：盖牌待命，开奖中由父页压黑幕，不在此自动开滚 */
      coverFacesSync();
    }
    setTimeout(fitStage, 0);
    setTimeout(fitStage, 120);
    try { global.SscVideo.__ready = true; } catch (eReady) { /* ignore */ }
    readyPing();
  }

  if (global.jQuery) {
    global.jQuery(boot);
  } else {
    global.addEventListener('load', boot);
  }
})(typeof window !== 'undefined' ? window : this);
