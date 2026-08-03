/** 极速赛车 · 进房 BGM + 顶栏读秒 + 竞速阶段音效 */
(function (global) {
  var BASE = '/audio/speed-racing/';
  var VER = '4';
  var LS_KEY = 'jsr_audio_v1';

  function isAppBgmOn() {
    try { return localStorage.getItem('app_bgm_off') !== '1'; } catch (e) { return true; }
  }
  function isAppSfxOn() {
    try { return localStorage.getItem('sound_off') !== '1'; } catch (e) { return true; }
  }
  /* 无本游戏记录时跟随账号管理；有记录则用本游戏覆盖 */
  var pref = { music: isAppBgmOn(), sfx: isAppSfxOn() };
  try {
    var raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (typeof raw.music === 'boolean') pref.music = raw.music;
      if (typeof raw.sfx === 'boolean') pref.sfx = raw.sfx;
    }
  } catch (e) { /* ignore */ }

  function syncFromAppIfNeeded() {
    try {
      var stored = localStorage.getItem(LS_KEY);
      if (stored && stored !== 'null') return;
    } catch (e) { return; }
    pref.music = isAppBgmOn();
    pref.sfx = isAppSfxOn();
    if (pref.music) {
      try { if (typeof ensureBgm === 'function') ensureBgm(true); } catch (e2) { /* ignore */ }
      try { if (typeof ensureLobbyBgm === 'function') ensureLobbyBgm(true); } catch (e3) { /* ignore */ }
    } else {
      try { if (bgm) bgm.pause(); } catch (e4) { /* ignore */ }
      try { if (lobbyBgm) lobbyBgm.pause(); } catch (e5) { /* ignore */ }
    }
    if (!pref.sfx) {
      try { if (typeof clearCountdownArm === 'function') clearCountdownArm(); } catch (e6) { /* ignore */ }
      try { if (typeof stopRing === 'function') stopRing(); } catch (e7) { /* ignore */ }
      try { if (typeof stopDrawSfx === 'function') stopDrawSfx(); } catch (e8) { /* ignore */ }
      try { if (typeof stopRaceSfx === 'function') stopRaceSfx(); } catch (e9) { /* ignore */ }
    }
  }
  window.addEventListener('storage', function (ev) {
    if (!ev) return;
    if (ev.key === 'app_bgm_off' || ev.key === 'sound_off' || ev.key === LS_KEY) syncFromAppIfNeeded();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) syncFromAppIfNeeded();
  });

  var unlocked = false;
  var bgm = null;
  var raceMid = null;
  var lastSfxAt = {};
  var cdTimers = [];
  var raceTimers = [];
  var cdArmedLockAt = 0;
  var cdPlayed = {};
  var baseVol = 0.38;
  var raceActive = false;

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
      var silent = new Audio(url('countdown-4'));
      silent.volume = 0;
      silent.play().then(function () { silent.pause(); }).catch(function () {});
    } catch (e) { /* ignore */ }
    ensureBgm(true);
  }

  function ensureBgm(playNow) {
    if (!bgm) {
      bgm = new Audio(url('lobby-bgm', 'm4a'));
      bgm.loop = true;
      bgm.preload = 'auto';
      bgm.volume = baseVol;
    } else {
      bgm.volume = raceActive ? baseVol * 0.22 : baseVol;
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

  function setSfxOn(on) {
    pref.sfx = !!on;
    savePref();
    if (!pref.sfx) {
      clearCountdownArm();
      stopRaceSfx();
    }
  }

  function sfx(name, opt) {
    if (!pref.sfx || !unlocked) return;
    opt = opt || {};
    var now = Date.now();
    var gap = typeof opt.dedupeMs === 'number' ? opt.dedupeMs : 40;
    if (lastSfxAt[name] && now - lastSfxAt[name] < gap) return;
    lastSfxAt[name] = now;
    try {
      var node = new Audio(url(name, opt.ext || 'wav'));
      node.volume = typeof opt.vol === 'number' ? opt.vol : 0.7;
      if (opt.loop) node.loop = true;
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

  function playCd(key, name, vol) {
    if (!pref.sfx || !unlocked) return;
    if (cdPlayed[key]) return;
    cdPlayed[key] = true;
    sfx(name, { vol: vol, dedupeMs: 0 });
  }

  /**
   * 椤舵爮璺濆皝鐩橈細4/3/2/1 鍚勪竴澹帮紱00:00 鍙屽榾锛坈ountdown-final锛?
   */
  function armCountdown(lockAtMs) {
    var lockAt = Number(lockAtMs) || 0;
    if (!lockAt || !isFinite(lockAt)) return;
    if (cdArmedLockAt === lockAt) return;
    clearCountdownArm();
    cdArmedLockAt = lockAt;
    var now = Date.now();

    function schedule(at, fn) {
      var delay = at - now;
      if (delay < -80) return;
      if (delay <= 0) {
        fn();
        return;
      }
      cdTimers.push(setTimeout(fn, delay));
    }

    for (var s = 4; s >= 1; s--) {
      (function (sec) {
        schedule(lockAt - sec * 1000, function () {
          playCd('t' + sec, 'countdown-' + sec, 0.58 + (4 - sec) * 0.05);
        });
      })(s);
    }
    schedule(lockAt, function () {
      playCd('t0', 'countdown-final', 0.72);
    });
  }

  function onDrawing() {
    if (cdArmedLockAt && !cdPlayed.t0) {
      playCd('t0', 'countdown-final', 0.72);
    }
    clearCountdownArm();
  }

  function onBetting() {
    raceActive = false;
    stopRaceSfx();
    ensureBgm(true);
  }

  function clearRaceTimers() {
    raceTimers.forEach(function (id) { clearTimeout(id); });
    raceTimers = [];
  }

  function stopRaceSfx() {
    clearRaceTimers();
    if (raceMid) {
      try { raceMid.pause(); raceMid.currentTime = 0; } catch (e) { /* ignore */ }
      raceMid = null;
    }
  }

  /**
   * 竞速仪式音效（与 race-host / jsr.js 时间轴对齐）：
   * - 红绿灯剩 2s：race-countdown（cuttime）
   * - 绿灯 +1s：race-mid 循环（staring）
   * - finishgame 起停 mid；领奖台内播 race-finish（over）
   * 默认对齐当前房间：倒计时 3s + 中段 8s + 领奖台 6s
   */
  function startRaceCeremony(opts) {
    opts = opts || {};
    var cd = opts.countdownSec != null ? Number(opts.countdownSec) : 3;
    var mid = opts.midRaceMs != null ? Number(opts.midRaceMs) : 8000;
    var after = opts.afterFinishMs != null ? Number(opts.afterFinishMs) : 6000;
    if (!(cd >= 0)) cd = 3;
    if (!(mid >= 0)) mid = 8000;
    if (!(after >= 0)) after = 6000;

    stopRaceSfx();
    raceActive = true;
    if (bgm && pref.music) {
      try { bgm.volume = baseVol * 0.2; } catch (e) { /* ignore */ }
    }

    function later(ms, fn) {
      raceTimers.push(setTimeout(fn, ms));
    }

    /* startcountdown(n)：约 1s 后 timer==2 播 cuttime */
    later(Math.max(0, (cd - 2) * 1000), function () {
      sfx('race-countdown', { ext: 'mp3', vol: 0.75, dedupeMs: 0 });
    });

    /* 绿灯 +1s → staring 循环（对齐 main.js startanimation） */
    later(cd * 1000 + 1000, function () {
      if (!pref.sfx || !unlocked) return;
      try {
        raceMid = new Audio(url('race-mid', 'mp3'));
        raceMid.loop = true;
        raceMid.volume = 0.62;
        var p = raceMid.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) { /* ignore */ }
    });

    /* finishgame：停 mid；领奖台窗口内播 over（默认 +3s，after 过短则提前） */
    var finishAt = cd * 1000 + mid;
    later(finishAt, function () {
      if (raceMid) {
        try { raceMid.pause(); raceMid.currentTime = 0; } catch (e) { /* ignore */ }
        raceMid = null;
      }
    });
    var overDelay = Math.min(3000, Math.max(0, after - 200));
    later(finishAt + overDelay, function () {
      sfx('race-finish', { ext: 'mp3', vol: 0.78, dedupeMs: 0 });
    });
  }

  function endRaceCeremony() {
    raceActive = false;
    /* 只清循环 mid / 待播定时器；已播出的 race-finish 单次音效继续播完 */
    clearRaceTimers();
    if (raceMid) {
      try { raceMid.pause(); raceMid.currentTime = 0; } catch (e) { /* ignore */ }
      raceMid = null;
    }
    if (bgm && pref.music) {
      try { bgm.volume = baseVol; } catch (e) { /* ignore */ }
      ensureBgm(true);
    }
  }

  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (bgm) try { bgm.pause(); } catch (e) { /* ignore */ }
      clearCountdownArm();
      stopRaceSfx();
    } else if (pref.music && unlocked) {
      ensureBgm(true);
    }
  });

  global.JsrAudio = {
    unlock: unlock,
    ensureBgm: ensureBgm,
    setMusicOn: setMusicOn,
    setSfxOn: setSfxOn,
    armCountdown: armCountdown,
    clearCountdownArm: clearCountdownArm,
    onDrawing: onDrawing,
    onBetting: onBetting,
    startRaceCeremony: startRaceCeremony,
    endRaceCeremony: endRaceCeremony,
    pref: pref,
  };
})(typeof window !== 'undefined' ? window : this);
