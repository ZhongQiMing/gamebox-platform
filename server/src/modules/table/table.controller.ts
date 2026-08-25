import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { BetRateGuard } from '../../common/guards/bet-rate.guard';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { assertCanPlaceBet } from '../../common/utils/assert-player-bet';
import { TableService } from './table.service';

class TableBetDto {
  @IsString() side!: string;
  @IsInt() @Min(1) @Max(10_000_000) @Type(() => Number) amount!: number;
  /** 必填幂等键：同键重放，不重复扣分 */
  @IsString() @MinLength(8) @MaxLength(64) clientKey!: string;
  /** 6 位运营房间号（多房隔离必填） */
  @IsString() @MinLength(6) @MaxLength(6) roomNo!: string;
}

@Controller('table')
export class TableController {
  constructor(private tableService: TableService) {}

  /** GET /api/table/:gameCode/snapshot — 首屏 / 轮询相位（含公平承诺 hash） */
  @Public()
  @SkipThrottle()
  @Get(':gameCode/snapshot')
  snapshot(@Param('gameCode') gameCode: string) {
    return this.tableService.snapshot(gameCode);
  }

  /** GET /api/table/:gameCode/pay-table — 赔率单源（与结算同源） */
  @Public()
  @SkipThrottle()
  @Get(':gameCode/pay-table')
  payTable(@Param('gameCode') gameCode: string) {
    return this.tableService.payTable(gameCode);
  }

  /**
   * GET /api/table/:gameCode/verify — 可证明公平核验
   * 下注期只返回 hash；封盘后/历史局返回 seed+nonce
   */
  @Public()
  @Get(':gameCode/verify')
  verify(
    @Param('gameCode') gameCode: string,
    @Query('roundNo') roundNo?: string,
  ) {
    return this.tableService.verify(gameCode, roundNo);
  }

  /** GET /api/table/:gameCode/my-bets — 本局我的挂单 */
  @Get(':gameCode/my-bets')
  myBets(
    @CurrentUser() u: { id: string },
    @Param('gameCode') gameCode: string,
    @Query('roundNo') roundNo?: string,
  ) {
    return this.tableService.myRoundBets(u.id, gameCode, roundNo);
  }

  /**
   * POST /api/table/:gameCode/bet — 下注阶段挂单扣分（非整结）
   * 封盘后由 TableService 统一发牌结算
   *
   * 跳过全局按 IP 的 120 次/分，换成 BetRateGuard 的按玩家计数：
   * 连点筹码的手速远超 2 次/秒，且共用出口 IP 的玩家不该互相挤占额度。
   */
  @SkipThrottle()
  @UseGuards(BetRateGuard)
  @Post(':gameCode/bet')
  placeBet(
    @CurrentUser() u: { id: string; role?: string },
    @Param('gameCode') gameCode: string,
    @Body() dto: TableBetDto,
  ) {
    assertCanPlaceBet(u.role);
    return this.tableService.placeBet(u.id, {
      roomId: gameCode,
      side: dto.side,
      amount: dto.amount,
      clientKey: dto.clientKey,
      roomNo: dto.roomNo,
    });
  }

  /** POST /api/table/:gameCode/cancel-bets — 撤销本局我的全部挂单（仅下注期） */
  @Post(':gameCode/cancel-bets')
  cancelBets(
    @CurrentUser() u: { id: string; role?: string },
    @Param('gameCode') gameCode: string,
  ) {
    assertCanPlaceBet(u.role);
    return this.tableService.cancelMyBets(u.id, gameCode);
  }
}
