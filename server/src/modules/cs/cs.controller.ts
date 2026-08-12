import { Body, Controller, Get, Post, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CsService } from './cs.service';

class SendCsMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;

  /**
   * 普通聊天为兼容旧客户端暂允许省略；上分/下分口令必须提供。
   * 一旦提供，同一玩家下永久作为该请求的持久化幂等键。
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  clientRequestId?: string;
}

class UploadCsImageDto {
  /** data:image/png;base64,... */
  @IsString()
  @MinLength(32)
  @MaxLength(3_000_000)
  dataUrl!: string;
}

@Controller('cs')
@Roles('PLAYER')
export class CsController {
  constructor(private svc: CsService) {}

  /** GET /api/cs/messages — 玩家自己的会话 */
  @Get('messages')
  messages(
    @CurrentUser() u: { id: string },
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    return this.svc.playerMessages(u.id, limit);
  }

  /** POST /api/cs/messages — 发送；上分/下分自动建单 */
  @Post('messages')
  send(@CurrentUser() u: { id: string }, @Body() dto: SendCsMessageDto) {
    return this.svc.playerSend(u.id, dto.text, dto.clientRequestId);
  }

  /** POST /api/cs/upload — 聊天图片，返回鉴权媒体 URL 后用 [img]url 发消息 */
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('upload')
  upload(@CurrentUser() u: { id: string }, @Body() dto: UploadCsImageDto) {
    return this.svc.saveUploadedImage(u.id, dto.dataUrl, 'chat', 'PLAYER_CHAT');
  }
}
