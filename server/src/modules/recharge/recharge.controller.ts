import { Controller, Post, Get, Patch, Body, Param, Query,
  ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { RechargeService } from './recharge.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IsInt, IsOptional, IsString, Matches, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 订单号必填。
 *
 * 原来是可选，不传就由服务端每次现生成——玩家连点两下就是两张单；
 * 下分还会各扣一份钱。它同时是幂等键，只能由客户端定，服务端补不了。
 */
const ORDER_NO = /^[A-Za-z0-9_-]{8,64}$/;

export class ApplyRechargeDto {
  @IsInt() @Min(200) @Max(200_000) @Type(() => Number) amount!: number;
  @IsOptional() @IsString() channel?: string;
  /** 运营房间 id 或 6 位房号二选一 */
  @IsOptional() @IsString() roomId?: string;
  @IsOptional() @IsString() @MaxLength(6) roomNo?: string;
  @IsString() @Matches(ORDER_NO, { message: '订单号格式无效' })
  clientRequestId!: string;
}
export class ApplyWithdrawDto {
  @IsInt() @Min(500) @Max(200_000) @Type(() => Number) amount!: number;
  @IsOptional() @IsString() channel?: string;
  @IsOptional() @IsString() roomId?: string;
  @IsOptional() @IsString() @MaxLength(6) roomNo?: string;
  @IsString() @Matches(ORDER_NO, { message: '订单号格式无效' })
  clientRequestId!: string;
}
export class RejectDto {
  @IsString() @MaxLength(200) reason!: string;
}

@Controller('recharge')
export class RechargeController {
  constructor(private svc: RechargeService) {}

  /** POST /api/recharge/apply — 申请上分 */
  @Roles('PLAYER')
  @Post('apply')
  apply(@CurrentUser() u: { id: string }, @Body() dto: ApplyRechargeDto) {
    return this.svc.applyRecharge(u.id, dto.amount, dto.channel, {
      roomId: dto.roomId,
      roomNo: dto.roomNo,
      clientRequestId: dto.clientRequestId,
    });
  }

  /** POST /api/recharge/withdraw — 申请下分 */
  @Roles('PLAYER')
  @Post('withdraw')
  withdraw(@CurrentUser() u: { id: string }, @Body() dto: ApplyWithdrawDto) {
    return this.svc.applyWithdraw(u.id, dto.amount, dto.channel, {
      roomId: dto.roomId,
      roomNo: dto.roomNo,
      clientRequestId: dto.clientRequestId,
    });
  }

  /** GET /api/recharge/my — 我的充提记录（range 或 from/to） */
  @Get('my')
  my(
    @CurrentUser() u: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize: number,
    @Query('range') range?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ) {
    const from = fromStr != null && fromStr !== '' ? Number(fromStr) : undefined;
    const to = toStr != null && toStr !== '' ? Number(toStr) : undefined;
    return this.svc.myOrders(u.id, page, Math.min(pageSize, 200), from, to, range);
  }

  /** GET /api/recharge/pending — 待审核列表（代理/客服）；可选 playerId 只看该玩家 */
  @Roles('AGENT', 'CS')
  @Get('pending')
  pending(
    @CurrentUser() u: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('playerId') playerId?: string,
  ) {
    return this.svc.pendingOrders(u.id, page, 50, playerId);
  }

  /** GET /api/recharge/history — 已审上下分（默认已通过；客服看自己审过的；子账号只读） */
  @Roles('AGENT', 'PROXY', 'CS')
  @Get('history')
  history(
    @CurrentUser() u: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('playerId') playerId?: string,
    @Query('range') range?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ) {
    const fromMs = fromStr != null && fromStr !== '' ? Number(fromStr) : undefined;
    const toMs = toStr != null && toStr !== '' ? Number(toStr) : undefined;
    return this.svc.reviewHistory(u.id, page, 50, {
      status,
      type,
      playerId,
      range,
      fromMs,
      toMs,
    });
  }

  /** PATCH /api/recharge/:id/approve — 审批通过（代理/客服） */
  @Roles('AGENT', 'CS')
  @Patch(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() u: { id: string }) {
    return this.svc.approveRecharge(id, u.id);
  }

  /** PATCH /api/recharge/:id/reject — 拒绝（代理/客服） */
  @Roles('AGENT', 'CS')
  @Patch(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() u: { id: string }, @Body() dto: RejectDto) {
    return this.svc.rejectOrder(id, u.id, dto.reason);
  }
}
