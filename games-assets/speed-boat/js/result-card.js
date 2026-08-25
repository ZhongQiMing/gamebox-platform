/** 幸运飞艇开奖结果 — AI 精致飞艇 + 热带海面背景 */
(function (global) {
  const ASSETS = './assets/result/';
  const AI = ASSETS + 'ai/';
  const BALLS = './assets/balls/';
  const W = 720;
  const H = 400;
  const BOAT_VER = 'ai9';

  /** 冠军近景大、左右远景小，y 为艇底锚点，制造纵深 */
  const SLOTS = [
    { rank: 2, x: 0.18, w: 0.32, y: 0.78, z: 1 },
    { rank: 1, x: 0.50, w: 0.48, y: 1.02, z: 3 },
    { rank: 3, x: 0.82, w: 0.32, y: 0.78, z: 2 }
  ];

  /** 排名标签紧贴各自飞艇上方（海岛下面的海面区域） */
  const RANK_STYLE = {
    1: { label: '1st', colors: ['#fff8c8', '#ffd23e', '#f08a00'], edge: '#7a4a00', size: 54 },
    2: { label: '2nd', colors: ['#ffffff', '#c8d4e4', '#8a98ac'], edge: '#3a4454', size: 42 },
    3: { label: '3rd', colors: ['#ffd9a0', '#e88838', '#b05818'], edge: '#5c2e08', size: 42 }
  };

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
    return '<span class="jsb-ball' + c + '" data-n="' + n + '"><img class="jsb-ball__img" src="' +
      BALLS + 'ball-' + String(n).padStart(2, '0') + '.png?v=n2" alt="' + n + '"></span>';
  }

  /** 背景 cover 铺满画布，消除顶部黑边 */
  function drawStageBg(ctx, img) {
    const scale = Math.max(W / img.width, H / img.height);
    const iw = img.width * scale;
    const ih = img.height * scale;
    const dx = (W - iw) / 2;
    const dy = (H - ih) / 2;
    ctx.drawImage(img, dx, dy, iw, ih);
  }

  /** 顶部阳光渐层，增强热带氛围 */
  function drawSunlight(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.3);
    g.addColorStop(0, 'rgba(255,250,225,0.16)');
    g.addColorStop(1, 'rgba(255,250,225,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.3);
  }

  /** 四周暗角，聚焦画面中心 */
  function drawVignette(ctx) {
    const g = ctx.createRadialGradient(W / 2, H * 0.48, H * 0.5, W / 2, H * 0.52, H * 1.1);
    g.addColorStop(0, 'rgba(2,26,52,0)');
    g.addColorStop(1, 'rgba(2,26,52,0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /** 艇底水面接触阴影，让飞艇“坐进”海面 */
  function drawWaterContact(ctx, cx, cy, bw) {
    const rx = bw * 0.5;
    const ry = Math.max(8, bw * 0.075);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(5,32,56,0.4)');
    g.addColorStop(0.65, 'rgba(5,32,56,0.16)');
    g.addColorStop(1, 'rgba(5,32,56,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRankBadge(ctx, slot) {
    const theme = RANK_STYLE[slot.rank];
    const cx = W * slot.x;
    const cy = slot.labelY != null ? slot.labelY : H * 0.4;
    const sz = theme.size;
    ctx.save();
    ctx.font = '900 italic ' + sz + 'px "Arial Black", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,20,40,0.45)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    ctx.lineWidth = Math.max(3, sz * 0.14);
    ctx.strokeStyle = theme.edge;
    ctx.strokeText(theme.label, cx, cy);
    ctx.shadowColor = 'transparent';
    const g = ctx.createLinearGradient(cx, cy - sz, cx, cy);
    g.addColorStop(0, theme.colors[0]);
    g.addColorStop(0.55, theme.colors[1]);
    g.addColorStop(1, theme.colors[2]);
    ctx.fillStyle = g;
    ctx.fillText(theme.label, cx, cy);
    ctx.restore();
  }

  function drawBoat(ctx, img, slot) {
    const cx = W * slot.x;
    const bottom = H * slot.y;
    const bw = W * slot.w;
    const bh = img.height * (bw / img.width);
    const top = bottom - bh;
    drawWaterContact(ctx, cx, bottom - bh * 0.08, bw);
    ctx.drawImage(img, cx - bw / 2, top, bw, bh);
    slot.labelY = top - bh * 0.08;
  }

  function boatPath(n) {
    return AI + 'boat-' + String(n).padStart(2, '0') + '.png?v=' + BOAT_VER;
  }

  async function composeStage(canvas, nums) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    const top3 = [
      { n: nums[1], rank: 2 },
      { n: nums[0], rank: 1 },
      { n: nums[2], rank: 3 }
    ];
    const bg = await loadImg(ASSETS + 'bg.webp?v=' + BOAT_VER);
    const boats = await Promise.all(top3.map(t => loadImg(boatPath(t.n))));

    canvas.width = W;
    canvas.height = H;
    drawStageBg(ctx, bg);
    drawSunlight(ctx);

    const layers = top3.map((t, i) => ({
      t,
      slot: SLOTS.find(s => s.rank === t.rank),
      img: boats[i]
    })).sort((a, b) => a.slot.z - b.slot.z);

    layers.forEach(({ slot, img }) => drawBoat(ctx, img, slot));
    drawVignette(ctx);
    SLOTS.forEach(slot => drawRankBadge(ctx, slot));
  }

  function buildResultCardHtml(nums, issue, meta, lh) {
    const no = 'No.' + String(issue || '');
    const gy = String(meta.text || '').replace(/\s+/g, ' ').trim();
    return '<div class="jsb-result-card is-reveal" data-issue="' + String(issue) + '">' +
      '<header class="jsb-rc-head"><span class="jsb-rc-title">幸运飞艇</span>' +
      '<div class="jsb-rc-balls">' + nums.map(n => ballHtml(n, 'sm')).join('') + '</div></header>' +
      '<div class="jsb-rc-stage"><canvas class="jsb-rc-canvas" width="' + W + '" height="' + H + '" data-nums="' + nums.join(',') + '"></canvas></div>' +
      '<footer class="jsb-rc-foot">' +
      '<div class="jsb-rc-pill"><span class="k">期号</span><span class="v">' + no + '</span></div>' +
      '<div class="jsb-rc-pill"><span class="k">冠亚军和</span><span class="v">' + gy + '</span></div>' +
      '<div class="jsb-rc-pill jsb-rc-pill--lh"><span class="k">1-5龙虎</span><span class="v lh">' + lh + '</span></div>' +
      '</footer></div>';
  }

  function setBallNum(el, n) {
    if (!el) return;
    el.setAttribute('data-n', String(n));
    const img = el.querySelector('img');
    if (img) {
      img.src = BALLS + 'ball-' + String(n).padStart(2, '0') + '.png?v=n2';
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
    const card = root && root.classList && root.classList.contains('jsb-result-card')
      ? root : root && root.closest('.jsb-result-card');
    const canvas = card && card.querySelector('.jsb-rc-canvas');
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
          if (canvas.isConnected) canvas.outerHTML = '<div class="jsb-rc-fail">加载失败</div>';
          if (typeof onDone === 'function') onDone();
        });
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else run();
      return;
    }

    const durationMs = Math.max(2800, forced);
    const ballEls = card.querySelectorAll('.jsb-rc-balls .jsb-ball');
    const stage = card.querySelector('.jsb-rc-stage');
    const foot = card.querySelector('.jsb-rc-foot');
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
        if (canvas.isConnected) canvas.outerHTML = '<div class="jsb-rc-fail">加载失败</div>';
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

  global.JsbResultCard = { build: buildResultCardHtml, bindStage, ballHtml };
})(typeof window !== 'undefined' ? window : this);
