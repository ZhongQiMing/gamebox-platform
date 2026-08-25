/** 极速赛车开奖结果 v55 — 月桂冠 + 赛车/牌照/底栏 */
(function (global) {
  const ASSETS = './assets/result/';
  const BALLS = './assets/balls/';
  const W = 720;
  const H = 400;
  const BG_ZOOM = 1.38;
  const BG_FOCUS_Y = 0.76;
  const GROUND = 0.9;
  const CAR_RGB = {
    1: [248, 200, 40], 2: [40, 136, 232], 3: [72, 72, 72], 4: [248, 104, 8],
    5: [56, 216, 248], 6: [104, 72, 216], 7: [120, 120, 120], 8: [248, 8, 56],
    9: [152, 88, 24], 10: [40, 232, 104]
  };
  const CAR_VER = '6';
  const LAUREL_VER = '27';
  const LAUREL_CAR_W = 0.48;
  // 三枚桂冠 PNG 布局一致；圆盘中心/直径由 laurel-gold 像素实测
  const LAUREL_DISK_X = 0.5;
  const LAUREL_DISK_Y = 0.592;
  const LAUREL_DISK_W = 0.341;
  const LAURELS = {
    1: { file: 'laurel-gold.webp', yCenter: 0.220, num: '#ffffff', stroke: 'rgba(0,0,0,0.45)' },
    2: { file: 'laurel-silver.webp', yCenter: 0.315, num: '#ffffff', stroke: 'rgba(0,0,0,0.4)' },
    3: { file: 'laurel-bronze.webp', yCenter: 0.315, num: '#ffffff', stroke: 'rgba(0,0,0,0.4)' }
  };
  const SLOTS = [
    { rank: 2, label: '亚军', x: 0.24, sc: 0.69, y: 0.93, flip: false, view: 'side', dim: 0.96 },
    { rank: 1, label: '冠军', x: 0.5, sc: 0.96, y: 0.96, flip: false, view: 'front', dim: 1 },
    { rank: 3, label: '季军', x: 0.76, sc: 0.69, y: 0.93, flip: true, view: 'side', dim: 0.96 }
  ];

  const cache = Object.create(null);
  function loadImg(src) {
    if (cache[src]) return cache[src];
    cache[src] = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const done = () => resolve(img);
        if (img.decode) img.decode().then(done).catch(done);
        else done();
      };
      img.onerror = () => { delete cache[src]; reject(new Error(src)); };
      img.src = src;
    });
    return cache[src];
  }

  function ballHtml(n, cls) {
    const c = cls ? ' ' + cls : '';
    return '<span class="jsr-ball' + c + '" data-n="' + n + '"><img class="jsr-ball__img" src="' +
      BALLS + 'ball-' + String(n).padStart(2, '0') + '.png" alt="' + n + '"></span>';
  }

  function drawStageBg(ctx, img, w, h) {
    const r = (w / img.width) * BG_ZOOM;
    const iw = img.width * r;
    const ih = img.height * r;
    const dx = (w - iw) / 2;
    const dy = h * GROUND - ih * BG_FOCUS_Y;
    ctx.drawImage(img, dx, dy, iw, ih);
  }

  function drawVignette(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(0.4, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawLaurel(ctx, laurelImg, slot, n, laurelW) {
    const theme = LAURELS[slot.rank];
    const cx = W * slot.x;
    const lw = laurelW;
    const lh = laurelImg.height * (lw / laurelImg.width);
    const bx = cx - lw / 2;
    const by = H * theme.yCenter - lh / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = slot.rank === 1 ? 8 : 6;
    ctx.shadowOffsetY = 2;
    ctx.drawImage(laurelImg, bx, by, lw, lh);
    ctx.restore();

    const numCx = bx + lw * LAUREL_DISK_X;
    const numCy = by + lh * LAUREL_DISK_Y + lw * LAUREL_DISK_W * 0.04;
    const diskD = lw * LAUREL_DISK_W;
    const numSz = Math.round(diskD * 0.68);
    ctx.font = '900 ' + numSz + 'px "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(1.5, numSz * 0.07);
    ctx.strokeStyle = theme.stroke;
    ctx.strokeText(String(n), numCx, numCy);
    ctx.fillStyle = theme.num;
    ctx.fillText(String(n), numCx, numCy);
  }

  function drawCarGlow(ctx, rgb, cx, bottom, w, rank) {
    const [r, g, b] = rgb;
    const rad = w * (rank === 1 ? 0.72 : 0.55);
    const grad = ctx.createRadialGradient(cx, bottom, 0, cx, bottom, rad);
    grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',' + (rank === 1 ? 0.22 : 0.14) + ')');
    grad.addColorStop(0.55, 'rgba(' + r + ',' + g + ',' + b + ',0.04)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - rad, bottom - rad * 0.35, rad * 2, rad * 0.7);
  }

  // 牌照位置：母版实测 + 视觉微调
  const PLATE_POS = {
    front: { x: 0.4972, y: 0.762, pw: 0.275, ph: 0.0923, hiRes: 2 },
    side: { x: 0.1631, y: 0.812, pw: 0.142, ph: 0.106, hiRes: 6 },
    sideFlip: { x: 0.1631, y: 0.818, pw: 0.142, ph: 0.106, hiRes: 6 }
  };

  function plateConfig(slot) {
    if (slot.view === 'side' && slot.flip) return PLATE_POS.sideFlip;
    return PLATE_POS[slot.view];
  }

  function roundRect(ctx, x, y, rw, rh, r) {
    r = Math.min(r, rw / 2, rh / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + rw - r, y);
    ctx.quadraticCurveTo(x + rw, y, x + rw, y + r);
    ctx.lineTo(x + rw, y + rh - r);
    ctx.quadraticCurveTo(x + rw, y + rh, x + rw - r, y + rh);
    ctx.lineTo(x + r, y + rh);
    ctx.quadraticCurveTo(x, y + rh, x, y + rh - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function fitPlateFontSize(ctx, text, plateW, plateH) {
    const family = '"Arial Black", Impact, sans-serif';
    let lo = 8;
    let hi = Math.max(12, Math.ceil(plateH * 1.2));
    let best = lo;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      ctx.font = '900 ' + mid + 'px ' + family;
      const m = ctx.measureText(text);
      const tw = m.width;
      const th = (m.actualBoundingBoxAscent || mid * 0.82) +
        (m.actualBoundingBoxDescent || mid * 0.18);
      if (tw <= plateW * 0.98 && th <= plateH * 0.94) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  function paintPlateLayer(ctx, text, pw, ph, hiRes) {
    const scale = hiRes || 1;
    const rw = Math.max(1, Math.ceil(pw * scale));
    const rh = Math.max(1, Math.ceil(ph * scale));
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 0, 0, rw, rh, Math.max(1, rh * 0.12));
    ctx.fill();
    const sz = fitPlateFontSize(ctx, text, rw, rh);
    ctx.font = '900 ' + sz + 'px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000000';
    ctx.fillText(text, rw / 2, rh / 2);
  }

  function drawPlateNumber(ctx, slot, n, cx, bottom, w, h) {
    const p = plateConfig(slot);
    if (!p) return;
    let px = cx - w / 2 + w * p.x;
    let py = bottom - h + h * p.y;
    if (slot.flip) px = cx + w / 2 - w * p.x;

    const padW = slot.view === 'side' ? 1.06 : 1.0;
    const padH = slot.view === 'side' ? 1.08 : 1.0;
    const plateW = w * p.pw * padW;
    const plateH = h * p.ph * padH;
    const x0 = px - plateW / 2;
    const y0 = py - plateH / 2;
    const text = String(n);
    const hiRes = p.hiRes || 1;

    ctx.save();
    ctx.translate(x0, y0);
    if (hiRes > 1 && typeof document !== 'undefined') {
      const oc = document.createElement('canvas');
      oc.width = Math.max(1, Math.ceil(plateW * hiRes));
      oc.height = Math.max(1, Math.ceil(plateH * hiRes));
      const octx = oc.getContext('2d');
      if (octx) {
        paintPlateLayer(octx, text, plateW, plateH, hiRes);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(oc, 0, 0, plateW, plateH);
        ctx.restore();
        return;
      }
    }
    paintPlateLayer(ctx, text, plateW, plateH, 1);
    ctx.restore();
  }

  function drawCar(ctx, img, slot, n) {
    const rgb = CAR_RGB[n] || [200, 200, 200];
    const cx = W * slot.x;
    const bottom = H * slot.y;
    const w = img.width * slot.sc;
    const h = img.height * slot.sc;

    drawCarGlow(ctx, rgb, cx, bottom, w, slot.rank);

    if (slot.rank === 1) {
      const g = ctx.createRadialGradient(cx, bottom, 0, cx, bottom, w * 0.7);
      g.addColorStop(0, 'rgba(240,200,48,0.24)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - w, bottom - w * 0.3, w * 2, w * 0.55);
    }

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    const sw = slot.rank === 1 ? 0.38 : 0.32;
    ctx.ellipse(cx, bottom + 2, w * sw, w * 0.048, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.globalAlpha = slot.dim;
    ctx.translate(cx, bottom);
    if (slot.flip) ctx.scale(-1, 1);
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = slot.rank === 1 ? 16 : 11;
    ctx.shadowOffsetY = slot.rank === 1 ? 7 : 5;
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
    drawPlateNumber(ctx, slot, n, cx, bottom, w, h);
  }

  function carHeight(img, slot) {
    return img.height * slot.sc;
  }

  function carPath(n, view) {
    const prefix = view === 'front' ? 'race-car-front-' : 'race-car-side-';
    return ASSETS + prefix + String(n).padStart(2, '0') + '.png?v=' + CAR_VER;
  }

  async function composeStage(canvas, nums) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    const top3 = [
      { n: nums[1], rank: 2 },
      { n: nums[0], rank: 1 },
      { n: nums[2], rank: 3 }
    ];
    const bg = await loadImg(ASSETS + 'bg.webp');
    const laurelByRank = {};
    await Promise.all([1, 2, 3].map(async r => {
      laurelByRank[r] = await loadImg(ASSETS + LAURELS[r].file + '?v=' + LAUREL_VER);
    }));
    const imgs = await Promise.all(top3.map(t => {
      const slot = SLOTS.find(s => s.rank === t.rank);
      return loadImg(carPath(t.n, slot.view));
    }));

    canvas.width = W;
    canvas.height = H;
    drawStageBg(ctx, bg, W, H);
    drawVignette(ctx);

    const championSlot = SLOTS.find(s => s.rank === 1);
    const championIdx = top3.findIndex(t => t.rank === 1);
    const laurelW = imgs[championIdx].width * championSlot.sc * LAUREL_CAR_W;

    [0, 2, 1].forEach(i => {
      const t = top3[i];
      const slot = SLOTS.find(s => s.rank === t.rank);
      drawLaurel(ctx, laurelByRank[t.rank], slot, t.n, laurelW);
    });

    [0, 2, 1].forEach(i => {
      const t = top3[i];
      const slot = SLOTS.find(s => s.rank === t.rank);
      drawCar(ctx, imgs[i], slot, t.n);
    });
  }

  function buildResultCardHtml(nums, issue, meta, lh) {
    const no = 'No.' + String(issue || '');
    const gy = String(meta.text || '').replace(/\s+/g, ' ').trim();
    return '<div class="jsr-result-card is-reveal" data-issue="' + String(issue) + '">' +
      '<header class="jsr-rc-head"><span class="jsr-rc-title">极速赛车</span>' +
      '<div class="jsr-rc-balls">' + nums.map(n => ballHtml(n, 'sm')).join('') + '</div></header>' +
      '<div class="jsr-rc-stage"><canvas class="jsr-rc-canvas" width="' + W + '" height="' + H + '" data-nums="' + nums.join(',') + '"></canvas></div>' +
      '<footer class="jsr-rc-foot">' +
      '<div class="jsr-rc-pill"><span class="k">期号</span><span class="v">' + no + '</span></div>' +
      '<div class="jsr-rc-pill"><span class="k">冠亚和</span><span class="v">' + gy + '</span></div>' +
      '<div class="jsr-rc-pill jsr-rc-pill--lh"><span class="k">1-5龙虎</span><span class="v lh">' + lh + '</span></div>' +
      '</footer></div>';
  }

  function setBallNum(el, n) {
    if (!el) return;
    el.setAttribute('data-n', String(n));
    const img = el.querySelector('img');
    if (img) {
      img.src = BALLS + 'ball-' + String(n).padStart(2, '0') + '.png';
      img.alt = String(n);
    }
  }

  /**
   * @param {HTMLElement} root
   * @param {Function} [onDone]
   * @param {{ durationMs?: number }} [opts] 直播仪式总时长（顶栏球滚动 + 颁奖台）；缺省为历史瞬落
   */
  function bindStage(root, onDone, opts) {
    opts = opts || {};
    const forced = Number(opts.durationMs) || 0;
    const card = root && root.classList && root.classList.contains('jsr-result-card')
      ? root : root && root.closest('.jsr-result-card');
    const canvas = card && card.querySelector('.jsr-rc-canvas');
    if (!canvas || !canvas.dataset.nums) {
      if (typeof onDone === 'function') onDone();
      return;
    }
    const nums = canvas.dataset.nums.split(',').map(Number);
    if (nums.length !== 10 || nums.some(n => n < 1 || n > 10)) {
      if (typeof onDone === 'function') onDone();
      return;
    }

    if (forced <= 0) {
      const run = function () {
        composeStage(canvas, nums).then(function () {
          if (typeof onDone === 'function') onDone();
        }).catch(function () {
          if (canvas.isConnected) canvas.outerHTML = '<div class="jsr-rc-fail">加载失败</div>';
          if (typeof onDone === 'function') onDone();
        });
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else run();
      return;
    }

    const durationMs = Math.max(2800, forced);
    const ballEls = card.querySelectorAll('.jsr-rc-balls .jsr-ball');
    const stage = card.querySelector('.jsr-rc-stage');
    const foot = card.querySelector('.jsr-rc-foot');
    card.classList.add('is-drawing');
    card.classList.remove('is-reveal');
    if (stage) stage.style.opacity = '0.28';
    if (foot) foot.style.opacity = '0.35';

    const rollUntil = Math.max(1200, durationMs - 900);
    const t0 = performance.now();
    let lastSwap = 0;
    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      ballEls.forEach(function (el, i) { setBallNum(el, nums[i]); });
      const paint = composeStage(canvas, nums).then(function () {
        if (stage) stage.style.opacity = '';
        if (foot) foot.style.opacity = '';
        card.classList.remove('is-drawing');
        card.classList.add('is-reveal');
      }).catch(function () {
        if (canvas.isConnected) canvas.outerHTML = '<div class="jsr-rc-fail">加载失败</div>';
        if (stage) stage.style.opacity = '';
        if (foot) foot.style.opacity = '';
        card.classList.remove('is-drawing');
        card.classList.add('is-reveal');
      });
      function afterPaint() {
        const left = Math.max(0, durationMs - (performance.now() - t0));
        setTimeout(function () {
          if (typeof onDone === 'function') onDone();
        }, left);
      }
      paint.then(afterPaint, afterPaint);
    }

    function frame(now) {
      if (now - lastSwap > 70) {
        lastSwap = now;
        ballEls.forEach(function (el) {
          setBallNum(el, 1 + Math.floor(Math.random() * 10));
        });
      }
      if (now - t0 >= rollUntil) {
        finish();
        return;
      }
      requestAnimationFrame(frame);
    }

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(frame);
    else finish();
  }

  global.JsrResultCard = { build: buildResultCardHtml, bindStage, ballHtml };
})(typeof window !== 'undefined' ? window : this);
