/**
 * 初始化种子数据。运行：pnpm --filter @gamebox/server prisma:seed
 * 内容：
 *   - 平台积分账户(PLATFORM)
 *   - 平台管理员账号(ADMIN)
 *     开发默认密码 Admin@123456；生产必须设置 SEED_ADMIN_PASSWORD（且不得用默认弱口令）
 *   - 代理等级 V1-V5
 *   - 游戏目录 + 各自 active 的 GameConfig（爆率/赔率）
 *
 * 注意：生产勿用弱口令 seed；可用 SKIP_ADMIN_SEED=1 跳过创建管理员。
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { lhcPayTableSeed } from '../src/modules/lottery/games/lhc-odds';
import { sscFfcPayTable } from '../src/modules/lottery/games/ffc.game';
import { kuai3PayTable } from '../src/modules/lottery/games/kuai3.game';
import { bjscPayTable } from '../src/modules/lottery/games/bjsc.game';
import { LOTTERY_INTERVALS } from '../src/modules/lottery/lottery-intervals';
import {
  getTablePayTable,
  BCBM_DEFAULT_AWARD_WEIGHTS,
  FRUIT_DEFAULT_AWARD_WEIGHTS,
} from '@gamebox/shared';

const prisma = new PrismaClient();

/** 牌桌配置展示与 @gamebox/shared 结算单源同形（真结算仍读 shared） */
function tablePaySeed(code: string) {
  return getTablePayTable(code) ?? {};
}

const AGENT_LEVELS = [
  { code: 'V1', name: '青铜代理', minTeamFlow: 0,      commissionRate: 0.005, accent: '#9c8158' },
  { code: 'V2', name: '白银代理', minTeamFlow: 10000,  commissionRate: 0.008, accent: '#c0c0c0' },
  { code: 'V3', name: '黄金代理', minTeamFlow: 50000,  commissionRate: 0.012, accent: '#d4af37' },
  { code: 'V4', name: '铂金代理', minTeamFlow: 200000, commissionRate: 0.016, accent: '#9aa0e8' },
  { code: 'V5', name: '钻石代理', minTeamFlow: 500000, commissionRate: 0.020, accent: '#88e8ff' },
];

/** 彩票赔率唯一来源：各 games/*.game.ts / lhc-odds.ts；seed 只引用，禁止再内联一份。 */
const SSC_FFC_PAY = { ...sscFfcPayTable };
const KUAI3_PAY = { ...kuai3PayTable };
const BJSC_FAMILY_PAY = { ...bjscPayTable };

/** 平台默认限红：单笔 1～100000（后台「游戏管理」可改，引擎实时校验） */
const DEFAULT_MIN_BET = 1;
const DEFAULT_MAX_BET = 100_000;

