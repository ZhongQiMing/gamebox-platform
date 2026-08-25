/**
 * 开奖动画卡 · 开奖音效开关
 * 优先 *Audio.setDrawSfxOn（只控开奖动画音）；旧游戏回退 setSfxOn。
 * 绝不改房间 BGM。
 */
(function (global) {
  'use strict';

  var ICON_ON =
    '<svg class="lottery-card-sfx__icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>' +
    '</svg>';
  var ICON_OFF =
    '<svg class="lottery-card-sfx__icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>' +
    '</svg>';

  var busy = false;
  var debounceTimer = 0;
  var lastToggleAt = 0;

  function hasDrawApi(audio) {
    return !!(audio && typeof audio.setDrawSfxOn === 'function');
  }

  /** 读按钮状态：有 drawSfx 通道就读它，否则读旧 sfx */
  function isCardSfxOn(audio) {
    if (!audio) return true;
    try {
      if (typeof audio.isDrawSfxOn === 'function') return !!audio.isDrawSfxOn();
      if (audio.pref && typeof audio.pref.drawSfx === 'boolean') return !!audio.pref.drawSfx;
      if (typeof audio.isSfxOn === 'function') return !!audio.isSfxOn();
      if (audio.pref && typeof audio.pref.sfx === 'boolean') return !!audio.pref.sfx;
    } catch (e) { /* ignore */ }
    return true;
  }

  function setCardSfxOn(audio, on) {
    if (!audio) return;
    if (typeof audio.setDrawSfxOn === 'function') {
      audio.setDrawSfxOn(!!on);
      return;
    }
    if (typeof audio.setSfxOn === 'function') audio.setSfxOn(!!on);
  }

  function buttonHtml() {
    return (
      '<button type="button" class="lottery-card-sfx" aria-label="开奖音效" title="开奖音效">' +
        ICON_ON +
      '</button>'
    );
  }

  function paintBtn(btn, on) {
    if (!btn) return;
    var wantOff = !on;
    var curOff = btn.classList.contains('is-off');
    /* 状态未变则勿改 DOM，避免 MutationObserver 死循环 */
    if (curOff === wantOff && btn.getAttribute('data-sfx') === (on ? '1' : '0')) return;
    btn.classList.toggle('is-off', wantOff);
    btn.setAttribute('data-sfx', on ? '1' : '0');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('title', on ? '关闭开奖音效' : '开启开奖音效');
    btn.setAttribute('aria-label', on ? '关闭开奖音效' : '开启开奖音效');
    btn.innerHTML = on ? ICON_ON : ICON_OFF;
  }

  function syncAll(root, audio) {
    var scope = root || document;
    var on = isCardSfxOn(audio);
    var list = scope.querySelectorAll
      ? scope.querySelectorAll('.lottery-card-sfx')
      : [];
    for (var i = 0; i < list.length; i++) paintBtn(list[i], on);
  }

  function ensureButton(card, headSelector) {
    if (!card || card.querySelector('.lottery-card-sfx')) return false;
    var btnHtml = buttonHtml();
    var head = headSelector ? card.querySelector(headSelector) : null;
    if (head) {
      head.insertAdjacentHTML('beforeend', btnHtml);
      return true;
    }
    var stage =
      card.querySelector('[class*="-video-card__stage"], [class*="-race-card__stage"]') ||
      card;
    if (!stage) return false;
    if (stage === card) card.classList.add('lottery-card-sfx-host');
    else stage.classList.add('lottery-card-sfx-host');
    var wrap = document.createElement('div');
    wrap.innerHTML = btnHtml;
    var btn = wrap.firstChild;
    if (!btn) return false;
    btn.classList.add('lottery-card-sfx--float');
    stage.appendChild(btn);
    return true;
  }

  function ensureOnCards(cardSelector, headSelector, root) {
    if (!cardSelector) return false;
    var scope = root || document;
    var cards = scope.querySelectorAll ? scope.querySelectorAll(cardSelector) : [];
    var added = false;
    for (var i = 0; i < cards.length; i++) {
      if (ensureButton(cards[i], headSelector)) added = true;
    }
    return added;
  }

  function mutationNeedsRefresh(records, cardSelector) {
    if (!records || !records.length) return false;
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var nodes = [];
      var j;
      if (rec.addedNodes && rec.addedNodes.length) {
        for (j = 0; j < rec.addedNodes.length; j++) nodes.push(rec.addedNodes[j]);
      }
      if (rec.removedNodes && rec.removedNodes.length) {
        for (j = 0; j < rec.removedNodes.length; j++) nodes.push(rec.removedNodes[j]);
      }
      for (j = 0; j < nodes.length; j++) {
        var n = nodes[j];
        if (!n || n.nodeType !== 1) continue;
        /* 忽略音效钮自身 DOM 变更 */
        if (
          (n.classList && n.classList.contains('lottery-card-sfx')) ||
          (n.closest && n.closest('.lottery-card-sfx'))
        ) {
          continue;
        }
        if (
          (cardSelector && n.matches && n.matches(cardSelector)) ||
          (cardSelector && n.querySelector && n.querySelector(cardSelector)) ||
          (n.classList && (
            n.classList.contains('ffc-video-card') ||
            n.classList.contains('ssc-video-card') ||
            n.classList.contains('k3-video-card') ||
            n.classList.contains('lhc-video-card') ||
            n.classList.contains('jsr-race-card') ||
            n.classList.contains('bjsc-race-card') ||
            n.classList.contains('jsb-race-card')
          ))
        ) {
          return true;
        }
        /* 聊天消息节点里可能包着卡 */
        if (n.querySelector && (
          n.querySelector('.ffc-video-card, .ssc-video-card, .k3-video-card, .lhc-video-card, .jsr-race-card, .bjsc-race-card, .jsb-race-card')
        )) {
          return true;
        }
      }
    }
    return false;
  }

  function muteIframeAudio(muted) {
    try {
      var frames = document.querySelectorAll(
        '.ssc-video-card__frame, .ffc-video-card__frame, .k3-video-card__frame, .lhc-video-card__frame, .jsr-race-card__frame, .bjsc-race-card__frame, .jsb-race-card__frame'
      );
      for (var i = 0; i < frames.length; i++) {
        var w = frames[i] && frames[i].contentWindow;
        if (!w) continue;
        try {
          w.postMessage(
            { action: muted ? 'mute' : 'unmute', source: 'lottery-card-sfx' },
            location.origin
          );
        } catch (ePm) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }

  /**
   * 关掉时立刻掐开奖仪式；有 drawSfx 通道时不碰房间铃声。
   *
   * 有 drawSfx 这一路的游戏不走这里：那边 setDrawSfxOn 已经把进行中的音轨就地静音，
   * 节点和 opening→over 的定时器都留着，中途再打开能接着响。这里若再补一刀
   * endDrawCeremony()，节点和定时器就没了，「关掉再马上打开」这一整段就哑到下一期。
   * 没有 drawSfx 通道的老游戏没有就地静音的能力，仍按原来的硬停处理。
   */
  function hardStopCeremony(api) {
    if (!api) return;
    if (hasDrawApi(api)) return;
    try { if (typeof api.endDrawCeremony === 'function') api.endDrawCeremony(); } catch (e1) { /* ignore */ }
    try { if (typeof api.endRaceCeremony === 'function') api.endRaceCeremony(); } catch (e2) { /* ignore */ }
    try { if (typeof api.stopDrawSfx === 'function') api.stopDrawSfx(); } catch (e3) { /* ignore */ }
    try { if (typeof api.stopRaceSfx === 'function') api.stopRaceSfx(); } catch (e4) { /* ignore */ }
    try { if (typeof api.clearCountdownArm === 'function') api.clearCountdownArm(); } catch (e5) { /* ignore */ }
  }

  function toggleFromEvent(ev) {
    var t = ev && ev.target;
    if (!t) return;
    /* SVG 子节点在部分 WebView 无 closest，向上找按钮 */
    var btn = null;
    if (t.closest) btn = t.closest('.lottery-card-sfx');
    if (!btn) {
      var n = t.nodeType === 1 ? t : t.parentElement;
      while (n) {
        if (n.classList && n.classList.contains('lottery-card-sfx')) {
          btn = n;
          break;
        }
        n = n.parentElement;
      }
    }
    if (!btn) return;

    var now = Date.now();
    if (now - lastToggleAt < 320) {
      try { ev.preventDefault(); } catch (e0) { /* ignore */ }
      try { ev.stopPropagation(); } catch (e1) { /* ignore */ }
      return;
    }
    lastToggleAt = now;

    try { ev.preventDefault(); } catch (e2) { /* ignore */ }
    try { ev.stopPropagation(); } catch (e3) { /* ignore */ }

    var api = install._audio;
    if (!api) return;
    try { if (typeof api.unlock === 'function') api.unlock(); } catch (e4) { /* ignore */ }
    var next = !isCardSfxOn(api);
    try { setCardSfxOn(api, next); } catch (e5) { /* ignore */ }
    if (!next) hardStopCeremony(api);
    muteIframeAudio(true);
    busy = true;
    try { syncAll(document, api); } finally { busy = false; }
  }

  /**
   * @param {{ audio: any, cardSelector: string, headSelector?: string, root?: Element }} opts
   */
  function install(opts) {
    opts = opts || {};
    var audio = opts.audio;
    var cardSelector = opts.cardSelector || '';
    var headSelector = opts.headSelector || '';
    var root = opts.root || document;

    function refresh(forceSync) {
      if (busy) return;
      busy = true;
      try {
        var added = ensureOnCards(cardSelector, headSelector, root);
        if (added || forceSync) syncAll(root, audio);
      } finally {
        busy = false;
      }
    }

    function scheduleRefresh() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        debounceTimer = 0;
        refresh(true);
      }, 80);
    }

    refresh(true);

    if (!install._bound) {
      install._bound = true;
      /* pointerup 比 click 在部分 WebView 更稳；与 click 共用去抖防双触 */
      document.addEventListener('pointerup', toggleFromEvent, true);
      document.addEventListener('click', toggleFromEvent, true);
    }
    install._audio = audio;

    var observeTarget = null;
    if (root && root.nodeType === 1) observeTarget = root;
    else {
      observeTarget =
        document.getElementById('chatFeed') ||
        document.getElementById('chatDock') ||
        null;
    }
    if (observeTarget && typeof MutationObserver !== 'undefined') {
      try {
        var mo = new MutationObserver(function (records) {
          if (busy) return;
          if (!mutationNeedsRefresh(records, cardSelector)) return;
          scheduleRefresh();
        });
        mo.observe(observeTarget, { childList: true, subtree: true });
      } catch (eMo) { /* ignore */ }
    }

    /* 聊天区晚到：有限次补绑，避免无限轮询 */
    var n = 0;
    var timer = setInterval(function () {
      refresh(true);
      n += 1;
      if (n >= 8) clearInterval(timer);
    }, 800);

    return {
      refresh: function () { refresh(true); },
      sync: function () { syncAll(root, audio); },
    };
  }

  global.LotteryCardSfx = {
    buttonHtml: buttonHtml,
    install: install,
    syncAll: syncAll,
    ensureOnCards: ensureOnCards,
    isSfxOn: isCardSfxOn,
    isCardSfxOn: isCardSfxOn,
  };
})(typeof window !== 'undefined' ? window : this);
