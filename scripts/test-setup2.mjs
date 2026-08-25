/**
 * 准备收尾：代理把玩家挂到自己名下，再逐笔上分到 100 万。
 * 全程走后台真实接口（挂靠 + 上下分），账本与线上一致。
 */
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3000/api';
const ORIGIN = 'http://127.0.0.1:5173';
const ADMIN = { username: 'admin', password: 'Admin@123456' };
const PLAYER_PWD = 'Player2026';
const AGENT_PWD = 'Agent@2026';
const TARGET = 1_000_000;
const STEP = 200_000;   /* 单笔上分上限 */

const lines = [];
const log = (s = '') => { lines.push(s); console.log(s.replace(/[^\x00-\x7F]/g, '.')); };

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* */ }
  if (!res.ok) throw new Error(`${res.status} ${j?.message || text.slice(0, 180)}`);
  return j?.data !== undefined ? j.data : j;
}
const rid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const login = (u, p) => call('POST', '/auth/login', { body: { username: u, password: p } });

const PLAN = [
  { roomNo: '199607', player: 'wanjia001', note: '现金 · 有总代' },
  { roomNo: '126459', player: 'wanjia004', note: '信用 · 有总代' },
  { roomNo: '277021', player: 'wanjia003', note: '现金 · 直属' },
  { roomNo: '725995', player: 'wanjia005', note: '现金 · 直属' },
  { roomNo: '455136', player: 'wanjia006', note: '现金 · 直属' },
  { roomNo: '944937', player: 'wanjia007', note: '信用 · 直属' },
];

const admin = await login(ADMIN.username, ADMIN.password);
const aT = admin.token;
const rooms = await call('GET', '/console/rooms?page=1&pageSize=50', { token: aT });

log('==== 1. 补齐房间与账号信息 ====');
for (const s of PLAN) {
  const r = rooms.find((x) => String(x.roomNo) === s.roomNo);
  s.roomId = r.id;
  s.bookMode = r.bookMode;
  const d = await call('GET', `/console/rooms/${r.id}`, { token: aT });
  s.agentName = d.ownerAgent.user.username;
  s.agentUid = d.ownerAgent.user.uid;
  const pl = await call('GET', `/console/players?page=1&pageSize=50&q=${s.player}`, { token: aT });
  const p = (pl.list || pl).find((x) => x.username === s.player);
  s.playerId = p.id;
  s.playerUid = p.uid;
  log(`${s.roomNo} ${s.player}(uid ${s.playerUid}) ← 代理 ${s.agentName}(uid ${s.agentUid})`);
}

log('');
log('==== 2. 代理审核玩家进房申请 ====');
/* 玩家点「进入房间」只是提交申请，成员状态是待审；代理审过才算本房玩家 */
for (const s of PLAN) {
  const ag = await login(s.agentName, AGENT_PWD).catch(() => null);
  if (!ag) { log(`${s.agentName} 登录失败`); continue; }
  s.agToken = ag.token;
  try {
    const pend = await call('GET', '/console/room-members/pending', { token: ag.token });
    const list = pend.list || pend || [];
    const mine = list.filter((m) => String(m.roomId || m.room?.id) === String(s.roomId));
    if (!mine.length) { log(`${s.roomNo} 无待审申请`); continue; }
    for (const m of mine) {
      const who = m.player?.username || m.username || m.playerId;
      await call('POST', `/console/room-members/${m.id}/approve`, { token: ag.token });
      log(`${s.agentName} 审核通过 ${who} 进入 ${s.roomNo}`);
    }
  } catch (e) { log(`${s.roomNo} 审核失败: ${e.message}`); }
}

log('');
log('==== 3. 代理把玩家挂到自己名下 ====');
for (const s of PLAN) {
  if (!s.agToken) continue;
  try {
    const r = await call('POST', '/console/players/hang', {
      token: s.agToken,
      body: { friendUid: s.playerUid, underUid: s.agentUid, roomId: s.roomId },
    });
    log(`${s.agentName} 挂靠 ${s.player}：${r?.message || '成功'}`);
  } catch (e) {
    log(`${s.agentName} 挂靠 ${s.player}：${e.message}`);
  }
}

log('');
log('==== 3. 上分到 100 万（单笔上限 20 万，分批） ====');
for (const s of PLAN) {
  if (!s.agToken) continue;
  let have = 0;
  try {
    const det = await call('GET', `/console/players/${s.playerId}?roomId=${s.roomId}`, { token: s.agToken });
    have = Number(det.points ?? det.balance ?? 0);
  } catch { /* 取不到当 0 */ }
  const delta = Math.floor(TARGET - have);
  if (delta <= 0) { log(`${s.player} 已有 ${have}，无需上分`); continue; }
  let done = 0;
  let err = '';
  while (done < delta) {
    const amt = Math.min(STEP, delta - done);
    try {
      await call('POST', '/console/wallet/credit-player', {
        token: s.agToken,
        body: { playerId: s.playerId, amount: amt, roomId: s.roomId, remark: '压测上分', clientRequestId: rid('cp') },
      });
      done += amt;
    } catch (e) { err = e.message; break; }
  }
  log(`${s.agentName} → ${s.player} 上分 ${done}（原有 ${have}）${err ? '  中断: ' + err : ''}`);
}

log('');
log('==== 4. 最终账号清单 ====');
log('房号\t玩家账号\t密码\t\tUID\t\t账本\t积分\t\t说明');
for (const s of PLAN) {
  let bal = '?';
  try {
    const det = await call('GET', `/console/players/${s.playerId}?roomId=${s.roomId}`, { token: s.agToken });
    bal = String(det.points ?? det.balance ?? '?');
  } catch { /* */ }
  log(`${s.roomNo}\t${s.player}\t${PLAYER_PWD}\t${s.playerUid}\t${s.bookMode}\t${bal}\t${s.note}`);
}

log('');
log('==== 5. 基线快照（事后对账起点） ====');
const soft = await call('GET', '/console/global-soft-control', { token: aT });
log(`软控开启=${soft.config.enabled}  街机目标RTP=${soft.config.arcadeRtpTarget}  候选数=${soft.config.arcadeCandidateTries}`);
log(`今日：流水=${soft.stats.stake} 派彩=${soft.stats.payout} 庄家盈亏=${soft.stats.house} 注单数=${soft.stats.betCount}`);
for (const p of soft.arcadePools || []) {
  log(`街机池 ${p.gameCode}: 流水=${p.stake} 派彩=${p.payout} 实际RTP=${p.rtp} 目标=${p.targetRtp} 池差=${p.balanceGap}`);
}

writeFileSync('_accounts.log', lines.join('\n'), 'utf8');
console.log('\n完整清单（含中文）已写入 _accounts.log');
