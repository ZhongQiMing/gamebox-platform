/**
 * 用可控时钟把某个牌桌跑满几局，逐帧核对流程落点。
 *
 * 验证：换局、横幅、发牌翻牌、报牌、派奖全部锚在服务端时间轴上；
 * 并注入断网、掉帧、维护窗三种异常，确认流程不会错乱、不会漂移。
 *
 * 跑法：
 *   node games-assets/_table-common/__tests__/table-round-flow.test.mjs [游戏]
 * 游戏取值：zhajinhua（默认）| douniu | baccarat | longhu
 *
 * 每个牌桌的整局时长不同，必须按各自的 timing 跑，不能套用同一份。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** 与服务端 packages/shared/src/table-timing.ts 同源 */
const GAMES = {
  zhajinhua: { file: 'games-assets/zhajinhua/index.html', prefix: 'ZJH', draw: 13000 },
  douniu: { file: 'games-assets/douniu/index.html', prefix: 'DN', draw: 17000 },
  baccarat: { file: 'games-assets/baccarat/index.html', prefix: 'BJL', draw: 12000, js: 'games-assets/baccarat/js/bjl-table.js' },
  longhu: { file: 'games-assets/longhu/index.html', prefix: 'LHD', draw: 9000, js: 'games-assets/longhu/js/lhd-table.js' },
};
const GAME = process.argv[2] || 'zhajinhua';
const CFG = GAMES[GAME];
if (!CFG) {
  console.log(`未知游戏 ${GAME}，可选：${Object.keys(GAMES).join(' / ')}`);
  process.exit(1);
}

const BETTING = 45000, DRAW = CFG.draw, SETTLE = 4000;
const CYCLE = BETTING + DRAW + SETTLE;
const timing = { bettingMs: BETTING, drawMs: DRAW, settleMs: SETTLE };
console.log(`被测游戏：${GAME}　整局 ${CYCLE / 1000}s（下注 ${BETTING / 1000} + 开奖 ${DRAW / 1000} + 派奖 ${SETTLE / 1000}）\n`);

let NOW = 0;
const events = [];
const log = (kind, detail) => events.push({ t: NOW, kind, detail });

function makeEl(tag = 'div', id = '') {
  const el = {
    tagName: tag, id, hidden: false, className: '', textContent: '', innerHTML: '',
    src: '', alt: '', dataset: {}, children: [],
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => el.classList._s.add(x)); },
      remove(...c) { c.forEach((x) => el.classList._s.delete(x)); },
      contains: (c) => el.classList._s.has(c),
      toggle() {},
    },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(c) { el.children.push(c); return c; },
    removeChild() {}, remove() {}, closest: () => null,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => makeEl(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
    focus() {}, blur() {}, insertBefore() {}, cloneNode: () => makeEl(),
    get offsetWidth() { return 100; },
    /* 顶栏积分自适应要量宽度 */
    get clientWidth() { return 360; },
    get scrollWidth() { return 240; },
    play: () => Promise.resolve(), pause() {}, decode: () => Promise.resolve(),
  };
  return el;
}

const els = new Map();
function el(id) {
  if (!els.has(id)) els.set(id, makeEl('div', id));
  return els.get(id);
}

/* 定时器队列：由模拟时钟推进 */
let timerSeq = 0;
const timers = new Map();

const sandbox = {
  console: { log() {}, warn() {}, error(...a) { log('ERROR', a.map(String).join(' ')); } },
  Date: { now: () => NOW, parse: Date.parse, UTC: Date.UTC },
  Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, isNaN, parseInt, parseFloat,
  setTimeout(fn, ms) { const id = ++timerSeq; timers.set(id, { at: NOW + (ms || 0), fn, every: 0 }); return id; },
  clearTimeout(id) { timers.delete(id); },
  setInterval(fn, ms) { const id = ++timerSeq; timers.set(id, { at: NOW + (ms || 0), fn, every: ms || 1 }); return id; },
  clearInterval(id) { timers.delete(id); },
  requestAnimationFrame(fn) { const id = ++timerSeq; timers.set(id, { at: NOW + 16, fn, every: 0 }); return id; },
  Image: function () { return makeEl('img'); },
  Audio: function (src) { const a = makeEl('audio'); a.src = src || ''; return a; },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { search: '', origin: 'http://x', href: 'http://x' },
  URLSearchParams: function () { return { get: () => null }; },
  /* 顶栏积分自适应会读内边距与列间距 */
  getComputedStyle: () => ({
    paddingLeft: '12px', paddingRight: '12px', columnGap: '10px', gap: '10px',
    font: '13px monospace', fontSize: '13px', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums',
  }),
};
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.self = sandbox;
sandbox.addEventListener = () => {};
sandbox.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: (id) => el(id),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  createElement: (t) => makeEl(t),
  body: makeEl(), documentElement: makeEl(),
  hidden: false,
};

