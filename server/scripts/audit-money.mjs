/**
 * 全量资金对账（只读，不改任何数据）。
 *
 * 用真实注单验证四件事：
 *   1. 注单有没有被吞（悬空 PENDING、开奖了却没结算、孤儿局）
 *   2. 每笔注单的扣款/派彩是否都有对应账本凭证，有没有重复派彩
 *   3. 账户余额是否等于其账本流水之和（余额与账本是否已漂移）
 *   4. 双向记账是否守恒（每笔资金移动出入相等）
 * 另外统计软控介入的证据（开奖 nonce 是否被改动）。
 *
 * 跑法：node scripts/audit-money.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const num = (v) => Math.round(Number(v || 0) * 100) / 100;
const money = (v) => num(v).toLocaleString('en-US', { minimumFractionDigits: 2 });

const problems = [];
const notes = [];
function bad(sev, title, detail) {
  problems.push({ sev, title, detail });
}

function head(t) {
  console.log('\n' + '='.repeat(72));
  console.log(t);
  console.log('='.repeat(72));
}

/* ---------------- 1. 注单总览 ---------------- */
head('1. 注单总览');

const byStatus = await prisma.bet.groupBy({
  by: ['status'],
  _count: { _all: true },
  _sum: { amount: true, payout: true, validFlow: true },
});
let totalStake = 0;
let totalPayout = 0;
for (const r of byStatus.sort((a, b) => b._count._all - a._count._all)) {
  const s = num(r._sum.amount);
  const p = num(r._sum.payout);
  totalStake += s;
  totalPayout += p;
  console.log(`  ${r.status.padEnd(10)} ${String(r._count._all).padStart(6)} 笔   下注 ${money(s).padStart(16)}   派彩 ${money(p).padStart(16)}`);
}
console.log(`  ${'合计'.padEnd(9)} ${''.padStart(6)}        下注 ${money(totalStake).padStart(16)}   派彩 ${money(totalPayout).padStart(16)}`);
console.log(`  玩家净盈亏（派彩-下注，不含回水）= ${money(totalPayout - totalStake)}`);

const byGame = await prisma.$queryRaw`
  SELECT g.code, g.name, COUNT(*)::int AS n,
         SUM(b.amount)::float AS stake,
         SUM(b.payout)::float AS payout,
         SUM(CASE WHEN b.status = 'PENDING' THEN 1 ELSE 0 END)::int AS pending
  FROM "Bet" b JOIN "Game" g ON g.id = b."gameId"
  GROUP BY g.code, g.name ORDER BY n DESC`;
console.log('\n  按游戏：');
for (const r of byGame) {
  const rtp = r.stake > 0 ? ((r.payout / r.stake) * 100).toFixed(1) + '%' : '—';
  console.log(`    ${String(r.code).padEnd(14)} ${String(r.n).padStart(5)} 笔  下注 ${money(r.stake).padStart(14)}  派彩 ${money(r.payout).padStart(14)}  返还率 ${rtp.padStart(7)}  待结 ${r.pending}`);
}

/* ---------------- 2. 吞单检查 ---------------- */
head('2. 吞单检查（注单有没有被吃掉）');

/* 2a. 已开奖的期，却还有 PENDING 注单 */
const lotteryStuck = await prisma.$queryRaw`
  SELECT g.code, i."issueNo", COUNT(*)::int AS n, SUM(b.amount)::float AS amt
  FROM "Bet" b
  JOIN "LotteryIssue" i ON i.id = b."issueId"
  JOIN "Game" g ON g.id = b."gameId"
  WHERE b.status = 'PENDING' AND i.status = 'DRAWN'
  GROUP BY g.code, i."issueNo" ORDER BY n DESC LIMIT 20`;
if (lotteryStuck.length) {
  bad('blocker', '彩票已开奖但注单仍 PENDING（真实吞单）',
    lotteryStuck.map((r) => `${r.code} ${r.issueNo}: ${r.n} 笔 / ${money(r.amt)}`).join('；'));
  console.log('  ✗ 已开奖却未结算的彩票注单：');
  for (const r of lotteryStuck) console.log(`      ${r.code} ${r.issueNo}  ${r.n} 笔  ${money(r.amt)}`);
} else {
  console.log('  ✓ 没有「期已开奖、注单仍待结算」的彩票注单');
}

