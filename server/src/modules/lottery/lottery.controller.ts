import {
  Controller, Post, Get, Body, Param, Query,
  DefaultValuePipe, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { BetRateGuard } from '../../common/guards/bet-rate.guard';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { LotteryService } from './lottery.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { assertCanPlaceBet } from '../../common/utils/assert-player-bet';

interface JwtUser { id: string; uid: string; role: string }

class LotteryBetItemDto {
  @IsString()
  @MaxLength(50)
  betType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  betValue?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amount!: number;
}

class LotteryBetDto extends LotteryBetItemDto {
  @IsString()
  @MaxLength(100)
  clientRequestId!: string;

  /** 6 位运营房间号（多房隔离必填） */
  @IsString()
  @MaxLength(6)
  roomNo!: string;
}

class LotteryBetBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LotteryBetItemDto)
  bets!: LotteryBetItemDto[];

  @IsString()
  @MaxLength(100)
  clientRequestId!: string;

  /** 6 位运营房间号（多房隔离必填；飞盘/信用与聊天同房） */
  @IsString()
  @MaxLength(6)
  roomNo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  chatText?: string;
}

@Controller('lottery')
export class LotteryController {
  constructor(private readonly lottery: LotteryService) {}

  /**
   * 批量投注（同一事务，全成全败）
   *
   * 与牌桌一致：跳过全局按 IP 的额度，改为按玩家计数。
   * 共用出口 IP（运营商 NAT、网吧、家庭 WiFi）的玩家不该互相挤占下注额度。
   */
  @SkipThrottle()
  @UseGuards(BetRateGuard)
  @Post(':gameCode/bet-batch')
  async betBatch(
    @Param('gameCode') gameCode: string,
    @Body() dto: LotteryBetBatchDto,
    @CurrentUser() user: JwtUser,
  ) {
    assertCanPlaceBet(user.role);
    return this.lottery.placeBetsBatch(user.id, gameCode, dto.bets || [], {
      clientRequestId: dto.clientRequestId,
      roomNo: dto.roomNo,
      chatText: dto.chatText,
    });
  }

  /** 投注（需登录）；限流同上，按玩家计数 */
  @SkipThrottle()
  @UseGuards(BetRateGuard)
  @Post(':gameCode/bet')
  async bet(
    @Param('gameCode') gameCode: string,
    @Body() dto: LotteryBetDto,
    @CurrentUser() user: JwtUser,
  ) {
    assertCanPlaceBet(user.role);
    return this.lottery.placeBet(
      user.id,
      gameCode,
      dto.betType,
      dto.betValue,
      dto.amount,
      dto.clientRequestId,
      dto.roomNo,
    );
  }

  /** 取消当前期全部未结算注单（需登录） */
  @Post(':gameCode/cancel')
  async cancel(
    @Param('gameCode') gameCode: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.lottery.cancelCurrentBets(user.id, gameCode);
  }

  /** 当前期（公开；大厅/房间高频轮询，不计入全局限流） */
  @Public()
  @SkipThrottle()
  @Get(':gameCode/current')
  currentIssue(@Param('gameCode') gameCode: string) {
    return this.lottery.currentIssue(gameCode);
  }

  /**
   * 当前期 + 历史开奖合并（公开）。
   *
   * 游戏内每 2 秒要一次「快照」，原本前端拆成 current / history 两个请求打出去，
   * 一局下来就是双倍往返。两者本就同源同时效，合并成一枪。
   */
  @Public()
  @SkipThrottle()
  @Get(':gameCode/snapshot')
  snapshot(
    @Param('gameCode') gameCode: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.lottery.snapshot(gameCode, Math.min(limit, 80));
  }

  /** 历史开奖（公开；同上） */
  @Public()
  @SkipThrottle()
  @Get(':gameCode/history')
  history(
    @Param('gameCode') gameCode: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return this.lottery.history(gameCode, Math.min(limit, 80));
  }

  /** 活跃赔率表（公开，H5 展示唯一来源） */
  @Public()
  @SkipThrottle()
  @Get(':gameCode/pay-table')
  payTable(@Param('gameCode') gameCode: string) {
    return this.lottery.getPayTable(gameCode);
  }

  /** 我的投注记录（可按期号或 range/from/to 过滤） */
  @Get(':gameCode/my-bets')
  myBets(
    @Param('gameCode') gameCode: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query('issueNo') issueNo: string | undefined,
    @Query('range') range: string | undefined,
    @Query('from') fromStr: string | undefined,
    @Query('to') toStr: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.lottery.myBets(user.id, gameCode, page, pageSize, issueNo, {
      range,
      fromMs: fromStr != null && fromStr !== '' ? Number(fromStr) : undefined,
      toMs: toStr != null && toStr !== '' ? Number(toStr) : undefined,
    });
  }
}