/* 记录横幅与音频 */
const bannerStart = el('phaseBannerStart');
const bannerStop = el('phaseBannerStop');
const bannerBox = el('phaseBanner');
sandbox.Audio = function (src) {
  const a = makeEl('audio');
  a.src = src || '';
  a.play = () => {
    const name = String(src || '').split('/').slice(-2).join('/').split('?')[0];
    if (name && !/bgm/.test(name)) log('AUDIO', name);
    return Promise.resolve();
  };
  return a;
};

/* 服务端：按时间基准回答快照 */
let dropSnapshots = false;
let maintenance = false;
function serverSnapshot() {
  const startAt = Math.floor(NOW / CYCLE) * CYCLE;
  const tIn = NOW - startAt;
  const day = new Date(startAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const dayStart = Date.parse(`${day}T00:00:00+08:00`);
  const seq = Math.floor((startAt - dayStart) / CYCLE) + 1;
  const roundNo = `${CFG.prefix}${day.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;
  let phase, secondsLeft;
  if (tIn < BETTING) { phase = 'BETTING'; secondsLeft = Math.ceil((BETTING - tIn) / 1000); }
  else if (tIn < BETTING + DRAW) { phase = 'DRAWING'; secondsLeft = Math.ceil((BETTING + DRAW - tIn) / 1000); }
  else { phase = 'SETTLED'; secondsLeft = Math.ceil((CYCLE - tIn) / 1000); }
  if (maintenance) {
    return { roundNo, phase: 'PAUSED', secondsLeft: 0, timing, betSummary: {}, history: [] };
  }
  const snap = { roundNo, phase, secondsLeft, timing, betSummary: {}, history: [] };
  if (phase !== 'BETTING') snap.outcome = outcomeOf(GAME);
  return snap;
}

/** 各游戏牌型不同，开奖结果得按各自的形状造 */
function outcomeOf(game) {
  const C = (suit, rank) => ({ suit, rank });
  if (game === 'douniu') {
    return {
      game: 'douniu',
      banker: [C('heart', 'K'), C('club', '7'), C('spade', '3'), C('diamond', '5'), C('heart', '5')],
      player: [C('diamond', 'Q'), C('heart', '9'), C('club', '2'), C('spade', '8'), C('club', '4')],
      result: 'banker',
    };
  }
  if (game === 'baccarat') {
    return {
      game: 'baccarat',
      banker: [C('heart', 'K'), C('club', '7')],
      player: [C('diamond', 'Q'), C('heart', '9')],
      bankerPoint: 7, playerPoint: 9,
      bankerDrew: false, playerDrew: false,
      result: 'player',
    };
  }
  if (game === 'longhu') {
    return {
      game: 'dragon-tiger',
      dragon: C('heart', 'K'), tiger: C('club', '7'),
      dragonRank: 13, tigerRank: 7,
      result: 'dragon',
    };
  }
  return {
    game: 'zhajinhua',
    banker: [C('heart', 'K'), C('club', '7'), C('spade', '3')],
    player: [C('diamond', 'Q'), C('heart', '9'), C('club', '2')],
    result: 'banker',
  };
}

sandbox.App = {
  parentOrigin: 'http://x',
  getUser: () => ({ uid: '100000001' }),
  getBalance: () => 10000,
  calcRebate: () => 0,
  refreshBalance: () => Promise.resolve(),
  toast(msg) { log('TOAST', msg); },
  go() {},
  fetchTableSnapshot: () => (dropSnapshots ? Promise.reject(new Error('网络中断')) : Promise.resolve(serverSnapshot())),
  fetchMyTableBets: () => Promise.resolve({ totalPayout: 0, totalStake: 0 }),
  waitTableOutcome: () => {
    const s = serverSnapshot();
    return s.outcome ? Promise.resolve(s) : Promise.reject(new Error('未开奖'));
  },
  placeTableBet: () => Promise.resolve({}),
  fetchTablePayTable: () => Promise.resolve(null),
  fetchTableVerify: () => Promise.resolve(null),
};

vm.createContext(sandbox);
for (const dep of [
  'games-assets/_table-common/table-shell.js',
  'games-assets/_lottery-common/app-audio-level.js',
  'games-assets/_table-common/table-audio.js',
]) vm.runInContext(readFileSync(dep, 'utf8'), sandbox, { filename: dep });

/* 从某一局的第 3 秒开始，模拟「中途进房」 */
const base = Date.parse('2026-08-19T04:00:00+08:00');
const startCycle = Math.floor(base / CYCLE) * CYCLE;
NOW = startCycle + 3000;

/* 炸金花/斗牛的逻辑是内联在 HTML 里的；龙虎/百家乐在独立 js */
if (CFG.js) {
  vm.runInContext(readFileSync(CFG.js, 'utf8'), sandbox, { filename: CFG.js });
} else {
  const html = readFileSync(CFG.file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  vm.runInContext(scripts[scripts.length - 1][1], sandbox, { filename: GAME });
}

/* 推进模拟时钟 */
let bannerLast = '';
function step(ms) {
  const target = NOW + ms;
  while (NOW < target) {
    let next = target;
    for (const t of timers.values()) if (t.at < next) next = t.at;
    NOW = next;
    for (const [id, t] of [...timers]) {
      if (t.at > NOW) continue;
      if (t.every) t.at = NOW + t.every; else timers.delete(id);
      try { t.fn(); } catch (e) { log('ERROR', 'timer: ' + e.message); }
    }
    // 记录横幅变化
    const shown = bannerBox.classList.contains('is-show');
    const which = !bannerStart.hidden ? 'start' : (!bannerStop.hidden ? 'stop' : 'none');
    const key = `${shown}|${which}`;
    if (key !== bannerLast) { bannerLast = key; if (shown) log('BANNER', which); }
    if (NOW >= target) break;
  }
  NOW = target;
}

/* 让 Promise микро任务有机会跑 */
async function run(ms, chunk = 100) {
  for (let i = 0; i < ms / chunk; i++) { step(chunk); await Promise.resolve(); await new Promise((r) => setImmediate(r)); }
}

console.log('模拟起点：本局第 3 秒（中途进房）');
/* 第一局正常跑完 */
await run(CYCLE);

/* 第二局：下注中途断网 8 秒，覆盖封盘时刻 */
console.log('第二局：第 40 秒起断网 8 秒（跨过封盘时刻）');
await run(40000);
dropSnapshots = true;
await run(8000);
dropSnapshots = false;
await run(CYCLE - 48000);

/* 第三局：模拟卡顿——一次性跳过 6 秒不给任何帧 */
console.log('第三局：开奖中卡顿 6 秒（整段掉帧）');
await run(47000);
step(6000);
await run(CYCLE - 53000 + 5000);

/* 维护窗：服务端进入 PAUSED，客户端不该继续空转开奖 */
console.log('维护窗：服务端 PAUSED 两整局');
const beforeMaint = events.length;
maintenance = true;
await run(CYCLE * 2);
const duringMaint = events.slice(beforeMaint).filter((e) => e.kind === 'BANNER'
  || (e.kind === 'AUDIO' && /send-card|open-card|\/deal|\/open|voice\//.test(e.detail)));
maintenance = false;
console.log('维护结束，恢复开局');
await run(CYCLE + 5000);

/* ── 核对 ── */
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { if (ok) { pass++; console.log(`  ok  ${n}`); } else { fail++; console.log(`  FAIL ${n} ${extra}`); } };

const rel = (t) => t - startCycle;
const banners = events.filter((e) => e.kind === 'BANNER');
const errors = events.filter((e) => e.kind === 'ERROR');

console.log('\n运行期错误');
check('无脚本错误', errors.length === 0, errors.map((e) => e.detail).join(' | '));

console.log('\n横幅出现的时刻（相对本局起点）');
for (const b of banners) console.log(`    ${String(rel(b.t)).padStart(7)}ms  ${b.detail}`);

const stops = banners.filter((b) => b.detail === 'stop').map((b) => rel(b.t));
const starts = banners.filter((b) => b.detail === 'start').map((b) => rel(b.t));

/* 每一局都应有且仅有一次停止下注、一次开始下注，且落在固定相位上 */
const near = (v, target, tol) => Math.abs(v - target) <= tol;
let phaseErr = 0;
for (const s of stops) if (!near(((s % CYCLE) + CYCLE) % CYCLE, BETTING, 1200)) phaseErr += 1;
for (const s of starts) if (Math.min(((s % CYCLE) + CYCLE) % CYCLE, CYCLE - (((s % CYCLE) + CYCLE) % CYCLE)) > 1600) phaseErr += 1;
check('每次停止下注都落在第 45 秒相位', phaseErr === 0, `stop=${stops} start=${starts}`);

check('三局都有停止下注', stops.length >= 3, `实际 ${stops.length} 次`);
check('两次换局都有开始下注', starts.length >= 2, `实际 ${starts.length} 次`);
check('开始下注不会紧跟停止下注', !stops.some((s) => starts.some((st) => Math.abs(st - s) < 3000)), `start=${starts} stop=${stops}`);

/*
 * 相邻同类横幅之间必须是整局的整数倍。
 * 一般就是 1 倍；维护窗那几局服务端不开，跳过去是对的，所以允许整数倍。
 */
let gapErr = 0;
const multipleOfCycle = (gap, tol) => {
  const n = Math.round(gap / CYCLE);
  return n >= 1 && Math.abs(gap - n * CYCLE) <= tol;
};
for (let i = 1; i < stops.length; i++) if (!multipleOfCycle(stops[i] - stops[i - 1], 1200)) gapErr += 1;
for (let i = 1; i < starts.length; i++) if (!multipleOfCycle(starts[i] - starts[i - 1], 1600)) gapErr += 1;
check('横幅间隔恒为整局的整数倍（不漂移）', gapErr === 0, `stop=${stops} start=${starts}`);

/* 各游戏的发牌/翻牌音效命名不同：炸金花斗牛用 send-card/open-card，龙虎百家乐用 deal/open */
const DEAL_SFX = /(send-card|\/deal)/;
const FLIP_SFX = /(open-card|\/open)/;
const audio = events.filter((e) => e.kind === 'AUDIO');
const firstDeal = audio.find((a) => DEAL_SFX.test(a.detail));
const firstFlip = audio.find((a) => FLIP_SFX.test(a.detail));
console.log('\n关键音频落点');
if (firstDeal) console.log(`    首张发牌 ${rel(firstDeal.t)}ms`);
if (firstFlip) console.log(`    首张翻牌 ${rel(firstFlip.t)}ms`);
check('发牌在停止下注之后约 1.5 秒', firstDeal && Math.abs(rel(firstDeal.t) - (BETTING + 1500)) < 900,
  firstDeal ? `实际 ${rel(firstDeal.t)}ms` : '没发牌');
check('翻牌在发牌之后', firstFlip && firstDeal && firstFlip.t > firstDeal.t);

console.log('\n维护窗');
check('维护期间不再空转开奖（无横幅/发牌/报牌）', duringMaint.length === 0,
  duringMaint.map((e) => `${rel(e.t)}ms ${e.kind} ${e.detail || ''}`).join(' | '));
const afterMaint = banners.filter((b) => b.t > events[events.length - 1].t - CYCLE * 1.5);
check('维护结束后恢复开局', afterMaint.length > 0, '维护后没有任何横幅');

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
