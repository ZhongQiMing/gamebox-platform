/**
 * 压测前置准备（全程走正规业务接口，保证账本自始至终是平的）
 *
 * 幂等：可重复运行。已完成的步骤会自动跳过。
 * 日志自己写 UTF-8 文件，避免 PowerShell 重定向把中文弄乱。
 *
 *   node scripts/test-setup.mjs
 */
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3000/api';
const ORIGIN = 'http://127.0.0.1:5173';
const ADMIN = { username: 'admin', password: process.env.ADMIN_PWD || 'Admin@123456' };
const PLAYER_PWD = 'Player2026';
const AGENT_PWD = 'Agent@2026';
const GENERAL_PWD = 'General@2026';
const TARGET = 1_000_000;

const lines = [];
const log = (s = '') => { lines.push(s); console.log(s.replace(/[^\x00-\x7F]/g, '.')); };
let n = 0;
const head = (s) => { log(); log(`==== ${++n}. ${s} ====`); };
const flush = () => writeFileSync('_setup.log', lines.join('\n'), 'utf8');

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* */ }
  if (!res.ok) throw new Error(`${res.status} ${j?.message || text.slice(0, 200)}`);
  return j?.data !== undefined ? j.data : j;
}
const rid = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const login = (username, password) => call('POST', '/auth/login', { body: { username, password } });

/* ── 1 管理员 ── */
head('登录管理员');
const admin = await login(ADMIN.username, ADMIN.password);
const aT = admin.token;
log(`admin 已登录`);

/* ── 2 软控 ── */
head('全局软控');
let soft = await call('GET', '/console/global-soft-control', { token: aT });
if (!soft.config.enabled) {
  await call('PUT', '/console/global-soft-control', {
    token: aT, body: { enabled: true, adminPassword: ADMIN.password },
  });
  soft = await call('GET', '/console/global-soft-control', { token: aT });
}
log(`已开启=${soft.config.enabled}  街机目标RTP=${soft.config.arcadeRtpTarget}  候选数=${soft.config.arcadeCandidateTries}  池窗口=${soft.config.arcadePoolWindowDays}天  彩票/牌桌流水门槛=${soft.config.minFlowToControl}`);

/* ── 3 六个房间 ── */
head('六个测试房间');
const rooms = await call('GET', '/console/rooms?page=1&pageSize=50', { token: aT });
const byNo = (no) => rooms.find((r) => String(r.roomNo) === String(no));
const PLAN = [
  { roomNo: '199607', player: 'wanjia001', note: '现金·有总代' },
  { roomNo: '126459', player: 'wanjia004', note: '信用·有总代' },
  { roomNo: '277021', player: 'wanjia003', note: '现金·直属' },
  { roomNo: '725995', player: 'wanjia005', note: '现金·直属新房' },
  { roomNo: '455136', player: 'wanjia006', note: '信用外·直属新房' },
  { roomNo: '944937', player: 'wanjia007', note: '信用·直属新房' },
];
for (const s of PLAN) {
  const r = byNo(s.roomNo);
  if (!r) { log(`缺房间 ${s.roomNo}`); continue; }
  s.roomId = r.id;
  const d = await call('GET', `/console/rooms/${r.id}`, { token: aT });
  s.bookMode = d.bookMode;
  s.agentUserId = d.ownerAgent?.userId;
  s.agentName = d.ownerAgent?.user?.username;
  s.agentBalance = Number(d.ownerAgent?.balance ?? 0);
  s.agentQuota = Number(d.ownerAgent?.pointsQuota ?? 0);
  s.generalUserId = d.general?.userId || null;
  s.generalName = d.general?.username || null;
  s.creditLimit = Number(d.creditLimit ?? 0);
  log(`${s.roomNo} ${String(d.name).padEnd(6)} ${String(s.bookMode).padEnd(6)} 代理=${String(s.agentName).padEnd(10)} 总代=${String(s.generalName || '无').padEnd(11)} 代理可用=${s.agentBalance} 额度=${s.agentQuota}`);
}

