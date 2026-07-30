/** 1分时时彩 · 大厅 BGM + 倒计时音效 + 开奖滚号 tick */
(function (global) {
  var BASE = '/audio/ffc/';
  var VER = '9';
  var LS_KEY = 'ffc_audio_v1';

  var pref = { music: true, sfx: true };
  try {
    var raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      pref.music = raw.music !== false;
      pref.sfx = raw.sfx !== false;
    }
  } catch (e) { /* ignore */ }

  var unlocked = false;
  var bgm = null;
  var lastSfxAt = {};
  var cdTimers = [];
  var cdArmedLockAt = 0;
  var cdPlayed = {};
  var baseVol = 0.42;

  function url(name) {
    return BASE + name + '.wav?v=' + VER;
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
      bgm = new Audio(url('lobby-bgm'));
      bgm.loop = true;
      bgm.preload = 'auto';
      bgm.volume = baseVol;
    } else {
      bgm.volume = baseVol;
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
    if (!pref.sfx) clearCountdownArm();
  }

  function sfx(name, opt) {
    if (!pref.sfx || !unlocked) return;
    opt = opt || {};
    var now = Date.now();
    var gap = typeof opt.dedupeMs === 'number' ? opt.dedupeMs : 40;
    if (lastSfxAt[name] && now - lastSfxAt[name] < gap) return;
    lastSfxAt[name] = now;
    try {
      var node = new Audio(url(name));
      node.volume = typeof opt.vol === 'number' ? opt.vol : 0.7;
      var p = node.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* ignore */ }
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
   * 按封盘绝对时刻对齐：
   * - 第 5 秒不响
   * - 4/3/2/1 各一声
   * - 00:00（lockAt）双嘀
   * 不压低 BGM
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

    /* 4..1：lockAt - n 秒 */
    for (var s = 4; s >= 1; s--) {
      (function (sec) {
        schedule(lockAt - sec * 1000, function () {
          playCd('t' + sec, 'countdown-' + sec, 0.58 + (4 - sec) * 0.05);
        });
      })(s);
    }
    /* 00:00 双嘀 */
    schedule(lockAt, function () {
      playCd('t0', 'countdown-final', 0.72);
    });
  }

  function onCountdownSec() { /* 音效只走 armCountdown，避免双触发 */ }

  function onDrawing() {
    /* 若 arm 因漂移未打到 00:00，进开奖中时补一次双嘀 */
    if (cdArmedLockAt && !cdPlayed.t0) {
      playCd('t0', 'countdown-final', 0.72);
    }
    clearCountdownArm();
  }

  function onBetting() {
    ensureBgm(true);
  }

  function startRoll() {}
  function stopRoll() {}

  function rollTick() {
    sfx('roll-tick', { vol: 0.26, dedupeMs: 28 });
  }

  function ballStop() {
    sfx('ball-stop', { vol: 0.6, dedupeMs: 30 });
  }

  function onRevealDone() {}

  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (bgm) try { bgm.pause(); } catch (e) { /* ignore */ }
      clearCountdownArm();
    } else if (pref.music && unlocked) {
      ensureBgm(true);
    }
  });

  global.FfcAudio = {
    unlock: unlock,
    ensureBgm: ensureBgm,
    setMusicOn: setMusicOn,
    setSfxOn: setSfxOn,
    armCountdown: armCountdown,
    clearCountdownArm: clearCountdownArm,
    onCountdownSec: onCountdownSec,
    onDrawing: onDrawing,
    onBetting: onBetting,
    startRoll: startRoll,
    stopRoll: stopRoll,
    rollTick: rollTick,
    ballStop: ballStop,
    onRevealDone: onRevealDone,
    pref: pref
  };
})(typeof window !== 'undefined' ? window : this);