/* 2b. 局已结算，却还有 PENDING 注单 */
const roundStuck = await prisma.$queryRaw`
  SELECT g.code, r."roundNo", r.state, COUNT(*)::int AS n, SUM(b.amount)::float AS amt
  FROM "Bet" b
  JOIN "GameRound" r ON r.id = b."roundId"
  JOIN "Game" g ON g.id = b."gameId"
  WHERE b.status = 'PENDING' AND r.state IN ('SETTLED','CANCELLED')
  GROUP BY g.code, r."roundNo", r.state ORDER BY n DESC LIMIT 20`;
if (roundStuck.length) {
  bad('blocker', '局已结算但注单仍 PENDING（真实吞单）',
    roundStuck.map((r) => `${r.code} ${r.roundNo}(${r.state}): ${r.n} 笔 / ${money(r.amt)}`).join('；'));
  console.log('  ✗ 局已结束却未结算的注单：');
  for (const r of roundStuck) console.log(`      ${r.code} ${r.roundNo} [${r.state}]  ${r.n} 笔  ${money(r.amt)}`);
} else {
  console.log('  ✓ 没有「局已结束、注单仍待结算」的注单');
}

/* 2c. 长时间悬空的 PENDING */
const oldPending = await prisma.$queryRaw`
  SELECT g.code, COUNT(*)::int AS n, SUM(b.amount)::float AS amt,
         MIN(b."createdAt") AS oldest
  FROM "Bet" b JOIN "Game" g ON g.id = b."gameId"
  WHERE b.status = 'PENDING' AND b."createdAt" < NOW() - INTERVAL '10 minutes'
  GROUP BY g.code ORDER BY n DESC`;
if (oldPending.length) {
  bad('high', '超过 10 分钟仍未结算的注单',
    oldPending.map((r) => `${r.code}: ${r.n} 笔 / ${money(r.amt)} / 最早 ${new Date(r.oldest).toLocaleString('zh-CN')}`).join('；'));
  console.log('  ✗ 悬空超过 10 分钟的注单：');
  for (const r of oldPending) console.log(`      ${String(r.code).padEnd(14)} ${r.n} 笔  ${money(r.amt)}  最早 ${new Date(r.oldest).toLocaleString('zh-CN')}`);
} else {
  console.log('  ✓ 没有悬空超过 10 分钟的注单');
}

/* 2d. 孤儿局：PLAYING 且已超时 */
const orphanRounds = await prisma.$queryRaw`
  SELECT g.code, r."roundNo", r."startedAt",
         (SELECT COUNT(*)::int FROM "Bet" b WHERE b."roundId" = r.id) AS bets
  FROM "GameRound" r JOIN "Game" g ON g.id = r."gameId"
  WHERE r.state = 'PLAYING' AND r."startedAt" < NOW() - INTERVAL '10 minutes'
  ORDER BY r."startedAt" LIMIT 20`;
if (orphanRounds.length) {
  bad('high', '超时未结束的对局（孤儿局）',
    orphanRounds.map((r) => `${r.code} ${r.roundNo} 注单${r.bets}`).join('；'));
  console.log('  ✗ 超时仍 PLAYING 的局：');
  for (const r of orphanRounds) console.log(`      ${String(r.code).padEnd(14)} ${r.roundNo}  注单 ${r.bets}  开始于 ${new Date(r.startedAt).toLocaleString('zh-CN')}`);
} else {
  console.log('  ✓ 没有超时未结束的对局');
}

/* 2e. 已中奖(WON)但派彩为 0 */
const wonZero = await prisma.bet.count({ where: { status: 'WON', payout: { lte: 0 } } });
if (wonZero > 0) {
  bad('blocker', 'WON 状态但派彩为 0 的注单', `${wonZero} 笔`);
  console.log(`  ✗ WON 但派彩为 0：${wonZero} 笔`);
} else {
  console.log('  ✓ 没有「判为中奖却零派彩」的注单');
}

