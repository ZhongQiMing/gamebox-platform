import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import type { JwtPayload } from './jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
  ) {}

  async register(dto: { username: string; password: string; nickname?: string; inviteCode?: string }) {
    const profile = await this.users.create(dto);
    return { user: profile, token: this.sign(profile) };
  }

  async login(username: string, password: string) {
    const u = await this.users.findByUsername(username);
    if (!u) throw new UnauthorizedException('账号或密码错误');
    if (u.status === 'DISABLED') throw new UnauthorizedException('账号已禁用');
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) throw new UnauthorizedException('账号或密码错误');

    // 更新登录时间（不 await，非关键路径）
    this.users['prisma'].user.update({
      where: { id: u.id },
      data: { lastLoginAt: new Date() },
    }).catch(() => {});

    const profile = await this.users.getProfile(u.id);
    return { user: profile, token: this.sign(profile) };
  }

  private sign(user: { id: string; uid: string; role: string }): string {
    const payload: JwtPayload = { sub: user.id, uid: user.uid, role: user.role };
    return this.jwt.sign(payload);
  }
}
