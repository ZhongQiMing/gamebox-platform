/**
 * 房间级控奖（彩票 / 牌桌 / 电玩）：庄家留存比例 + 目标回血金额。
 *
 * 例：某房本局真人注单合计 1000，留存目标 30%
 *   → 目标派彩 ≈ 700，庄家约留 300
 *   → 在 N 个候选结果里挑最接近目标的
 *   → 庄家净赢累计达到「目标金额」后自动 EXHAUSTED
 *
 * 约束：
 * - 必须指定房间；游戏可选单个或「全部已接入」
 * - 有一笔也控；赔率离散，只能尽量靠近
 * - 彩票/牌桌全平台共一开奖时，多房按误差加权折中
 */
import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asMoney, roundMoney } from '@gamebox/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminLogService } from '../admin/admin-log.service';
import { ConsoleScopeService, type ConsoleActor } from './console-scope.service';
import {
  CONTROL_ALL_GAME_CODES,
  CONTROL_ARCADE_CODES,
  CONTROL_EXECUTABLE_CODES,
  CONTROL_FIXED_CANDIDATE_TRIES,
  CONTROL_LOTTERY_CODES,
  CONTROL_MIN_BET_COUNT,
  CONTROL_SAFETY_MAX_DAYS,
  CONTROL_TABLE_CODES,
  CONTROL_TARGET_TYPE,
  controlCandidateTries,
  controlGameCodeMatchList,
  isControlExecutableCode,
  isControlPolicyGameOk,
  normalizeControlGameCode,
} from './control.constants';

export type ActiveHoldPolicy = {
  id: string;
  roomId: string;
  /** null = 该房全部已接入游戏 */
  gameCode: string | null;
  /** 庄家留存 0~1，如 0.3 */
  holdRatio: number;
  strength: number;
  candidateTries: number;
};

@Injectable()
export class ConsoleControlService {
  constructor(
    private prisma: PrismaService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
  ) {}

  meta() {
    return {
      model: 'ROOM_GAME_HOLD_RATIO_GOAL',
      description:
        '按「房间 + 游戏 + 本局总下注」设庄家留存%；用「目标回血金额」决定跑到何时自动结束，无需猜时长。',
      example:
        '分分彩某房本局下注 1000、留存 30% → 目标派彩约 700；目标回血 5000 则庄家净赢累计到约 5000 后自动停。',
      stakeMeaning: '总下注 = 该房该游戏该期真人注单金额合计（不是整天流水）。',
      goalMeaning:
        '目标金额 = 自启用起该房该游戏范围庄家净赢（下注−派彩）累计；达到后状态变为已达成。',
      supportedGames: [...CONTROL_EXECUTABLE_CODES],
      allGameCodes: [...CONTROL_ALL_GAME_CODES],
      liveGames: [...CONTROL_EXECUTABLE_CODES],
      lotteryGames: [...CONTROL_LOTTERY_CODES],
      tableGames: [...CONTROL_TABLE_CODES],
      arcadeGames: [...CONTROL_ARCADE_CODES],
      minBetCount: CONTROL_MIN_BET_COUNT,
      exactGuarantee: false,
      sharedDrawNote:
        '彩票/牌桌全平台同一开奖结果；多房同时开启时按各房误差加权折中。电玩按单人单局控。',
      candidateTries: CONTROL_FIXED_CANDIDATE_TRIES,
      candidateNote: '搜索深度由系统固定，运营只需设庄家留存%与目标金额。',
      safetyMaxDays: CONTROL_SAFETY_MAX_DAYS,
    };
  }

