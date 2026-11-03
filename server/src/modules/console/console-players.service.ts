import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { asMoney, roundMoney, validateOpsPassword, validatePassword } from '@gamebox/shared';
import * as bcrypt from 'bcrypt';
import { PASSWORD_SALT_ROUNDS } from '../../common/security.constants';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { isPrivateOrLocalIp } from '../../common/utils/client-ip';
import { AdminLogService } from '../admin/admin-log.service';
import { HangService } from '../agents/hang.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import { rethrowUserUniqueConflict, throwUsernameTaken } from '../../common/utils/user-unique';
import { pickAvatarUniqueInTx } from '../users/avatar-assign';
import { adjustCashDiskInTx, assertFundOrderNo } from './player-fund.helper';
import {
  consumeCreditIssueDebtInTx,
  platformGeneralDebtFilter,
  recordCreditIssueDebtInTx,
} from './credit-issue-debt.helper';
import { PointsService } from '../points/points.service';
import {
  agentDisplayBalance,
  agentFlyAvailable,
  agentWorkingDisk,
  sumAgentCsBalancesMap,
  sumAgentRoomPlayerBalancesMap,
} from './credit-settle.helper';
import { quotaSummaryScopeSql, sumAdminLogAmountsByAction } from './admin-log-sum.helper';
import {
  clampPlayerRateToBand,
  pctLabel,
  readPlatformBounds,
  resolveDownlineFlowRate,
  resolvePlayerBand,
} from '../rebate/rebate-chain';
import { normalizeSettleCycle, shanghaiSettleBounds } from './room-settle.service';
import { hasOpenRoomSome, OPEN_ROOM_WHERE } from './open-room.where';
import {
  GENERAL_SHARE_SCHEDULE_SELECT,
  materializeShareSchedule,
  overflowShareRoomsMessage,
  parseGeneralShareRate,
  publicGeneralShareView,
  roomAgentShareCeiling,
  ROOM_AGENT_SHARE_SCHEDULE_SELECT,
  scheduleFromAgent,
} from './general-share-rate.helper';

const csDutyKey = (agentUserId: string) => `gamebox:cs-duty:${agentUserId}`;

function genProxyPassword() {
  return `Px${randomBytes(4).toString('hex')}9`;
}

@Injectable()
export class ConsolePlayersService {
  constructor(
    private prisma: PrismaService,
    private scope: ConsoleScopeService,
    private adminLog: AdminLogService,
    private redis: RedisService,
    private hangService: HangService,
    private points: PointsService,
  ) {}

