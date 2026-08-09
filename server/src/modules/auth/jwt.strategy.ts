import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_COOKIE, readCookie } from './auth-cookie';

export interface JwtPayload {
  sub: string;   // user.id
  uid: string;
  role: string;
  /** 与 User.tokenVersion 对齐，改密/停用后旧票失效 */
  tv?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(cfg: ConfigService, private prisma: PrismaService) {
    super({
      /*
       * 两种取票方式并存：
       *   Authorization: Bearer —— App（页面来源跨站，Cookie 带不过来）
       *   HttpOnly Cookie      —— 管理后台（同域网页，JS 读不到票，XSS 偷不走）
       * 顺序不能反：App 的 WebView 也可能存下 Cookie，Bearer 优先才不会串。
       */
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => readCookie(req, AUTH_COOKIE),
      ]),
      ignoreExpiration: false,
      secretOrKey: cfg.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        uid: true,
        role: true,
        status: true,
        tokenVersion: true,
        loginLockedAt: true,
      },
    });
    /* 白名单：非 ACTIVE 一律拒绝，新增状态不会因为漏改这里而变成可用 */
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        user?.status === 'CLOSED' ? '账号已注销' : '账号已禁用或不存在',
      );
    }
    if (user.loginLockedAt) {
      throw new UnauthorizedException('账号已冻结，请联系房主或管理员解冻');
    }
    const tv = payload.tv ?? 0;
    if (tv !== user.tokenVersion) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    return { id: user.id, uid: user.uid, role: user.role, status: user.status };
  }
}
