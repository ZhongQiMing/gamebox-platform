import { BadRequestException, Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SlotEngine } from './slot-engine';
import { BcbmEngine } from './bcbm-engine';
import { FruitMachineEngine } from './fruit-machine-engine';
import { IsString, IsInt, IsOptional, IsObject, IsIn, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { asMoney, roundMoney } from '@gamebox/shared';
import type { Prisma } from '@prisma/client';
import { resolveTimeWindow } from '../../common/shanghai-range';
import { PrismaService } from '../../prisma/prisma.service';

export class TableInstantDto {
  @IsString() gameCode!: string;
  @IsString() side!: string;
  @IsInt() @Min(1) @Max(10_000_000) @Type(() => Number) amount!: number;
}

export class PlaceBetDto {
  @IsString() gameCode!: string;
  @IsInt() @Min(1) @Max(10_000_000) @Type(() => Number) amount!: number;
  @IsString() @MaxLength(100) clientRequestId!: string;
  @IsOptional() @IsString() @MaxLength(128) clientSeed?: string;
}

export class BcbmSpinDto {
  @IsString() gameCode!: string;
  @IsObject() bets!: Record<string, number>;
  @IsString() @MaxLength(100) clientRequestId!: string;
  @IsOptional() @IsString() @MaxLength(128) clientSeed?: string;
}

export class FruitSpinDto {
  @IsOptional() @IsString() gameCode?: string;
  @IsObject() bets!: Record<string, number>;
  @IsString() @MaxLength(100) clientRequestId!: string;
  @IsOptional() @IsString() @MaxLength(128) clientSeed?: string;
}

export class FruitGambleDto {
  @IsInt() @Min(1) @Max(10_000_000) @Type(() => Number) amount!: number;
  @IsString() @IsIn(['big', 'small']) choice!: 'big' | 'small';
  @IsString() @MaxLength(100) clientRequestId!: string;
}

@Controller('bet')
export class BetController {
  constructor(
    private slot: SlotEngine,
    private bcbm: BcbmEngine,
    private fruit: FruitMachineEngine,
    private prisma: PrismaService,
  ) {}

  /** POST /api/bet/table-instant — 已废弃：改为整局挂单 /api/table/:gameCode/bet */
  @Post('table-instant')
  tableInstantBet() {
    throw new BadRequestException('牌桌已改为整局结算，请使用 /api/table/:gameCode/bet');
  }

  /**
   * POST /api/bet/spin — 电子/街机一键下注+立即开奖（单事务，失败整体回滚）
   * 返回：中奖结果 + 新余额
   */
  @Post('spin')
  async spin(@CurrentUser() u: { id: string }, @Body() dto: PlaceBetDto) {
    const result = await this.slot.spin({
      playerId: u.id,
      gameCode: dto.gameCode,
      amount: dto.amount,
      clientSeed: dto.clientSeed,
      clientRequestId: dto.clientRequestId,
    });

    const balance = asMoney(
      result.balance ??
        (
          await this.prisma.pointsAccount.findUnique({
            where: { ownerId: u.id },
            select: { balance: true },
          })
        )?.balance ??
        0,
    );

    return {
      ...result,
      balance,
    };
  }

  /**
   * POST /api/bet/bcbm — 奔驰宝马街机：多仓位押注 + 即时开奖
   */
  @Post('bcbm')
  async bcbmSpin(@CurrentUser() u: { id: string }, @Body() dto: BcbmSpinDto) {
    return this.bcbm.spin({
      playerId: u.id,
      gameCode: dto.gameCode,
      bets: dto.bets,
      clientRequestId: dto.clientRequestId,
      clientSeed: dto.clientSeed,
    });
  }

  /**
   * POST /api/bet/fruit — 经典水果机：多符号押注 + 跑灯开奖（含特殊大奖）
   */
  @Post('fruit')
  async fruitSpin(@CurrentUser() u: { id: string }, @Body() dto: FruitSpinDto) {
    return this.fruit.spin({
      playerId: u.id,
      gameCode: dto.gameCode || 'fruit-machine',
      bets: dto.bets,
      clientRequestId: dto.clientRequestId,
      clientSeed: dto.clientSeed,
    });
  }

  /** POST /api/bet/fruit/gamble — 当局赢分大小再赌 */
  @Post('fruit/gamble')
  async fruitGamble(@CurrentUser() u: { id: string }, @Body() dto: FruitGambleDto) {
    return this.fruit.gamble({
      playerId: u.id,
      amount: dto.amount,
      choice: dto.choice,
      clientRequestId: dto.clientRequestId,
    });
  }

  /** GET /api/bet/fruit/pending-gamble — 查询可猜大小的当局赢分（进页恢复） */
  @Get('fruit/pending-gamble')
  async fruitPendingGamble(@CurrentUser() u: { id: string }) {
    return this.fruit.getPendingGamble(u.id);
  }

  /** POST /api/bet/fruit/abandon-gamble — 退币/放弃猜大小，清掉可再赌额度 */
  @Post('fruit/abandon-gamble')
  async fruitAbandonGamble(@CurrentUser() u: { id: string }) {
    return this.fruit.abandonGamble(u.id);
  }

  /**
   * GET /api/bet/report-summary?range=today|… 或 from=&to=
   * 竞猜报表顶部汇总：按时段全量统计（不受 history 条数上限影响），口径与自助回水有效流水一致。
   */
  @Get('report-summary')
  async reportSummary(
    @CurrentUser() u: { id: string },
    @Query('range') rangeKey?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ) {
    const window = resolveTimeWindow({
      range: rangeKey,
      fromMs: fromStr != null && fromStr !== '' ? Number(fromStr) : undefined,
      toMs: toStr != null && toStr !== '' ? Number(toStr) : undefined,
    });
    if (!window) throw new BadRequestException('无效的时间范围');
    const [from, to] = window;

    const bets = await this.prisma.bet.findMany({
      where: {
        playerId: u.id,
        status: { not: 'CANCELLED' },
        OR: [
          { settledAt: { gte: from, lt: to } },
          { settledAt: null, createdAt: { gte: from, lt: to } },
        ],
      },
      select: {
        amount: true,
        payout: true,
        validFlow: true,
        status: true,
      },
    });

    let orders = 0;
    let amount = 0;
    let validFlow = 0;
    let settledAmount = 0;
    let settledPayout = 0;
    for (const b of bets) {
      orders += 1;
      const amt = asMoney(b.amount);
      amount = roundMoney(amount + amt);
      if (b.status === 'PENDING') continue;
      settledAmount = roundMoney(settledAmount + amt);
      settledPayout = roundMoney(settledPayout + asMoney(b.payout));
      validFlow = roundMoney(validFlow + asMoney(b.validFlow));
    }

    const playerSettle = roundMoney(settledPayout - settledAmount);
    return {
      orders,
      amount,
      validFlow,
      playerSettle,
      houseSettle: roundMoney(-playerSettle),
    };
  }

  /** GET /api/bet/history — 下注历史（街机按局 / 彩票按期聚合；可按 range/from/to 筛） */
  @Get('history')
  async history(
    @CurrentUser() u: { id: string },
    @Query('range') rangeKey?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ) {
    const window = resolveTimeWindow({
      range: rangeKey,
      fromMs: fromStr != null && fromStr !== '' ? Number(fromStr) : undefined,
      toMs: toStr != null && toStr !== '' ? Number(toStr) : undefined,
    });
    const where: Prisma.BetWhereInput = {
      playerId: u.id,
      status: { not: 'CANCELLED' },
    };
    if (window) {
      const [from, to] = window;
      where.OR = [
        { settledAt: { gte: from, lt: to } },
        { settledAt: null, createdAt: { gte: from, lt: to } },
      ];
    }

    const list = await this.prisma.bet.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: window ? 3000 : 500,
      select: {
        id: true,
        betNo: true,
        amount: true,
        payout: true,
        status: true,
        betType: true,
        multiplier: true,
        odds: true,
        validFlow: true,
        settledAt: true,
        createdAt: true,
        roundId: true,
        issueId: true,
        game: { select: { name: true, code: true } },
        round: {
          select: {
            id: true,
            roundNo: true,
            outcome: true,
            startedAt: true,
            endedAt: true,
          },
        },
        issue: { select: { issueNo: true } },
      },
    });

    /** 街机按 round；彩票按 issue；其余单条 */
    type Agg = {
      id: string
      betNo: string
      amount: number
      payout: number
      validBet: number
      betCount: number
      status: string
      createdAt: Date
      settledAt: Date | null
      game: { name: string; code: string }
      roundId: string | null
      roundNo: string | null
      issueNo: string | null
      outcome: unknown
      details: Array<{
        position: string
        amount: number
        payout: number
        multiplier: number
        won: boolean
      }>
    }

    const byGroup = new Map<string, Agg>()
    const singles: Agg[] = []

    const mergeStatus = (cur: string, next: string) => {
      if (cur === 'PENDING' || next === 'PENDING') return 'PENDING'
      if (cur === 'WON' || next === 'WON') return 'WON'
      return next || cur
    }

    for (const b of list) {
      const detail = {
        position: b.betType || '',
        amount: asMoney(b.amount),
        payout: asMoney(b.payout),
        multiplier: Number(b.multiplier || b.odds || 0),
        won: asMoney(b.payout) > 0,
      }

      let groupKey: string | null = null
      let base: Omit<Agg, 'details'> | null = null

      if (b.roundId && b.round) {
        groupKey = `round:${b.roundId}`
        base = {
          id: b.roundId,
          betNo: b.round.roundNo || b.betNo,
          amount: asMoney(b.amount),
          payout: asMoney(b.payout),
          validBet: asMoney(b.validFlow || b.amount),
          betCount: 1,
          status: b.status,
          createdAt: b.createdAt,
          settledAt: b.settledAt,
          game: b.game,
          roundId: b.roundId,
          roundNo: b.round.roundNo,
          issueNo: null,
          outcome: b.round.outcome,
        }
      } else if (b.issueId && b.issue) {
        groupKey = `issue:${b.issueId}`
        base = {
          id: b.issueId,
          betNo: b.issue.issueNo,
          amount: asMoney(b.amount),
          payout: asMoney(b.payout),
          validBet: asMoney(b.validFlow || b.amount),
          betCount: 1,
          status: b.status,
          createdAt: b.createdAt,
          settledAt: b.settledAt,
          game: b.game,
          roundId: null,
          roundNo: null,
          issueNo: b.issue.issueNo,
          outcome: null,
        }
      }

      if (groupKey && base) {
        const existing = byGroup.get(groupKey)
        if (existing) {
          existing.amount += asMoney(b.amount)
          existing.payout += asMoney(b.payout)
          existing.validBet += asMoney(b.validFlow || b.amount)
          existing.betCount += 1
          existing.status = mergeStatus(existing.status, b.status)
          existing.details.push(detail)
          if (b.createdAt > existing.createdAt) existing.createdAt = b.createdAt
          if (b.settledAt && (!existing.settledAt || b.settledAt > existing.settledAt)) {
            existing.settledAt = b.settledAt
          }
        } else {
          byGroup.set(groupKey, { ...base, details: [detail] })
        }
      } else {
        singles.push({
          id: b.id,
          betNo: b.betNo,
          amount: asMoney(b.amount),
          payout: asMoney(b.payout),
          validBet: asMoney(b.validFlow || b.amount),
          betCount: 1,
          status: b.status,
          createdAt: b.createdAt,
          settledAt: b.settledAt,
          game: b.game,
          roundId: null,
          roundNo: null,
          issueNo: null,
          outcome: null,
          details: detail.position ? [detail] : [],
        })
      }
    }

    const rows = [...byGroup.values(), ...singles].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )
    return window ? rows : rows.slice(0, 100)
  }

  /** GET /api/bet/round/:id — 查单局详情（可证明公平验证用） */
  @Get('round/:id')
  async round(@Param('id') id: string, @CurrentUser() u: { id: string }) {
    return this.prisma.gameRound.findFirst({
      where: {
        id,
        state: 'SETTLED',
        OR: [
          { playerId: u.id },
          { bets: { some: { playerId: u.id } } },
        ],
      },
      select: {
        roundNo: true, state: true, outcome: true,
        serverSeed: true, serverSeedHash: true, clientSeed: true, nonce: true,
        startedAt: true, endedAt: true,
        game: { select: { name: true } },
      },
    });
  }
}
