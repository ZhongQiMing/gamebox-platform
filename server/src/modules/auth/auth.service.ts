import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import type { JwtPayload } from './jwt.strategy';
import { RiskDetectorService } from '../risk/risk-detector.service';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private riskDetector: RiskDetectorService,
  ) {}

  async register(dto: { username: string; password: string; nickname?: string; inviteCode?: string }) {
    const profile = await this.users.create(dto);
    return { user: profile, token: this.sign(profile) };
  }

  async login(username: string, password: string, ip?: string | null) {
    const u = await this.users.findByUsername(username);
    if (!u) throw new UnauthorizedException('账号或密码错误');
    if (u.status === 'DISABLED') throw new UnauthorizedException('账号已禁用');
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) throw new UnauthorizedException('账号或密码错误');

    // 登录态与风控检测异步，不阻塞签发 token
    void this.riskDetector.onPlayerLogin(u.id, ip ?? null);

    const profile = await this.users.getProfile(u.id);
    return {
      user: profile,
      token: this.sign({
        id: profile.id,
        uid: profile.uid,
        role: profile.role,
        tokenVersion: (u as { tokenVersion?: number }).tokenVersion ?? 0,
      }),
    };
  }

  private sign(user: { id: string; uid: string; role: string; tokenVersion?: number }): string {
    const payload: JwtPayload = {
      sub: user.id,
      uid: user.uid,
      role: user.role,
      tv: user.tokenVersion ?? 0,
    };
    return this.jwt.sign(payload);
  }
}
