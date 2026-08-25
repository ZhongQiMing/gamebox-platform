import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';
import { RebateService } from './rebate.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { isTimeRangeKey } from '../../common/shanghai-range';

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
    /* range 的合法值只在 shanghai-range 里定义一次，别在各控制器重抄一份 */
    return this.svc.getStatus(u.id, isTimeRangeKey(range) ? range : 'today');
  }

  /**
   * GET /api/rebate/rate?gameCode=ssc — 当前生效的玩家回水比例（小数，0.018=1.8%）
   * 游戏内展示用：后台改了比例，游戏里显示的点数要跟着变。
   */
  @Get('rate')
  rate(
    @CurrentUser() u: { id: string },
    @Query('gameCode') gameCode?: string,
  ) {
    return this.svc.playerRateForGame(u.id, gameCode);
  }

  /** POST /api/rebate/claim — 领指定日；不传 date 则提前领光池内全部
   *  运营侧走 /console/players/:id/rebate/claim，这里只认玩家 */
  @Roles('PLAYER')
  @Post('claim')
  claim(@CurrentUser() u: { id: string }, @Body() dto: ClaimDto) {
    return this.svc.claim(u.id, dto.date);
  }
}
