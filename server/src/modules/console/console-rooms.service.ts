import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { asMoney, roundMoney, validateOpsPassword } from '@gamebox/shared';
import { PASSWORD_SALT_ROUNDS } from '../../common/security.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { AdminLogService } from '../admin/admin-log.service';
import { HangService } from '../agents/hang.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import {
  normalizeSettleCycle,
  settleCycleToWeekday,
  shanghaiSettleBounds,
} from './room-settle.service';
import {
  DIRECT_AGENT_SHARE_CAP,
  GENERAL_SHARE_SCHEDULE_SELECT,
  materializeShareSchedule,
  parseAgentShareRate,
  publicRoomAgentShareView,
  ROOM_AGENT_SHARE_SCHEDULE_SELECT,
  roomAgentShareCap,
  roomSchedulePrismaData,
  scheduleFromAgent,
  scheduleFromRoom,
} from './general-share-rate.helper';
import {
  computeCreditBook,
  agentDisplayBalance,
  agentFlyAvailable,
  agentWorkingDisk,
  sumAgentCsBalances,
  sumAgentCsBalancesMap,
  sumAgentRoomPlayerBalancesMap,
  sumRoomPlayerBalances,
} from './credit-settle.helper';
import { adjustCashDiskInTx, assertFundOrderNo } from './player-fund.helper';
import {
  consumeCreditIssueDebtInTx,
  recordCreditIssueDebtInTx,
  roomCreditDebtFilter,
} from './credit-issue-debt.helper';
import { roomFeeFloor } from './general-room-fee.helper';
import { rethrowUserUniqueConflict, throwUsernameTaken } from '../../common/utils/user-unique';
import { normalizeRobotPlan, offRobotPlan, platformDefaultRobotPlan, isNoChatRobotGame } from '../rooms/robot-plan.util';
import { RETIRED_GAME_CODES } from '../games/retired-games';
import {
  bandForRoomGame,
  clampPlayerRateToBand,
  pctLabel,
  readPlatformBounds,
  resolveDownlineFlowRate,
  resolvePlayerBand,
} from '../rebate/rebate-chain';
import { pickAvatarUniqueInTx } from '../users/avatar-assign';
import {
  displayRoomIcon,
  saveRoomIconFromDataUrl,
} from './room-icon.util';
import { shanghaiRangeBounds } from '../../common/shanghai-range';
import { flowViewFor, flowViewerSide } from './flow-scope.helper';
import { ConsoleReportsService } from './console-reports.service';
import {
  allowClosedInRoomList,
  CLOSE_ROOM_PATCH,
  OPEN_ROOM_WHERE,
} from './open-room.where';
import { roomPurgeBlockReasons } from './room-purge.helper';

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

/*
 * 月费到期时间锚在建房那一刻，收费一律在结账时进行（见 roomMonthlyFeeDue）。
 * 所以新房的下次到期时间就是「现在」：第一次结账先收一笔，之后每满一个自然月收一笔。
 */
function initialBillAt(createdAt: Date): Date {
  return new Date(createdAt.getTime());
}

@Injectable()
export class ConsoleRoomsService {
  private readonly logger = new Logger(ConsoleRoomsService.name);

  constructor(
    private prisma: PrismaService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
    private hang: HangService,
    private reports: ConsoleReportsService,
    private points: PointsService,
  ) {}

