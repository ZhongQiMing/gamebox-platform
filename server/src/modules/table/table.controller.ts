import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TableService } from './table.service';

class TableBetDto {
  @IsString() side!: string;
  @IsInt() @Min(1) @Max(10_000_000) @Type(() => Number) amount!: number;
  /** 可选：客户端幂等键，防连点双扣 */
  @IsOptional() @IsString() clientKey?: string;
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
   */
  @Post(':gameCode/bet')
  placeBet(
    @CurrentUser() u: { id: string },
    @Param('gameCode') gameCode: string,
    @Body() dto: TableBetDto,
  ) {
    return this.tableService.placeBet(u.id, {
      roomId: gameCode,
      side: dto.side,
      amount: dto.amount,
      clientKey: dto.clientKey,
    });
  }
}
