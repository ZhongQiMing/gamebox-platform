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
    undoBtn.hidden = false;
    undoBtn.classList.add('is-disabled');
    undoBtn.setAttribute('aria-disabled', 'true');
    undoBtn.setAttribute('aria-label', '真账已锁，不可撤销');
    undoBtn.setAttribute('title', '真账已提交，不可撤销');
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

  /** 房间托人数（0~50）；缺省按 14 */
  TableShell.normalizeRobotCount = function (n) {
    var v = Math.floor(Number(n));
    if (!Number.isFinite(v)) return 14;
    return Math.min(50, Math.max(0, v));
  };

  /**
   * 气氛飞筹节奏：托人越多越密。
   * 仍是本地假筹，只影响观感；0 人几乎不飞。
   */
  TableShell.otherBetPace = function (robotCount) {
    var n = TableShell.normalizeRobotCount(robotCount);
    if (n <= 0) {
      return { minWait: 12000, spanWait: 8000, burstMin: 0, burstMax: 0, maxPerSide: 2 };
    }
    var t = Math.min(1, n / 40);
    return {
      minWait: Math.round(2000 - t * 1500),
      spanWait: Math.round(2800 - t * 2000),
      burstMin: 1,
      burstMax: Math.min(4, 1 + Math.floor(t * 3)),
      maxPerSide: Math.min(16, 8 + Math.floor(t * 8)),
    };
  };

  /** 右上角气氛人数底数（随托人数走） */
  TableShell.atmospherePlayersBase = function (robotCount) {
    var n = TableShell.normalizeRobotCount(robotCount);
    if (n <= 0) return 10;
    return Math.max(18, Math.min(96, n + 6));
  };

  /**
   * 下注剩余秒：有近期 snapshot 用服务器；否则 fallbackFn()。
   * 开奖动画期间常停轮询，BETTING 倒计时会在本地耗尽；若仍死守 0，
   * 会与本地「仍在下注窗」对齐打架，把 UI 锁死在「准备中」。
   */
  TableShell.bettingLeftSec = function (clock, fallbackFn) {
    function fallback() {
      return typeof fallbackFn === 'function' ? Number(fallbackFn()) || 0 : 0;
    }
    if (clock && clock.syncedAt && clock.phase === 'BETTING') {
      var elapsed = (Date.now() - clock.syncedAt) / 1000;
      var left = clock.secondsLeft - elapsed;
      if (left > 0) return left;
      /* 同步偏旧且倒计时已尽：改用本地对齐，避免永久返回 0 */
      if (elapsed > Number(clock.secondsLeft) + 1.5) return fallback();
      return 0;
    }
    if (clock && clock.syncedAt && (clock.phase === 'DRAWING' || clock.phase === 'SETTLED')) {
      var age = (Date.now() - clock.syncedAt) / 1000;
      if (age > 3) return fallback();
      return 0;
    }
    return fallback();
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

  /** Asia/Shanghai 当日 YYYYMMDD */
  TableShell.shanghaiYmd = function (ms) {
    var d = new Date(typeof ms === 'number' ? ms : Date.now());
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    var get = function (t) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value;
      return '01';
    };
    return get('year') + get('month') + get('day');
  };

  /** 从局号取出 YYYYMMDD（BJL20260802-0042） */
  TableShell.roundNoYmd = function (roundNo) {
    var m = String(roundNo || '').match(/(\d{8})-/);
    return m ? m[1] : '';
  };

  TableShell.historyItemYmd = function (item) {
    if (!item) return '';
    var fromRound = TableShell.roundNoYmd(item.roundNo);
    if (fromRound) return fromRound;
    if (item.createdAt) {
      var ts = Date.parse(item.createdAt);
      if (isFinite(ts)) return TableShell.shanghaiYmd(ts);
    }
    return '';
  };

  /**
   * 主路单视口列数（高度定格子，宽度定可见列）
   * 固定不滚动：写到倒数第二列满后左移窗口
   */
  TableShell.measureRoadViewCols = function (scrollEl, rows) {
    rows = rows || 6;
    var gap = 2;
    var h = scrollEl && scrollEl.clientHeight ? scrollEl.clientHeight : 0;
    var w = scrollEl && scrollEl.clientWidth ? scrollEl.clientWidth : 0;
    var cell = h > 8 ? (h - 6 - (rows - 1) * gap) / rows : 22;
    if (!(cell > 4)) cell = 22;
    if (!(w > 8)) return 12;
    return Math.max(8, Math.floor((w + gap) / (cell + gap)));
  };

  /** 珠盘视口序列：最多填满「总列数 - 1」列，末列留空 */
  TableShell.roadBeadViewSeq = function (seq, viewCols, rows) {
    seq = Array.isArray(seq) ? seq : [];
    rows = rows || 6;
    var maxFilled = Math.max(1, (viewCols || 12) - 1);
    var maxBeads = maxFilled * rows;
    if (seq.length <= maxBeads) return seq.slice();
    return seq.slice(seq.length - maxBeads);
  };

  /** 大路视口列：同样只保留最近「总列数 - 1」列 */
  TableShell.roadBigViewCols = function (colsData, viewCols) {
    colsData = Array.isArray(colsData) ? colsData : [];
    var maxFilled = Math.max(1, (viewCols || 12) - 1);
    if (colsData.length <= maxFilled) return colsData.slice();
    return colsData.slice(colsData.length - maxFilled);
  };

  /**
   * 服务端 history（新→旧）→ 珠盘序列（旧→新）+ 当日统计
   * allowed: 允许的结果键集合，如 { banker:1, player:1, tie:1 }
   */
  TableShell.roadFromHistory = function (history, allowed) {
    allowed = allowed || { banker: 1, player: 1, tie: 1, dragon: 1, tiger: 1 };
    var list = Array.isArray(history) ? history.slice() : [];
    var today = TableShell.shanghaiYmd();
    var seq = [];
    var stats = {};
    Object.keys(allowed).forEach(function (k) { stats[k] = 0; });
    var roundNos = [];
    for (var i = list.length - 1; i >= 0; i--) {
      var item = list[i];
      if (!item) continue;
      var ymd = TableShell.historyItemYmd(item);
      if (ymd && ymd !== today) continue;
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

  /**
   * 正式玩法规则 HTML（牌桌类共用）
   * @param {{
   *   sections?: Array<{ title: string, paragraphs?: string[], list?: string[] }>,
   *   oddsHeaders?: string[],
   *   oddsRows?: string[][],
   *   notes?: string[],
   * }} opts
   */
  TableShell.buildFormalRulesHtml = function (opts) {
    opts = opts || {};
    var html = ['<div class="tb-rules">'];
    (opts.sections || []).forEach(function (sec) {
      if (!sec || !sec.title) return;
      html.push('<section class="tb-rules__sec">');
      html.push('<h3 class="tb-rules__title">' + sec.title + '</h3>');
      (sec.paragraphs || []).forEach(function (p) {
        html.push('<p class="tb-rules__p">' + p + '</p>');
      });
      if (sec.list && sec.list.length) {
        html.push('<ul class="tb-rules__list">');
        sec.list.forEach(function (li) {
          html.push('<li>' + li + '</li>');
        });
        html.push('</ul>');
      }
      html.push('</section>');
    });
    if (opts.oddsRows && opts.oddsRows.length) {
      var headers = opts.oddsHeaders || ['玩法', '说明', '赔率'];
      var oddsIdx = headers.indexOf('赔率');
      if (oddsIdx < 0) oddsIdx = headers.length - 1;
      html.push('<section class="tb-rules__sec">');
      html.push('<h3 class="tb-rules__title">玩法与赔率</h3>');
      html.push(
        '<p class="tb-rules__p">赔率按「押 1 净得 X」标注（不含本金）；派彩以当局结算为准。</p>',
      );
      html.push('<div class="tb-rules__table-wrap"><table class="tb-rules__table"><thead><tr>');
      headers.forEach(function (h, i) {
        html.push('<th' + (i === oddsIdx ? ' class="odds"' : '') + '>' + h + '</th>');
      });
      html.push('</tr></thead><tbody>');
      opts.oddsRows.forEach(function (row) {
        html.push('<tr>');
        (row || []).forEach(function (cell, i) {
          html.push('<td' + (i === oddsIdx ? ' class="odds"' : '') + '>' + cell + '</td>');
        });
        html.push('</tr>');
      });
      html.push('</tbody></table></div></section>');
    }
    if (opts.notes && opts.notes.length) {
      html.push('<section class="tb-rules__sec">');
      html.push('<h3 class="tb-rules__title">温馨提示</h3>');
      html.push('<ul class="tb-rules__list">');
      opts.notes.forEach(function (n) {
        html.push('<li>' + n + '</li>');
      });
      html.push('</ul></section>');
    }
    html.push('</div>');
    return html.join('');
  };

  /* ===== 音频：个人中心为默认，本游戏可单独覆盖 ===== */
  TableShell.APP_BGM_OFF_KEY = 'app_bgm_off';
  TableShell.APP_SFX_OFF_KEY = 'sound_off';

  TableShell.isAppBgmOn = function () {
    try { return localStorage.getItem(TableShell.APP_BGM_OFF_KEY) !== '1'; }
    catch (e) { return true; }
  };

  TableShell.isAppSfxOn = function () {
    try { return localStorage.getItem(TableShell.APP_SFX_OFF_KEY) !== '1'; }
    catch (e) { return true; }
  };

  TableShell.hasStoredAudioPref = function (storageKey) {
    try {
      var raw = localStorage.getItem(storageKey);
      return !!(raw && raw !== 'null');
    } catch (e) {
      return false;
    }
  };

  /**
   * 无本游戏记录 → 跟随账号管理（背景音乐 / 点击音效）；
   * 有本游戏记录 → 只认本游戏开关。
   */
  TableShell.loadAudioPref = function (storageKey) {
    var music = TableShell.isAppBgmOn();
    var sfx = TableShell.isAppSfxOn();
    try {
      var raw = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (raw && typeof raw === 'object') {
        if (typeof raw.music === 'boolean') music = raw.music;
        if (typeof raw.sfx === 'boolean') sfx = raw.sfx;
      }
    } catch (e) { /* ignore */ }
    return { music: !!music, sfx: !!sfx };
  };

  TableShell.saveAudioPref = function (storageKey, pref) {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        music: !!(pref && pref.music),
        sfx: !!(pref && pref.sfx),
      }));
    } catch (e) { /* ignore */ }
  };

  TableShell.buildAudioSettingsHtml = function (pref) {
    pref = pref || { music: true, sfx: true };
    return (
      '<div class="tb-settings">' +
        '<div class="tb-settings__row"><span class="tb-settings__label">背景音乐</span>' +
          '<button type="button" class="tb-switch' + (pref.music ? ' is-on' : '') +
          '" id="tbSwMusic" role="switch" aria-checked="' + !!pref.music + '"></button></div>' +
        '<div class="tb-settings__row"><span class="tb-settings__label">游戏音效</span>' +
          '<button type="button" class="tb-switch' + (pref.sfx ? ' is-on' : '') +
          '" id="tbSwSfx" role="switch" aria-checked="' + !!pref.sfx + '"></button></div>' +
      '</div>'
    );
  };

  TableShell.bindAudioSettings = function (opts) {
    opts = opts || {};
    function wire(id, setter) {
      var el = document.getElementById(id);
      if (!el || typeof setter !== 'function') return;
      el.addEventListener('click', function () {
        var on = !el.classList.contains('is-on');
        el.classList.toggle('is-on', on);
        el.setAttribute('aria-checked', String(on));
        setter(on);
      });
    }
    wire('tbSwMusic', opts.onMusic);
    wire('tbSwSfx', opts.onSfx);
  };

  /** 未单独设置过本游戏时，跟随账号管理变更（不写本游戏 storage） */
  TableShell.watchAppAudioPref = function (storageKey, apply) {
    if (typeof apply !== 'function') return;
    function sync() {
      if (TableShell.hasStoredAudioPref(storageKey)) return;
      apply(TableShell.loadAudioPref(storageKey));
    }
    window.addEventListener('storage', function (ev) {
      if (!ev) return;
      if (ev.key === TableShell.APP_BGM_OFF_KEY || ev.key === TableShell.APP_SFX_OFF_KEY) sync();
    });
    window.addEventListener('app-audio-pref-changed', sync);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) sync();
    });
  };

  global.TableShell = TableShell;
})(typeof window !== 'undefined' ? window : this);
