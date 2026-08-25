/**
 * 彩票校准时钟自测。
 * 运行：node games-assets/_lottery-common/__tests__/server-clock.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../server-clock.js'), 'utf8');

/** 在受控的假时钟下载入模块 */
function load(startLocalMs) {
  let localNow = startLocalMs;
  const sandbox = {
    window: {},
    Date: { now: () => localNow },
    Math,
    isFinite,
    Number,
  };
  sandbox.window.Date = sandbox.Date;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return {
    clock: sandbox.window.LotteryClock,
    setLocal: (v) => { localNow = v; },
    getLocal: () => localNow,
  };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('  ✓', name);
}

console.log('彩票校准时钟');

test('设备快 30 秒时能估出约 -30000ms 的偏移', () => {
  const { clock } = load(1_000_030_000);           // 本地钟比服务端快 30s
  clock.sync(1_000_000_000 + 10, 1_000_030_000, 1_000_030_020); // 服务端真实时刻
  assert.equal(clock.isSynced(), true);
  assert.ok(Math.abs(clock.getOffsetMs() - -30000) < 5,
    `偏移应约 -30000，实际 ${clock.getOffsetMs()}`);
});

test('校准后 now() 回到服务端时间轴', () => {
  const { clock } = load(1_000_030_000);
  clock.sync(1_000_000_000, 1_000_030_000, 1_000_030_000);
  assert.ok(Math.abs(clock.now() - 1_000_000_000) < 5);
});

test('未校准时退化为本地时间，不会卡死', () => {
  const { clock } = load(555_000);
  assert.equal(clock.isSynced(), false);
  assert.equal(clock.now(), 555_000);
});

test('优先采信往返更快的样本', () => {
  const { clock } = load(0);
  /* 先来一个慢样本：RTT 400ms，服务端时刻被人为设偏 */
  clock.sync(1000 + 200, 0, 400);
  const slow = clock.getOffsetMs();
  /* 再来一个快样本：RTT 10ms，更可信 */
  clock.sync(1000, 0, 10);
  const fast = clock.getOffsetMs();
  assert.ok(Math.abs(fast - 995) < 2, `快样本应主导，实际 ${fast}`);
  assert.notEqual(slow, fast);
});

test('慢样本只做小幅平滑，不会把基准拽走', () => {
  const { clock } = load(0);
  clock.sync(1000, 0, 10);          // 建立基准，偏移约 995
  const base = clock.getOffsetMs();
  clock.sync(1400, 0, 800);         // 慢样本，偏移约 1000
  const after = clock.getOffsetMs();
  assert.ok(Math.abs(after - base) < 2, `平滑幅度应很小，实际移动 ${after - base}`);
});

test('设备时钟被人为大幅改动时立刻跟上', () => {
  const { clock, setLocal } = load(0);
  clock.sync(1000, 0, 10);
  setLocal(60_000);                                  // 玩家把表往前拨了 60 秒
  clock.sync(2000, 60_000, 60_010);
  assert.ok(Math.abs(clock.getOffsetMs() - -58005) < 5,
    `应立刻跟上，实际 ${clock.getOffsetMs()}`);
});

test('封盘提前量：倒计时归零早于服务端封盘线', () => {
  const { clock } = load(0);
  clock.sync(0, 0, 0);                               // 零偏移
  const lockAt = 10_000;
  assert.equal(clock.cutoffAt(lockAt), 10_000 - clock.BET_CUTOFF_MS);
  assert.equal(clock.remainMs(lockAt), 10_000 - clock.BET_CUTOFF_MS);
  assert.equal(clock.canBet(lockAt), true);
});

test('进入提前量窗口后立即停止接单', () => {
  const { clock, setLocal } = load(0);
  clock.sync(0, 0, 0);
  const lockAt = 10_000;
  setLocal(10_000 - clock.BET_CUTOFF_MS - 1);
  assert.equal(clock.canBet(lockAt), true, '提前量之前仍可下注');
  setLocal(10_000 - clock.BET_CUTOFF_MS);
  assert.equal(clock.canBet(lockAt), false, '到提前量即停止接单');
  assert.equal(clock.remainMs(lockAt), 0);
  setLocal(10_000);
  assert.equal(clock.canBet(lockAt), false, '服务端封盘线之后当然不可下注');
});

test('设备慢 30 秒也不会让玩家在封盘后还能下注', () => {
  const { clock, setLocal } = load(0);
  /* 本地 0 时服务端已是 30000：设备慢 30 秒 */
  clock.sync(30_000, 0, 0);
  const lockAt = 35_000;                             // 服务端 5 秒后封盘
  assert.equal(clock.canBet(lockAt), true);
  setLocal(4_500);                                   // 本地过去 4.5 秒 -> 服务端 34500
  assert.equal(clock.canBet(lockAt), false, '已进入提前量窗口，应停止接单');
  /* 若不校准，本地 4500 远小于 lockAt 35000，会误判为还能下注 */
  assert.ok(4_500 < lockAt, '对照：未校准时会误判');
});

test('toLocal 把服务端时刻换算回本地钟供 setTimeout 用', () => {
  const { clock } = load(1_000_030_000);
  clock.sync(1_000_000_000, 1_000_030_000, 1_000_030_000);   // 设备快 30 秒
  const serverTarget = 1_000_005_000;                         // 服务端 5 秒后
  const local = clock.toLocal(serverTarget);
  assert.ok(Math.abs(local - 1_000_035_000) < 5,
    `本地应在 1_000_035_000 附近，实际 ${local}`);
  assert.ok(Math.abs((local - clock.state.offsetMs * 0) - 1_000_035_000) < 5);
});

test('异常入参不污染已有基准', () => {
  const { clock } = load(0);
  clock.sync(1000, 0, 10);
  const base = clock.getOffsetMs();
  clock.sync(undefined, 0, 10);
  clock.sync(NaN, 0, 10);
  clock.sync(1000, 100, 50);      // recvAt 早于 sentAt
  clock.sync(-1, 0, 10);
  assert.equal(clock.getOffsetMs(), base, '非法样本应被忽略');
});

console.log(`\n全部 ${passed} 项通过`);