  async list(actor: ConsoleActor, opts?: { includeClosed?: boolean }) {
    const ids = await this.scope.grantedRoomIds(actor);
    const where: Record<string, unknown> = ids === null ? {} : { id: { in: ids } };
    // 关房=软删除。总代/代理传 includeClosed 也不给，只有管理/总监勾了才看。
    if (!allowClosedInRoomList(actor.role, opts?.includeClosed)) {
      Object.assign(where, OPEN_ROOM_WHERE);
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
            ...GENERAL_SHARE_SCHEDULE_SELECT,
            user: { select: { uid: true, nickname: true, username: true } },
          },
        },
        ownerGrants: {
          select: {
            ownerId: true,
            owner: { select: { uid: true, nickname: true, role: true } },
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
          where: {
            roomId: { in: roomIds },
            status: 'APPROVED',
            /* 代理/管理进游戏大厅也会写一条成员，不能算进玩家飞盘人数 */
            player: { role: 'PLAYER' },
          },
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

    const [csMap, playerBalMap] = await Promise.all([
      sumAgentCsBalancesMap(this.prisma, agentUserIds),
      sumAgentRoomPlayerBalancesMap(this.prisma, agentUserIds),
    ]);

    const [todayFrom, todayTo] = shanghaiRangeBounds('today');
    const isPlatformSide = actor.role === 'ADMIN' || actor.role === 'BRANCH';
    const generalSide = await this.scope.isGeneralSide(actor);
    const viewerSide = flowViewerSide({ isPlatformSide, isGeneralSide: generalSide });
    /* 三方拆开：管理只看飞上台；总代飞上台 vs 关盘(坐庄+代理关)；代理飞出去 vs 自己关盘 */
    const todayAgg = roomIds.length
      ? await this.reports.roomDayHouseAgg(roomIds, todayFrom, todayTo)
      : new Map();

    return rooms.map((r) => {
      const fly = flyMap.get(r.id) || { onCount: 0, offCount: 0, memberCount: 0 };
      const bookMode = r.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH';
      const bal = r.ownerAgent ? balMap.get(r.ownerAgent.userId) ?? 0 : 0;
      const quota = r.ownerAgent ? asMoney(r.ownerAgent.pointsQuota) : 0;
      const csBal = r.ownerAgent ? csMap.get(r.ownerAgent.userId) ?? 0 : 0;
      /*
       * 可飞额度两种盘同一条公式（见 agentFlyAvailable）：
       * 代理盘分 + 客服未发出 + 名下房间玩家持分。信用盘原先在这里写死 0，
       * 而真正做飞/关判断的是另一套算法，页面和系统说的不是一个数。
       */
      const playerBal = r.ownerAgent ? playerBalMap.get(r.ownerAgent.userId) ?? 0 : 0;
      const disk = agentWorkingDisk(bal, quota);
      const flyCover = roundMoney(Math.max(0, disk + csBal + playerBal));
      const betAgg = todayAgg.get(r.id);
      const flown = betAgg?.flown;
      const agentFly = betAgg?.agentFly;
      const all = betAgg?.all;
      /*
       * 三级账本：每一级只认自己接到的那一桶。
       * 原先非平台侧一律取 all，总代的派彩/盈亏里就混进了代理自己关盘的钱。
       */
      const pick = viewerSide === 'PLATFORM' ? flown : viewerSide === 'GENERAL' ? agentFly : all;
      /* 三方口径只有 flowViewFor 一个出处，页面与单测共用 */
      const view = flowViewFor(viewerSide, {
        flown: asMoney(flown?.flow ?? 0),
        agentFly: asMoney(agentFly?.flow ?? 0),
        all: asMoney(all?.flow ?? 0),
      });
      const betFlow = view.total;
      const pendingBetFlow = asMoney(pick?.pendingFlow ?? 0);
      const payout = asMoney(pick?.payout ?? 0);
      const closedBetFlow = view.closed;
      const displayFlown = view.flying;
      return {
        id: r.id,
        roomNo: r.roomNo,
        name: r.name,
        title: r.title,
        icon: displayRoomIcon(r.icon),
        status: r.status,
        enabledGames: safeJsonArr(r.enabledGames),
        memberCount: fly.memberCount,
        monthlyFee: asMoney(r.monthlyFee),
        billingDay: r.billingDay,
        nextBillAt: r.nextBillAt,
        lastBilledAt: r.lastBilledAt,
        overIssueEnabled: false,
        overIssueLimit: 0,
        overIssueUsed: 0,
        bookMode,
        ...publicRoomAgentShareView(r),
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
              agentBalance: agentDisplayBalance({ bookMode, balance: bal, pointsQuota: quota }),
              unsettledWage: undefined,
              diskPoolRemaining: roundMoney(Math.max(0, quota) + Math.max(0, csBal)),
              csBalances: csBal,
              pointsUsed: asMoney(r.ownerAgent.pointsUsed),
              /*
               * 可飞额度的三个构成都给出来，前端才能核对「自己手上 + 玩家手上 = 合计」。
               * 代理自己看这三栏能看出欠玩家多少（自己手上为负）；上家只需要看 flyCover。
               */
              playerBalances: playerBal,
              flyCover,
            }
          : null,
        owners: r.ownerGrants
          .filter((g) => g.owner.role === 'BRANCH')
          .map((g) => ({
            userId: g.ownerId,
            uid: g.owner.uid,
            nickname: g.owner.nickname,
          })),
        todayStats: {
          betFlow,
          pendingBetFlow,
          flownBetFlow: displayFlown,
          closedBetFlow,
          payout,
          housePnl: asMoney(pick?.housePnl ?? 0),
          betCount: pick?.count ?? 0,
          activePlayers: pick?.players.size ?? 0,
        },
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
    if (!this.scope.canCreateRoom(actor) && !(await this.scope.isGeneralSide(actor))) {
      throw new ForbiddenException('仅管理/总监/总代可创建房间');
    }
    const roomName = safeDisplayName(body.name, '房间名', 40);

    const status = body.status && ['OPEN', 'MAINTENANCE', 'FROZEN'].includes(body.status)
      ? body.status
      : 'OPEN';
    let games = Array.isArray(body.enabledGames)
      ? [...new Set(body.enabledGames.filter((g) => typeof g === 'string' && g.trim()))]
      : [];
    if (!games.length) {
      const catalog = await this.prisma.game.findMany({
        where: { code: { notIn: [...RETIRED_GAME_CODES] } },
        select: { code: true },
        orderBy: { sortOrder: 'asc' },
      });
      games = catalog.map((g) => g.code);
    }
    if (!games.length) throw new BadRequestException('请至少开通一个游戏');
    const bookMode = body.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH';
    const billingDay = Math.min(28, Math.max(1, Number(body.billingDay ?? 1) || 1));
    let generalAgentRow: {
      id: string;
      userId: string;
      bookMode: string;
      flowRate: number;
      shareRate: number;
      downlineFlowRate: number | null;
      playerMinRate: number | null;
      playerMaxRate: number | null;
      roomMonthlyFee: number;
      shareCap: number;
    } | null = null;
    let generalUserId = String(body.generalAgentUserId || '').trim();
    if (await this.scope.isGeneralSide(actor)) {
      generalUserId = await this.scope.generalRootId(actor);
    }
    if (generalUserId) {
      const gu = await this.prisma.user.findUnique({
        where: { id: generalUserId },
        select: {
          id: true,
          role: true,
          agent: {
            select: {
              id: true,
              bookMode: true,
              flowRate: true,
              ...GENERAL_SHARE_SCHEDULE_SELECT,
              downlineFlowRate: true,
              playerMinRate: true,
              playerMaxRate: true,
              roomMonthlyFee: true,
            },
          },
        },
      });
      if (!gu || gu.role !== 'GENERAL' || !gu.agent) {
        throw new BadRequestException('总代账号无效');
      }
      /* 总监只能挂到自己看得见的总代，否则会造出一间自己也看不见的房 */
      await this.scope.assertGeneralAssignable(actor, gu.id);
      generalAgentRow = {
        id: gu.agent.id,
        userId: gu.id,
        bookMode: gu.agent.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH',
        flowRate: Number(gu.agent.flowRate ?? 0.07),
        shareRate: Number(gu.agent.shareRate ?? 0.5),
        downlineFlowRate: gu.agent.downlineFlowRate,
        playerMinRate: gu.agent.playerMinRate,
        playerMaxRate: gu.agent.playerMaxRate,
        roomMonthlyFee: asMoney(gu.agent.roomMonthlyFee),
        shareCap: roomAgentShareCap(scheduleFromAgent(gu.agent)),
      };
    }

    /*
     * 房间月费 = 总代向代理收的价，**只能高不能低于**平台给总代定的单价。
     *
     * 平台按单价 × 房间数向总代收，不看代理实际交多少。所以低于单价那部分
     * 是总代每月自己倒贴的，而且要到结账才看得出来。多收的差价归他。
     * 不传（或传 0、挂了总代）时直接带入单价，省得建完还要回来改。
     */
    const feeFloor = roomFeeFloor(generalAgentRow?.roomMonthlyFee);
    const askedFee = Math.max(0, Math.floor(Number(body.monthlyFee) || 0));
    if (feeFloor > 0 && askedFee > 0 && askedFee < feeFloor) {
      throw new BadRequestException(
        `该总代名下房间月费不得低于平台单价 ${feeFloor}（多收的差价归总代）`,
      );
    }
    const monthlyFee = askedFee > 0 ? askedFee : feeFloor;

    let agentShareRate = Number(body.agentShareRate);
    if (!Number.isFinite(agentShareRate)) agentShareRate = 0.5;
    if (agentShareRate > 1) agentShareRate = agentShareRate / 100;
    const shareCap = generalAgentRow ? Math.min(0.7, generalAgentRow.shareCap) : 0.5;
    if (agentShareRate < 0 || agentShareRate > shareCap + 1e-9) {
      throw new BadRequestException(`代理占成须在 0%～${(shareCap * 100).toFixed(0)}%`);
    }

    const policy = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
    const platform = readPlatformBounds(policy);
    let agentFlowRate = Number(body.agentFlowRate);
    if (!Number.isFinite(agentFlowRate)) {
      agentFlowRate = resolveDownlineFlowRate(platform, generalAgentRow);
    }
    if (agentFlowRate > 1) agentFlowRate = agentFlowRate / 100;
    const flowCap = generalAgentRow
      ? Math.min(platform.agentMax, generalAgentRow.flowRate)
      : platform.agentMax;
    if (agentFlowRate < platform.agentMin - 1e-9 || agentFlowRate > flowCap + 1e-9) {
      throw new BadRequestException(
        `代理流水整包须在 ${pctLabel(platform.agentMin)}～${pctLabel(flowCap)}`,
      );
    }
    const playerBand = resolvePlayerBand({
      platform,
      general: generalAgentRow,
      agentFlowRate,
    });

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

    // 总监可见授权：默认全部总监；管理创建时可按勾选收窄
    let grantOwnerIds: string[] = [];
    if (actor.role === 'ADMIN') {
      if (!Array.isArray(body.ownerUserIds)) {
        const allDirectors = await this.prisma.user.findMany({
          where: { role: 'BRANCH', status: 'ACTIVE' },
          select: { id: true },
        });
        grantOwnerIds = allDirectors.map((b) => b.id);
      } else {
        const ids = body.ownerUserIds.filter(Boolean);
        if (ids.length) {
          const branches = await this.prisma.user.findMany({
            where: { id: { in: ids }, role: 'BRANCH' },
            select: { id: true },
          });
          grantOwnerIds = branches.map((b) => b.id);
        }
      }
    } else if (actor.role === 'BRANCH' || await this.scope.isGeneralSide(actor)) {
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

    // 代理挂靠：有总代挂总代，否则挂创建人（直挂平台，不把总监当上级）
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
    } else if (actor.role === 'BRANCH') {
      const admin = await this.prisma.user.findFirst({
        where: { role: 'ADMIN' },
        select: { id: true, agentPath: true, depth: true },
      });
      if (admin) {
        parentId = admin.id;
        agentPath = `${admin.agentPath}${admin.id}/`;
        depth = admin.depth + 1;
      }
    }

    const now = new Date();
    /*
     * 上家向代理收本房月费从建房这一刻起算：现金盘信用盘一样，
     * 第一次结账就收第一笔（预收），之后每满一个自然月收一笔。
     */
    let nextBillAt: Date | null = null;
    if (monthlyFee > 0) {
      nextBillAt = body.nextBillAt ? new Date(body.nextBillAt) : initialBillAt(now);
      if (Number.isNaN(nextBillAt.getTime())) {
        throw new BadRequestException('扣费日期无效');
      }
    }
    /*
     * 平台向总代收本房月费同样从建房这一刻起算：下次总代结账就收第一笔。
     * 直挂房留空——平台直接向代理收，不走总代这条腿。
     */
    const platformFeeDueAt = generalAgentRow ? now : null;

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
            rebateRate: clampPlayerRateToBand(0.018, playerBand),
          },
        });
        await tx.pointsAccount.create({
          data: { ownerType: 'AGENT', ownerId: agentUser.id, roomId: '', balance: 0 },
        });
        // 信用盘期初：当作已经付过钱，但钱是借的——盘分（余额+额度）同步加上合同额度
        if (bookMode === 'CREDIT' && creditLimit > 0) {
          if (generalAgentRow) {
            await tx.$queryRaw`SELECT id FROM "Agent" WHERE "id" = ${generalAgentRow.id} FOR UPDATE`;
            await adjustCashDiskInTx(tx, this.points, {
              agentUserId: generalAgentRow.userId,
              bookMode: generalAgentRow.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH',
              delta: -creditLimit,
              bizType: 'TRANSFER_OUT',
              remark: `开房拨给代理期初额度 ${creditLimit}`,
              refType: 'agent_open',
              refId: agentUser.id,
              idempotencyKey: `agent_open_general:${agentUser.id}`,
            });
          }
          await adjustCashDiskInTx(tx, this.points, {
            agentUserId: agentUser.id,
            bookMode: 'CREDIT',
            delta: creditLimit,
            bizType: 'OPEN',
            remark: `建号期初信用额度 ${creditLimit}`,
            refType: 'agent_open',
            refId: agentUser.id,
            idempotencyKey: `agent_open:${agentUser.id}`,
            createIfMissing: true,
          });
        }

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
            platformFeeDueAt,
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
        if (bookMode === 'CREDIT' && creditLimit > 0) {
          await recordCreditIssueDebtInTx(tx, {
            ...roomCreditDebtFilter({
              agentUserId: agentUser.id,
              generalUserId: generalAgentRow?.userId ?? null,
              roomId: room.id,
            }),
            amount: creditLimit,
            idempotencyKey: `credit_debt:agent_open:${agentUser.id}`,
            remark: `开房期初额度 ${creditLimit}`,
            refType: 'agent_open',
            refId: room.id,
          });
        }

        await tx.roomGameConfig.createMany({
          data: games.map((gameCode) => {
            const noRobot = isNoChatRobotGame(gameCode);
            const plan = noRobot ? offRobotPlan() : platformDefaultRobotPlan();
            return {
              roomId: room.id,
              gameCode,
              enabled: true,
              robotCount: plan.robotCount,
              robotPlan: JSON.parse(JSON.stringify(plan)),
            };
          }),
        });

        /*
         * 房间级授权只给**直挂房**写。
         *
         * 挂总代的房整体跟着该总代的「可见总监」名单走，压根不读这张表，
         * 给它写等于往库里塞一批永远不会被读到的行，日后查权限只会更乱。
         * 建房表单上的勾选对这类房也就没有意义（前端已锁定并说明）。
         */
        if (!generalAgentRow) {
          if (grantOwnerIds.length) {
            await tx.roomOwnerGrant.createMany({
              data: grantOwnerIds.map((ownerId) => ({ roomId: room.id, ownerId })),
              skipDuplicates: true,
            });
          } else {
            /* 一个总监都没勾：挂到管理名下，房间不会变成没人可见的孤儿 */
            const admin = await tx.user.findFirst({
              where: { role: 'ADMIN' },
              select: { id: true },
            });
            if (admin) {
              await tx.roomOwnerGrant.create({
                data: { roomId: room.id, ownerId: admin.id },
              });
            }
          }
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
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH' && !(await this.scope.isGeneralSide(actor))) {
      throw new ForbiddenException('仅管理员、总监或总代可重置代理密码');
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

  /** 该房月费的下限：挂总代就是平台给总代定的单价，直挂房没有下限 */
  private async roomFeeFloorOf(generalAgentId: string | null): Promise<number> {
    if (!generalAgentId) return 0;
    const general = await this.prisma.agent.findUnique({
      where: { id: generalAgentId },
      select: { roomMonthlyFee: true },
    });
    return roomFeeFloor(asMoney(general?.roomMonthlyFee ?? 0));
  }

  /*
   * 这里曾有 visibilityPeerRoomIds：给一间房授权时把同总代的兄弟房一起改。
   * 现在挂总代的房根本不看房间级名单，房间级授权只可能落在直挂房上，
   * 联动范围永远只有它自己，这个函数没有意义了。
   */

  /**
   * 房间级可见性只对**直挂房**有效。
   *
   * 挂了总代的房整体跟着总代那一份名单走（见 console-scope 文件头）：
   * 总代对某个总监可见，他名下所有房就都可见，不能再单独关掉某一间——
   * 总监是按总代账期结账的，只放开一半房间，他拉出来的总表就少了另一半的
   * 流水和月费，照着那个数结账必然算错。所以这里直接拒，让人去总代页改。
   */
  private async assertRoomLevelVisibilitySettable(roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { generalAgentId: true, generalAgent: { select: { user: { select: { nickname: true } } } } },
    });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.generalAgentId) {
      const name = room.generalAgent?.user?.nickname || '该总代';
      throw new BadRequestException(
        `本房挂了总代「${name}」，可见性由总代那边统一决定，不能按房单独设。请到总代详情页改`,
      );
    }
  }

  async grantOwner(actor: ConsoleActor, roomId: string, ownerUserId: string) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException('仅管理员可授权房主可见');
    const owner = await this.prisma.user.findUnique({ where: { id: ownerUserId } });
    if (!owner || owner.role !== 'BRANCH') throw new BadRequestException('目标必须是房主(BRANCH)');
    await this.assertRoomLevelVisibilitySettable(roomId);

    await this.prisma.roomOwnerGrant.createMany({
      data: [{ roomId, ownerId: ownerUserId }],
      skipDuplicates: true,
    });
    const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
    if (admin) {
      await this.prisma.roomOwnerGrant.deleteMany({
        where: { roomId, ownerId: admin.id },
      });
    }
    await this.adminLog.log(actor.id, 'ROOM_GRANT_OWNER', roomId, { ownerUserId });
    return { ok: true, roomCount: 1 };
  }

  async revokeOwner(actor: ConsoleActor, roomId: string, ownerUserId: string) {
    if (actor.role !== 'ADMIN') throw new ForbiddenException();
    await this.assertRoomLevelVisibilitySettable(roomId);
    await this.prisma.roomOwnerGrant.deleteMany({
      where: { roomId, ownerId: ownerUserId },
    });

    /* 一个总监都不剩时挂到管理名下，房间不会变成没人可见的孤儿 */
    const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
    if (admin) {
      const left = await this.prisma.roomOwnerGrant.count({
        where: { roomId, owner: { role: 'BRANCH' } },
      });
      if (left === 0) {
        await this.prisma.roomOwnerGrant.upsert({
          where: { roomId_ownerId: { roomId, ownerId: admin.id } },
          update: {},
          create: { roomId, ownerId: admin.id },
        });
      }
    }
    await this.adminLog.log(actor.id, 'ROOM_REVOKE_OWNER', roomId, { ownerUserId });
    return { ok: true, roomCount: 1 };
  }

  /** 上传/更换房间图标（管理/房主/本房代理）；禁止外链 */
  async updateIcon(actor: ConsoleActor, roomId: string, dataUrl: string) {
    if (
      !['ADMIN', 'BRANCH', 'GENERAL', 'AGENT'].includes(actor.role)
      && !(await this.scope.isGeneralSide(actor))
    ) {
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
    if (actor.role === 'PROXY' && !(await this.scope.isGeneralSide(actor))) {
      throw new ForbiddenException('房间代理子账号不能改房间状态');
    }
    if ((actor.role === 'AGENT' || await this.scope.isGeneralSide(actor)) && status === 'CLOSED') {
      throw new ForbiddenException('关闭房间需要管理或总监操作');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.update({
      where: { id: roomId },
      data: status === 'CLOSED' ? CLOSE_ROOM_PATCH : { status },
    });
    await this.syncOwnerLoginWithOpenRooms(roomId, actor.id);
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
      const asked = Math.max(0, Math.floor(Number(body.monthlyFee) || 0));
      /*
       * 建房时卡了下限，改月费这条路也必须卡：
       * 否则建的时候填够、回头再调低，总代照样每月倒贴平台单价的差额。
       * 允许改成 0（= 这间房不收代理月费），那是总代自己让利，平台照单价收。
       */
      const floor = await this.roomFeeFloorOf(room.generalAgentId);
      if (floor > 0 && asked > 0 && asked < floor) {
        throw new BadRequestException(
          `该总代名下房间月费不得低于平台单价 ${floor}（多收的差价归总代）`,
        );
      }
      data.monthlyFee = asked;
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

    if (nextFee > 0) {
      /* 从不收改成收：以「现在」为新锚点，下次结账收第一笔 */
      const willHaveNext =
        data.nextBillAt !== undefined ? data.nextBillAt : room.nextBillAt;
      if (!willHaveNext) {
        data.nextBillAt = initialBillAt(new Date());
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
   * 总代（或管理/总监）改本房代理占成。本期房间账单仍按旧档，从该房下一账期起换新档。
   * 新档不能超过总代当前/已预约里更严的一档。
   */
  async setAgentShareRate(actor: ConsoleActor, roomId: string, shareRateRaw: number) {
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        status: true,
        settleCycle: true,
        ownerAgentId: true,
        generalAgentId: true,
        ...ROOM_AGENT_SHARE_SCHEDULE_SELECT,
        generalAgent: {
          select: { userId: true, ...GENERAL_SHARE_SCHEDULE_SELECT },
        },
      },
    });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.status === 'CLOSED') throw new BadRequestException('房间已关闭，不能改占成');

    const generalSide = await this.scope.isGeneralSide(actor);
    if (generalSide) {
      const rootId = await this.scope.generalRootId(actor);
      if (!room.generalAgent || room.generalAgent.userId !== rootId) {
        throw new ForbiddenException('只能改自己名下房间的代理占成');
      }
    } else if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH') {
      throw new ForbiddenException('仅总代或管理可改代理占成');
    }

    const cap = room.generalAgent
      ? roomAgentShareCap(scheduleFromAgent(room.generalAgent))
      : DIRECT_AGENT_SHARE_CAP;
    const nextRate = parseAgentShareRate(shareRateRaw, cap);

    const cycle = normalizeSettleCycle(room.settleCycle);
    const calendar = shanghaiSettleBounds(cycle, 0);
    const live = materializeShareSchedule(scheduleFromRoom(room), calendar.periodStart);
    const sameAsCurrent = Math.abs(live.shareRate - nextRate) < 1e-9;
    const next = sameAsCurrent
      ? { ...live, pendingShareRate: null, pendingShareFrom: null }
      : { ...live, pendingShareRate: nextRate, pendingShareFrom: calendar.periodEnd };

    await this.prisma.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: roomId },
        data: roomSchedulePrismaData(next),
      });
      /* 代理档案上的占成跟房间本期档对齐，列表不至于和房间详情各说各的 */
      if (room.ownerAgentId) {
        await tx.agent.update({
          where: { id: room.ownerAgentId },
          data: { shareRate: next.shareRate },
        });
      }
    });

    const view = publicRoomAgentShareView({
      agentShareRate: next.shareRate,
      agentShareRateSince: next.shareRateSince,
      prevAgentShareRate: next.prevShareRate,
      pendingAgentShareRate: next.pendingShareRate,
      pendingAgentShareFrom: next.pendingShareFrom,
    });
    await this.adminLog.log(actor.id, 'ROOM_AGENT_SHARE_SET', roomId, {
      before: publicRoomAgentShareView(room),
      after: view,
      nextRate,
      cap,
      effectiveFrom: next.pendingShareFrom,
    });
    return {
      ok: true,
      ...view,
      pendingAgentShareFrom: view.pendingAgentShareFrom?.toISOString() ?? null,
      agentShareCap: cap,
      message: view.pendingAgentShareRate == null
        ? '已保存。与本期占成相同，未预约下期变更'
        : '已保存。本期仍按原占成结算，下期起按新占成',
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
      await this.syncOwnerLoginWithOpenRooms(roomId, actor.id);
      return {
        ok: true,
        mode: 'closed' as const,
        message: '房间已是关闭状态。勾选「显示已关闭」可查看',
      };
    }
    await this.prisma.room.update({ where: { id: roomId }, data: CLOSE_ROOM_PATCH });
    await this.syncOwnerLoginWithOpenRooms(roomId, actor.id);
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

  /**
   * 真删除：只许清没有注单/账本的空房（测完关掉的那种）。
   * 有过钱的房继续走关房，账本留着对账。
   */
  async purge(actor: ConsoleActor, roomId: string) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException('仅管理员可彻底删除房间');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: {
        id: true,
        roomNo: true,
        name: true,
        status: true,
        ownerAgentId: true,
        ownerAgent: { select: { id: true, userId: true } },
      },
    });
    if (!room) {
      return { ok: true, mode: 'gone' as const, message: '房间已不存在' };
    }
    if (room.status !== 'CLOSED') {
      throw new BadRequestException('请先关闭房间，再彻底删除');
    }
    const reasons = roomPurgeBlockReasons(await this.purgeCounts(roomId));
    if (reasons.length) {
      throw new BadRequestException(`这间房不能真删：${reasons.join('；')}。有过流水的房只能关闭`);
    }

    const owner = room.ownerAgent;
    await this.prisma.$transaction(async (tx) => {
      await tx.pointsAccount.deleteMany({
        where: {
          OR: [
            { roomId },
            { ownerType: 'ROOM', ownerId: roomId },
          ],
          ledgers: { none: {} },
          balance: 0,
          frozen: 0,
        },
      });
      await tx.room.delete({ where: { id: roomId } });
    });

    let ownerPurged = false;
    if (owner) {
      ownerPurged = await this.purgeEmptyOwnerAgent(owner.id, owner.userId);
    }
    await this.adminLog.log(actor.id, 'ROOM_HARD_PURGE', roomId, {
      name: room.name,
      roomNo: room.roomNo,
      ownerUserId: owner?.userId ?? null,
      ownerPurged,
    });
    return {
      ok: true,
      mode: 'purged' as const,
      message: ownerPurged
        ? '房间和空壳代理已彻底删除'
        : '房间已彻底删除',
    };
  }

  private async purgeCounts(roomId: string) {
    const [rounds, settles, fundOrders, leftoverBooks, rebates] = await Promise.all([
      this.prisma.gameRound.count({ where: { roomId } }),
      this.prisma.roomWeekSettle.count({ where: { roomId } }),
      this.prisma.rechargeOrder.count({ where: { roomId } }),
      this.prisma.pointsAccount.count({
        where: {
          AND: [
            {
              OR: [
                { roomId },
                { ownerType: 'ROOM', ownerId: roomId },
              ],
            },
            {
              OR: [
                { balance: { not: 0 } },
                { frozen: { not: 0 } },
                { ledgers: { some: {} } },
              ],
            },
          ],
        },
      }),
      this.prisma.dailyRebateSettlement.count({ where: { roomId } }),
    ]);
    return { rounds, settles, fundOrders, leftoverBooks, rebates };
  }

  /** 名下再无房间、账本也是空的，才连代理账号一起抹掉 */
  private async purgeEmptyOwnerAgent(agentId: string, userId: string): Promise<boolean> {
    const roomsLeft = await this.prisma.room.count({
      where: {
        OR: [{ ownerAgentId: agentId }, { generalAgentId: agentId }],
      },
    });
    if (roomsLeft > 0) return false;
    const staff = await this.prisma.user.findMany({
      where: { parentId: userId, role: { in: ['PROXY', 'CS'] } },
      select: { id: true },
    });
    const ids = [userId, ...staff.map((s) => s.id)];
    const dirty = await this.prisma.pointsAccount.count({
      where: {
        ownerId: { in: ids },
        OR: [
          { balance: { not: 0 } },
          { frozen: { not: 0 } },
          { ledgers: { some: {} } },
        ],
      },
    });
    if (dirty > 0) return false;
    const [bets, orders] = await Promise.all([
      this.prisma.bet.count({ where: { playerId: { in: ids } } }),
      this.prisma.rechargeOrder.count({
        where: { OR: [{ playerId: { in: ids } }, { reviewerId: { in: ids } }] },
      }),
    ]);
    if (bets > 0 || orders > 0) return false;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.pointsAccount.deleteMany({
          where: { ownerId: { in: ids }, ledgers: { none: {} } },
        });
        if (staff.length) {
          await tx.user.deleteMany({ where: { id: { in: staff.map((s) => s.id) } } });
        }
        await tx.user.delete({ where: { id: userId } });
      });
      return true;
    } catch (err) {
      this.logger.warn(`空壳代理 ${userId} 抹不掉，账号保留停用`, err);
      return false;
    }
  }

  /**
   * 一代理一房：最后一间营业房关了，房主代理和名下子账号/客服立刻停用、踢下线。
   * 房再打开则把这批人启回来。名下还有别的开着的房，不动登录。
   */
  private async syncOwnerLoginWithOpenRooms(roomId: string, actorId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: {
        ownerAgent: { select: { id: true, userId: true } },
      },
    });
    const owner = room?.ownerAgent;
    if (!owner) return;
    const openLeft = await this.prisma.room.count({
      where: { ownerAgentId: owner.id, ...OPEN_ROOM_WHERE },
    });
    const staff = await this.prisma.user.findMany({
      where: { parentId: owner.userId, role: { in: ['PROXY', 'CS'] } },
      select: { id: true },
    });
    const ids = [owner.userId, ...staff.map((s) => s.id)];
    if (openLeft <= 0) {
      const retired = await this.prisma.user.updateMany({
        where: { id: { in: ids }, status: 'ACTIVE' },
        data: { status: 'DISABLED', tokenVersion: { increment: 1 } },
      });
      if (retired.count) {
        await this.adminLog.log(actorId, 'ROOM_OWNER_RETIRE', roomId, {
          ownerUserId: owner.userId,
          disabled: retired.count,
        });
      }
      return;
    }
    const restored = await this.prisma.user.updateMany({
      where: { id: { in: ids }, status: 'DISABLED' },
      data: { status: 'ACTIVE' },
    });
    if (restored.count) {
      await this.adminLog.log(actorId, 'ROOM_OWNER_RESTORE', roomId, {
        ownerUserId: owner.userId,
        enabled: restored.count,
      });
    }
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
    if (actor.role === 'PROXY' && !(await this.scope.isGeneralSide(actor))) {
      throw new ForbiddenException('房间代理子账号不能改游戏设置');
    }
    if (await this.scope.isGeneralSide(actor) && data.rebateRate !== undefined) {
      throw new ForbiddenException('总代不能改玩家回水');
    }
    if (await this.scope.isGeneralSide(actor)
      && (data.robotCount !== undefined || data.robotPlan !== undefined)) {
      throw new ForbiddenException('总代不能改机器人托');
    }
    if (actor.role !== 'AGENT' && data.rebateRate !== undefined) {
      throw new ForbiddenException('只有本房代理能改玩家回水');
    }
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
      const room = await this.prisma.room.findUnique({
        where: { id: roomId },
        select: {
          ownerAgent: { select: { flowRate: true, gameRates: true } },
          generalAgent: {
            select: {
              flowRate: true,
              downlineFlowRate: true,
              playerMinRate: true,
              playerMaxRate: true,
              gameRates: true,
            },
          },
        },
      });
      const policy = await this.prisma.rebatePolicy.findUnique({ where: { id: 1 } });
      const platform = readPlatformBounds(policy);
      const gameRow = await this.prisma.game.findUnique({
        where: { code: gameCode },
        select: { category: true },
      });
      const band = bandForRoomGame({
        defaults: policy?.defaults,
        platform,
        gameCode,
        category: gameRow?.category,
        hasGeneral: !!room?.generalAgent,
        generalGameRates: room?.generalAgent?.gameRates,
        agentGameRates: room?.ownerAgent?.gameRates,
      }).pkg;
      const P = Number(data.rebateRate);
      if (!Number.isFinite(P) || P < band.playerMin - 1e-9 || P > band.playerMax + 1e-9) {
        throw new BadRequestException(
          `玩家回水须在 ${pctLabel(band.playerMin)}～${pctLabel(band.playerMax)}`,
        );
      }
      data.rebateRate = clampPlayerRateToBand(P, band);
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
          robotCount: data.robotCount ?? (isNoChatRobotGame(gameCode) ? 0 : 50),
          rebateRate: data.rebateRate ?? null,
          robotPlan: robotPlanNorm
            ?? (isNoChatRobotGame(gameCode) ? offRobotPlan() : platformDefaultRobotPlan()),
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
            ...GENERAL_SHARE_SCHEDULE_SELECT,
            user: { select: { uid: true, nickname: true, username: true } },
          },
        },
        ownerGrants: {
          include: {
            owner: { select: { id: true, uid: true, nickname: true, username: true, role: true } },
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
      where: { roomId, status: 'APPROVED', player: { role: 'PLAYER' } },
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
    /* 两种盘同一条公式；详情页读实时值，不走下注那条缓存 */
    const flyCover = await agentFlyAvailable(
      this.prisma,
      room.ownerAgent?.userId,
      bookMode,
    );
    const agentShareView = publicRoomAgentShareView(room);
    const creditBook =
      bookMode === 'CREDIT' && creditLimit > 0
        ? computeCreditBook({
            creditLimit,
            pointsQuota,
            playerBalances: asMoney(playerPointsTotal),
            csBalances,
            agentShareRate: agentShareView.agentShareRate,
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
      ...publicRoomAgentShareView(room),
      agentShareCap: room.generalAgent
        ? roomAgentShareCap(scheduleFromAgent(room.generalAgent))
        : DIRECT_AGENT_SHARE_CAP,
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
      memberCount: members.length,
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
            /** 对外唯一的「代理余额」：信用盘=剩余信用+未结佣金 */
            agentBalance: agentDisplayBalance({
              bookMode,
              balance: agentBalance ?? 0,
              pointsQuota: asMoney(room.ownerAgent.pointsQuota),
            }),
            unsettledWage: undefined,
            user: room.ownerAgent.user,
          }
        : null,
      /*
       * 房间级可见性名单。挂总代的房不看这份，改由总代那边统一决定，
       * 所以这类房返回空名单 + roomVisibilitySettable=false，让界面直接摆成只读，
       * 而不是让人点了才报错。
       */
      ownerGrants: room.generalAgentId
        ? []
        : room.ownerGrants.filter((g) => g.owner.role === 'BRANCH'),
      /** 能否按房单独设可见总监；挂了总代就不能 */
      roomVisibilitySettable: !room.generalAgentId,
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
    clientRequestId?: string,
  ) {
    if (actor.role !== 'ADMIN' && actor.role !== 'BRANCH' && !(await this.scope.isGeneralSide(actor))) {
      throw new ForbiddenException('仅管理、总监或总代可调整合同额度');
    }
    await this.scope.assertRoomAccess(actor, roomId);
    /*
     * 幂等锚点由前端带来。原先用 randomUUID 当键，等于没有幂等：
     * 连点两次或网络重试，合同额度就加两倍、总代额度扣两倍。
     */
    const orderNo = assertFundOrderNo(clientRequestId);
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
        generalAgentId: true,
        ownerAgent: { select: { id: true, userId: true, pointsQuota: true } },
      },
    });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.bookMode !== 'CREDIT') {
      throw new BadRequestException('仅信用盘可调整合同额度');
    }
    if (!room.ownerAgent) throw new BadRequestException('房间未绑定代理');
    if ((actor.role === 'ADMIN' || actor.role === 'BRANCH') && room.generalAgentId) {
      throw new BadRequestException('该房间挂了总代，请到总代账户给房间代理调额度');
    }

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

      /*
       * 重放整笔跳过：额度流水自己会去重，但 Room.creditLimit 是「读旧值 + delta」，
       * 不拦住的话第二次会在新值上再加一次。
       */
      const replayed = await tx.agentQuotaLedger.findFirst({
        where: { idempotencyKey: `credit_limit_bump:${roomId}:${orderNo}` },
        select: { id: true },
      });
      if (replayed) {
        const cur = asMoney(locked.creditLimit);
        const quotaNow = asMoney(locked.ownerAgent.pointsQuota);
        const [pb, cb] = await Promise.all([
          sumRoomPlayerBalances(tx, roomId),
          sumAgentCsBalances(tx, locked.ownerAgent.userId),
        ]);
        return {
          before: cur,
          after: cur,
          quotaBefore: quotaNow,
          quotaAfter: quotaNow,
          issued: roundMoney(pb + cb),
          playerBalances: pb,
          csBalances: cb,
          replayed: true,
        };
      }

      const [playerBalances, csBalances] = await Promise.all([
        sumRoomPlayerBalances(tx, roomId),
        sumAgentCsBalances(tx, locked.ownerAgent.userId),
      ]);
      const issued = roundMoney(playerBalances + csBalances);
      const before = asMoney(locked.creditLimit);
      const quotaBefore = asMoney(locked.ownerAgent.pointsQuota);
      const after = roundMoney(before + delta);
      const quotaAfter = roundMoney(quotaBefore + delta);

      const ownerAcc = await tx.pointsAccount.findFirst({
        where: { ownerType: 'AGENT', ownerId: locked.ownerAgent.userId, roomId: '' },
        select: { balance: true },
      });
      const ownerDisk = Math.min(quotaBefore, asMoney(ownerAcc?.balance ?? 0));
      if (direction === 'down') {
        if (ownerDisk + 1e-9 < amount) {
          throw new BadRequestException(
            `盘分不足，最多可减 ${Math.max(0, ownerDisk)}（已发出的不能从这里扣）`,
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

      let generalUserId: string | null = null;
      if (room.generalAgentId) {
        await tx.$queryRaw`SELECT id FROM "Agent" WHERE "id" = ${room.generalAgentId} FOR UPDATE`;
        const general = await tx.agent.findUnique({
          where: { id: room.generalAgentId },
          select: { userId: true, bookMode: true },
        });
        if (!general) throw new BadRequestException('总代账号无效');
        generalUserId = general.userId;
        const bumpKey = orderNo;
        await adjustCashDiskInTx(tx, this.points, {
          agentUserId: general.userId,
          bookMode: general.bookMode === 'CREDIT' ? 'CREDIT' : 'CASH',
          delta: -delta,
          bizType: direction === 'down' ? 'TRANSFER_IN' : 'TRANSFER_OUT',
          remark: `调房间代理合同额度 ${before}→${after}`,
          refType: 'room_credit_limit',
          refId: roomId,
          idempotencyKey: `credit_limit_general:${roomId}:${bumpKey}`,
        });
        await tx.room.update({
          where: { id: roomId },
          data: { creditLimit: after },
        });
        await adjustCashDiskInTx(tx, this.points, {
          agentUserId: locked.ownerAgent.userId,
          bookMode: 'CREDIT',
          quotaTo: quotaAfter,
          bizType: 'ADJUST',
          remark: `合同额度 ${before}→${after}${remark?.trim() ? `｜${remark.trim()}` : ''}`,
          refType: 'room_credit_limit',
          refId: roomId,
          idempotencyKey: `credit_limit_bump:${roomId}:${bumpKey}`,
        });
      } else {
        await tx.room.update({
          where: { id: roomId },
          data: { creditLimit: after },
        });
        await adjustCashDiskInTx(tx, this.points, {
          agentUserId: locked.ownerAgent.userId,
          bookMode: 'CREDIT',
          quotaTo: quotaAfter,
          bizType: 'ADJUST',
          remark: `合同额度 ${before}→${after}${remark?.trim() ? `｜${remark.trim()}` : ''}`,
          refType: 'room_credit_limit',
          refId: roomId,
          idempotencyKey: `credit_limit_bump:${roomId}:${orderNo}`,
        });
      }
      const debtFilter = roomCreditDebtFilter({
        agentUserId: locked.ownerAgent.userId,
        generalUserId,
        roomId,
      });
      if (direction === 'up') {
        await recordCreditIssueDebtInTx(tx, {
          ...debtFilter,
          amount,
          idempotencyKey: `credit_debt:credit_limit_bump:${roomId}:${orderNo}`,
          remark: `房间上分 ${amount}`,
          refType: 'room_credit_limit',
          refId: roomId,
        });
      } else {
        await consumeCreditIssueDebtInTx(tx, debtFilter, amount);
      }
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
    if (!(await this.scope.isGeneralSide(actor))) {
      throw new ForbiddenException('仅总代可调整名下房间整房飞盘');
    }
    const generalId = await this.scope.generalRootId(actor);
    await this.scope.assertRoomAccess(actor, roomId);
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, generalAgent: { select: { userId: true } } },
    });
    if (!room) throw new NotFoundException('房间不存在');
    if (room.generalAgent?.userId !== generalId) {
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
      message: flyEnabled ? '已开启飞盘' : '已关闭飞盘',
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
      message: flyEnabled ? '已开启飞盘' : '已关闭飞盘',
    };
  }

  /** 待审进房申请（代理团队房间） */
  async listPendingMembers(actor: ConsoleActor) {
    if (!['AGENT', 'PROXY', 'ADMIN', 'BRANCH', 'GENERAL'].includes(actor.role)) {
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
    if (!['AGENT', 'ADMIN', 'BRANCH'].includes(actor.role) && !(await this.scope.isGeneralSide(actor))) {
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
    if (!['AGENT', 'ADMIN', 'BRANCH'].includes(actor.role) && !(await this.scope.isGeneralSide(actor))) {
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
