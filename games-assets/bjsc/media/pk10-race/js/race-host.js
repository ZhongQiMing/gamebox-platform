/**
 * 北京赛车房间嵌入控制 —— 对齐 s8kj168 PK10 官网节奏
 *
 * 官网（pk10_kai.js / config.js）：
 *  - 等待期：startcountdown(距下期秒数)，归零后 startanimation 自由竞速
 *  - 出结果：立刻 finishgame(preDrawCode)
 *  - 3s 后刷新头栏；10s 后 insertVideo 切回下一期倒计时
 *
 * 房间已有当期结果，模拟官网「竞速时段」：
 * 红绿灯最后 3 秒 → 绿灯后自由竞速（官网此时等接口出号，通常十余秒）→ finishgame
 * → 再按官网固定等 10s 才回调 onDone（勿压缩冲线/领奖台）。
 */
(function (global) {
  'use strict';

  /** 红绿灯最后 3 秒（官网 demo / 灯序 timer<=2/1/0） */
  var COUNTDOWN_SEC = 3;
  /**
   * 绿灯后自由竞速。
   * 官网：倒计时归零后 startanimation，直到接口出号才 finishgame（竞速时段，常见十余秒）。
   * 房间已有结果，用固定时长贴近该观感（约 5 个 3s 变道周期）。
   */
  var MID_RACE_MS = 15000;
  /** 官网 creatDataHead：finishgame 后 10000ms 才 insertVideo */
  var AFTER_FINISH_MS = 10000;
  /**
   * finishgame 内车子冲线 + 闪光约 3.2s（TweenMax 3s + flashlight.delay(3200)）。
   * onFinish 必须等这段结束，否则顶栏历史会早于画面冲线。
   */
  var FINISH_VISUAL_MS = 3300;

  var playTimer = null;
  var finishNotifyTimer = null;
  var doneTimer = null;

  function clearTimers() {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    if (finishNotifyTimer) {
      clearTimeout(finishNotifyTimer);
      finishNotifyTimer = null;
    }
    if (doneTimer) {
      clearTimeout(doneTimer);
      doneTimer = null;
    }
  }

  function normalizeOrder(order) {
    if (Array.isArray(order)) {
      return order
        .map(function (n) {
          return String(parseInt(n, 10));
        })
        .join(',');
    }
    return String(order || '')
      .split(/[,\s]+/)
      .map(function (s) {
        return String(parseInt(s, 10));
      })
      .filter(function (s) {
        return s && s !== 'NaN';
      })
      .join(',');
  }

  function totalDurationMs(opts) {
    opts = opts || {};
    var cd = opts.countdownSec != null ? Number(opts.countdownSec) : COUNTDOWN_SEC;
    var mid = opts.midRaceMs != null ? Number(opts.midRaceMs) : MID_RACE_MS;
    var after =
      opts.afterFinishMs != null ? Number(opts.afterFinishMs) : AFTER_FINISH_MS;
    return cd * 1000 + mid + after;
  }

  /** 静音播完整场（房间默认） */
  function muteAudio() {
    try {
      ifopen = false;
      var audio = document.getElementById('sound');
      if (audio) {
        audio.pause();
        audio.muted = true;
        audio.removeAttribute('autoplay');
      }
      var btn = document.getElementById('closeSound');
      if (btn) btn.classList.add('closesoundbtn');
    } catch (e) {
      /* ignore */
    }
  }

  /** 写入画面内「期数 : xxx」（对应 #currentdrawid） */
  function setIssue(issue) {
    var text = String(issue == null ? '' : issue).trim();
    if (!text) return;
    try {
      var el = document.getElementById('currentdrawid');
      if (el) el.textContent = text;
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * @param {string|number[]} order 名次，如 "2,10,1,4,6,8,5,9,7,3"
   * @param {{ issue?: string|number, countdownSec?: number, midRaceMs?: number, afterFinishMs?: number, onDone?: Function }} [opts]
   */
  function play(order, opts) {
    opts = opts || {};
    var result = normalizeOrder(order);
    if (!result || result.split(',').length !== 10) {
      if (typeof opts.onDone === 'function') opts.onDone(false);
      return 0;
    }
    clearTimers();
    muteAudio();
    if (opts.issue != null) setIssue(opts.issue);
    try {
      if (typeof waitfinish !== 'undefined') waitfinish = false;
    } catch (e0) { /* ignore */ }

    var cd = opts.countdownSec != null ? Number(opts.countdownSec) : COUNTDOWN_SEC;
    if (!(cd >= 0)) cd = COUNTDOWN_SEC;
    var mid = opts.midRaceMs != null ? Number(opts.midRaceMs) : MID_RACE_MS;
    if (!(mid >= 0)) mid = MID_RACE_MS;
    var after =
      opts.afterFinishMs != null ? Number(opts.afterFinishMs) : AFTER_FINISH_MS;
    if (!(after >= 0)) after = AFTER_FINISH_MS;

    var total = totalDurationMs({
      countdownSec: cd,
      midRaceMs: mid,
      afterFinishMs: after,
    });

    if (typeof startcountdown === 'function') {
      var started = startcountdown(cd);
      if (started === false) {
        try { waitfinish = false; } catch (e1) { /* ignore */ }
        startcountdown(cd);
      }
    }

    playTimer = setTimeout(function () {
      playTimer = null;
      if (typeof finishgame === 'function') {
        finishgame(result);
      }
      /* 等画面冲线/闪光后再通知父页，勿在 finishgame 调用瞬间刷历史 */
      var visualMs = opts.finishVisualMs != null ? Number(opts.finishVisualMs) : FINISH_VISUAL_MS;
      if (!(visualMs >= 0)) visualMs = FINISH_VISUAL_MS;
      finishNotifyTimer = setTimeout(function () {
        finishNotifyTimer = null;
        if (typeof opts.onFinish === 'function') {
          try { opts.onFinish(true); } catch (eF) { /* ignore */ }
        }
      }, visualMs);
    }, cd * 1000 + mid);

    if (typeof opts.onDone === 'function') {
      doneTimer = setTimeout(function () {
        doneTimer = null;
        opts.onDone(true);
      }, total);
    }
    return total;
  }

  /** 进房/历史：直接落到领奖台终态 */
  function settle(order, opts) {
    opts = opts || {};
    clearTimers();
    muteAudio();
    if (opts.issue != null) setIssue(opts.issue);
    var result = normalizeOrder(order);
    if (!result || result.split(',').length !== 10) return;
    try {
      if (typeof TweenLite !== 'undefined' && typeof winnerpage === 'function') {
        TweenLite.killDelayedCallsTo(winnerpage);
      }
      if (typeof stopanimation === 'function') stopanimation();
      waitfinish = false;
      try {
        if (typeof global.$ === 'function') {
          global.$('.trafficlight').css('display', 'none').stop(true, true);
          global.$('.countdownnum').css('display', 'none');
        }
      } catch (e0) { /* ignore */ }
      if (typeof showcurrentresult === 'function') showcurrentresult(result);
      if (typeof winnerpage === 'function') winnerpage(result);
    } catch (e) {
      /* ignore */
    }
  }

  function stop() {
    clearTimers();
    try {
      if (typeof stopanimation === 'function') stopanimation();
      waitfinish = false;
    } catch (e) {
      /* ignore */
    }
  }

  global.BjscPk10Race = {
    COUNTDOWN_SEC: COUNTDOWN_SEC,
    MID_RACE_MS: MID_RACE_MS,
    AFTER_FINISH_MS: AFTER_FINISH_MS,
    FINISH_VISUAL_MS: FINISH_VISUAL_MS,
    totalDurationMs: totalDurationMs,
    setIssue: setIssue,
    play: play,
    settle: settle,
    stop: stop,
    normalizeOrder: normalizeOrder,
    /** 父页须等 embed boot 置 true 后再 play */
    __ready: false,
  };

  /* URL ?issue= 进页即写入期数（settle 由 bootFromQuery / 父页调用） */
  try {
    var q0 = global.location && global.location.search;
    if (q0) {
      var mIss = /(?:\?|&)issue=([^&]*)/.exec(q0);
      if (mIss && mIss[1]) setIssue(decodeURIComponent(mIss[1]));
    }
  } catch (e) {
    /* ignore */
  }

  /* 父页 postMessage 控制（iframe 嵌入） */
  global.addEventListener('message', function (ev) {
    var data = ev && ev.data;
    if (!data || data.source !== 'bjsc-pk10-race') return;
    if (data.action === 'play') {
      play(data.order, {
        issue: data.issue,
        countdownSec: data.countdownSec,
        midRaceMs: data.midRaceMs,
        afterFinishMs: data.afterFinishMs,
        finishVisualMs: data.finishVisualMs,
        onFinish: function () {
          try {
            ev.source &&
              ev.source.postMessage(
                { source: 'bjsc-pk10-race', action: 'finish', ok: true, issue: data.issue || '' }, location.origin);
          } catch (e0) {
            /* ignore */
          }
        },
        onDone: function (ok) {
          try {
            ev.source &&
              ev.source.postMessage(
                { source: 'bjsc-pk10-race', action: 'done', ok: !!ok, issue: data.issue || '' }, location.origin);
          } catch (e) {
            /* ignore */
          }
        },
      });
    } else if (data.action === 'settle') {
      settle(data.order, { issue: data.issue });
    } else if (data.action === 'setIssue') {
      setIssue(data.issue);
    } else if (data.action === 'stop') {
      stop();
    }
  });
})(typeof window !== 'undefined' ? window : this);
