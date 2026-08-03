/**
 * 极速赛车房间嵌入控制 —— 对齐 s8kj168 PK10 官网节奏
 *
 * 官网（pk10_kai.js / config.js）：
 *  - 等待期：startcountdown(距下期秒数)，归零后 startanimation 自由竞速
 *  - 出结果：立刻 finishgame(preDrawCode)
 *  - 3s 后刷新头栏；10s 后 insertVideo 切回下一期倒计时
 *
 * 房间已有当期结果，模拟官网「竞速时段」：
 * 红绿灯最后 3 秒 → 绿灯后自由竞速 → finishgame → 领奖台后 onDone。
 * 默认与房间 60s 局对齐：中段 8s + 冲线领奖台 6s（可由父页 opts 覆盖）。
 */
(function (global) {
  'use strict';

  /** 红绿灯最后 3 秒（官网 demo / 灯序 timer<=2/1/0） */
  var COUNTDOWN_SEC = 3;
  /** 绿灯后自由竞速（房间默认 8s；父页 midRaceMs 可覆盖） */
  var MID_RACE_MS = 8000;
  /** finishgame 后领奖台停留（房间默认 6s；父页 afterFinishMs 可覆盖） */
  var AFTER_FINISH_MS = 6000;

  var playTimer = null;
  var doneTimer = null;

  function clearTimers() {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
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
      startcountdown(cd);
    }

    playTimer = setTimeout(function () {
      playTimer = null;
      if (typeof finishgame === 'function') {
        finishgame(result);
      }
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

  global.JsrPk10Race = {
    COUNTDOWN_SEC: COUNTDOWN_SEC,
    MID_RACE_MS: MID_RACE_MS,
    AFTER_FINISH_MS: AFTER_FINISH_MS,
    totalDurationMs: totalDurationMs,
    setIssue: setIssue,
    play: play,
    settle: settle,
    stop: stop,
    normalizeOrder: normalizeOrder,
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
    if (!data || data.source !== 'jsr-pk10-race') return;
    if (data.action === 'play') {
      play(data.order, {
        issue: data.issue,
        countdownSec: data.countdownSec,
        midRaceMs: data.midRaceMs,
        afterFinishMs: data.afterFinishMs,
        onDone: function (ok) {
          try {
            ev.source &&
              ev.source.postMessage(
                { source: 'jsr-pk10-race', action: 'done', ok: !!ok, issue: data.issue || '' }, location.origin);
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
