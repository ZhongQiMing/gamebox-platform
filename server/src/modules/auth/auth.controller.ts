import { Controller, Post, Body, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { clearAuthCookies, setAuthCookies } from './auth-cookie';
import { Public } from '../../common/decorators/public.decorator';
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN } from '@gamebox/shared';
import { extractClientIp } from '../../common/utils/client-ip';

/* 账号/密码的真实格式由 shared 的 validateAccount/validatePassword 兜底给中文提示，
   这里只做超长拦截，避免超大 body 打到数据库与 bcrypt */
export class RegisterDto {
  @IsString() @MaxLength(64) username!: string;
  @IsString() @MinLength(PASSWORD_MIN_LEN) @MaxLength(PASSWORD_MAX_LEN) password!: string;
  @IsOptional() @IsString() @MaxLength(32) nickname?: string;
  @IsOptional() @IsString() @MaxLength(32) inviteCode?: string;
}

export class LoginDto {
  @IsString() @MaxLength(64) username!: string;
  @IsString() @MaxLength(128) password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private cfg: ConfigService) {}

  private get isProd() {
    return (this.cfg.get<string>('NODE_ENV') ?? 'development') === 'production';
  }

  private get expiresIn() {
    return this.cfg.get<string>('JWT_EXPIRES_IN') ?? '1d';
  }

  /**
   * 同一份登录结果给两种客户端用：
   *   App —— 拿响应体里的 token，之后走 Authorization 头
   *   管理后台 —— 用下面这两个 Cookie，忽略响应体里的 token
   * 一律下发 Cookie 是为了少一个「这次要不要下发」的判断分支；App 存了也不会用。
   */
  private withCookies<T extends { token: string }>(res: Response, out: T) {
    const csrf = setAuthCookies(res, out.token, {
      isProd: this.isProd,
      expiresIn: this.expiresIn,
    });
    return { ...out, csrfToken: csrf };
  }

  /** POST /api/auth/register */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.withCookies(res, await this.auth.register(dto));
  }

  /**
   * POST /api/auth/login
   *
   * 10 次/分：配合「同账号 10 次锁号」，把撞库成本压到脚本不划算的量级。
   * 正常人一分钟输不了 10 次密码，真忘了密码找客服重置比继续试更快。
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.auth.login(dto.username, dto.password, extractClientIp(req));
    return this.withCookies(res, out);
  }

  /**
   * POST /api/auth/logout
   *
   * 只清 Cookie。用 Bearer 的 App 端本地删掉 token 即可，不需要调这个。
   * 想让所有设备立刻掉线要改密码（会 bump tokenVersion）。
   */
  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    clearAuthCookies(res, { isProd: this.isProd });
    return { ok: true };
  }
}