/* 2f. LOST 却有派彩 */
const lostPaid = await prisma.bet.count({ where: { status: 'LOST', payout: { gt: 0 } } });
if (lostPaid > 0) {
  bad('blocker', 'LOST 状态却有派彩的注单', `${lostPaid} 笔`);
  console.log(`  ✗ LOST 却有派彩：${lostPaid} 笔`);
} else {
  console.log('  ✓ 没有「判为未中却发钱」的注单');
}

/* ---------------- 3. 注单 ↔ 账本 逐笔对应 ---------------- */
head('3. 注单与账本逐笔对应（扣款/派彩凭证是否齐全）');

/* 3a. 有注单但找不到扣款凭证 */
const noDebit = await prisma.$queryRaw`
  SELECT g.code, COUNT(*)::int AS n, SUM(b.amount)::float AS amt
  FROM "Bet" b
  JOIN "Game" g ON g.id = b."gameId"
  WHERE b.amount > 0
    AND NOT EXISTS (
      SELECT 1 FROM "PointsLedger" l
      WHERE l."bizType" = 'BET'
        AND (l."idempotencyKey" LIKE '%_' || b.id OR l."refId" = b.id
             OR (l."refType" = 'round' AND l."refId" = b."roundId")
             OR (l."refType" = 'issue' AND l."refId" = b."issueId"))
    )
  GROUP BY g.code ORDER BY n DESC`;
if (noDebit.length) {
  bad('blocker', '注单缺少扣款账本凭证',
    noDebit.map((r) => `${r.code}: ${r.n} 笔 / ${money(r.amt)}`).join('；'));
  console.log('  ✗ 找不到扣款凭证的注单：');
  for (const r of noDebit) console.log(`      ${String(r.code).padEnd(14)} ${r.n} 笔  ${money(r.amt)}`);
} else {
  console.log('  ✓ 每笔注单都能找到对应的扣款账本记录');
}

/* 3b. 重复派彩：同一注单出现两条以上 WIN 入账（按幂等键前缀分组） */
const dupWin = await prisma.$queryRaw`
  SELECT l."idempotencyKey", COUNT(*)::int AS n
  FROM "PointsLedger" l
  WHERE l."bizType" = 'WIN' AND l."idempotencyKey" IS NOT NULL
  GROUP BY l."idempotencyKey" HAVING COUNT(*) > 1 LIMIT 10`;
if (dupWin.length) {
  bad('blocker', '同一幂等键出现多条派彩记录', dupWin.map((r) => r.idempotencyKey).join('；'));
  console.log('  ✗ 重复派彩（幂等键重复）：', dupWin.length, '组');
} else {
  console.log('  ✓ 没有重复派彩（幂等键唯一性有效）');
}

/* 3c. 派彩金额与注单 payout 是否一致（抽样，按玩家侧 WIN 汇总） */
const payoutCmp = await prisma.$queryRaw`
  WITH bet_win AS (
    SELECT SUM(b.payout)::float AS s FROM "Bet" b WHERE b.status = 'WON'
  ), ledger_win AS (
    SELECT SUM(l.amount)::float AS s
    FROM "PointsLedger" l JOIN "PointsAccount" a ON a.id = l."accountId"
    WHERE l."bizType" = 'WIN' AND a."ownerType" = 'PLAYER' AND l.amount > 0
  )
  SELECT (SELECT s FROM bet_win) AS bets, (SELECT s FROM ledger_win) AS ledger`;
const bw = num(payoutCmp[0]?.bets);
const lw = num(payoutCmp[0]?.ledger);
console.log(`  注单 WON 派彩合计 ${money(bw)}    玩家侧账本 WIN 入账合计 ${money(lw)}    差额 ${money(lw - bw)}`);
if (Math.abs(lw - bw) > 0.01) {
  bad('high', '注单派彩与玩家账本入账不一致', `注单 ${money(bw)} vs 账本 ${money(lw)}，差 ${money(lw - bw)}`);
} else {
  console.log('  ✓ 派彩金额与账本入账完全一致');
}

