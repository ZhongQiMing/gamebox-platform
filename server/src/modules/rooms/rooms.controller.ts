import { Controller, Get, Param, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { Body, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsString, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RoomsService } from './rooms.service';
import { RoomChatService } from './room-chat.service';

class EnterRoomDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: '请输入完整的 6 位房间号' })
  roomNo!: string;
}

@Controller('rooms')
export class RoomsController {
  constructor(
    private rooms: RoomsService,
    private roomChat: RoomChatService,
  ) {}

  /** GET /api/rooms/mine — 已通过的房间 */
  @Get('mine')
  mine(@CurrentUser() user: { id: string }) {
    return this.rooms.listMine(user.id);
  }

  /** POST /api/rooms/enter — 输入房间号进入 */
  @Post('enter')
  enter(@CurrentUser() user: { id: string }, @Body() dto: EnterRoomDto) {
    return this.rooms.enter(user.id, dto.roomNo);
  }

  /**
   * GET /api/rooms/:roomNo/games/:gameCode/chat
   * after 有值：增量；无 after：最近 limit 条（时间正序）
   * 房间内高频轮询，不计入全局限流
   */
  @SkipThrottle()
  @Get(':roomNo/games/:gameCode/chat')
  listChat(
    @CurrentUser() user: { id: string },
    @Param('roomNo') roomNo: string,
    @Param('gameCode') gameCode: string,
    @Query('after') after: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.roomChat.listForPlayer(user.id, roomNo, gameCode, {
      afterId: after || undefined,
      limit,
    });
  }
}
