/**
 * 极速赛车 · 三路音频（互不混控）
 *
 * 1) music  房间 BGM：lobby-bgm
 * 2) sfx    房间音效：顶栏读秒 countdown-4..1 / countdown-final
 * 3) drawSfx 开奖动画：race-countdown / race-mid / race-finish（父页播，iframe 静音）
 *    - 仅开奖卡喇叭 → setDrawSfxOn
 */
(function (global) {
  var BASE = '/audio/speed-racing/';
  var VER = '9';
  var LS_KEY = 'jsr_audio_v1';
  var BGM_EXT = 'm4a';

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
    if (typeof liveDrawSfx !== 'undefined' && liveDrawSfx && liveDrawSfx.forEach) {
      liveDrawSfx.forEach(function (n) { try { n.volume = sfxVol(); } catch (e6) {} });
    }
    if (typeof raceMid !== 'undefined' && raceMid) {
      try { raceMid.volume = sfxVol(); } catch (e7) {}
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
      try { if (typeof stopLiveSfx === 'function') stopLiveSfx(); } catch (e7) { /* ignore */ }
    }
    if (!pref.drawSfx) {
      try { if (typeof stopRaceSfx === 'function') stopRaceSfx(); } catch (e9) { /* ignore */ }
      raceActive = false;
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
  var raceMid = null;
  var lastSfxAt = {};
  var liveSfx = [];
  var liveDrawSfx = [];
  var cdTimers = [];
  var raceTimers = [];
  var cdArmedLockAt = 0;
  var cdPlayed = {};
  var baseVol = musicVol();
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

  /* ───────── 1) 房间 BGM ───────── */
  function ensureBgm(playNow) {
    baseVol = musicVol();
    if (!bgm) {
      bgm = new Audio(url('lobby-bgm', BGM_EXT));
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

  /* ───────── 2) 房间音效（顶栏读秒） ───────── */
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
    if (lastSfxAt[name] && now - lastSfxAt[name] < gap) return null;
    lastSfxAt[name] = now;
    try {
      var node = new Audio(url(name, opt.ext || 'wav'));
      node.volume = sfxVol();
      if (opt.loop) node.loop = true;
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

  function playCd(key, name, vol) {
    if (!pref.sfx || !unlocked) return;
    if (cdPlayed[key]) return;
    cdPlayed[key] = true;
    sfx(name, { vol: vol, dedupeMs: 0 });
  }

  function armCountdown(lockAtMs) {
    if (raceActive) return;
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
      playCd('t0', 'countdown-final', sfxVol());
    });
  }

  function onDrawing() {
    if (cdArmedLockAt && !cdPlayed.t0) {
      playCd('t0', 'countdown-final', sfxVol());
    }
    clearCountdownArm();
  }

  function onBetting() {
    if (raceActive) {
      if (bgm && pref.music) {
        try { bgm.volume = baseVol * 0.2; } catch (e) { /* ignore */ }
      }
      return;
    }
    stopRaceSfx();
    ensureBgm(true);
  }

  /* ───────── 3) 开奖动画音效（竞速仪式） ───────── */
  function stopLiveDrawSfx() {
    liveDrawSfx.forEach(function (node) {
      try { node.pause(); node.src = ''; } catch (e) { /* ignore */ }
    });
    liveDrawSfx = [];
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
    stopLiveDrawSfx();
  }

  function playDrawSfx(name, opt) {
    if (!pref.drawSfx || !unlocked) return null;
    opt = opt || {};
    try {
      var node = new Audio(url(name, opt.ext || 'mp3'));
      node.volume = sfxVol();
      if (opt.loop) node.loop = true;
      liveDrawSfx.push(node);
      var p = node.play();
      if (p && p.catch) p.catch(function () {});
      return node;
    } catch (e) {
      return null;
    }
  }

  function setDrawSfxOn(on) {
    pref.drawSfx = !!on;
    savePref();
    if (!pref.drawSfx) {
      stopRaceSfx();
      raceActive = false;
      if (bgm && pref.music) {
        try { bgm.volume = baseVol; } catch (e) { /* ignore */ }
        ensureBgm(true);
      }
    }
  }

  function startRaceCeremony(opts) {
    opts = opts || {};
    var cd = opts.countdownSec != null ? Number(opts.countdownSec) : 3;
    var mid = opts.midRaceMs != null ? Number(opts.midRaceMs) : 8000;
    var visual = opts.finishVisualMs != null ? Number(opts.finishVisualMs) : 3300;
    if (!(cd >= 0)) cd = 3;
    if (!(mid >= 0)) mid = 8000;
    if (!(visual >= 0)) visual = 3300;

    stopRaceSfx();
    raceActive = true;
    if (bgm && pref.music) {
      try { bgm.volume = baseVol * 0.2; } catch (e) { /* ignore */ }
    }

    function later(ms, fn) {
      raceTimers.push(setTimeout(fn, ms));
    }

    later(Math.max(0, (cd - 2) * 1000), function () {
      playDrawSfx('race-countdown', { ext: 'mp3', vol: sfxVol() });
    });

    later(cd * 1000 + 1000, function () {
      if (!pref.drawSfx || !unlocked) return;
      try {
        raceMid = new Audio(url('race-mid', 'mp3'));
        raceMid.loop = true;
        raceMid.volume = sfxVol();
        liveDrawSfx.push(raceMid);
        var p = raceMid.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) { /* ignore */ }
    });

    var numbersAt = cd * 1000 + mid + visual;
    later(numbersAt, function () {
      if (raceMid) {
        try { raceMid.pause(); raceMid.currentTime = 0; } catch (e) { /* ignore */ }
        raceMid = null;
      }
      playDrawSfx('race-finish', { ext: 'mp3', vol: sfxVol() });
    });
  }

  function endRaceCeremony() {
    raceActive = false;
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
    isMusicOn: function () { return !!pref.music; },
    setSfxOn: setSfxOn,
    isSfxOn: function () { return !!pref.sfx; },
    setDrawSfxOn: setDrawSfxOn,
    isDrawSfxOn: function () { return !!pref.drawSfx; },
    armCountdown: armCountdown,
    clearCountdownArm: clearCountdownArm,
    onDrawing: onDrawing,
    onBetting: onBetting,
    startRaceCeremony: startRaceCeremony,
    endRaceCeremony: endRaceCeremony,
    stopRaceSfx: stopRaceSfx,
    stopDrawSfx: stopRaceSfx,
    pref: pref,
  };
})(typeof window !== 'undefined' ? window : this);