/* ---------------- 4. 余额 vs 账本 ---------------- */
head('4. 账户余额是否等于其账本流水之和');

const drift = await prisma.$queryRaw`
  SELECT a."ownerType", a."ownerId", a."roomId", a.balance::float AS balance,
         COALESCE(SUM(l.amount), 0)::float AS ledger_sum
  FROM "PointsAccount" a
  LEFT JOIN "PointsLedger" l ON l."accountId" = a.id
  GROUP BY a.id, a."ownerType", a."ownerId", a."roomId", a.balance
  HAVING ABS(a.balance - COALESCE(SUM(l.amount), 0)) > 0.005
  ORDER BY ABS(a.balance - COALESCE(SUM(l.amount), 0)) DESC LIMIT 20`;
const acctTotal = await prisma.pointsAccount.count();
if (drift.length) {
  bad('blocker', '余额与账本不一致的账户',
    drift.map((r) => `${r.ownerType}/${String(r.ownerId).slice(0, 8)}: 余额 ${money(r.balance)} vs 账本 ${money(r.ledger_sum)}`).join('；'));
  console.log(`  ✗ ${drift.length} 个账户余额与账本漂移（共 ${acctTotal} 个账户）：`);
  for (const r of drift) {
    console.log(`      ${r.ownerType.padEnd(9)} ${String(r.ownerId).slice(0, 10)} 房${String(r.roomId).slice(0, 8).padEnd(9)} 余额 ${money(r.balance).padStart(14)}  账本 ${money(r.ledger_sum).padStart(14)}  差 ${money(r.balance - r.ledger_sum)}`);
  }
} else {
  console.log(`  ✓ 全部 ${acctTotal} 个账户的余额都等于其账本流水之和（零漂移）`);
}

/* ---------------- 5. 双向记账守恒 ---------------- */
head('5. 双向记账守恒（钱有没有凭空产生或消失）');

const byBiz = await prisma.$queryRaw`
  SELECT l."bizType",
         COUNT(*)::int AS n,
         SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END)::float AS credit,
         SUM(CASE WHEN l.amount < 0 THEN -l.amount ELSE 0 END)::float AS debit,
         SUM(l.amount)::float AS net
  FROM "PointsLedger" l
  GROUP BY l."bizType" ORDER BY n DESC`;
console.log('  按业务类型（净额应接近 0，除充值/提现等单边业务）：');
let grandNet = 0;
for (const r of byBiz) {
  grandNet += num(r.net);
  const flag = Math.abs(num(r.net)) > 0.01 ? '  ← 单边' : '';
  console.log(`    ${String(r.bizType).padEnd(12)} ${String(r.n).padStart(6)} 条  入 ${money(r.credit).padStart(16)}  出 ${money(r.debit).padStart(16)}  净 ${money(r.net).padStart(14)}${flag}`);
}
console.log(`  全部账本净额合计 = ${money(grandNet)}`);
notes.push(`账本全局净额 ${money(grandNet)}（等于外部注入的本金总量，不应为随机小数）`);

/*
 * BET / WIN 的守恒必须把额度流水一起算：
 * 信用盘关盘时代理侧只动 Agent.pointsQuota（记在 AgentQuotaLedger），
 * 不进积分账本。只看积分账本会误判成「单边记账」。
 * 现金盘的额度与余额是同步的，已计入积分账本，这里不能重复计。
 */
const creditQuota = await prisma.$queryRaw`
  SELECT q."bizType", SUM(q.delta)::float AS net
  FROM "AgentQuotaLedger" q
  WHERE q."bizType" IN ('BET','WIN') AND q."bookMode" = 'CREDIT'
  GROUP BY q."bizType"`;
for (const t of ['BET', 'WIN']) {
  const row = byBiz.find((r) => r.bizType === t);
  if (!row) continue;
  const cq = num(creditQuota.find((r) => r.bizType === t)?.net);
  const combined = num(num(row.net) + cq);
  const label = `${t} 积分账本 ${money(row.net)} + 信用盘额度 ${money(cq)} = ${money(combined)}`;
  if (Math.abs(combined) > 0.02) {
    bad('blocker', `${t} 类资金不守恒`, label);
    console.log(`  ✗ ${label}`);
  } else {
    console.log(`  ✓ ${label}  （严格守恒）`);
  }
}

