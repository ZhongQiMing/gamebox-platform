import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

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
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, uid: true, role: true, status: true, tokenVersion: true },
    });
    if (!user || user.status === 'DISABLED') throw new UnauthorizedException('账号已禁用或不存在');
    const tv = payload.tv ?? 0;
    if (tv !== user.tokenVersion) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
    return { id: user.id, uid: user.uid, role: user.role, status: user.status };
  }
}
