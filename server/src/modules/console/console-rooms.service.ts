import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { asMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminLogService } from '../admin/admin-log.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';

function genRoomNo() {
  // 6 位数字进房码
  const n = (randomBytes(3).readUIntBE(0, 3) % 900000) + 100000;
  return String(n);
}

function genAgentUsername(roomName: string) {
  const base = roomName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'agent';
  const suffix = randomBytes(3).toString('hex').slice(0, 6);
  return `${base}${suffix}`.slice(0, 20);
}

function genPassword() {
  return `Ag${randomBytes(4).toString('hex')}9`;
}

/** 下次扣费：以 billingDay 为每月几号，并保留 from 的时分秒 */
function computeNextBillAt(from: Date, billingDay: number): Date {
  const day = Math.min(28, Math.max(1, billingDay));
  const y = from.getFullYear();
  const m = from.getMonth();
  const h = from.getHours();
  const mi = from.getMinutes();
  const s = from.getSeconds();
  let candidate = new Date(y, m, day, h, mi, s, 0);
  if (candidate.getTime() <= from.getTime()) {
    candidate = new Date(y, m + 1, day, h, mi, s, 0);
  }
  return candidate;
}

@Injectable()
export class ConsoleRoomsService {
  constructor(
    private prisma: PrismaService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
  ) {}

