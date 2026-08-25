/**
 * 开发环境：清空业务数据，保留管理员 / 游戏目录 / 代理等级 / 活动 / 平台账户。
 * 运行：WIPE_CONFIRM=<库名> pnpm --filter @gamebox/server exec ts-node prisma/wipe-business-data.ts
 *
 * 不会重新 seed 演示房间，清完后房间列表为空，便于从头验收。
 *
 * 会 TRUNCATE 全部业务表并删除所有非管理员用户，误跑一次不可恢复，因此有三重闸门：
 * 拒绝 NODE_ENV=production、库名必须手敲对上、动手前先打印目标库。
 */
import { PrismaClient } from '@prisma/client';
import { writePlatformOpeningLedger } from './platform-opening';

const prisma = new PrismaClient();

/**
 * 校验目标库并返回它的标识。
 * 库名取自连接本身（current_database）而非 DATABASE_URL：
 * Prisma 是自己读 .env 的，脚本进程里 process.env.DATABASE_URL 通常是空的。
 */
async function assertWipeTarget(): Promise<string> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('拒绝执行：NODE_ENV=production，生产库不允许清空。');
  }

  const [target] = await prisma.$queryRawUnsafe<
    { db: string; host: string | null; port: number | null }[]
  >(`SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port`);
  if (!target?.db) throw new Error('拒绝执行：无法确认目标数据库。');

  const where = `${target.host ?? 'local'}:${target.port ?? '-'}/${target.db}`;
  const confirm = (process.env.WIPE_CONFIRM || '').trim();
  if (confirm !== target.db) {
    throw new Error(
      `拒绝执行：即将清空 ${where}，需要显式确认库名。\n` +
        `  正确写法：WIPE_CONFIRM=${target.db} <原命令>\n` +
        `  当前 WIPE_CONFIRM=${confirm ? `"${confirm}"` : '(未传)'}`,
    );
  }
  return where;
}

async function main() {
  const where = await assertWipeTarget();
  console.log(`[wipe] 目标库 ${where}`);
  console.log('[wipe] 开始清空业务数据…');

  /* 大批量表用 TRUNCATE，避免百万级聊天 deleteMany 卡死 */
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Bet",
      "CommissionRecord",
      "RebateRecord",
      "DailyRebateSettlement",
      "GameRound",
      "SlotFeatureSession",
      "LotteryIssue",
      "RoomChatMessage",
      "RoomMember",
      "RoomOwnerGrant",
      "RoomPlayerHang",
      "GeneralOwnerGrant",
      "RoomGameConfig",
      "ControlPolicy",
      "RoomWeekSettle",
      "GeneralPeriodSettle",
      "Room",
      "RechargeOrder",
      "PointsLedger",
      "PlatformApplyQueue",
      "FundReconRun",
      "PayoutGateRelease",
      "SoftControlAudit",
      /* 这几张没有外键或 Restrict，CASCADE 带不走 */
      "AgentQuotaLedger",
      "CreditIssueDebt",
      "CsWageBill",
      "CommissionDebt",
      "CsStaff",
      "CsDeskSetting",
      "CsDutySpan",
      "CsSlaEvent",
      "CsMessageRequest",
      "CsUpload",
      "RiskEvent",
      "AdminLog",
      "ActivityClaim",
      "CsMessage",
      "Feedback",
      "Agent",
      "AvatarAssignState"
    RESTART IDENTITY CASCADE
  `);
  console.log('[wipe] 房间 / 注单 / 期号 / 聊天 / 代理扩展等已 TRUNCATE');

  /* 自引用：先断开上下级，再删非管理员用户 */
  await prisma.$executeRawUnsafe(`UPDATE "User" SET "parentId" = NULL WHERE role <> 'ADMIN'`);
  const deletedUsers = await prisma.user.deleteMany({ where: { role: { not: 'ADMIN' } } });
  console.log(`[wipe] 已删除非管理员用户 ${deletedUsers.count} 个`);

  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, username: true },
  });
  const keepOwnerIds = ['PLATFORM', ...admins.map((a) => a.id)];

  const deletedAccounts = await prisma.pointsAccount.deleteMany({
    where: { ownerId: { notIn: keepOwnerIds } },
  });
  console.log(`[wipe] 已删除多余积分账户 ${deletedAccounts.count} 个`);

  await prisma.pointsAccount.updateMany({
    where: { ownerId: 'PLATFORM' },
    data: { balance: 100_000_000, frozen: 0 },
  });
  await prisma.pointsAccount.updateMany({
    where: { ownerId: { in: admins.map((a) => a.id) } },
    data: { balance: 0, frozen: 0 },
  });
  await writePlatformOpeningLedger(prisma);

  /* 吊销旧 JWT，强制重新登录 */
  await prisma.user.updateMany({
    where: { role: 'ADMIN' },
    data: { tokenVersion: { increment: 1 } },
  });

  await prisma.rebatePolicy.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      minRate: 0.018,
      maxRate: 0.05,
      totalRate: 0.07,
      playerMinRate: 0.018,
      playerMaxRate: 0.05,
      generalMinRate: 0.018,
      generalDefaultRate: 0.07,
      generalMaxRate: 0.10,
      agentMinRate: 0.018,
      agentDefaultRate: 0.05,
      agentMaxRate: 0.07,
    },
  });

  const rooms = await prisma.room.count();
  const users = await prisma.user.count();
  const games = await prisma.game.count();
  console.log('[wipe] 完成');
  console.log(`  房间=${rooms}  用户=${users}  游戏=${games}`);
  console.log(`  保留管理员: ${admins.map((a) => a.username).join(', ') || '(无)'}`);
  console.log('  请重新登录管理后台后，自行「创建房间」开始验收。');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
