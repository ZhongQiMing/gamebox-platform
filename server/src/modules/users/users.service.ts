import {
  Injectable, ConflictException, NotFoundException,
  BadRequestException, ForbiddenException, Inject, forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { asMoney, roundMoney, validateAccount, validatePassword } from '@gamebox/shared';
import { RebateService } from '../rebate/rebate.service';
import { PointsService, PLATFORM_OWNER_ID } from '../points/points.service';
import { businessNo } from '../game-core/business-id';
import { NICKNAME_POOL } from './nickname-pool';
import { AVATAR_TOTAL, avatarPath } from './avatar-pool';
import { pickAvatarUniqueInTx } from './avatar-assign';
import { rethrowUserUniqueConflict } from '../../common/utils/user-unique';
import { PASSWORD_SALT_ROUNDS as SALT_ROUNDS } from '../../common/security.constants';
import { isRealImage } from '../../common/utils/image-magic';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => RebateService)) private rebate: RebateService,
    private points: PointsService,
  ) {}

  /** 生成 9 位唯一 UID（100000000–999999999） */
  private async genUid(): Promise<string> {
    for (let i = 0; i < 32; i++) {
      const uid = String(Math.floor(100000000 + Math.random() * 900000000));
      const exists = await this.prisma.user.findUnique({ where: { uid }, select: { id: true } });
      if (!exists) return uid;
    }
    throw new Error('UID 生成失败，请重试');
  }

  /** 生成推广码（6 位大写字母数字） */
  private async genPromoCode(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      const exists = await this.prisma.user.findUnique({ where: { promoCode: code } });
      if (!exists) return code;
    }
    throw new Error('推广码生成失败，请重试');
  }

  /** 从昵称池随机抽一个未被占用的名字（4～6 字） */
  private async pickNickname(): Promise<string> {
    const pool = NICKNAME_POOL;
    const n = pool.length;
    if (!n) throw new Error('昵称池为空');

    for (let attempt = 0; attempt < 64; attempt++) {
      const start = Math.floor(Math.random() * n);
      for (let step = 0; step < Math.min(48, n); step++) {
        const name = pool[(start + step) % n]!;
        const exists = await this.prisma.user.findUnique({
          where: { nickname: name },
          select: { id: true },
        });
        if (!exists) return name;
      }
    }

    /* 池将尽时兜底：池名 + 随机后缀，仍保证唯一 */
    for (let i = 0; i < 32; i++) {
      const base = pool[Math.floor(Math.random() * n)]!;
      const suffix = String(Math.floor(10 + Math.random() * 89));
      const name = (base.slice(0, 4) + suffix).slice(0, 6);
      const exists = await this.prisma.user.findUnique({
        where: { nickname: name },
        select: { id: true },
      });
      if (!exists) return name;
    }
    throw new Error('昵称生成失败，请重试');
  }

  /**
   * 头像按轮次不重复：本轮 162 张各用一次（顺序随机），用完进入下一轮。
   * 使用单例行 + FOR UPDATE 串行化并发注册。
   */
  async pickAvatarUnique(): Promise<string> {
    return this.prisma.$transaction((tx) => pickAvatarUniqueInTx(tx));
  }

  /** 兼容旧调用：随机一张（不占轮次）；新注册请用 pickAvatarUnique */
  pickAvatar(): string {
    const avatarIdx = 1 + Math.floor(Math.random() * AVATAR_TOTAL);
    return avatarPath(avatarIdx);
  }

  async create(dto: {
    username: string;
    password: string;
    nickname?: string;
    inviteCode?: string;
  }) {
    const username = dto.username.toLowerCase();

    const accErr = validateAccount(username);
    if (accErr) throw new ConflictException(accErr);
    const pwdErr = validatePassword(dto.password);
    if (pwdErr) throw new ConflictException(pwdErr);

    if (await this.prisma.user.findUnique({ where: { username } })) {
      throw new ConflictException('账号已存在');
    }

    const uid = await this.genUid();
    const nickname = await this.pickNickname();
    const avatar = await this.pickAvatarUnique();
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          username,
          passwordHash,
          uid,
          nickname,
          avatar,
          role: 'PLAYER',
          parentId: null,
          agentPath: '/',
          depth: 0,
        },
      });
      return this.toProfile(user);
    } catch (e: unknown) {
      rethrowUserUniqueConflict(e);
    }
  }

  async findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username: username.toLowerCase() } });
  }

  async findById(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('用户不存在');
    return u;
  }

  async getProfile(id: string) {
    const u = await this.findById(id);
    if (!u.avatar) {
      const avatar = await this.pickAvatarUnique();
      await this.prisma.user.update({ where: { id }, data: { avatar } });
      u.avatar = avatar;
    }
    const profile = this.toProfile(u);
    if (u.role !== 'PROXY' && u.role !== 'CS') {
      return { ...profile, parentId: null as string | null, parentRole: null as string | null };
    }
    const me = await this.prisma.user.findUnique({
      where: { id },
      select: { parentId: true, parent: { select: { role: true } } },
    });
    return {
      ...profile,
      parentId: me?.parentId ?? null,
      parentRole: me?.parent?.role ?? null,
    };
  }

  async updateNickname(id: string, nickname: string) {
    const name = String(nickname || '').trim().replace(/\s+/g, '');
    if (name.length < 2 || name.length > 8) {
      throw new ConflictException('昵称需为 2～8 个字');
    }
    if (!/^[\u4e00-\u9fa5a-zA-Z0-9·]+$/.test(name)) {
      throw new ConflictException('昵称仅支持中文、字母、数字');
    }
    const taken = await this.prisma.user.findFirst({
      where: { nickname: name, NOT: { id } },
      select: { id: true },
    });
    if (taken) throw new ConflictException('该昵称已被占用');
    const u = await this.prisma.user.update({ where: { id }, data: { nickname: name } });
    return this.toProfile(u);
  }

  async updateAvatar(id: string, dataUrl: string) {
    const m = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) throw new ConflictException('请上传 JPG / PNG / WEBP 图片');
    const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length < 1024) throw new ConflictException('图片太小');
    if (buf.length > 800 * 1024) throw new ConflictException('图片请小于 800KB');
    if (!isRealImage(buf)) throw new ConflictException('请上传 JPG / PNG / WEBP 图片');

    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = path.join(process.cwd(), 'uploads', 'avatars');
    await fs.mkdir(dir, { recursive: true });
    const file = `${id}.${ext === 'jpeg' ? 'jpg' : ext}`;
    const abs = path.join(dir, file);
    await fs.writeFile(abs, buf);
    const avatar = `/uploads/avatars/${file}?t=${Date.now()}`;
    const u = await this.prisma.user.update({ where: { id }, data: { avatar } });
    return this.toProfile(u);
  }

  async changePassword(id: string, oldPwd: string, newPwd: string) {
    const u = await this.findById(id);
    if (!(await bcrypt.compare(oldPwd, u.passwordHash))) {
      throw new ConflictException('当前密码不正确');
    }
    const pwdErr = validatePassword(newPwd);
    if (pwdErr) throw new ConflictException(pwdErr);
    if (oldPwd === newPwd) throw new ConflictException('新密码不能与当前密码相同');
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(newPwd, SALT_ROUNDS),
        tokenVersion: { increment: 1 },
      },
    });
    return { ok: true };
  }

  /**
   * 注销前置检查。
   *
   * 分两档：
   *   blockers —— 事情还没了结，放行会真的算错账（待审单、未开奖注单、冻结中的钱）
   *   warnings —— 玩家自己会亏，但只要他知情并确认就放行（余额清零、未领回水作废）
   *
   * 余额没做成 blocker 是有原因的：下分单笔最低 500，余额不足 500 的玩家
   * 既取不出钱也注销不了，会被永久卡住。
   */
  async closeAccountCheck(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, status: true },
    });
    if (!user) throw new NotFoundException('用户不存在');

    const blockers: Array<{ code: string; message: string }> = [];
    const warnings: Array<{ code: string; message: string }> = [];

    if (user.status === 'CLOSED') {
      return {
        closable: false,
        blockers: [{ code: 'CLOSED', message: '账号已注销' }],
        warnings,
        balance: 0,
        frozen: 0,
      };
    }
    if (user.role !== 'PLAYER') {
      return {
        closable: false,
        blockers: [{ code: 'ROLE', message: '代理与客服账号不能自助注销，请联系上级处理' }],
        warnings,
        balance: 0,
        frozen: 0,
      };
    }

    const accounts = await this.prisma.pointsAccount.findMany({
      where: { ownerType: 'PLAYER', ownerId: id },
      select: { balance: true, frozen: true },
    });
    const balance = accounts.reduce((s, a) => s + asMoney(a.balance), 0);
    const frozen = accounts.reduce((s, a) => s + asMoney(a.frozen), 0);
    if (balance > 0) {
      warnings.push({
        code: 'BALANCE',
        message: `账上还有 ${balance.toFixed(2)} 积分，注销后清零且无法找回`,
      });
    }
    /* 冻结＝有一笔下分正在审核，代理可能马上要打钱给他，不能这时候把号销了 */
    if (frozen > 0) {
      blockers.push({
        code: 'FROZEN',
        message: `有 ${frozen.toFixed(2)} 积分正在下分审核中，请等审核完成`,
      });
    }

    const pendingOrders = await this.prisma.rechargeOrder.count({
      where: { playerId: id, status: 'PENDING' },
    });
    if (pendingOrders > 0) {
      blockers.push({ code: 'ORDER', message: `有 ${pendingOrders} 笔上下分申请待审核` });
    }

    const pendingBets = await this.prisma.bet.count({
      where: { playerId: id, status: 'PENDING' },
    });
    if (pendingBets > 0) {
      blockers.push({ code: 'BET', message: `有 ${pendingBets} 笔注单还没开奖` });
    }

    const { claimableTotal } = await this.rebate.getClaimableBrief(id);
    if (claimableTotal > 0) {
      warnings.push({
        code: 'REBATE',
        message: `还有 ${claimableTotal.toFixed(2)} 回水未领取，注销后作废`,
      });
    }

    return { closable: blockers.length === 0, blockers, warnings, balance, frozen };
  }

  /**
   * 玩家自助注销。
   *
   * 不删行：注单、上下分单、佣金、回水对 User 都是 RESTRICT 外键，且这些是资金凭证。
   * 做法是置 CLOSED + 清个人信息 + 顶掉登录态；账号名保留占用，防止换个身份回来。
   */
  async closeAccount(id: string, password: string) {
    const u = await this.findById(id);
    if (u.role !== 'PLAYER') throw new ForbiddenException('代理与客服账号不能自助注销');
    if (u.status === 'CLOSED') throw new BadRequestException('账号已注销');
    if (!(await bcrypt.compare(String(password || ''), u.passwordHash))) {
      throw new ConflictException('密码不正确');
    }

    const check = await this.closeAccountCheck(id);
    if (!check.closable) {
      throw new BadRequestException(check.blockers.map((b) => b.message).join('；'));
    }

    /* 注销单号：玩家侧凭它查询，账本里也按它对得上 */
    const orderNo = businessNo('ZX');
    let forfeited = 0;

    await this.prisma.$transaction(async (tx) => {
      const accounts = await tx.pointsAccount.findMany({
        where: { ownerType: 'PLAYER', ownerId: id },
        select: { id: true, roomId: true, balance: true },
      });

      for (const acc of accounts) {
        const left = asMoney(acc.balance);
        if (left > 0) {
          /*
           * 残额转回平台池，不给代理——那笔积分是玩家花钱买的，
           * 白送给代理等于代理凭空多一笔。转平台等于把这部分发行量收回。
           * 必须走 transferInTx：两侧各记一条流水，
           * 否则「流水合计 == 余额」这条每日对账不变量当场就破。
           */
          await this.points.transferInTx(
            tx,
            {
              type: 'PLAYER',
              id,
              roomId: acc.roomId,
              idempotencyKey: `account_close:${acc.id}:OUT`,
            },
            { type: 'PLATFORM', id: PLATFORM_OWNER_ID, idempotencyKey: `account_close:${acc.id}:IN` },
            left,
            {
              bizType: 'ADJUST',
              refType: 'account_close',
              refId: orderNo,
              remark: `账号注销·余额清零｜订单号 ${orderNo}`,
            },
          );
          forfeited = roundMoney(forfeited + left);
          continue;
        }
        /* 零余额账户也留一条 0 元凭证，事后翻账能看出是玩家自己注销的 */
        await tx.pointsLedger.create({
          data: {
            accountId: acc.id,
            bizType: 'ADJUST',
            amount: 0,
            balanceAfter: acc.balance,
            refType: 'account_close',
            refId: orderNo,
            remark: `账号注销｜订单号 ${orderNo}`,
            idempotencyKey: `account_close:${acc.id}`,
          },
        });
      }

      await tx.user.update({
        where: { id },
        data: {
          status: 'CLOSED',
          /* 顶掉所有已发出的 JWT，正在用的那台设备下一次请求就掉线 */
          tokenVersion: { increment: 1 },
          /* 昵称有唯一约束，用 uid 拼出一个不会撞的占位名 */
          nickname: `已注销${u.uid}`,
          avatar: null,
          lastLoginIp: null,
          /* 推广码要放出来，否则这个码永远挂在一个用不了的账号上 */
          promoCode: null,
        },
      });
    });

    return { ok: true, orderNo, forfeited };
  }

  /** 只返回安全的字段（不含 passwordHash） */
  toProfile(u: {
    id: string; uid: string; username: string; nickname: string;
    avatar: string | null; role: string; status: string;
    promoCode: string | null; createdAt: Date;
  }) {
    return {
      id: u.id,
      uid: u.uid,
      username: u.username,
      nickname: u.nickname,
      avatar: u.avatar,
      role: u.role,
      status: u.status,
      promoCode: u.promoCode,
      createdAt: u.createdAt,
    };
  }
}
