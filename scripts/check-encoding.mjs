/**
 * 编码体检。
 *
 * 编码问题的共同点：本机看着好好的，换台机器直接跑不起来，而且扫 diff 发现不了
 * （满屏中文，看不出哪个字节坏了）。所以必须机器拦。下面三类都真实踩过：
 *
 * 1. games-assets 的 html 被编辑器按 GBK 读进去再存回 UTF-8，中文整片变样，
 *    解码不出来的字节还会变成空洞 —— 斗牛、炸金花当场白屏。
 * 2. 带中文的 .ps1 不写 UTF-8 BOM，Windows PowerShell 5.1 会按 GBK 读，
 *    中文的尾字节撞上引号或反引号，整个脚本解析失败、一行都跑不了。
 * 3. .sh 在 Windows 上存成 CRLF，scp 到服务器 bash 报 $'\r': command not found，
 *    错误信息完全指不到真正的原因。
 *
 * 用法：node scripts/check-encoding.mjs（等价于 pnpm check:encoding）
 * 退出码非 0 表示有问题。
 *
 * 本文件不出现任何乱码字面量：判定靠反向编码，不靠特征字表。
 * 特征字表本身就是一串生僻字，在复制粘贴、另存为的过程中很容易再被转坏，
 * 而坏掉之后检查会静默失效 —— 一个查编码的工具不能有这种软肋。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const problems = [];
const tmpDir = mkdtempSync(join(tmpdir(), 'enc-check-'));

// ── 乱码判定 ────────────────────────────────────────────────
/*
 * 事故的成因是「UTF-8 的字节被当成 GBK 来解释」。要判断一段文字是不是这么来的，
 * 就把它原路编回 GBK 字节，再按 UTF-8 解一次：解得通、而且解出来是像样的中文，
 * 那它必然是这么坏掉的 —— 正常中文编成 GBK 字节几乎不可能恰好是合法 UTF-8。
 *
 * Node 只有 GBK 解码器没有编码器，所以先穷举全部双字节组合建一张反查表。
 */
