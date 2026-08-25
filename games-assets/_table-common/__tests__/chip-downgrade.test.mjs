/**
 * 筹码自适应降档测试。
 *
 * 跑法：node games-assets/_table-common/__tests__/chip-downgrade.test.mjs
 *
 * 规则：选中面额下不起时，退到「不超过余额的最大一档」，而不是逐档往下挪，
 * 也不能因为赢钱就自动加大注码。这里按真实连点场景逐手推演，防止改动跑偏。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync('games-assets/_table-common/table-shell.js', 'utf8');
const sandbox = {
  document: { addEventListener() {} },
  setTimeout, clearTimeout, setInterval, Image: function () {},
  Date, Number, Math, String, Array, Object, JSON, Promise, console,
};
sandbox.window = sandbox;
sandbox.global = sandbox;
sandbox.addEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const TS = sandbox.TableShell;

let pass = 0;
const fails = [];
function eq(actual, expected, label) {
  if (actual === expected) pass++;
  else fails.push(`${label}：期望 ${expected}，实到 ${actual}`);
}

/* 炸金花/斗牛/百家乐/龙虎共用的两页面额 */
const PAGES = [[1, 5, 10, 50, 100, 500], [1000, 2000, 3000, 4000, 5000, 10000]];

eq(TS.affordableChip(PAGES, 15432), 10000, '余额足够时取最大档');
eq(TS.affordableChip(PAGES, 5432), 5000, '5432 退到 5000');
eq(TS.affordableChip(PAGES, 432), 100, '432 直接退到 100（跳过 500）');
eq(TS.affordableChip(PAGES, 32), 10, '32 退到 10');
eq(TS.affordableChip(PAGES, 2), 1, '2 退到 1');
eq(TS.affordableChip(PAGES, 0), 0, '余额 0 时无可下档位');
eq(TS.affordableChip(PAGES, 0.5), 0, '不足 1 分时无可下档位');

/* 边界：正好等于某一档要能选中该档 */
eq(TS.affordableChip(PAGES, 500), 500, '余额正好等于面额时可选');
eq(TS.affordableChip(PAGES, 10000), 10000, '余额正好等于最大面额时可选');
eq(TS.affordableChip(PAGES, 999), 500, '999 退到 500');

/* 异常输入不能抛错 */
eq(TS.affordableChip(PAGES, NaN), 0, 'NaN 余额返回 0');
eq(TS.affordableChip(PAGES, Infinity), 0, '无穷余额视为不可用');
eq(TS.affordableChip(PAGES, -5), 0, '负余额返回 0');
eq(TS.affordableChip([], 100), 0, '空面额表返回 0');
eq(TS.affordableChip(null, 100), 0, '面额表缺失返回 0');

/* 用户描述的整段连点：15432 起，一路点到下不起 */
const seq = [];
let bal = 15432;
let chip = 10000;
for (let i = 0; i < 40; i++) {
  if (chip > bal) {
    const next = TS.affordableChip(PAGES, bal);
    if (!next) break;
    chip = next;
  }
  bal -= chip;
  seq.push(chip);
}
eq(seq.slice(0, 3).join(','), '10000,5000,100', '前三手依次为 10000 / 5000 / 100');
eq(seq[seq.length - 1], 1, '最后一手落到 1');
eq(bal >= 0, true, '全程余额不会被下成负数');
eq(seq.reduce((a, b) => a + b, 0) <= 15432, true, '累计下注不超过初始余额');

console.log(`筹码降档：${pass} 项通过${fails.length ? `，${fails.length} 项失败` : ''}`);
if (fails.length) {
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
