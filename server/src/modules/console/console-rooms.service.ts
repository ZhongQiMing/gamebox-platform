import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { asMoney, roundMoney, validateOpsPassword } from '@gamebox/shared';
import { PASSWORD_SALT_ROUNDS } from '../../common/security.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminLogService } from '../admin/admin-log.service';
import { HangService } from '../agents/hang.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import {
  normalizeSettleCycle,
  settleCycleToWeekday,
} from './room-settle.service';
import {
  computeCreditBook,
  cashDiskFlyAvailable,
  sumAgentCsBalances,
  sumAgentCsBalancesMap,
  sumRoomPlayerBalances,
} from './credit-settle.helper';
import { writeAgentQuotaInTx } from './player-fund.helper';
import { rethrowUserUniqueConflict, throwUsernameTaken } from '../../common/utils/user-unique';
import { normalizeRobotPlan } from '../rooms/robot-plan.util';
import { pickAvatarUniqueInTx } from '../users/avatar-assign';
import {
  displayRoomIcon,
  saveRoomIconFromDataUrl,
} from './room-icon.util';

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

/** 报表可见名称只允许普通文字，长度限制也避免导出/日志被异常长值污染。 */
function safeDisplayName(raw: unknown, label: string, maxLength: number): string {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!value) throw new BadRequestException(`${label}必填`);
  if (value.length > maxLength) {
    throw new BadRequestException(`${label}最多 ${maxLength} 字`);
  }
  if (!/^[\p{L}\p{N}·][\p{L}\p{N}· _().（）-]*$/u.test(value)) {
    throw new BadRequestException(
      `${label}仅支持中文、字母、数字、空格及 _-.()`,
    );
  }
  return value;
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
  private readonly logger = new Logger(ConsoleRoomsService.name);

  constructor(
    private prisma: PrismaService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
    private hang: HangService,
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
            flowRate: true,
            shareRate: true,
            user: { select: { uid: true, nickname: true, username: true } },
          },
        },
        generalAgent: {
          select: {
            id: true,
            userId: true,
            flowRate: true,
            shareRate: true,
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
          where: { ownerId: { in: agentUserIds }, ownerType: 'AGENT', roomId: '' },
          select: { ownerId: true, balance: true },
        })
      : [];
    const balMap = new Map(balances.map((b) => [b.ownerId, asMoney(b.balance)]));

    const roomIds = rooms.map((r) => r.id);
    const flyMembers = roomIds.length
      ? await this.prisma.roomMember.findMany({
          where: { roomId: { in: roomIds }, status: 'APPROVED' },
          select: { roomId: true, flyEnabled: true },
        })
      : [];
    const flyMap = new Map<string, { onCount: number; offCount: number; memberCount: number }>();
    for (const m of flyMembers) {
      const cur = flyMap.get(m.roomId) || { onCount: 0, offCount: 0, memberCount: 0 };
      cur.memberCount += 1;
      if (m.flyEnabled !== false) cur.onCount += 1;
      else cur.offCount += 1;
      flyMap.set(m.roomId, cur);
    }

    const csMap = await sumAgentCsBalancesMap(
      this.prisma,
      agentUserIds,
    );

    return rooms.map((r) => {
      const fly = flyMap.get(r.id) || { onCount: 0, offCount: 0, memberCount: 0 };
      const bookMode = r.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH';
      const bal = r.ownerAgent ? balMap.get(r.ownerAgent.userId) ?? 0 : 0;
      const quota = r.ownerAgent ? asMoney(r.ownerAgent.pointsQuota) : 0;
      const csBal = r.ownerAgent ? csMap.get(r.ownerAgent.userId) ?? 0 : 0;
      /* 现金：上盘可飞 = 代理余额 + 客服未发出 */
      const flyCover =
        bookMode === 'CREDIT' ? 0 : roundMoney(Math.max(0, bal) + Math.max(0, csBal));
      return {
        id: r.id,
        roomNo: r.roomNo,
        name: r.name,
        title: r.title,
        icon: displayRoomIcon(r.icon),
        status: r.status,
        enabledGames: safeJsonArr(r.enabledGames),
        memberCount: r._count.members,
        monthlyFee: asMoney(r.monthlyFee),
        billingDay: r.billingDay,
        nextBillAt: r.nextBillAt,
        lastBilledAt: r.lastBilledAt,
        overIssueEnabled: false,
        overIssueLimit: 0,
        overIssueUsed: 0,
        bookMode,
        agentShareRate: Number(r.agentShareRate ?? 0),
        generalFlyEnabled: r.generalFlyEnabled !== false,
        general: r.generalAgent
          ? {
              agentId: r.generalAgent.id,
              userId: r.generalAgent.userId,
              uid: r.generalAgent.user.uid,
              nickname: r.generalAgent.user.nickname,
              username: r.generalAgent.user.username,
              flowRate: Number(r.generalAgent.flowRate ?? 0),
              shareRate: Number(r.generalAgent.shareRate ?? 0),
            }
          : null,
        creditLimit: asMoney(r.creditLimit),
        settleCycle: normalizeSettleCycle(r.settleCycle),
        settleWeekday: r.settleWeekday ?? 1,
        fly: {
          onCount: fly.onCount,
          offCount: fly.offCount,
          memberCount: fly.memberCount,
          effective:
            bookMode === 'CREDIT'
              ? fly.onCount > 0
              : flyCover > 0 && fly.onCount > 0,
          flyCover,
        },
        agent: r.ownerAgent
          ? {
              agentId: r.ownerAgent.id,
              userId: r.ownerAgent.userId,
              uid: r.ownerAgent.user.uid,
              nickname: r.ownerAgent.user.nickname,
              username: r.ownerAgent.user.username,
              balance: bal,
              pointsQuota: quota,
              diskPoolRemaining: roundMoney(Math.max(0, quota) + Math.max(0, csBal)),
              csBalances: csBal,
              pointsUsed: asMoney(r.ownerAgent.pointsUsed),
              flyCover,
            }
          : null,
        owners: r.ownerGrants.map((g) => ({
          userId: g.ownerId,
          uid: g.owner.uid,
          nickname: g.owner.nickname,
        })),
        createdAt: r.createdAt,
      };
    });
  }

  /**
   * 创建房间 + 专属代理账号（一房一代理）。
   * - 超管：多选可见房主；未勾选的房主看不见本房
   * - 房主创建：仅自己可见；超管始终可见全量；其他房主须管理员勾选「可见房主」
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
      /** CASH=A 现金盘 | CREDIT=B 信用盘 */
      bookMode?: string;
      generalAgentUserId?: string;
      agentFlowRate?: number;
      agentShareRate?: number;
      /** B 信用额度 */
      creditLimit?: number;
      /** A 超分：现金盘不设上限（忽略此字段）；B 忽略 */
      overIssueLimit?: number;
      settleCycle?: string;
      /** 建房时可选：房间图标 data URL（JPG/PNG/WEBP） */
      iconImage?: string;
    },
  ) {
    if (!this.scope.canCreateRoom(actor)) {
      throw new ForbiddenException('仅管理/总监/总代可创建房间');
    }
    const roomName = safeDisplayName(body.name, '房间名', 40);

    const status = body.status && ['OPEN', 'MAINTENANCE', 'FROZEN'].includes(body.status)
      ? body.status
      : 'OPEN';
    const games = Array.isArray(body.enabledGames)
      ? [...new Set(body.enabledGames.filter((g) => typeof g === 'string' && g.trim()))]
      : [];
    if (!games.length) throw new BadRequestException('请至少开通一个游戏');
    const robotCount = Math.min(50, Math.max(0, Number(body.robotCount ?? 10) || 0));
    const bookMode = body.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH';
    const monthlyFee = Math.max(0, Math.floor(Number(body.monthlyFee ?? 0) || 0));
    const billingDay = Math.min(28, Math.max(1, Number(body.billingDay ?? 1) || 1));
    let generalAgentRow: { id: string; userId: string; flowRate: number; shareRate: number } | null = null;
    let generalUserId = String(body.generalAgentUserId || '').trim();
    if (actor.role === 'GENERAL') {
      generalUserId = actor.id;
    }
    if (generalUserId) {
      const gu = await this.prisma.user.findUnique({
        where: { id: generalUserId },
        select: { id: true, role: true, agent: { select: { id: true, flowRate: true, shareRate: true } } },
      });
      if (!gu || gu.role !== 'GENERAL' || !gu.agent) {
        throw new BadRequestException('总代账号无效');
      }
      generalAgentRow = {
        id: gu.agent.id,
        userId: gu.id,
        flowRate: Number(gu.agent.flowRate ?? 0.07),
        shareRate: Number(gu.agent.shareRate ?? 0.5),
      };
    }

    let agentShareRate = Number(body.agentShareRate);
    if (!Number.isFinite(agentShareRate)) agentShareRate = 0.5;
    if (agentShareRate > 1) agentShareRate = agentShareRate / 100;
    const shareCap = generalAgentRow ? Math.min(0.7, generalAgentRow.shareRate) : 0.5;
    if (agentShareRate < 0 || agentShareRate > shareCap + 1e-9) {
      throw new BadRequestException(`代理占成须在 0%～${(shareCap * 100).toFixed(0)}%`);
    }

    const policy = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    let agentFlowRate = Number(body.agentFlowRate);
    if (!Number.isFinite(agentFlowRate)) agentFlowRate = Number(policy?.agentDefaultRate ?? 0.05);
    if (agentFlowRate > 1) agentFlowRate = agentFlowRate / 100;
    const flowCap = generalAgentRow ? generalAgentRow.flowRate : Number(policy?.agentDefaultRate ?? 0.05);
    if (agentFlowRate < 0.018 || agentFlowRate > flowCap + 1e-9) {
      throw new BadRequestException(`代理流水整包须在 1.8%～${(flowCap * 100).toFixed(1)}%`);
    }

    let creditLimit = 0;
    let overIssueEnabled = false;
    let overIssueLimit = 0;
    if (bookMode === 'CREDIT') {
      creditLimit = Math.max(0, Math.floor(Number(body.creditLimit ?? 0) || 0));
      if (creditLimit <= 0) throw new BadRequestException('信用盘须设置信用额度（大于 0）');
      overIssueEnabled = false;
      overIssueLimit = 0;
      // 信用盘月费进结账摊销，不走余额自动扣（下方 nextBillAt 置空）
    } else {
      /* A 现金：允许超分且不设上限（limit=0 表示不限） */
      overIssueEnabled = true;
      overIssueLimit = 0;
    }
    const settleCycle = normalizeSettleCycle(body.settleCycle);
    const settleWeekday = settleCycleToWeekday(settleCycle);

    const username = (body.agentUsername || genAgentUsername(roomName)).toLowerCase().trim();
    if (!/^[a-z0-9]{8,20}$/.test(username)) {
      throw new BadRequestException('代理用户名须 8-20 位小写字母数字');
    }
    const plainPassword = body.agentPassword?.trim() || genPassword();
    const agentPwdErr = validateOpsPassword(plainPassword, '代理密码');
    if (agentPwdErr) throw new BadRequestException(agentPwdErr);
    const exists = await this.prisma.user.findUnique({ where: { username } });
    if (exists) throwUsernameTaken();

    const actorUser = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!actorUser) throw new BadRequestException();

    // 总监可见授权
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
    } else if (actor.role === 'BRANCH' || actor.role === 'GENERAL') {
      /* 总监/总代开的房：所有总监可见，报表共用 */
      const allDirectors = await this.prisma.user.findMany({
        where: { role: 'BRANCH', status: 'ACTIVE' },
        select: { id: true },
      });
      grantOwnerIds = allDirectors.map((b) => b.id);
      if (actor.role === 'BRANCH' && !grantOwnerIds.includes(actor.id)) {
        grantOwnerIds.push(actor.id);
      }
    }

    // 代理挂靠：有总代挂总代，否则挂创建人
    let parentId = actor.id;
    let agentPath = `${actorUser.agentPath}${actor.id}/`;
    let depth = actorUser.depth + 1;
    if (generalAgentRow) {
      const parentG = await this.prisma.user.findUnique({ where: { id: generalAgentRow.userId } });
      if (parentG) {
        parentId = parentG.id;
        agentPath = `${parentG.agentPath}${parentG.id}/`;
        depth = parentG.depth + 1;
      }
    } else if (actor.role === 'ADMIN' && grantOwnerIds.length) {
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
    // 现金盘：排自动扣费日；信用盘：同样排「下次月费日」供结账判断（≤7天进本期），但不自动扣余额
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

    const passwordHash = await bcrypt.hash(plainPassword, PASSWORD_SALT_ROUNDS);
    const uid = await this.allocUid();
    const nickname = safeDisplayName(
      body.agentNickname || `代理${uid.slice(-4)}`,
      '代理昵称',
      20,
    );

    let result: { room: { id: string; roomNo: string; name: string; status: string }; agentUser: { id: string; username: string; uid: string; nickname: string } };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const avatar = await pickAvatarUniqueInTx(tx);
        const agentUser = await tx.user.create({
          data: {
            username,
            passwordHash,
            uid,
            nickname,
            avatar,
            role: 'AGENT',
            parentId,
            agentPath,
            depth,
          },
        });
        const agent = await tx.agent.create({
          data: {
            userId: agentUser.id,
            flowRate: agentFlowRate,
            shareRate: agentShareRate,
            rebateRate: 0.018,
          },
        });
        // B：信用额度写入上盘额度库存；A：从 0 起，后续买入额度
        if (bookMode === 'CREDIT' && creditLimit > 0) {
          /*
           * 挂了总代的房，这笔期初额度是总代给的分，要从他手上划走；没挂总代才由平台直接出。
           * 额度不够也照给，超出部分记成他欠平台的——与代理给玩家超分同一套规矩，
           * 收不回来是总代自己垫。锁行只为并发时额度扣减不丢。
           */
          if (generalAgentRow) {
            await tx.$queryRaw`SELECT id FROM "Agent" WHERE "id" = ${generalAgentRow.id} FOR UPDATE`;
            await writeAgentQuotaInTx(tx, {
              agentUserId: generalAgentRow.userId,
              bookMode: 'CREDIT',
              delta: -creditLimit,
              bizType: 'TRANSFER_OUT',
              remark: `开房拨给代理期初额度 ${creditLimit}`,
              refType: 'agent_open',
              refId: agentUser.id,
              idempotencyKey: `agent_open_general:${agentUser.id}`,
            });
          }
          await writeAgentQuotaInTx(tx, {
            agentUserId: agentUser.id,
            bookMode: 'CREDIT',
            delta: creditLimit,
            bizType: 'OPEN',
            remark: `建号期初信用额度 ${creditLimit}`,
            refType: 'agent_open',
            refId: agentUser.id,
            idempotencyKey: `agent_open:${agentUser.id}`,
          });
        }
        await tx.pointsAccount.create({
          data: { ownerType: 'AGENT', ownerId: agentUser.id, roomId: '', balance: 0 },
        });

        const room = await tx.room.create({
          data: {
            roomNo,
            name: roomName,
            ownerAgentId: agent.id,
            generalAgentId: generalAgentRow?.id ?? null,
            status,
            enabledGames: JSON.stringify(games),
            monthlyFee,
            billingDay,
            nextBillAt,
            overIssueEnabled,
            overIssueLimit,
            overIssueUsed: 0,
            bookMode,
            agentShareRate,
            creditLimit,
            settleCycle,
            settleWeekday,
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
    } catch (e: unknown) {
      rethrowUserUniqueConflict(e);
    }

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
      bookMode,
      agentShareRate,
      creditLimit,
      overIssueEnabled,
      overIssueLimit,
      settleCycle,
      settleWeekday,
    });

    let iconPath: string | null = null;
    if (body.iconImage) {
      iconPath = await saveRoomIconFromDataUrl(result.room.id, body.iconImage);
      await this.prisma.room.update({
        where: { id: result.room.id },
        data: { icon: iconPath },
      });
    }

    return {
      id: result.room.id,
      roomNo: result.room.roomNo,
      name: result.room.name,
      icon: displayRoomIcon(iconPath),
      status: result.room.status,
      monthlyFee,
      billingDay,
      nextBillAt,
      bookMode,
      agentShareRate,
      creditLimit,
      settleCycle,
      settleWeekday,
      overIssueEnabled,
      overIssueLimit,
      overIssueUsed: 0,
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
  bindAgent(_actor: ConsoleActor, _roomId: string, _agentUserId: string): never {
    throw new ForbiddenException('房间代理不可更换，仅可在创建房间时生成专属账号');
  }

  /** 超管/房主重置本房代理密码（忘记密码） */
  async resetAgentPassword(
    actor: ConsoleActor,
    roomId: string,
    body?: { password?: string },
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅管理员/房主可重置代理密码');
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
    if (agentUser.role === 'ADMIN') {
      throw new ForbiddenException('不能重置管理员密码（忘记只能改数据库）');
    }
    if (agentUser.role !== 'AGENT' && agentUser.role !== 'PROXY') {
      throw new BadRequestException('绑定账号不是代理');
    }

    const plainPassword = body?.password?.trim() || genPassword();
    const resetPwdErr = validateOpsPassword(plainPassword);
    if (resetPwdErr) throw new BadRequestException(resetPwdErr);

    const passwordHash = await bcrypt.hash(plainPassword, PASSWORD_SALT_ROUNDS);
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
    if (actor.role !== 'ADMIN') throw new ForbiddenException('仅管理员可授权房主可见');
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

  /** 上传/更换房间图标（管理/房主/本房代理）；禁止外链 */
  async updateIcon(actor: ConsoleActor, roomId: string, dataUrl: string) {
    if (!['ADMIN', 'BRANCH', 'GENERAL', 'AGENT'].includes(actor.role)) {
      throw new ForbiddenException('无权修改房间图标');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const icon = await saveRoomIconFromDataUrl(roomId, dataUrl);
    await this.prisma.room.update({ where: { id: roomId }, data: { icon } });
    await this.adminLog.log(actor.id, 'ROOM_ICON', roomId, { icon });
    return { icon: displayRoomIcon(icon) };
  }

  async setStatus(actor: ConsoleActor, roomId: string, status: string) {
    if (!['OPEN', 'MAINTENANCE', 'FROZEN', 'CLOSED'].includes(status)) {
      throw new BadRequestException('非法状态');
    }
    if ((actor.role === 'AGENT' || actor.role === 'GENERAL') && status === 'CLOSED') {
      throw new ForbiddenException('关闭房间需要管理或总监操作');
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
      throw new ForbiddenException('仅管理员/房主可调整月费');
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

    if (nextFee > 0) {
      // 现金/信用都排下次月费日；信用盘只用于结账归属，billing 扫描仍跳过 CREDIT
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
   * 删除房间 = 关闭（CLOSED），数据保留。
   * 列表默认隐藏，勾选「显示已关闭」可查看；不做物理删除。
   */
  async remove(actor: ConsoleActor, roomId: string) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('仅管理员可删除房间');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        _count: { select: { members: true, gameRounds: true } },
      },
    });
    if (!room) {
      return { ok: true, mode: 'gone' as const, message: '房间已不存在' };
    }
    if (room.status === 'CLOSED') {
      return {
        ok: true,
        mode: 'closed' as const,
        message: '房间已是关闭状态。勾选「显示已关闭」可查看',
      };
    }
    await this.prisma.room.update({ where: { id: roomId }, data: { status: 'CLOSED' } });
    await this.adminLog.log(actor.id, 'ROOM_SOFT_DELETE', roomId, {
      name: room.name,
      roomNo: room.roomNo,
      members: room._count.members,
      gameRounds: room._count.gameRounds,
    });
    return {
      ok: true,
      mode: 'closed' as const,
      message: '房间已关闭。勾选「显示已关闭」可查看',
    };
  }

  // 进房码仅创建时可设，创建后不可换——换码逻辑停用
  // async rotateCode(actor: ConsoleActor, roomId: string) {
  //   if (actor.role === 'AGENT') throw new ForbiddenException();
  //   await this.scope.assertRoomAccess(actor, roomId);
  //   let roomNo = genRoomNo();
  //   for (let i = 0; i < 8; i++) {
  //     if (!(await this.prisma.room.findUnique({ where: { roomNo } }))) break;
  //     roomNo = genRoomNo();
  //   }
  //   const room = await this.prisma.room.update({ where: { id: roomId }, data: { roomNo } });
  //   await this.adminLog.log(actor.id, 'ROOM_ROTATE_CODE', roomId, { roomNo });
  //   return room;
  // }

  async getGameConfigs(actor: ConsoleActor, roomId: string) {
    await this.scope.assertRoomAccess(actor, roomId);
    return this.prisma.roomGameConfig.findMany({ where: { roomId }, orderBy: { gameCode: 'asc' } });
  }

  /**
   * 代理/子账号以本房成员身份进桌（信用盘手机「游戏大厅」）。
   * 直接 APPROVED，不走玩家进房审核。
   */
  async playEnter(actor: ConsoleActor, roomId: string) {
    if (!['AGENT', 'PROXY', 'ADMIN', 'BRANCH'].includes(actor.role)) {
      throw new ForbiddenException('无权进入游戏大厅');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, roomNo: true, name: true, icon: true, status: true },
    });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.status !== 'OPEN') throw new BadRequestException('该房间已关闭');

    await this.prisma.roomMember.upsert({
      where: { playerId_roomId: { playerId: actor.id, roomId: room.id } },
      create: { playerId: actor.id, roomId: room.id, status: 'APPROVED' },
      update: { status: 'APPROVED' },
    });

    return {
      roomNo: room.roomNo,
      name: room.name,
      icon: displayRoomIcon(room.icon),
      memberStatus: 'APPROVED' as const,
      roomId: room.id,
    };
  }

  async upsertGameConfig(
    actor: ConsoleActor,
    roomId: string,
    gameCode: string,
    data: {
      enabled?: boolean
      robotCount?: number
      rebateRate?: number | null
      robotPlan?: unknown
    },
  ) {
    await this.scope.assertRoomAccess(actor, roomId);
    if (data.robotCount != null) {
      const n = Math.floor(Number(data.robotCount));
      if (n < 0 || n > 50) throw new BadRequestException('机器人数量 0~50');
      data.robotCount = n;
    }
    let robotPlanNorm: ReturnType<typeof normalizeRobotPlan> | undefined;
    if (data.robotPlan !== undefined) {
      robotPlanNorm = normalizeRobotPlan(data.robotPlan, data.robotCount);
      data.robotCount = robotPlanNorm.robotCount;
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
          ...(robotPlanNorm ? { robotPlan: robotPlanNorm } : {}),
        },
        create: {
          roomId,
          gameCode,
          enabled: data.enabled ?? true,
          robotCount: data.robotCount ?? 10,
          rebateRate: data.rebateRate ?? null,
          robotPlan: robotPlanNorm ?? undefined,
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
        generalAgent: {
          select: {
            id: true,
            userId: true,
            flowRate: true,
            shareRate: true,
            user: { select: { uid: true, nickname: true, username: true } },
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
      const acc = await this.prisma.pointsAccount.findFirst({
        where: { ownerType: 'AGENT', ownerId: room.ownerAgent.userId, roomId: '' },
      });
      agentBalance = asMoney(acc?.balance ?? 0);
    }

    // 本房玩家当前积分合计 + 飞盘开/关人数
    const members = await this.prisma.roomMember.findMany({
      where: { roomId, status: 'APPROVED' },
      select: { playerId: true, flyEnabled: true },
    });
    const memberPlayerIds = members.map((m) => m.playerId);
    let playerPointsTotal = 0;
    if (memberPlayerIds.length) {
      const playerAccs = await this.prisma.pointsAccount.findMany({
        where: {
          ownerId: { in: memberPlayerIds },
          ownerType: 'PLAYER',
          roomId,
        },
        select: { balance: true },
      });
      for (const a of playerAccs) playerPointsTotal += asMoney(a.balance);
    }
    const flyOnCount = members.filter((m) => m.flyEnabled !== false).length;
    const flyOffCount = members.length - flyOnCount;

    const enabledGames = safeJsonArr(room.enabledGames);
    const bookMode = room.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH';
    const creditLimit = asMoney(room.creditLimit);
    const pointsQuota = room.ownerAgent ? asMoney(room.ownerAgent.pointsQuota) : 0;
    const csBalances = room.ownerAgent?.userId
      ? await sumAgentCsBalances(this.prisma, room.ownerAgent.userId)
      : 0;
    const flyCover =
      bookMode === 'CREDIT'
        ? 0
        : await cashDiskFlyAvailable(this.prisma, room.ownerAgent?.userId);
    const creditBook =
      bookMode === 'CREDIT' && creditLimit > 0
        ? computeCreditBook({
            creditLimit,
            pointsQuota,
            playerBalances: asMoney(playerPointsTotal),
            csBalances,
            agentShareRate: Number(room.agentShareRate ?? 0),
          })
        : null;
    return {
      id: room.id,
      roomNo: room.roomNo,
      name: room.name,
      title: room.title,
      icon: displayRoomIcon(room.icon),
      status: room.status,
      enabledGames,
      monthlyFee: asMoney(room.monthlyFee),
      billingDay: room.billingDay,
      nextBillAt: room.nextBillAt,
      lastBilledAt: room.lastBilledAt,
      overIssueEnabled: false,
      overIssueLimit: 0,
      overIssueUsed: 0,
      bookMode,
      agentShareRate: Number(room.agentShareRate ?? 0),
      generalFlyEnabled: room.generalFlyEnabled !== false,
      general: room.generalAgent
        ? {
            agentId: room.generalAgent.id,
            userId: room.generalAgent.userId,
            uid: room.generalAgent.user.uid,
            nickname: room.generalAgent.user.nickname,
            username: room.generalAgent.user.username,
            flowRate: Number(room.generalAgent.flowRate ?? 0),
            shareRate: Number(room.generalAgent.shareRate ?? 0),
          }
        : null,
      creditLimit,
      settleCycle: normalizeSettleCycle(room.settleCycle),
      settleWeekday: room.settleWeekday ?? 1,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      memberCount: room._count.members,
      roundCount: room._count.gameRounds,
      gameConfigs: room.gameConfigs,
      playerPointsTotal: asMoney(playerPointsTotal),
      creditBook,
      fly: {
        onCount: flyOnCount,
        offCount: flyOffCount,
        memberCount: members.length,
        /** 现金盘：上盘额度>0 且有人开飞盘；信用盘：有人开飞盘即走平台 */
        effective:
          bookMode === 'CREDIT'
            ? flyOnCount > 0
            : flyCover > 0 && flyOnCount > 0,
        flyCover,
      },
      ownerAgent: room.ownerAgent
        ? {
            agentId: room.ownerAgent.id,
            userId: room.ownerAgent.userId,
            flyCover,
            pointsQuota: asMoney(room.ownerAgent.pointsQuota),
            /** 上盘池：代理桌额度/剩余信用 + 客服未发出 */
            diskPoolRemaining: roundMoney(
              Math.max(0, asMoney(room.ownerAgent.pointsQuota)) + Math.max(0, csBalances),
            ),
            csBalances,
            pointsUsed: asMoney(room.ownerAgent.pointsUsed),
            rebateRate: room.ownerAgent.rebateRate,
            flowRate: Number(room.ownerAgent.flowRate ?? 0.05),
            shareRate: Number(room.ownerAgent.shareRate ?? 0.5),
            balance: agentBalance,
            user: room.ownerAgent.user,
          }
        : null,
      ownerGrants: room.ownerGrants,
      _count: room._count,
    };
  }

  /**
   * 信用盘调整代理额度：合同额度与剩余信用同步加减（永久）。
   * direction=up 增加；down 减少（不得少于已发出的玩家+客服，且剩余信用够扣）。
   */
  async bumpCreditLimitByAmount(
    actor: ConsoleActor,
    roomId: string,
    amountRaw: number,
    remark?: string,
    directionRaw?: string,
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅管理员/房主可调整合同额度');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const amount = roundMoney(Number(amountRaw) || 0);
    if (amount <= 0) throw new BadRequestException('调整金额须大于 0');
    if (amount > 50_000_000) throw new BadRequestException('单次调整过大');
    const direction = directionRaw === 'down' ? 'down' : 'up';
    const delta = direction === 'down' ? -amount : amount;

    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        bookMode: true,
        creditLimit: true,
        ownerAgent: { select: { id: true, userId: true, pointsQuota: true } },
      },
    });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.bookMode !== 'CREDIT') {
      throw new BadRequestException('仅信用盘可调整合同额度');
    }
    if (!room.ownerAgent) throw new BadRequestException('房间未绑定代理');

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "Agent" WHERE "id" = ${room.ownerAgent!.id} FOR UPDATE
      `;
      await tx.$queryRaw`SELECT id FROM "Room" WHERE "id" = ${roomId} FOR UPDATE`;

      const locked = await tx.room.findUnique({
        where: { id: roomId },
        select: {
          creditLimit: true,
          ownerAgent: { select: { id: true, userId: true, pointsQuota: true } },
        },
      });
      if (!locked?.ownerAgent) throw new BadRequestException('房间未绑定代理');

      const [playerBalances, csBalances] = await Promise.all([
        sumRoomPlayerBalances(tx, roomId),
        sumAgentCsBalances(tx, locked.ownerAgent.userId),
      ]);
      const issued = roundMoney(playerBalances + csBalances);
      const before = asMoney(locked.creditLimit);
      const quotaBefore = asMoney(locked.ownerAgent.pointsQuota);
      const after = roundMoney(before + delta);
      const quotaAfter = roundMoney(quotaBefore + delta);

      if (direction === 'down') {
        if (quotaBefore + 1e-9 < amount) {
          throw new BadRequestException(
            `剩余信用不足，最多可减 ${Math.max(0, quotaBefore)}（已发出的不能从这里扣）`,
          );
        }
        if (after + 1e-9 < issued) {
          throw new BadRequestException(
            `合同额度不能低于已发出部分（玩家 ${playerBalances} + 客服 ${csBalances} = ${issued}）`,
          );
        }
        if (after <= 0) {
          throw new BadRequestException('合同额度须大于 0');
        }
      }

      await tx.room.update({
        where: { id: roomId },
        data: { creditLimit: after },
      });
      /* 该接口没有前端订单号，每次调用都是一次独立事件，随机键只为占住流水唯一约束 */
      await writeAgentQuotaInTx(tx, {
        agentUserId: locked.ownerAgent.userId,
        bookMode: 'CREDIT',
        quotaTo: quotaAfter,
        bizType: 'ADJUST',
        remark: `合同额度 ${before}→${after}${remark?.trim() ? `｜${remark.trim()}` : ''}`,
        refType: 'room_credit_limit',
        refId: roomId,
        idempotencyKey: `credit_limit_bump:${roomId}:${randomUUID()}`,
      });
      return {
        before,
        after,
        quotaBefore,
        quotaAfter,
        issued,
        playerBalances,
        csBalances,
      };
    });

    const { before, after, quotaBefore, quotaAfter, playerBalances, csBalances } = result;

    const book = computeCreditBook({
      creditLimit: after,
      pointsQuota: quotaAfter,
      playerBalances,
      csBalances,
      agentShareRate: 0,
    });

    const sign = direction === 'down' ? '-' : '+';
    await this.adminLog.log(actor.id, 'ROOM_CREDIT_LIMIT_BUMP', roomId, {
      before,
      amount: delta,
      direction,
      after,
      quotaBefore,
      quotaAfter,
      remark: remark?.trim() || null,
      excessAfter: book.excess,
    });

    return {
      ok: true,
      creditLimitBefore: before,
      bumped: delta,
      direction,
      creditLimit: after,
      pointsQuotaBefore: quotaBefore,
      pointsQuota: quotaAfter,
      excessAfter: book.excess,
      message: `合同与剩余信用各 ${sign}${amount}：合同 ${before}→${after}，剩余 ${quotaBefore}→${quotaAfter}`,
    };
  }

  /** 总代整房飞盘：只改房间开关，不动代理的单玩家开关 */
  async setGeneralRoomFly(actor: ConsoleActor, roomId: string, flyEnabled: boolean) {
    if (actor.role !== 'GENERAL') {
      throw new ForbiddenException('仅总代可调整名下房间整房飞盘');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, generalAgent: { select: { userId: true } } },
    });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.generalAgent?.userId !== actor.id) {
      throw new ForbiddenException('只能调整自己名下房间的飞盘');
    }
    await this.prisma.room.update({
      where: { id: roomId },
      data: { generalFlyEnabled: flyEnabled },
    });
    await this.adminLog.log(actor.id, 'ROOM_FLY', roomId, {
      flyEnabled,
      scope: 'general',
    });
    return {
      ok: true,
      flyEnabled,
      message: flyEnabled ? '已整房开启飞盘（飞向平台）' : '已整房关闭飞盘（总代坐庄）',
    };
  }

  /** 整房飞盘/关盘：仅本房主代理可改（信用盘也可开关） */
  async setRoomFly(actor: ConsoleActor, roomId: string, flyEnabled: boolean) {
    if (actor.role !== 'AGENT') {
      throw new ForbiddenException('仅房间主代理可调整整房飞盘');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, bookMode: true, ownerAgent: { select: { userId: true } } },
    });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.ownerAgent?.userId !== actor.id) {
      throw new ForbiddenException('只能调整自己房间的飞盘');
    }

    const updated = await this.prisma.roomMember.updateMany({
      where: { roomId, status: 'APPROVED' },
      data: { flyEnabled },
    });
    await this.adminLog.log(actor.id, 'ROOM_FLY', roomId, {
      flyEnabled,
      updated: updated.count,
    });
    return {
      ok: true,
      flyEnabled,
      updated: updated.count,
      message: flyEnabled
        ? `已整房开启飞盘（${updated.count} 名玩家）`
        : `已整房关闭飞盘（${updated.count} 名玩家）`,
    };
  }

  /** 待审进房申请（代理团队房间） */
  async listPendingMembers(actor: ConsoleActor) {
    if (!['AGENT', 'PROXY', 'ADMIN', 'BRANCH'].includes(actor.role)) {
      throw new ForbiddenException('无权查看进房审核');
    }
    const roomIds = await this.scope.grantedRoomIds(actor);
    if (roomIds !== null && !roomIds.length) {
      return { total: 0, list: [] as const };
    }
    const where = {
      status: 'PENDING',
      ...(roomIds === null ? {} : { roomId: { in: roomIds } }),
    };
    const list = await this.prisma.roomMember.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      include: {
        player: { select: { id: true, uid: true, nickname: true, username: true } },
        room: { select: { id: true, roomNo: true, name: true } },
      },
    });
    return {
      total: list.length,
      list: list.map((m) => ({
        id: m.id,
        playerId: m.playerId,
        roomId: m.roomId,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
        player: m.player,
        room: m.room,
      })),
    };
  }

  async approveMember(actor: ConsoleActor, memberId: string) {
    if (!['AGENT', 'ADMIN', 'BRANCH'].includes(actor.role)) {
      throw new ForbiddenException('无权审核进房（子账号只读）');
    }
    const member = await this.prisma.roomMember.findUnique({
      where: { id: memberId },
      include: {
        room: {
          select: {
            id: true,
            roomNo: true,
            name: true,
            ownerAgent: {
              select: { userId: true, user: { select: { id: true, uid: true, role: true } } },
            },
          },
        },
        player: { select: { id: true, uid: true, nickname: true } },
      },
    });
    if (!member) throw new NotFoundException('申请不存在');
    await this.scope.assertRoomAccess(actor, member.roomId);
    if (member.status === 'APPROVED') return { ok: true as const, status: 'APPROVED' };
    if (member.status !== 'PENDING') {
      throw new BadRequestException('该申请不可通过');
    }

    await this.prisma.roomMember.update({
      where: { id: memberId },
      data: { status: 'APPROVED' },
    });

    const agentUser = member.room.ownerAgent?.user;
    if (agentUser?.role === 'AGENT') {
      try {
        await this.hang.ensureDefaultHangToRoomAgent(
          member.roomId,
          member.playerId,
          agentUser.id,
        );
      } catch (e: unknown) {
        this.logger.warn(
          `approve hang room=${member.roomId} player=${member.playerId}: ${(e as Error).message}`,
        );
      }
    }

    await this.adminLog.log(actor.id, 'ROOM_JOIN_APPROVE', member.playerId, {
      memberId,
      roomId: member.roomId,
      roomNo: member.room.roomNo,
    });
    return { ok: true as const, status: 'APPROVED' };
  }

  async rejectMember(actor: ConsoleActor, memberId: string) {
    if (!['AGENT', 'ADMIN', 'BRANCH'].includes(actor.role)) {
      throw new ForbiddenException('无权审核进房（子账号只读）');
    }
    const member = await this.prisma.roomMember.findUnique({
      where: { id: memberId },
      include: { room: { select: { roomNo: true } } },
    });
    if (!member) throw new NotFoundException('申请不存在');
    await this.scope.assertRoomAccess(actor, member.roomId);
    if (member.status === 'REJECTED') return { ok: true as const, status: 'REJECTED' };
    if (member.status !== 'PENDING') {
      throw new BadRequestException('该申请不可拒绝');
    }

    await this.prisma.roomMember.update({
      where: { id: memberId },
      data: { status: 'REJECTED' },
    });
    await this.adminLog.log(actor.id, 'ROOM_JOIN_REJECT', member.playerId, {
      memberId,
      roomId: member.roomId,
      roomNo: member.room.roomNo,
    });
    return { ok: true as const, status: 'REJECTED' };
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