/* ---------------- 6. 代理额度 vs 额度流水 ---------------- */
head('6. 代理额度是否等于其额度流水之和');

const quotaDrift = await prisma.$queryRaw`
  SELECT a."userId", a."pointsQuota"::float AS quota,
         COALESCE((SELECT SUM(q.delta) FROM "AgentQuotaLedger" q WHERE q."agentUserId" = a."userId"), 0)::float AS ledger_sum
  FROM "Agent" a
  ORDER BY a."createdAt"`;
let qBad = 0;
for (const r of quotaDrift) {
  if (Math.abs(num(r.quota) - num(r.ledger_sum)) > 0.005) {
    qBad++;
    console.log(`    ✗ 代理 ${String(r.userId).slice(0, 10)}  额度 ${money(r.quota)}  流水 ${money(r.ledger_sum)}  差 ${money(num(r.quota) - num(r.ledger_sum))}`);
  }
}
if (qBad) bad('high', '代理额度与额度流水不一致', `${qBad} 个代理`);
else console.log(`  ✓ 全部 ${quotaDrift.length} 个代理的额度都等于其额度流水之和`);

/* ---------------- 7. 回水 ---------------- */
head('7. 回水发放核对');

const rebateAgg = await prisma.$queryRaw`
  SELECT COUNT(*)::int AS n, SUM(amount)::float AS amt, SUM("validFlow")::float AS flow,
         SUM(CASE WHEN "ledgerId" IS NULL THEN 1 ELSE 0 END)::int AS no_ledger
  FROM "DailyRebateSettlement"`;
const ra = rebateAgg[0] || {};
console.log(`  回水结算 ${ra.n || 0} 笔，金额 ${money(ra.amt)}，对应有效流水 ${money(ra.flow)}，缺账本凭证 ${ra.no_ledger || 0} 笔`);
if ((ra.no_ledger || 0) > 0) {
  bad('high', '回水结算缺少账本凭证', `${ra.no_ledger} 笔 DailyRebateSettlement 没有 ledgerId`);
}
const rebateLedger = await prisma.$queryRaw`
  SELECT SUM(l.amount)::float AS s FROM "PointsLedger" l
  JOIN "PointsAccount" a ON a.id = l."accountId"
  WHERE l."bizType" = 'REBATE' AND a."ownerType" = 'PLAYER' AND l.amount > 0`;
const rl = num(rebateLedger[0]?.s);
console.log(`  玩家侧回水入账合计 ${money(rl)}`);
if (Math.abs(rl - num(ra.amt)) > 0.01) {
  bad('high', '回水结算金额与玩家入账不一致', `结算 ${money(ra.amt)} vs 入账 ${money(rl)}`);
} else if (num(ra.amt) > 0) {
  console.log('  ✓ 回水结算金额与玩家实际入账一致');
}
/* 重复领取同一区间 */
const dupRebate = await prisma.$queryRaw`
  SELECT "playerId", "roomId", "rebateDate", "periodEnd", COUNT(*)::int AS n
  FROM "DailyRebateSettlement"
  GROUP BY "playerId", "roomId", "rebateDate", "periodEnd" HAVING COUNT(*) > 1 LIMIT 10`;
if (dupRebate.length) {
  bad('high', '同一区间重复领取回水', `${dupRebate.length} 组`);
  console.log(`  ✗ 同一 (玩家,房间,日期,区间) 出现多条回水结算：${dupRebate.length} 组`);
} else {
  console.log('  ✓ 没有同一区间重复领取回水');
}

/* ---------------- 7b. 占成三方分账 ---------------- */
head('7b. 占成分账：代理 + 总代 + 平台 是否等于房间盈亏');

