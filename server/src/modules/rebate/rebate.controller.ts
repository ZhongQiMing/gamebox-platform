import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';
import { RebateService } from './rebate.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

class ClaimDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

@Controller('rebate')
export class RebateController {
  constructor(private svc: RebateService) {}

  /** GET /api/rebate/status?range=today|yesterday|thisweek|lastweek|thismonth */
  @Get('status')
  status(
    @CurrentUser() u: { id: string },
    @Query('range') range?: string,
  ) {
    const r = (['today', 'yesterday', 'thisweek', 'lastweek', 'thismonth'] as const).includes(range as never)
      ? (range as 'today' | 'yesterday' | 'thisweek' | 'lastweek' | 'thismonth')
      : 'today';
    return this.svc.getStatus(u.id, r);
  }

  /** POST /api/rebate/claim — 领指定日；不传 date 则提前领光池内全部
   *  运营侧走 /console/players/:id/rebate/claim，这里只认玩家 */
  @Roles('PLAYER')
  @Post('claim')
  claim(@CurrentUser() u: { id: string }, @Body() dto: ClaimDto) {
    return this.svc.claim(u.id, dto.date);
  }
}
