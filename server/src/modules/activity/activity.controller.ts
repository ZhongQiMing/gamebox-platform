import { Controller, Get, Post, Param } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('activities')
export class ActivityController {
  constructor(private activityService: ActivityService) {}

  /** GET /api/activities — 当前玩家可见活动列表 */
  @Get()
  list(@CurrentUser() u: { id: string }) {
    return this.activityService.listForPlayer(u.id);
  }

  /** POST /api/activities/:id/claim — 领取活动奖励（奖励进玩家账户，运营账号不该走这条） */
  @Roles('PLAYER')
  @Post(':id/claim')
  claim(@CurrentUser() u: { id: string }, @Param('id') id: string) {
    return this.activityService.claimActivity(u.id, id);
  }
}