const settles = await prisma.roomWeekSettle.findMany({
  select: {
    id: true, weekStart: true, bookMode: true, status: true,
    agentShareRate: true, generalShareRate: true,
    housePnl: true, agentShareAmount: true,
    generalShareAmount: true, platformShareAmount: true,
    room: { select: { roomNo: true, generalAgentId: true } },
  },
  orderBy: { weekStart: 'desc' },
  take: 200,
});
console.log(`  检查 ${settles.length} 条结账记录`);
let sumBad = 0;
let generalMissing = 0;
for (const s of settles) {
  const pnl = num(s.housePnl);
  const a = num(s.agentShareAmount);
  const g = num(s.generalShareAmount);
  const p = num(s.platformShareAmount);
  const total = num(a + g + p);
  if (Math.abs(total - pnl) > 0.02) {
    sumBad++;
    console.log(
      `    ✗ 房${s.room?.roomNo} ${new Date(s.weekStart).toLocaleDateString('zh-CN')} ` +
      `盈亏 ${money(pnl)}  代理 ${money(a)} + 总代 ${money(g)} + 平台 ${money(p)} = ${money(total)}`,
    );
  }
  /*
   * 信用盘挂总代却把总代那一份算成 0：这是「谁该拿哪份钱」的漏账，
   * 金额守恒仍成立（钱留在平台侧），但分配是错的，必须单独报出来。
   */
  const rateGap = num(s.generalShareRate) - num(s.agentShareRate);
  if (s.room?.generalAgentId && rateGap > 1e-9 && Math.abs(pnl) > 0.02 && Math.abs(g) < 0.005) {
    generalMissing++;
    console.log(
      `    ✗ 房${s.room.roomNo} ${s.bookMode} 挂总代且成数差 ${(rateGap * 100).toFixed(1)}%，` +
      `盈亏 ${money(pnl)} 但总代分账为 0（应为 ${money(pnl * rateGap)}）`,
    );
  }
}
if (sumBad) bad('blocker', '三方分账合计不等于房间盈亏', `${sumBad} 条结账记录`);
else console.log('  ✓ 每条结账记录的三方分账合计都等于房间盈亏');
if (generalMissing) bad('high', '挂总代的房间总代分账为 0（漏账）', `${generalMissing} 条结账记录`);
else console.log('  ✓ 没有「挂总代却把总代那一份算成 0」的记录');

/* ---------------- 8. 软控证据 ---------------- */
head('8. 软控是否真的介入了开奖');

const lotNonce = await prisma.$queryRaw`
  SELECT g.code, COUNT(*)::int AS drawn,
         SUM(CASE WHEN COALESCE(i.nonce,1) > 1 THEN 1 ELSE 0 END)::int AS steered,
         MAX(COALESCE(i.nonce,1))::int AS max_nonce
  FROM "LotteryIssue" i JOIN "Game" g ON g.id = i."gameId"
  WHERE i.status = 'DRAWN'
  GROUP BY g.code ORDER BY drawn DESC`;
console.log('  彩票历史（nonce 已从对外接口摘掉，这里读库判断）：');
let anySteer = false;
for (const r of lotNonce) {
  if (r.steered > 0) anySteer = true;
  const pct = r.drawn > 0 ? ((r.steered / r.drawn) * 100).toFixed(1) + '%' : '—';
  console.log(`    ${String(r.code).padEnd(14)} 已开奖 ${String(r.drawn).padStart(5)} 期   介入 ${String(r.steered).padStart(5)} 期 (${pct})`);
}

/*
 * 牌桌与街机改成独立候选种子后，结果里不再有任何「被改过」的指纹——对外查不出来
 * 正是要的效果，内部痕迹由 SoftControlAudit 承担（只有 ADMIN 能读）。
 * 只在介入时写一行，分母取实开局数，所以介入率照样算得出来。
 */
const auditRows = await prisma.$queryRaw`
  SELECT category, "gameCode", reason, COUNT(*)::int AS steered
  FROM "SoftControlAudit"
  GROUP BY category, "gameCode", reason
  ORDER BY steered DESC`;
const roundTotals = await prisma.$queryRaw`
  SELECT g.code, r.category, COUNT(*)::int AS total
  FROM "GameRound" r JOIN "Game" g ON g.id = r."gameId"
  WHERE r.category IN ('TABLE','SLOT','ARCADE')
  GROUP BY g.code, r.category`;
