import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import type { JwtPayload } from './jwt.strategy';
import { RiskDetectorService } from '../risk/risk-detector.service';
import { LoginLockService } from './login-lock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DUMMY_PASSWORD_HASH } from '../../common/security.constants';

const LOCKED_MSG = '账号已冻结，请联系房主或管理员解冻';
const TOO_MANY_MSG = '尝试次数过多，请 15 分钟后再试';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private riskDetector: RiskDetectorService,
    private loginLock: LoginLockService,
    private prisma: PrismaService,
  ) {}

  async register(dto: { username: string; password: string; nickname?: string; inviteCode?: string }) {
    const profile = await this.users.create(dto);
    return { user: profile, token: this.sign(profile) };
  }

  async login(username: string, password: string, ip?: string | null) {
    const u = await this.users.findByUsername(username);

    /*
     * 账号不存在、被冻结或停用时也保持一次同成本 bcrypt。
     * 状态只在密码正确后返回，避免响应耗时和状态文案暴露有效用户名。
     */
    const ok = await bcrypt.compare(
      password,
      u?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!u || !ok) {
      const { blocked } = await this.loginLock.recordFailure({
        username: u?.username ?? username,
        ip,
      });
      if (blocked) {
        throw new HttpException(TOO_MANY_MSG, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw new UnauthorizedException('账号或密码错误');
    }

    if (u.status === 'CLOSED') {
      throw new UnauthorizedException('账号已注销，无法登录');
    }
    /* 白名单判断：以后再加状态，默认是不许登录，而不是默认放行 */
    if (u.status !== 'ACTIVE') throw new UnauthorizedException('账号已禁用');
    if (this.loginLock.isLocked(u.loginLockedAt)) {
      throw new UnauthorizedException(LOCKED_MSG);
    }

    /*
     * 客服被锁号就直接挡在登录这一步，而不是放进来再禁止接单。
     * 放进来会让他以为「只是没单」，实际是已经被罚下，
     * 必须让他当场看到「已锁定」才会去找代理报备。
     */
    if (u.role === 'CS') {
      const cs = await this.prisma.csStaff.findUnique({
        where: { userId: u.id },
        select: { slaLockedAt: true, slaLockReason: true },
      });
      if (cs?.slaLockedAt) {
        throw new UnauthorizedException(
          `账号已锁定：${cs.slaLockReason || '漏接玩家消息'}。请联系代理解锁`,
        );
      }
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
