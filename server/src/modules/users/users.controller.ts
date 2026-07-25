import { Controller, Get, Patch, Body } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class ChangePwdDto {
  @IsString() oldPassword!: string;
  @IsString() @MinLength(6) @MaxLength(30) newPassword!: string;
}

export class UpdateNicknameDto {
  @IsString() @MinLength(2) @MaxLength(8) nickname!: string;
}

export class UpdateAvatarDto {
  /** data:image/jpeg|png|webp;base64,... */
  @IsString() @MinLength(32) image!: string;
}

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  /** GET /api/users/me — 当前用户资料 */
  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    return this.users.getProfile(user.id);
  }

  /** PATCH /api/users/me/password — 修改密码 */
  @Patch('me/password')
  changePassword(@CurrentUser() user: { id: string }, @Body() dto: ChangePwdDto) {
    return this.users.changePassword(user.id, dto.oldPassword, dto.newPassword);
  }

  /** PATCH /api/users/me/nickname — 修改昵称 */
  @Patch('me/nickname')
  updateNickname(@CurrentUser() user: { id: string }, @Body() dto: UpdateNicknameDto) {
    return this.users.updateNickname(user.id, dto.nickname);
  }

  /** PATCH /api/users/me/avatar — 上传自定义头像 */
  @Patch('me/avatar')
  updateAvatar(@CurrentUser() user: { id: string }, @Body() dto: UpdateAvatarDto) {
    return this.users.updateAvatar(user.id, dto.image);
  }
}
