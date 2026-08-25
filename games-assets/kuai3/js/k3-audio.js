/**
 * 1分快三 · 三路音频（互不混控）
 *
 * 1) music  房间 BGM：bg.mp3
 * 2) sfx    房间音效：封盘前 3 秒读秒 countdown-3..1 + 封盘双声 countdown-final
 * 3) drawSfx 开奖动画：卡内 tick 嘀声 + 摇骰 run（父页播，iframe 静音）
 *    - 仅开奖卡喇叭 → setDrawSfxOn
 */
(function (global) {
  var BASE = '/audio/kuai3/';
  var VER = '4';
  var LS_KEY = 'k3_audio_v1';
  /**
   * 封盘前几秒开始读秒：每秒一声「嘀」，到 00:00 是双声的 countdown-final。
   *
   * 原先这里放的是 rings/RING_01.wav —— 一段 4.4 秒的闹铃，从 T-3 秒一直响到封盘，
   * 听着完全不是读秒。countdown-1..3 / countdown-final 是从时时彩那份复制到本游戏目录的，
   * 与时时彩 / 分分彩 / 三个赛车统一成同一种读秒。
   */
  var CD_LEAD_SEC = 3;

  function isAppBgmOn() {
    try { return localStorage.getItem('app_bgm_off') !== '1'; } catch (e) { return true; }
  }
  function isAppSfxOn() {
    try { return localStorage.getItem('sound_off') !== '1'; } catch (e) { return true; }
  }

  /* 账号音量：BGM / SFX（含开奖动画 drawSfx）统一基准 */
  var BASE_BGM = 0.4;
  var BASE_SFX = 0.75;
  function appBgmLevel() {
    try { if (global.AppAudioLevel) return AppAudioLevel.getBgm(); } catch (e) {}
    return 0.8;
  }
  function appSfxLevel() {
    try { if (global.AppAudioLevel) return AppAudioLevel.getSfx(); } catch (e) {}
    return 0.8;
  }
  function musicVol() { return BASE_BGM * appBgmLevel(); }
  function sfxVol() { return Math.min(1, BASE_SFX * appSfxLevel()); }
  function applyLevels() {
    baseVol = musicVol();
    if (typeof bgm !== 'undefined' && bgm) {
      try {
        var duck = false;
        try { if (typeof drawActive !== 'undefined' && drawActive) duck = true; } catch (e1) {}
        try { if (typeof raceActive !== 'undefined' && raceActive) duck = true; } catch (e2) {}
        bgm.volume = duck ? baseVol * 0.15 : baseVol;
      } catch (e3) {}
    }
    if (typeof liveSfx !== 'undefined' && liveSfx && liveSfx.forEach) {
      liveSfx.forEach(function (n) { try { n.volume = sfxVol(); } catch (e5) {} });
    }
    /* 仪式音轨要认「开奖音效」这一路的开关：关着时它们静音待命，别在这里被拉回音量 */
    if (typeof drawNodes !== 'undefined' && drawNodes && drawNodes.forEach) {
      drawNodes.forEach(function (n) {
        try {
          n.muted = !pref.drawSfx;
          n.volume = pref.drawSfx ? sfxVol() : 0;
        } catch (e6) { /* ignore */ }
      });
    }
  }

  var pref = {
    music: isAppBgmOn(),
    sfx: isAppSfxOn(),
    drawSfx: isAppSfxOn(),
  };
  try {
    var raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (typeof raw.music === 'boolean') pref.music = raw.music;
      if (typeof raw.sfx === 'boolean') pref.sfx = raw.sfx;
      if (typeof raw.drawSfx === 'boolean') pref.drawSfx = raw.drawSfx;
      else if (typeof raw.sfx === 'boolean') pref.drawSfx = raw.sfx;
    }
  } catch (e) { /* ignore */ }

  function syncFromAppIfNeeded() {
    try {
      var stored = localStorage.getItem(LS_KEY);
      if (stored && stored !== 'null') return;
    } catch (e) { return; }
    pref.music = isAppBgmOn();
    pref.sfx = isAppSfxOn();
    pref.drawSfx = isAppSfxOn();
    if (pref.music) {
      try { if (typeof ensureBgm === 'function') ensureBgm(true); } catch (e2) { /* ignore */ }
    } else {
      try { if (bgm) bgm.pause(); } catch (e4) { /* ignore */ }
    }
    if (!pref.sfx) {
      try { if (typeof clearCountdownArm === 'function') clearCountdownArm(); } catch (e6) { /* ignore */ }
      try { if (typeof stopLiveSfx === 'function') stopLiveSfx(); } catch (e8) { /* ignore */ }
    }
    if (!pref.drawSfx) {
      try { if (typeof stopDrawSfx === 'function') stopDrawSfx(); } catch (e9) { /* ignore */ }
      drawActive = false;
      if (bgm && pref.music) {
        try { bgm.volume = baseVol; } catch (e10) { /* ignore */ }
      }
    }
    applyLevels();
  }
  window.addEventListener('storage', function (ev) {
    if (!ev) return;
    if (ev.key === 'app_bgm_off' || ev.key === 'sound_off' || ev.key === 'app_bgm_vol' || ev.key === 'app_sfx_vol' || ev.key === LS_KEY) { syncFromAppIfNeeded(); applyLevels(); }
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { syncFromAppIfNeeded(); applyLevels(); }
  });
  window.addEventListener('app-audio-pref-changed', function () { syncFromAppIfNeeded(); applyLevels(); });

  var unlocked = false;
  var bgm = null;
  var lastSfxAt = {};
  var liveSfx = [];
  var cdTimers = [];
  var drawTimers = [];
  var drawNodes = [];
  var cdArmedLockAt = 0;
  /** 本期已播过的读秒键（t3/t2/t1/t0），避免定时器与 onCountdownSec 重复触发 */
  var cdPlayed = {};
  var baseVol = musicVol();
  var drawActive = false;
  var runNode = null;

  function url(name, ext) {
    return BASE + name + '.' + (ext || 'wav') + '?v=' + VER;
  }

  function savePref() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(pref)); } catch (e) { /* ignore */ }
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      var silent = new Audio(url('countdown-1'));
      silent.volume = 0;
      silent.play().then(function () { silent.pause(); }).catch(function () {});
    } catch (e) { /* ignore */ }
    ensureBgm(true);
  }

  /* ───────── 1) 房间 BGM ───────── */
  function ensureBgm(playNow) {
    baseVol = musicVol();
    if (!bgm) {
      bgm = new Audio(url('bg', 'mp3'));
      bgm.loop = true;
      bgm.preload = 'auto';
      bgm.volume = baseVol;
    } else {
      bgm.volume = drawActive ? baseVol * 0.18 : baseVol;
    }
    if (!pref.music) return;
    if (playNow && bgm.paused) {
      var p = bgm.play();
      if (p && p.catch) p.catch(function () {});
    }
  }

  function setMusicOn(on) {
    pref.music = !!on;
    savePref();
    if (pref.music) ensureBgm(true);
    else if (bgm) {
      try { bgm.pause(); } catch (e) { /* ignore */ }
    }
  }

  /* ───────── 2) 房间音效 ───────── */
  function stopLiveSfx() {
    liveSfx.forEach(function (node) {
      try { node.pause(); node.src = ''; } catch (e) { /* ignore */ }
    });
    liveSfx = [];
  }

  function setSfxOn(on) {
    pref.sfx = !!on;
    savePref();
    if (!pref.sfx) {
      clearCountdownArm();
      stopLiveSfx();
    }
  }

  function sfx(name, opt) {
    if (!pref.sfx || !unlocked) return null;
    opt = opt || {};
    var now = Date.now();
    var gap = typeof opt.dedupeMs === 'number' ? opt.dedupeMs : 40;
    var key = name + (opt.ext || '');
    if (lastSfxAt[key] && now - lastSfxAt[key] < gap) return null;
    lastSfxAt[key] = now;
    try {
      var node = new Audio(url(name, opt.ext));
      node.volume = sfxVol();
      liveSfx.push(node);
      var p = node.play();
      if (p && p.catch) p.catch(function () {});
      return node;
    } catch (e) {
      return null;
    }
  }

  function clearCountdownArm() {
    cdTimers.forEach(function (id) { clearTimeout(id); });
    cdTimers = [];
    cdArmedLockAt = 0;
    cdPlayed = {};
  }

  /** 读秒每声只播一次：定时器与顶栏秒数回调可能同时打到同一秒 */
  function playCd(key, name) {
    if (!pref.sfx || !unlocked) return;
    if (cdPlayed[key]) return;
    cdPlayed[key] = true;
    sfx(name, { dedupeMs: 0 });
  }

  /** 封盘前 CD_LEAD_SEC 秒起每秒一声，封盘那一刻是双声 */
  function armCountdown(lockAtMs) {
    if (drawActive) return;
    var lockAt = Number(lockAtMs) || 0;
    if (!lockAt || !isFinite(lockAt)) return;
    if (cdArmedLockAt === lockAt) return;
    clearCountdownArm();
    cdArmedLockAt = lockAt;

    var now = Date.now();
    function schedule(at, fn) {
      var delay = at - now;
      /* 已经过去太久的那一声就不补了，免得进场时一串补播 */
      if (delay < -80) return;
      if (delay <= 0) {
        fn();
        return;
      }
      cdTimers.push(setTimeout(fn, delay));
    }

    for (var s = CD_LEAD_SEC; s >= 1; s--) {
      (function (sec) {
        schedule(lockAt - sec * 1000, function () {
          playCd('t' + sec, 'countdown-' + sec);
        });
      })(s);
    }
    schedule(lockAt, function () { playCd('t0', 'countdown-final'); });
  }

  /** 顶栏秒数回调：定时器被后台节流时的兜底 */
  function onCountdownSec(sec) {
    var s = Math.ceil(Number(sec));
    if (!(s >= 0 && s <= CD_LEAD_SEC)) return;
    if (!cdArmedLockAt) return;
    if (s === 0) playCd('t0', 'countdown-final');
    else playCd('t' + s, 'countdown-' + s);
  }

  function onDrawing() {
    /* 封盘瞬间没赶上定时器时补那声双响，再清 */
    if (cdArmedLockAt && !cdPlayed.t0) playCd('t0', 'countdown-final');
    clearCountdownArm();
  }

  function onBetting() {
    clearCountdownArm();
    endDrawCeremony();
    ensureBgm(true);
  }

  /* ───────── 3) 开奖动画音效 ───────── */
  function stopRun() {
    if (runNode) {
      try { runNode.pause(); runNode.src = ''; } catch (e) { /* ignore */ }
      runNode = null;
    }
  }

  function stopDrawSfx() {
    drawTimers.forEach(function (id) { clearTimeout(id); });
    drawTimers = [];
    drawNodes.forEach(function (node) {
      try { node.pause(); node.src = ''; } catch (e) { /* ignore */ }
    });
    drawNodes = [];
    stopRun();
  }

  /** 仪式音轨目标音量：关掉这一路时为 0（节点仍在，见 setDrawSfxOn） */
  function drawTrackVol() {
    return pref.drawSfx ? sfxVol() : 0;
  }

  function playDrawSfx(name, opt) {
    if (!unlocked) return null;
    opt = opt || {};
    try {
      var node = new Audio(url(name, opt.ext || 'wav'));
      node.muted = !pref.drawSfx;
      node.volume = drawTrackVol();
      drawNodes.push(node);
      var p = node.play();
      if (p && p.catch) p.catch(function () {});
      return node;
    } catch (e) {
      return null;
    }
  }

  /** 把开关状态应用到进行中的仪式音轨 */
  function applyDrawSfxLevel() {
    var v = drawTrackVol();
    drawNodes.forEach(function (node) {
      try {
        node.muted = !pref.drawSfx;
        node.volume = v;
      } catch (e) { /* ignore */ }
    });
  }

  /**
   * 关掉这一路时不销毁节点、也不撤定时器，只就地静音。
   * 原先是 stopDrawSfx() 一刀切：嘀声、摇骰循环轨和切歌定时器一起没了，再打开只是把开关
   * 置回 true，这一整段仪式就再也出不了声，得等下一期。保留下来只压音量，中途重开能接着响。
   */
  function setDrawSfxOn(on) {
    pref.drawSfx = !!on;
    savePref();
    applyDrawSfxLevel();
    /* 仪式仍在跑时 BGM 该压的继续压，别因为切了开关就把音乐顶回来 */
    if (bgm && pref.music) {
      try { bgm.volume = drawActive ? baseVol * 0.12 : baseVol; } catch (e) { /* ignore */ }
      ensureBgm(true);
    }
  }

  /** 卡内倒计时嘀声（开奖动画音效） */
  function playCardTicks(countdownMs) {
    var total = Math.max(0, Number(countdownMs) || 3000);
    var beats = Math.max(1, Math.round(total / 1000));
    for (var i = 0; i < beats; i++) {
      (function (delay) {
        drawTimers.push(setTimeout(function () {
          playDrawSfx('tick', { vol: sfxVol() });
        }, delay));
      })(i * 1000);
    }
  }

  function startRunLoop(midMs) {
    if (!unlocked) return;
    stopRun();
    try {
      runNode = new Audio(url('run', 'mp3'));
      runNode.loop = true;
      runNode.muted = !pref.drawSfx;
      runNode.volume = drawTrackVol();
      drawNodes.push(runNode);
      var p = runNode.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignore */ }

    var mid = Number(midMs);
    if (!(mid > 0)) mid = 5000;
    drawTimers.push(setTimeout(function () {
      stopRun();
    }, mid));
  }

  function startDrawCeremony(opts) {
    opts = opts || {};
    var countdownMs = opts.countdownMs != null ? Number(opts.countdownMs) : 3000;
    if (!(countdownMs >= 0)) countdownMs = 3000;
    var mid = opts.midMs != null ? Number(opts.midMs) : 5000;
    if (!(mid >= 0)) mid = 5000;

    clearCountdownArm();
    stopDrawSfx();
    drawActive = true;
    if (bgm && pref.music) {
      try { bgm.volume = baseVol * 0.18; } catch (e) { /* ignore */ }
    }

    playCardTicks(countdownMs);

    drawTimers.push(setTimeout(function () {
      startRunLoop(mid);
    }, countdownMs));

    var afterMs = opts.afterMs != null ? Number(opts.afterMs) : 2000;
    if (!(afterMs >= 0)) afterMs = 2000;
    drawTimers.push(setTimeout(function () {
      endDrawCeremony();
    }, countdownMs + mid + afterMs));
  }

  function endDrawCeremony() {
    drawActive = false;
    stopDrawSfx();
    if (bgm && pref.music) {
      try { bgm.volume = baseVol; } catch (e) { /* ignore */ }
      ensureBgm(true);
    }
  }

  function onRevealDone() {
    endDrawCeremony();
  }

  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (bgm) try { bgm.pause(); } catch (e) { /* ignore */ }
      clearCountdownArm();
      stopDrawSfx();
      drawActive = false;
    } else if (pref.music && unlocked) {
      ensureBgm(true);
    }
  });

  global.K3Audio = {
    unlock: unlock,
    ensureBgm: ensureBgm,
    setMusicOn: setMusicOn,
    isMusicOn: function () { return !!pref.music; },
    setSfxOn: setSfxOn,
    isSfxOn: function () { return !!pref.sfx; },
    setDrawSfxOn: setDrawSfxOn,
    isDrawSfxOn: function () { return !!pref.drawSfx; },
    stopDrawSfx: stopDrawSfx,
    armCountdown: armCountdown,
    clearCountdownArm: clearCountdownArm,
    onCountdownSec: onCountdownSec,
    onDrawing: onDrawing,
    onBetting: onBetting,
    startDrawCeremony: startDrawCeremony,
    endDrawCeremony: endDrawCeremony,
    onRevealDone: onRevealDone,
    pref: pref,
  };
})(typeof window !== 'undefined' ? window : this);
