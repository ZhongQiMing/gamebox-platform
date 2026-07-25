/**
 * 四桌共享壳：赔率单源拉取、结算覆盖、公平提示、撤销禁用、路单水合
 * 依赖：games-common.js 的 App.fetchTablePayTable / fetchMyTableBets / fetchTableSnapshot / fetchTableVerify
 */
(function (global) {
  'use strict';

  var TableShell = global.TableShell || {};

  TableShell.profitReturn = function (amount, profitOdds) {
    var a = Math.floor(Number(amount) || 0);
    var o = Number(profitOdds) || 0;
    return a + Math.floor(a * o);
  };

  TableShell.commissionReturn = function (amount, stakeMult, commission) {
    var a = Math.floor(Number(amount) || 0);
    var m = Number(stakeMult) || 0;
    var c = Number(commission);
    if (!Number.isFinite(c)) c = 0.05;
    var gross = a * (m - 1);
    return a + Math.floor(gross * (1 - c));
  };

  /** 利润倍率 →「1:0.95」 */
  TableShell.formatOddsLabel = function (profitOdds) {
    var n = Number(profitOdds);
    if (!Number.isFinite(n)) return '';
    if (Math.abs(n - Math.round(n)) < 1e-9) return '1:' + Math.round(n);
    return '1:' + String(Math.round(n * 100) / 100);
  };

  /** 含本倍数 + 抽水 → 有效利润倍率（与 commissionReturn 一致） */
  TableShell.effectiveProfitOdds = function (stakeMult, commission) {
    var m = Number(stakeMult) || 0;
    var c = Number(commission);
    if (!Number.isFinite(c)) c = 0.05;
    return Math.max(0, m - 1) * (1 - c);
  };

  /**
   * 同步下注区赔率 DOM
   * opts: { mode, map, commission? }
   * stake-mult-commission：按抽水后有效净利展示（龙/虎≈1:0.95，和≈1:7.6）
   */
  TableShell.syncOddsDom = function (root, opts) {
    opts = opts || {};
    var map = opts.map || {};
    var mode = opts.mode || 'profit-odds';
    var commission = opts.commission;
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-bet]');
    for (var i = 0; i < nodes.length; i++) {
      var btn = nodes[i];
      var key = btn.getAttribute('data-bet');
      if (!key || map[key] == null) continue;
      var oddsEl = btn.querySelector('[class*="__odds"]');
      if (!oddsEl) continue;
      var raw = Number(map[key]);
      if (mode === 'stake-mult-commission') {
        oddsEl.textContent = TableShell.formatOddsLabel(
          TableShell.effectiveProfitOdds(raw, commission),
        );
      } else {
        oddsEl.textContent = TableShell.formatOddsLabel(raw);
      }
    }
  };

  /** 从大脑拉赔率，合并进本地 odds / mult 对象，并可选同步 DOM */
  TableShell.loadPayTable = function (gameCode, targets) {
    targets = targets || {};
    if (!global.App || !App.fetchTablePayTable) {
      return Promise.resolve(null);
    }
    return App.fetchTablePayTable(gameCode).then(function (pt) {
      if (!pt) return null;
      if (pt.mode === 'profit-odds' && pt.odds && targets.odds) {
        Object.keys(pt.odds).forEach(function (k) {
          targets.odds[k] = pt.odds[k];
        });
        if (targets.syncDom !== false) {
          TableShell.syncOddsDom(targets.domRoot || document, {
            mode: 'profit-odds',
            map: targets.odds,
          });
        }
      }
      if (pt.mode === 'stake-mult-commission' && pt.mult && targets.mult) {
        Object.keys(pt.mult).forEach(function (k) {
          targets.mult[k] = pt.mult[k];
        });
        if (targets.commission != null) targets.commission.value = pt.commission;
        else targets._commission = pt.commission;
        if (targets.syncDom !== false) {
          TableShell.syncOddsDom(targets.domRoot || document, {
            mode: 'stake-mult-commission',
            map: targets.mult,
            commission: pt.commission,
          });
        }
      }
      TableShell._payTable = pt;
      return pt;
    }).catch(function () {
      return null;
    });
  };

  /** my-bets 覆盖本地结算展示 */
  TableShell.applyMyBetsSettlement = function (settlement, mine) {
    if (!settlement || !mine) return settlement;
    if (typeof mine.totalPayout === 'number') {
      settlement.returnTotal = Math.floor(mine.totalPayout);
      if (typeof mine.totalStake === 'number') settlement.stakeTotal = mine.totalStake;
      settlement.profit = settlement.returnTotal - settlement.stakeTotal;
    }
    return settlement;
  };

  TableShell.disableUndoButton = function (undoBtn) {
    if (!undoBtn) return;
    undoBtn.classList.add('is-disabled');
    undoBtn.setAttribute('aria-disabled', 'true');
    undoBtn.setAttribute('aria-label', '真账已锁，不可撤销');
    undoBtn.setAttribute('title', '真账已提交，不可撤销');
    /* UI 上已隐藏；保留禁用以防旧缓存仍显示按钮 */
    undoBtn.hidden = true;
  };

  /**
   * 房间焦点态：betting → is-live-bet；draw/payout → is-focus
   * @param {Element|null} roomEl 带 .tb-room 的房间根
   * @param {string} phase 'bet' | 'draw' | 'payout' | …
   */
  TableShell.syncFocusUi = function (roomEl, phase) {
    if (!roomEl) return;
    var p = String(phase || '');
    var focus = p === 'draw' || p === 'payout';
    roomEl.classList.toggle('is-focus', focus);
    roomEl.classList.toggle('is-live-bet', p === 'bet' && !focus);
  };

  /** 服务器相位时钟（优先于本地墙钟） */
  TableShell.createServerClock = function () {
    return { phase: '', secondsLeft: 0, syncedAt: 0, roundNo: '', timing: null };
  };

  TableShell.applyServerSnap = function (clock, snap) {
    if (!clock || !snap) return clock;
    clock.phase = String(snap.phase || '');
    clock.secondsLeft = Number(snap.secondsLeft) || 0;
    clock.syncedAt = Date.now();
    clock.roundNo = snap.roundNo ? String(snap.roundNo) : '';
    if (snap.timing) clock.timing = snap.timing;
    return clock;
  };

  /** 下注剩余秒：有近期 snapshot 用服务器；否则 fallbackFn() */
  TableShell.bettingLeftSec = function (clock, fallbackFn) {
    if (clock && clock.syncedAt && clock.phase === 'BETTING') {
      return Math.max(0, clock.secondsLeft - (Date.now() - clock.syncedAt) / 1000);
    }
    if (clock && (clock.phase === 'DRAWING' || clock.phase === 'SETTLED')) {
      return 0;
    }
    return typeof fallbackFn === 'function' ? Number(fallbackFn()) || 0 : 0;
  };

  /**
   * 下注期轮询 snapshot；返回 timer id（clearInterval）
   * opts.shouldPoll() 返回 false 时跳过本次
   */
  TableShell.startSnapshotPoll = function (gameCode, onSnap, opts) {
    var ms = (opts && opts.intervalMs) || 1500;
    function pull() {
      if (!global.App || !App.fetchTableSnapshot) return;
      if (opts && typeof opts.shouldPoll === 'function' && !opts.shouldPoll()) return;
      App.fetchTableSnapshot(gameCode)
        .then(function (snap) {
          if (onSnap) onSnap(snap);
        })
        .catch(function () { /* 忽略瞬时失败，保留本地兜底 */ });
    }
    pull();
    return setInterval(pull, ms);
  };

  TableShell.toastNoUndo = function () {
    if (global.App && App.toast) App.toast('已提交真账，不可撤销');
  };

  /** 公平提示文案 */
  TableShell.fairLine = function (snap) {
    if (!snap || !snap.serverSeedHash) return '';
    var shortHash = String(snap.serverSeedHash).slice(0, 10);
    if (snap.serverSeed) {
      return '本局已开奖 · seed已公开 · hash ' + shortHash + '…';
    }
    return '本局承诺 hash ' + shortHash + '…（封盘后公开种子）';
  };

  /** 从 outcome 提取珠盘结果键 */
  TableShell.resultFromOutcome = function (outcome) {
    if (!outcome || typeof outcome !== 'object') return '';
    var r = outcome.result;
    if (r === 'banker' || r === 'player' || r === 'tie') return r;
    if (r === 'dragon' || r === 'tiger') return r;
    if (outcome.winner === 'DRAGON' || outcome.winner === 'dragon') return 'dragon';
    if (outcome.winner === 'TIGER' || outcome.winner === 'tiger') return 'tiger';
    if (outcome.winner === 'TIE' || outcome.winner === 'tie') return 'tie';
    return '';
  };

  /**
   * 服务端 history（新→旧）→ 珠盘序列（旧→新）+ 统计
   * allowed: 允许的结果键集合，如 { banker:1, player:1, tie:1 }
   */
  TableShell.roadFromHistory = function (history, allowed) {
    allowed = allowed || { banker: 1, player: 1, tie: 1, dragon: 1, tiger: 1 };
    var list = Array.isArray(history) ? history.slice() : [];
    var seq = [];
    var stats = {};
    Object.keys(allowed).forEach(function (k) { stats[k] = 0; });
    var roundNos = [];
    for (var i = list.length - 1; i >= 0; i--) {
      var item = list[i];
      if (!item) continue;
      var res = TableShell.resultFromOutcome(item.outcome);
      if (!res || !allowed[res]) continue;
      seq.push(res);
      stats[res] = (stats[res] || 0) + 1;
      if (item.roundNo) roundNos.push(String(item.roundNo));
    }
    return { seq: seq, stats: stats, roundNos: roundNos };
  };

  /**
   * 拉取 snapshot 并水合路单
   * apply({ seq, stats, roundNos, snap })
   */
  TableShell.hydrateRoad = function (gameCode, allowed, apply) {
    if (!global.App || !App.fetchTableSnapshot) {
      return Promise.resolve(null);
    }
    return App.fetchTableSnapshot(gameCode).then(function (snap) {
      if (!snap) return null;
      var packed = TableShell.roadFromHistory(snap.history, allowed);
      if (typeof apply === 'function') {
        apply({
          seq: packed.seq,
          stats: packed.stats,
          roundNos: packed.roundNos,
          snap: snap,
        });
      }
      return { snap: snap, road: packed };
    }).catch(function () {
      return null;
    });
  };

  /** 组装验算弹层 HTML 片段（纯文案） */
  TableShell.buildVerifyHtml = function (info, classPrefix) {
    var p = classPrefix || 'tbl';
    info = info || {};
    var lines = [];
    lines.push('<p class="' + p + '-rules__intro"><b>可证明公平</b></p>');
    if (info.roundNo) {
      lines.push('<p class="' + p + '-rules__intro">局号：' + String(info.roundNo) + '</p>');
    }
    if (info.serverSeedHash) {
      lines.push(
        '<p class="' + p + '-rules__intro">承诺 Hash：<code style="word-break:break-all;font-size:11px">' +
          String(info.serverSeedHash) + '</code></p>',
      );
    }
    if (info.serverSeed) {
      lines.push(
        '<p class="' + p + '-rules__intro">公开 Seed：<code style="word-break:break-all;font-size:11px">' +
          String(info.serverSeed) + '</code></p>',
      );
    } else {
      lines.push('<p class="' + p + '-rules__intro">下注期仅公开 Hash；封盘开奖后公开 Seed，可用 Hash 核验。</p>');
    }
    if (typeof info.nonce === 'number') {
      lines.push('<p class="' + p + '-rules__intro">Nonce：' + info.nonce + '</p>');
    }
    if (info.hashMatches != null) {
      lines.push(
        '<p class="' + p + '-rules__intro">Hash 校验：' +
          (info.hashMatches ? '通过 ✓' : '失败 ✗') + '</p>',
      );
    } else if (!info.serverSeed) {
      lines.push('<p class="' + p + '-rules__intro">Hash 校验：下注期暂不可验（需封盘后对照 Seed）</p>');
    }
    if (info.outcomeMatches != null) {
      lines.push(
        '<p class="' + p + '-rules__intro">开奖复算：' +
          (info.outcomeMatches ? '牌面与结果一致 ✓' : '牌面或结果不一致 ✗') + '</p>',
      );
    } else if (info.serverSeed) {
      lines.push('<p class="' + p + '-rules__intro">开奖复算：暂无存档结果可对照</p>');
    }
    if (info.fairLine) {
      lines.push('<p class="' + p + '-rules__intro">' + info.fairLine + '</p>');
    }
    return lines.join('');
  };

  global.TableShell = TableShell;
})(typeof window !== 'undefined' ? window : this);
