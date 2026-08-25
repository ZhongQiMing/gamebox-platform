/**
 * 牌桌服务端时间基准测试。
 *
 * 跑法：node games-assets/_table-common/__tests__/server-clock.test.mjs
 *
 * 这层是四个牌桌的时序地基：局号 → 开局绝对时刻 → 校时 → 当前相位。
 * 它一旦算偏，开奖流程就会跟服务端错位（历史上出现过「开始下注」弹出 199ms
 * 就被「停止下注」顶掉）。所以这里逐局与服务端公式比对，不允许有误差。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync('games-assets/_table-common/table-shell.js', 'utf8');

/** 可控时钟：让被测代码里的 Date.now 听测试的 */
let fakeNow = Date.now();
const FakeDate = { now: () => fakeNow, parse: Date.parse, UTC: Date.UTC };
const sandbox = {
  document: { addEventListener() {} },
  setTimeout, clearTimeout, setInterval, Image: function () {},
  Date: FakeDate, Number, Math, String, Array, Object, JSON, Promise, console,
};
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const TS = sandbox.TableShell;

let pass = 0;
let fail = 0;
function check(name, got, want, tol = 0) {
  const ok = typeof want === 'number' && typeof got === 'number'
    ? Math.abs(got - want) <= tol
    : got === want;
  if (ok) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}: 实际 ${got}，期望 ${want}${tol ? ` (±${tol})` : ''}`);
  }
}

/* 炸金花：下注 45s + 开奖 13s + 结算 4s */
const timing = { bettingMs: 45000, drawMs: 13000, settleMs: 4000 };
const CYCLE = 62000;

/** 服务端算局号的原样公式，见 packages/shared/src/table-round.ts */
function serverRoundNo(atMs) {
  const cycleStart = Math.floor(atMs / CYCLE) * CYCLE;
  const day = new Date(cycleStart).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const dayStart = Date.parse(`${day}T00:00:00+08:00`);
  const seq = Math.floor((cycleStart - dayStart) / CYCLE) + 1;
  return { roundNo: `ZJH${day.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`, cycleStart };
}

console.log('整局时长');
check('45+13+4=62s', TS.cycleMsOf(timing), CYCLE);

console.log('\n从局号还原开局时刻：与服务端公式逐局比对');
const base = Date.parse('2026-08-19T00:00:00+08:00');
let mismatch = 0;
for (let i = 0; i < 1400; i++) {
  const { roundNo, cycleStart } = serverRoundNo(base + i * CYCLE + 3000);
  if (TS.roundStartAtOf(roundNo, CYCLE) !== cycleStart) mismatch += 1;
}
check('全天 1400 局零误差', mismatch, 0);

mismatch = 0;
for (let i = -20; i < 20; i++) {
  const { roundNo, cycleStart } = serverRoundNo(base + i * CYCLE);
  if (TS.roundStartAtOf(roundNo, CYCLE) !== cycleStart) mismatch += 1;
}
check('跨零点前后 40 局零误差', mismatch, 0);
check('局号非法返回 null', TS.roundStartAtOf('garbage', CYCLE), null);

console.log('\n校时：本地钟偏快 8 秒');
const SKEW = 8000;
const realServerNow = base + 100 * CYCLE + 20000;
const { roundNo: rn } = serverRoundNo(realServerNow);
const startAt = TS.roundStartAtOf(rn, CYCLE);
const tInReal = realServerNow - startAt;
const secondsLeft = Math.ceil((timing.bettingMs - tInReal) / 1000);

const clock = TS.createServerClock();
clock.timing = timing;
fakeNow = realServerNow + SKEW;
TS.syncClock(clock, { roundNo: rn, phase: 'BETTING', secondsLeft }, fakeNow - 60, fakeNow);
check('时差估到 -8000ms', Math.round(clock.offsetMs), -SKEW, 600);
check('校准后服务端时间', Math.round(TS.serverNow(clock)), realServerNow, 600);

console.log('\n推导当前局与相位');
const pos = TS.roundPositionOf(clock);
check('开局时刻与服务端一致', pos.startAt, startAt);
check('本局已走毫秒', Math.round(pos.tIn), tInReal, 600);
check('相位 BETTING', pos.phase, 'BETTING');
check('下注剩余毫秒', Math.round(pos.betLeftMs), timing.bettingMs - tInReal, 600);

console.log('\n时间推进，相位跟着走');
fakeNow = startAt + SKEW + 50000;
const p2 = TS.roundPositionOf(clock);
check('第 50s 是 DRAWING', p2.phase, 'DRAWING');
check('开奖已进行 5000ms', Math.round(p2.drawElapsedMs), 5000, 600);

fakeNow = startAt + SKEW + 60000;
check('第 60s 是 SETTLED', TS.roundPositionOf(clock).phase, 'SETTLED');

fakeNow = startAt + SKEW + CYCLE + 100;
const p4 = TS.roundPositionOf(clock);
check('跨到下一局', p4.startAt, startAt + CYCLE);
check('新局回到 BETTING', p4.phase, 'BETTING');

console.log('\n极端时差：本地钟慢 5 分钟');
const c2 = TS.createServerClock();
c2.timing = timing;
fakeNow = realServerNow - 300000;
TS.syncClock(c2, { roundNo: rn, phase: 'BETTING', secondsLeft }, fakeNow - 60, fakeNow);
check('时差估到 +300000ms', Math.round(c2.offsetMs), 300000, 600);
check('校准后服务端时间', Math.round(TS.serverNow(c2)), realServerNow, 600);

console.log('\n慢往返样本不该拽走基准');
fakeNow = realServerNow + SKEW;
const before = clock.offsetMs;
TS.syncClock(clock, { roundNo: rn, phase: 'BETTING', secondsLeft }, fakeNow - 3000, fakeNow);
check('只被轻微修正', Math.abs(clock.offsetMs - before) < 400, true);

console.log('\n迟到快照不能让相位倒退');
const c3 = TS.createServerClock();
TS.applyServerSnap(c3, { phase: 'SETTLED', secondsLeft: 1, roundNo: 'ZJH20260819-0107' });
TS.applyServerSnap(c3, { phase: 'BETTING', secondsLeft: 45, roundNo: 'ZJH20260819-0108' });
TS.applyServerSnap(c3, { phase: 'SETTLED', secondsLeft: 0, roundNo: 'ZJH20260819-0107' });
check('停在新局 BETTING', `${c3.phase}/${c3.roundNo}`, 'BETTING/ZJH20260819-0108');
TS.applyServerSnap(c3, { phase: 'PAUSED', secondsLeft: 0, roundNo: 'ZJH20260819-0108' });
check('维护暂停要认', c3.phase, 'PAUSED');

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
