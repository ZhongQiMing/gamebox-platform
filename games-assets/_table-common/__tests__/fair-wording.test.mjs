/**
 * 公平性文案必须与实际提供的能力一致。
 *
 * 背景：种子与指纹是**封盘那一刻**才生成的（候选是互不相关的独立种子，
 * 只公布被采用的那把）。所以我们能证明的是「公布的结果没有被事后改过」——
 * 结果可复算；不能证明「种子不是看完下注才挑的」——预承诺公平。
 *
 * 界面上不能出现「可证明公平」「承诺 Hash」这类说法：宣称做不到的事，
 * 出纠纷时比从不宣称糟得多。这条测试就是钉住这个边界。
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
let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); }
}

const sealed = TS.buildVerifyHtml({
  roundNo: 'BJL-1',
  serverSeedHash: 'abcdef0123456789',
  serverSeed: 'seed-xyz',
  hashMatches: true,
  outcomeMatches: true,
}, 'bjl');

const betting = TS.buildVerifyHtml({ roundNo: 'BJL-2' }, 'bjl');

console.log('公平性文案');
ok(!/可证明公平/.test(sealed), '不出现「可证明公平」（我们没有预承诺）');
ok(!/承诺 Hash/.test(sealed), '不出现「承诺 Hash」（下注前无可承诺之物）');
ok(/开奖可复算/.test(sealed), '出现「开奖可复算」，说清实际提供的是什么');
ok(/结果指纹 Hash/.test(sealed), 'Hash 标签改为「结果指纹」');
ok(/复算出同一副牌与同一结果/.test(sealed), '解释了玩家能自己验什么');
ok(/seed-xyz/.test(sealed), '开奖后公开种子');
ok(!/可证明公平|承诺 Hash/.test(betting), '下注期同样不夸大');
ok(/尚未开奖/.test(betting), '下注期如实说明尚未开奖');

/* nonce 不该出现在对外验算里：它会暴露是否改动过自然结果 */
const withNonce = TS.buildVerifyHtml({
  roundNo: 'BJL-3', serverSeedHash: 'h', serverSeed: 's', nonce: 1,
}, 'bjl');
ok(/Nonce/.test(withNonce) === true, 'nonce 字段仍可渲染（服务端已不下发，此处仅兼容）');

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
