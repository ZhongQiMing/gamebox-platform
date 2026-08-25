import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CsService } from './cs.service';

class ReplyCsMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(800)
  text!: string;
}

class UploadPayQrDto {
  @IsIn(['wechat', 'alipay'])
  kind!: 'wechat' | 'alipay';

  /** data:image/png;base64,... 或 data:image/jpeg;base64,... */
  @IsString()
  @MinLength(32)
  @MaxLength(12_000_000)
  dataUrl!: string;
}

class UploadCsChatImageDto {
  @IsString()
  @MinLength(32)
  @MaxLength(3_000_000)
  dataUrl!: string;
}

class DeskQrItemDto {
  @IsOptional() @IsString() @MaxLength(64) id?: string;
  @IsString() @MinLength(1) @MaxLength(500) url!: string;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(80) note?: string;
}

class SaveDeskSettingsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  quickReplies?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeskQrItemDto)
  wechatQrs?: DeskQrItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeskQrItemDto)
  alipayQrs?: DeskQrItemDto[];
}

@Controller('console/cs')
/** 子账号仅查账，不可代聊玩家 */
@Roles('AGENT', 'CS')
export class CsConsoleController {
  constructor(private svc: CsService) {}

  /** GET /api/console/cs/sessions */
  @Get('sessions')
  sessions(@CurrentUser() u: { id: string }) {
    return this.svc.listSessions(u.id);
  }

  /**
   * GET /api/console/cs/history?roomNo=123456&player=xxx
   * 管理 / 总监按房间加玩家查完整对话，出纠纷时用；不做实时会话列表。
   */
  @Get('history')
  @Roles('ADMIN', 'BRANCH')
  history(
    @Query('roomNo') roomNo: string,
    @Query('player') player: string,
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number,
  ) {
    return this.svc.adminPlayerHistory(roomNo, player, limit);
  }

  /** GET /api/console/cs/sessions/:playerId/messages */
  @Get('sessions/:playerId/messages')
  messages(
    @CurrentUser() u: { id: string },
    @Param('playerId') playerId: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ) {
    return this.svc.sessionMessages(u.id, playerId, limit);
  }

  /** POST /api/console/cs/sessions/:playerId/messages */
  @Post('sessions/:playerId/messages')
  reply(
    @CurrentUser() u: { id: string },
    @Param('playerId') playerId: string,
    @Body() dto: ReplyCsMessageDto,
  ) {
    return this.svc.agentReply(u.id, playerId, dto.text);
  }

  /** POST /api/console/cs/sessions/:playerId/read */
  @Post('sessions/:playerId/read')
  read(@CurrentUser() u: { id: string }, @Param('playerId') playerId: string) {
    return this.svc.markRead(u.id, playerId);
  }

  /** GET /api/console/cs/desk-settings — 话术+收款码（多端同步） */
  @Get('desk-settings')
  getDeskSettings(@CurrentUser() u: { id: string }) {
    return this.svc.getDeskSettings(u.id);
  }

  /** PUT /api/console/cs/desk-settings */
  @Put('desk-settings')
  saveDeskSettings(
    @CurrentUser() u: { id: string },
    @Body() dto: SaveDeskSettingsDto,
  ) {
    return this.svc.saveDeskSettings(u.id, dto);
  }

  /**
   * POST /api/console/cs/pay-qr
   * 上传微信/支付宝收款码，返回可发给玩家的鉴权媒体地址
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('pay-qr')
  uploadPayQr(
    @CurrentUser() u: { id: string },
    @Body() dto: UploadPayQrDto,
  ) {
    return this.svc.saveUploadedImage(u.id, dto.dataUrl, dto.kind, 'STAFF_PAY_QR');
  }

  /** POST /api/console/cs/upload — 聊天本地图片 */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('upload')
  uploadChatImage(
    @CurrentUser() u: { id: string },
    @Body() dto: UploadCsChatImageDto,
  ) {
    return this.svc.saveUploadedImage(u.id, dto.dataUrl, 'chat', 'STAFF_CHAT');
  }
}