/* ── 4 重置相关账号密码为已知值 ── */
head('统一密码（便于登录操作）');
const generals = [...new Set(PLAN.map((s) => s.generalUserId).filter(Boolean))];
for (const uid of generals) {
  const who = PLAN.find((s) => s.generalUserId === uid);
  try {
    await call('POST', `/console/agents/${uid}/reset-password`, { token: aT, body: { password: GENERAL_PWD } });
    log(`总代 ${who.generalName} 密码 → ${GENERAL_PWD}`);
  } catch (e) { log(`总代 ${who.generalName} 重置失败: ${e.message}`); }
}
/* 房间代理属于「本房专属代理」，只能走房间接口重置，代理接口只管子账号/总监/总代 */
for (const s of PLAN) {
  if (!s.roomId) continue;
  try {
    await call('POST', `/console/rooms/${s.roomId}/reset-agent-password`, { token: aT, body: { password: AGENT_PWD } });
    log(`代理 ${s.agentName} 密码 → ${AGENT_PWD}`);
  } catch (e) { log(`代理 ${s.agentName} 重置失败: ${e.message}`); }
}
for (const s of PLAN) {
  try {
    const pl = await call('GET', `/console/players?page=1&pageSize=50&q=${s.player}`, { token: aT });
    const p = (pl.list || pl).find?.((x) => x.username === s.player) || (pl.list || pl)[0];
    if (p) {
      s.playerId = p.id;
      s.uid = p.uid;
      await call('POST', `/console/players/${p.id}/reset-password`, { token: aT, body: { password: PLAYER_PWD } });
    }
  } catch (e) { log(`玩家 ${s.player} 处理失败: ${e.message}`); }
}
log(`玩家密码统一为 ${PLAYER_PWD}`);

/* ── 5 备额 ──
 * 信用盘和现金盘走两条完全不同的路：
 *   现金盘：上下分发额度（wallet/issue），金额必须是整数
 *   信用盘：禁止上下分加款，只能调「合同信用额度」；挂了总代的房要在总代账户调
 */
head('给代理备额（现金盘发分 / 信用盘调额度）');
for (const s of PLAN) {
  if (!s.agentUserId) continue;
  const d = await call('GET', `/console/rooms/${s.roomId}`, { token: aT });
  const have = Number(d.ownerAgent?.balance ?? 0);
  const quota = Number(d.ownerAgent?.pointsQuota ?? 0);

  if (s.bookMode === 'CREDIT') {
    /* 信用盘看额度够不够，不看余额 */
    if (quota >= TARGET) { log(`${s.agentName}（信用）额度 ${quota} 够用`); continue; }
    const bump = Math.ceil(TARGET * 2 - quota);
    const path = s.generalUserId
      ? `/console/agents/${s.generalUserId}/credit-limit/bump`   /* 挂总代：在总代账户调 */
      : `/console/rooms/${s.roomId}/credit-limit/bump`;          /* 直属房：在房间调 */
    try {
      await call('POST', path, {
        token: aT,
        body: { amount: bump, direction: 'up', remark: '压测备额', clientRequestId: rid('cl') },
      });
      log(`${s.agentName}（信用）额度 +${bump}`);
    } catch (e) { log(`${s.agentName}（信用）调额度失败: ${e.message}`); }
    continue;
  }

  if (have >= TARGET) { log(`${s.agentName} 已有 ${have}，无需补`); continue; }
  const need = Math.ceil(TARGET - have);   /* 接口只收整数 */

  if (s.generalUserId) {
    try {
      await call('POST', '/console/wallet/issue', {
        token: aT,
        body: { toUserId: s.generalUserId, amount: need, remark: '压测备额', clientRequestId: rid('g') },
      });
      log(`平台 → ${s.generalName} +${need}`);
    } catch (e) { log(`平台 → ${s.generalName} 失败: ${e.message}`); }
    const g = await login(s.generalName, GENERAL_PWD).catch(() => null);
    if (!g) { log(`${s.generalName} 登录失败，${s.agentName} 未补额`); continue; }
    try {
      await call('POST', '/console/wallet/issue', {
        token: g.token,
        body: { toUserId: s.agentUserId, amount: need, remark: '压测备额', clientRequestId: rid('a') },
      });
      log(`${s.generalName} → ${s.agentName} +${need}`);
    } catch (e) { log(`${s.generalName} → ${s.agentName} 失败: ${e.message}`); }
  } else {
    try {
      await call('POST', '/console/wallet/issue', {
        token: aT,
        body: { toUserId: s.agentUserId, amount: need, remark: '压测备额', clientRequestId: rid('d') },
      });
      log(`平台 → ${s.agentName} +${need}`);
    } catch (e) { log(`平台 → ${s.agentName} 失败: ${e.message}`); }
  }
}

