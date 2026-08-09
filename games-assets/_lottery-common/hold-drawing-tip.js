/**
 * 开奖黑幕提示：正在开奖 + 省略号 1～6 点循环
 */
(function (global) {
  'use strict';

  var TICK_MS = 380;
  var MAX_DOTS = 6;
  var timers = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var legacyTimers = [];

  function findStage(card, stageSelector) {
    if (!card) return null;
    if (stageSelector) {
      var el = card.querySelector(stageSelector);
      if (el) return el;
    }
    return (
      card.querySelector('[class$="__stage"]') ||
      card.querySelector('.ssc-video-card__stage, .ffc-video-card__stage, .k3-video-card__stage, .jsr-race-card__stage, .bjsc-race-card__stage, .jsb-race-card__stage, .lhc-video-card__stage') ||
      card
    );
  }

  function stopDots(card) {
    if (!card) return;
    if (timers && timers.has(card)) {
      clearInterval(timers.get(card));
      timers.delete(card);
      return;
    }
    for (var i = legacyTimers.length - 1; i >= 0; i--) {
      if (legacyTimers[i].card === card) {
        clearInterval(legacyTimers[i].id);
        legacyTimers.splice(i, 1);
      }
    }
  }

  function startDots(card, dotsEl) {
    stopDots(card);
    var n = 1;
    var paint = function () {
      if (!dotsEl || !dotsEl.isConnected) {
        stopDots(card);
        return;
      }
      var s = '';
      for (var i = 0; i < n; i++) s += '·';
      dotsEl.textContent = s;
      n += 1;
      if (n > MAX_DOTS) n = 1;
    };
    paint();
    var id = setInterval(paint, TICK_MS);
    if (timers) timers.set(card, id);
    else legacyTimers.push({ card: card, id: id });
  }

  function ensure(card, stageSelector) {
    if (!card) return null;
    var stage = findStage(card, stageSelector);
    if (!stage) return null;
    try {
      var st = global.getComputedStyle ? global.getComputedStyle(stage) : null;
      if (st && st.position === 'static') stage.style.position = 'relative';
    } catch (e) { /* ignore */ }

    var tip = card.querySelector('.lot-hold-drawing-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'lot-hold-drawing-tip';
      tip.setAttribute('aria-live', 'polite');
      tip.innerHTML =
        '<span class="lot-hold-drawing-tip__label">正在开奖</span>' +
        '<span class="lot-hold-drawing-tip__dots" aria-hidden="true"></span>';
      stage.appendChild(tip);
    }
    tip.hidden = false;
    var dots = tip.querySelector('.lot-hold-drawing-tip__dots');
    startDots(card, dots);
    return tip;
  }

  function clear(card) {
    if (!card) return;
    stopDots(card);
    var tip = card.querySelector('.lot-hold-drawing-tip');
    /* 直接移除，避免 persist 进 chatLog 后刷新又冒出「正在开奖」 */
    if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
  }

  /** 开盘/仪式结束：清掉聊天里所有残留「正在开奖」遮罩 */
  function clearAll(root) {
    var scope = root || document;
    var tips = scope.querySelectorAll
      ? scope.querySelectorAll('.lot-hold-drawing-tip')
      : [];
    for (var i = 0; i < tips.length; i++) {
      var tip = tips[i];
      var card =
        (tip.closest &&
          tip.closest(
            '.ssc-video-card, .ffc-video-card, .k3-video-card, .jsr-race-card, .bjsc-race-card, .jsb-race-card, .lhc-video-card, .lhc-result-card',
          )) ||
        tip.parentElement;
      if (card) stopDots(card);
      if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
    }
  }

  global.LotteryHoldTip = {
    ensure: ensure,
    clear: clear,
    clearAll: clearAll,
  };
})(typeof window !== 'undefined' ? window : this);
