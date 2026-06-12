import { Controller, Get, Post, Param } from '@nestjs/common';
import { GamesService } from './games.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('games')
export class GamesController {
  constructor(private svc: GamesService) {}

  /** GET /api/games — 上架游戏列表（公开，供大厅展示） */
  @Public()
  @Get()
  list() {
    return this.svc.listOnline();
  }

  /** GET /api/games/:code — 单个游戏详情 */
  @Get(':code')
  detail(@Param('code') code: string) {
    return this.svc.getGame(code);
  }

  /** POST /api/games/seed — 初始化默认游戏数据（管理员） */
  @Roles('ADMIN')
  @Post('seed')
  seed() {
    return this.svc.seed();
  }
}
