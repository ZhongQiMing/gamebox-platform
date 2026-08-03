import { Controller, Post, Get, Patch, Body, Param, Query,
  ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { RechargeService } from './recharge.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IsInt, IsOptional, IsString, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class ApplyRechargeDto {
  @IsInt() @Min(200) @Max(10_000_000) @Type(() => Number) amount!: number;
  @IsOptional() @IsString() channel?: string;
}
export class ApplyWithdrawDto {
  @IsInt() @Min(500) @Max(10_000_000) @Type(() => Number) amount!: number;
}
export class RejectDto {
  @IsString() @MaxLength(200) reason!: string;
}

@Controller('recharge')
export class RechargeController {
  constructor(private svc: RechargeService) {}

  /** POST /api/recharge/apply — 申请上分 */
  @Post('apply')
  apply(@CurrentUser() u: { id: string }, @Body() dto: ApplyRechargeDto) {
    return this.svc.applyRecharge(u.id, dto.amount, dto.channel);
  }

  /** POST /api/recharge/withdraw — 申请下分 */
  @Post('withdraw')
  withdraw(@CurrentUser() u: { id: string }, @Body() dto: ApplyWithdrawDto) {
    return this.svc.applyWithdraw(u.id, dto.amount);
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

  /** GET /api/recharge/pending — 待审核列表（代理/代分） */
  @Roles('AGENT', 'PROXY')
  @Get('pending')
  pending(
    @CurrentUser() u: { id: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    return this.svc.pendingOrders(u.id, page);
  }

  /** PATCH /api/recharge/:id/approve — 审批通过（代理/代分） */
  @Roles('AGENT', 'PROXY')
  @Patch(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() u: { id: string }) {
    return this.svc.approveRecharge(id, u.id);
  }

  /** PATCH /api/recharge/:id/reject — 拒绝（代理/代分） */
  @Roles('AGENT', 'PROXY')
  @Patch(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() u: { id: string }, @Body() dto: RejectDto) {
    return this.svc.rejectOrder(id, u.id, dto.reason);
  }
}