  async list(actor: ConsoleActor) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException('仅超管可查看控奖');
    const rows = await this.prisma.controlPolicy.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        room: { select: { id: true, name: true, roomNo: true } },
      },
    });
    const now = Date.now();

    const progressKeys = new Map<string, { roomId: string; gameCode: string | null; from: Date }>();
    for (const r of rows) {
      if (!r.roomId || r.goalAmount == null) continue;
      if (!['ACTIVE', 'EXHAUSTED', 'HALTED', 'DRAFT'].includes(r.status)) continue;
      const key = `${r.roomId}|${r.gameCode ?? '*'}|${r.startAt.toISOString()}`;
      if (!progressKeys.has(key)) {
        progressKeys.set(key, { roomId: r.roomId, gameCode: r.gameCode, from: r.startAt });
      }
    }
    const recoveredMap = new Map<string, number>();
    await Promise.all(
      [...progressKeys.entries()].map(async ([key, q]) => {
        recoveredMap.set(key, await this.sumRoomHousePnl(q.roomId, q.gameCode, q.from));
      }),
    );

    return rows.map((r) => {
      const start = r.startAt.getTime();
      const end = r.endAt.getTime();
      const inWindow = start <= now && now < end;
      const valid =
        !!r.roomId &&
        isControlPolicyGameOk(r.gameCode) &&
        r.targetType === CONTROL_TARGET_TYPE &&
        r.goalAmount != null &&
        Number(r.goalAmount) > 0;
      const effective = r.status === 'ACTIVE' && inWindow && valid;
      const goalAmount = r.goalAmount != null ? Number(r.goalAmount) : null;
      const progressKey = r.roomId
        ? `${r.roomId}|${r.gameCode ?? '*'}|${r.startAt.toISOString()}`
        : '';
      const recoveredAmount = progressKey ? (recoveredMap.get(progressKey) ?? 0) : 0;
      const progressPct =
        goalAmount && goalAmount > 0
          ? Math.min(100, Math.round((Math.max(0, recoveredAmount) / goalAmount) * 1000) / 10)
          : null;
      return {
        ...r,
        goalAmount,
        recoveredAmount,
        progressPct,
        holdRatio: r.targetValue,
        candidateTries: controlCandidateTries(r.strength),
        inWindow,
        effective,
        legacyInvalid: !valid,
        windowState: now < start ? 'PENDING' : now >= end ? 'ENDED' : 'RUNNING',
      };
    });
  }

  async create(
    actor: ConsoleActor,
    body: {
      name: string;
      roomId?: string | null;
      /** 空/null = 该房全部已接入彩票 */
      gameCode?: string | null;
      /** 庄家留存百分比 1~90，或 0.01~0.9 小数 */
      holdRatioPct?: number;
      targetValue?: number;
      /** 目标回血金额（必填） */
      goalAmount?: number;
      strength?: number;
      /** 可选；默认立即开始 */
      startAt?: string;
      /** 可选；默认 start + 安全截止天数 */
      endAt?: string;
      remark?: string;
      activate?: boolean;
    },
  ) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException();

    const roomId = body.roomId?.trim() || null;
    if (!roomId) throw new BadRequestException('必须选择房间（按单房自算）');
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, name: true },
    });
    if (!room) throw new BadRequestException('房间不存在');

    const rawGame = body.gameCode?.trim() || '';
    let gameCode = !rawGame || rawGame === '*' || rawGame === '__ALL__' ? null : rawGame;
    gameCode = normalizeControlGameCode(gameCode);
    if (gameCode && !isControlExecutableCode(gameCode)) {
      throw new BadRequestException(
        `该游戏尚未接入控奖，可选：全部已接入，或 ${CONTROL_EXECUTABLE_CODES.join('、')}`,
      );
    }

    let holdRatio = Number(body.targetValue);
    if (body.holdRatioPct != null) {
      const pct = Number(body.holdRatioPct);
      holdRatio = pct > 1 ? pct / 100 : pct;
    }
    if (!Number.isFinite(holdRatio) || holdRatio < 0.01 || holdRatio > 0.9) {
      throw new BadRequestException('庄家留存比例须在 1%～90%');
    }

    const goalAmount = Number(body.goalAmount);
    if (!Number.isFinite(goalAmount) || goalAmount < 1) {
      throw new BadRequestException('请填写目标回血金额（至少 1）');
    }
    if (goalAmount > 1e10) {
      throw new BadRequestException('目标金额过大');
    }

    const startAt = body.startAt ? new Date(body.startAt) : new Date();
    const endAt = body.endAt
      ? new Date(body.endAt)
      : new Date(startAt.getTime() + CONTROL_SAFETY_MAX_DAYS * 24 * 3600_000);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('时间无效');
    }
    if (!(startAt < endAt)) throw new BadRequestException('结束时间必须晚于开始时间');
    if (endAt.getTime() - startAt.getTime() > CONTROL_SAFETY_MAX_DAYS * 24 * 3600_000) {
      throw new BadRequestException(`安全截止最长 ${CONTROL_SAFETY_MAX_DAYS} 天（正常以目标金额达成结束）`);
    }

    const strength = 1;
    const gameLabel = gameCode ?? '全部游戏';

    const row = await this.prisma.controlPolicy.create({
      data: {
        name: body.name.trim() || `${room.name} ${gameLabel} 回血`,
        roomId,
        gameCode,
        targetType: CONTROL_TARGET_TYPE,
        targetValue: holdRatio,
        goalAmount: new Prisma.Decimal(roundMoney(goalAmount)),
        strength,
        startAt,
        endAt,
        status: body.activate ? 'ACTIVE' : 'DRAFT',
        remark: body.remark?.trim() || null,
        createdById: actor.id,
      },
    });

    await this.adminLog.log(actor.id, 'CONTROL_CREATE', row.id, {
      name: row.name,
      roomId,
      gameCode,
      holdRatio,
      goalAmount,
      candidateTries: CONTROL_FIXED_CANDIDATE_TRIES,
      startAt,
      endAt,
      activate: !!body.activate,
    });

    return row;
  }

  async setStatus(actor: ConsoleActor, id: string, status: string) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException();
    if (!['DRAFT', 'ACTIVE', 'HALTED'].includes(status)) {
      throw new BadRequestException('仅支持：草稿 / 启用 / 停止');
    }
    const row = await this.prisma.controlPolicy.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    const updated = await this.prisma.controlPolicy.update({
      where: { id },
      data: { status },
    });
    await this.adminLog.log(actor.id, 'CONTROL_STATUS', id, { status, from: row.status });
    return updated;
  }

  async remove(actor: ConsoleActor, id: string) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException();
    const row = await this.prisma.controlPolicy.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    await this.prisma.controlPolicy.delete({ where: { id } });
    await this.adminLog.log(actor.id, 'CONTROL_DELETE', id, {
      name: row.name,
      roomId: row.roomId,
      gameCode: row.gameCode,
      status: row.status,
      goalAmount: row.goalAmount != null ? Number(row.goalAmount) : null,
    });
    return { ok: true };
  }

  /** 开奖时：该游戏当前所有生效的房间留存策略（含「全部已接入」） */
  async getActiveHoldPolicies(gameCode: string): Promise<ActiveHoldPolicy[]> {
    if (!isControlExecutableCode(gameCode)) return [];
    const now = new Date();
    const codes = controlGameCodeMatchList(gameCode);
    const rows = await this.prisma.controlPolicy.findMany({
      where: {
        status: 'ACTIVE',
        roomId: { not: null },
        targetType: CONTROL_TARGET_TYPE,
        startAt: { lte: now },
        endAt: { gt: now },
        OR: [{ gameCode: { in: codes } }, { gameCode: null }],
        goalAmount: { not: null },
      },
      orderBy: { strength: 'desc' },
      take: 50,
    });
    return rows
      .filter((r): r is typeof r & { roomId: string } => !!r.roomId)
      .filter((r) => r.goalAmount != null && Number(r.goalAmount) > 0)
      .map((r) => ({
        id: r.id,
        roomId: r.roomId,
        gameCode: r.gameCode,
        holdRatio: Math.min(0.9, Math.max(0.01, r.targetValue)),
        strength: r.strength,
        candidateTries: CONTROL_FIXED_CANDIDATE_TRIES,
      }));
  }

  /**
   * 结算后：检查相关 ACTIVE 策略是否达到目标回血金额，达到则 EXHAUSTED。
   */
  async refreshGoalExhaustion(gameCode: string): Promise<void> {
    if (!isControlExecutableCode(gameCode)) return;
    const now = new Date();
    const codes = controlGameCodeMatchList(gameCode);
    const rows = await this.prisma.controlPolicy.findMany({
      where: {
        status: 'ACTIVE',
        roomId: { not: null },
        targetType: CONTROL_TARGET_TYPE,
        startAt: { lte: now },
        endAt: { gt: now },
        OR: [{ gameCode: { in: codes } }, { gameCode: null }],
        goalAmount: { not: null },
      },
      take: 80,
    });

    for (const r of rows) {
      if (!r.roomId || r.goalAmount == null) continue;
      const goal = Number(r.goalAmount);
      if (!(goal > 0)) continue;
      const recovered = await this.sumRoomHousePnl(r.roomId, r.gameCode, r.startAt);
      if (recovered + 1e-9 < goal) continue;
      await this.prisma.controlPolicy.update({
        where: { id: r.id },
        data: { status: 'EXHAUSTED' },
      });
      if (r.createdById) {
        await this.adminLog.log(r.createdById, 'CONTROL_EXHAUSTED', r.id, {
          roomId: r.roomId,
          gameCode: r.gameCode,
          goalAmount: goal,
          recoveredAmount: recovered,
          triggerGame: gameCode,
          auto: true,
        });
      }
    }
  }

  /**
   * 该房自 from 起、指定游戏范围的庄家净赢 = Σ(下注 − 派彩)。
   * gameCode=null 时累计该房全部已接入游戏。
   */
  async sumRoomHousePnl(
    roomId: string,
    gameCode: string | null,
    from: Date,
  ): Promise<number> {
    const codes = gameCode
      ? controlGameCodeMatchList(gameCode)
      : [...CONTROL_EXECUTABLE_CODES];
    if (!codes.length) return 0;

    type Row = { pnl: unknown };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT COALESCE(SUM(b.amount - b.payout), 0) AS pnl
      FROM "Bet" b
      INNER JOIN "Game" g ON g.id = b."gameId"
      LEFT JOIN LATERAL (
        SELECT 1 AS ok
        FROM "RoomMember" rm
        WHERE rm."playerId" = b."playerId"
          AND rm.status = 'APPROVED'
          AND rm."roomId" = ${roomId}
        LIMIT 1
      ) m ON true
      WHERE b.status IN ('WON', 'LOST')
        AND b."settledAt" >= ${from}
        AND g.code IN (${Prisma.join(codes)})
        AND (
          NULLIF(b.payload->'fly'->>'roomId', '') = ${roomId}
          OR (
            NULLIF(b.payload->'fly'->>'roomId', '') IS NULL
            AND m.ok IS NOT NULL
          )
        )
    `;
    return roundMoney(asMoney(rows[0]?.pnl ?? 0));
  }

  /**
   * 兼容旧调用：返回「搜索深度」用的最大强度（多房时取最大 N）。
   * @deprecated 开奖请用 getActiveHoldPolicies
   */
  async getActiveBias(gameCode: string): Promise<{
    strength: number;
    policyId?: string;
    candidateTries?: number;
  }> {
    const list = await this.getActiveHoldPolicies(gameCode);
    if (!list.length) return { strength: 0 };
    const top = list.reduce((a, b) => (a.strength >= b.strength ? a : b));
    return {
      strength: top.strength,
      policyId: top.id,
      candidateTries: top.candidateTries,
    };
  }
}
