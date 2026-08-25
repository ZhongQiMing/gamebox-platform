/**
 * 检查 HTML 内联 <script> 的语法，并报告未定义的标识符风险。
 * 用法：node scripts/check-inline-js.mjs <文件...>
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let bad = 0;
for (const file of process.argv.slice(2)) {
  if (file.endsWith('.js')) {
    try {
      new vm.Script(readFileSync(file, 'utf8'), { filename: file });
      console.log(`${file}  语法 OK`);
    } catch (e) {
      bad += 1;
      console.log(`${file}  语法错误: ${e.message}`);
    }
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let i = 0;
  let ok = true;
  while ((m = re.exec(html))) {
    i += 1;
    if (!m[1].trim()) continue;
    const line = html.slice(0, m.index).split('\n').length;
    try {
      new vm.Script(m[1], { filename: `${file}#${i}` });
    } catch (e) {
      ok = false;
      bad += 1;
      console.log(`${file}  内联脚本 #${i} (第 ${line} 行起) 语法错误: ${e.message}`);
    }
  }
  if (ok) console.log(`${file}  内联脚本语法 OK`);
}
process.exit(bad ? 1 : 0);
