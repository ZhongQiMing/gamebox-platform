/**
 * 客服账号：管理员/房主开通；代理划额度、佣金点数、接单权重/空闲状态。
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { asMoney, isValidMoney, roundMoney, validateOpsPassword } from '@gamebox/shared';
import { PASSWORD_SALT_ROUNDS } from '../../common/security.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { AdminLogService } from '../admin/admin-log.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import { CsSlaService } from './cs-sla.service';
import {
  assertFundOrderNo,
  lockAgentRowInTx,
  tryPayWageBillInTx,
  withOrderRemark,
  writeAgentQuotaInTx,
} from './player-fund.helper';
import { shanghaiRangeBounds } from '../../common/shanghai-range';
import { rethrowUserUniqueConflict, throwUsernameTaken } from '../../common/utils/user-unique';
import { pickAvatarUniqueInTx } from '../users/avatar-assign';

function genCsUsername() {
  return `cs${randomBytes(4).toString('hex')}`.slice(0, 16);
}

function genPassword() {
  return `Cs${randomBytes(4).toString('hex')}9`;
}

@Injectable()
export class CsStaffService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
    private sla: CsSlaService,
  ) {}

  private async allocUid() {
    for (let i = 0; i < 20; i++) {
      const uid = String(100000000 + Math.floor(Math.random() * 900000000));
      const clash = await this.prisma.user.findUnique({ where: { uid } });
      if (!clash) return uid;
    }
    throw new BadRequestException('UID 分配失败');
  }

  /** 解析可查看的代理 id 列表（客服挂在房间主代理下） */
  private async resolveParentAgentIds(
    actor: ConsoleActor,
    parentAgentUserId?: string,
  ): Promise<string[]> {
    if (actor.role === 'AGENT') {
      return [actor.id];
    }
    if (actor.role === 'PROXY' && !(await this.scope.isGeneralSide(actor))) {
      const root = await this.scope.scopeRootUserId(actor);
      return [root];
    }
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH' && !(await this.scope.isGeneralSide(actor))) {
      throw new ForbiddenException('无权查看客服列表');
    }
    if (parentAgentUserId) {
      await this.scope.assertUserInScope(actor, parentAgentUserId);
      const u = await this.prisma.user.findUnique({
        where: { id: parentAgentUserId },
        select: { role: true },
      });
      if (!u || u.role !== 'AGENT') {
        throw new BadRequestException('须指定房间代理');
      }
      return [parentAgentUserId];
    }
    if (actor.role === 'ADMIN') {
      const agents = await this.prisma.user.findMany({
        where: { role: 'AGENT' },
        select: { id: true },
      });
      return agents.map((a) => a.id);
    }
    /* BRANCH：授权房间的主代理 */
    const roomIds = await this.scope.grantedRoomIds(actor);
    if (!roomIds?.length) return [];
    const rooms = await this.prisma.room.findMany({
      where: { id: { in: roomIds }, ownerAgentId: { not: null } },
      select: { ownerAgent: { select: { userId: true } } },
    });
    return [
      ...new Set(
        rooms
          .map((r) => r.ownerAgent?.userId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
  }

  /** 列出管辖范围内客服 */
  async list(actor: ConsoleActor, parentAgentUserId?: string) {
    const agentIds = await this.resolveParentAgentIds(actor, parentAgentUserId);
    if (!agentIds.length) return [];

    const list = await this.prisma.user.findMany({
      where: { role: 'CS', parentId: { in: agentIds } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        uid: true,
        username: true,
        nickname: true,
        status: true,
        parentId: true,
        createdAt: true,
        csStaff: true,
        parent: { select: { id: true, nickname: true, username: true } },
      },
    });

    const ids = list.map((r) => r.id);
    const accs = ids.length
      ? await this.prisma.pointsAccount.findMany({
          where: { ownerId: { in: ids } },
          select: { ownerId: true, balance: true },
        })
      : [];
    const balMap = new Map(accs.map((a) => [a.ownerId, asMoney(a.balance)]));

    const pendingRows = ids.length
      ? await this.prisma.csWageBill.groupBy({
          by: ['csUserId'],
          where: { csUserId: { in: ids }, status: 'PENDING' },
          _sum: { wageAmount: true },
          _count: { _all: true },
        })
      : [];
    const pendingMap = new Map(
      pendingRows.map((r) => [
        r.csUserId,
        {
          pendingWage: asMoney(r._sum.wageAmount ?? 0),
          pendingWageCount: r._count._all,
        },
      ]),
    );

    return list.map((r) => {
      const pend = pendingMap.get(r.id);
      return {
        id: r.id,
        uid: r.uid,
        username: r.username,
        nickname: r.nickname,
        status: r.status,
        balance: balMap.get(r.id) ?? 0,
        wageRate: r.csStaff?.wageRate ?? 0,
        idleWeight: r.csStaff?.idleWeight ?? 100,
        workStatus: r.csStaff?.workStatus ?? 'REST',
        parentAgentUserId: r.parentId,
        parentAgentNickname: r.parent?.nickname || r.parent?.username || '',
        pendingWage: pend?.pendingWage ?? 0,
        pendingWageCount: pend?.pendingWageCount ?? 0,
        createdAt: r.createdAt,
      };
    });
  }

  /** 管理 / 总监 / 名下总代开客服（挂到指定房间代理） */
  async create(
    actor: ConsoleActor,
    body: {
      username?: string;
      password?: string;
      nickname?: string;
      parentAgentUserId?: string;
    },
  ) {
    const generalSide = await this.scope.isGeneralSide(actor);
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH' && !generalSide) {
      throw new ForbiddenException('仅管理、总监或总代可开客服账号');
    }
    const parentAgentUserId = body.parentAgentUserId?.trim();
    if (!parentAgentUserId) {
      throw new BadRequestException('请选择所属代理');
    }
    await this.scope.assertUserInScope(actor, parentAgentUserId);
    if (generalSide) {
      const rootId = await this.scope.generalRootId(actor);
      const hasRoom = await this.prisma.room.findFirst({
        where: {
          ownerAgent: { userId: parentAgentUserId },
          generalAgent: { userId: rootId },
        },
        select: { id: true },
      });
      if (!hasRoom) throw new ForbiddenException('只能给名下代理房间开客服');
    }
    const parent = await this.prisma.user.findUnique({
      where: { id: parentAgentUserId },
    });
    if (!parent || parent.role !== 'AGENT') {
      throw new BadRequestException('须指定房间代理');
    }

    const username = (body.username || genCsUsername()).toLowerCase().trim();
    if (!/^[a-z0-9]{8,20}$/.test(username)) {
      throw new BadRequestException('用户名须 8-20 位小写字母数字');
    }
    const plainPassword = body.password?.trim() || genPassword();
    const createPwdErr = validateOpsPassword(plainPassword);
    if (createPwdErr) throw new BadRequestException(createPwdErr);
    const exists = await this.prisma.user.findUnique({ where: { username } });
    if (exists) throwUsernameTaken();

    const uid = await this.allocUid();
    const nickname = body.nickname?.trim() || `客服${uid.slice(-4)}`;
    const passwordHash = await bcrypt.hash(plainPassword, PASSWORD_SALT_ROUNDS);

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
            role: 'CS',
            parentId: parent.id,
            agentPath: `${parent.agentPath}${parent.id}/`,
            depth: parent.depth + 1,
          },
        });
        await tx.csStaff.create({
          data: {
            userId: created.id,
            parentAgentUserId: parent.id,
            wageRate: 0,
            idleWeight: 100,
            workStatus: 'REST',
          },
        });
        await tx.pointsAccount.create({
          data: { ownerType: 'CS', ownerId: created.id, balance: 0 },
        });
        return created;
      });
    } catch (e: unknown) {
      rethrowUserUniqueConflict(e);
    }

    await this.adminLog.log(actor.id, 'CS_STAFF_CREATE', user.id, {
      username,
      nickname: user.nickname,
      parentAgentUserId: parent.id,
    });

    return {
      id: user.id,
      uid: user.uid,
      username,
      password: plainPassword,
      nickname: user.nickname,
      parentAgentUserId: parent.id,
    };
  }

  private async agentIsCredit(agentUserId: string): Promise<boolean> {
    const agent = await this.prisma.agent.findUnique({
      where: { userId: agentUserId },
      select: { id: true },
    });
    if (!agent) return false;
    const n = await this.prisma.room.count({
      where: { ownerAgentId: agent.id, bookMode: 'CREDIT' },
    });
    return n > 0;
  }

  /**
   * 划额度给客服：
   * - 现金盘：代理余额→客服；上盘额度同步下账到客服桌（可飞仍按余额+客服合计）
   * - 信用盘：剩余信用 → 客服额度（合计不变：剩余↓客服↑）
   */
  async allocate(
    actor: ConsoleActor,
    csUserId: string,
    amountRaw: number,
    clientRequestId?: string,
  ) {
    if (actor.role !== 'AGENT') throw new ForbiddenException('仅主代理可划额度');
    const orderNo = assertFundOrderNo(clientRequestId);
    const amount = roundMoney(amountRaw);
    if (!isValidMoney(amount) || amount <= 0) throw new BadRequestException('金额无效');

    const cs = await this.prisma.user.findUnique({
      where: { id: csUserId },
      include: { csStaff: true },
    });
    if (!cs || cs.role !== 'CS' || cs.parentId !== actor.id) {
      throw new NotFoundException('客服不存在');
    }
    /*
     * 停用的客服登不进来也发不出分，额度划进去就锁死在他账上，
     * 还会一直计进代理的信用账本，结账时看着像凭空少了一笔可用额度。
     */
    if (cs.status === 'DISABLED') {
      throw new BadRequestException('该客服已停用，请先启用再划额度');
    }

    const credit = await this.agentIsCredit(actor.id);
    const idemIn = `cs_alloc:${orderNo}:in`;

    await this.prisma.$transaction(async (tx) => {
      if (credit) {
        await lockAgentRowInTx(tx, actor.id);
      }
      await this.points.lockOwnersInTx(tx, [
        { type: 'AGENT', id: actor.id },
        { type: 'CS', id: csUserId },
      ]);

      /* 同号重放整笔跳过：流水层会自己去重，但 pointsQuota 不会，重放会把额度扣两遍 */
      const existed = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: idemIn },
      });
      if (existed) return;

      await lockAgentRowInTx(tx, actor.id);
      const agent = await tx.agent.findUnique({ where: { userId: actor.id } });
      if (!agent) throw new BadRequestException('代理账户不存在');
      const quota = asMoney(agent.pointsQuota);
      const acc = await tx.pointsAccount.findUnique({
        where: this.points.accountWhere('AGENT', actor.id),
      });
      const bal = asMoney(acc?.balance ?? 0);
      if (Math.min(bal, quota) + 1e-9 < amount) {
        throw new BadRequestException(
          `代理盘分不足（余额 ${bal}，额度 ${quota}）`,
        );
      }
      await this.points.transferInTx(
        tx,
        {
          type: 'AGENT',
          id: actor.id,
          remark: withOrderRemark(orderNo, '', credit ? '划额度给客服(信用)' : '划额度给客服'),
          idempotencyKey: `cs_alloc:${orderNo}:out`,
        },
        {
          type: 'CS',
          id: csUserId,
          remark: withOrderRemark(orderNo, '', credit ? '代理划入客服额度(信用)' : '代理划入客服额度'),
          idempotencyKey: idemIn,
        },
        amount,
        { bizType: 'TRANSFER_OUT', bizTypeIn: 'TRANSFER_IN', operatorId: actor.id },
      );
      await writeAgentQuotaInTx(tx, {
        agentUserId: actor.id,
        bookMode: credit ? 'CREDIT' : 'CASH',
        delta: -amount,
        usedDelta: amount,
        bizType: 'TRANSFER_OUT',
        remark: withOrderRemark(orderNo, '', credit ? '划额度给客服(信用)' : '划额度给客服'),
        refType: 'cs_alloc',
        refId: csUserId,
        idempotencyKey: `${idemIn}:QUOTA`,
      });
    });

    await this.adminLog.log(actor.id, 'CS_STAFF_ALLOC', csUserId, {
      amount,
      agentUserId: actor.id,
      credit,
      orderNo,
      clientRequestId: orderNo,
    });
    return { ok: true, orderNo, ...(await this.csBalance(csUserId)) };
  }

  /** 从客服额度收回主代理（信用盘加回剩余信用） */
  async recall(
    actor: ConsoleActor,
    csUserId: string,
    amountRaw: number,
    clientRequestId?: string,
  ) {
    if (actor.role !== 'AGENT') throw new ForbiddenException('仅主代理可收回额度');
    const orderNo = assertFundOrderNo(clientRequestId);
    const amount = roundMoney(amountRaw);
    if (!isValidMoney(amount) || amount <= 0) throw new BadRequestException('金额无效');

    const cs = await this.prisma.user.findUnique({ where: { id: csUserId } });
    if (!cs || cs.role !== 'CS' || cs.parentId !== actor.id) {
      throw new NotFoundException('客服不存在');
    }

    const credit = await this.agentIsCredit(actor.id);
    const idemOut = `cs_recall:${orderNo}:out`;

    await this.prisma.$transaction(async (tx) => {
      if (credit) {
        await lockAgentRowInTx(tx, actor.id);
      }
      await this.points.lockOwnersInTx(tx, [
        { type: 'CS', id: csUserId },
        { type: 'AGENT', id: actor.id },
      ]);

      /* 同号重放整笔跳过：pointsQuota 的加回不受流水去重保护 */
      const existed = await tx.pointsLedger.findUnique({
        where: { idempotencyKey: idemOut },
      });
      if (existed) return;

      await lockAgentRowInTx(tx, actor.id);
      const csAcc = await tx.pointsAccount.findUnique({
        where: this.points.accountWhere('CS', csUserId),
      });
      const csBal = asMoney(csAcc?.balance ?? 0);
      if (csBal + 1e-9 < amount) {
        throw new BadRequestException(`客服额度不足（可用 ${csBal}）`);
      }
      await this.points.transferInTx(
        tx,
        {
          type: 'CS',
          id: csUserId,
          remark: withOrderRemark(orderNo, '', credit ? '收回客服额度(信用)' : '收回客服额度'),
          idempotencyKey: idemOut,
        },
        {
          type: 'AGENT',
          id: actor.id,
          remark: withOrderRemark(orderNo, '', credit ? '客服额度收回(信用)' : '客服额度收回'),
          idempotencyKey: `cs_recall:${orderNo}:in`,
        },
        amount,
        { bizType: 'TRANSFER_OUT', bizTypeIn: 'TRANSFER_IN', operatorId: actor.id },
      );
      await writeAgentQuotaInTx(tx, {
        agentUserId: actor.id,
        bookMode: credit ? 'CREDIT' : 'CASH',
        delta: amount,
        usedDelta: -amount,
        bizType: 'TRANSFER_IN',
        remark: withOrderRemark(orderNo, '', credit ? '收回客服额度(信用)' : '客服额度收回'),
        refType: 'cs_recall',
        refId: csUserId,
        idempotencyKey: `${idemOut}:QUOTA`,
      });
    });

    await this.adminLog.log(actor.id, 'CS_STAFF_RECALL', csUserId, {
      amount,
      agentUserId: actor.id,
      credit,
      orderNo,
      clientRequestId: orderNo,
    });
    return { ok: true, orderNo, ...(await this.csBalance(csUserId)) };
  }

  async patchSettings(
    actor: ConsoleActor,
    csUserId: string,
    body: { wageRate?: number; idleWeight?: number; workStatus?: string; nickname?: string },
  ) {
    const cs = await this.prisma.user.findUnique({
      where: { id: csUserId },
      include: { csStaff: true },
    });
    if (!cs || cs.role !== 'CS') throw new NotFoundException('客服不存在');

    const isSelf = actor.role === 'CS' && actor.id === csUserId;
    const isParent = actor.role === 'AGENT' && cs.parentId === actor.id;
    let isLandlord = false;
    if ((actor.role === 'ADMIN' || actor.role === 'BRANCH') && cs.parentId) {
      try {
        await this.scope.assertUserInScope(actor, cs.parentId);
        isLandlord = true;
      } catch {
        isLandlord = false;
      }
    }
    if (!isSelf && !isParent && !isLandlord) throw new ForbiddenException('无权修改');

    if (isSelf) {
      /* 客服自己只能改空闲/休息 */
      if (body.workStatus !== undefined) {
        if (!['IDLE', 'REST'].includes(body.workStatus)) {
          throw new BadRequestException('状态须为 IDLE 或 REST');
        }
        if (body.workStatus === 'IDLE' && cs.csStaff?.slaLockedAt) {
          throw new ForbiddenException(
            `账号已锁定：${cs.csStaff.slaLockReason || '漏接玩家消息'}。请联系代理报备后解锁`,
          );
        }
        if (cs.csStaff?.workStatus !== body.workStatus) {
          await this.prisma.csStaff.update({
            where: { userId: csUserId },
            data: {
              workStatus: body.workStatus,
              /* 点「接单」当作一次心跳，免得刚上班就被离线扫描判成走了 */
              ...(body.workStatus === 'IDLE' ? { lastSeenAt: new Date() } : {}),
            },
          });
          /* 值班时长按状态段累计，存在服务器，App 被划掉不影响 */
          await this.sla.onWorkStatusChanged(csUserId, body.workStatus as 'IDLE' | 'REST');
        }
      }
      return this.detail(csUserId);
    }

    /* 管理员/房主：本页只改显示名；佣金/占比留给代理 */
    if (isLandlord && !isParent) {
      if (body.nickname?.trim()) {
        await this.prisma.user.update({
          where: { id: csUserId },
          data: { nickname: body.nickname.trim() },
        });
        await this.adminLog.log(actor.id, 'CS_STAFF_PATCH', csUserId, {
          nickname: body.nickname.trim(),
        });
      }
      return this.detail(csUserId);
    }

    const data: {
      wageRate?: number;
      idleWeight?: number;
      workStatus?: string;
    } = {};
    if (body.wageRate !== undefined) {
      const r = Number(body.wageRate);
      if (!Number.isFinite(r) || r < 0 || r > 1) {
        throw new BadRequestException('佣金点数须在 0~1（如 0.03=三个点）');
      }
      data.wageRate = r;
    }
    if (body.idleWeight !== undefined) {
      const w = Math.floor(Number(body.idleWeight));
      if (w < 0 || w > 10000) throw new BadRequestException('接单权重无效');
      data.idleWeight = w;
    }
    if (body.workStatus !== undefined) {
      if (!['IDLE', 'REST'].includes(body.workStatus)) {
        throw new BadRequestException('状态须为 IDLE 或 REST');
      }
      data.workStatus = body.workStatus;
    }
    if (Object.keys(data).length) {
      await this.prisma.csStaff.update({ where: { userId: csUserId }, data });
    }
    if (body.nickname?.trim()) {
      await this.prisma.user.update({
        where: { id: csUserId },
        data: { nickname: body.nickname.trim() },
      });
    }
    await this.adminLog.log(actor.id, 'CS_STAFF_PATCH', csUserId, body as object);
    return this.detail(csUserId);
  }

  async detail(csUserId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: csUserId },
      include: { csStaff: true },
    });
    if (!u || u.role !== 'CS') throw new NotFoundException('客服不存在');
    const bal = await this.csBalance(csUserId);
    const wage = await this.wageSummary(csUserId);
    const duty = await this.sla.dutyToday(csUserId);
    return {
      id: u.id,
      uid: u.uid,
      username: u.username,
      nickname: u.nickname,
      status: u.status,
      ...bal,
      wageRate: u.csStaff?.wageRate ?? 0,
      idleWeight: u.csStaff?.idleWeight ?? 100,
      workStatus: u.csStaff?.workStatus ?? 'REST',
      slaLocked: !!u.csStaff?.slaLockedAt,
      slaLockReason: u.csStaff?.slaLockReason ?? null,
      /* 今日值班时长：空闲与休息分开，按上海自然日 */
      idleSecToday: duty.idleSec,
      restSecToday: duty.restSec,
      ...wage,
    };
  }

  private async csBalance(csUserId: string) {
    const acc = await this.prisma.pointsAccount.findUnique({
      where: this.points.accountWhere('CS', csUserId),
    });
    return { balance: asMoney(acc?.balance ?? 0) };
  }

  private async wageSummary(csUserId: string) {
    const [todayFrom, todayTo] = shanghaiRangeBounds('today');
    const [todaySettled, allSettled, pendingAgg] = await Promise.all([
      this.prisma.csWageBill.findMany({
        where: {
          csUserId,
          status: 'SETTLED',
          settledAt: { gte: todayFrom, lt: todayTo },
        },
        select: { wageAmount: true },
      }),
      this.prisma.csWageBill.findMany({
        where: { csUserId, status: 'SETTLED' },
        select: { wageAmount: true },
      }),
      this.prisma.csWageBill.aggregate({
        where: { csUserId, status: 'PENDING' },
        _sum: { wageAmount: true },
        _count: { _all: true },
      }),
    ]);
    let todayWage = 0;
    for (const r of todaySettled) todayWage += asMoney(r.wageAmount);
    let totalWage = 0;
    for (const r of allSettled) totalWage += asMoney(r.wageAmount);
    return {
      todayWage: roundMoney(todayWage),
      totalWage: roundMoney(totalWage),
      todayWageCount: todaySettled.length,
      totalWageCount: allSettled.length,
      pendingWage: asMoney(pendingAgg._sum.wageAmount ?? 0),
      pendingWageCount: pendingAgg._count._all,
    };
  }

  /** 客服/代理查看佣金账单 */
  async listWageBills(
    actor: ConsoleActor,
    opts: {
      csUserId?: string;
      status?: 'PENDING' | 'SETTLED' | 'ALL';
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(1, Number(opts.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(opts.pageSize) || 30));
    let csUserId = opts.csUserId?.trim();

    if (actor.role === 'CS') {
      csUserId = actor.id;
    } else if (actor.role === 'AGENT') {
      if (!csUserId) throw new BadRequestException('请指定客服');
      const cs = await this.prisma.user.findUnique({
        where: { id: csUserId },
        select: { role: true, parentId: true },
      });
      if (!cs || cs.role !== 'CS' || cs.parentId !== actor.id) {
        throw new NotFoundException('客服不存在');
      }
    } else if (actor.role === 'ADMIN' || actor.role === 'BRANCH') {
      if (!csUserId) throw new BadRequestException('请指定客服');
      const cs = await this.prisma.user.findUnique({
        where: { id: csUserId },
        select: { role: true, parentId: true },
      });
      if (!cs || cs.role !== 'CS') throw new NotFoundException('客服不存在');
      if (cs.parentId) await this.scope.assertUserInScope(actor, cs.parentId);
    } else {
      throw new ForbiddenException('无权查看佣金记录');
    }

    const status = opts.status && opts.status !== 'ALL' ? opts.status : undefined;
    const where: Prisma.CsWageBillWhereInput = {
      csUserId,
      ...(status ? { status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.csWageBill.count({ where }),
      this.prisma.csWageBill.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const playerIds = [...new Set(rows.map((r) => r.playerId))];
    const players = playerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: playerIds } },
          select: { id: true, nickname: true, username: true, uid: true },
        })
      : [];
    const playerMap = new Map(players.map((p) => [p.id, p]));

    return {
      total,
      page,
      pageSize,
      list: rows.map((r) => {
        const p = playerMap.get(r.playerId);
        return {
          id: r.id,
          kind: r.kind,
          fundAmount: asMoney(r.fundAmount),
          wageAmount: asMoney(r.wageAmount),
          wageRate: r.wageRate,
          status: r.status,
          playerId: r.playerId,
          playerNickname: p?.nickname || p?.username || '',
          playerUid: p?.uid || '',
          settledAt: r.settledAt,
          createdAt: r.createdAt,
        };
      }),
    };
  }

  /**
   * 代理结清未付佣金：单笔 billId，或该客服全部未结（csUserId）。
   */
  async settleWage(
    actor: ConsoleActor,
    body: { billId?: string; csUserId?: string },
  ) {
    if (actor.role !== 'AGENT') {
      throw new ForbiddenException('仅主代理可结清佣金');
    }
    const billId = body.billId?.trim();
    const csUserId = body.csUserId?.trim();
    if (!billId && !csUserId) {
      throw new BadRequestException('请指定账单或客服');
    }

    const pending = await this.prisma.csWageBill.findMany({
      where: billId
        ? { id: billId, agentUserId: actor.id, status: 'PENDING' }
        : { csUserId, agentUserId: actor.id, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (!pending.length) {
      return { settledCount: 0, settledAmount: 0, remainingPending: 0, message: '没有未结佣金' };
    }

    const credit = await this.agentIsCredit(actor.id);
    const bookMode = credit ? 'CREDIT' : 'CASH';
    const sourceLabel = credit ? '剩余信用' : '盘分';
    let settledCount = 0;
    let settledAmount = 0;
    let shortfall = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const bill of pending) {
        const wage = asMoney(bill.wageAmount);
        const paid = await tryPayWageBillInTx(tx, this.points, {
          bookMode,
          billId: bill.id,
          csUserId: bill.csUserId,
          agentUserId: actor.id,
          wageAmount: wage,
          operatorId: actor.id,
          refType: 'cs_wage_settle',
          refId: bill.id,
          diskIdem: `wage-settle:${bill.id}:disk`,
          wageIdem: `wage-settle:${bill.id}:in`,
          wageRemark: bill.kind === 'DOWN' ? '下分佣金(结清)' : '上分佣金(结清)',
          diskRemark: `结清客服佣金 ${bill.kind}`,
        });
        if (paid) {
          settledCount += 1;
          settledAmount = roundMoney(settledAmount + wage);
        } else {
          const agent = await tx.agent.findUnique({ where: { userId: actor.id } });
          const quota = asMoney(agent?.pointsQuota ?? 0);
          let avail = quota;
          if (!credit) {
            const acc = await tx.pointsAccount.findUnique({
              where: this.points.accountWhere('AGENT', actor.id),
            });
            avail = Math.min(asMoney(acc?.balance ?? 0), quota);
          }
          shortfall = roundMoney(wage - avail);
          break;
        }
      }
    });

    if (settledCount === 0 && shortfall > 0) {
      throw new BadRequestException(
        `${sourceLabel}不足，还差 ${shortfall} 才能结清下一笔佣金`,
      );
    }

    const remainAgg = await this.prisma.csWageBill.aggregate({
      where: {
        agentUserId: actor.id,
        status: 'PENDING',
        ...(csUserId ? { csUserId } : billId ? { csUserId: pending[0]!.csUserId } : {}),
      },
      _sum: { wageAmount: true },
      _count: { _all: true },
    });

    await this.adminLog.log(actor.id, 'CS_WAGE_SETTLE', csUserId || pending[0]!.csUserId, {
      billId: billId || null,
      settledCount,
      settledAmount,
      remainingPending: remainAgg._count._all,
      remainingAmount: asMoney(remainAgg._sum.wageAmount ?? 0),
    });

    return {
      settledCount,
      settledAmount,
      remainingPending: remainAgg._count._all,
      remainingAmount: asMoney(remainAgg._sum.wageAmount ?? 0),
      shortfall: shortfall > 0 ? shortfall : 0,
      message:
        shortfall > 0
          ? `已结清 ${settledCount} 笔，${sourceLabel}不足还差 ${shortfall}`
          : `已结清 ${settledCount} 笔，合计 ${settledAmount}`,
    };
  }

  /** 空闲客服按权重随机一个；无人则回主代理 */
  async pickAssignee(agentRootId: string): Promise<string> {
    const idle = await this.prisma.csStaff.findMany({
      where: {
        parentAgentUserId: agentRootId,
        workStatus: 'IDLE',
        user: { status: 'ACTIVE', role: 'CS' },
      },
      select: { userId: true, idleWeight: true },
    });
    const pool = idle.filter((x) => x.idleWeight > 0);
    if (!pool.length) return agentRootId;
    const total = pool.reduce((s, x) => s + x.idleWeight, 0);
    let r = Math.random() * total;
    for (const x of pool) {
      r -= x.idleWeight;
      if (r <= 0) return x.userId;
    }
    return pool[pool.length - 1]!.userId;
  }

  /**
   * 粘性派单是否仍有效：
   * - 指派给主代理本人 → 有效
   * - 指派给下属客服且账号 ACTIVE → 有效（休息中也可继续处理已派会话，但不进新单池）
   */
  async isAssigneeValid(assigneeId: string, agentRootId: string): Promise<boolean> {
    if (assigneeId === agentRootId) return true;
    const staff = await this.prisma.csStaff.findFirst({
      where: {
        userId: assigneeId,
        parentAgentUserId: agentRootId,
        user: { status: 'ACTIVE', role: 'CS' },
      },
      select: { userId: true },
    });
    return !!staff;
  }

  private async assertCanHardManageCs(actor: ConsoleActor, parentAgentUserId: string | null) {
    if (!parentAgentUserId) throw new BadRequestException('客服未挂靠代理');
    if (actor.role === 'ADMIN') return;
    if (actor.role === 'BRANCH') {
      await this.scope.assertUserInScope(actor, parentAgentUserId);
      return;
    }
    if (await this.scope.isGeneralSide(actor)) {
      const rootId = await this.scope.generalRootId(actor);
      await this.scope.assertUserInScope(actor, parentAgentUserId);
      const hasRoom = await this.prisma.room.findFirst({
        where: {
          ownerAgent: { userId: parentAgentUserId },
          generalAgent: { userId: rootId },
        },
        select: { id: true },
      });
      if (hasRoom) return;
    }
    throw new ForbiddenException('仅管理、总监或名下总代可停用/重置客服');
  }

  /** 停用/启用客服（管理员/房主） */
  async setStatus(actor: ConsoleActor, csUserId: string, status: 'ACTIVE' | 'DISABLED') {
    if (status !== 'ACTIVE' && status !== 'DISABLED') {
      throw new BadRequestException('状态无效');
    }
    const cs = await this.prisma.user.findUnique({
      where: { id: csUserId },
      select: { id: true, role: true, parentId: true, status: true },
    });
    if (!cs || cs.role !== 'CS') throw new NotFoundException('客服不存在');
    await this.assertCanHardManageCs(actor, cs.parentId);
    if (cs.status === status) return { id: cs.id, status };

    /*
     * 手上还有额度就先别停：停用后他发不出去也退不回来，
     * 那笔钱会一直挂在代理的信用账本里。让操作的人先收回。
     */
    if (status === 'DISABLED') {
      const acc = await this.prisma.pointsAccount.findFirst({
        where: { ownerType: 'CS', ownerId: csUserId },
        select: { balance: true },
      });
      const left = asMoney(acc?.balance ?? 0);
      if (left > 0) {
        throw new BadRequestException(
          `该客服名下还有额度 ${left}，请先在「客服账号」里收回再停用`,
        );
      }
    }

    const u = await this.prisma.user.update({
      where: { id: csUserId },
      data: {
        status,
        ...(status === 'DISABLED' ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: { id: true, status: true },
    });
    if (status === 'DISABLED') {
      await this.prisma.csStaff.update({
        where: { userId: csUserId },
        data: { workStatus: 'REST' },
      });
    }
    await this.adminLog.log(actor.id, 'USER_STATUS', csUserId, { status, role: 'CS' });
    return u;
  }

  /** 重置客服密码（管理员/房主） */
  async resetPassword(actor: ConsoleActor, csUserId: string, password?: string) {
    const cs = await this.prisma.user.findUnique({
      where: { id: csUserId },
      select: { id: true, role: true, parentId: true, username: true },
    });
    if (!cs) throw new NotFoundException('客服不存在');
    if (cs.role === 'ADMIN') {
      throw new ForbiddenException('不能重置管理员密码（忘记只能改数据库）');
    }
    if (cs.role !== 'CS') throw new NotFoundException('客服不存在');
    await this.assertCanHardManageCs(actor, cs.parentId);

    const plainPassword = password?.trim() || genPassword();
    const resetPwdErr = validateOpsPassword(plainPassword);
    if (resetPwdErr) throw new BadRequestException(resetPwdErr);
    const passwordHash = await bcrypt.hash(plainPassword, PASSWORD_SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: csUserId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    await this.adminLog.log(actor.id, 'ROOM_AGENT_RESET_PWD', csUserId, {
      username: cs.username,
      kind: 'CS',
    });
    return {
      ok: true,
      username: cs.username,
      password: plainPassword,
      message: '客服密码已重置，请立即告知；旧登录态已失效',
    };
  }
}
