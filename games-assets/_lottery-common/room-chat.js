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
      var $calc = $('#chatFeed')
        .find('.' + prefix + '-bot-card--win.is-calculating')
        .filter(function () {
          return (
            String($(this).find('.' + prefix + '-bot-card__issue').text() || '').trim() === issue
          );
        })
        .last()
        .closest('[class*="-msg"]');
      if ($calc.length) {
        $calc.find('[class*="msg__bubble"]').first().html(html);
        return true;
      }
      /* SSC 等用 .ssc-msg 包裹 */
      $calc = $('#chatFeed .' + prefix + '-msg')
        .has('.' + prefix + '-bot-card--win.is-calculating')
        .filter(function () {
          return (
            String($(this).find('.' + prefix + '-bot-card__issue').text() || '').trim() === issue
          );
        })
        .last();
      if ($calc.length) {
        $calc.find('.' + prefix + '-msg__bubble, [class*="msg__bubble"]').first().html(html);
        return true;
      }
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
   * 创建房间聊天客户端实例
   *
   * opts:
   *  - gameCode: string
   *  - appendMsg(msgOpts)
   *  - clearFeed()
   *  - getUserName()
   *  - robotFallbackName
   *  - fmtTime(date) 可选
   *  - buildBetHtml / buildCloseHtml / buildResultHtml / buildBetVerifyHtml
   *  - buildWinVerifyHtml / buildWinVerifyCalculatingHtml
   *  - buildOtherHtml 可选
   *  - onClose(issue, p, msg)
   *  - onResultMeta(p, msg)
   *  - onWinVerifyUnlocked(issue, p, msg)  揭晓后解冻等
   *  - onWinVerifyShown(issue, p, msg)    非暂存时（含历史回放）
   *  - onFlushWinVerify(issue, pendingPayload)
   *  - afterResultAppended(ctx)  ctx 含 markRevealReady / scheduleRevealReady / setRevealPending / setRevealReadyFlag
   *  - getRevealFallbackMs(issue)
   *  - pollActiveMs / pollHiddenMs  默认 2000 / 5000
   */
  LotteryRoomChat.create = function (opts) {
    opts = opts || {};
    var gameCode = opts.gameCode;
    var seenIds = new Set();
    var lastId = '';
    var busy = false;
    var queued = false;
    var feedReady = false;
    var revealReady = Object.create(null);
    var pendingWin = Object.create(null);
    var revealTimers = Object.create(null);
    var pollHandle = null;

    function trimIssue(issue) {
      return String(issue || '').trim();
    }

    function flushPendingWinVerify(issue) {
      issue = trimIssue(issue);
      var pending = pendingWin[issue];
      if (!pending) return;
      delete pendingWin[issue];
      if (typeof opts.onFlushWinVerify === 'function') {
        opts.onFlushWinVerify(issue, pending);
      }
    }

    function markRevealReady(issue) {
      issue = trimIssue(issue);
      if (!issue) return;
      if (revealTimers[issue]) {
        clearTimeout(revealTimers[issue]);
        delete revealTimers[issue];
      }
      revealReady[issue] = true;
      flushPendingWinVerify(issue);
    }

    function scheduleRevealReady(issue, ms) {
      issue = trimIssue(issue);
      if (!issue) return;
      if (revealTimers[issue]) clearTimeout(revealTimers[issue]);
      revealTimers[issue] = setTimeout(function () {
        markRevealReady(issue);
      }, Math.max(0, Number(ms) || 0));
    }

    function setRevealPending(issue) {
      revealReady[trimIssue(issue)] = false;
    }

    function setRevealReadyFlag(issue, ready) {
      revealReady[trimIssue(issue)] = !!ready;
    }

    function isRevealReady(issue) {
      return !!revealReady[trimIssue(issue)];
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

    function renderMessage(msg, renderOpts) {
      if (!msg || !msg.id || seenIds.has(msg.id)) return;
      seenIds.add(msg.id);
      var live = !!(renderOpts && renderOpts.live);
      var animate = !!(renderOpts && renderOpts.animate);
      var p = msg.payload || {};
      var kind = String(msg.kind || '');
      var html = '';
      var isRobot = !!msg.isRobot;
      var winVerifyDeferred = false;
      var issue = '';

      if (kind === 'bet') {
        html =
          typeof opts.buildBetHtml === 'function'
            ? opts.buildBetHtml(p, msg)
            : esc(String(p.text || ''));
      } else if (kind === 'close') {
        issue = String(p.issueNo || msg.issueNo || '');
        html =
          typeof opts.buildCloseHtml === 'function'
            ? opts.buildCloseHtml(issue, p, msg)
            : '封盘 ' + issue;
        isRobot = true;
        if (typeof opts.onClose === 'function') opts.onClose(issue, p, msg);
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
      } else if (kind === 'win_verify') {
        issue = trimIssue(p.issueNo || msg.issueNo);
        isRobot = true;
        if (live && !revealReady[issue]) {
          pendingWin[issue] = p;
          html =
            typeof opts.buildWinVerifyCalculatingHtml === 'function'
              ? opts.buildWinVerifyCalculatingHtml(issue, p, msg)
              : '';
          winVerifyDeferred = true;
          if (!revealTimers[issue]) {
            var fb =
              typeof opts.getRevealFallbackMs === 'function'
                ? opts.getRevealFallbackMs(issue)
                : 5000;
            scheduleRevealReady(issue, fb);
          }
        } else {
          html =
            typeof opts.buildWinVerifyHtml === 'function'
              ? opts.buildWinVerifyHtml(p, msg)
              : '';
          if (typeof opts.onWinVerifyUnlocked === 'function') {
            opts.onWinVerifyUnlocked(issue, p, msg);
          }
        }
      } else {
        html =
          typeof opts.buildOtherHtml === 'function'
            ? opts.buildOtherHtml(p, msg, kind)
            : esc(String(p.text || kind));
      }

      var userName = typeof opts.getUserName === 'function' ? opts.getUserName() : '';
      var self = !msg.isRobot && msg.senderName === userName;
      if (typeof opts.appendMsg === 'function') {
        opts.appendMsg({
          name: msg.senderName || (isRobot ? opts.robotFallbackName || '机器人' : '玩家'),
          avatar: msg.senderAvatar || '',
          robot: isRobot && !self,
          self: self,
          html: html,
          time: fmtRoomChatTime(msg.createdAt),
          skipPersist: true,
        });
      }

      if (kind === 'result' && typeof opts.afterResultAppended === 'function') {
        opts.afterResultAppended({
          issue: trimIssue(p.issueNo || msg.issueNo),
          payload: p,
          msg: msg,
          live: live,
          animate: animate,
          markRevealReady: markRevealReady,
          scheduleRevealReady: scheduleRevealReady,
          setRevealPending: setRevealPending,
          setRevealReadyFlag: setRevealReadyFlag,
        });
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
          }
          msgs.forEach(function (m) {
            renderMessage(m, {
              live: !initial,
              animate: !initial && m.kind === 'result',
            });
          });
          feedReady = true;
        })
        .catch(function () {
          /* bridge 未就绪时稍后重试 */
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
      markRevealReady: markRevealReady,
      scheduleRevealReady: scheduleRevealReady,
      setRevealPending: setRevealPending,
      setRevealReadyFlag: setRevealReadyFlag,
      isRevealReady: isRevealReady,
      isFeedReady: function () {
        return feedReady;
      },
      stop: function () {
        if (pollHandle && pollHandle.stop) pollHandle.stop();
        pollHandle = null;
        Object.keys(revealTimers).forEach(function (k) {
          clearTimeout(revealTimers[k]);
          delete revealTimers[k];
        });
      },
    };
  };

  global.LotteryRoomChat = LotteryRoomChat;
})(typeof window !== 'undefined' ? window : this);