const gbk = new TextDecoder('gbk');
const toGbk = new Map();
{
  // 0x80 是单字节码位，先占住，否则会被后面某个双字节组合抢走、反解出错字节
  toGbk.set(gbk.decode(Buffer.from([0x80])), [0x80]);
  const row = Buffer.alloc(2);
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    row[0] = lead;
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue;
      row[1] = trail;
      const ch = gbk.decode(row);
      if (ch.length === 1 && ch !== '\uFFFD' && !toGbk.has(ch)) toGbk.set(ch, [lead, trail]);
    }
  }
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const cjkCount = (s) => (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
/* 空洞字符是 GBK 解不出来时留下的，它会截断连续片段，所以也当分隔符 */
const NON_ASCII_RUN = /[^\x00-\x7f\uFFFD]+/g;

/** 一段连续非 ASCII 文字若是 GBK 误读的产物，返回它原本的中文；否则返回 null */
function reverseRun(run) {
  const bytes = [];
  for (const ch of run) {
    const pair = toGbk.get(ch);
    if (!pair) return null;
    bytes.push(...pair);
  }
  const buf = Buffer.from(bytes);
  // 片段边界是按 ASCII 切的，可能把一个 UTF-8 字符从中间切断，两头各让最多 2 字节
  for (let head = 0; head <= 2; head++) {
    for (let tail = 0; tail <= 2; tail++) {
      if (head + tail >= buf.length) continue;
      try {
        const out = utf8Strict.decode(buf.subarray(head, buf.length - tail));
        // 反解结果得像人话：一半以上是汉字。碰巧凑出个把汉字的属于噪声
        if (out.length >= 2 && cjkCount(out) >= out.length * 0.5) return out;
      } catch {
        /* 这种切法不通，试下一种 */
      }
    }
  }
  return null;
}

/*
 * 实测标定（52 个真实素材文件，以及用它们模拟出的 52 份乱码）：
 *   干净文件的命中占比最高 0.02，乱码文件最低 0.78。
 * 阈值取 0.4，两边都有很宽的余量。
 */
const MOJIBAKE_RATIO = 0.4;
const MIN_RUNS = 4;

/** 命中返回 { ratio, sample }，sample 是还原出来的原文，便于人工确认不是误报 */
function detectMojibake(text) {
  const runs = (text.match(NON_ASCII_RUN) ?? []).filter((r) => r.length >= 3);
  if (runs.length < MIN_RUNS) return null;
  let good = 0;
  let sample = '';
  for (const r of runs) {
    const out = reverseRun(r);
    if (out) {
      good++;
      if (!sample) sample = out.slice(0, 20);
    }
  }
  const ratio = good / runs.length;
  return ratio >= MOJIBAKE_RATIO ? { ratio, sample } : null;
}

/*
 * 判定器自检。
 *
 * 这个检查静默失效过一次：判定依据在一次转存里被写坏，于是它对着几十个好文件
 * 狂报错、对真乱码却毫无反应，而输出看上去一切正常。查编码的工具自己被编码坑了
 * 是最难发现的，所以每次运行前先拿现造的样本验一遍：用干净中文当场造出乱码，
 * 判定器必须对前者放行、对后者报警，并且能还原出原文。
 */
function selfTest() {
  const clean = '开奖结果|庄家通杀|请等待下一局|余额不足无法下注|本局已封盘';
  const corrupted = gbk.decode(Buffer.from(clean, 'utf8'));
  if (detectMojibake(clean)) {
    throw new Error('判定器自检失败：把正常中文当成了乱码');
  }
  const hit = detectMojibake(corrupted);
  if (!hit) throw new Error('判定器自检失败：认不出乱码样本');
  if (!clean.includes(hit.sample)) {
    throw new Error(`判定器自检失败：还原出的原文不对（得到「${hit.sample}」）`);
  }
}
selfTest();

// ── 文件清单 ────────────────────────────────────────────────
/*
 * 已入库 + 未入库但没被忽略的文件都要查。只查已入库的话，新写的脚本要等提交
 * 之后才会被发现有问题，而那时候你多半已经在别的机器上踩过坑了。
 */
function listFiles(...pathspec) {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', ...pathspec],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
    // 已从磁盘删掉、但还留在 git 索引里的文件（删了还没提交）也会被列出来，读它会抛
    .filter((p) => existsSync(p));
}

function readUtf8(path) {
  const raw = readFileSync(path);
  const hasBom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  try {
    return { hasBom, text: utf8Strict.decode(hasBom ? raw.subarray(3) : raw) };
  } catch {
    problems.push(`${path} 不是合法 UTF-8`);
    return null;
  }
}

// ── 1. games-assets：中文乱码 + 内联脚本语法 ────────────────
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

function checkJsSyntax(code, label) {
  const file = join(tmpDir, 'chunk.js');
  writeFileSync(file, code, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    const msg = String(err.stderr || err.message)
      .split('\n')
      .find((l) => l.includes('Error')) ?? '语法错误';
    problems.push(`${label} 语法错误：${msg.trim()}`);
  } finally {
    unlinkSync(file);
  }
}

for (const path of listFiles('games-assets').filter(
  (p) => p.endsWith('.html') || p.endsWith('.js'),
)) {
  const file = readUtf8(path);
  if (!file) continue;
  const { text } = file;

  const hit = detectMojibake(text);
  if (hit) {
    problems.push(
      `${path} 中文乱码：${(hit.ratio * 100).toFixed(0)}% 的片段能反解回中文` +
        `（例如有一段原本是「${hit.sample}」）`,
    );
  }
  if (text.includes('\uFFFD')) {
    problems.push(`${path} 含替换字符，说明有字节在某次转码中彻底丢了`);
  }

  if (path.endsWith('.js')) {
    checkJsSyntax(text, path);
  } else {
    let m;
    let i = 0;
    INLINE_SCRIPT.lastIndex = 0;
    while ((m = INLINE_SCRIPT.exec(text)) !== null) {
      checkJsSyntax(m[1], `${path} 内联脚本 #${i++}`);
    }
  }
}

// ── 2. PowerShell：含中文就必须带 UTF-8 BOM ─────────────────
// PowerShell 5.1 是 Windows 自带的那个版本，没 BOM 时按系统 ANSI（中文机器上
// 是 GBK）读文件。不含中文的脚本纯 ASCII，怎么读都一样，才可以没有 BOM。
for (const path of listFiles('*.ps1')) {
  const file = readUtf8(path);
  if (!file) continue;
  if (/[\u4e00-\u9fff]/.test(file.text) && !file.hasBom) {
    problems.push(
      `${path} 含中文但缺 UTF-8 BOM，Windows PowerShell 5.1 会按 GBK 读并解析失败`,
    );
  }
}

// ── 3. Shell：不能有 CR ─────────────────────────────────────
// .gitattributes 已强制 eol=lf，这里兜底防止有人绕过（另存为、或者删了配置）
for (const path of listFiles('*.sh')) {
  if (readFileSync(path).includes(0x0d)) {
    problems.push(`${path} 含 CRLF 换行，上服务器执行会报 $'\\r': command not found`);
  }
}

if (problems.length) {
  console.error(`编码体检未通过，共 ${problems.length} 项：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('编码体检通过：H5 素材编码正常、内联脚本可解析，ps1 带 BOM，sh 是 LF。');