/** 大厅顺序 1..N（后台用上移/下移调整，勿再手填空洞数字） */
const GAMES = [
  {
    code: 'ffc', name: '1分时时彩', category: 'LOTTERY' as const,
    status: 'ONLINE' as const, sortOrder: 1, drawIntervalSec: LOTTERY_INTERVALS.ffc,
    minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.95,
    payTable: SSC_FFC_PAY,
  },
  // ── 街机类游戏 ──
  {
    code: 'fruit-machine', name: '水果机', category: 'ARCADE' as const,
    status: 'ONLINE' as const, sortOrder: 2, minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.96,
    // 盘面/赔率/大奖权重唯一来源在 @gamebox/shared fruit-machine
    // 引擎按 { ...默认值, ...本表 } 合并，写死一份会覆盖掉标定好的权重
    payTable: { awardWeights: { ...FRUIT_DEFAULT_AWARD_WEIGHTS } },
  },
  // ── 彩票类游戏 ──
  {
    code: 'ssc', name: '快乐时时彩', category: 'LOTTERY' as const,
    status: 'ONLINE' as const, sortOrder: 3, drawIntervalSec: LOTTERY_INTERVALS.ssc,
    minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.95,
    payTable: SSC_FFC_PAY,
  },
  {
    code: 'kuai3', name: '1分快三', category: 'LOTTERY' as const,
    status: 'ONLINE' as const, sortOrder: 4, drawIntervalSec: LOTTERY_INTERVALS.kuai3,
    minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.95,
    payTable: KUAI3_PAY,
  },
  {
    code: 'speed-racing', name: '极速赛车', category: 'LOTTERY' as const,
    status: 'ONLINE' as const, sortOrder: 5, drawIntervalSec: LOTTERY_INTERVALS['speed-racing'],
    minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.95,
    payTable: BJSC_FAMILY_PAY,
  },
  {
    code: 'bjsc', name: '北京赛车', category: 'LOTTERY' as const,
    status: 'ONLINE' as const, sortOrder: 6, drawIntervalSec: LOTTERY_INTERVALS.bjsc,
    minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.95,
    payTable: BJSC_FAMILY_PAY,
  },
  {
    code: 'speed-boat', name: '幸运飞艇', category: 'LOTTERY' as const,
    status: 'ONLINE' as const, sortOrder: 7, drawIntervalSec: LOTTERY_INTERVALS['speed-boat'],
    minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.95,
    payTable: BJSC_FAMILY_PAY,
  },
  {
    code: 'bcbm', name: '奔驰宝马', category: 'ARCADE' as const,
    status: 'ONLINE' as const, sortOrder: 8, minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.95,
    // 盘面/赔率/大奖权重唯一来源在 @gamebox/shared bcbm
    // 早先这里只列了 9 项，fast/uturn/lightning/drift 被默认值静默补入，
    // 且 normal 被压到 78/130，大奖占比过高把 RTP 顶到 200%+
    payTable: { awardWeights: { ...BCBM_DEFAULT_AWARD_WEIGHTS } },
  },
  {
    code: 'lhc', name: '幸运六合彩', category: 'LOTTERY' as const,
    status: 'ONLINE' as const, sortOrder: 9, drawIntervalSec: LOTTERY_INTERVALS.lhc,
    minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.95,
    payTable: lhcPayTableSeed(),
  },
  // ── 棋牌类游戏 ──
  {
    code: 'dragon-tiger', name: '龙虎斗', category: 'TABLE' as const,
    status: 'ONLINE' as const, sortOrder: 10, minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.965,
    payTable: tablePaySeed('dragon-tiger'),
  },
  {
    code: 'baccarat', name: '百家乐', category: 'TABLE' as const,
    status: 'ONLINE' as const, sortOrder: 11, minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.97,
    payTable: tablePaySeed('baccarat'),
  },
  {
    code: 'zhajinhua', name: '炸金花', category: 'TABLE' as const,
    status: 'ONLINE' as const, sortOrder: 12, minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.97,
    payTable: tablePaySeed('zhajinhua'),
  },
  {
    code: 'douniu', name: '斗牛', category: 'TABLE' as const,
    status: 'ONLINE' as const, sortOrder: 13, minBet: DEFAULT_MIN_BET, maxBet: DEFAULT_MAX_BET,
    rtp: 0.97,
    payTable: tablePaySeed('douniu'),
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
  const WEAK_ADMIN_PASSWORD = 'Admin@123456';
  const isProd = (process.env.NODE_ENV ?? 'development') === 'production';
  const skipAdmin = process.env.SKIP_ADMIN_SEED === '1';
  const ADMIN_PASSWORD = (process.env.SEED_ADMIN_PASSWORD || WEAK_ADMIN_PASSWORD).trim();

  if (skipAdmin) {
    console.log('[seed] SKIP_ADMIN_SEED=1，跳过管理员账号');
  } else {
    if (isProd && (!process.env.SEED_ADMIN_PASSWORD || ADMIN_PASSWORD === WEAK_ADMIN_PASSWORD)) {
      throw new Error(
        '[seed] 生产环境禁止使用默认弱口令创建管理员。请设置 SEED_ADMIN_PASSWORD，或 SKIP_ADMIN_SEED=1',
      );
    }
    const existing = await prisma.user.findUnique({ where: { username: ADMIN_USERNAME } });
    if (!existing) {
      const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
      const uid = `UID${Date.now()}`;
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
      console.log(`[seed] 管理员账号: ${ADMIN_USERNAME} / (密码见 SEED_ADMIN_PASSWORD 或开发默认)  ✔`);
    } else {
      if (existing.role !== 'ADMIN') {
        await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } });
      }
      console.log('[seed] 管理员账号已存在，跳过创建 ✔');
    }
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
      update: {
        status: g.status,
        name: g.name,
        sortOrder: g.sortOrder,
        minBet: g.minBet,
        maxBet: g.maxBet,
        ...(typeof g.drawIntervalSec === 'number' ? { drawIntervalSec: g.drawIntervalSec } : {}),
      },
      create: gameData,
    });
    const existing = await prisma.gameConfig.findFirst({ where: { gameId: game.id, active: true } });
    if (!existing) {
      await prisma.gameConfig.create({
        data: { gameId: game.id, version: 1, active: true, rtp, payTable },
      });
    } else if (
      g.code === 'bcbm' ||
      g.code === 'fruit-machine' ||
      g.category === 'LOTTERY'
    ) {
      // 对齐 shared 标定的赔率/大奖权重（水果机、奔驰宝马、彩票）
      await prisma.gameConfig.update({
        where: { id: existing.id },
        data: { rtp, payTable },
      });
    }
    console.log(`[seed] 游戏: ${g.name} ✔`);
  }

  // ── 活动配置 ──
  const ACTIVITIES = [
    {
      code: 'newbie_gift',
      type: 'NEWBIE' as const,
      title: '新人注册礼 · 领 100 分',
      status: 'ONLINE',
      config: { reward: 100, expiresHours: 72 },
    },
    {
      code: 'first_deposit',
      type: 'FIRST_DEPOSIT' as const,
      title: '首充豪礼',
      status: 'ONLINE',
      config: {
        tiers: [
          { minDeposit: 100,    reward: 20   },
          { minDeposit: 500,    reward: 80   },
          { minDeposit: 1000,   reward: 200  },
          { minDeposit: 5000,   reward: 800  },
          { minDeposit: 10000,  reward: 2000 },
        ],
      },
    },
    {
      code: 'vip_gift',
      type: 'VIP' as const,
      title: 'VIP 充值礼包',
      status: 'ONLINE',
      config: {
        tiers: [
          { minDeposit: 1000,   reward: 100  },
          { minDeposit: 5000,   reward: 500  },
          { minDeposit: 20000,  reward: 2000 },
          { minDeposit: 100000, reward: 10000 },
        ],
      },
    },
  ];

  for (const act of ACTIVITIES) {
    await prisma.activity.upsert({
      where: { code: act.code },
      update: { status: act.status, config: act.config },
      create: act,
    });
    console.log(`[seed] 活动: ${act.title} ✔`);
  }

  // ── 代理房间（房间号 = 推广码，玩家登录后输入进入）──
  const ROOMS = [
    { roomNo: '628391', name: '黄金一号厅' },
    { roomNo: '739402', name: '紫钻贵宾室' },
    { roomNo: '184056', name: '夜场专属' },
    { roomNo: '291847', name: '财神殿' },
    { roomNo: '506318', name: '欢乐颂' },
  ];
  for (const r of ROOMS) {
    await prisma.room.upsert({
      where: { roomNo: r.roomNo },
      update: { name: r.name, status: 'OPEN', icon: '/images/rooms/default-room.png' },
      create: {
        roomNo: r.roomNo,
        name: r.name,
        status: 'OPEN',
        icon: '/images/rooms/default-room.png',
        enabledGames: '[]',
      },
    });
    console.log(`[seed] 房间: ${r.name} (${r.roomNo}) ✔`);
  }

  console.log('\n[seed] 全部完成 🎉');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