  async list(actor: ConsoleActor, opts?: { includeClosed?: boolean }) {
    const ids = await this.scope.grantedRoomIds(actor);
    const where: Record<string, unknown> = ids === null ? {} : { id: { in: ids } };
    // 默认不展示已关闭（软删除）房间
    if (!opts?.includeClosed) {
      where.status = { not: 'CLOSED' };
    }
    const rooms = await this.prisma.room.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        ownerAgent: {
          select: {
            id: true,
            userId: true,
            pointsQuota: true,
            pointsUsed: true,
            flyCover: true,
            user: { select: { uid: true, nickname: true, username: true } },
          },
        },
        ownerGrants: {
          select: {
            ownerId: true,
            owner: { select: { uid: true, nickname: true } },
          },
        },
        _count: { select: { members: true } },
      },
    });
    const agentUserIds = rooms
      .map((r) => r.ownerAgent?.userId)
      .filter((id): id is string => !!id);
    const balances = agentUserIds.length
      ? await this.prisma.pointsAccount.findMany({
          where: { ownerId: { in: agentUserIds } },
          select: { ownerId: true, balance: true },
        })
      : [];
    const balMap = new Map(balances.map((b) => [b.ownerId, asMoney(b.balance)]));

    return rooms.map((r) => ({
      id: r.id,
      roomNo: r.roomNo,
      name: r.name,
      title: r.title,
      status: r.status,
      enabledGames: safeJsonArr(r.enabledGames),
      memberCount: r._count.members,
      monthlyFee: asMoney(r.monthlyFee),
      billingDay: r.billingDay,
      nextBillAt: r.nextBillAt,
      lastBilledAt: r.lastBilledAt,
      agent: r.ownerAgent
        ? {
            agentId: r.ownerAgent.id,
            userId: r.ownerAgent.userId,
            uid: r.ownerAgent.user.uid,
            nickname: r.ownerAgent.user.nickname,
            username: r.ownerAgent.user.username,
            balance: balMap.get(r.ownerAgent.userId) ?? 0,
            pointsQuota: asMoney(r.ownerAgent.pointsQuota),
            pointsUsed: asMoney(r.ownerAgent.pointsUsed),
            flyCover: asMoney(r.ownerAgent.flyCover),
          }
        : null,
      owners: r.ownerGrants.map((g) => ({
        userId: g.ownerId,
        uid: g.owner.uid,
        nickname: g.owner.nickname,
      })),
      createdAt: r.createdAt,
    }));
  }

  /**
   * 创建房间 + 专属代理账号（一房一代理）。
   * - 超管：多选可见房主；未勾选的房主看不见本房
   * - 房主创建：默认授权全部房主可见；超管始终可见全量
   */
  async create(
    actor: ConsoleActor,
    body: {
      name: string;
      roomNo?: string;
      enabledGames?: string[];
      status?: string;
      robotCount?: number;
      ownerUserIds?: string[];
      agentUsername?: string;
      agentPassword?: string;
      agentNickname?: string;
      monthlyFee?: number;
      billingDay?: number;
      nextBillAt?: string;
    },
  ) {
    if (!this.scope.canCreateRoom(actor)) {
      throw new ForbiddenException('仅超管/房主可创建房间');
    }
    if (!body.name?.trim()) throw new BadRequestException('房间名必填');

    const status = body.status && ['OPEN', 'MAINTENANCE', 'FROZEN'].includes(body.status)
      ? body.status
      : 'OPEN';
    const games = Array.isArray(body.enabledGames)
      ? [...new Set(body.enabledGames.filter((g) => typeof g === 'string' && g.trim()))]
      : [];
    if (!games.length) throw new BadRequestException('请至少开通一个游戏');
    const robotCount = Math.min(50, Math.max(0, Number(body.robotCount ?? 10) || 0));
    const monthlyFee = Math.max(0, Math.floor(Number(body.monthlyFee ?? 0) || 0));
    const billingDay = Math.min(28, Math.max(1, Number(body.billingDay ?? 1) || 1));

    let username = (body.agentUsername || genAgentUsername(body.name)).toLowerCase().trim();
    if (!/^[a-z0-9]{8,20}$/.test(username)) {
      throw new BadRequestException('代理用户名须 8-20 位小写字母数字');
    }
    const plainPassword = body.agentPassword?.trim() || genPassword();
    if (plainPassword.length < 6) throw new BadRequestException('代理密码至少 6 位');
    const exists = await this.prisma.user.findUnique({ where: { username } });
    if (exists) throw new BadRequestException('代理用户名已存在，请更换');

    const actorUser = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!actorUser) throw new BadRequestException();

    // 房主可见授权（RoomOwnerGrant = 真正可见范围）
    let grantOwnerIds: string[] = [];
    if (actor.role === 'ADMIN') {
      const ids = Array.isArray(body.ownerUserIds) ? body.ownerUserIds.filter(Boolean) : [];
      if (ids.length) {
        const branches = await this.prisma.user.findMany({
          where: { id: { in: ids }, role: 'BRANCH' },
          select: { id: true },
        });
        grantOwnerIds = branches.map((b) => b.id);
      }
    } else if (actor.role === 'BRANCH') {
      // 房主创建：全部房主可见（超管天然全量可见）
      const allBranches = await this.prisma.user.findMany({
        where: { role: 'BRANCH', status: 'ACTIVE' },
        select: { id: true },
      });
      grantOwnerIds = allBranches.map((b) => b.id);
      if (!grantOwnerIds.includes(actor.id)) grantOwnerIds.push(actor.id);
    }

    // 代理挂靠：超管创建时挂到第一个房主下（若有）；房主创建挂到自己
    let parentId = actor.id;
    let agentPath = `${actorUser.agentPath}${actor.id}/`;
    let depth = actorUser.depth + 1;
    if (actor.role === 'ADMIN' && grantOwnerIds.length) {
      const parentBranch = await this.prisma.user.findUnique({ where: { id: grantOwnerIds[0] } });
      if (parentBranch) {
        parentId = parentBranch.id;
        agentPath = `${parentBranch.agentPath}${parentBranch.id}/`;
        depth = parentBranch.depth + 1;
      }
    } else if (actor.role === 'BRANCH') {
      parentId = actor.id;
      agentPath = `${actorUser.agentPath}${actor.id}/`;
      depth = actorUser.depth + 1;
    }

    const now = new Date();
    let nextBillAt: Date | null = null;
    if (monthlyFee > 0) {
      nextBillAt = body.nextBillAt
        ? new Date(body.nextBillAt)
        : computeNextBillAt(now, billingDay);
      if (Number.isNaN(nextBillAt.getTime())) {
        throw new BadRequestException('扣费日期无效');
      }
    }

    let roomNo = (body.roomNo ?? '').trim();
    if (roomNo) {
      if (!/^\d{6}$/.test(roomNo)) {
        throw new BadRequestException('房间号须为 6 位数字');
      }
      const clash = await this.prisma.room.findUnique({ where: { roomNo } });
      if (clash) throw new BadRequestException('房间号已被占用，请更换');
    } else {
      roomNo = genRoomNo();
      for (let i = 0; i < 8; i++) {
        const clash = await this.prisma.room.findUnique({ where: { roomNo } });
        if (!clash) break;
        roomNo = genRoomNo();
      }
    }

    const passwordHash = await bcrypt.hash(plainPassword, 10);
    const nickname = body.agentNickname?.trim() || `${body.name.trim()}代理`;
    const uid = await this.allocUid();

    const result = await this.prisma.$transaction(async (tx) => {
      const agentUser = await tx.user.create({
        data: {
          username,
          passwordHash,
          uid,
          nickname,
          role: 'AGENT',
          parentId,
          agentPath,
          depth,
        },
      });
      const agent = await tx.agent.create({ data: { userId: agentUser.id } });
      await tx.pointsAccount.create({
        data: { ownerType: 'AGENT', ownerId: agentUser.id, balance: 0 },
      });

      const room = await tx.room.create({
        data: {
          roomNo,
          name: body.name.trim(),
          ownerAgentId: agent.id,
          status,
          enabledGames: JSON.stringify(games),
          monthlyFee,
          billingDay,
          nextBillAt,
        },
      });

      await tx.roomGameConfig.createMany({
        data: games.map((gameCode) => ({
          roomId: room.id,
          gameCode,
          enabled: true,
          robotCount,
        })),
      });

      if (grantOwnerIds.length) {
        await tx.roomOwnerGrant.createMany({
          data: grantOwnerIds.map((ownerId) => ({ roomId: room.id, ownerId })),
          skipDuplicates: true,
        });
      }

      return { room, agentUser };
    });

    await this.adminLog.log(actor.id, 'ROOM_CREATE', result.room.id, {
      roomNo,
      name: result.room.name,
      agentUserId: result.agentUser.id,
      username,
      games,
      status,
      monthlyFee,
      billingDay,
      nextBillAt,
      grantOwnerIds,
    });

    return {
      id: result.room.id,
      roomNo: result.room.roomNo,
      name: result.room.name,
      status: result.room.status,
      monthlyFee,
      billingDay,
      nextBillAt,
      agent: {
        id: result.agentUser.id,
        uid: result.agentUser.uid,
        username,
        password: plainPassword,
        nickname: result.agentUser.nickname,
      },
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

  /**
   * 一房一代理、创建时绑定，禁止换绑。
   * 保留接口仅返回明确错误，避免旧客户端误用。
   */
  async bindAgent(_actor: ConsoleActor, _roomId: string, _agentUserId: string) {
    throw new ForbiddenException('房间代理不可更换，仅可在创建房间时生成专属账号');
  }

  /** 超管/房主重置本房代理密码（忘记密码） */
  async resetAgentPassword(
    actor: ConsoleActor,
    roomId: string,
    body?: { password?: string },
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅超管/房主可重置代理密码');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        ownerAgent: {
          include: { user: { select: { id: true, username: true, role: true } } },
        },
      },
    });
    if (!room) throw new NotFoundException('房间不存在');
    const agentUser = room.ownerAgent?.user;
    if (!agentUser) throw new BadRequestException('该房间尚未绑定代理账号');
    if (agentUser.role !== 'AGENT' && agentUser.role !== 'PROXY') {
      throw new BadRequestException('绑定账号不是代理');
    }

    const plainPassword = body?.password?.trim() || genPassword();
    if (plainPassword.length < 6) throw new BadRequestException('密码至少 6 位');

    const passwordHash = await bcrypt.hash(plainPassword, 10);
    await this.prisma.user.update({
      where: { id: agentUser.id },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
      },
    });
    await this.adminLog.log(actor.id, 'ROOM_AGENT_RESET_PWD', roomId, {
      agentUserId: agentUser.id,
      username: agentUser.username,
    });
    return {
      ok: true,
      username: agentUser.username,
      password: plainPassword,
      message: '密码已重置，请立即告知代理；旧登录态已失效',
    };
  }

  async grantOwner(actor: ConsoleActor, roomId: string, ownerUserId: string) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException('仅超管可授权房主可见');
    const owner = await this.prisma.user.findUnique({ where: { id: ownerUserId } });
    if (!owner || owner.role !== 'BRANCH') throw new BadRequestException('目标必须是房主(BRANCH)');
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('房间不存在');
    const grant = await this.prisma.roomOwnerGrant.upsert({
      where: { roomId_ownerId: { roomId, ownerId: ownerUserId } },
      update: {},
      create: { roomId, ownerId: ownerUserId },
    });
    await this.adminLog.log(actor.id, 'ROOM_GRANT_OWNER', roomId, { ownerUserId });
    return grant;
  }

  async revokeOwner(actor: ConsoleActor, roomId: string, ownerUserId: string) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException();
    await this.prisma.roomOwnerGrant.deleteMany({ where: { roomId, ownerId: ownerUserId } });
    await this.adminLog.log(actor.id, 'ROOM_REVOKE_OWNER', roomId, { ownerUserId });
    return { ok: true };
  }

  async setStatus(actor: ConsoleActor, roomId: string, status: string) {
    if (!['OPEN', 'MAINTENANCE', 'FROZEN', 'CLOSED'].includes(status)) {
      throw new BadRequestException('非法状态');
    }
    if (actor.role === 'AGENT' && status === 'CLOSED') {
      throw new ForbiddenException('代理不能关闭房间');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.update({ where: { id: roomId }, data: { status } });
    await this.adminLog.log(actor.id, 'ROOM_STATUS', roomId, { status });
    return room;
  }

  /** 调整月费（协商涨降价）；超管/房主可改 */
  async updateBilling(
    actor: ConsoleActor,
    roomId: string,
    body: { monthlyFee?: number; billingDay?: number; nextBillAt?: string | null },
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅超管/房主可调整月费');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('房间不存在');

    const data: {
      monthlyFee?: number;
      billingDay?: number;
      nextBillAt?: Date | null;
    } = {};

    if (body.monthlyFee !== undefined) {
      data.monthlyFee = Math.max(0, Math.floor(Number(body.monthlyFee) || 0));
    }
    if (body.billingDay !== undefined) {
      data.billingDay = Math.min(28, Math.max(1, Math.floor(Number(body.billingDay) || 1)));
    }
    if (body.nextBillAt !== undefined) {
      if (body.nextBillAt === null || body.nextBillAt === '') {
        data.nextBillAt = null;
      } else {
        const d = new Date(body.nextBillAt);
        if (Number.isNaN(d.getTime())) throw new BadRequestException('下次扣费日期无效');
        data.nextBillAt = d;
      }
    }

    const nextFee = data.monthlyFee ?? asMoney(room.monthlyFee);
    const nextDay = data.billingDay ?? room.billingDay;

    // 从不收费改为收费，且未指定下次扣费日 → 默认下月同日 0 点
    if (nextFee > 0) {
      const willHaveNext =
        data.nextBillAt !== undefined ? data.nextBillAt : room.nextBillAt;
      if (!willHaveNext) {
        data.nextBillAt = computeNextBillAt(new Date(), nextDay);
      }
    } else if (data.monthlyFee === 0) {
      data.nextBillAt = null;
    }

    const updated = await this.prisma.room.update({
      where: { id: roomId },
      data,
    });
    await this.adminLog.log(actor.id, 'ROOM_BILLING_UPDATE', roomId, {
      before: {
        monthlyFee: asMoney(room.monthlyFee),
        billingDay: room.billingDay,
        nextBillAt: room.nextBillAt,
      },
      after: {
        monthlyFee: asMoney(updated.monthlyFee),
        billingDay: updated.billingDay,
        nextBillAt: updated.nextBillAt,
      },
    });
    return {
      monthlyFee: asMoney(updated.monthlyFee),
      billingDay: updated.billingDay,
      nextBillAt: updated.nextBillAt,
      lastBilledAt: updated.lastBilledAt,
    };
  }

  /**
   * 删除房间：
   * - 无成员、无局记录 → 物理删除
   * - 已有业务数据 → 改为 CLOSED（软删除，列表默认隐藏）
   */
  async remove(actor: ConsoleActor, roomId: string) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('仅超管可删除房间');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        _count: { select: { members: true, gameRounds: true } },
      },
    });
    if (!room) throw new NotFoundException('房间不存在');

    const hasBiz = room._count.members > 0 || room._count.gameRounds > 0;
    if (hasBiz) {
      await this.prisma.room.update({ where: { id: roomId }, data: { status: 'CLOSED' } });
      await this.adminLog.log(actor.id, 'ROOM_SOFT_DELETE', roomId, {
        members: room._count.members,
        gameRounds: room._count.gameRounds,
      });
      return {
        ok: true,
        mode: 'closed' as const,
        message: '房间已有成员或对局记录，已关闭并从列表隐藏（数据保留）',
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.roomGameConfig.deleteMany({ where: { roomId } });
      await tx.roomOwnerGrant.deleteMany({ where: { roomId } });
      await tx.roomChatMessage.deleteMany({ where: { roomId } });
      await tx.controlPolicy.deleteMany({ where: { roomId } });
      await tx.pointsAccount.deleteMany({ where: { ownerType: 'ROOM', ownerId: roomId } });
      await tx.room.delete({ where: { id: roomId } });
    });
    await this.adminLog.log(actor.id, 'ROOM_DELETE', roomId, { name: room.name, roomNo: room.roomNo });
    return { ok: true, mode: 'deleted' as const, message: '房间已删除' };
  }

  async rotateCode(actor: ConsoleActor, roomId: string) {
    if (actor.role === 'AGENT') throw new ForbiddenException();
    await this.scope.assertRoomAccess(actor, roomId);
    let roomNo = genRoomNo();
    for (let i = 0; i < 8; i++) {
      if (!(await this.prisma.room.findUnique({ where: { roomNo } }))) break;
      roomNo = genRoomNo();
    }
    const room = await this.prisma.room.update({ where: { id: roomId }, data: { roomNo } });
    await this.adminLog.log(actor.id, 'ROOM_ROTATE_CODE', roomId, { roomNo });
    return room;
  }

  async getGameConfigs(actor: ConsoleActor, roomId: string) {
    await this.scope.assertRoomAccess(actor, roomId);
    return this.prisma.roomGameConfig.findMany({ where: { roomId }, orderBy: { gameCode: 'asc' } });
  }

  async upsertGameConfig(
    actor: ConsoleActor,
    roomId: string,
    gameCode: string,
    data: { enabled?: boolean; robotCount?: number; rebateRate?: number | null },
  ) {
    await this.scope.assertRoomAccess(actor, roomId);
    if (data.robotCount != null) {
      const n = Math.floor(Number(data.robotCount));
      if (n < 0 || n > 50) throw new BadRequestException('机器人数量 0~50');
      data.robotCount = n;
    }
    if (data.rebateRate !== undefined && data.rebateRate != null) {
      const policy = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
      const T = policy?.totalRate ?? 0.05;
      const minP = policy?.playerMinRate ?? 0.018;
      const maxP = T / 2;
      const P = Number(data.rebateRate);
      if (!Number.isFinite(P) || P < minP || P > maxP) {
        throw new BadRequestException(
          `玩家回水须在 ${(minP * 100).toFixed(2)}% ~ ${(maxP * 100).toFixed(2)}%（总额 T=${(T * 100).toFixed(2)}%，且不超过 T/2）`,
        );
      }
      data.rebateRate = Math.round(P * 10000) / 10000;
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const cfg = await tx.roomGameConfig.upsert({
        where: { roomId_gameCode: { roomId, gameCode } },
        update: {
          ...(data.enabled != null ? { enabled: data.enabled } : {}),
          ...(data.robotCount != null ? { robotCount: data.robotCount } : {}),
          ...(data.rebateRate !== undefined ? { rebateRate: data.rebateRate } : {}),
        },
        create: {
          roomId,
          gameCode,
          enabled: data.enabled ?? true,
          robotCount: data.robotCount ?? 10,
          rebateRate: data.rebateRate ?? null,
        },
      });
      // 与大厅开通列表对齐
      const all = await tx.roomGameConfig.findMany({
        where: { roomId, enabled: true },
        select: { gameCode: true },
      });
      await tx.room.update({
        where: { id: roomId },
        data: { enabledGames: JSON.stringify(all.map((g) => g.gameCode)) },
      });
      // 「默认玩家 P」同步到房主代理，并统一本房各游戏配置（避免 UI 各游戏显示不一致）
      if (data.rebateRate != null) {
        const room = await tx.room.findUnique({
          where: { id: roomId },
          select: { ownerAgent: { select: { userId: true } } },
        });
        if (room?.ownerAgent?.userId) {
          await tx.agent.update({
            where: { userId: room.ownerAgent.userId },
            data: { rebateRate: data.rebateRate },
          });
        }
        await tx.roomGameConfig.updateMany({
          where: { roomId },
          data: { rebateRate: data.rebateRate },
        });
      }
      return cfg;
    });
    await this.adminLog.log(actor.id, 'ROOM_GAME_CONFIG', roomId, { gameCode, data });
    return row;
  }

  async detail(actor: ConsoleActor, roomId: string) {
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        ownerAgent: {
          include: {
            user: {
              select: {
                id: true, uid: true, nickname: true, username: true, status: true, createdAt: true,
              },
            },
          },
        },
        ownerGrants: {
          include: {
            owner: { select: { id: true, uid: true, nickname: true, username: true } },
          },
        },
        gameConfigs: true,
        _count: { select: { members: true, gameRounds: true } },
      },
    });
    if (!room) throw new NotFoundException('房间不存在');

    let agentBalance: number | null = null;
    if (room.ownerAgent?.userId) {
      const acc = await this.prisma.pointsAccount.findUnique({
        where: { ownerId: room.ownerAgent.userId },
      });
      agentBalance = asMoney(acc?.balance ?? 0);
    }

    const enabledGames = safeJsonArr(room.enabledGames);
    return {
      id: room.id,
      roomNo: room.roomNo,
      name: room.name,
      title: room.title,
      status: room.status,
      enabledGames,
      monthlyFee: asMoney(room.monthlyFee),
      billingDay: room.billingDay,
      nextBillAt: room.nextBillAt,
      lastBilledAt: room.lastBilledAt,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      memberCount: room._count.members,
      roundCount: room._count.gameRounds,
      gameConfigs: room.gameConfigs,
      ownerAgent: room.ownerAgent
        ? {
            agentId: room.ownerAgent.id,
            userId: room.ownerAgent.userId,
            flyCover: asMoney(room.ownerAgent.flyCover),
            pointsQuota: asMoney(room.ownerAgent.pointsQuota),
            pointsUsed: asMoney(room.ownerAgent.pointsUsed),
            rebateRate: room.ownerAgent.rebateRate,
            balance: agentBalance,
            user: room.ownerAgent.user,
          }
        : null,
      ownerGrants: room.ownerGrants,
      _count: room._count,
    };
  }
}

function safeJsonArr(s: string): string[] {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