  async list(
    actor: ConsoleActor,
    opts: {
      page?: number;
      pageSize?: number;
      q?: string;
      roomId?: string;
      /** positive=持分>0；zero=持分严格为 0（含无账户；不含负数） */
      points?: string;
    } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    if (opts.roomId) await this.scope.assertRoomAccess(actor, opts.roomId);

    let baseWhere = await this.scope.playerWhere(actor);
    if (opts.roomId) {
      const members = await this.prisma.roomMember.findMany({
        where: { roomId: opts.roomId, status: 'APPROVED' },
        select: { playerId: true },
      });
      baseWhere = {
        role: 'PLAYER',
        id: { in: members.map((m) => m.playerId) },
      };
    }
    if (opts.q?.trim()) {
      const q = opts.q.trim();
      baseWhere = {
        AND: [
          baseWhere,
          {
            OR: [
              { uid: { contains: q } },
              { nickname: { contains: q } },
              { username: { contains: q.toLowerCase() } },
            ],
          },
        ],
      };
    }

    const pointsFilter = (opts.points || '').trim().toLowerCase();
    if (pointsFilter === 'positive' || pointsFilter === 'zero') {
      const scopeIds = (
        await this.prisma.user.findMany({
          where: baseWhere,
          select: { id: true },
        })
      ).map((u) => u.id);
      const listRoomId = String(opts.roomId || '').trim();
      const accs = scopeIds.length
        ? await this.prisma.pointsAccount.findMany({
            where: {
              ownerType: 'PLAYER',
              ownerId: { in: scopeIds },
              ...(listRoomId ? { roomId: listRoomId } : {}),
            },
            select: { ownerId: true, balance: true },
          })
        : [];
      const balMap = new Map<string, number>();
      for (const a of accs) {
        balMap.set(a.ownerId, (balMap.get(a.ownerId) ?? 0) + asMoney(a.balance));
      }
      const filtered =
        pointsFilter === 'positive'
          ? scopeIds.filter((id) => (balMap.get(id) ?? 0) > 0)
          : scopeIds.filter((id) => (balMap.get(id) ?? 0) === 0);
      baseWhere = {
        AND: [baseWhere, { id: { in: filtered.length ? filtered : ['__none__'] } }],
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where: baseWhere }),
      this.prisma.user.findMany({
        where: baseWhere,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          uid: true,
          username: true,
          nickname: true,
          status: true,
          loginLockedAt: true,
          parentId: true,
          createdAt: true,
          lastLoginIp: true,
          lastLoginAt: true,
        },
      }),
    ]);

    const ids = rows.map((r) => r.id);
    const listRoomId = String(opts.roomId || '').trim();
    let defaultRebateRate = 0.018;
    try {
      const rootId = await this.scope.scopeRootUserId(actor);
      const ag = await this.prisma.agent.findUnique({
        where: { userId: rootId },
        select: { rebateRate: true },
      });
      if (ag) defaultRebateRate = asMoney(ag.rebateRate);
    } catch {
      /* ADMIN 等无根代理时用默认 */
    }

    const roomHangs = listRoomId && ids.length
      ? await this.prisma.roomPlayerHang.findMany({
          where: { roomId: listRoomId, playerId: { in: ids } },
          select: { playerId: true, parentId: true },
        })
      : [];
    const hangParentByPlayer = new Map(roomHangs.map((h) => [h.playerId, h.parentId]));
    const parentIds = listRoomId
      ? [...new Set(roomHangs.map((h) => h.parentId))]
      : ([...new Set(rows.map((r) => r.parentId).filter(Boolean))] as string[]);

    const [accs, memberRows, parents, childGroups] = await Promise.all([
      this.prisma.pointsAccount.findMany({
        where: {
          ownerId: { in: ids },
          ownerType: 'PLAYER',
          ...(listRoomId ? { roomId: listRoomId } : {}),
        },
        select: { ownerId: true, balance: true },
      }),
      ids.length
        ? this.prisma.roomMember.findMany({
            where: {
              playerId: { in: ids },
              status: 'APPROVED',
              ...(listRoomId ? { roomId: listRoomId } : {}),
            },
            select: {
              playerId: true,
              flyEnabled: true,
              playerRebateRate: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: 'desc' },
          })
        : Promise.resolve([]),
      parentIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: parentIds } },
            select: { id: true, uid: true, nickname: true, username: true },
          })
        : Promise.resolve([]),
      ids.length
        ? listRoomId
          ? this.prisma.roomPlayerHang.groupBy({
              by: ['parentId'],
              where: { roomId: listRoomId, parentId: { in: ids } },
              _count: { _all: true },
            })
          : this.prisma.user.groupBy({
              by: ['parentId'],
              where: { parentId: { in: ids } },
              _count: { _all: true },
            })
        : Promise.resolve([]),
    ]);
    const balMap = new Map<string, number>();
    for (const a of accs) {
      balMap.set(a.ownerId, (balMap.get(a.ownerId) ?? 0) + asMoney(a.balance));
    }
    const parentMap = new Map(parents.map((p) => [p.id, p]));
    const childCountMap = new Map(
      childGroups.map((g) => [g.parentId as string, g._count._all]),
    );
    const memberMap = new Map<string, { flyEnabled: boolean; playerRebateRate: number | null }>();
    for (const m of memberRows) {
      if (memberMap.has(m.playerId)) continue;
      memberMap.set(m.playerId, {
        flyEnabled: m.flyEnabled,
        playerRebateRate: m.playerRebateRate,
      });
    }

    return {
      total,
      page,
      pageSize,
      list: rows.map((r) => {
        const mem = memberMap.get(r.id);
        const parentId = listRoomId
          ? hangParentByPlayer.get(r.id) ?? null
          : r.parentId;
        const parent = parentId ? parentMap.get(parentId) ?? null : null;
        const playerRebateRate = mem?.playerRebateRate ?? null;
        return {
          ...r,
          parentId,
          loginLocked: !!r.loginLockedAt,
          balance: balMap.get(r.id) ?? 0,
          flyEnabled: mem?.flyEnabled ?? true,
          playerRebateRate,
          rebateRate: playerRebateRate ?? defaultRebateRate,
          childCount: childCountMap.get(r.id) ?? 0,
          parent: parent
            ? {
                id: parent.id,
                uid: parent.uid,
                nickname: parent.nickname,
                username: parent.username,
              }
            : null,
        };
      }),
    };
  }

  /**
   * 玩家画像：资金口径 + 风险 + 游戏偏好，只给管理与总监。
   *
   * 全部按「全历史累计」算，且每次只算一个人——这几项都要扫 Bet / PointsLedger，
   * 放进列表里一页二十个人就是二十次全表聚合，注单上量后那一页必炸。
   */
  async getPlayerProfile(actor: ConsoleActor, playerId: string, roomId?: string) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅管理与总监可查看玩家画像');
    }
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, playerId);

    const user = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        uid: true,
        username: true,
        nickname: true,
        status: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
        lastLoginIp: true,
      },
    });
    if (!user || user.role !== 'PLAYER') throw new NotFoundException('玩家不存在');

    /*
     * 一个人可能同时在几间房，钱和注单都是按房分开的。
     * 不选房就看合计；选了房只算那一间，免得 A 房赢 B 房输被合并成「打平」。
     */
    const scopeRoomId = String(roomId || '').trim();
    if (scopeRoomId) {
      const inRoom = await this.prisma.roomMember.count({
        where: { playerId, roomId: scopeRoomId, status: 'APPROVED' },
      });
      if (!inRoom) throw new BadRequestException('该玩家不在这间房');
    }
    const acctRoomFilter = scopeRoomId
      ? Prisma.sql`AND a."roomId" = ${scopeRoomId}`
      : Prisma.empty;
    const betRoomFilter = scopeRoomId
      ? Prisma.sql`AND NULLIF(b.payload->'fly'->>'roomId', '') = ${scopeRoomId}`
      : Prisma.empty;

    const [members, accounts, fundRow, betRows, gameRows, alerts, biases] = await Promise.all([
      this.prisma.roomMember.findMany({
        where: { playerId, status: 'APPROVED' },
        select: {
          roomId: true,
          room: {
            select: {
              roomNo: true,
              name: true,
              bookMode: true,
              ownerAgent: { select: { user: { select: { nickname: true, username: true } } } },
            },
          },
        },
      }),
      this.prisma.pointsAccount.findMany({
        where: { ownerType: 'PLAYER', ownerId: playerId },
        select: { roomId: true, balance: true },
      }),
      /* 上下分口径与报表、结账单同一把尺：只认玩家房账上的转入转出 */
      this.prisma.$queryRaw<Array<{ up_amt: unknown; down_amt: unknown }>>`
        SELECT
          COALESCE(SUM(CASE
            WHEN l.amount > 0 AND l."bizType" IN ('TRANSFER_IN', 'RECHARGE') THEN l.amount
            ELSE 0 END), 0) AS up_amt,
          COALESCE(SUM(CASE
            WHEN l.amount < 0 AND l."bizType" IN ('TRANSFER_OUT', 'WITHDRAW') THEN -l.amount
            ELSE 0 END), 0) AS down_amt
        FROM "PointsLedger" l
        JOIN "PointsAccount" a ON a.id = l."accountId"
        WHERE a."ownerType" = 'PLAYER' AND a."ownerId" = ${playerId}
          ${acctRoomFilter}
      `,
      this.prisma.$queryRaw<Array<{ status: string; amt: unknown; pay: unknown }>>`
        SELECT
          b.status::text AS status,
          COALESCE(SUM(b.amount), 0) AS amt,
          COALESCE(SUM(b.payout), 0) AS pay
        FROM "Bet" b
        WHERE b."playerId" = ${playerId}
          AND b.status::text IN ('WON', 'LOST')
          ${betRoomFilter}
        GROUP BY b.status
      `,
      this.prisma.$queryRaw<Array<{ game_id: string; amt: unknown; cnt: number }>>`
        SELECT
          b."gameId" AS game_id,
          COALESCE(SUM(b.amount), 0) AS amt,
          COUNT(*)::int AS cnt
        FROM "Bet" b
        WHERE b."playerId" = ${playerId}
          AND b.status::text IN ('WON', 'LOST', 'PENDING')
          ${betRoomFilter}
        GROUP BY b."gameId"
      `,
      this.prisma.riskEvent.findMany({
        where: { targetId: playerId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, type: true, level: true, handled: true, detail: true, createdAt: true },
      }),
      this.prisma.globalSoftBias.findMany({
        where: { playerId, kind: { in: ['PLAYER_WIN', 'PLAYER_LOSE'] } },
        orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        select: {
          id: true,
          kind: true,
          enabled: true,
          goalAmount: true,
          progressAmount: true,
          createdAt: true,
          room: { select: { roomNo: true, name: true } },
        },
      }),
    ]);

    const balByRoom = new Map(accounts.map((a) => [a.roomId, asMoney(a.balance)]));
    const rooms = members.map((m) => ({
      roomId: m.roomId,
      roomNo: m.room.roomNo,
      name: m.room.name,
      bookMode: m.room.bookMode,
      agentNickname: m.room.ownerAgent?.user.nickname ?? null,
      agentUsername: m.room.ownerAgent?.user.username ?? null,
      balance: balByRoom.get(m.roomId) ?? 0,
    }));
    /* 玩家持分按房隔离；选了房只报那一间，不选才给合计 */
    const totalBalance = roundMoney(
      accounts
        .filter((a) => !scopeRoomId || a.roomId === scopeRoomId)
        .reduce((s, a) => s + asMoney(a.balance), 0),
    );

    const upAmount = asMoney(fundRow[0]?.up_amt ?? 0);
    const downAmount = asMoney(fundRow[0]?.down_amt ?? 0);
    const won = betRows.find((r) => r.status === 'WON');
    const lost = betRows.find((r) => r.status === 'LOST');
    const totalBet = roundMoney(
      betRows.reduce((s, r) => s + asMoney(r.amt ?? 0), 0),
    );
    /* 中奖赢取取派彩，含本金，与结账单「派彩」同一口径 */
    const winAmount = asMoney(won?.pay ?? 0);
    const loseAmount = asMoney(lost?.amt ?? 0);

    const gameIds = gameRows.map((g) => g.game_id);
    const games = gameIds.length
      ? await this.prisma.game.findMany({
          where: { id: { in: gameIds } },
          select: { id: true, code: true, name: true, category: true },
        })
      : [];
    const gameMap = new Map(games.map((g) => [g.id, g]));
    const prefTotal = roundMoney(
      gameRows.reduce((s, g) => s + asMoney(g.amt ?? 0), 0),
    );
    const preferences = gameRows
      .map((g) => {
        const meta = gameMap.get(g.game_id);
        const amount = asMoney(g.amt ?? 0);
        return {
          gameCode: meta?.code ?? g.game_id,
          name: meta?.name ?? g.game_id,
          category: meta?.category ?? null,
          amount,
          betCount: Number(g.cnt) || 0,
          pct: prefTotal > 0 ? Math.round((amount / prefTotal) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);

    /* 同 IP 同伙：登录 IP 相同的其他玩家号，内网/本机地址不算 */
    const ip = String(user.lastLoginIp || '').trim();
    const sameIp = ip && !isPrivateOrLocalIp(ip)
      ? await this.prisma.user.findMany({
          where: { role: 'PLAYER', lastLoginIp: ip, id: { not: playerId } },
          select: { id: true, uid: true, nickname: true, username: true, lastLoginAt: true },
          take: 20,
        })
      : [];

    return {
      member: {
        id: user.id,
        uid: user.uid,
        username: user.username,
        nickname: user.nickname,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        lastLoginIp: user.lastLoginIp ?? null,
        totalBalance,
        rooms,
      },
      /** 空串=全部房间合计；否则下面的资金与偏好都只算这一间 */
      scopeRoomId,
      funds: {
        /** 累计充值＝累计上分毛额，不扣下分：扣了 RIP 的分母就成了净带入，看不出输赢 */
        upAmount,
        downAmount,
        totalBet,
        winAmount,
        loseAmount,
        /** 累计下分 ÷ 累计上分；<100% 是输，>100% 是赢。上分为 0 时给 null，前端显示「—」 */
        rip: upAmount > 0 ? Math.round((downAmount / upAmount) * 1000) / 10 : null,
      },
      risk: {
        alerts: alerts.map((a) => ({
          id: a.id,
          type: a.type,
          level: a.level,
          handled: a.handled,
          summary: String((a.detail as { summary?: string } | null)?.summary ?? ''),
          createdAt: a.createdAt.toISOString(),
        })),
        sameIpAccounts: sameIp.map((u) => ({
          id: u.id,
          uid: u.uid,
          nickname: u.nickname,
          username: u.username,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        })),
        softBias: biases.map((b) => ({
          id: b.id,
          kind: b.kind,
          enabled: b.enabled,
          goalAmount: asMoney(b.goalAmount ?? 0),
          progressAmount: asMoney(b.progressAmount ?? 0),
          roomNo: b.room?.roomNo ?? null,
          roomName: b.room?.name ?? null,
          createdAt: b.createdAt.toISOString(),
        })),
      },
      preferences,
    };
  }

  /** 玩家详情：资料 + 上级 + 直属下级 + 本房飞盘/回水 */
  async getPlayerDetail(actor: ConsoleActor, playerId: string, roomId?: string) {
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, playerId);
    const user = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        uid: true,
        username: true,
        nickname: true,
        status: true,
        parentId: true,
        createdAt: true,
        lastLoginAt: true,
        lastLoginIp: true,
        role: true,
      },
    });
    if (!user || user.role !== 'PLAYER') {
      throw new NotFoundException('玩家不存在');
    }

    const detailRoomId = String(roomId || '').trim();
    const roomHang = detailRoomId
      ? await this.prisma.roomPlayerHang.findUnique({
          where: { roomId_playerId: { roomId: detailRoomId, playerId } },
          select: { parentId: true },
        })
      : null;
    const effectiveParentId = detailRoomId
      ? roomHang?.parentId ?? null
      : user.parentId;

    const [parent, children, member] = await Promise.all([
      effectiveParentId
        ? this.prisma.user.findUnique({
            where: { id: effectiveParentId },
            select: { id: true, uid: true, nickname: true, username: true, role: true },
          })
        : Promise.resolve(null),
      detailRoomId
        ? this.prisma.roomPlayerHang.findMany({
            where: { roomId: detailRoomId, parentId: playerId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              player: {
                select: {
                  id: true, uid: true, nickname: true, username: true, status: true, createdAt: true,
                },
              },
            },
          }).then((rows) => rows.map((r) => r.player))
        : this.prisma.user.findMany({
            where: { parentId: playerId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true, uid: true, nickname: true, username: true, status: true, createdAt: true,
            },
          }),
      this.prisma.roomMember.findFirst({
        where: {
          playerId,
          status: 'APPROVED',
          ...(detailRoomId ? { roomId: detailRoomId } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          roomId: true,
          flyEnabled: true,
          playerRebateRate: true,
          room: { select: { id: true, roomNo: true, name: true } },
        },
      }),
    ]);

    const balRoomId = roomId || member?.roomId;
    const acc = balRoomId
      ? await this.prisma.pointsAccount.findFirst({
          where: { ownerType: 'PLAYER', ownerId: playerId, roomId: balRoomId },
          select: { balance: true },
        })
      : await this.prisma.pointsAccount.findFirst({
          where: { ownerType: 'PLAYER', ownerId: playerId },
          select: { balance: true },
          orderBy: { updatedAt: 'desc' },
        });

    const childIds = children.map((c) => c.id);
    const childAccs = childIds.length
      ? await this.prisma.pointsAccount.findMany({
          where: {
            ownerId: { in: childIds },
            ownerType: 'PLAYER',
            ...(balRoomId ? { roomId: balRoomId } : {}),
          },
          select: { ownerId: true, balance: true },
        })
      : [];
    const childBal = new Map(childAccs.map((a) => [a.ownerId, asMoney(a.balance)]));

    return {
      id: user.id,
      uid: user.uid,
      username: user.username,
      nickname: user.nickname,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp,
      balance: asMoney(acc?.balance ?? 0),
      flyEnabled: member?.flyEnabled ?? true,
      playerRebateRate: member?.playerRebateRate ?? null,
      roomId: member?.roomId ?? null,
      room: member?.room
        ? { id: member.room.id, roomNo: member.room.roomNo, name: member.room.name }
        : null,
      parent: parent
        ? {
            id: parent.id,
            uid: parent.uid,
            nickname: parent.nickname,
            username: parent.username,
            role: parent.role,
          }
        : null,
      children: children.map((c) => ({
        ...c,
        balance: childBal.get(c.id) ?? 0,
      })),
      childCount: children.length,
    };
  }

  /**
   * 控制台挂靠：本房把 friendUid 挂到 underUid（推荐人）名下。
   * 仅房间主代理可操作；规则与 POST /agent/hang 一致（按房隔离）。
   */
  async hangPlayer(
    actor: ConsoleActor,
    friendUid: string,
    underUid: string,
    roomId?: string,
  ) {
    if (actor.role !== 'AGENT') {
      throw new ForbiddenException('仅代理可操作挂靠');
    }
    const result = await this.hangService.hang(actor.id, friendUid, underUid, roomId);
    await this.adminLog.log(actor.id, 'PLAYER_HANG', underUid, {
      friendUid: friendUid.trim(),
      underUid: underUid.trim(),
      roomId: result.roomId,
      message: result.message,
    });
    return result;
  }

  async setStatus(actor: ConsoleActor, userId: string, status: 'ACTIVE' | 'DISABLED') {
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, userId);
    const before = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    /* 注销是玩家自己发起且已清个人信息，后台不能再把它启用回来 */
    if (before?.status === 'CLOSED') {
      throw new BadRequestException('该账号已注销，不能再改状态');
    }
    const u = await this.prisma.user.update({
      where: { id: userId },
      data: {
        status,
        ...(status === 'DISABLED' ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: { id: true, status: true, tokenVersion: true },
    });
    await this.adminLog.log(actor.id, 'USER_STATUS', userId, { status });
    return u;
  }

  /** 单玩家飞盘开关：仅主代理（管理员/房主/子账号不可改） */
  async setPlayerFly(
    actor: ConsoleActor,
    playerId: string,
    flyEnabled: boolean,
    roomId?: string,
  ) {
    if (actor.role !== 'AGENT') {
      throw new ForbiddenException('仅房间主代理可调整玩家飞盘');
    }
    await this.scope.assertUserInScope(actor, playerId);
    const member = await this.prisma.roomMember.findFirst({
      where: {
        playerId,
        status: 'APPROVED',
        ...(roomId ? { roomId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!member) throw new BadRequestException('玩家未绑定房间');
    await this.scope.assertRoomAccess(actor, member.roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: member.roomId },
      select: { ownerAgent: { select: { userId: true } } },
    });
    if (room?.ownerAgent?.userId !== actor.id) {
      throw new ForbiddenException('只能调整自己房间的玩家飞盘');
    }
    const row = await this.prisma.roomMember.update({
      where: { id: member.id },
      data: { flyEnabled },
    });
    await this.adminLog.log(actor.id, 'PLAYER_FLY', playerId, { flyEnabled, roomId: member.roomId });
    return row;
  }

  /** 单玩家回水比例 P */
  async setPlayerRebateRate(
    actor: ConsoleActor,
    playerId: string,
    rate: number,
    roomId?: string,
  ) {
    if (actor.role !== 'AGENT') {
      throw new ForbiddenException('只有本房代理能改玩家回水');
    }
    await this.scope.assertUserInScope(actor, playerId);
    const member = await this.prisma.roomMember.findFirst({
      where: {
        playerId,
        status: 'APPROVED',
        ...(roomId ? { roomId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        room: {
          select: {
            ownerAgent: { select: { flowRate: true } },
            generalAgent: {
              select: {
                flowRate: true,
                downlineFlowRate: true,
                playerMinRate: true,
                playerMaxRate: true,
              },
            },
          },
        },
      },
    });
    if (!member) throw new BadRequestException('玩家未绑定房间');

    const policy = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    const band = resolvePlayerBand({
      platform: readPlatformBounds(policy),
      general: member.room?.generalAgent,
      agentFlowRate: member.room?.ownerAgent?.flowRate,
    });
    if (rate < band.playerMin - 1e-9 || rate > band.playerMax + 1e-9) {
      throw new BadRequestException(
        `玩家回水须在 ${pctLabel(band.playerMin)}～${pctLabel(band.playerMax)}`,
      );
    }
    const row = await this.prisma.roomMember.update({
      where: { id: member.id },
      data: { playerRebateRate: clampPlayerRateToBand(rate, band) },
    });
    await this.adminLog.log(actor.id, 'PLAYER_REBATE', playerId, { rate, roomId: member.roomId });
    return row;
  }

  /** 修改挂靠佣金率（受益人 agent.commissionRate） */
  async setCommissionRate(actor: ConsoleActor, userId: string, rate: number) {
    if (actor.role !== 'ADMIN') await this.scope.assertUserInScope(actor, userId);
    if (rate < 0 || rate > 0.2) throw new BadRequestException('挂靠比例须在 0~20%');
    const agent = await this.prisma.agent.findUnique({ where: { userId } });
    if (!agent) {
      await this.prisma.agent.create({ data: { userId, commissionRate: rate } });
    } else {
      await this.prisma.agent.update({ where: { userId }, data: { commissionRate: rate } });
    }
    await this.adminLog.log(actor.id, 'COMMISSION_RATE', userId, { rate });
    return { ok: true, userId, rate };
  }

  /** 管辖范围内的房主/代理/代分列表 */
  async listAgents(
    actor: ConsoleActor,
    opts: {
      page?: number;
      pageSize?: number;
      role?: string;
      q?: string;
      /** 仅已绑房代理；ADMIN/BRANCH 默认 true（role=AGENT 或未指定时） */
      boundOnly?: boolean;
    } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    /* 账号树/结算对象按 4000 间房预留（一房一代理 + 子账号余量） */
    const pageSize = Math.min(10_000, Math.max(1, opts.pageSize ?? 20));
    const boundOnly = opts.boundOnly !== false;

    let where: Record<string, unknown>;
    if (actor.role === 'AGENT') {
      /* 代理只看自己名下子账号 */
      where = { role: 'PROXY', parentId: actor.id };
    } else if (await this.scope.isGeneralSide(actor)) {
      const rootId = await this.scope.generalRootId(actor);
      /* 总代及其分身：自己、自己的子账号、名下房间代理及其子账号 */
      const roomIds = (await this.scope.grantedRoomIds(actor)) ?? [];
      if (opts.role === 'AGENT') {
        where = roomIds.length
          ? { role: 'AGENT', agent: { is: hasOpenRoomSome(roomIds) } }
          : { role: 'AGENT', id: { in: ['__none__'] } };
      } else if (opts.role === 'GENERAL') {
        where = { id: rootId, role: 'GENERAL' };
      } else {
        const agentProxy = roomIds.length
          ? [{
              parent: {
                role: 'AGENT' as const,
                agent: { is: hasOpenRoomSome(roomIds) },
              },
            }]
          : [];
        where = {
          role: 'PROXY',
          OR: [
            { parentId: rootId },
            ...agentProxy,
          ],
        };
      }
    } else if (actor.role === 'PROXY') {
      const rootId = await this.scope.scopeRootUserId(actor);
      where = { role: 'PROXY', parentId: rootId };
    } else {
      /* ADMIN / BRANCH：默认已绑房代理；可筛子账号 / 房主 */
      const role = ['BRANCH', 'AGENT', 'PROXY', 'GENERAL'].includes(opts.role || '')
        ? (opts.role as string)
        : 'AGENT';
      if (actor.role === 'BRANCH') {
        /* 总监：总代按总代级授权；房间代理/代理子账号仍只看授权房间 */
        if (role === 'GENERAL') {
          const generalIds = await this.scope.grantedGeneralAgentIds(actor);
          where = {
            role: 'GENERAL',
            agent: { is: { id: { in: generalIds ?? [] } } },
          };
        } else if (role === 'PROXY') {
          const [roomIds, generalIds] = await Promise.all([
            this.scope.grantedRoomIds(actor),
            this.scope.grantedGeneralAgentIds(actor),
          ]);
          const agentProxy = roomIds?.length
            ? [{
                parent: {
                  agent: { is: hasOpenRoomSome(roomIds) },
                },
              }]
            : [];
          where = {
            role: 'PROXY',
            OR: [
              /* 总代分身跟着总代级授权走，未授权的总代连分身也不该露出来 */
              {
                parent: {
                  role: 'GENERAL',
                  agent: { is: { id: { in: generalIds ?? [] } } },
                },
              },
              ...agentProxy,
            ],
          };
        } else {
          const roomIds = await this.scope.grantedRoomIds(actor);
          if (!roomIds?.length) {
            return { total: 0, page, pageSize, list: [] };
          }
          if (role === 'BRANCH') {
            where = { id: actor.id, role: 'BRANCH' };
          } else {
            where = {
              role: 'AGENT',
              agent: { is: hasOpenRoomSome(roomIds) },
            };
          }
        }
      } else if (role === 'AGENT' && boundOnly) {
        where = {
          role: 'AGENT',
          agent: { is: hasOpenRoomSome() },
        };
      } else {
        where = { role };
      }
    }

    if (opts.q?.trim()) {
      const q = opts.q.trim();
      where = {
        AND: [
          where,
          {
            OR: [
              { uid: { contains: q } },
              { nickname: { contains: q } },
              { username: { contains: q.toLowerCase() } },
            ],
          },
        ],
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ role: 'asc' }, { depth: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, uid: true, nickname: true, username: true,
          role: true, depth: true, status: true, parentId: true,
          createdAt: true, lastLoginAt: true,
        },
      }),
    ]);
    const ids = rows.map((r) => r.id);
    const parentIds = [...new Set(rows.map((r) => r.parentId).filter(Boolean))] as string[];
    const agentUserIds = rows.filter((r) => r.role === 'AGENT' || r.role === 'GENERAL').map((r) => r.id);
    /* 子账号额度读主代理：一并加载 parent 的 Agent */
    const agentLookupIds = [...new Set([...ids, ...parentIds])];
    const [accs, agents, parents, agentRows, childGroups, csGroups] = await Promise.all([
      this.prisma.pointsAccount.findMany({
        where: { ownerId: { in: ids } },
        select: { ownerId: true, balance: true },
      }),
      this.prisma.agent.findMany({
        where: { userId: { in: agentLookupIds } },
        select: {
          id: true,
          userId: true,
          commissionRate: true,
          rebateRate: true,
          flowRate: true,
          ...GENERAL_SHARE_SCHEDULE_SELECT,
          pointsQuota: true,
          pointsUsed: true,
          bookMode: true,
          creditLimit: true,
          settleCycle: true,
          downlineFlowRate: true,
          playerMinRate: true,
          playerMaxRate: true,
          roomMonthlyFee: true,
        },
      }),
      parentIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: parentIds } },
            select: { id: true, nickname: true, username: true, role: true },
          })
        : Promise.resolve([]),
      this.prisma.agent.findMany({
        where: { userId: { in: ids } },
        select: { id: true, userId: true },
      }),
      agentUserIds.length
        ? this.prisma.user.groupBy({
            by: ['parentId'],
            where: { parentId: { in: agentUserIds }, role: 'PROXY' },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      agentUserIds.length
        ? this.prisma.user.groupBy({
            by: ['parentId'],
            where: { parentId: { in: agentUserIds }, role: 'CS' },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);
    const agentIdByUser = new Map(agentRows.map((a) => [a.userId, a.id]));
    const agentIds = [...agentIdByUser.values()];
    const childCountByParent = new Map(
      childGroups.map((g) => [g.parentId as string, g._count._all]),
    );
    const csCountByParent = new Map(
      csGroups.map((g) => [g.parentId as string, g._count._all]),
    );
    const grantedIds = actor.role === 'BRANCH' ? await this.scope.grantedRoomIds(actor) : null;
    const rooms = agentIds.length
      ? await this.prisma.room.findMany({
          where: {
            OR: [
              { ownerAgentId: { in: agentIds } },
              { generalAgentId: { in: agentIds } },
            ],
            ...OPEN_ROOM_WHERE,
            ...(grantedIds ? { id: { in: grantedIds.length ? grantedIds : ['__none__'] } } : {}),
          },
          select: {
            id: true, roomNo: true, name: true, status: true, ownerAgentId: true, generalAgentId: true, bookMode: true,
            generalAgent: {
              select: {
                userId: true,
                user: { select: { nickname: true, username: true } },
              },
            },
            _count: { select: { members: { where: { status: 'APPROVED' } } } },
          },
        })
      : [];
    type BoundRoom = {
      id: string
      roomNo: string
      name: string
      status: string
      memberCount: number
      bookMode: string
      generalUserId?: string
      generalNickname?: string
    };
    const roomsByAgentId = new Map<string, BoundRoom[]>();
    const roomsByGeneralId = new Map<string, BoundRoom[]>();
    for (const r of rooms) {
      const item: BoundRoom = {
        id: r.id,
        roomNo: r.roomNo,
        name: r.name,
        status: r.status,
        memberCount: r._count.members,
        bookMode: r.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH',
        generalUserId: r.generalAgent?.userId,
        generalNickname: r.generalAgent?.user?.nickname || r.generalAgent?.user?.username,
      };
      if (r.ownerAgentId) {
        const arr = roomsByAgentId.get(r.ownerAgentId) ?? [];
        arr.push(item);
        roomsByAgentId.set(r.ownerAgentId, arr);
      }
      if (r.generalAgentId) {
        const garr = roomsByGeneralId.get(r.generalAgentId) ?? [];
        garr.push(item);
        roomsByGeneralId.set(r.generalAgentId, garr);
      }
    }

    const balMap = new Map(accs.map((a) => [a.ownerId, asMoney(a.balance)]));
    const agentMap = new Map(agents.map((a) => [a.userId, a]));
    const parentMap = new Map(parents.map((p) => [p.id, p]));

    /* 上盘可飞要算「盘分 + 客服未发出 + 名下房间玩家持分」，批量取后两项 */
    const flyLookupIds = [...new Set([...agentUserIds, ...parentIds])];
    const [csBalMap, playerBalMap] = await Promise.all([
      sumAgentCsBalancesMap(this.prisma, flyLookupIds),
      sumAgentRoomPlayerBalancesMap(this.prisma, flyLookupIds),
    ]);

    /* 代分：展示上级代理绑定的房间 */
    const proxyParentAgentIds = rows
      .filter((r) => r.role === 'PROXY' && r.parentId)
      .map((r) => r.parentId!);
    const parentAgents = proxyParentAgentIds.length
      ? await this.prisma.agent.findMany({
          where: { userId: { in: proxyParentAgentIds } },
          select: { id: true, userId: true },
        })
      : [];
    const parentAgentIdByUser = new Map(parentAgents.map((a) => [a.userId, a.id]));
    const parentAgentIds = [...parentAgentIdByUser.values()];
    const parentRooms = parentAgentIds.length
      ? await this.prisma.room.findMany({
          where: { ownerAgentId: { in: parentAgentIds }, ...OPEN_ROOM_WHERE },
          select: {
            id: true, roomNo: true, name: true, status: true, ownerAgentId: true, bookMode: true,
            _count: { select: { members: { where: { status: 'APPROVED' } } } },
          },
        })
      : [];
    const roomsByParentAgentId = new Map<string, BoundRoom[]>();
    for (const r of parentRooms) {
      if (!r.ownerAgentId) continue;
      const arr = roomsByParentAgentId.get(r.ownerAgentId) ?? [];
      arr.push({
        id: r.id,
        roomNo: r.roomNo,
        name: r.name,
        status: r.status,
        memberCount: r._count.members,
        bookMode: r.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH',
      });
      roomsByParentAgentId.set(r.ownerAgentId, arr);
    }

    const dutyAgentIds = [
      ...new Set([
        ...agentUserIds,
        ...rows.filter((r) => r.role === 'PROXY' && r.parentId).map((r) => r.parentId!),
      ]),
    ];
    const dutyKeys = dutyAgentIds.map((id) => csDutyKey(id));
    const dutyVals = dutyKeys.length
      ? await this.redis.raw.mget(...dutyKeys)
      : [];
    const dutyByAgent = new Map(
      dutyAgentIds.map((id, i) => [id, dutyVals[i] || null]),
    );

    const branchIds = rows.filter((r) => r.role === 'BRANCH').map((r) => r.id);
    const branchGrantGroups = branchIds.length
      ? await this.prisma.roomOwnerGrant.groupBy({
          by: ['ownerId'],
          where: { ownerId: { in: branchIds } },
          _count: { _all: true },
        })
      : [];
    const grantCountByBranch = new Map(
      branchGrantGroups.map((g) => [g.ownerId, g._count._all]),
    );

    return {
      total,
      page,
      pageSize,
      list: rows.map((r) => {
        const ag = agentMap.get(r.id);
        const parent = r.parentId ? parentMap.get(r.parentId) : null;
        let boundRooms: BoundRoom[] = [];
        if (r.role === 'AGENT') {
          const aid = agentIdByUser.get(r.id);
          boundRooms = aid ? (roomsByAgentId.get(aid) ?? []) : [];
        } else if (r.role === 'GENERAL') {
          const aid = agentIdByUser.get(r.id);
          boundRooms = aid ? (roomsByGeneralId.get(aid) ?? []) : [];
        } else if (r.role === 'PROXY' && r.parentId) {
          const paid = parentAgentIdByUser.get(r.parentId);
          boundRooms = paid ? (roomsByParentAgentId.get(paid) ?? []) : [];
        }
        const memberCount = boundRooms.reduce((s, x) => s + x.memberCount, 0);
        const dutyUserId =
          r.role === 'AGENT'
            ? dutyByAgent.get(r.id) ?? null
            : r.role === 'PROXY' && r.parentId
              ? dutyByAgent.get(r.parentId) ?? null
              : null;
        const roomCount =
          r.role === 'BRANCH'
            ? (grantCountByBranch.get(r.id) ?? 0)
            : boundRooms.length;
        /* 子账号与主代理共用额度/飞盘 */
        const quotaAg =
          r.role === 'PROXY' && r.parentId
            ? agentMap.get(r.parentId) ?? ag
            : ag;
        /* 可飞额度挂在主代理身上；子账号看的是同一个数 */
        const flyOwnerId = r.role === 'PROXY' && r.parentId ? r.parentId : r.id;
        const flyQuota = quotaAg ? asMoney(quotaAg.pointsQuota) : 0;
        const flyBal = balMap.get(flyOwnerId) ?? 0;
        const flyDisk = agentWorkingDisk(flyBal, flyQuota);
        const flyCover = roundMoney(
          Math.max(
            0,
            flyDisk + (csBalMap.get(flyOwnerId) ?? 0) + (playerBalMap.get(flyOwnerId) ?? 0),
          ),
        );
        return {
          ...r,
          balance: balMap.get(r.id) ?? 0,
          commissionRate: quotaAg ? asMoney(quotaAg.commissionRate) : 0.002,
          rebateRate: quotaAg ? asMoney(quotaAg.rebateRate) : 0.018,
          flowRate: quotaAg ? Number(quotaAg.flowRate ?? 0.05) : 0.05,
          ...publicGeneralShareView(scheduleFromAgent(quotaAg ?? { shareRate: 0.5 })),
          /* 盘口与合同额度只有总代自己这一层有意义，代理侧不返回免得误读 */
          bookMode: r.role === 'GENERAL' ? (ag?.bookMode ?? 'CASH') : undefined,
          creditLimit: r.role === 'GENERAL' ? asMoney(ag?.creditLimit ?? 0) : undefined,
          settleCycle: r.role === 'GENERAL' ? (ag?.settleCycle ?? 'WEEKLY_MON') : undefined,
          downlineFlowRate: r.role === 'GENERAL' ? Number(ag?.downlineFlowRate ?? ag?.flowRate ?? 0.05) : undefined,
          roomMonthlyFee: r.role === 'GENERAL' ? asMoney(ag?.roomMonthlyFee ?? 0) : undefined,
          playerMinRate: r.role === 'GENERAL' ? ag?.playerMinRate ?? null : undefined,
          playerMaxRate: r.role === 'GENERAL' ? ag?.playerMaxRate ?? null : undefined,
          pointsQuota: r.role === 'BRANCH' ? 0 : quotaAg ? asMoney(quotaAg.pointsQuota) : 0,
          pointsUsed: r.role === 'BRANCH' ? 0 : quotaAg ? asMoney(quotaAg.pointsUsed) : 0,
          agentBalance:
            r.role === 'BRANCH'
              ? (balMap.get(r.id) ?? 0)
              : agentDisplayBalance({
                  bookMode: quotaAg?.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH',
                  balance: flyBal,
                  pointsQuota: flyQuota,
                }),
          unsettledWage: undefined,
          flyCover,
          parent: parent
            ? { id: parent.id, nickname: parent.nickname, username: parent.username, role: parent.role }
            : null,
          rooms: boundRooms,
          roomCount,
          memberCount,
          staffCount: r.role === 'AGENT' || r.role === 'GENERAL'
            ? (childCountByParent.get(r.id) ?? 0)
            : 0,
          csCount: r.role === 'AGENT' ? (csCountByParent.get(r.id) ?? 0) : 0,
          onDuty: r.role === 'PROXY' ? dutyUserId === r.id : false,
          dutyUserId,
        };
      }),
    };
  }

  /** 代理/房主/代分详情 */
  async getAgentDetail(actor: ConsoleActor, userId: string) {
    if (actor.role !== 'ADMIN') {
      await this.scope.assertUserInScope(actor, userId);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, uid: true, username: true, nickname: true,
        role: true, depth: true, status: true, parentId: true,
        createdAt: true, lastLoginAt: true,
      },
    });
    if (!user || !['BRANCH', 'AGENT', 'PROXY', 'GENERAL'].includes(user.role)) {
      throw new BadRequestException('账号不存在');
    }

    const agentRootId =
      user.role === 'PROXY' && user.parentId ? user.parentId : userId;

    const ownerType =
      user.role === 'BRANCH' ? 'BRANCH' : user.role === 'PROXY' ? 'PROXY' : 'AGENT';
    const [acc, agent, parent, children] = await Promise.all([
      this.prisma.pointsAccount.findFirst({
        where: { ownerType: ownerType as never, ownerId: userId, roomId: '' },
        select: { balance: true },
      }),
      /* 子账号额度/飞盘读主代理 */
      this.prisma.agent.findUnique({
        where: { userId: agentRootId },
          select: {
            id: true, commissionRate: true, rebateRate: true,
            pointsQuota: true, pointsUsed: true,
            flowRate: true, ...GENERAL_SHARE_SCHEDULE_SELECT,
            downlineFlowRate: true, playerMinRate: true, playerMaxRate: true,
            bookMode: true, creditLimit: true, settleCycle: true,
            roomMonthlyFee: true,
          },
      }),
      user.parentId
        ? this.prisma.user.findUnique({
            where: { id: user.parentId },
            select: { id: true, nickname: true, username: true, role: true, uid: true },
          })
        : Promise.resolve(null),
      this.prisma.user.findMany({
        where: {
          parentId: user.role === 'PROXY' ? user.parentId! : userId,
          role: 'PROXY',
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, uid: true, username: true, nickname: true,
          role: true, status: true, createdAt: true, lastLoginAt: true,
        },
      }),
    ]);

    type RoomRow = {
      id: string; roomNo: string; name: string; status: string;
      monthlyFee: number; memberCount: number; openGames: number;
    };
    let rooms: RoomRow[] = [];
    let roomTotal = 0;

    if (user.role === 'AGENT' || user.role === 'PROXY' || user.role === 'GENERAL') {
      const ownerAgent = await this.prisma.agent.findUnique({
        where: { userId: agentRootId },
        select: { id: true },
      });
      if (ownerAgent) {
        const grantedIds = actor.role === 'BRANCH' ? await this.scope.grantedRoomIds(actor) : null;
        const rows = await this.prisma.room.findMany({
          where: {
            ...(user.role === 'GENERAL'
              ? { generalAgentId: ownerAgent.id }
              : { ownerAgentId: ownerAgent.id }),
            ...OPEN_ROOM_WHERE,
            ...(grantedIds ? { id: { in: grantedIds.length ? grantedIds : ['__none__'] } } : {}),
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, roomNo: true, name: true, status: true, monthlyFee: true,
            enabledGames: true,
            _count: { select: { members: { where: { status: 'APPROVED' } } } },
          },
        });
        rooms = rows.map((r) => {
          let openGames: number;
          try {
            const g = JSON.parse(String(r.enabledGames || '[]')) as unknown;
            openGames = Array.isArray(g) ? g.length : 0;
          } catch { openGames = 0; }
          return {
            id: r.id,
            roomNo: r.roomNo,
            name: r.name,
            status: r.status,
            monthlyFee: asMoney(r.monthlyFee),
            memberCount: r._count.members,
            openGames,
          };
        });
        roomTotal = rooms.length;
      }
    } else if (user.role === 'BRANCH') {
      /* 与房间「可见房主」一致：只认 RoomOwnerGrant，禁止把全平台房间算给房主 */
      const grants = await this.prisma.roomOwnerGrant.findMany({
        where: { ownerId: userId },
        select: { roomId: true },
      });
      const grantedIds = grants.map((g) => g.roomId);
      if (grantedIds.length) {
        roomTotal = await this.prisma.room.count({
          where: { id: { in: grantedIds }, ...OPEN_ROOM_WHERE },
        });
        const rows = await this.prisma.room.findMany({
          where: { id: { in: grantedIds }, ...OPEN_ROOM_WHERE },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true, roomNo: true, name: true, status: true, monthlyFee: true,
            enabledGames: true,
            _count: { select: { members: { where: { status: 'APPROVED' } } } },
          },
        });
        rooms = rows.map((r) => {
          let openGames: number;
          try {
            const g = JSON.parse(String(r.enabledGames || '[]')) as unknown;
            openGames = Array.isArray(g) ? g.length : 0;
          } catch { openGames = 0; }
          return {
            id: r.id,
            roomNo: r.roomNo,
            name: r.name,
            status: r.status,
            monthlyFee: asMoney(r.monthlyFee),
            memberCount: r._count.members,
            openGames,
          };
        });
      }
    }

    const childIds = children.map((c) => c.id);
    const childAccs = childIds.length
      ? await this.prisma.pointsAccount.findMany({
          where: { ownerId: { in: childIds } },
          select: { ownerId: true, balance: true },
        })
      : [];
    const childBal = new Map(childAccs.map((a) => [a.ownerId, asMoney(a.balance)]));

    const dutyUserId = (await this.redis.get(csDutyKey(agentRootId))) || null;
    /* 代理层不带 bookMode 字段，得按名下房间反推，跟可飞额度用同一个判定 */
    const detailBookMode =
      user.role === 'GENERAL'
        ? agent?.bookMode === 'CREDIT'
          ? 'CREDIT'
          : 'CASH'
        : await this.rootBookMode(agentRootId);
    const recentLogs = await this.prisma.adminLog.findMany({
      where: {
        OR: [
          { operatorId: userId },
          { target: userId },
          ...(childIds.length ? [{ operatorId: { in: childIds } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true, action: true, target: true, createdAt: true, operatorId: true,
      },
    });

    return {
      ...user,
      balance: asMoney(acc?.balance ?? 0),
      commissionRate: agent ? asMoney(agent.commissionRate) : 0.002,
      rebateRate: agent ? asMoney(agent.rebateRate) : 0.018,
      pointsQuota: agent ? asMoney(agent.pointsQuota) : 0,
      pointsUsed: agent ? asMoney(agent.pointsUsed) : 0,
      /*
       * 可飞额度挂在主代理身上：子账号与主代理共用同一份，所以要用 agentRootId。
       * 用子账号自己的 userId 会读到它那行空 Agent，额度显示成 0。
       */
      flyCover: await this.rootFlyAvailable(agentRootId),
      agentBalance: agentDisplayBalance({
        bookMode: detailBookMode,
        balance: asMoney(acc?.balance ?? 0),
        pointsQuota: agent ? asMoney(agent.pointsQuota) : 0,
      }),
      unsettledWage: undefined,
      flowRate: agent ? Number(agent.flowRate ?? 0.07) : undefined,
      ...(agent ? publicGeneralShareView(scheduleFromAgent(agent)) : { shareRate: undefined }),
      bookMode: user.role === 'GENERAL' ? (agent?.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH') : undefined,
      creditLimit: user.role === 'GENERAL' ? asMoney(agent?.creditLimit ?? 0) : undefined,
      settleCycle: user.role === 'GENERAL' ? (agent?.settleCycle ?? 'WEEKLY_MON') : undefined,
      downlineFlowRate: user.role === 'GENERAL' ? (agent?.downlineFlowRate != null ? Number(agent.downlineFlowRate) : undefined) : undefined,
      playerMinRate: user.role === 'GENERAL' ? agent?.playerMinRate ?? null : undefined,
      playerMaxRate: user.role === 'GENERAL' ? agent?.playerMaxRate ?? null : undefined,
      /** 总代每开一间房、每月缴给平台的月费单价 */
      roomMonthlyFee: user.role === 'GENERAL' ? asMoney(agent?.roomMonthlyFee ?? 0) : undefined,
      parent,
      rooms,
      roomTotal,
      dutyUserId,
      agentRootId,
      children: children.map((c) => ({
        ...c,
        balance: childBal.get(c.id) ?? 0,
        onDuty: dutyUserId === c.id,
      })),
      recentLogs,
      permissions: this.rolePermissions(user.role),
    };
  }

  /**
   * 账号资金/操作审计（只读、分页；底层为 PointsLedger + AdminLog，无删除接口）
   * tab=balance 余额流水 | fund 上下分/额度/客服划额 | ops 全部操作
   * fund 支持 from/to、fundType 筛选，并返回筛选后汇总 fundTotals
   */
  async getAgentAudit(
    actor: ConsoleActor,
    userId: string,
    opts: {
      page?: number;
      pageSize?: number;
      tab?: 'balance' | 'fund' | 'ops' | 'wage';
      from?: string;
      to?: string;
      fundType?: string;
    } = {},
  ) {
    if (actor.role === 'CS' && userId !== actor.id) {
      throw new ForbiddenException('客服仅可查看本人流水');
    }
    if (actor.role !== 'ADMIN') {
      await this.scope.assertUserInScope(actor, userId);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, parentId: true, nickname: true, username: true },
    });
    if (!user || !['BRANCH', 'AGENT', 'PROXY', 'CS', 'GENERAL'].includes(user.role)) {
      throw new BadRequestException('账号不存在');
    }

    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const tab = opts.tab ?? 'fund';
    const agentRootId =
      (user.role === 'PROXY' || user.role === 'CS') && user.parentId
        ? user.parentId
        : userId;

    const proxyIds =
      user.role === 'AGENT'
        ? (
            await this.prisma.user.findMany({
              where: { parentId: userId, role: 'PROXY' },
              select: { id: true },
            })
          ).map((p) => p.id)
        : [];
    const csIds =
      user.role === 'AGENT' || user.role === 'PROXY'
        ? (
            await this.prisma.user.findMany({
              where: { parentId: agentRootId, role: 'CS' },
              select: { id: true },
            })
          ).map((c) => c.id)
        : [];
    const staffIds =
      user.role === 'AGENT'
        ? [userId, ...proxyIds]
        : user.role === 'PROXY' || user.role === 'CS'
          ? [userId]
          : [userId];
    const operatorIds =
      user.role === 'CS' ? [userId] : [...new Set([...staffIds, ...csIds])];

    const walletType =
      user.role === 'CS' ? 'CS' : user.role === 'PROXY' ? 'PROXY' : 'AGENT';
    const [acc, agentRow] = await Promise.all([
      this.prisma.pointsAccount.findFirst({
        where: { ownerType: walletType as never, ownerId: userId, roomId: '' },
        select: { id: true, balance: true },
      }),
      this.prisma.agent.findUnique({
        where: { userId: agentRootId },
        select: { pointsQuota: true, pointsUsed: true, bookMode: true },
      }),
    ]);
    const flyCover = await this.rootFlyAvailable(agentRootId);

    const summary = await this.buildAuditSummary({
      userId,
      agentRootId,
      staffIds,
      accountId: acc?.id,
      balance: asMoney(acc?.balance ?? 0),
      pointsQuota: agentRow ? asMoney(agentRow.pointsQuota) : 0,
      pointsUsed: agentRow ? asMoney(agentRow.pointsUsed) : 0,
      flyCover,
      role: user.role,
    });

    if (tab === 'balance' || tab === 'wage') {
      return {
        tab,
        summary,
        ...(await this.listBalanceLedger(
          acc?.id,
          page,
          pageSize,
          tab === 'wage' ? 'wage' : 'all',
          { from: opts.from, to: opts.to },
        )),
      };
    }
    if (tab === 'fund') {
      return {
        tab,
        summary,
        ...(await this.listFundLogs({
          userId,
          agentRootId,
          staffIds,
          operatorIds,
          role: user.role,
          page,
          pageSize,
          from: opts.from,
          to: opts.to,
          fundType: opts.fundType,
        })),
      };
    }
    return {
      tab: 'ops' as const,
      summary,
      ...(await this.listOpsLogs({ userId, staffIds, page, pageSize })),
    };
  }

  /**
   * 主代理的可飞额度。
   *
   * 传进来的必须是**主代理**的 userId（子账号要先解析到 agentRootId）——
   * 额度挂在主代理身上，用子账号自己的 id 会读到它那行空 Agent，显示成 0。
   * 盘种取该代理名下房间的约定：有信用房就按信用算（更保守）。
   */
  private async rootFlyAvailable(agentRootId: string): Promise<number> {
    if (!agentRootId) return 0;
    const bookMode = await this.rootBookMode(agentRootId);
    return agentFlyAvailable(this.prisma, agentRootId, bookMode);
  }

  /** 该主代理对外按哪个盘种展示：名下有信用房就按信用（更保守） */
  private async rootBookMode(agentRootId: string): Promise<'CASH' | 'CREDIT'> {
    if (!agentRootId) return 'CASH';
    const creditRoom = await this.prisma.room.findFirst({
      where: { ownerAgent: { userId: agentRootId }, bookMode: 'CREDIT' },
      select: { id: true },
    });
    return creditRoom ? 'CREDIT' : 'CASH';
  }

  private async buildAuditSummary(p: {
    userId: string;
    agentRootId: string;
    staffIds: string[];
    accountId?: string;
    balance: number;
    pointsQuota: number;
    pointsUsed: number;
    flyCover: number;
    role: string;
  }) {
    /* 房主：统计「他给代理上/回收」；代理：统计「别人给他上/回收」 */
    const [quotaBy, fundBy] = await Promise.all([
      sumAdminLogAmountsByAction(this.prisma, {
        userId: p.userId,
        agentRootId: p.agentRootId,
        staffIds: p.staffIds,
        operatorIds: p.staffIds,
        role: p.role,
        scopeSql: quotaSummaryScopeSql({ userId: p.userId, role: p.role }),
      }),
      sumAdminLogAmountsByAction(this.prisma, {
        userId: p.userId,
        agentRootId: p.agentRootId,
        staffIds: p.staffIds,
        operatorIds: p.staffIds,
        role: p.role,
      }),
    ]);
    const sell = quotaBy.get('QUOTA_SELL') ?? 0;
    const recall = quotaBy.get('QUOTA_RECALL') ?? 0;
    const quotaIn = p.role === 'BRANCH' ? recall : sell;
    const quotaOut = p.role === 'BRANCH' ? sell : recall;
    const playerUp = fundBy.get('CONSOLE_CREDIT') ?? 0;
    const playerDown = fundBy.get('CONSOLE_DEBIT') ?? 0;

    let ledgerIn = 0;
    let ledgerOut = 0;
    if (p.accountId) {
      const [inAgg, outAgg] = await Promise.all([
        this.prisma.pointsLedger.aggregate({
          where: { accountId: p.accountId, amount: { gte: 0 } },
          _sum: { amount: true },
        }),
        this.prisma.pointsLedger.aggregate({
          where: { accountId: p.accountId, amount: { lt: 0 } },
          _sum: { amount: true },
        }),
      ]);
      ledgerIn = asMoney(inAgg._sum.amount);
      ledgerOut = Math.abs(asMoney(outAgg._sum.amount));
    }

    return {
      balance: p.balance,
      pointsQuota: p.pointsQuota,
      pointsUsed: p.pointsUsed,
      flyCover: p.flyCover,
      quotaIn: round2(quotaIn),
      quotaOut: round2(quotaOut),
      playerUp: round2(playerUp),
      playerDown: round2(playerDown),
      ledgerIn: round2(ledgerIn),
      ledgerOut: round2(ledgerOut),
    };
  }

  /** 资金流水列表过滤；合计走 fundLogScopeSql，两边条件必须同步 */
  private fundLogWhere(
    userId: string,
    agentRootId: string,
    staffIds: string[],
    operatorIds: string[],
    role: string,
  ): Record<string, unknown> {
    if (role === 'BRANCH') {
      return {
        OR: [
          { action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] }, target: userId },
          { action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] }, operatorId: userId },
          { action: 'ROOM_CREDIT_LIMIT_BUMP', operatorId: userId },
        ],
      };
    }
    if (role === 'GENERAL') {
      return {
        OR: [
          { action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] }, target: userId },
          { action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] }, operatorId: userId },
          { action: 'GENERAL_CREDIT_LIMIT_BUMP', target: userId },
        ],
      };
    }
    if (role === 'CS') {
      return {
        OR: [
          {
            action: { in: ['CONSOLE_CREDIT', 'CONSOLE_DEBIT'] },
            operatorId: userId,
          },
          {
            action: { in: ['CS_STAFF_ALLOC', 'CS_STAFF_RECALL'] },
            target: userId,
          },
        ],
      };
    }
    return {
      OR: [
        { action: { in: ['QUOTA_SELL', 'QUOTA_RECALL'] }, target: userId },
        {
          action: { in: ['CONSOLE_CREDIT', 'CONSOLE_DEBIT'] },
          OR: [
            { operatorId: { in: operatorIds.length ? operatorIds : staffIds } },
            { detail: { path: ['agentUserId'], equals: agentRootId } },
          ],
        },
        {
          action: { in: ['CS_STAFF_ALLOC', 'CS_STAFF_RECALL'] },
          operatorId: agentRootId,
        },
      ],
    };
  }

  private fundTypeActions(fundType?: string): string[] | null {
    const t = (fundType || 'all').trim().toLowerCase();
    if (!t || t === 'all') return null;
    const map: Record<string, string[]> = {
      quota: ['QUOTA_SELL', 'QUOTA_RECALL', 'GENERAL_CREDIT_LIMIT_BUMP'],
      quota_in: ['QUOTA_SELL'],
      quota_out: ['QUOTA_RECALL'],
      player: ['CONSOLE_CREDIT', 'CONSOLE_DEBIT'],
      player_up: ['CONSOLE_CREDIT'],
      player_down: ['CONSOLE_DEBIT'],
      cs: ['CS_STAFF_ALLOC', 'CS_STAFF_RECALL'],
      cs_alloc: ['CS_STAFF_ALLOC'],
      cs_recall: ['CS_STAFF_RECALL'],
    };
    return map[t] ?? null;
  }

  private parseAuditDate(raw?: string, end = false): Date | null {
    if (!raw?.trim()) return null;
    const d = new Date(raw.trim());
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(end ? '结束时间无效' : '开始时间无效');
    }
    return d;
  }

  private async listBalanceLedger(
    accountId: string | undefined,
    page: number,
    pageSize: number,
    filter: 'all' | 'wage' = 'all',
    window?: { from?: string; to?: string },
  ) {
    if (!accountId) return { total: 0, page, pageSize, list: [] as unknown[] };
    const where: Record<string, unknown> =
      filter === 'wage'
        ? {
            accountId,
            amount: { gt: 0 },
            OR: [
              { remark: { contains: '佣金' } },
              { idempotencyKey: { endsWith: ':WAGE' } },
              { idempotencyKey: { endsWith: ':WAGE_IN' } },
            ],
          }
        : { accountId };
    /* 时间筛选原先只有「上下分」那一页支持，余额和佣金两页只能看全部 */
    const from = this.parseAuditDate(window?.from, false);
    const to = this.parseAuditDate(window?.to, true);
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lt: to } : {}),
      };
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.pointsLedger.count({ where }),
      this.prisma.pointsLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          bizType: true,
          amount: true,
          balanceAfter: true,
          refType: true,
          refId: true,
          remark: true,
          operatorId: true,
          createdAt: true,
        },
      }),
    ]);
    const opIds = [...new Set(rows.map((r) => r.operatorId).filter(Boolean))] as string[];
    const ops = opIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: opIds } },
          select: { id: true, nickname: true, username: true, role: true, uid: true },
        })
      : [];
    const opMap = new Map(ops.map((o) => [o.id, o]));
    return {
      total,
      page,
      pageSize,
      list: rows.map((r) => ({
        id: r.id,
        kind: 'LEDGER',
        action: r.bizType,
        actionLabel: ledgerLabel(r.bizType, r.refType, r.remark),
        amount: asMoney(r.amount),
        balanceAfter: asMoney(r.balanceAfter),
        remark: r.remark,
        refType: r.refType,
        createdAt: r.createdAt,
        operator: r.operatorId ? opMap.get(r.operatorId) ?? null : null,
        counterparty: null as null,
        detail: { refType: r.refType, refId: r.refId },
      })),
    };
  }

  private async listFundLogs(p: {
    userId: string;
    agentRootId: string;
    staffIds: string[];
    operatorIds: string[];
    role: string;
    page: number;
    pageSize: number;
    from?: string;
    to?: string;
    fundType?: string;
  }) {
    const base = this.fundLogWhere(
      p.userId,
      p.agentRootId,
      p.staffIds,
      p.operatorIds,
      p.role,
    );
    const and: Record<string, unknown>[] = [base];
    const from = this.parseAuditDate(p.from, false);
    const to = this.parseAuditDate(p.to, true);
    if (from || to) {
      and.push({
        createdAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lt: to } : {}),
        },
      });
    }
    const typeActions = this.fundTypeActions(p.fundType);
    if (typeActions) and.push({ action: { in: typeActions } });
    const where = and.length === 1 ? and[0] : { AND: and };

    const [total, rows, byAction] = await Promise.all([
      this.prisma.adminLog.count({ where }),
      this.prisma.adminLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
        select: {
          id: true,
          action: true,
          target: true,
          detail: true,
          operatorId: true,
          createdAt: true,
        },
      }),
      sumAdminLogAmountsByAction(this.prisma, {
        userId: p.userId,
        agentRootId: p.agentRootId,
        staffIds: p.staffIds,
        operatorIds: p.operatorIds,
        role: p.role,
        from,
        to,
        actions: typeActions,
      }),
    ]);

    const fundTotals = {
      count: total,
      quotaIn: 0,
      quotaOut: 0,
      playerUp: 0,
      playerDown: 0,
      csAlloc: 0,
      csRecall: 0,
    };
    fundTotals.quotaIn = byAction.get('QUOTA_SELL') ?? 0;
    fundTotals.quotaOut = byAction.get('QUOTA_RECALL') ?? 0;
    fundTotals.playerUp = byAction.get('CONSOLE_CREDIT') ?? 0;
    fundTotals.playerDown = byAction.get('CONSOLE_DEBIT') ?? 0;
    fundTotals.csAlloc = byAction.get('CS_STAFF_ALLOC') ?? 0;
    fundTotals.csRecall = byAction.get('CS_STAFF_RECALL') ?? 0;
    fundTotals.quotaIn = round2(fundTotals.quotaIn);
    fundTotals.quotaOut = round2(fundTotals.quotaOut);
    fundTotals.playerUp = round2(fundTotals.playerUp);
    fundTotals.playerDown = round2(fundTotals.playerDown);
    fundTotals.csAlloc = round2(fundTotals.csAlloc);
    fundTotals.csRecall = round2(fundTotals.csRecall);

    return {
      total,
      page: p.page,
      pageSize: p.pageSize,
      fundTotals,
      list: await this.enrichAdminRows(rows),
    };
  }

  private async listOpsLogs(p: {
    userId: string;
    staffIds: string[];
    page: number;
    pageSize: number;
  }) {
    const where = {
      OR: [
        { operatorId: { in: p.staffIds } },
        { target: p.userId },
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.adminLog.count({ where }),
      this.prisma.adminLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
        select: {
          id: true,
          action: true,
          target: true,
          detail: true,
          operatorId: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      total,
      page: p.page,
      pageSize: p.pageSize,
      list: await this.enrichAdminRows(rows),
    };
  }

  private async enrichAdminRows(
    rows: {
      id: string;
      action: string;
      target: string | null;
      detail: unknown;
      operatorId: string;
      createdAt: Date;
    }[],
  ) {
    const userIds = new Set<string>();
    const roomIds = new Set<string>();
    for (const r of rows) {
      userIds.add(r.operatorId);
      if (r.target) {
        if (r.action.startsWith('ROOM_') || r.action === 'ROOM_FUND') roomIds.add(r.target);
        else userIds.add(r.target);
      }
      const d = r.detail as { agentUserId?: string; ownerUserId?: string } | null;
      if (d?.agentUserId) userIds.add(d.agentUserId);
      if (d?.ownerUserId) userIds.add(d.ownerUserId);
    }
    const [users, rooms] = await Promise.all([
      userIds.size
        ? this.prisma.user.findMany({
            where: { id: { in: [...userIds] } },
            select: { id: true, nickname: true, username: true, role: true, uid: true },
          })
        : Promise.resolve([]),
      roomIds.size
        ? this.prisma.room.findMany({
            where: { id: { in: [...roomIds] } },
            select: { id: true, name: true, roomNo: true },
          })
        : Promise.resolve([]),
    ]);
    const umap = new Map(users.map((u) => [u.id, u]));
    const rmap = new Map(rooms.map((x) => [x.id, x]));

    return rows.map((r) => {
      const d = (r.detail || {}) as Record<string, unknown>;
      const amount = d.amount != null ? Number(d.amount) : null;
      const operator = umap.get(r.operatorId) ?? null;
      let counterparty: {
        id: string; nickname: string; username: string; role: string; uid: string
      } | null = r.target ? umap.get(r.target) ?? null : null;
      const room = r.target ? rmap.get(r.target) : undefined;
      if (!counterparty && room) {
        counterparty = {
          id: room.id,
          nickname: room.name,
          username: room.roomNo,
          role: 'ROOM',
          uid: room.roomNo,
        };
      }
      const orderNo =
        typeof d.orderNo === 'string' && d.orderNo
          ? d.orderNo
          : typeof d.clientRequestId === 'string' && d.clientRequestId
            ? d.clientRequestId
            : null;
      const method =
        typeof d.method === 'string' && d.method
          ? d.method
          : r.action === 'CONSOLE_CREDIT'
            ? '上分'
            : r.action === 'CONSOLE_DEBIT'
              ? '下分'
              : null;
      return {
        id: r.id,
        kind: 'ADMIN_LOG',
        action: r.action,
        actionLabel: adminActionLabel(r.action, d),
        amount,
        balanceAfter: null as number | null,
        remark: typeof d.remark === 'string' ? d.remark : null,
        orderNo,
        method,
        createdAt: r.createdAt,
        operator,
        counterparty,
        detail: {
          ...d,
          orderNo,
          method,
          roomNo: room?.roomNo ?? d.roomNo,
          roomName: room?.name,
          real: d.real != null ? Number(d.real) : undefined,
          fake: d.fake != null ? Number(d.fake) : undefined,
          coverBack: d.coverBack != null ? Number(d.coverBack) : undefined,
          fromRole: d.fromRole,
          direction: d.direction,
        },
      };
    });
  }

  /** 仅代理本人可设值班（空=代理自己接） */
  async setCsDuty(actor: ConsoleActor, agentUserId: string, dutyUserId: string | null) {
    if (actor.role !== 'AGENT' || actor.id !== agentUserId) {
      throw new ForbiddenException('仅代理本人可调整值班');
    }
    const agentUser = await this.prisma.user.findUnique({
      where: { id: agentUserId },
      select: { id: true, role: true },
    });
    if (!agentUser || agentUser.role !== 'AGENT') {
      throw new BadRequestException('只能给代理设置值班客服');
    }

    if (!dutyUserId) {
      await this.redis.del(csDutyKey(agentUserId));
      await this.adminLog.log(actor.id, 'CS_DUTY_CLEAR', agentUserId, {});
      return { ok: true, dutyUserId: null };
    }

    const staff = await this.prisma.user.findUnique({
      where: { id: dutyUserId },
      select: { id: true, role: true, parentId: true, status: true },
    });
    if (!staff || staff.role !== 'PROXY' || staff.parentId !== agentUserId) {
      throw new BadRequestException('值班人须是该代理下的客服');
    }
    if (staff.status !== 'ACTIVE') throw new BadRequestException('该客服已停用');

    await this.redis.set(csDutyKey(agentUserId), dutyUserId);
    await this.adminLog.log(actor.id, 'CS_DUTY_SET', agentUserId, { dutyUserId });
    return { ok: true, dutyUserId };
  }

  /** 停用/启用：子账号（管理员/房主）或房主（仅管理员） */
  async setProxyStatus(actor: ConsoleActor, proxyUserId: string, status: 'ACTIVE' | 'DISABLED') {
    const target = await this.prisma.user.findUnique({
      where: { id: proxyUserId },
      select: { id: true, role: true, parentId: true, status: true },
    });
    if (!target) throw new BadRequestException('账号不存在');

    if (target.role === 'BRANCH' || target.role === 'GENERAL') {
      if (actor.role !== 'ADMIN') {
        throw new ForbiddenException(target.role === 'GENERAL' ? '仅管理员可停用/启用总代' : '仅管理员可停用/启用总监');
      }
      if (target.status === status) return { id: target.id, status };
      const u = await this.prisma.user.update({
        where: { id: proxyUserId },
        data: {
          status,
          ...(status === 'DISABLED' ? { tokenVersion: { increment: 1 } } : {}),
        },
        select: { id: true, status: true },
      });
      await this.adminLog.log(actor.id, 'USER_STATUS', proxyUserId, { status, role: target.role });
      return u;
    }

    if (target.role !== 'PROXY' || !target.parentId) {
      throw new BadRequestException('目标不是子账号或房主');
    }
    if (proxyUserId === actor.id && status === 'DISABLED') {
      throw new BadRequestException('不能停用当前登录的账号');
    }
    await this.assertCanHardManageProxy(actor, target.parentId);
    if (target.status === status) return { id: target.id, status };

    const u = await this.prisma.user.update({
      where: { id: proxyUserId },
      data: {
        status,
        ...(status === 'DISABLED' ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: { id: true, status: true },
    });
    if (status === 'DISABLED') {
      const duty = await this.redis.get(csDutyKey(target.parentId));
      if (duty === proxyUserId) {
        await this.redis.del(csDutyKey(target.parentId));
        await this.adminLog.log(actor.id, 'CS_DUTY_CLEAR', target.parentId, { reason: 'proxy_disabled' });
      }
    }
    await this.adminLog.log(actor.id, 'USER_STATUS', proxyUserId, { status, role: 'PROXY' });
    return u;
  }

  /**
   * 重置玩家密码并解冻登录冻结。
   * 管理/总监：管辖范围内全部玩家；总代（含分身）：仅名下代理房间玩家。
   */
  async resetPlayerPassword(actor: ConsoleActor, playerId: string, password?: string) {
    const generalSide = await this.scope.isGeneralSide(actor);
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH' && !generalSide) {
      throw new ForbiddenException('仅管理、总监或总代可重置玩家密码');
    }
    const player = await this.prisma.user.findUnique({
      where: { id: playerId },
      select: { id: true, role: true, username: true, status: true },
    });
    if (!player) throw new BadRequestException('账号不存在');
    if (player.role === 'ADMIN') {
      throw new ForbiddenException('不能重置管理员密码（忘记只能改数据库）');
    }
    if (player.role !== 'PLAYER') {
      throw new BadRequestException('只能重置玩家密码');
    }
    await this.scope.assertUserInScope(actor, playerId);

    const plainPassword = password?.trim() || genProxyPassword();
    const pwdErr = validatePassword(plainPassword);
    if (pwdErr) throw new BadRequestException(pwdErr);
    const passwordHash = await bcrypt.hash(plainPassword, PASSWORD_SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: playerId },
      data: {
        passwordHash,
        loginLockedAt: null,
        tokenVersion: { increment: 1 },
      },
    });
    await this.redis.del(`login:fail:user:${player.username.toLowerCase()}`);
    await this.adminLog.log(actor.id, 'PLAYER_RESET_PWD', playerId, {
      username: player.username,
      unlocked: true,
    });
    return {
      ok: true,
      username: player.username,
      password: plainPassword,
      message: '密码已重置并解冻，请立即告知玩家；旧登录态已失效',
    };
  }

  /** 重置密码：子账号（管理员/房主）或房主（仅管理员） */
  async resetProxyPassword(actor: ConsoleActor, proxyUserId: string, password?: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: proxyUserId },
      select: { id: true, role: true, parentId: true, username: true },
    });
    if (!target) throw new BadRequestException('账号不存在');
    if (target.role === 'ADMIN') {
      throw new ForbiddenException('不能重置管理员密码（忘记只能改数据库）');
    }

    if (target.role === 'BRANCH' || target.role === 'GENERAL') {
      if (actor.role !== 'ADMIN') {
        throw new ForbiddenException(target.role === 'GENERAL' ? '仅管理员可重置总代密码' : '仅管理员可重置总监密码');
      }
    } else if (target.role === 'PROXY' && target.parentId) {
      await this.assertCanHardManageProxy(actor, target.parentId);
    } else {
      throw new BadRequestException('目标不是子账号、总监或总代');
    }

    const plainPassword = password?.trim() || genProxyPassword();
    const pwdErr = validateOpsPassword(plainPassword);
    if (pwdErr) throw new BadRequestException(pwdErr);
    const passwordHash = await bcrypt.hash(plainPassword, PASSWORD_SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: proxyUserId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    await this.adminLog.log(actor.id, 'ROOM_AGENT_RESET_PWD', proxyUserId, {
      username: target.username,
      kind: target.role,
    });
    return {
      ok: true,
      username: target.username,
      password: plainPassword,
      message: '密码已重置，请立即告知；旧登录态已失效',
    };
  }

  /** 改子账号显示名：管理员/房主/所属主代理 */
  async renameProxyNickname(actor: ConsoleActor, proxyUserId: string, nickname: string) {
    const name = nickname.trim();
    if (!name) throw new BadRequestException('名字不能为空');
    if (name.length > 20) throw new BadRequestException('名字最多 20 字');

    const proxy = await this.prisma.user.findUnique({
      where: { id: proxyUserId },
      select: { id: true, role: true, parentId: true, nickname: true },
    });
    if (!proxy || proxy.role !== 'PROXY' || !proxy.parentId) {
      throw new BadRequestException('目标不是子账号');
    }
    await this.assertCanManageAgentStaff(actor, proxy.parentId);

    if (proxy.nickname === name) return { id: proxy.id, nickname: name };
    const u = await this.prisma.user.update({
      where: { id: proxyUserId },
      data: { nickname: name },
      select: { id: true, nickname: true },
    });
    await this.adminLog.log(actor.id, 'USER_NICKNAME', proxyUserId, {
      role: 'PROXY',
      from: proxy.nickname,
      to: name,
    });
    return u;
  }

  /** 值班/改名：管理员、房主（管辖内）、或该代理本人 */
  private async assertCanManageAgentStaff(actor: ConsoleActor, agentUserId: string) {
    if (actor.role === 'ADMIN') return;
    if (actor.role === 'AGENT' && actor.id === agentUserId) return;
    if (actor.role === 'BRANCH') {
      await this.scope.assertUserInScope(actor, agentUserId);
      return;
    }
    throw new ForbiddenException('无权管理该代理的子账号');
  }

  /** 重置密码/停用：管理员、总监、名下总代（代理本人不可） */
  private async assertCanHardManageProxy(actor: ConsoleActor, agentUserId: string) {
    if (actor.role === 'ADMIN') return;
    if (actor.role === 'BRANCH') {
      await this.scope.assertUserInScope(actor, agentUserId);
      return;
    }
    if (await this.scope.isGeneralSide(actor)) {
      const rootId = await this.scope.generalRootId(actor);
      if (rootId === agentUserId) return;
      await this.scope.assertUserInScope(actor, agentUserId);
      const hasRoom = await this.prisma.room.findFirst({
        where: {
          ownerAgent: { userId: agentUserId },
          generalAgent: { userId: rootId },
        },
        select: { id: true },
      });
      if (hasRoom) return;
    }
    throw new ForbiddenException('无权重置密码或停用该子账号');
  }

  private rolePermissions(role: string) {
    if (role === 'BRANCH') {
      return {
        label: '总监',
        summary: '与管理共用平台池、不吃流水；看报表；和股东怎么分平台利润私下协商',
        can: ['全部房间', '代理/客服', '额度', '报表'],
        cannot: ['游戏赔率', '控奖'],
      };
    }
    if (role === 'GENERAL') {
      return {
        label: '总代',
        summary: '发展房间；拿名下全部房间流水差与占成差。自己做房需另开代理号',
        can: ['名下房间', '开代理房', '整房飞盘', '报表'],
        cannot: ['改赔率', '改已建账号的流水/占成'],
      };
    }
    if (role === 'AGENT') {
      return {
        label: '代理',
        summary: '房间绑定账号；子账号由管理/总监/名下总代开通',
        can: ['报表', '回水', '机器人', '上下分', '子账号'],
        cannot: ['其他房间', '平台赔率'],
      };
    }
    /*
     * 子账号不能给玩家上下分——那两个接口只开给代理和客服。
     * 挂在总代下的子账号可以代总代给下级代理发/收额度，挂在代理下的只有查看权。
     */
    return {
      label: '子账号',
      summary: '与代理同看，多为只读；玩家上下分须由代理或客服操作',
      can: ['本房报表', '充值历史'],
      cannot: ['给玩家上下分', '改回水/机器人', '建号'],
    };
  }

  /**
   * 改总代每间房缴给平台的月费单价。
   * 只影响以后结账时怎么算；已结清账期按当时的价定格，不回头改。
   *
   * 这个单价同时是「总代向代理收的房间月费」的下限。调高之后，存量房里
   * 低于新单价的那些会让总代每月倒贴差额，所以要把清单报出来——
   * 但不自动改代理那笔：那是总代跟代理谈好的价，系统不能替他单方面涨价。
   */
  async setGeneralRoomMonthlyFee(actor: ConsoleActor, userId: string, amount: number) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅管理或总监可定房间月费单价');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        agent: { select: { id: true, roomMonthlyFee: true } },
      },
    });
    if (!user || user.role !== 'GENERAL' || !user.agent) {
      throw new BadRequestException('该账号不是总代');
    }
    const fee = Math.max(0, Math.floor(Number(amount) || 0));
    const before = asMoney(user.agent.roomMonthlyFee);
    await this.prisma.agent.update({
      where: { userId },
      data: { roomMonthlyFee: fee },
    });

    /* 调高之后，存量房里低于新单价的那些总代要倒贴，列出来让人去谈 */
    let underwater: { roomNo: string; name: string; monthlyFee: number }[] = [];
    if (fee > 0) {
      const rooms = await this.prisma.room.findMany({
        where: {
          generalAgentId: user.agent.id,
          status: { not: 'CLOSED' },
          monthlyFee: { lt: fee },
        },
        select: { roomNo: true, name: true, monthlyFee: true },
        orderBy: { roomNo: 'asc' },
        take: 200,
      });
      underwater = rooms.map((r) => ({
        roomNo: r.roomNo,
        name: r.name,
        monthlyFee: asMoney(r.monthlyFee),
      }));
    }

    await this.adminLog.log(actor.id, 'GENERAL_ROOM_FEE_SET', userId, {
      before,
      after: fee,
      underwaterRooms: underwater.length,
    });
    return {
      ok: true,
      roomMonthlyFee: fee,
      /** 月费低于新单价的存量房；总代每月按差额倒贴，需线下跟代理重谈 */
      underwater,
      message: underwater.length
        ? `已保存。有 ${underwater.length} 间存量房月费低于新单价，`
          + '这部分差额总代每月要自己倒贴，需与代理重新议价（系统不替总代单方面涨价）'
        : '已保存',
    };
  }

  /**
   * 管理/总监改总代占成。本期账单仍按旧档；从该总代下一账期起点才换新档。
   * 名下未关房的代理占成高于新档就拒，不替房间改数。
   */
  async setGeneralShareRate(actor: ConsoleActor, userId: string, shareRateRaw: number) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅管理或总监可改总代占成');
    }
    if (actor.role !== 'ADMIN') {
      await this.scope.assertUserInScope(actor, userId);
    }
    const nextRate = parseGeneralShareRate(shareRateRaw);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        agent: { select: { id: true, settleCycle: true, ...GENERAL_SHARE_SCHEDULE_SELECT } },
      },
    });
    if (!user || user.role !== 'GENERAL' || !user.agent) {
      throw new BadRequestException('该账号不是总代');
    }

    const openRooms = await this.prisma.room.findMany({
      where: {
        generalAgentId: user.agent.id,
        ...OPEN_ROOM_WHERE,
      },
      select: { roomNo: true, name: true, ...ROOM_AGENT_SHARE_SCHEDULE_SELECT },
      orderBy: { roomNo: 'asc' },
    });
    const overflow = openRooms.filter(
      (r) => roomAgentShareCeiling(r) > nextRate + 1e-9,
    );
    if (overflow.length) {
      throw new BadRequestException(
        overflowShareRoomsMessage(
          overflow.map((r) => ({
            roomNo: r.roomNo,
            name: r.name,
            agentShareRate: roomAgentShareCeiling(r),
          })),
        ),
      );
    }

    const cycle = normalizeSettleCycle(user.agent.settleCycle);
    const calendar = shanghaiSettleBounds(cycle, 0);
    const live = materializeShareSchedule(scheduleFromAgent(user.agent), calendar.periodStart);
    const sameAsCurrent = Math.abs(live.shareRate - nextRate) < 1e-9;
    const next = sameAsCurrent
      ? { ...live, pendingShareRate: null, pendingShareFrom: null }
      : {
          ...live,
          pendingShareRate: nextRate,
          pendingShareFrom: calendar.periodEnd,
        };

    await this.prisma.agent.update({
      where: { userId },
      data: {
        shareRate: next.shareRate,
        shareRateSince: next.shareRateSince,
        prevShareRate: next.prevShareRate,
        pendingShareRate: next.pendingShareRate,
        pendingShareFrom: next.pendingShareFrom,
      },
    });

    const view = publicGeneralShareView(next);
    await this.adminLog.log(actor.id, 'GENERAL_SHARE_RATE_SET', userId, {
      before: publicGeneralShareView(scheduleFromAgent(user.agent)),
      after: view,
      nextRate,
      effectiveFrom: next.pendingShareFrom,
    });
    return {
      ok: true,
      ...view,
      pendingShareFrom: view.pendingShareFrom?.toISOString() ?? null,
      message: view.pendingShareRate == null
        ? '已保存。与本期占成相同，未预约下期变更'
        : '已保存。本期仍按原占成结算，下期起按新占成',
    };
  }

  /** 某个总代当前对哪些总监可见（总代详情页用） */
  async generalOwners(actor: ConsoleActor, generalUserId: string) {
    await this.scope.assertUserInScope(actor, generalUserId);
    const agent = await this.prisma.agent.findUnique({
      where: { userId: generalUserId },
      select: { id: true, user: { select: { role: true } } },
    });
    if (!agent || agent.user.role !== 'GENERAL') {
      throw new BadRequestException('该账号不是总代');
    }
    const [grants, branches] = await Promise.all([
      this.prisma.generalOwnerGrant.findMany({
        where: { generalAgentId: agent.id },
        select: {
          ownerId: true,
          createdAt: true,
          owner: { select: { uid: true, nickname: true, username: true, status: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { role: 'BRANCH' },
        select: { id: true, uid: true, nickname: true, username: true, status: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      generalUserId,
      granted: grants.map((g) => ({
        ownerUserId: g.ownerId,
        uid: g.owner.uid,
        nickname: g.owner.nickname,
        username: g.owner.username,
        status: g.owner.status,
        createdAt: g.createdAt.toISOString(),
      })),
      /* 全部总监，供前端做「还能授权给谁」的下拉 */
      allBranches: branches.map((b) => ({
        ownerUserId: b.id,
        uid: b.uid,
        nickname: b.nickname,
        username: b.username,
        status: b.status,
      })),
    };
  }

  /**
   * 开/关某个总监对某个总代的可见性。
   *
   * 只有管理能改：总监之间互相屏蔽是平台的分工决定，
   * 让总监自己改就等于他能把别人的总代抢过来看，或者把自己藏起来。
   */
  async setGeneralOwner(
    actor: ConsoleActor,
    generalUserId: string,
    ownerUserId: string,
    visible: boolean,
  ) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('仅管理员可调整总代可见范围');
    }
    const agent = await this.prisma.agent.findUnique({
      where: { userId: generalUserId },
      select: { id: true, user: { select: { role: true } } },
    });
    if (!agent || agent.user.role !== 'GENERAL') {
      throw new BadRequestException('该账号不是总代');
    }
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerUserId },
      select: { id: true, role: true },
    });
    if (!owner || owner.role !== 'BRANCH') {
      throw new BadRequestException('目标必须是总监(BRANCH)');
    }

    /*
     * 只改这一张表就够了：挂总代的房不看房间级那份名单（见 console-scope 文件头），
     * 所以这里一开一关，他名下所有房间的可见性同时跟着变，不需要再去逐房同步。
     */
    const roomCount = await this.prisma.room.count({
      where: { generalAgentId: agent.id },
    });
    if (visible) {
      await this.prisma.generalOwnerGrant.createMany({
        data: [{ generalAgentId: agent.id, ownerId: ownerUserId }],
        skipDuplicates: true,
      });
    } else {
      await this.prisma.generalOwnerGrant.deleteMany({
        where: { generalAgentId: agent.id, ownerId: ownerUserId },
      });
    }

    const left = await this.prisma.generalOwnerGrant.count({
      where: { generalAgentId: agent.id },
    });
    await this.adminLog.log(
      actor.id,
      visible ? 'GENERAL_GRANT_OWNER' : 'GENERAL_REVOKE_OWNER',
      generalUserId,
      { ownerUserId, remaining: left, rooms: roomCount },
    );
    /*
     * 剩 0 个总监是允许的：那表示这个总代只有管理直管。
     * 房间授权那边要挂管理哨兵是因为「名单为空」被当成「旧房全开」，
     * 这张表没有那个历史包袱，空就是空。
     */
    return { ok: true, visible, remaining: left };
  }

  /** 创建总监 / 总代 / 子账号。代理号只在创建房间时生成 */
  async createAgent(
    actor: ConsoleActor,
    body: {
      username: string;
      password: string;
      nickname?: string;
      role?: 'BRANCH' | 'AGENT' | 'PROXY' | 'GENERAL';
      parentAgentUserId?: string;
      flowRate?: number;
      shareRate?: number;
      /** 总代与平台的结算方式 CASH | CREDIT */
      bookMode?: string;
      /** 总代信用盘合同额度 */
      creditLimit?: number;
      /** 总代与平台的结算周期 */
      settleCycle?: string;
      /** 总代每开一间房、每月缴给平台的月费单价 */
      roomMonthlyFee?: number;
      /**
       * 建总代时指定哪些总监可见（User.id，role=BRANCH）。
       * 不传 = 全部在职总监可见（与升级前行为一致）。
       */
      ownerUserIds?: string[];
    },
  ) {
    const role = body.role ?? 'PROXY';
    if ((role as string) === 'ADMIN') {
      throw new BadRequestException('不能创建管理员；全站有且仅有一名管理员');
    }
    if (role === 'AGENT') {
      throw new BadRequestException('代理账号请在「房间中心」创建房间时生成，不可在此单独添加');
    }
    if (actor.role === 'AGENT' || (actor.role === 'PROXY' && !(await this.scope.isGeneralSide(actor)))) {
      throw new BadRequestException('代理/子账号不能在此开号');
    }
    /* 总代及其分身只能给总代开助手，帮他管名下房间与额度；不能开总代、总监 */
    if (await this.scope.isGeneralSide(actor) && role !== 'PROXY') {
      throw new BadRequestException('总代只能开自己的子账号');
    }
    if (actor.role === 'BRANCH' && role !== 'PROXY' && role !== 'GENERAL') {
      throw new BadRequestException('总监只能开总代或子账号');
    }
    if (actor.role !== 'ADMIN' && role === 'BRANCH') {
      throw new BadRequestException('仅管理可创建总监');
    }
    /* 可见范围只有管理能定；总监开的总代一律全员可见，避免他私藏 */
    const ownerUserIds =
      actor.role === 'ADMIN' && Array.isArray(body.ownerUserIds)
        ? [...new Set(body.ownerUserIds.map((s) => String(s || '').trim()).filter(Boolean))]
        : null;

    const username = body.username.toLowerCase().trim();
    if (!/^[a-z0-9]{8,20}$/.test(username)) {
      throw new BadRequestException('用户名须 8-20 位小写字母数字');
    }
    const newAccountPwdErr = validateOpsPassword(body.password || '');
    if (newAccountPwdErr) throw new BadRequestException(newAccountPwdErr);
    if (await this.prisma.user.findUnique({ where: { username } })) {
      throwUsernameTaken();
    }

    const policy = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    const platform = readPlatformBounds(policy);
    const generalMax = platform.generalMax;
    const generalDef = platform.generalDefault;
    let flowRate = generalDef;
    let shareRate = 0.5;
    let bookMode = 'CASH';
    let creditLimit = 0;
    let settleCycle = 'WEEKLY_MON';
    let roomMonthlyFee = 0;
    if (role === 'GENERAL') {
      flowRate = Number(body.flowRate);
      if (!Number.isFinite(flowRate)) flowRate = generalDef;
      if (flowRate > 1) flowRate = flowRate / 100;
      if (flowRate < platform.generalMin - 1e-9 || flowRate > generalMax + 1e-9) {
        throw new BadRequestException(
          `总代流水整包须在 ${pctLabel(platform.generalMin)}～${pctLabel(generalMax)}`,
        );
      }
      shareRate = parseGeneralShareRate(body.shareRate, 0.5);
      bookMode = body.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH';
      settleCycle = normalizeSettleCycle(body.settleCycle);
      /* 平台按这个单价向总代收每间房的月费；他向代理收多少自己定 */
      roomMonthlyFee = Math.max(0, Math.floor(Number(body.roomMonthlyFee ?? 0) || 0));
      if (bookMode === 'CREDIT') {
        creditLimit = Math.max(0, Math.floor(Number(body.creditLimit ?? 0) || 0));
        if (creditLimit <= 0) {
          throw new BadRequestException('信用盘总代须设置合同额度（大于 0）');
        }
      }
    }

    let parentId: string | null = actor.id;
    let parent = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!parent) throw new BadRequestException();

    if (role === 'BRANCH') {
      parentId = null;
    } else if (role === 'GENERAL') {
      parentId = actor.id;
    } else if (role === 'PROXY') {
      /* 总代开的子账号直接挂自己名下；管理/总监可给总代或房间代理开子账号 */
      if (await this.scope.isGeneralSide(actor)) {
        const rootId = await this.scope.generalRootId(actor);
        const pid = body.parentAgentUserId?.trim();
        if (pid && pid !== rootId) {
          await this.scope.assertUserInScope(actor, pid);
          const parentUser = await this.prisma.user.findUnique({ where: { id: pid } });
          if (!parentUser || parentUser.role !== 'AGENT') {
            throw new BadRequestException('只能给名下房间代理开子账号');
          }
          const hasRoom = await this.prisma.room.findFirst({
            where: {
              ownerAgent: { userId: pid },
              generalAgent: { userId: rootId },
            },
            select: { id: true },
          });
          if (!hasRoom) throw new BadRequestException('该代理不在你名下');
          parentId = pid;
          parent = parentUser;
        } else {
          parentId = rootId;
          const generalParent = await this.prisma.user.findUnique({ where: { id: parentId } });
          if (generalParent) parent = generalParent;
        }
      } else {
        const pid = body.parentAgentUserId?.trim();
        if (!pid) throw new BadRequestException('开子账号须指定所属总代或代理');
        if (actor.role !== 'ADMIN') {
          await this.scope.assertUserInScope(actor, pid);
        }
        const parentUser = await this.prisma.user.findUnique({ where: { id: pid } });
        if (!parentUser || (parentUser.role !== 'AGENT' && parentUser.role !== 'GENERAL')) {
          throw new BadRequestException('所属账号必须是总代或房间代理');
        }
        if (parentUser.role === 'AGENT') {
          const hasRoom = await this.prisma.room.findFirst({
            where: { ownerAgent: { userId: pid } },
            select: { id: true },
          });
          if (!hasRoom) throw new BadRequestException('该代理尚未绑定房间');
        }
        parentId = pid;
        parent = parentUser;
      }
    }

    const passwordHash = await bcrypt.hash(body.password, PASSWORD_SALT_ROUNDS);
    const uid = await this.allocUid();
    const nickname = body.nickname?.trim()
      || (role === 'PROXY'
        ? (parent?.role === 'GENERAL' ? `总代子账号${uid.slice(-4)}` : `代理${uid.slice(-4)}`)
        : role === 'GENERAL' ? `总代${uid.slice(-4)}` : `总监${uid.slice(-4)}`);

    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const avatar = await pickAvatarUniqueInTx(tx);
        const created = await tx.user.create({
          data: {
            username,
            passwordHash,
            uid,
            nickname,
            avatar,
            role,
            parentId,
            agentPath: parentId && parent
              ? `${parent.agentPath}${parent.id}/`
              : '/',
            depth: parentId && parent ? parent.depth + 1 : 0,
          },
        });
        const createdAgent = await tx.agent.create({
          select: { id: true },
          data: {
            userId: created.id,
            ...(role === 'GENERAL'
              ? (() => {
                  const downline = resolveDownlineFlowRate(platform, {
                    flowRate,
                    downlineFlowRate: platform.agentDefault,
                  });
                  const band = resolvePlayerBand({
                    platform,
                    general: { flowRate, downlineFlowRate: downline },
                    agentFlowRate: downline,
                  });
                  return {
                    flowRate,
                    shareRate,
                    rebateRate: clampPlayerRateToBand(0.018, band),
                    downlineFlowRate: downline,
                    playerMinRate: band.playerMin,
                    playerMaxRate: band.playerMax,
                    bookMode,
                    creditLimit,
                    settleCycle,
                    roomMonthlyFee,
                  };
                })()
              : {}),
          },
        });
        await tx.pointsAccount.create({
          data: {
            ownerType: role === 'BRANCH' ? 'BRANCH' : role === 'PROXY' ? 'PROXY' : 'AGENT',
            ownerId: created.id,
          },
        });
        /* 信用盘总代：合同额度即刻计入盘分（余额+额度） */
        if (role === 'GENERAL' && bookMode === 'CREDIT' && creditLimit > 0) {
          await adjustCashDiskInTx(tx, this.points, {
            agentUserId: created.id,
            bookMode: 'CREDIT',
            delta: creditLimit,
            bizType: 'OPEN',
            remark: `建号期初信用额度 ${creditLimit}`,
            refType: 'general_open',
            refId: created.id,
            idempotencyKey: `general_open:${created.id}`,
            createIfMissing: true,
          });
          await recordCreditIssueDebtInTx(tx, {
            ...platformGeneralDebtFilter(created.id),
            amount: creditLimit,
            idempotencyKey: `credit_debt:general_open:${created.id}`,
            remark: `建号期初信用额度 ${creditLimit}`,
            refType: 'general_open',
            refId: created.id,
          });
        }
        if (role === 'GENERAL') {
          /*
           * 总代级可见性：没有授权行就等于对该总监完全隐身，所以建号时必须写。
           * 不传名单时给全部在职总监（= 升级前的行为），管理员想收紧就勾选，
           * 或者事后在总代详情里撤销。总监自己开的总代一定包含他本人，
           * 否则他建完就看不见自己开的号。
           */
          const branches = await tx.user.findMany({
            where: { role: 'BRANCH', status: 'ACTIVE' },
            select: { id: true },
          });
          const allowed = new Set(branches.map((b) => b.id));
          let owners = ownerUserIds
            ? ownerUserIds.filter((id) => allowed.has(id))
            : [...allowed];
          if (actor.role === 'BRANCH' && !owners.includes(actor.id)) {
            owners.push(actor.id);
          }
          owners = [...new Set(owners)];
          if (owners.length) {
            await tx.generalOwnerGrant.createMany({
              data: owners.map((ownerId) => ({
                generalAgentId: createdAgent.id,
                ownerId,
              })),
              skipDuplicates: true,
            });
          }
        }
        if (role === 'BRANCH') {
          const rooms = await tx.room.findMany({
            /* 只处理直挂房：挂总代的房由下面那段按总代级名单决定 */
            where: { generalAgentId: null },
            select: {
              id: true,
              ownerGrants: { select: { owner: { select: { role: true } } } },
            },
          });
          /* 名单为空=旧房默认全开；只有管理哨兵=明确无人可见，新总监也不该看见 */
          const grantRooms = rooms.filter((r) => {
            const roles = r.ownerGrants.map((g) => g.owner.role);
            if (!roles.length) return true;
            return roles.some((role) => role === 'BRANCH');
          });
          if (grantRooms.length) {
            await tx.roomOwnerGrant.createMany({
              data: grantRooms.map((r) => ({ roomId: r.id, ownerId: created.id })),
              skipDuplicates: true,
            });
          }
          /*
           * 新总监对存量总代的可见性：跟房间同一个口径——
           * 已经有总监被授权的总代，说明是「公开」的，新总监一并可见；
           * 一个总监都没授权的（管理刻意收紧过）不给新人开。
           */
          const generals = await tx.agent.findMany({
            where: { user: { role: 'GENERAL' } },
            select: { id: true, _count: { select: { ownerGrants: true } } },
          });
          const openGenerals = generals.filter((g) => g._count.ownerGrants > 0);
          if (openGenerals.length) {
            await tx.generalOwnerGrant.createMany({
              data: openGenerals.map((g) => ({
                generalAgentId: g.id,
                ownerId: created.id,
              })),
              skipDuplicates: true,
            });
          }
        }
        return created;
      });
    } catch (e: unknown) {
      rethrowUserUniqueConflict(e);
    }

    await this.adminLog.log(actor.id, 'AGENT_CREATE', user.id, {
      role, username, parentId, flowRate, shareRate,
      ...(role === 'GENERAL' ? { bookMode, creditLimit, settleCycle } : {}),
    });
    return {
      id: user.id,
      uid: user.uid,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      parentId,
      flowRate: role === 'GENERAL' ? flowRate : undefined,
      shareRate: role === 'GENERAL' ? shareRate : undefined,
      bookMode: role === 'GENERAL' ? bookMode : undefined,
      creditLimit: role === 'GENERAL' ? creditLimit : undefined,
      settleCycle: role === 'GENERAL' ? settleCycle : undefined,
      password: body.password,
    };
  }

  /**
   * 调整总代与平台的合同信用额度：合同与剩余信用同增同减。
   * 结算把额度校准回合同值，所以两者必须一起动，否则下期结算会凭空多出或吃掉一笔。
   */
  async bumpGeneralCreditLimit(
    actor: ConsoleActor,
    generalUserId: string,
    amountRaw: number,
    direction: 'up' | 'down',
    remark?: string,
    clientRequestId?: string,
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅管理或总监可调整总代信用额度');
    }
    const orderNo = assertFundOrderNo(clientRequestId);
    const amount = Math.floor(Number(amountRaw) || 0);
    if (!(amount > 0)) throw new BadRequestException('金额须大于 0');

    const target = await this.prisma.user.findUnique({
      where: { id: generalUserId },
      select: { id: true, role: true, nickname: true, agent: { select: { bookMode: true } } },
    });
    if (!target || target.role !== 'GENERAL') {
      throw new BadRequestException('总代账号无效');
    }
    if (target.agent?.bookMode !== 'CREDIT') {
      throw new BadRequestException('现金盘总代请用「上分 / 下分」增减额度');
    }

    const delta = direction === 'down' ? -amount : amount;
    const idem = `general_credit_bump:${generalUserId}:${orderNo}`;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Agent" WHERE "userId" = ${generalUserId} FOR UPDATE`;
      const locked = await tx.agent.findUnique({
        where: { userId: generalUserId },
        select: { creditLimit: true, pointsQuota: true },
      });
      if (!locked) throw new BadRequestException('总代账户不存在');

      const replayed = await tx.agentQuotaLedger.findFirst({
        where: { idempotencyKey: idem },
        select: { id: true },
      });
      if (replayed) {
        const cur = asMoney(locked.creditLimit);
        const quotaNow = asMoney(locked.pointsQuota);
        return {
          before: cur,
          after: cur,
          quotaBefore: quotaNow,
          quotaAfter: quotaNow,
          replayed: true as const,
        };
      }

      const before = asMoney(locked.creditLimit);
      const quotaBefore = asMoney(locked.pointsQuota);
      const after = Math.round((before + delta) * 100) / 100;
      const quotaAfter = Math.round((quotaBefore + delta) * 100) / 100;

      if (direction === 'down') {
        if (quotaBefore + 1e-9 < amount) {
          throw new BadRequestException(
            `剩余信用不足，最多可减 ${Math.max(0, quotaBefore)}（已发给代理的不能从这里扣）`,
          );
        }
        if (after <= 0) throw new BadRequestException('合同额度须大于 0');
      }

      await tx.agent.update({
        where: { userId: generalUserId },
        data: { creditLimit: after },
      });
      await adjustCashDiskInTx(tx, this.points, {
        agentUserId: generalUserId,
        bookMode: 'CREDIT',
        quotaTo: quotaAfter,
        bizType: 'ADJUST',
        remark: `总代合同额度 ${before}→${after}${remark?.trim() ? `｜${remark.trim()}` : ''}`,
        refType: 'general_credit_limit',
        refId: generalUserId,
        idempotencyKey: idem,
      });
      const debtFilter = platformGeneralDebtFilter(generalUserId);
      if (direction === 'up') {
        await recordCreditIssueDebtInTx(tx, {
          ...debtFilter,
          amount,
          idempotencyKey: `credit_debt:${idem}`,
          remark: `总代上分 ${amount}`,
          refType: 'general_credit_limit',
          refId: generalUserId,
        });
      } else {
        await consumeCreditIssueDebtInTx(tx, debtFilter, amount);
      }
      return { before, after, quotaBefore, quotaAfter, replayed: false as const };
    });

    if (!result.replayed) {
      await this.adminLog.log(actor.id, 'GENERAL_CREDIT_LIMIT_BUMP', generalUserId, {
        before: result.before,
        after: result.after,
        quotaBefore: result.quotaBefore,
        quotaAfter: result.quotaAfter,
        amount,
        direction,
        remark: remark?.trim() || null,
        clientRequestId: orderNo,
      });
    }

    const sign = direction === 'down' ? '-' : '+';
    return {
      ok: true,
      creditLimitBefore: result.before,
      creditLimit: result.after,
      pointsQuotaBefore: result.quotaBefore,
      pointsQuota: result.quotaAfter,
      message: `合同与剩余信用各 ${sign}${amount}：合同 ${result.before}→${result.after}，剩余 ${result.quotaBefore}→${result.quotaAfter}`,
    };
  }

  private async allocUid() {
    for (let i = 0; i < 20; i++) {
      const uid = String(100000000 + Math.floor(Math.random() * 900000000));
      const clash = await this.prisma.user.findUnique({ where: { uid } });
      if (!clash) return uid;
    }
    throw new BadRequestException('UID 分配失败');
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function ledgerLabel(bizType: string, refType?: string | null, remark?: string | null) {
  const rm = String(remark || '');
  if (rm.includes('上分佣金') || /客服上分佣金/.test(rm)) return '上分佣金';
  if (rm.includes('下分佣金') || /客服下分佣金/.test(rm)) return '下分佣金';
  if (rm.includes('佣金')) return '佣金入账';
  if (refType === 'console_quota') return bizType === 'TRANSFER_IN' ? '收到额度' : '下发额度';
  if (refType === 'console_quota_recall') {
    return bizType === 'TRANSFER_OUT' ? '被回收额度' : '回收额度入账';
  }
  if (refType === 'console_credit' || refType === 'console_credit_real' || refType === 'console_credit_cs') {
    return bizType === 'TRANSFER_OUT' ? '给玩家上分' : '玩家上分入账';
  }
  if (refType === 'console_debit' || refType === 'console_debit_cs') {
    return bizType === 'TRANSFER_IN' ? '玩家下分回收' : '玩家下分扣款';
  }
  if (refType === 'cs_alloc') return bizType === 'TRANSFER_IN' ? '代理划入额度' : '划给客服';
  if (refType === 'cs_recall') return bizType === 'TRANSFER_OUT' ? '代理收回额度' : '收回客服额度';
  if (refType === 'room_fund') return '房间注资';
  const map: Record<string, string> = {
    TRANSFER_IN: '转入',
    TRANSFER_OUT: '转出',
    RECHARGE: '充值',
    WITHDRAW: '提现',
    BET: '投注',
    WIN: '派奖',
    COMMISSION: '佣金',
    REBATE: '回水',
    ADJUST: '调账',
    FEE: '手续费',
    ACTIVITY: '活动',
  };
  return map[bizType] || bizType;
}

function adminActionLabel(action: string, detail: Record<string, unknown>) {
  if (action === 'QUOTA_SELL') {
    const from = detail.fromRole === 'BRANCH' ? '房主' : detail.fromRole === 'ADMIN' ? '管理员' : '上级';
    return `${from}下发额度`;
  }
  if (action === 'QUOTA_RECALL') {
    const by = detail.operatorRole === 'BRANCH' ? '房主' : detail.operatorRole === 'ADMIN' ? '管理员' : '上级';
    return `${by}回收额度`;
  }
  /* 玩家上下分入口只有代理和客服；子账号没有这条路，所以不再判 byProxy */
  if (action === 'CONSOLE_CREDIT') {
    return detail.byCs ? '客服给玩家上分' : '给玩家上分';
  }
  if (action === 'CONSOLE_DEBIT') {
    return detail.byCs ? '客服给玩家下分' : '给玩家下分';
  }
  if (action === 'CS_STAFF_ALLOC') return '划额度给客服';
  if (action === 'CS_STAFF_RECALL') return '收回客服额度';
  if (action === 'GENERAL_CREDIT_LIMIT_BUMP') {
    return detail.direction === 'down' ? '下调总代信用额度' : '上调总代信用额度';
  }
  const map: Record<string, string> = {
    AGENT_CREATE: '开通账号',
    CS_DUTY_SET: '设置值班',
    CS_DUTY_CLEAR: '清除值班',
    ROOM_FUND: '房间盘口注资(已废弃)',
    ROOM_CREATE: '创建房间',
    ROOM_SOFT_DELETE: '关闭房间',
    ROOM_DELETE: '删除房间',
    ROOM_STATUS: '变更房间状态',
    ROOM_BILLING_UPDATE: '修改月费',
    ROOM_ROTATE_CODE: '轮换进房码',
    ROOM_AGENT_RESET_PWD: '重置代理密码',
    ROOM_GRANT_OWNER: '授权房主可见',
    ROOM_REVOKE_OWNER: '取消房主可见',
    GENERAL_GRANT_OWNER: '授权总监可见总代',
    GENERAL_REVOKE_OWNER: '取消总监可见总代',
    ROOM_GAME_CONFIG: '修改房间游戏配置',
    RISK_EVENT_HANDLE: '处理风控告警',
    RISK_EVENT_BATCH_HANDLE: '批量处理风控',
  };
  return map[action] || action;
}