const totalByCode = new Map();
for (const r of roundTotals) {
  totalByCode.set(r.code, (totalByCode.get(r.code) ?? 0) + Number(r.total));
}
console.log('\n  牌桌/街机介入留痕（SoftControlAudit，仅 ADMIN 可见）：');
if (!auditRows.length) {
  console.log('    本库暂无介入记录');
} else {
  for (const r of auditRows) {
    if (r.steered > 0) anySteer = true;
    const total = totalByCode.get(r.gameCode) ?? 0;
    const pct = total > 0 ? ((r.steered / total) * 100).toFixed(2) + '%' : '—';
    console.log(
      `    ${String(r.gameCode).padEnd(14)} [${r.category}] 因=${String(r.reason).padEnd(16)} ` +
      `介入 ${String(r.steered).padStart(4)} / ${String(total).padStart(5)} 局 (${pct})`,
    );
  }
}

/* 留痕表必须存在且可写，否则等于又回到「查不出来」的状态 */
const auditTable = await prisma.$queryRaw`
  SELECT COUNT(*)::int AS n FROM information_schema.tables
  WHERE table_name = 'SoftControlAudit'`;
if (!Number(auditTable[0]?.n)) {
  bad('high', '软控留痕表不存在',
    '牌桌与街机改独立候选种子后，结果里没有任何介入指纹；缺了留痕表就彻底无法事后追查');
}
const gsc = await prisma.$queryRaw`SELECT * FROM "GlobalSoftControl" LIMIT 1`;
if (gsc.length) {
  const c = gsc[0];
  console.log(`\n  软控开关 enabled=${c.enabled}  目标RTP(街机)=${c.arcadeRtpTarget}  候选数=${c.candidateTries ?? '-'}/${c.arcadeCandidateTries ?? '-'}  最低起控流水=${c.minFlowToControl ?? '-'}`);
  if (!c.enabled) bad('note', '软控总开关当前是关闭状态', '开关关闭时全部游戏走自然随机');
} else {
  bad('high', '找不到软控配置行', 'GlobalSoftControl 表为空');
}
if (!anySteer) {
  notes.push('本批数据里没有出现 nonce>1，说明软控这段时间没有真正改动过任何一期结果（可能是开关关闭、或未达起控流水、或自然结果已满足约束）');
}

/* ---------------- 9. 一致性：玩家可提余额来源 ---------------- */
head('9. 资金来源结构（钱从哪来、到哪去）');

const src = await prisma.$queryRaw`
  SELECT a."ownerType", COUNT(DISTINCT a.id)::int AS accounts,
         SUM(a.balance)::float AS balance
  FROM "PointsAccount" a GROUP BY a."ownerType" ORDER BY balance DESC`;
for (const r of src) {
  console.log(`  ${String(r.ownerType).padEnd(10)} ${String(r.accounts).padStart(5)} 个账户   余额合计 ${money(r.balance).padStart(18)}`);
}
const sumAll = src.reduce((s, r) => s + num(r.balance), 0);
console.log(`  全站余额合计 ${money(sumAll)}`);
if (Math.abs(sumAll - grandNet) > 0.01) {
  bad('high', '全站余额合计与账本净额不符', `余额 ${money(sumAll)} vs 账本净额 ${money(grandNet)}`);
} else {
  console.log('  ✓ 全站余额合计 = 账本净额（账实相符）');
}

/* ---------------- 结论 ---------------- */
head('审计结论');
if (!problems.length) {
  console.log('  未发现资金问题：没有吞单、没有重复派彩、余额与账本零漂移、双向记账守恒。');
} else {
  const order = { blocker: 0, high: 1, medium: 2, note: 3 };
  problems.sort((a, b) => order[a.sev] - order[b.sev]);
  for (const p of problems) {
    console.log(`  [${p.sev.toUpperCase()}] ${p.title}`);
    console.log(`         ${p.detail}`);
  }
}
if (notes.length) {
  console.log('\n  备注：');
  for (const n of notes) console.log(`    · ${n}`);
}

await prisma.$disconnect();
