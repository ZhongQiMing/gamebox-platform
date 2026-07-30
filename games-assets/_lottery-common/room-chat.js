/**
 * 七彩聊天室共享内核：轮询 / 去重 / 揭晓门闩 / 中奖核对暂存
 * 不负责气泡皮肤与玩法口令——由各游戏通过回调提供。
 * 依赖：games-common.js 的 App.fetchRoomChat / App.startAdaptiveInterval / App.getRoomNo
 */
(function (global) {
  'use strict';

  var LotteryRoomChat = global.LotteryRoomChat || {};

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 注单核对卡 HTML（css 前缀区分皮肤，如 ssc / k3 / lhc） */
  LotteryRoomChat.buildBetVerifyHtml = function (prefix, p, helpers) {
    helpers = helpers || {};
    var escapeHtml = helpers.escapeHtml || esc;
    var userName = helpers.userName || '';
    var issue = String((p && p.issueNo) || '');
    var users = p && Array.isArray(p.users) ? p.users : [];
    var px = String(prefix || 'bot');
    if (!users.length) {
      return (
        '<div class="' + px + '-bot-card ' + px + '-bot-card--bets">' +
        '<div class="' + px + '-bot-card__head"><span class="' + px + '-bot-card__title">注单核对</span>' +
        '<span class="' + px + '-bot-card__issue">' + issue + '</span></div>' +
        '<div class="' + px + '-bot-empty">本期暂无下注</div></div>'
      );
    }
    var body = users
      .map(function (u) {
        var me = u.name === userName ? ' is-me' : '';
        var tags = (u.tags || [])
          .map(function (t) {
            return '<span class="' + px + '-bot-tag">' + t.play + '/' + t.amount + '</span>';
          })
          .join('');
        return (
          '<div class="' + px + '-bot-user' + me + '">' +
          '<div class="' + px + '-bot-user__head"><span class="' + px + '-bot-user__name">' +
          escapeHtml(u.name) +
          '</span><span class="' + px + '-bot-user__sum">' +
          (u.total || 0) +
          '</span></div>' +
          '<div class="' + px + '-bot-user__tags">' +
          tags +
          '</div></div>'
        );
      })
      .join('');
    return (
      '<div class="' + px + '-bot-card ' + px + '-bot-card--bets">' +
      '<div class="' + px + '-bot-card__head"><span class="' + px + '-bot-card__title">注单核对</span>' +
      '<span class="' + px + '-bot-card__issue">' + issue + '</span></div>' +
      '<div class="' + px + '-bot-card__body is-full">' +
      body +
      '</div></div>'
    );
  };

  /** 中奖核对卡 HTML（最终结果，非「核对中」） */
  LotteryRoomChat.buildWinVerifyHtml = function (prefix, p, helpers) {
    helpers = helpers || {};
    var escapeHtml = helpers.escapeHtml || esc;
    var fmtProfit =
      helpers.fmtProfit ||
      function (n) {
        var v = Number(n) || 0;
        return (v >= 0 ? '+' : '') + v;
      };
    var issue = String((p && p.issueNo) || '');
    var users = p && Array.isArray(p.users) ? p.users : [];
    var px = String(prefix || 'bot');
    var body = '';
    if (!users.length || (p && p.empty)) {
      body = '<div class="' + px + '-bot-empty">本期暂无中奖</div>';
    } else {
      body = users
        .map(function (u) {
          var tags = (u.tags || [])
            .map(function (t) {
              return (
                '<span class="' + px + '-bot-tag ' + px + '-bot-tag--win">' +
                t.play +
                '/' +
                t.amount +
                '</span>'
              );
            })
            .join('');
          var profit = Number(u.profit) || 0;
          var winAmount = Number(u.winAmount) || 0;
          var profitCls = profit >= 0 ? 'pos' : 'neg';
          return (
            '<div class="' + px + '-bot-user">' +
            '<div class="' + px + '-bot-user__head">' +
            '<span class="' + px + '-bot-user__name">' +
            escapeHtml(u.name) +
            '</span>' +
            '<span class="' + px + '-bot-user__profit ' +
            profitCls +
            '">' +
            fmtProfit(profit) +
            '</span></div>' +
            '<div class="' + px + '-bot-user__tags">' +
            tags +
            '</div>' +
            '<div class="' + px + '-bot-user__sub">中奖 +' +
            winAmount +
            '</div></div>'
          );
        })
        .join('');
    }
    return (
      '<div class="' + px + '-bot-card ' + px + '-bot-card--win">' +
      '<div class="' + px + '-bot-card__head"><span class="' + px + '-bot-card__title">中奖核对</span>' +
      '<span class="' + px + '-bot-card__issue">' + issue + '</span></div>' +
      '<div class="' + px + '-bot-card__body is-full">' +
      body +
      '</div></div>'
    );
  };

  /** 移除某期仍停在「正在核对」的气泡（避免替换失败后永久卡住） */
  LotteryRoomChat.removeCalculatingWinCards = function (prefix, issue, exceptMsgEl) {
    var $ = global.jQuery || global.$;
    if (!$ || !issue) return;
    var px = String(prefix || 'bot');
    var iss = String(issue || '').trim();
    $('#chatFeed, #chatDock')
      .find('.' + px + '-bot-card--win.is-calculating')
      .filter(function () {
        return String($(this).find('.' + px + '-bot-card__issue').text() || '').trim() === iss;
      })
      .each(function () {
        var $msg = $(this).closest('[class*="-msg"]');
        if (!$msg.length) {
          $(this).remove();
          return;
        }
        if (exceptMsgEl && $msg[0] === exceptMsgEl) return;
        $msg.remove();
      });
  };

  /**
   * 把「核对中」卡替换为最终中奖核对（各游戏 DOM 结构一致时用）
   * opts: { prefix, issue, html, appendMsg, robotName }
   */
  LotteryRoomChat.replaceCalculatingWinCard = function (opts) {
    opts = opts || {};
    var prefix = String(opts.prefix || 'bot');
    var issue = String(opts.issue || '').trim();
    var html = opts.html || '';
    var $ = global.jQuery || global.$;
    if ($ && issue) {
      var $scope = $('#chatFeed, #chatDock');
      var $calc = $scope
        .find('.' + prefix + '-bot-card--win.is-calculating')
        .filter(function () {
          return (
            String($(this).find('.' + prefix + '-bot-card__issue').text() || '').trim() === issue
          );
        })
        .last()
        .closest('[class*="-msg"]');
      if ($calc.length) {
        var $bubble = $calc.find('[class*="msg__bubble"]').first();
        if ($bubble.length) {
          $bubble.html(html);
          LotteryRoomChat.removeCalculatingWinCards(prefix, issue, $calc[0]);
          return true;
        }
      }
      /* SSC 等用 .ssc-msg 包裹 */
      $calc = $scope
        .find('.' + prefix + '-msg')
        .has('.' + prefix + '-bot-card--win.is-calculating')
        .filter(function () {
          return (
            String($(this).find('.' + prefix + '-bot-card__issue').text() || '').trim() === issue
          );
        })
        .last();
      if ($calc.length) {
        var $bubble2 = $calc.find('.' + prefix + '-msg__bubble, [class*="msg__bubble"]').first();
        if ($bubble2.length) {
          $bubble2.html(html);
          LotteryRoomChat.removeCalculatingWinCards(prefix, issue, $calc[0]);
          return true;
        }
      }
      /* 找不到可替换节点时先清掉残留 calculating，再追加终态卡 */
      LotteryRoomChat.removeCalculatingWinCards(prefix, issue);
    }
    if (typeof opts.appendMsg === 'function') {
      opts.appendMsg({
        name: opts.robotName || '机器人',
        robot: true,
        html: html,
        skipPersist: true,
      });
    }
    return false;
  };

  /**
   * 钉底仪式结束：把 dock 里整段（结果卡 → 中奖核对）按顺序移回聊天流，
   * 避免结果卡被 append 到核对卡下面。
   */
  LotteryRoomChat.undockResultToFeed = function () {
    var $ = global.jQuery || global.$;
    if (!$) return null;
    var $dock = $('#chatDock');
    if (!$dock.length) return null;
    var $children = $dock.children();
    if (!$children.length) {
      $dock.prop('hidden', true);
      return null;
    }
    var first = $children.get(0) || null;
    $children.each(function () {
      $('#chatFeed').append(this);
    });
    $dock.prop('hidden', true);
    var feed = document.getElementById('chatFeed');
    if (feed) feed.scrollTop = feed.scrollHeight;
    return first;
  };
  /**
   * 创建房间聊天客户端实例
   *
   * 单一状态机 phase:
   *   betting → drawing → revealing → settled → betting
   *
   * opts:
   *  - gameCode, appendMsg, clearFeed, getUserName, robotFallbackName, fmtTime
   *  - buildBetHtml / buildCloseHtml / buildOpenHtml / buildResultHtml
   *  - buildBetVerifyHtml / buildWinVerifyHtml / buildWinVerifyCalculatingHtml
   *  - onClose(issue, p, msg, { live })
   *  - onResultMeta / onWinVerifyShown / onFlushWinVerify
   *  - onPhaseChange(phase, issue)  推荐：顶栏/解冻只跟这个走
   *  - onCeremonyComplete(issue)    兼容旧回调（finishToBetting 时等价 betting）
   *  - afterResultAppended(ctx)
   *  - getRevealFallbackMs(issue)
   */
  LotteryRoomChat.create = function (opts) {
    opts = opts || {};
    var gameCode = opts.gameCode;
    var seenIds = new Set();
    var lastId = '';
    var busy = false;
    var queued = false;
    var feedReady = false;
    var pollHandle = null;

    var PHASE_BETTING = 'betting';
    var PHASE_DRAWING = 'drawing';
    var PHASE_REVEALING = 'revealing';
    var PHASE_SETTLED = 'settled';

    /** 当前直播仪式阶段（历史回放不推进 phase） */
    var phase = PHASE_BETTING;
    /** 当前仪式期号 */
    var phaseIssue = '';
    /** 本仪式是否已刷中奖终态 */
    var winFlushed = false;
    /** 本仪式揭晓是否已完成（防重复 settle） */
    var revealDone = false;
    /** 本仪式是否已 finishToBetting（防双开盘线） */
    var finished = false;

    var pendingWin = null;
    var pendingOpen = null;
    /** 开盘线尚未刷出时暂存的下注（含机器人），保证开盘线永远在注前面 */
    var pendingBets = [];
    var revealTimer = null;
    var winWaitTimer = null;
    var openWaitTimer = null;
    var holdMaxTimer = null;

    var lastBetVerifyAt = 0;
    var pendingLiveResult = null;
    var pendingLiveResultTimer = null;

    var RESULT_AFTER_BET_VERIFY_MS = 1000;
    var OPEN_AFTER_SETTLED_MS = 200;
    var OPEN_WAIT_MS = 3000;
    var WIN_ARRIVE_WAIT_MS = 3500;
    var HOLD_MAX_MS = 22000;
    var REVEAL_HARD_MAX_MS = 20000;

    /** 揭晓期间暂停「自动滚到底」：卡片仍在聊天流里，不是钉死；用户手滑即解除 */
    var autoScrollPaused = false;

    function pauseAutoScroll() {
      autoScrollPaused = true;
    }
    function resumeAutoScroll() {
      autoScrollPaused = false;
    }
    function releaseAutoScrollByUser() {
      autoScrollPaused = false;
    }

    function bindFeedScrollRelease() {
      var feed = document.getElementById('chatFeed');
      if (!feed || feed.getAttribute('data-lottery-scroll-bound') === '1') return;
      feed.setAttribute('data-lottery-scroll-bound', '1');
      var release = function () {
        if (autoScrollPaused) releaseAutoScrollByUser();
      };
      feed.addEventListener('touchstart', release, { passive: true });
      feed.addEventListener('wheel', release, { passive: true });
      feed.addEventListener('pointerdown', release, { passive: true });
    }

    function trimIssue(issue) {
      return String(issue || '').trim();
    }

    function notifyPhase(next, issue) {
      if (typeof opts.onPhaseChange === 'function') {
        try {
          opts.onPhaseChange(next, issue || phaseIssue);
        } catch (e) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[LotteryRoomChat] onPhaseChange failed', next, e);
          }
        }
        return;
      }
      if (next === PHASE_BETTING && typeof opts.onCeremonyComplete === 'function') {
        try {
          opts.onCeremonyComplete(issue || phaseIssue);
        } catch (e2) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[LotteryRoomChat] onCeremonyComplete failed', e2);
          }
        }
      }
    }

    function setPhase(next, issue) {
      var iss = trimIssue(issue);
      phase = next;
      if (iss) phaseIssue = iss;
      if (next === PHASE_BETTING) {
        phaseIssue = '';
        winFlushed = false;
        revealDone = false;
        finished = false;
        pendingWin = null;
        clearRevealTimer();
        clearWinWait();
        clearOpenWait();
        clearHoldMax();
      }
      notifyPhase(next, iss || phaseIssue);
    }

    function clearRevealTimer() {
      if (revealTimer) {
        clearTimeout(revealTimer);
        revealTimer = null;
      }
    }
    function clearWinWait() {
      if (winWaitTimer) {
        clearInterval(winWaitTimer);
        winWaitTimer = null;
      }
    }
    function clearOpenWait() {
      if (openWaitTimer) {
        clearTimeout(openWaitTimer);
        openWaitTimer = null;
      }
    }
    function clearHoldMax() {
      if (holdMaxTimer) {
        clearTimeout(holdMaxTimer);
        holdMaxTimer = null;
      }
    }

    function armHoldMax(issue) {
      clearHoldMax();
      var iss = trimIssue(issue);
      holdMaxTimer = setTimeout(function () {
        holdMaxTimer = null;
        if (phaseIssue === iss && phase !== PHASE_BETTING) markRevealReady(iss);
      }, HOLD_MAX_MS);
    }

    function fmtRoomChatTime(iso) {
      try {
        var d = new Date(iso);
        if (Number.isNaN(d.getTime())) {
          return typeof opts.fmtTime === 'function' ? opts.fmtTime(new Date()) : '';
        }
        var pad = function (n) {
          return String(n).padStart(2, '0');
        };
        return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      } catch (e) {
        return typeof opts.fmtTime === 'function' ? opts.fmtTime(new Date()) : '';
      }
    }

    function flushPendingOpen() {
      var pending = pendingOpen;
      if (!pending) return '';
      pendingOpen = null;
      var nextIssue = String(pending.issue || (pending.p && pending.p.issueNo) || '').trim();
      try {
        var html =
          typeof opts.buildOpenHtml === 'function'
            ? opts.buildOpenHtml(nextIssue, pending.p, pending.msg)
            : '开盘 ' + nextIssue;
        if (html && typeof opts.appendMsg === 'function') {
          opts.appendMsg({
            name: (pending.msg && pending.msg.senderName) || opts.robotFallbackName || '机器人',
            avatar: (pending.msg && pending.msg.senderAvatar) || '',
            robot: true,
            html: html,
            time: pending.msg && pending.msg.createdAt ? fmtRoomChatTime(pending.msg.createdAt) : undefined,
            skipPersist: true,
          });
        }
      } catch (e) {
        pendingOpen = pending;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[LotteryRoomChat] flushPendingOpen failed', e);
        }
        return '';
      }
      return nextIssue;
    }

    function appendBetMessage(msg, p) {
      var html =
        typeof opts.buildBetHtml === 'function'
          ? opts.buildBetHtml(p, msg)
          : esc(String((p && p.text) || ''));
      if (!html || typeof opts.appendMsg !== 'function') return;
      var userName = typeof opts.getUserName === 'function' ? opts.getUserName() : '';
      var self = !msg.isRobot && msg.senderName === userName;
      opts.appendMsg({
        name: msg.senderName || (msg.isRobot ? opts.robotFallbackName || '机器人' : '玩家'),
        avatar: msg.senderAvatar || '',
        robot: !!msg.isRobot && !self,
        self: self,
        html: html,
        time: msg.createdAt ? fmtRoomChatTime(msg.createdAt) : undefined,
        skipPersist: true,
        dock: false,
      });
    }

    /** 开盘线刷出后再放注：首注稍停，其余错开，像真人跟注 */
    function flushPendingBets() {
      var list = pendingBets.slice();
      pendingBets = [];
      if (!list.length) return;
      var t = 900;
      list.forEach(function (item, idx) {
        var wait = idx === 0 ? t : t;
        setTimeout(function () {
          try {
            appendBetMessage(item.msg, item.p || item.msg.payload || {});
          } catch (e) {
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[LotteryRoomChat] flushPendingBets failed', e);
            }
          }
        }, wait);
        t += 700 + Math.floor(Math.random() * 1100);
      });
    }

    /**
     * 唯一进入下一期下注的出口：开盘线 → phase=betting → 再放挂起的注
     */
    function finishToBetting() {
      if (finished) return;
      if (phase !== PHASE_SETTLED) return;
      if (!winFlushed) return;
      finished = true;
      clearOpenWait();
      clearHoldMax();
      clearRevealTimer();
      clearWinWait();
      resumeAutoScroll();
      try {
        LotteryRoomChat.undockResultToFeed();
      } catch (e) {
        /* ignore leftover dock */
      }
      var nextIssue = flushPendingOpen();
      var prev = phaseIssue;
      phase = PHASE_BETTING;
      phaseIssue = '';
      winFlushed = false;
      revealDone = false;
      pendingWin = null;
      notifyPhase(PHASE_BETTING, nextIssue || prev);
      /* 开盘线已出：再放之前赶到的机器人/玩家注，顺序永远在开盘线后 */
      flushPendingBets();
    }

    function tryFinishToBetting() {
      if (phase !== PHASE_SETTLED || !winFlushed || finished) return;
      clearOpenWait();
      if (pendingOpen) {
        openWaitTimer = setTimeout(function () {
          openWaitTimer = null;
          finishToBetting();
        }, OPEN_AFTER_SETTLED_MS);
        return;
      }
      /* 开盘线未到：继续等，顶栏保持开奖中（settled） */
      openWaitTimer = setTimeout(function () {
        openWaitTimer = null;
        if (phase === PHASE_SETTLED && pendingOpen) finishToBetting();
        else if (phase === PHASE_SETTLED) {
          /* 仍无开盘：再等一拍 */
          tryFinishToBetting();
        }
      }, OPEN_WAIT_MS);
    }

    function flushPendingWinVerify() {
      if (!pendingWin || winFlushed) return false;
      var pending = pendingWin;
      pendingWin = null;
      try {
        if (typeof opts.onFlushWinVerify === 'function') {
          opts.onFlushWinVerify(phaseIssue, pending);
        }
        winFlushed = true;
        return true;
      } catch (e) {
        pendingWin = pending;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[LotteryRoomChat] onFlushWinVerify failed', e);
        }
        return false;
      }
    }

    function settleAfterReveal() {
      if (revealDone) {
        if (phase === PHASE_SETTLED) tryFinishToBetting();
        return;
      }
      if (phase !== PHASE_REVEALING && phase !== PHASE_DRAWING) return;
      revealDone = true;
      clearRevealTimer();

      function afterWin() {
        if (phase !== PHASE_BETTING) {
          phase = PHASE_SETTLED;
          notifyPhase(PHASE_SETTLED, phaseIssue);
        }
        tryFinishToBetting();
      }

      if (winFlushed) {
        afterWin();
        return;
      }
      if (pendingWin) {
        if (flushPendingWinVerify()) afterWin();
        return;
      }
      var waited = 0;
      var step = 120;
      clearWinWait();
      winWaitTimer = setInterval(function () {
        waited += step;
        if (pendingWin) {
          clearWinWait();
          if (flushPendingWinVerify()) afterWin();
          return;
        }
        if (waited >= WIN_ARRIVE_WAIT_MS) {
          clearWinWait();
          pendingWin = { issueNo: phaseIssue, users: [], empty: true };
          if (flushPendingWinVerify()) afterWin();
        }
      }, step);
    }

    function markRevealReady(issue) {
      issue = trimIssue(issue);
      if (!issue || (phaseIssue && issue !== phaseIssue)) return;
      /* scheduleRevealReady 未到期：忽略 bindReveal 瞬时 onDone */
      if (revealTimer) return;
      settleAfterReveal();
    }

    function scheduleRevealReady(issue, ms) {
      issue = trimIssue(issue);
      if (!issue) return;
      if (phaseIssue && issue !== phaseIssue) return;
      clearRevealTimer();
      var delay = Math.max(0, Number(ms) || 0);
      if (delay > REVEAL_HARD_MAX_MS) delay = REVEAL_HARD_MAX_MS;
      revealTimer = setTimeout(function () {
        revealTimer = null;
        markRevealReady(issue);
      }, delay);
    }

    function setRevealPending(issue) {
      issue = trimIssue(issue);
      if (!issue) return;
      revealDone = false;
      winFlushed = false;
    }

    /** 历史回放：只记标志，不推进直播 phase */
    function setRevealReadyFlag(issue, ready) {
      /* no-op for live machine; history cards settle in-game */
      void issue;
      void ready;
    }

    function appendCalculatingWinCard() {
      if (!phaseIssue || winFlushed || !pendingWin) return false;
      if (typeof opts.buildWinVerifyCalculatingHtml !== 'function') return false;
      if (typeof opts.appendMsg !== 'function') return false;
      var $ = global.jQuery || global.$;
      if ($) {
        var exists = $('#chatFeed, #chatDock')
          .find('[class*="-bot-card--win"].is-calculating')
          .filter(function () {
            return (
              String($(this).find('[class*="-bot-card__issue"]').text() || '').trim() === phaseIssue
            );
          }).length;
        if (exists) return true;
      }
      var html = opts.buildWinVerifyCalculatingHtml(phaseIssue, pendingWin, null);
      if (!html) return false;
      /* 进聊天流，不钉底；停留靠暂停自动滚 */
      opts.appendMsg({
        name: opts.robotFallbackName || '机器人',
        robot: true,
        html: html,
        skipPersist: true,
        dock: false,
      });
      return true;
    }

    function clearPendingLiveResult() {
      if (pendingLiveResultTimer) {
        clearTimeout(pendingLiveResultTimer);
        pendingLiveResultTimer = null;
      }
      pendingLiveResult = null;
    }

    function flushPendingLiveResult() {
      if (!pendingLiveResult) return;
      var item = pendingLiveResult;
      pendingLiveResult = null;
      if (pendingLiveResultTimer) {
        clearTimeout(pendingLiveResultTimer);
        pendingLiveResultTimer = null;
      }
      renderMessage(item.msg, item.renderOpts);
    }

    function schedulePendingLiveResult(waitMs) {
      if (pendingLiveResultTimer) clearTimeout(pendingLiveResultTimer);
      pendingLiveResultTimer = setTimeout(function () {
        pendingLiveResultTimer = null;
        flushPendingLiveResult();
      }, Math.max(50, Number(waitMs) || RESULT_AFTER_BET_VERIFY_MS));
    }

    function pendingLiveResultIssue() {
      if (!pendingLiveResult || !pendingLiveResult.msg) return '';
      var m = pendingLiveResult.msg;
      var p = m.payload || {};
      return trimIssue(p.issueNo || m.issueNo);
    }

    function clearRevealState() {
      clearRevealTimer();
      clearWinWait();
      clearOpenWait();
      clearHoldMax();
      clearPendingLiveResult();
      pendingWin = null;
      pendingOpen = null;
      pendingBets = [];
      phase = PHASE_BETTING;
      phaseIssue = '';
      winFlushed = false;
      revealDone = false;
      finished = false;
      lastBetVerifyAt = 0;
      resumeAutoScroll();
    }

    function enterDrawing(issue) {
      issue = trimIssue(issue);
      if (!issue) return;
      finished = false;
      revealDone = false;
      winFlushed = false;
      pendingWin = null;
      phaseIssue = issue;
      phase = PHASE_DRAWING;
      armHoldMax(issue);
      notifyPhase(PHASE_DRAWING, issue);
    }

    function enterRevealing(issue) {
      issue = trimIssue(issue) || phaseIssue;
      if (!issue) return;
      phaseIssue = issue;
      if (phase === PHASE_BETTING) enterDrawing(issue);
      phase = PHASE_REVEALING;
      armHoldMax(issue);
      notifyPhase(PHASE_REVEALING, issue);
    }

    function renderMessage(msg, renderOpts) {
      if (!msg || !msg.id || seenIds.has(msg.id)) return;
      var live = !!(renderOpts && renderOpts.live);
      var animate = !!(renderOpts && renderOpts.animate);
      var p = msg.payload || {};
      var kind = String(msg.kind || '');

      if (kind === 'result' && live && animate) {
        var elapsedBv = lastBetVerifyAt ? Date.now() - lastBetVerifyAt : -1;
        if (!lastBetVerifyAt || elapsedBv < RESULT_AFTER_BET_VERIFY_MS) {
          pendingLiveResult = { msg: msg, renderOpts: renderOpts };
          if (lastBetVerifyAt) {
            schedulePendingLiveResult(RESULT_AFTER_BET_VERIFY_MS - elapsedBv);
          } else {
            schedulePendingLiveResult(RESULT_AFTER_BET_VERIFY_MS + 2000);
          }
          return;
        }
      }

      seenIds.add(msg.id);
      var html = '';
      var isRobot = !!msg.isRobot;
      var winVerifyDeferred = false;
      var issue = '';

      if (kind === 'bet') {
        /*
         * 模拟真人：开盘线没刷出前，任何下注（含机器人）只排队，绝不插到开盘线前面。
         */
        if (live && phase !== PHASE_BETTING) {
          pendingBets.push({ msg: msg, p: p });
          html = '';
        } else {
          html =
            typeof opts.buildBetHtml === 'function'
              ? opts.buildBetHtml(p, msg)
              : esc(String(p.text || ''));
        }
      } else if (kind === 'close') {
        issue = String(p.issueNo || msg.issueNo || '');
        html =
          typeof opts.buildCloseHtml === 'function'
            ? opts.buildCloseHtml(issue, p, msg)
            : '封盘 ' + issue;
        isRobot = true;
        if (live) enterDrawing(issue);
        if (typeof opts.onClose === 'function') opts.onClose(issue, p, msg, { live: live });
      } else if (kind === 'open') {
        issue = String(p.issueNo || msg.issueNo || '');
        var prevIssue = trimIssue(p.prevIssueNo || '') || phaseIssue;
        isRobot = true;
        /*
         * 开盘线唯一出口 = finishToBetting。
         * 仪式未回到 betting：只挂 pending；已在 betting：冷启动直出。
         */
        if (live && phase !== PHASE_BETTING) {
          pendingOpen = { issue: issue, p: p, msg: msg, prevIssue: prevIssue };
          html = '';
          if (phase === PHASE_SETTLED && winFlushed) tryFinishToBetting();
        } else if (live && finished) {
          html = '';
        } else {
          html =
            typeof opts.buildOpenHtml === 'function'
              ? opts.buildOpenHtml(issue, p, msg)
              : '开盘 ' + issue;
          if (live) {
            phase = PHASE_BETTING;
            notifyPhase(PHASE_BETTING, issue);
            flushPendingBets();
          }
        }
      } else if (kind === 'result') {
        html =
          typeof opts.buildResultHtml === 'function'
            ? opts.buildResultHtml(p, msg, { live: live, animate: animate })
            : '开奖 ' + String(p.issueNo || msg.issueNo || '');
        isRobot = true;
        if (typeof opts.onResultMeta === 'function') opts.onResultMeta(p, msg);
      } else if (kind === 'bet_verify') {
        html =
          typeof opts.buildBetVerifyHtml === 'function'
            ? opts.buildBetVerifyHtml(p, msg)
            : '';
        isRobot = true;
        if (live) {
          lastBetVerifyAt = Date.now();
          if (pendingLiveResult) schedulePendingLiveResult(RESULT_AFTER_BET_VERIFY_MS);
        }
      } else if (kind === 'win_verify') {
        issue = trimIssue(p.issueNo || msg.issueNo);
        isRobot = true;
        if (!live) {
          html =
            typeof opts.buildWinVerifyHtml === 'function'
              ? opts.buildWinVerifyHtml(p, msg)
              : '';
        } else if (!issue || (phaseIssue && issue !== phaseIssue && phase !== PHASE_BETTING)) {
          /* 错期或已结束：忽略 */
          if (finished || (phase === PHASE_BETTING && winFlushed)) html = '';
          else {
            pendingWin = p;
            winVerifyDeferred = true;
            html = '';
          }
        } else if (winFlushed || finished) {
          html = '';
        } else if (phase === PHASE_SETTLED) {
          pendingWin = p;
          winVerifyDeferred = true;
          html = '';
          if (flushPendingWinVerify()) tryFinishToBetting();
        } else if (phase === PHASE_REVEALING || phase === PHASE_DRAWING) {
          pendingWin = p;
          winVerifyDeferred = true;
          if (phase === PHASE_REVEALING && pendingLiveResultIssue() !== issue) {
            html =
              typeof opts.buildWinVerifyCalculatingHtml === 'function'
                ? opts.buildWinVerifyCalculatingHtml(issue, p, msg)
                : '';
          } else {
            html = '';
          }
        } else {
          pendingWin = p;
          winVerifyDeferred = true;
          html = '';
        }
      } else {
        html =
          typeof opts.buildOtherHtml === 'function'
            ? opts.buildOtherHtml(p, msg, kind)
            : esc(String(p.text || kind));
      }

      var userName = typeof opts.getUserName === 'function' ? opts.getUserName() : '';
      var self = !msg.isRobot && msg.senderName === userName;
      /* 结果/核对进聊天流，不钉底；揭晓时只暂停自动滚以「停留」 */
      if (html && typeof opts.appendMsg === 'function') {
        opts.appendMsg({
          name: msg.senderName || (isRobot ? opts.robotFallbackName || '机器人' : '玩家'),
          avatar: msg.senderAvatar || '',
          robot: isRobot && !self,
          self: self,
          html: html,
          time: fmtRoomChatTime(msg.createdAt),
          skipPersist: true,
          dock: false,
        });
      }

      if (kind === 'result') {
        var appendedResultIssue = trimIssue(p.issueNo || msg.issueNo);
        if (live && animate) enterRevealing(appendedResultIssue);
        if (typeof opts.afterResultAppended === 'function') {
          opts.afterResultAppended({
            issue: appendedResultIssue,
            payload: p,
            msg: msg,
            live: live,
            animate: animate,
            docked: false,
            markRevealReady: markRevealReady,
            scheduleRevealReady: scheduleRevealReady,
            setRevealPending: setRevealPending,
            setRevealReadyFlag: setRevealReadyFlag,
          });
        }
        if (live && animate && appendedResultIssue) {
          appendCalculatingWinCard();
          /* 结果+正在核对都进流并滚到底后，再暂停自动滚（用户手滑可解除） */
          pauseAutoScroll();
        }
      }
      if (kind === 'win_verify' && !winVerifyDeferred && typeof opts.onWinVerifyShown === 'function') {
        opts.onWinVerifyShown(trimIssue(p.issueNo || msg.issueNo), p, msg);
      }
      lastId = msg.id;
    }

    function sync(initial) {
      var App = global.App;
      if (!App || !App.fetchRoomChat) return;
      if (busy) {
        if (initial) queued = true;
        return;
      }
      if (!(App.getRoomNo && App.getRoomNo())) return;
      busy = true;
      var afterId = initial ? '' : lastId;
      App.fetchRoomChat({ gameCode: gameCode, afterId: afterId, limit: 80 })
        .then(function (list) {
          var msgs = Array.isArray(list) ? list : [];
          if (initial) {
            if (typeof opts.clearFeed === 'function') opts.clearFeed();
            seenIds.clear();
            lastId = '';
            clearRevealState();
          }
          msgs.forEach(function (m) {
            renderMessage(m, {
              live: !initial,
              animate: !initial && m.kind === 'result',
            });
          });
          if (initial) {
            /* 历史不得留下直播仪式 */
            clearRevealState();
          }
          feedReady = true;
        })
        .catch(function () {
          /* bridge 未就绪 */
        })
        .finally(function () {
          busy = false;
          if (queued) {
            queued = false;
            sync(true);
          }
        });
    }

    function startPolling() {
      var App = global.App;
      bindFeedScrollRelease();
      sync(true);
      var activeMs = Math.max(500, Number(opts.pollActiveMs) || 2000);
      var hiddenMs = Math.max(activeMs, Number(opts.pollHiddenMs) || 5000);
      if (pollHandle && pollHandle.stop) {
        try {
          pollHandle.stop();
        } catch (e) {
          /* ignore */
        }
      }
      if (App && App.startAdaptiveInterval) {
        pollHandle = App.startAdaptiveInterval(
          function () {
            sync(false);
          },
          activeMs,
          hiddenMs,
          { runNow: false },
        );
      } else {
        var tid = setInterval(function () {
          sync(false);
        }, activeMs);
        pollHandle = {
          stop: function () {
            clearInterval(tid);
          },
        };
      }
      if (App) {
        App.onAssetsGameReady = function () {
          if (!feedReady) sync(true);
          else sync(false);
        };
      }
    }

    return {
      sync: sync,
      startPolling: startPolling,
      getPhase: function () {
        return phase;
      },
      getPhaseIssue: function () {
        return phaseIssue;
      },
      isBettingOpen: function () {
        return phase === PHASE_BETTING;
      },
      isAutoScrollPaused: function () {
        return !!autoScrollPaused;
      },
      releaseAutoScrollByUser: releaseAutoScrollByUser,
      resumeAutoScroll: resumeAutoScroll,
      markRevealReady: markRevealReady,
      scheduleRevealReady: scheduleRevealReady,
      setRevealPending: setRevealPending,
      setRevealReadyFlag: setRevealReadyFlag,
      isRevealReady: function (issue) {
        return revealDone && (!issue || trimIssue(issue) === phaseIssue);
      },
      /* 兼容旧 API：drawing/revealing/settled 期间顶栏开奖中 */
      beginCeremonyHold: function (issue) {
        issue = trimIssue(issue);
        if (!issue) return;
        if (phase === PHASE_BETTING) enterDrawing(issue);
        else if (!phaseIssue) phaseIssue = issue;
      },
      isCeremonyHolding: function () {
        return phase === PHASE_DRAWING || phase === PHASE_REVEALING || phase === PHASE_SETTLED;
      },
      getCeremonyHoldIssue: function () {
        return phase === PHASE_BETTING ? '' : phaseIssue;
      },
      isCeremonyDone: function (issue) {
        issue = trimIssue(issue);
        if (!issue) return finished;
        return finished && (!phaseIssue || issue !== phaseIssue);
      },
      isFeedReady: function () {
        return feedReady;
      },
      stop: function () {
        if (pollHandle && pollHandle.stop) pollHandle.stop();
        pollHandle = null;
        clearRevealState();
      },
    };
  };

  global.LotteryRoomChat = LotteryRoomChat;
})(typeof window !== 'undefined' ? window : this);
