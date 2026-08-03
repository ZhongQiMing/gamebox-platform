/** PK10 风格横版十车道赛车开奖动画（Canvas 自绘，预览/原型用） */
(function (global) {
  'use strict';

  var CAR_RGB = {
    1: [248, 200, 40], 2: [40, 136, 232], 3: [72, 72, 72], 4: [248, 104, 8],
    5: [56, 216, 248], 6: [104, 72, 216], 7: [160, 168, 176], 8: [248, 8, 56],
    9: [200, 40, 160], 10: [40, 232, 104]
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function gyMeta(nums) {
    var sum = Number(nums[0]) + Number(nums[1]);
    var size = sum > 11 ? '大' : '小';
    var parity = sum % 2 ? '单' : '双';
    return sum + ' ' + size + ' ' + parity;
  }

  function lhRow(nums) {
    var out = '';
    for (var i = 0; i < 5; i++) {
      out += Number(nums[i]) > Number(nums[9 - i]) ? '龙' : '虎';
    }
    return out;
  }

  function drawSky(ctx, w, h, scroll) {
    var g = ctx.createLinearGradient(0, 0, 0, h * 0.62);
    g.addColorStop(0, '#5eb8ff');
    g.addColorStop(0.45, '#8fd4ff');
    g.addColorStop(1, '#c8ecff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h * 0.62);

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(w * 0.18 + scroll * 0.08, h * 0.12, 42, 16, 0, 0, Math.PI * 2);
    ctx.ellipse(w * 0.22 + scroll * 0.08, h * 0.11, 54, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(w * 0.72 - scroll * 0.05, h * 0.08, 36, 14, 0, 0, Math.PI * 2);
    ctx.ellipse(w * 0.76 - scroll * 0.05, h * 0.075, 48, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    var sea = ctx.createLinearGradient(0, h * 0.38, 0, h * 0.62);
    sea.addColorStop(0, '#2a8fd4');
    sea.addColorStop(1, '#1a6aa8');
    ctx.fillStyle = sea;
    ctx.fillRect(0, h * 0.38, w, h * 0.24);

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    for (var i = 0; i < 6; i++) {
      var y = h * 0.42 + i * 10 + (scroll * 0.3 % 20);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (var x = 0; x <= w; x += 28) {
        ctx.lineTo(x, y + (x % 56 ? 3 : -3));
      }
      ctx.stroke();
    }

    ctx.fillStyle = '#3cb878';
    ctx.beginPath();
    ctx.moveTo(w * 0.08 - scroll * 0.15, h * 0.56);
    ctx.quadraticCurveTo(w * 0.12 - scroll * 0.15, h * 0.48, w * 0.18 - scroll * 0.15, h * 0.56);
    ctx.lineTo(w * 0.18 - scroll * 0.15, h * 0.62);
    ctx.lineTo(w * 0.08 - scroll * 0.15, h * 0.62);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#2a9858';
    ctx.beginPath();
    ctx.arc(w * 0.11 - scroll * 0.15, h * 0.5, 8, 0, Math.PI * 2);
    ctx.arc(w * 0.14 - scroll * 0.15, h * 0.47, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(w * 0.86 + scroll * 0.12, h * 0.5);
    ctx.lineTo(w * 0.9 + scroll * 0.12, h * 0.46);
    ctx.lineTo(w * 0.94 + scroll * 0.12, h * 0.5);
    ctx.lineTo(w * 0.9 + scroll * 0.12, h * 0.54);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c62828';
    ctx.fillRect(w * 0.892 + scroll * 0.12, h * 0.465, 3, 7);
  }

  function drawTrack(ctx, w, h, scroll) {
    var top = h * 0.58;
    var bottom = h * 0.96;
    var trackH = bottom - top;

    ctx.fillStyle = '#2a2d32';
    ctx.fillRect(0, top, w, trackH);

    var laneH = trackH / 10;
    for (var i = 0; i <= 10; i++) {
      var ly = top + i * laneH;
      ctx.strokeStyle = i === 0 || i === 10 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)';
      ctx.lineWidth = i === 0 || i === 10 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(w, ly);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([14, 18]);
    ctx.lineDashOffset = -scroll * 0.6;
    for (var lane = 0; lane < 10; lane++) {
      var cy = top + lane * laneH + laneH * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(w, cy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    var stripeW = 26;
    for (var sx = -stripeW + (scroll * 0.45 % stripeW); sx < w + stripeW; sx += stripeW) {
      ctx.fillStyle = (Math.floor(sx / stripeW) % 2) ? '#e53935' : '#ffffff';
      ctx.fillRect(sx, top - 8, stripeW * 0.5, 8);
    }

    for (var bx = -40 + (scroll * 0.55 % 40); bx < w + 40; bx += 40) {
      ctx.fillStyle = (Math.floor(bx / 40) % 2) ? '#ffd54f' : '#111';
      ctx.beginPath();
      ctx.moveTo(bx, bottom);
      ctx.lineTo(bx + 20, bottom + 14);
      ctx.lineTo(bx + 40, bottom);
      ctx.closePath();
      ctx.fill();
    }
  }

  function rgbStr(rgb, a) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (a == null ? 1 : a) + ')';
  }

  function drawCarSide(ctx, x, y, w, h, num, rgb, opts) {
    opts = opts || {};
    var body = rgbStr(rgb);
    var dark = rgbStr(rgb.map(function (c) { return Math.round(c * 0.55); }));
    var hi = rgbStr(rgb.map(function (c) { return Math.min(255, c + 40); }));

    ctx.save();
    ctx.translate(x, y);

    if (opts.flame) {
      var fg = ctx.createLinearGradient(-w * 0.35, 0, -w * 0.05, 0);
      fg.addColorStop(0, 'rgba(255,120,0,0)');
      fg.addColorStop(0.35, 'rgba(255,180,40,0.85)');
      fg.addColorStop(0.7, 'rgba(255,60,180,0.75)');
      fg.addColorStop(1, 'rgba(180,40,255,0.2)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(-w * 0.08, -h * 0.08);
      ctx.quadraticCurveTo(-w * 0.28, 0, -w * 0.34, h * 0.06);
      ctx.quadraticCurveTo(-w * 0.22, h * 0.02, -w * 0.08, h * 0.08);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(w * 0.46, h * 0.52, w * 0.42, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(w * 0.06, h * 0.38);
    ctx.lineTo(w * 0.22, h * 0.12);
    ctx.lineTo(w * 0.52, h * 0.08);
    ctx.lineTo(w * 0.82, h * 0.16);
    ctx.lineTo(w * 0.92, h * 0.34);
    ctx.lineTo(w * 0.88, h * 0.48);
    ctx.lineTo(w * 0.12, h * 0.48);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = hi;
    ctx.beginPath();
    ctx.moveTo(w * 0.24, h * 0.14);
    ctx.lineTo(w * 0.5, h * 0.1);
    ctx.lineTo(w * 0.62, h * 0.18);
    ctx.lineTo(w * 0.28, h * 0.22);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(20,30,50,0.75)';
    ctx.fillRect(w * 0.28, h * 0.14, w * 0.34, h * 0.12);

    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(w * 0.22, h * 0.48, h * 0.16, 0, Math.PI * 2);
    ctx.arc(w * 0.72, h * 0.48, h * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ddd';
    ctx.beginPath();
    ctx.arc(w * 0.22, h * 0.48, h * 0.08, 0, Math.PI * 2);
    ctx.arc(w * 0.72, h * 0.48, h * 0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1.5;
    ctx.font = '900 ' + Math.round(h * 0.38) + 'px Arial Black, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(String(num), w * 0.56, h * 0.32);
    ctx.fillText(String(num), w * 0.56, h * 0.32);

    ctx.restore();
  }

  function buildRankBadges(order) {
    return order.map(function (num, idx) {
      var rgb = CAR_RGB[num] || [200, 200, 200];
      return '<span class="rd-rank" style="--c:' + rgbStr(rgb) + '" title="第' + (idx + 1) + '名">' + num + '</span>';
    }).join('');
  }

  function RaceDraw(root, opts) {
    opts = opts || {};
    this.root = root;
    this.issue = opts.issue || '575036';
    this.brand = opts.brand || 'YX22.COM';
    this.counter = opts.counter || '783939887';
    this.durationMs = opts.durationMs || 6800;
    this.running = false;
    this.raf = 0;
    this.scroll = 0;
    this.finishOrder = (opts.nums || [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]).slice();
    this.liveOrder = this.finishOrder.slice();
    this._mount();
  }

  RaceDraw.prototype._mount = function () {
    this.root.innerHTML =
      '<div class="rd-screen">' +
        '<header class="rd-hud rd-hud--top">' +
          '<div class="rd-hud__brand">' +
            '<span class="rd-hud__site">' + this.brand + '</span>' +
            '<span class="rd-hud__issue">期数: <em id="rdIssue">' + this.issue + '</em></span>' +
          '</div>' +
          '<div class="rd-hud__ranks" id="rdRanks">' + buildRankBadges(this.finishOrder) + '</div>' +
          '<div class="rd-hud__counter">' +
            '<span class="rd-hud__speaker" aria-hidden="true">🔊</span>' +
            '<span class="rd-hud__num" id="rdCounter">' + this.counter + '</span>' +
          '</div>' +
        '</header>' +
        '<div class="rd-canvas-wrap"><canvas class="rd-canvas"></canvas></div>' +
        '<footer class="rd-hud rd-hud--foot">' +
          '<span>期号 <em id="rdFootIssue">' + this.issue + '</em></span>' +
          '<span>冠亚军和 <em id="rdGy">' + gyMeta(this.finishOrder) + '</em></span>' +
          '<span>1-5 龙虎 <em id="rdLh">' + lhRow(this.finishOrder) + '</em></span>' +
        '</footer>' +
      '</div>';

    this.canvas = this.root.querySelector('.rd-canvas');
    this.ctx = this.canvas.getContext('2d');
    this._resize();
    this._drawFrame(0, 1);
    var self = this;
    this._onResize = function () { self._resize(); if (!self.running) self._drawFrame(0, 1); };
    window.addEventListener('resize', this._onResize);
  };

  RaceDraw.prototype._resize = function () {
    var wrap = this.root.querySelector('.rd-canvas-wrap');
    var rect = wrap.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(320, Math.round(rect.width));
    this.h = Math.max(180, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.trackTop = this.h * 0.58;
    this.trackBottom = this.h * 0.96;
    this.laneH = (this.trackBottom - this.trackTop) / 10;
    this.carW = this.w * 0.11;
    this.carH = this.laneH * 0.72;
  };

  RaceDraw.prototype.setIssue = function (issue) {
    this.issue = String(issue);
    var el = this.root.querySelector('#rdIssue');
    var foot = this.root.querySelector('#rdFootIssue');
    if (el) el.textContent = this.issue;
    if (foot) foot.textContent = this.issue;
  };

  RaceDraw.prototype.setOrder = function (nums) {
    if (!nums || nums.length !== 10) return;
    this.finishOrder = nums.map(Number);
    this.liveOrder = this.finishOrder.slice();
    this._updateMeta();
    this._updateRanks(this.finishOrder);
    if (!this.running) this._drawFrame(0, 1);
  };

  RaceDraw.prototype._updateMeta = function () {
    var gy = this.root.querySelector('#rdGy');
    var lh = this.root.querySelector('#rdLh');
    if (gy) gy.textContent = gyMeta(this.finishOrder);
    if (lh) lh.textContent = lhRow(this.finishOrder);
  };

  RaceDraw.prototype._updateRanks = function (order) {
    var el = this.root.querySelector('#rdRanks');
    if (el) el.innerHTML = buildRankBadges(order);
  };

  RaceDraw.prototype._laneY = function (num) {
    var lane = num - 1;
    return this.trackTop + lane * this.laneH + (this.laneH - this.carH) * 0.5;
  };

  RaceDraw.prototype._drawFrame = function (tNorm, progress) {
    var ctx = this.ctx;
    var w = this.w;
    var h = this.h;
    var scroll = this.scroll + progress * w * 2.4;

    ctx.clearRect(0, 0, w, h);
    drawSky(ctx, w, h, scroll);
    drawTrack(ctx, w, h, scroll);

    var finishX = w * 0.86;
    var startX = -this.carW * 1.2;
    var self = this;

    this.finishOrder.forEach(function (num, rankIdx) {
      var rank = rankIdx;
      var laneY = self._laneY(num);
      var stagger = rank * 0.045;
      var local = clamp((progress - stagger) / (1 - stagger * 0.55), 0, 1);
      var eased = easeOutCubic(local);
      var wobble = self.running ? Math.sin((scroll + rank * 40) * 0.08) * self.laneH * 0.04 : 0;
      var x = lerp(startX + rank * 18, finishX - rank * (self.carW * 0.22), eased);
      var rgb = CAR_RGB[num] || [180, 180, 180];
      drawCarSide(ctx, x, laneY + wobble, self.carW, self.carH, num, rgb, {
        flame: rank <= 1 && progress > 0.35
      });
    });
  };

  RaceDraw.prototype.play = function (opts) {
    opts = opts || {};
    var self = this;
    if (opts.nums) this.setOrder(opts.nums);
    if (opts.issue) this.setIssue(opts.issue);
    if (opts.durationMs) this.durationMs = opts.durationMs;
    if (this.running) this.stop(false);

    this.running = true;
    this.scroll = 0;
    var t0 = performance.now();
    var dur = this.durationMs;

    function frame(now) {
      var p = clamp((now - t0) / dur, 0, 1);
      self._drawFrame(p, p);
      if (p < 1) {
        self.raf = requestAnimationFrame(frame);
      } else {
        self.running = false;
        self._updateRanks(self.finishOrder);
        if (typeof opts.onDone === 'function') opts.onDone(self.finishOrder.slice());
      }
    }
    this.raf = requestAnimationFrame(frame);
  };

  RaceDraw.prototype.stop = function (redraw) {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (redraw !== false) this._drawFrame(0, 1);
  };

  RaceDraw.prototype.destroy = function () {
    this.stop(false);
    window.removeEventListener('resize', this._onResize);
    this.root.innerHTML = '';
  };

  global.RaceDraw = {
    CAR_RGB: CAR_RGB,
    gyMeta: gyMeta,
    lhRow: lhRow,
    create: function (root, opts) { return new RaceDraw(root, opts); }
  };
})(typeof window !== 'undefined' ? window : this);