/* ── 7 上分 ── */
head('代理给玩家上分到 100 万');
for (const s of PLAN) {
  if (!s.playerId || !s.agentName) continue;
  const ag = await login(s.agentName, AGENT_PWD).catch(() => null);
  if (!ag) { log(`${s.agentName} 登录失败，${s.player} 未上分`); continue; }
  let have = 0;
  try {
    const det = await call('GET', `/console/players/${s.playerId}?roomId=${s.roomId}`, { token: ag.token });
    have = Number(det.points ?? det.balance ?? 0);
  } catch { /* 取不到就当 0 */ }
  const delta = Math.floor(TARGET - have);
  if (delta <= 0) { log(`${s.player} 已有 ${have}，无需上分`); continue; }
  /* 单笔上分不超过 20 万，按 20 万一笔拆开 */
  const STEP = 200_000;
  let done = 0;
  let err = '';
  while (done < delta) {
    const amt = Math.min(STEP, delta - done);
    try {
      await call('POST', '/console/wallet/credit-player', {
        token: ag.token,
        body: { playerId: s.playerId, amount: amt, roomId: s.roomId, remark: '压测上分', clientRequestId: rid('cp') },
      });
      done += amt;
    } catch (e) { err = e.message; break; }
  }
  log(done > 0
    ? `${s.agentName} → ${s.player} 上分 ${done}（原有 ${have}）${err ? ' 中断: ' + err : ''}`
    : `${s.agentName} → ${s.player} 上分失败: ${err}`);
}

/* ── 8 结果 ── */
head('最终清单');
log('房号\t玩家\t\t密码\t\tUID\t\t账本\t说明');
for (const s of PLAN) {
  let bal = '?';
  try {
    const ag = await login(s.agentName, AGENT_PWD);
    const det = await call('GET', `/console/players/${s.playerId}?roomId=${s.roomId}`, { token: ag.token });
    bal = String(det.points ?? det.balance ?? '?');
  } catch { /* */ }
  log(`${s.roomNo}\t${s.player}\t${PLAYER_PWD}\t${s.uid}\t${s.bookMode}\t${s.note}\t积分=${bal}`);
}
log();
log(`管理后台  admin / ${ADMIN.password}`);
log(`总代账号  ${generals.map((u) => PLAN.find((s) => s.generalUserId === u).generalName).join(', ')} / ${GENERAL_PWD}`);
log(`房间代理  ${PLAN.map((s) => s.agentName).join(', ')} / ${AGENT_PWD}`);

/* ── 9 基线快照 ── */
head('基线快照（事后对账用）');
const pools = await call('GET', '/console/global-soft-control', { token: aT });
log(`今日流水=${pools.stats.stake} 派彩=${pools.stats.payout} 庄家盈亏=${pools.stats.house} 注单数=${pools.stats.betCount}`);
for (const p of pools.arcadePools || []) {
  log(`街机池 ${p.gameCode}: 流水=${p.stake} 派彩=${p.payout} RTP=${p.rtp} 目标=${p.targetRtp} 池差=${p.balanceGap}`);
}
const recon = await call('GET', '/api/admin/fund-recon'.replace('/api', ''), { token: aT }).catch((e) => ({ error: e.message }));
log(`对账: ${JSON.stringify(recon).slice(0, 400)}`);

flush();
console.log('\n完整日志（含中文）已写入 _setup.log');
