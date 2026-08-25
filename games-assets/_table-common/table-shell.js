/**
 * 四桌共享壳：赔率单源拉取、结算覆盖、公平提示、撤销禁用、路单水合
 * 依赖：games-common.js 的 App.fetchTablePayTable / fetchMyTableBets / fetchTableSnapshot / fetchTableVerify
 */
(function (global) {
  'use strict';

  var TableShell = global.TableShell || {};

  /* ───────── 相位横幅 ───────── */

  /**
   * 预热横幅图的解码。
   *
   * 「开始下注」「停止下注」两张图各自常驻一个 <img>，显示时只切换哪个可见，绝不改 src。
   * 之所以不能共用一个 <img> 改 src：赋值是异步的，新图解码完成前元素仍在画上一张，
   * 于是「开始下注」的语音配着上一局残留的「停止下注」图（这张图 1503×721，模拟器上
   * 解码要几百毫秒，必现）。改 src 无论怎么等解码都存在时序缝隙，换成两个元素后，
   * 最坏情况只是横幅晚半拍出现，绝不会出现「声画对不上」。
   *
   * decode() 不依赖元素是否可见，所以进游戏时就能把两张都解好。
   */
  TableShell.warmBannerImages = function (imgs) {
    (imgs || []).forEach(function (img) {
      if (!img || typeof img.decode !== 'function') return;
      img.decode().catch(function () {});
    });
  };

  /**
   * 顶栏金额显示：千分位 + 固定两位小数。
   * 全项目统一——彩票类一直是两位小数，牌桌类原先按整数取整，会把角分抹掉。
   */
  TableShell.fmtMoney2 = function (n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    if (!isFinite(v)) v = 0;
    return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

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

  /**
   * 单边限红。
   *
   * 高赔低频的边（顺金/豹子 500、小牛/五花 200、牛牛 2000、和 5000）
   * 服务端本来就卡，但前端不拦的话玩家点下去才被退回，筹码已经飞出去了。
   * 这里把 /pay-table 的 sideMaxBet 记下来，落筹前先判一次。
   *
   * @param {Record<string, string>} labels 边 key → 中文名，用于提示文案
   * @param {Record<string, number>} [fallback] 拉不到赔率表时的兜底限额
   */
  TableShell.createSideLimits = function (labels, fallback) {
    var caps = {};
    var base = fallback || {};
    Object.keys(base).forEach(function (k) { caps[k] = base[k]; });
    return {
      apply: function (pt) {
        var next = pt && pt.sideMaxBet;
        if (!next) return;
        Object.keys(next).forEach(function (k) { caps[k] = next[k]; });
      },
      capOf: function (key) {
        var c = Number(caps[key]);
        return c > 0 ? c : 0;
      },
      /** 超限返回提示文案；未超返回空串 */
      reject: function (key, nextTotal) {
        var cap = Number(caps[key]);
        if (!(cap > 0)) return '';
        if (Number(nextTotal) <= cap) return '';
        return ((labels && labels[key]) || key) + ' 单边限注 ' + cap;
      },
    };
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

  /**
   * 撤销按钮状态：只在下注期且本局有自己的挂单时可点。
   * 之前这颗按钮被无条件禁用（真账不可撤销），现在服务端支持封盘前撤单。
   */
  TableShell.syncUndoButton = function (undoBtn, canUndo, busy) {
    if (!undoBtn) return;
    undoBtn.hidden = false;
    var on = !!canUndo && !busy;
    undoBtn.classList.toggle('is-disabled', !on);
    undoBtn.setAttribute('aria-disabled', on ? 'false' : 'true');
    var label = busy ? '撤销中…' : (on ? '撤销本局下注' : '本局暂无可撤销的下注');
    undoBtn.setAttribute('aria-label', busy ? '撤销中' : '撤销');
    undoBtn.setAttribute('title', label);
  };

  /**
   * 移除桌面上「自己」的筹码图，气氛筹码（data-owner=other）保留。
   * @param {Element} root 下注区根节点
   * @param {string} chipsSelector 单个下注区里放筹码的容器选择器
   */
  TableShell.removeMyChipVisuals = function (root, chipsSelector) {
    if (!root) return 0;
    var boxes = root.querySelectorAll(chipsSelector);
    var removed = 0;
    for (var i = 0; i < boxes.length; i++) {
      var mine = boxes[i].querySelectorAll('img[data-owner="me"]');
      for (var j = 0; j < mine.length; j++) {
        mine[j].parentNode.removeChild(mine[j]);
        removed++;
      }
    }
    return removed;
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

  /**
   * 服务器相位时钟。
   *
   * 牌桌一切时序都从这里推导，本地不再自己累加倒计时：
   * 每一局的绝对起点由服务端局号唯一确定（局号 = 该局在当天的第几个整周期），
   * 界面只回答「按服务端的钟，现在走到这一局的第几毫秒」。
   * 这样网络抖动、丢包、切后台、慢机器都只影响画面追赶的快慢，不会让流程错乱。
   */
  TableShell.createServerClock = function () {
    return {
      phase: '', secondsLeft: 0, syncedAt: 0, roundNo: '', timing: null,
      /** 服务端时间 - 本地时间；靠快照估出来 */
      offsetMs: 0,
      /** 已经对上过时；没对上前先按本地钟走，不至于卡死 */
      synced: false,
      /** 最近一次估计的往返耗时，用来挑更可信的样本 */
      bestRtt: Infinity,
    };
  };

  /** 同一局内相位只会往后走；PAUSED 是维护，任何时候都得认 */
  var PHASE_RANK = { BETTING: 1, DRAWING: 2, SETTLED: 3 };

  /** 局号 `{前缀}{YYYYMMDD}-{序号}` → 可比较的数值；解析不出返回 null */
  function roundOrder(roundNo) {
    var m = String(roundNo || '').match(/(\d{8})-(\d+)$/);
    return m ? Number(m[1]) * 1e6 + Number(m[2]) : null;
  }

  /** 整局毫秒；timing 缺失时用兜底值 */
  TableShell.cycleMsOf = function (timing, fallbackMs) {
    if (!timing) return fallbackMs || 60000;
    var c = Number(timing.bettingMs) + Number(timing.drawMs) + Number(timing.settleMs);
    return c > 0 ? c : (fallbackMs || 60000);
  };

  /**
   * 从局号还原这一局的绝对起点（毫秒），精确到毫秒。
   *
   * 服务端的开局网格对齐 Unix 纪元：起点 = floor(时刻 / 整局时长) × 整局时长；
   * 局号里的当日序号则是 floor((起点 - 当日零点) / 整局时长) + 1。
   * 当日零点通常不在这个网格上，所以不能拿「零点 + (序号-1)×整局」当起点。
   * 但序号圈定的这段区间长度正好是一个整局，里面有且只有一个网格点，取它就是精确值。
   */
  TableShell.roundStartAtOf = function (roundNo, cycleMs) {
    var m = String(roundNo || '').match(/(\d{4})(\d{2})(\d{2})-(\d+)$/);
    if (!m || !(cycleMs > 0)) return null;
    var dayStart = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T00:00:00+08:00');
    if (!Number.isFinite(dayStart)) return null;
    var lo = dayStart + (Number(m[4]) - 1) * cycleMs;
    return Math.ceil(lo / cycleMs) * cycleMs;
  };

  /** 这一局已经走了多少毫秒（按快照里的相位与剩余秒数推） */
  function elapsedInRound(phase, secondsLeft, timing) {
    var b = Number(timing.bettingMs);
    var d = Number(timing.drawMs);
    var s = Number(timing.settleMs);
    /*
     * 服务端的剩余秒数是向上取整的，真实剩余落在 (n-1, n] 秒内，取中点误差最小。
     */
    var remain = Math.max(0, (Number(secondsLeft) || 0) - 0.5) * 1000;
    if (phase === 'BETTING') return b - remain;
    if (phase === 'DRAWING') return b + d - remain;
    if (phase === 'SETTLED') return b + d + s - remain;
    return null;
  }

  /**
   * 用一次快照校时。
   * @param sentAt 请求发出的时刻；快照反映的是大约 sentAt + 半个往返 时的服务端状态
   */
  TableShell.syncClock = function (clock, snap, sentAt, recvAt) {
    if (!clock || !snap || !clock.timing) return;
    var cycle = TableShell.cycleMsOf(clock.timing);
    var startAt = TableShell.roundStartAtOf(snap.roundNo, cycle);
    var tIn = elapsedInRound(String(snap.phase || ''), snap.secondsLeft, clock.timing);
    if (startAt == null || tIn == null) return;

    recvAt = recvAt || Date.now();
    sentAt = sentAt || recvAt;
    var rtt = Math.max(0, recvAt - sentAt);
    var sampledAt = sentAt + rtt / 2;
    var offset = (startAt + tIn) - sampledAt;

    if (!clock.synced) {
      clock.offsetMs = offset;
      clock.synced = true;
      clock.bestRtt = rtt;
      return;
    }
    /*
     * 只认更快的那次往返，慢样本噪声大。往返差不多时做慢平滑，
     * 避免个别抖动把时间基准拽走造成画面跳帧。
     */
    if (rtt <= clock.bestRtt) {
      clock.bestRtt = rtt;
      clock.offsetMs = offset;
    } else {
      clock.offsetMs += (offset - clock.offsetMs) * 0.1;
      clock.bestRtt = clock.bestRtt * 0.9 + rtt * 0.1;
    }
  };

  /** 按服务端的钟，现在几点 */
  TableShell.serverNow = function (clock) {
    return Date.now() + ((clock && clock.offsetMs) || 0);
  };

  /**
   * 现在处在哪一局、走到第几毫秒。
   * 返回 null 表示 timing 还没到手，调用方应先等快照。
   */
  TableShell.roundPositionOf = function (clock) {
    if (!clock || !clock.timing) return null;
    var timing = clock.timing;
    var cycle = TableShell.cycleMsOf(timing);
    var now = TableShell.serverNow(clock);
    var startAt = Math.floor(now / cycle) * cycle;
    var tIn = now - startAt;
    var b = Number(timing.bettingMs);
    var d = Number(timing.drawMs);
    var phase = tIn < b ? 'BETTING' : (tIn < b + d ? 'DRAWING' : 'SETTLED');
    return {
      startAt: startAt,
      tIn: tIn,
      cycleMs: cycle,
      phase: phase,
      /** 下注剩余毫秒（非下注期为 0） */
      betLeftMs: phase === 'BETTING' ? b - tIn : 0,
      /** 开奖已进行毫秒（下注期为 0） */
      drawElapsedMs: phase === 'BETTING' ? 0 : tIn - b,
    };
  };

  /**
   * 用快照对时。迟到的快照必须丢掉，否则时钟会倒退。
   *
   * 轮询 1.5s 一次，响应还可能乱序，于是「上一局 SETTLED」会盖掉「新一局 BETTING」。
   * 客户端一看剩余时间成 0，立刻当作下注结束开下一轮开奖：刚弹出的「开始下注」被
   * 「停止下注」顶掉（实测两者只隔 199ms，倒计时从 44 秒直接跳到「开奖中」）。
   */
  TableShell.applyServerSnap = function (clock, snap) {
    if (!clock || !snap) return clock;
    var nextPhase = String(snap.phase || '');
    var nextNo = snap.roundNo ? String(snap.roundNo) : '';
    if (nextPhase !== 'PAUSED') {
      var cur = roundOrder(clock.roundNo);
      var next = roundOrder(nextNo);
      if (cur != null && next != null) {
        if (next < cur) return clock;
        if (next === cur && (PHASE_RANK[nextPhase] || 0) < (PHASE_RANK[clock.phase] || 0)) {
          return clock;
        }
      }
    }
    clock.phase = nextPhase;
    clock.secondsLeft = Number(snap.secondsLeft) || 0;
    clock.syncedAt = Date.now();
    clock.roundNo = nextNo;
    if (snap.timing) clock.timing = snap.timing;
    return clock;
  };

  /**
   * 顶栏 2x2 积分区自适应缩放。
   *
   * 积分/输赢/流水/回水 要按七位整数加两位小数预留位置，窄屏上这个宽度放不下，
   * 溢出后右列（流水/回水）会被屏幕边缘切掉，甚至整列看不见。这里按内容量出自然
   * 宽度，超出可用空间就等比缩到刚好放下——宽屏保持原始字号，窄屏只是整体略小，
   * 任何屏宽都不会切数字。
   *
   * @param {{head:Element, stats:Element, brand?:Element}} opts
   * @returns {{refit:Function}}
   */
  TableShell.createStatsFitter = function (opts) {
    opts = opts || {};
    var head = opts.head;
    var stats = opts.stats;
    var brand = opts.brand;
    if (!head || !stats) return { refit: function () {} };

    function measureAndFit() {
      /* 拿不到样式或尺寸的环境（如无 DOM 的测试沙箱）直接跳过，不影响游戏流程 */
      if (typeof global.getComputedStyle !== 'function') return;
      if (typeof head.clientWidth !== 'number') return;

      /* 先复原，否则量到的是上一次缩放后的尺寸 */
      stats.style.width = '';
      stats.style.transform = '';
      stats.style.transformOrigin = '';

      /*
       * 四项数值列统一成同一宽度。
       * 每个格子各是一个独立网格，若让标签列吸收剩余空间，标签文字就会被数值长度
       * 推着走——同一列里「积分」和「输赢」会一前一后错开。统一数值列宽后，
       * 标签按内容左对齐、数字在固定宽度里右对齐，两者各自成线。
       */
      stats.style.removeProperty('--tb-stat-vw');
      var vals = stats.querySelectorAll('.v');
      var widest = 0;
      for (var i = 0; i < vals.length; i++) {
        var w = vals[i].getBoundingClientRect().width;
        if (w > widest) widest = w;
      }
      if (widest > 0) {
        stats.style.setProperty('--tb-stat-vw', Math.ceil(widest) + 'px');
      }

      var cs = global.getComputedStyle(head);
      if (!cs) return;
      var padL = parseFloat(cs.paddingLeft) || 0;
      var padR = parseFloat(cs.paddingRight) || 0;
      var gap = parseFloat(cs.columnGap) || parseFloat(cs.gap) || 0;
      var brandW = brand ? brand.getBoundingClientRect().width : 0;
      var avail = head.clientWidth - padL - padR - brandW - (brandW ? gap : 0);
      var natural = stats.scrollWidth;
      if (!(avail > 0) || !(natural > 0)) return;

      var scale = Math.min(1, avail / natural);
      if (scale >= 0.999) return;
      /* 占位宽度跟着缩，否则 flex 仍按原宽排版，照样顶出屏幕 */
      stats.style.width = (natural * scale) + 'px';
      stats.style.transformOrigin = 'left center';
      stats.style.transform = 'scale(' + scale + ')';
    }

    var pending = 0;
    function schedule() {
      if (pending) return;
      pending = global.requestAnimationFrame
        ? global.requestAnimationFrame(function () { pending = 0; measureAndFit(); })
        : setTimeout(function () { pending = 0; measureAndFit(); }, 16);
    }

    global.addEventListener('resize', schedule);
    /* 字体晚于首帧就绪时字宽会变，就绪后再量一次 */
    if (global.document && document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(schedule).catch(function () {});
    }
    schedule();
    return { refit: schedule };
  };

  /**
   * 筹码自适应降档：选中面额超过可用余额时，退到不超过余额的最大一档。
   * 只降不升——赢钱后不擅自替玩家加大注码。
   * @param {number[][]} pages 筹码分页（各页面额）
   * @param {number} bal 可用余额（已扣掉在途下注）
   * @returns {number} 目标面额；一分都下不起返回 0
   */
  TableShell.affordableChip = function (pages, bal) {
    var all = [];
    (pages || []).forEach(function (p) { all = all.concat(p || []); });
    all.sort(function (a, b) { return b - a; });
    var n = Number(bal);
    if (!Number.isFinite(n)) return 0;
    for (var i = 0; i < all.length; i++) {
      if (all[i] <= n) return all[i];
    }
    return 0;
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

  /*
   * 外壳把本页 keep-alive 起来后，iframe 仍在跑但玩家已经回大厅了。
   * iframe 内的 document.hidden 此时是 false（浏览器还在前台），游戏自己判断不出来，
   * 只能靠父页发来的 pause/resume。不停表的话每个玩过的牌桌都会留一份 1s 轮询。
   */
  var shellPaused = false;

  global.addEventListener('message', function (ev) {
    var parentOrigin = (global.App && global.App.parentOrigin) || location.origin;
    if (!ev || ev.origin !== parentOrigin || ev.source !== global.parent) return;
    var data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'assets-game-pause') shellPaused = true;
    else if (data.type === 'assets-game-resume') shellPaused = false;
  });

  TableShell.isShellPaused = function () { return shellPaused; };

  /**
   * 下注期轮询 snapshot；返回 timer id（clearInterval）
   * opts.shouldPoll() 返回 false 时跳过本次
   */
  TableShell.startSnapshotPoll = function (gameCode, onSnap, opts) {
    var ms = (opts && opts.intervalMs) || 1500;
    /* 上一枪没回来就不再发：弱网下 1s 间隔很容易堆成一串并发请求 */
    var inFlight = false;
    function pull() {
      if (!global.App || !App.fetchTableSnapshot) return;
      if (shellPaused || document.hidden) return;
      if (inFlight) return;
      if (opts && typeof opts.shouldPoll === 'function' && !opts.shouldPoll()) return;
      inFlight = true;
      /* 记下发出时刻：校时要扣掉半个往返，否则慢网下时间基准会整体偏后 */
      var sentAt = Date.now();
      App.fetchTableSnapshot(gameCode)
        .then(function (snap) {
          if (onSnap) onSnap(snap, { sentAt: sentAt, recvAt: Date.now() });
        })
        .catch(function () { /* 忽略瞬时失败，保留本地兜底 */ })
        .then(function () { inFlight = false; });
    }
    pull();
    return setInterval(pull, ms);
  };

  TableShell.toastNoUndo = function () {
    if (global.App && App.toast) App.toast('已提交真账，不可撤销');
  };

  /**
   * 公平提示文案；下注期没有种子与指纹，不显示。
   *
   * 措辞刻意只说「可复算」，不说「预承诺」：种子是封盘时才生成的，
   * 下注前并不存在可承诺之物。宣称做不到的事，在纠纷里比从不宣称严重得多。
   */
  TableShell.fairLine = function (snap) {
    if (!snap || !snap.serverSeedHash) return '';
    var shortHash = String(snap.serverSeedHash).slice(0, 10);
    if (snap.serverSeed) {
      return '本局已开奖 · seed已公开 · hash ' + shortHash + '…';
    }
    return 'hash ' + shortHash + '…';
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

  /**
   * 珠盘视口序列：最多填满「总列数 - 1」列，末列留空。
   *
   * 满了之后必须按「整列」往前推，不能按颗推。
   * 珠盘是竖着填的（每列 rows 颗），原先这里是 slice(length - maxBeads)，也就是每来一颗
   * 就丢掉最旧的一颗；珠子整体前移一格，列的分组跟着全部错位，看着像所有珠子往上挪了
   * 一格，而不是最旧那一列被推出去。这里把丢弃数向上取整到整列，列内位置就不会变。
   */
  TableShell.roadBeadViewSeq = function (seq, viewCols, rows) {
    seq = Array.isArray(seq) ? seq : [];
    rows = rows || 6;
    var maxFilled = Math.max(1, (viewCols || 12) - 1);
    var maxBeads = maxFilled * rows;
    if (seq.length <= maxBeads) return seq.slice();
    var dropCols = Math.ceil((seq.length - maxBeads) / rows);
    return seq.slice(dropCols * rows);
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
    /*
     * 只说「开奖可复算」，不说「可证明公平 / 承诺 Hash」。
     *
     * 种子与指纹是封盘那一刻才生成的，玩家下注前不存在任何承诺物，
     * 所以这里能证明的是「公布的结果没有被事后改过」（结果可复算），
     * 而不是「种子不是看完下注才挑的」（预承诺公平）。两者差别很大，
     * 把后者写在界面上等于宣称做不到的事——出纠纷时这比从不宣称糟得多。
     */
    lines.push('<p class="' + p + '-rules__intro"><b>开奖可复算</b></p>');
    lines.push(
      '<p class="' + p + '-rules__intro">开奖后公布本局种子与其指纹，' +
        '任何人都能用它复算出同一副牌与同一结果，据此核对公布的结果有没有被改过。</p>',
    );
    if (info.roundNo) {
      lines.push('<p class="' + p + '-rules__intro">局号：' + String(info.roundNo) + '</p>');
    }
    if (info.serverSeedHash) {
      lines.push(
        '<p class="' + p + '-rules__intro">结果指纹 Hash：<code style="word-break:break-all;font-size:11px">' +
          String(info.serverSeedHash) + '</code></p>',
      );
    }
    if (info.serverSeed) {
      lines.push(
        '<p class="' + p + '-rules__intro">公开 Seed：<code style="word-break:break-all;font-size:11px">' +
          String(info.serverSeed) + '</code></p>',
      );
    } else {
      /* 下注期没有种子也没有指纹：候选是封盘时才生成的，开局前无可承诺之物 */
      lines.push('<p class="' + p + '-rules__intro">本局尚未开奖；开奖后公开种子与其指纹，可自行复算核验。</p>');
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
      lines.push('<p class="' + p + '-rules__intro">Hash 校验：开奖后可验</p>');
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
   *   oddsIntro?: string,
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
      /*
       * 默认按净赔率说明。斗牛的牛牛/牛7-9/无牛-牛6 挂的是含本总赔率，
       * 照默认文案念会让玩家多算一份本金，所以允许各桌自己传口径说明。
       */
      html.push(
        '<p class="tb-rules__p">'
        + (opts.oddsIntro || '赔率按「押 1 净得 X」标注（不含本金）；派彩以当局结算为准。')
        + '</p>',
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
