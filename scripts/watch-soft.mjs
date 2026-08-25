/**
 * 盯软控：每隔一段时间拉一次街机资金池与今日大盘，看实际 RTP 是否朝目标收敛。
 *
 *   node scripts/watch-soft.mjs           默认每 20 秒一次，跑 30 分钟
 *   node scripts/watch-soft.mjs 10 60     每 10 秒一次，跑 60 分钟
 *
 * 判据不是「某一局有没有被干预」——单局是随机的，看单局说明不了问题。
 * 要看池子的实际 RTP 随着流水累积，是否向目标 RTP 靠拢。
 */
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3000/api';
const ORIGIN = 'http://127.0.0.1:5173';
const ADMIN = { username: 'admin', password: process.env.ADMIN_PWD || 'Admin@123456' };
const EVERY = (Number(process.argv[2]) || 20) * 1000;
const MINUTES = Number(process.argv[3]) || 30;
const OUT = '_soft-watch.log';

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* */ }
  if (!res.ok) throw new Error(`${res.status} ${j?.message || text.slice(0, 150)}`);
  return j?.data !== undefined ? j.data : j;
}

const admin = await call('POST', '/auth/login', { body: ADMIN });
const t = admin.token;

writeFileSync(OUT, `软控监控 开始于 ${new Date().toLocaleString('zh-CN')}\n`, 'utf8');
const line = (s) => { console.log(s.replace(/[^\x00-\x7F]/g, '.')); appendFileSync(OUT, s + '\n', 'utf8'); };

const first = await call('GET', '/console/global-soft-control', { token: t });
line(`配置: 开启=${first.config.enabled} 街机目标RTP=${first.config.arcadeRtpTarget} 候选数=${first.config.arcadeCandidateTries} 池窗口=${first.config.arcadePoolWindowDays}天 彩票牌桌门槛=${first.config.minFlowToControl}`);
line('');
line('时间     | 大盘流水 大盘派彩 庄家盈亏 注单 | 每个街机池: 流水/派彩/实际RTP(目标)');
line('-'.repeat(110));

const rounds = Math.ceil((MINUTES * 60 * 1000) / EVERY);
for (let i = 0; i < rounds; i += 1) {
  try {
    const d = await call('GET', '/console/global-soft-control', { token: t });
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const pools = (d.arcadePools || [])
      .map((p) => `${p.gameCode}=${p.stake}/${p.payout}/RTP${p.rtp}(目标${p.targetRtp})`)
      .join('  ');
    line(`${ts} | ${String(d.stats.stake).padStart(8)} ${String(d.stats.payout).padStart(8)} ${String(d.stats.house).padStart(8)} ${String(d.stats.betCount).padStart(4)} | ${pools}`);
  } catch (e) {
    line(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} | 取数失败: ${e.message}`);
  }
  if (i < rounds - 1) await new Promise((r) => setTimeout(r, EVERY));
}
line('');
line(`监控结束 ${new Date().toLocaleString('zh-CN')}`);
console.log(`\n完整记录在 ${OUT}`);
