import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import type { JwtPayload } from './jwt.strategy';
import { RiskDetectorService } from '../risk/risk-detector.service';
import { LoginLockService } from './login-lock.service';

const LOCKED_MSG = '账号已冻结，请联系房主或管理员解冻';
const TOO_MANY_MSG = '密码连续错误次数过多，账号已冻结，请联系房主或管理员解冻';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private riskDetector: RiskDetectorService,
    private loginLock: LoginLockService,
  ) {}

  async register(dto: { username: string; password: string; nickname?: string; inviteCode?: string }) {
    const profile = await this.users.create(dto);
    return { user: profile, token: this.sign(profile) };
  }

  async login(username: string, password: string, ip?: string | null) {
    const u = await this.users.findByUsername(username);
    if (!u) {
      const { blocked } = await this.loginLock.recordFailure({ username, ip });
      throw new UnauthorizedException(blocked ? TOO_MANY_MSG : '账号或密码错误');
    }
    if (u.status === 'CLOSED') throw new UnauthorizedException('账号已注销，无法登录');
    /* 白名单判断：以后再加状态，默认是不许登录，而不是默认放行 */
    if (u.status !== 'ACTIVE') throw new UnauthorizedException('账号已禁用');
    if (this.loginLock.isLocked(u.loginLockedAt)) {
      throw new UnauthorizedException(LOCKED_MSG);
    }

    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) {
      const { locked, blocked } = await this.loginLock.recordFailure({
        username: u.username,
        userId: u.id,
        ip,
      });
      throw new UnauthorizedException(locked || blocked ? TOO_MANY_MSG : '账号或密码错误');
    }

    await this.loginLock.clearFailCounters(u.username, ip);
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
