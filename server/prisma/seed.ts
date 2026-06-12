/**
 * 初始化种子数据。运行：pnpm --filter @gamebox/server prisma:seed
 * 内容：
 *   - 平台积分账户(PLATFORM)
 *   - 平台管理员账号(ADMIN)  密码：Admin@123456
 *   - 代理等级 V1-V5
 *   - 游戏目录（3 款）+ 各自 active 的 GameConfig（爆率/赔率）
 *
 * 注意：上线前请勿在生产执行含测试账号的 seed，或改写强密码。
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const AGENT_LEVELS = [
  { code: 'V1', name: '青铜代理', minTeamFlow: 0,      commissionRate: 0.005, accent: '#9c8158' },
  { code: 'V2', name: '白银代理', minTeamFlow: 10000,  commissionRate: 0.008, accent: '#c0c0c0' },
  { code: 'V3', name: '黄金代理', minTeamFlow: 50000,  commissionRate: 0.012, accent: '#d4af37' },
  { code: 'V4', name: '铂金代理', minTeamFlow: 200000, commissionRate: 0.016, accent: '#9aa0e8' },
  { code: 'V5', name: '钻石代理', minTeamFlow: 500000, commissionRate: 0.020, accent: '#88e8ff' },
];

const GAMES = [
  {
    code: 'lucky-wheel', name: '幸运转盘', category: 'SLOT' as const,
    status: 'ONLINE' as const, sortOrder: 1, minBet: 1, maxBet: 10000,
    rtp: 0.95,
    payTable: [
      { label: '谢谢参与', multiplier: 0,  weight: 40 },
      { label: '×1',       multiplier: 1,  weight: 25 },
      { label: '×2',       multiplier: 2,  weight: 15 },
      { label: '×5',       multiplier: 5,  weight: 10 },
      { label: '×10',      multiplier: 10, weight: 6  },
      { label: '×20',      multiplier: 20, weight: 3  },
      { label: '×50',      multiplier: 50, weight: 1  },
    ],
  },
  {
    code: 'ffc', name: '分分彩', category: 'LOTTERY' as const,
    status: 'ONLINE' as const, sortOrder: 2, drawIntervalSec: 60, minBet: 1, maxBet: 10000,
    rtp: 0.95,
    payTable: {
      big:   { multiplier: 1.98, desc: '总和 11-18' },
      small: { multiplier: 1.98, desc: '总和 3-10'  },
      odd:   { multiplier: 1.98, desc: '总和为奇数' },
      even:  { multiplier: 1.98, desc: '总和为偶数' },
      exact: { multiplier: 9.00, desc: '猜中个位数字' },
    },
  },
  {
    code: 'slots-classic', name: '经典老虎机', category: 'SLOT' as const,
    status: 'ONLINE' as const, sortOrder: 3, minBet: 1, maxBet: 5000,
    rtp: 0.96,
    payTable: [
      { label: '谢谢参与', multiplier: 0,   weight: 35 },
      { label: '×1',       multiplier: 1,   weight: 25 },
      { label: '×2',       multiplier: 2,   weight: 18 },
      { label: '×5',       multiplier: 5,   weight: 12 },
      { label: '×10',      multiplier: 10,  weight: 6  },
      { label: '×25',      multiplier: 25,  weight: 3  },
      { label: '×100',     multiplier: 100, weight: 1  },
    ],
  },
];

async function main() {
  // ── 平台账户 ──
  await prisma.pointsAccount.upsert({
    where: { ownerId: 'PLATFORM' },
    update: {},
    create: { ownerType: 'PLATFORM', ownerId: 'PLATFORM', balance: 100_000_000 },
  });
  console.log('[seed] 平台账户 ✔');

  // ── 管理员账号 ──
  const ADMIN_USERNAME = 'admin';
  const ADMIN_PASSWORD = 'Admin@123456';
  const existing = await prisma.user.findUnique({ where: { username: ADMIN_USERNAME } });
  if (!existing) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const uid  = `UID${Date.now()}`;
    const admin = await prisma.user.create({
      data: {
        uid,
        username: ADMIN_USERNAME,
        nickname: '超级管理员',
        passwordHash: hash,
        role: 'ADMIN',
        status: 'ACTIVE',
        agentPath: '/',
        depth: 0,
      },
    });
    await prisma.pointsAccount.create({
      data: { ownerType: 'PLAYER', ownerId: admin.id, balance: 0 },
    });
    console.log(`[seed] 管理员账号: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}  ✔`);
  } else {
    // 确保 role 是 ADMIN
    if (existing.role !== 'ADMIN') {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } });
    }
    console.log('[seed] 管理员账号已存在，跳过创建 ✔');
  }

  // ── 代理等级 ──
  for (let i = 0; i < AGENT_LEVELS.length; i++) {
    const lv = AGENT_LEVELS[i];
    await prisma.agentLevel.upsert({
      where: { code: lv.code },
      update: { ...lv, sortOrder: i },
      create: { ...lv, sortOrder: i },
    });
  }
  console.log('[seed] 代理等级 V1-V5 ✔');

  // ── 游戏目录 + 配置 ──
  for (const g of GAMES) {
    const { payTable, rtp, ...gameData } = g;
    const game = await prisma.game.upsert({
      where: { code: g.code },
      update: { status: g.status },
      create: gameData,
    });
    const existing = await prisma.gameConfig.findFirst({ where: { gameId: game.id, active: true } });
    if (!existing) {
      await prisma.gameConfig.create({
        data: { gameId: game.id, version: 1, active: true, rtp, payTable },
      });
    }
    console.log(`[seed] 游戏: ${g.name} ✔`);
  }

  console.log('\n[seed] 全部完成 🎉');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
