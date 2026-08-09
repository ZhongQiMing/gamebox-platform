/**
 * 房间级控奖（彩票 / 牌桌 / 电玩）：
 * ① 房间留存% + 目标回血
 * ② 单人偏赢/偏输 + 目标金额（共盘时偏赢须满足本局该房庄家不亏）
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
  CONTROL_ARCADE_CODES,
  CONTROL_LOTTERY_CODES,
  CONTROL_PROGRESS_BASE_CODES,
  CONTROL_SLOT_CATEGORY,
  CONTROL_TABLE_CODES,
  CONTROL_TARGET_TYPE,
  controlCandidateTries,
  controlGameCodeMatchList,
  isControlExecutableCode,
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

export type ActivePlayerPolicy = {
  id: string;
  roomId: string;
  gameCode: string | null;
  playerId: string;
  direction: 'WIN' | 'LOSE';
  candidateTries: number;
};

@Injectable()
export class ConsoleControlService {
  constructor(
    private prisma: PrismaService,
    private adminLog: AdminLogService,
    private scope: ConsoleScopeService,
  ) {}

  /** 在线电子老虎机 code（SlotEngine） */
  private async listOnlineSlotCodes(): Promise<string[]> {
    const rows = await this.prisma.game.findMany({
      where: { category: CONTROL_SLOT_CATEGORY, status: 'ONLINE' },
      select: { code: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => r.code);
  }

  /** 静态名单 ∪ 在线 SLOT；进度 /「全部」汇总用 */
  private async allControlGameCodes(): Promise<string[]> {
    const slots = await this.listOnlineSlotCodes();
    return [...new Set<string>([...CONTROL_PROGRESS_BASE_CODES, ...slots])];
  }

  /** 该 game 引擎是否已真正接入控奖（含动态 SLOT） */
  private async isEngineControlReady(gameCode: string | null | undefined): Promise<boolean> {
    if (gameCode == null || gameCode === '') return true;
    if (isControlExecutableCode(gameCode)) return true;
    const g = await this.prisma.game.findUnique({
      where: { code: gameCode },
      select: { category: true, status: true },
    });
    return g?.category === CONTROL_SLOT_CATEGORY && g.status === 'ONLINE';
  }

  /** 控奖可选游戏（管理端下拉；SLOT 动态） */
  async listControlGames(actor: ConsoleActor) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException('仅管理员可查看控奖');
    const rows = await this.prisma.game.findMany({
      where: {
        OR: [
          { code: { in: [...CONTROL_PROGRESS_BASE_CODES] } },
          { category: CONTROL_SLOT_CATEGORY, status: 'ONLINE' },
        ],
      },
      select: { code: true, name: true, category: true },
      orderBy: { code: 'asc' },
    });
    const byCode = new Map(rows.map((r) => [r.code, r.name]));
    const nameOf = (code: string) => byCode.get(code) || code;
    return {
      lottery: CONTROL_LOTTERY_CODES.map((code) => ({ code, name: nameOf(code) })),
      table: CONTROL_TABLE_CODES.map((code) => ({ code, name: nameOf(code) })),
      arcade: CONTROL_ARCADE_CODES.map((code) => ({ code, name: nameOf(code) })),
      slot: rows
        .filter((r) => r.category === CONTROL_SLOT_CATEGORY)
        .map((s) => ({ code: s.code, name: s.name })),
    };
  }

  async list(actor: ConsoleActor) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException('仅管理员可查看控奖');
    const rows = await this.prisma.controlPolicy.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        room: { select: { id: true, name: true, roomNo: true } },
      },
    });
    const now = Date.now();
    const playerIds = [...new Set(rows.map((r) => r.playerId).filter(Boolean))] as string[];
    const players = playerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: playerIds } },
          select: { id: true, nickname: true, uid: true, username: true },
        })
      : [];
    const playerMap = new Map(players.map((p) => [p.id, p]));
    const readyCodes = new Set(await this.allControlGameCodes());
    /* longhu 别名也视为就绪 */
    readyCodes.add('longhu');
    readyCodes.add('dragon-tiger');

    const roomProgressKeys = new Map<string, { roomId: string; gameCode: string | null; from: Date }>();
    const playerProgressKeys = new Map<string, {
      playerId: string;
      roomId: string;
      gameCode: string | null;
      from: Date;
      direction: 'WIN' | 'LOSE';
    }>();
    for (const r of rows) {
      if (!r.roomId || r.goalAmount == null) continue;
      if (!['ACTIVE', 'EXHAUSTED', 'HALTED', 'DRAFT'].includes(r.status)) continue;
      if (r.targetType === CONTROL_TARGET_TYPE) {
        const key = `H|${r.roomId}|${r.gameCode ?? '*'}|${r.startAt.toISOString()}`;
        if (!roomProgressKeys.has(key)) {
          roomProgressKeys.set(key, { roomId: r.roomId, gameCode: r.gameCode, from: r.startAt });
        }
      } else if (
        (r.targetType === 'PLAYER_WIN' || r.targetType === 'PLAYER_LOSE') &&
        r.playerId
      ) {
        const key = `P|${r.playerId}|${r.roomId}|${r.gameCode ?? '*'}|${r.targetType}|${r.startAt.toISOString()}`;
        if (!playerProgressKeys.has(key)) {
          playerProgressKeys.set(key, {
            playerId: r.playerId,
            roomId: r.roomId,
            gameCode: r.gameCode,
            from: r.startAt,
            direction: r.targetType === 'PLAYER_WIN' ? 'WIN' : 'LOSE',
          });
        }
      }
    }
    const recoveredMap = new Map<string, number>();
    await Promise.all([
      ...[...roomProgressKeys.entries()].map(async ([key, q]) => {
        recoveredMap.set(key, await this.sumRoomHousePnl(q.roomId, q.gameCode, q.from));
      }),
      ...[...playerProgressKeys.entries()].map(async ([key, q]) => {
        recoveredMap.set(
          key,
          await this.sumPlayerGoalProgress(q.playerId, q.roomId, q.gameCode, q.from, q.direction),
        );
      }),
    ]);

    return rows.map((r) => {
      const start = r.startAt.getTime();
      const end = r.endAt.getTime();
      const inWindow = start <= now && now < end;
      const isPlayerMode = r.targetType === 'PLAYER_WIN' || r.targetType === 'PLAYER_LOSE';
      const gameOk =
        r.gameCode == null ||
        r.gameCode === '' ||
        readyCodes.has(r.gameCode) ||
        readyCodes.has(normalizeControlGameCode(r.gameCode) || '');
      const valid =
        !!r.roomId &&
        gameOk &&
        r.goalAmount != null &&
        Number(r.goalAmount) > 0 &&
        (r.targetType === CONTROL_TARGET_TYPE
          || (isPlayerMode && !!r.playerId));
      const effective = r.status === 'ACTIVE' && inWindow && valid;
      const goalAmount = r.goalAmount != null ? Number(r.goalAmount) : null;
      let progressKey = '';
      if (r.roomId && r.targetType === CONTROL_TARGET_TYPE) {
        progressKey = `H|${r.roomId}|${r.gameCode ?? '*'}|${r.startAt.toISOString()}`;
      } else if (r.roomId && isPlayerMode && r.playerId) {
        progressKey = `P|${r.playerId}|${r.roomId}|${r.gameCode ?? '*'}|${r.targetType}|${r.startAt.toISOString()}`;
      }
      const recoveredAmount = progressKey ? (recoveredMap.get(progressKey) ?? 0) : 0;
      const progressPct =
        goalAmount && goalAmount > 0 && progressKey
          ? Math.min(100, Math.round((Math.max(0, recoveredAmount) / goalAmount) * 1000) / 10)
          : null;
      return {
        ...r,
        goalAmount,
        recoveredAmount,
        progressPct,
        holdRatio: r.targetType === CONTROL_TARGET_TYPE ? r.targetValue : null,
        mode: r.targetType,
        player: r.playerId ? playerMap.get(r.playerId) ?? null : null,
        candidateTries: controlCandidateTries(r.strength),
        inWindow,
        effective,
        legacyInvalid: !valid,
        windowState: now < start ? 'PENDING' : now >= end ? 'ENDED' : 'RUNNING',
        engineReady: gameOk,
      };
    });
  }

  create(actor: ConsoleActor, _body?: unknown): never {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException();
    throw new BadRequestException(
      '定向硬控策略已停用。请改用「全局软控」下的偏置策略（房间回血 / 房间放水 / 玩家偏赢 / 玩家偏输），并遵守日账铁律。',
    );
  }

  async setStatus(actor: ConsoleActor, id: string, status: string) {
    if (!this.scope.canManageControl(actor)) throw new ForbiddenException();
    if (!['DRAFT', 'ACTIVE', 'HALTED'].includes(status)) {
      throw new BadRequestException('仅支持：草稿 / 启用 / 停止');
    }
    if (status === 'ACTIVE') {
      throw new BadRequestException(
        '历史定向策略不可再启用。请删除后改用「全局软控」下的偏置策略。',
      );
    }
    const row = await this.prisma.controlPolicy.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    const updated = await this.prisma.controlPolicy.update({
      where: { id },
      data: { status },
    });
    await this.adminLog.log(actor.id, 'CONTROL_STATUS', id, {
      status, from: row.status,
    });
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

  /**
   * 旧硬控已停用：不再读 ACTIVE ControlPolicy。
   * 控奖统一走全局软控 + 软偏置（彩票/牌桌/街机/电子）。
   */
  getActiveHoldPolicies(_gameCode: string): ActiveHoldPolicy[] {
    return [];
  }

  /** @see getActiveHoldPolicies */
  getActivePlayerPolicies(_gameCode: string): ActivePlayerPolicy[] {
    return [];
  }

  /**
   * 结算后：检查相关 ACTIVE 策略是否达到目标金额，达到则 EXHAUSTED。
   */
  async refreshGoalExhaustion(gameCode: string): Promise<void> {
    if (!(await this.isEngineControlReady(gameCode))) return;
    const now = new Date();
    const codes = controlGameCodeMatchList(gameCode);
    const rows = await this.prisma.controlPolicy.findMany({
      where: {
        status: 'ACTIVE',
        roomId: { not: null },
        targetType: { in: [CONTROL_TARGET_TYPE, 'PLAYER_WIN', 'PLAYER_LOSE'] },
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

      let recovered: number;
      if (r.targetType === CONTROL_TARGET_TYPE) {
        recovered = await this.sumRoomHousePnl(r.roomId, r.gameCode, r.startAt);
      } else if (
        (r.targetType === 'PLAYER_WIN' || r.targetType === 'PLAYER_LOSE') &&
        r.playerId
      ) {
        recovered = await this.sumPlayerGoalProgress(
          r.playerId,
          r.roomId,
          r.gameCode,
          r.startAt,
          r.targetType === 'PLAYER_WIN' ? 'WIN' : 'LOSE',
        );
      } else {
        continue;
      }

      if (recovered + 1e-9 < goal) continue;
      await this.prisma.controlPolicy.update({
        where: { id: r.id },
        data: { status: 'EXHAUSTED' },
      });
      if (r.createdById) {
        await this.adminLog.log(r.createdById, 'CONTROL_EXHAUSTED', r.id, {
          roomId: r.roomId,
          gameCode: r.gameCode,
          playerId: r.playerId,
          targetType: r.targetType,
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
      : await this.allControlGameCodes();
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
   * 单人目标进度：偏赢 = Σ(派彩−下注)；偏输 = Σ(下注−派彩)。只计该玩家在该房真人注。
   */
  async sumPlayerGoalProgress(
    playerId: string,
    roomId: string,
    gameCode: string | null,
    from: Date,
    direction: 'WIN' | 'LOSE',
  ): Promise<number> {
    const codes = gameCode
      ? controlGameCodeMatchList(gameCode)
      : await this.allControlGameCodes();
    if (!codes.length) return 0;

    type Row = { pnl: unknown };
    const rows = direction === 'WIN'
      ? await this.prisma.$queryRaw<Row[]>`
          SELECT COALESCE(SUM(b.payout - b.amount), 0) AS pnl
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
            AND b."playerId" = ${playerId}
            AND b."settledAt" >= ${from}
            AND g.code IN (${Prisma.join(codes)})
            AND (
              NULLIF(b.payload->'fly'->>'roomId', '') = ${roomId}
              OR (
                NULLIF(b.payload->'fly'->>'roomId', '') IS NULL
                AND m.ok IS NOT NULL
              )
            )
        `
      : await this.prisma.$queryRaw<Row[]>`
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
            AND b."playerId" = ${playerId}
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
  getActiveBias(gameCode: string): {
    strength: number;
    policyId?: string;
    candidateTries?: number;
  } {
    const list = this.getActiveHoldPolicies(gameCode);
    if (!list.length) return { strength: 0 };
    const top = list.reduce((a, b) => (a.strength >= b.strength ? a : b));
    return {
      strength: top.strength,
      policyId: top.id,
      candidateTries: top.candidateTries,
    };
  }
}
