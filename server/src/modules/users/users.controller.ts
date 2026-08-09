import { Controller, Get, Patch, Post, Body } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IsIn, IsString, MinLength, MaxLength } from 'class-validator';

export class ChangePwdDto {
  @IsString() @MaxLength(128) oldPassword!: string;
  @IsString() @MinLength(6) @MaxLength(30) newPassword!: string;
}

export class UpdateNicknameDto {
  @IsString() @MinLength(2) @MaxLength(8) nickname!: string;
}

export class UpdateAvatarDto {
  /** data:image/jpeg|png|webp;base64,...（800KB 图片 base64 后约 1.1MB） */
  @IsString() @MinLength(32) @MaxLength(1_400_000) image!: string;
}

export class CloseAccountDto {
  @IsString() @MaxLength(128) password!: string;
  /** 必须原样回填，避免误点或旧客户端把「退出登录」调成注销 */
  @IsIn(['注销账号']) confirmText!: string;
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

  /** GET /api/users/me/close-check — 注销前能不能注销、还差什么 */
  @Get('me/close-check')
  closeCheck(@CurrentUser() user: { id: string }) {
    return this.users.closeAccountCheck(user.id);
  }

  /** POST /api/users/me/close — 注销账号（不可恢复） */
  @Post('me/close')
  closeAccount(@CurrentUser() user: { id: string }, @Body() dto: CloseAccountDto) {
    return this.users.closeAccount(user.id, dto.password);
  }
}
