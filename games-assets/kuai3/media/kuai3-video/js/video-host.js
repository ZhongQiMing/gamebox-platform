/**
 * 1分快3开奖动画宿主控制
 * 严格对齐正版 k3v：
 *   startGame 摇骰 → stopGame 交错出号(0/800/1600ms) → 约 2s 后再回倒计时脸
 * 父页：window.K3Video / postMessage(source: kuai3-video)
 *
 * 直播节奏：卡出现 → 倒计时 3s → 摇骰 5s → 交错出号 → 收尾
 */
(function (global) {
  'use strict';

  var STAGE_W = 1125;
  var STAGE_H = 780;
  var DEFAULT_COUNTDOWN_MS = 3000;
  /** 正版 tryPlay：摇约 5s 再 stopGame */
  var DEFAULT_MID_MS = 5000;
  /** 正版 stopGame：第 1/2/3 骰分别在 0 / 800 / 1600ms 落地 */
  var STOP_LAND_MS = 1600;
  /** 正版 stopVideo：stopGame 后等 2s 再切回倒计时（盖住交错出号） */
  var AFTER_MS = 2000;

  var playTimers = [];
  var countdownTimer = null;
  var playing = false;

  function jq() {
    return global.jQuery || global.$;
  }

  function clearPlayTimers() {
    for (var i = 0; i < playTimers.length; i++) clearTimeout(playTimers[i]);
    playTimers = [];
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function numsOf(order) {
    if (Array.isArray(order)) {
      return order.map(function (n) { return parseInt(n, 10); }).filter(function (n) {
        return n >= 1 && n <= 6;
      });
    }
    return String(order || '')
      .split(/[,\s]+/)
      .map(function (s) { return parseInt(s, 10); })
      .filter(function (n) { return n >= 1 && n <= 6; });
  }

  function ensureOpen() {
    try { global.ifopen = true; } catch (e) { /* ignore */ }
  }

  function issueShort(issue) {
    var s = String(issue || '').replace(/\D/g, '');
    if (!s) return '0000';
    return ('0000' + s).slice(-4);
  }

  function issueNext(issue) {
    var s = String(issue || '').replace(/\D/g, '');
    if (!s) return '';
    if (s.length >= 10) {
      var head = s.slice(0, -6);
      var seq = parseInt(s.slice(-6), 10) + 1;
      if (!isFinite(seq) || seq < 1) seq = 1;
      var pad = String(seq);
      while (pad.length < 6) pad = '0' + pad;
      return head + pad;
    }
    try {
      return String(BigInt(s) + 1n);
    } catch (e) {
      return s;
    }
  }

  function fmtBjHms(ms) {
    var t = Number(ms);
    if (!isFinite(t) || t <= 0) t = Date.now();
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(t));
    } catch (e) {
      var d = new Date(t);
      var h = d.getHours();
      var m = d.getMinutes();
      var s = d.getSeconds();
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
  }

  function setMuted(muted) {
    ensureOpen();
    try {
      /* 顶栏声音按钮已去掉；仍按 mute 控制 iframe 内音效 */
      var btn = document.getElementById('spanbtn');
      if (btn) btn.className = muted ? 'sounds2' : 'sounds';
      if (muted) {
        if (global.k3v && k3v.sound) k3v.sound.stop('');
      } else {
        if (global.k3v && k3v.sound) k3v.sound.play('all');
      }
    } catch (e) { /* ignore */ }
  }

  function showCountdownFace() {
    var $ = jq();
    if (!$) return;
    $('#timetitle').text('倒计时');
    $('#hourtxt').show();
    $('#opening').hide();
    $('.linelist').find('li').removeClass('redli');
  }

  function showOpeningFace(title) {
    var $ = jq();
    if (!$) return;
    $('#timetitle').text(title || '正在开奖');
    $('#hourtxt').hide();
    $('#opening').show();
    $('.linelist').find('li').addClass('redli');
  }

  function writeHeader(opts) {
    opts = opts || {};
    var $ = jq();
    if (!$) return;
    var issue = String(opts.issue || '').trim();
    var next = String(opts.nextIssue || '').trim() || (issue ? issueNext(issue) : '');
    var drawAt = opts.drawAt != null ? Number(opts.drawAt) : NaN;
    var drawTime = opts.drawTime || (isFinite(drawAt) ? fmtBjHms(drawAt) : fmtBjHms(Date.now()));

    if (issue) $('.nowDraw').text(issueShort(issue));
    if (next) $('#drawIssue').text(next);
    $('#drawTime').text(drawTime);

    var nums = numsOf(opts.order || opts.nums);
    if (nums.length === 3) {
      var sum = nums[0] + nums[1] + nums[2];
      $('#num1').text(nums[0]).removeClass('is-ph');
      $('#num2').text(nums[1]).removeClass('is-ph');
      $('#num3').text(nums[2]).removeClass('is-ph');
      $('#sumNum').text(sum).removeClass('is-ph');
      $('#sumBigSmall').text(sum <= 10 ? '小' : '大').removeClass('is-ph');
      if (next) $('#drawIssue').text(next);
      $('#drawTime').text(drawTime);
      if (issue) $('.nowDraw').text(issueShort(issue));
    } else {
      /* 未开奖：占位横杠，配合 .is-ph 垂直居中，避免「-」基线偏低 */
      $('#num1,#num2,#num3,#sumNum,#sumBigSmall').text('-').addClass('is-ph');
    }
  }

  function hideTryModule() {
    try {
      var el = document.querySelector('.kaimodule');
      if (el) el.style.display = 'none';
    } catch (e) { /* ignore */ }
  }

  function setHourText(totalSec) {
    var s = Math.max(0, Math.floor(totalSec));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    var txt =
      (h < 10 ? '0' : '') + h + ':' +
      (m < 10 ? '0' : '') + m + ':' +
      (r < 10 ? '0' : '') + r;
    var el = document.getElementById('hourtxt');
    if (el) el.textContent = txt;
    var list = document.querySelectorAll('.linelist li');
    for (var i = 0; i < list.length; i++) {
      if (s > 0 && s <= 10 && i >= s) list[i].classList.add('redli');
      else if (s <= 0) list[i].classList.add('redli');
      else list[i].classList.remove('redli');
    }
  }

  /**
   * 关闭正版 bressBG 背景呼吸：会把 bj 图 opacity 打到 0.1，
   * 黑底透出，结果卡下半截会「黑一下」。
   */
  function stopBressBG() {
    try {
      if (global.animateId && animateId.bressBG) {
        clearInterval(animateId.bressBG);
        try { delete animateId.bressBG; } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    try {
      var $ = jq();
      if ($) $('.bodybg').find('img').stop(true, true).css('opacity', 1);
      else {
        var img = document.querySelector('.bodybg img');
        if (img) img.style.opacity = '1';
      }
    } catch (e2) { /* ignore */ }
  }

  /** 清空盅内骰面，避免上一期结果残留闪一下 */
  function clearDiceFaces() {
    var $ = jq();
    if (!$) return;
    try {
      if (global.animateId) {
        Object.keys(animateId).forEach(function (k) {
          if (k === 'bressBG') return;
          try { clearInterval(animateId[k]); } catch (e) { /* ignore */ }
          try { delete animateId[k]; } catch (e2) { /* ignore */ }
        });
      }
    } catch (e) { /* ignore */ }
    $('#code').find('li').attr('class', '');
  }

  function runFixedCountdown(sec, onZero) {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    var left = Math.max(0, Math.ceil(sec));
    showCountdownFace();
    setHourText(left);
    if (left <= 0) {
      if (typeof onZero === 'function') onZero();
      return;
    }
    countdownTimer = setInterval(function () {
      left -= 1;
      setHourText(Math.max(0, left));
      if (left <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        if (typeof onZero === 'function') onZero();
      }
    }, 1000);
  }

  function startDraw(opts) {
    opts = opts || {};
    ensureOpen();
    if (opts.muted != null) setMuted(!!opts.muted);
    if (!global.k3v || !k3v.startGame) return false;
    clearDiceFaces();
    showOpeningFace('正在开奖');
    try { global.ifpaused = 'audioidR'; } catch (e) { /* ignore */ }
    if (!opts.muted && k3v.sound) k3v.sound.play('audioidR');
    k3v.startGame(true);
    /* startGame 内部也会 bressBG(10)，立刻停掉避免下半截闪黑 */
    stopBressBG();
    return true;
  }

  /**
   * 出号：先 stopGame（0/800/1600 交错落地），
   * 顶栏等最后一颗落地后再写结果；AFTER_MS 后再切回倒计时脸。
   * afterMs<=0：历史卡瞬时落定，立刻写号。
   */
  function settle(order, opts) {
    opts = opts || {};
    ensureOpen();
    if (opts.muted != null) setMuted(!!opts.muted);
    var nums = numsOf(order);
    if (nums.length !== 3 || !global.k3v) return false;
    var issue = String(opts.issue || '').trim();
    var next = String(opts.nextIssue || '').trim() || (issue ? issueNext(issue) : '');
    var drawAt = opts.drawAt != null ? Number(opts.drawAt) : NaN;
    var drawTime = opts.drawTime || (isFinite(drawAt) ? fmtBjHms(drawAt) : fmtBjHms(Date.now()));
    var afterMs = opts.afterMs != null ? Number(opts.afterMs) : AFTER_MS;
    if (!(afterMs >= 0)) afterMs = AFTER_MS;
    var headerDelay = afterMs <= 0 ? 0 : STOP_LAND_MS;

    try {
      /* 保持「正在开奖」脸，等骰子交错落地 */
      showOpeningFace('正在开奖');
      if (k3v.stopGame) k3v.stopGame(nums);

      var revealHeader = function () {
        writeHeader({
          issue: issue,
          nextIssue: next,
          drawTime: drawTime,
          order: nums,
        });
        /* 最后一骰落地写号：通知父页刷历史（勿等 after 收尾） */
        if (typeof opts.onNumbers === 'function') {
          try { opts.onNumbers(true); } catch (eNum) { /* ignore */ }
        }
      };
      if (headerDelay <= 0) revealHeader();
      else playTimers.push(setTimeout(revealHeader, headerDelay));

      playTimers.push(setTimeout(function () {
        if (opts.muted && k3v.sound) k3v.sound.stop('');
        showCountdownFace();
        setHourText(0);
        $('.linelist').find('li').removeClass('redli');
        stopBressBG();
        try { global.tryflag = true; } catch (e) { /* ignore */ }
        playing = false;
        if (typeof opts.onDone === 'function') opts.onDone(true);
      }, afterMs));
      return true;
    } catch (e) {
      playing = false;
      return false;
    }
  }

  /**
   * 完整仪式：倒计时 → 摇骰 midMs → stopGame + 2s 收尾
   */
  function play(order, opts) {
    opts = opts || {};
    clearPlayTimers();
    var nums = numsOf(order);
    if (nums.length !== 3) {
      if (typeof opts.onDone === 'function') opts.onDone(false);
      return 0;
    }
    ensureOpen();
    hideTryModule();
    playing = true;
    if (opts.muted != null) setMuted(!!opts.muted);

    var issue = String(opts.issue || '').trim();
    var next = String(opts.nextIssue || '').trim() || (issue ? issueNext(issue) : '');
    var countdownMs = opts.countdownMs != null ? Number(opts.countdownMs) : DEFAULT_COUNTDOWN_MS;
    if (!(countdownMs >= 0)) countdownMs = DEFAULT_COUNTDOWN_MS;
    var mid = opts.midMs != null ? Number(opts.midMs) : DEFAULT_MID_MS;
    if (!(mid >= 0)) mid = DEFAULT_MID_MS;
    var afterMs = opts.afterMs != null ? Number(opts.afterMs) : AFTER_MS;
    if (!(afterMs >= 0)) afterMs = AFTER_MS;

    /* 开摇前只写期号/时间，不写开奖号，避免提前露号 */
    writeHeader({
      issue: issue,
      nextIssue: next,
      drawAt: opts.drawAt,
      drawTime: opts.drawTime,
    });
    clearDiceFaces();

    var total = countdownMs + mid + afterMs;

    runFixedCountdown(Math.ceil(countdownMs / 1000), function () {
      startDraw(opts);
      playTimers.push(setTimeout(function () {
        settle(nums, {
          issue: issue,
          nextIssue: next,
          drawAt: opts.drawAt,
          drawTime: opts.drawTime,
          muted: opts.muted,
          afterMs: afterMs,
          onNumbers: opts.onNumbers,
          onDone: opts.onDone,
        });
      }, mid));
    });

    return total;
  }

  function tryPlay() {
    ensureOpen();
    if (global.k3v && k3v.tryPlay) {
      k3v.tryPlay();
      return true;
    }
    return false;
  }

  function fitStage() {
    try {
      var content = document.querySelector('#videobox .content');
      if (!content) return;
      var w = global.innerWidth || document.documentElement.clientWidth || STAGE_W;
      var h = global.innerHeight || document.documentElement.clientHeight || STAGE_H;
      var s = Math.min(w / STAGE_W, h / STAGE_H);
      if (!(s > 0) || !isFinite(s)) s = 0.782;
      content.style.transform = 'scale(' + s + ')';
      content.style.transformOrigin = 'left top';
      content.style.margin = '0';
      var box = document.getElementById('videobox');
      if (box) {
        box.style.width = Math.round(STAGE_W * s) + 'px';
        box.style.height = Math.round(STAGE_H * s) + 'px';
        box.style.overflow = 'hidden';
      }
      document.documentElement.style.background = '#000';
      document.body.style.margin = '0';
      document.body.style.background = '#000';
      document.body.style.overflow = 'hidden';
    } catch (e) { /* ignore */ }
  }

  function readyPing() {
    try {
      if (global.K3Video) global.K3Video.__ready = true;
      if (window.parent && window.parent !== window) {
        parent.postMessage({ source: 'kuai3-video', action: 'ready' }, location.origin);
      }
    } catch (e) { /* ignore */ }
  }

  function qParam(q, key) {
    var m = new RegExp('(?:\\?|&)' + key + '=([^&]*)').exec(q || '');
    return m && m[1] ? decodeURIComponent(m[1]) : '';
  }

  global.K3Video = {
    ensureOpen: ensureOpen,
    setMuted: setMuted,
    settle: settle,
    startDraw: startDraw,
    play: play,
    tryPlay: tryPlay,
    writeHeader: writeHeader,
    issueShort: issueShort,
    issueNext: issueNext,
    fitStage: fitStage,
    isPlaying: function () { return !!playing; },
    /** 父页须等 embed boot 置 true 后再 play */
    __ready: false,
  };

  global.addEventListener('message', function (ev) {
    var data = ev && ev.data;
    if (!data || data.source !== 'kuai3-video') return;
    if (data.action === 'play') {
      play(data.order, {
        issue: data.issue,
        nextIssue: data.nextIssue,
        drawAt: data.drawAt,
        drawTime: data.drawTime,
        countdownMs: data.countdownMs,
        midMs: data.midMs,
        afterMs: data.afterMs,
        muted: data.muted,
        onNumbers: function () {
          try {
            ev.source && ev.source.postMessage(
              { source: 'kuai3-video', action: 'numbers', ok: true, issue: data.issue || '' }, location.origin);
          } catch (e0) { /* ignore */ }
        },
        onDone: function (ok) {
          try {
            ev.source && ev.source.postMessage(
              { source: 'kuai3-video', action: 'done', ok: !!ok, issue: data.issue || '' }, location.origin);
          } catch (e) { /* ignore */ }
        },
      });
    } else if (data.action === 'settle') {
      settle(data.order, {
        issue: data.issue,
        nextIssue: data.nextIssue,
        drawAt: data.drawAt,
        drawTime: data.drawTime,
        muted: data.muted,
        afterMs: data.afterMs != null ? data.afterMs : 0,
      });
    } else if (data.action === 'startDraw') {
      startDraw({ muted: data.muted });
    } else if (data.action === 'mute') {
      setMuted(true);
    } else if (data.action === 'unmute') {
      setMuted(false);
    } else if (data.action === 'header') {
      writeHeader(data);
    }
  });

  /** 等底图 bj.jpg 解码完再揭开，避免下半截先黑一下 */
  function whenBgReady(cb) {
    var finished = false;
    var finish = function () {
      if (finished) return;
      finished = true;
      if (typeof cb === 'function') cb();
    };
    try {
      var img = document.querySelector('.bodybg img');
      if (!img) {
        finish();
        return;
      }
      if (img.complete && img.naturalWidth > 0) {
        finish();
        return;
      }
      img.addEventListener('load', finish);
      img.addEventListener('error', finish);
      setTimeout(finish, 2500);
    } catch (e) {
      finish();
    }
  }

  function hideLoading() {
    try {
      var $ = jq();
      if ($) $('.loading').stop(true, true).hide();
      else {
        var ld = document.querySelector('.loading');
        if (ld) ld.style.display = 'none';
      }
    } catch (e) { /* ignore */ }
    try { document.body.classList.add('k3-bg-ready'); } catch (e2) { /* ignore */ }
  }

  function boot() {
    ensureOpen();
    hideTryModule();
    fitStage();
    if (global.addEventListener) {
      global.addEventListener('resize', fitStage);
      global.addEventListener('orientationchange', fitStage);
    }
    var q = global.location && global.location.search || '';
    /* embed 续播：先藏 LOADING 文字，背景就绪后再加 k3-bg-ready */
    if (/(?:\?|&)embed=1(?:&|$)/.test(q) || /(?:\?|&)settle=1(?:&|$)/.test(q)) {
      try {
        var $early = jq();
        if ($early) $early('.loading .loadtxt').hide();
        else {
          var txt = document.querySelector('.loading .loadtxt');
          if (txt) txt.style.display = 'none';
        }
      } catch (eEarly) { /* ignore */ }
    }
    var muted = /(?:\?|&)mute=1(?:&|$)/.test(q);
    if (muted) setMuted(true);

    var issue = qParam(q, 'issue');
    var nextIssue = qParam(q, 'nextIssue');
    var order = qParam(q, 'order');
    var drawAt = Number(qParam(q, 'drawAt'));
    var drawTime = qParam(q, 'drawTime');
    var settleNow = /(?:\?|&)settle=1(?:&|$)/.test(q);

    writeHeader({
      issue: issue,
      nextIssue: nextIssue,
      drawAt: isFinite(drawAt) ? drawAt : undefined,
      drawTime: drawTime || undefined,
    });
    stopBressBG();

    if (order && settleNow) {
      /* 历史卡：直接落定，不播动画、不闪切 */
      clearDiceFaces();
      var nums = numsOf(order);
      if (nums.length === 3 && global.k3v && k3v.stopGame) {
        /* 同步落定：跳过交错延时 */
        var $lis = (jq() || { find: function () { return { eq: function () { return { attr: function () {} }; } }; } }).find
          ? jq()('#code').find('li')
          : null;
        if ($lis) {
          for (var i = 0; i < 3; i++) {
            try { clearInterval(animateId && animateId[i]); } catch (e) { /* ignore */ }
            $lis.eq(i).attr('class', 'k3v' + nums[i]);
          }
        }
        writeHeader({
          issue: issue,
          nextIssue: nextIssue,
          drawAt: isFinite(drawAt) ? drawAt : undefined,
          drawTime: drawTime || undefined,
          order: nums,
        });
      }
      showCountdownFace();
      setHourText(0);
    } else {
      clearDiceFaces();
      showCountdownFace();
      setHourText(Math.ceil(DEFAULT_COUNTDOWN_MS / 1000));
    }

    whenBgReady(function () {
      hideLoading();
      stopBressBG();
      fitStage();
      setTimeout(fitStage, 40);
      setTimeout(fitStage, 160);
      readyPing();
    });
  }

  if (global.jQuery) {
    global.jQuery(boot);
  } else {
    global.addEventListener('load', boot);
  }
})(typeof window !== 'undefined' ? window : this);
