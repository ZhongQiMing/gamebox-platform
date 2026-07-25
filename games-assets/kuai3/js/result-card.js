/** 1分快三 · Canvas 合成开奖卡（PS 级 AI 素材） */
(function (global) {
  const ASSETS = './assets/result/';
  const VER = '37';
  const W = 720;
  const H = 380;
  const BG_ZOOM = 1.22;
  const BG_FOCUS_Y = 0.74;
  const GROUND = 0.92;
  const DICE_SC = 0.22;

  /** 绿色 felt 至木头桌边（含金线网格，以木边为界） */
  const FELT_BOUNDS = [
    [88, 38, 682], [94, 31, 688], [100, 21, 683], [106, 12, 680], [112, 41, 686], [118, 37, 710],
    [124, 27, 706], [130, 18, 701], [136, 10, 695], [142, 5, 687], [148, 5, 639], [154, 5, 676],
    [160, 5, 670], [166, 5, 668], [172, 5, 661], [178, 5, 656], [184, 5, 648], [190, 5, 645],
    [196, 5, 637], [202, 5, 633], [208, 5, 626], [214, 5, 621], [220, 5, 615], [226, 5, 607],
    [232, 5, 603], [238, 5, 596], [244, 5, 589], [250, 5, 583], [256, 5, 577], [262, 5, 573],
    [268, 5, 564], [274, 5, 560], [280, 5, 552], [286, 5, 546], [292, 5, 539], [298, 5, 531],
    [304, 5, 526], [310, 5, 517], [316, 5, 510], [322, 5, 503], [328, 7, 495],
  ];

  const SLOTS = [
    { x: 0.28, y: 0.84, sc: 0.22, rot: -0.06 },
    { x: 0.50, y: 0.86, sc: 0.23, rot: 0.03 },
    { x: 0.72, y: 0.84, sc: 0.22, rot: 0.08 },
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

  function loadDiceImg(n) {
    return loadImg(dicePath(n));
  }

  function dicePath(n) {
    return ASSETS + 'dice-' + String(n).padStart(2, '0') + '.png?v=' + VER;
  }

  function iconPath(n) {
    return ASSETS + 'icon-' + String(n).padStart(2, '0') + '.png?v=' + VER;
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
    g.addColorStop(0, 'rgba(0,0,0,0.22)');
    g.addColorStop(0.45, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawDiceAt(ctx, img, cx, bottom, sc, rot, alpha, squash, motionY) {
    const w = img.width * sc;
    const h = img.height * sc;
    const sq = squash == null || squash === 1 ? 1 : squash;
    ctx.save();
    ctx.globalAlpha = (alpha == null ? 1 : alpha) * 0.34;
    ctx.fillStyle = '#000';
    ctx.translate(cx, bottom + 1);
    ctx.rotate(rot || 0);
    ctx.scale(1, 0.2);
    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.34, w * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(cx, bottom);
    ctx.rotate(rot || 0);
    if (sq !== 1) ctx.scale(1, sq);
    if (motionY && Math.abs(motionY) > 0.5) {
      const steps = 3;
      const stretch = Math.min(14, Math.abs(motionY) * 0.35);
      for (let i = steps; i >= 0; i--) {
        ctx.save();
        ctx.globalAlpha = (alpha == null ? 1 : alpha) * (0.18 + 0.82 * (i / steps));
        ctx.translate(0, (motionY > 0 ? 1 : -1) * stretch * (i / steps));
        ctx.drawImage(img, -w / 2, -h, w, h);
        ctx.restore();
      }
    } else {
      ctx.drawImage(img, -w / 2, -h, w, h);
    }
    ctx.restore();
  }

  function drawDiceSlot(ctx, img, slot) {
    drawDiceAt(ctx, img, W * slot.x, H * slot.y, slot.sc, slot.rot, 1, 1);
  }

  async function composeStage(canvas, nums, layout) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    const bg = await loadImg(ASSETS + 'bg.png?v=' + VER);
    const diceImgs = await Promise.all(nums.map(n => loadDiceImg(n)));
    canvas.width = W;
    canvas.height = H;
    drawStageBg(ctx, bg, W, H);
    drawVignette(ctx);
    nums.forEach((n, i) => {
      const lay = layout && layout[i];
      if (lay) {
        drawDiceAt(ctx, diceImgs[i], lay.px, lay.py, lay.sc, lay.rot, 1, 1);
      } else {
        drawDiceSlot(ctx, diceImgs[i], SLOTS[i] || SLOTS[1]);
      }
    });
  }

  function feltLimits(py) {
    const rows = FELT_BOUNDS;
    const y1 = rows[0][0];
    const y2 = rows[rows.length - 1][0];
    if (py <= y1) return { x1: rows[0][1], x2: rows[0][2], y1, y2 };
    if (py >= y2) {
      const last = rows[rows.length - 1];
      return { x1: last[1], x2: last[2], y1, y2 };
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i];
      const b = rows[i + 1];
      if (py >= a[0] && py <= b[0]) {
        const t = (py - a[0]) / (b[0] - a[0]);
        return {
          x1: a[1] + (b[1] - a[1]) * t,
          x2: a[2] + (b[2] - a[2]) * t,
          y1,
          y2,
        };
      }
    }
    const last = rows[rows.length - 1];
    return { x1: last[1], x2: last[2], y1, y2 };
  }

  function diceHalfExtents(sc) {
    const base = W * (sc || DICE_SC);
    return { hw: base * 0.32, hh: base * 0.35 };
  }

  /** 桌面投影半径（比碰撞圆大，防止视觉叠骰） */
  function diceFootprint(sc) {
    return W * (sc || DICE_SC) * 0.46;
  }

  const DICE_GAP = 8;

  function diceRadius(sc) {
    return diceHalfExtents(sc).hw;
  }

  function parseRollLayout(raw) {
    if (!raw) return null;
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : null;
    } catch (e) {
      return null;
    }
  }

  function isDiceFrozen(s) {
    return !!(s.faceLocked || s.stopped);
  }

  function freezeDice(s) {
    s.lockPx = s.px;
    s.lockPy = s.py;
    s.vx = 0;
    s.vy = 0;
    s.wobble = 0;
    s.wobbleV = 0;
    s.rot = s.baseRot != null ? s.baseRot : s.rot;
  }

  function diceDrawPose(s) {
    if (isDiceFrozen(s) && s.lockPx != null) {
      return {
        px: s.lockPx,
        py: s.lockPy,
        rot: s.baseRot != null ? s.baseRot : 0,
      };
    }
    return { px: s.px, py: s.py, rot: s.rot };
  }

  function statesToLayout(states) {
    return states.map(s => {
      const pose = diceDrawPose(s);
      return {
        px: pose.px,
        py: pose.py,
        sc: s.sc,
        rot: s.baseRot != null ? s.baseRot : pose.rot,
      };
    });
  }

  function clearStageImpact(card) {
    if (!card) return;
    const stage = card.querySelector('.k3-rc-stage');
    if (stage) stage.classList.remove('is-impact');
    if (card._impactTimer) {
      clearTimeout(card._impactTimer);
      card._impactTimer = null;
    }
  }

  function spawnInZone(index, count, placed) {
    const cy = 250;
    const lim = feltLimits(cy);
    const cx = (lim.x1 + lim.x2) * 0.5;
    const minDist = diceFootprint(DICE_SC) * 2 + DICE_GAP + 4;
    for (let t = 0; t < 40; t++) {
      const angle = (index / count) * Math.PI * 2 + Math.random() * 0.8;
      const dist = minDist * (0.35 + Math.random() * 0.45);
      const px = cx + Math.cos(angle) * dist;
      const py = cy + Math.sin(angle) * dist * 0.45;
      const ok = placed.every(p => Math.hypot(px - p.px, py - p.py) >= minDist);
      if (ok) return { px, py };
    }
    return {
      px: cx + (index - 1) * minDist * 0.55,
      py: cy + (index % 2) * minDist * 0.25,
    };
  }

  function createRollStates(finalNums) {
    const placed = [];
    return finalNums.map((face, i) => {
      const pos = spawnInZone(i, finalNums.length, placed);
      placed.push(pos);
      const kick = W * (0.022 + Math.random() * 0.018);
      const dir = Math.random() * Math.PI * 2;
      const baseRot = (Math.random() - 0.5) * 0.1;
      return {
        face,
        px: pos.px,
        py: pos.py,
        vx: Math.cos(dir) * kick,
        vy: Math.sin(dir) * kick * 0.72,
        rot: baseRot,
        baseRot,
        wobble: 0,
        wobbleV: (Math.random() - 0.5) * 0.2,
        sc: DICE_SC * (0.96 + Math.random() * 0.06),
        shown: 1 + Math.floor(Math.random() * 6),
        faceLocked: false,
        faceSwapT: 0,
        stillT: 0,
        stopped: false,
      };
    });
  }

  function maybeSwapFace(s, dt) {
    if (s.faceLocked) {
      s.shown = s.face;
      return;
    }
    s.faceSwapT += dt;
    if (s.faceSwapT < 0.12) return;
    s.faceSwapT = 0;
    let next = 1 + Math.floor(Math.random() * 6);
    if (next === s.shown) next = (next % 6) + 1;
    s.shown = next;
  }

  function bounceWall(s, hw, hh) {
    if (isDiceFrozen(s)) return false;
    const cy = s.py - hh * 0.55;
    const lim = feltLimits(cy);
    const limFoot = feltLimits(s.py);
    const x1 = Math.max(lim.x1, limFoot.x1);
    const x2 = Math.min(lim.x2, limFoot.x2);
    let hit = false;
    const push = 5;
    const wallRest = 0.84;
    const minBounce = W * 0.0028;

    if (s.px - hw < x1) {
      s.px = x1 + hw + push;
      s.vx = Math.max(Math.abs(s.vx) * wallRest, minBounce);
      hit = true;
    } else if (s.px + hw > x2) {
      s.px = x2 - hw - push;
      s.vx = -Math.max(Math.abs(s.vx) * wallRest, minBounce);
      hit = true;
    }
    if (s.py - hh * 2 < lim.y1) {
      s.py = lim.y1 + hh * 2 + push;
      s.vy = Math.max(Math.abs(s.vy) * wallRest, minBounce);
      hit = true;
    } else if (s.py > lim.y2) {
      s.py = lim.y2 - push;
      s.vy = -Math.max(Math.abs(s.vy) * wallRest, minBounce);
      hit = true;
    }
    if (hit) s.wobbleV += (Math.random() - 0.5) * 0.65;
    return hit;
  }

  function resolveDicePair(a, b) {
    const r1 = diceFootprint(a.sc);
    const r2 = diceFootprint(b.sc);
    const dx = b.px - a.px;
    const dy = b.py - a.py;
    const dist = Math.hypot(dx, dy) || 0.001;
    const minD = r1 + r2 + DICE_GAP;
    if (dist >= minD) return false;

    const aFrozen = isDiceFrozen(a);
    const bFrozen = isDiceFrozen(b);
    if (aFrozen && bFrozen) return false;

    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minD - dist;
    if (!aFrozen && !bFrozen) {
      a.px -= nx * overlap * 0.5;
      a.py -= ny * overlap * 0.5;
      b.px += nx * overlap * 0.5;
      b.py += ny * overlap * 0.5;
    } else if (aFrozen && !bFrozen) {
      b.px += nx * overlap;
      b.py += ny * overlap;
    } else {
      a.px -= nx * overlap;
      a.py -= ny * overlap;
    }

    const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (rv < 0 && (!aFrozen || !bFrozen)) {
      const restitution = 0.88;
      const imp = -(1 + restitution) * rv * 0.52;
      if (!aFrozen) {
        a.vx += nx * imp;
        a.vy += ny * imp;
        a.wobbleV += imp * 0.55;
      }
      if (!bFrozen) {
        b.vx -= nx * imp;
        b.vy -= ny * imp;
        b.wobbleV -= imp * 0.55;
      }
      if (!aFrozen && !bFrozen) {
        const tx = -ny;
        const ty = nx;
        const tv = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty;
        const friction = 0.28;
        a.vx -= tx * tv * friction * 0.5;
        a.vy -= ty * tv * friction * 0.5;
        b.vx += tx * tv * friction * 0.5;
        b.vy += ty * tv * friction * 0.5;
      }
    }
    return true;
  }

  function hasDiceOverlap(states) {
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        const a = states[i];
        const b = states[j];
        const minD = diceFootprint(a.sc) + diceFootprint(b.sc) + DICE_GAP;
        if (Math.hypot(b.px - a.px, b.py - a.py) < minD - 0.5) return true;
      }
    }
    return false;
  }

  function relaxDiceLayout(states, passes) {
    for (let p = 0; p < passes; p++) {
      separateDice(states);
      states.forEach(s => {
        const ext = diceHalfExtents(s.sc);
        bounceWall(s, ext.hw, ext.hh);
      });
      if (!hasDiceOverlap(states)) break;
    }
  }

  function separateDice(states) {
    let hit = false;
    for (let i = 0; i < states.length; i++) {
      for (let j = i + 1; j < states.length; j++) {
        if (resolveDicePair(states[i], states[j])) hit = true;
      }
    }
    return hit;
  }

  function resolveCollisions(states) {
    let bounced = false;
    for (let pass = 0; pass < 10; pass++) {
      if (separateDice(states)) bounced = true;
      states.forEach(s => {
        if (isDiceFrozen(s)) return;
        const ext = diceHalfExtents(s.sc);
        if (bounceWall(s, ext.hw, ext.hh)) bounced = true;
      });
    }
    return bounced;
  }

  function stepRollStates(states, dt) {
    let bounced = false;
    const friction = Math.pow(0.978, dt * 60);

    states.forEach(s => {
      if (isDiceFrozen(s)) {
        s.px = s.lockPx;
        s.py = s.lockPy;
        return;
      }
      s.vx *= friction;
      s.vy *= friction;
      s.px += s.vx * dt * 60;
      s.py += s.vy * dt * 60;
    });

    if (resolveCollisions(states)) bounced = true;

    states.forEach(s => {
      if (isDiceFrozen(s)) {
        s.stillT += dt;
        if (s.stillT > 0.22) s.stopped = true;
        return;
      }

      const speed = Math.hypot(s.vx, s.vy);
      s.wobbleV += speed * 0.08;
      s.wobbleV *= Math.pow(0.9, dt * 60);
      s.wobble += s.wobbleV * dt * 60;
      s.wobble *= Math.pow(0.94, dt * 60);
      s.rot = s.baseRot + Math.max(-0.12, Math.min(0.12, s.wobble));

      if (speed > W * 0.0018) {
        s.stillT = 0;
        s.stopped = false;
        maybeSwapFace(s, dt);
      } else {
        s.faceLocked = true;
        s.shown = s.face;
        freezeDice(s);
        s.stillT += dt;
        if (s.stillT > 0.22) s.stopped = true;
      }
    });

    return bounced;
  }

  function allStopped(states) {
    return states.every(s => s.stopped);
  }

  async function animateRoll(canvas, finalNums, durationMs, onBounce, done) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    const bg = await loadImg(ASSETS + 'bg.png?v=' + VER);
    const diceByFace = {};
    await Promise.all([1, 2, 3, 4, 5, 6].map(async n => {
      diceByFace[n] = await loadDiceImg(n);
    }));

    canvas.width = W;
    canvas.height = H;
    const dur = durationMs || 4000;
    const states = createRollStates(finalNums);
    const start = performance.now();
    let last = start;
    let raf = null;
    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      if (raf) cancelAnimationFrame(raf);
      states.forEach(s => {
        s.faceLocked = true;
        s.shown = s.face;
        s.stopped = true;
        freezeDice(s);
      });
      const layout = statesToLayout(states);
      composeStage(canvas, finalNums, layout).then(() => {
        canvas.dataset.rollLayout = JSON.stringify(layout);
        if (done) done();
      }).catch(() => { if (done) done(); });
    }

    function frame(now) {
      const elapsed = now - start;
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      if (stepRollStates(states, dt) && onBounce && !allStopped(states)) onBounce();

      ctx.clearRect(0, 0, W, H);
      drawStageBg(ctx, bg, W, H);
      drawVignette(ctx);
      states.slice().sort((a, b) => a.py - b.py).forEach(s => {
        const img = diceByFace[s.shown] || diceByFace[s.face];
        const pose = diceDrawPose(s);
        drawDiceAt(ctx, img, pose.px, pose.py, s.sc, pose.rot, 1, 1);
      });

      const doneByPhysics = allStopped(states);
      if (elapsed < dur && !doneByPhysics) raf = requestAnimationFrame(frame);
      else finish();
    }

    raf = requestAnimationFrame(frame);
    return {
      cancel() {
        finished = true;
        if (raf) cancelAnimationFrame(raf);
      },
    };
  }

  function diceSrc(n, flat) {
    const pad = String(Math.max(1, Math.min(6, n))).padStart(2, '0');
    return ASSETS + (flat ? 'icon-' : 'dice-') + pad + '.png?v=' + VER;
  }

  function diceHtml(n, cls) {
    const c = cls ? ' ' + cls : '';
    const flat = cls && (cls.includes('xs') || cls.includes('tbl'));
    return '<span class="k3-dice' + c + '" data-n="' + n + '"><img class="k3-dice__img" src="' +
      diceSrc(n, flat) + '" alt="' + n + '" loading="lazy" draggable="false"></span>';
  }

  function cardHead(issue) {
    const no = 'No.' + String(issue).slice(-6);
    return '<header class="k3-rc-head"><span class="k3-rc-title">1分快三</span><span class="k3-rc-issue">' + no + '</span></header>';
  }

  function cardFoot(meta, shape, hidden) {
    const gy = String(meta && meta.text ? meta.text : '—').replace(/\s+/g, ' ').trim();
    const sh = shape || '—';
    return '<footer class="k3-rc-foot k3-rc-foot--dice"' + (hidden ? ' hidden' : '') + '>' +
      '<div class="k3-rc-pill"><span class="k">和值</span><span class="v k3-result-card__sum">' + gy + '</span></div>' +
      '<div class="k3-rc-pill"><span class="k">形态</span><span class="v k3-result-card__shape">' + sh + '</span></div>' +
      '</footer>';
  }

  function build(nums, issue, meta, shape) {
    return '<div class="k3-result-card is-settled is-reveal" data-issue="' + issue + '" data-faces="' + nums.join(',') + '">' +
      cardHead(issue) +
      '<div class="k3-rc-stage"><canvas class="k3-rc-canvas" width="' + W + '" height="' + H + '" data-nums="' + nums.join(',') + '"></canvas></div>' +
      cardFoot(meta, shape, false) +
      '</div>';
  }

  function buildRolling(issue) {
    return '<div class="k3-result-card is-rolling" data-issue="' + issue + '">' +
      cardHead(issue) +
      '<div class="k3-rc-stage"><canvas class="k3-rc-canvas" width="' + W + '" height="' + H + '"></canvas></div>' +
      cardFoot({ text: '—' }, '—', true) +
      '</div>';
  }

  function getCanvas(card) {
    return card && card.querySelector('.k3-rc-canvas');
  }

  function cancelRoll(card) {
    if (!card) return;
    if (card._rollCtrl) { card._rollCtrl.cancel(); card._rollCtrl = null; }
    if (card._rollTimer) { clearTimeout(card._rollTimer); card._rollTimer = null; }
    card._rollDone = null;
  }

  function pulseImpact(card) {
    const stage = card && card.querySelector('.k3-rc-stage');
    if (!stage) return;
    stage.classList.remove('is-impact');
    void stage.offsetWidth;
    stage.classList.add('is-impact');
    if (card._impactTimer) clearTimeout(card._impactTimer);
    card._impactTimer = setTimeout(() => stage.classList.remove('is-impact'), 180);
  }

  function updateFoot(card, meta, shape) {
    const sumEl = card.querySelector('.k3-result-card__sum');
    const shapeEl = card.querySelector('.k3-result-card__shape');
    const foot = card.querySelector('.k3-rc-foot');
    if (sumEl) sumEl.textContent = meta.text.replace(/\s+/g, ' ');
    if (shapeEl) shapeEl.textContent = shape;
    if (foot) foot.hidden = false;
  }

  function settle(card, nums, issue, meta, shape, skipCompose) {
    if (!card) return;
    cancelRoll(card);
    clearStageImpact(card);
    card.classList.remove('is-rolling');
    card.classList.add('is-settled');
    card.dataset.laid = '1';
    card.dataset.faces = nums.join(',');
    if (issue) card.dataset.issue = issue;
    updateFoot(card, meta, shape);
    const canvas = getCanvas(card);
    if (canvas) {
      canvas.dataset.nums = nums.join(',');
      if (!skipCompose) {
        const layout = parseRollLayout(canvas.dataset.rollLayout);
        composeStage(canvas, nums, layout).catch(() => {});
      }
    }
  }

  function startRoll(card, finalNums, issue, meta, shape, durationMs, onDone) {
    if (!card) return;
    cancelRoll(card);
    card.classList.add('is-rolling');
    card.classList.remove('is-settled', 'is-reveal');
    card.dataset.laid = '';
    const foot = card.querySelector('.k3-rc-foot');
    if (foot) foot.hidden = true;

    const canvas = getCanvas(card);
    if (!canvas) return;

    let finished = false;
    function done() {
      if (finished) return;
      finished = true;
      settle(card, finalNums, issue, meta, shape, true);
      if (typeof onDone === 'function') onDone();
    }
    card._rollDone = done;

    animateRoll(canvas, finalNums, durationMs || 4000, () => pulseImpact(card), done)
      .then(ctrl => { card._rollCtrl = ctrl; })
      .catch(err => {
        console.warn('[K3ResultCard] roll failed', err);
        done();
      });

    card._rollTimer = setTimeout(done, (durationMs || 4000) + 220);
  }

  function initSettled(card) {
    if (!card || card.dataset.laid === '1') return;
    const raw = card.dataset.faces || (getCanvas(card) && getCanvas(card).dataset.nums);
    const nums = raw
      ? raw.split(',').map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 6)
      : [];
    if (nums.length < 3) return;
    const canvas = getCanvas(card);
    const layout = parseRollLayout(canvas && canvas.dataset.rollLayout);
    composeStage(canvas, nums.slice(0, 3), layout)
      .then(() => { card.dataset.laid = '1'; })
      .catch(() => {});
  }

  function bindStage(card, finalNums, issue, meta, shape, durationMs) {
    startRoll(card, finalNums, issue, meta, shape, durationMs);
  }

  [1, 2, 3, 4, 5, 6].forEach(n => { loadDiceImg(n).catch(() => {}); });
  loadImg(ASSETS + 'bg.png?v=' + VER).catch(() => {});

  global.K3ResultCard = {
    build, buildRolling, bindStage, startRoll, settle, initSettled,
    diceHtml, diceSrc, cancelRoll,
  };
})(typeof window !== 'undefined' ? window : this);
