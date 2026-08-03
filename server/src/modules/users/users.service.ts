import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { validateAccount, validatePassword } from '@gamebox/shared';
import { NICKNAME_POOL } from './nickname-pool';
import { AVATAR_TOTAL, avatarPath } from './avatar-pool';

const SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

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
  private async pickAvatarUnique(): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "AvatarAssignState" ("id", "round", "usedJson", "updatedAt")
        VALUES (1, 1, '[]', CURRENT_TIMESTAMP)
        ON CONFLICT ("id") DO NOTHING`;

      const rows = await tx.$queryRaw<Array<{ round: number; usedJson: string }>>`
        SELECT "round", "usedJson" FROM "AvatarAssignState" WHERE "id" = 1 FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new Error('头像分配状态缺失');

      let round = row.round;
      let used: number[] = [];
      try {
        const parsed = JSON.parse(row.usedJson || '[]');
        if (Array.isArray(parsed)) {
          used = parsed.map(Number).filter((n) => n >= 1 && n <= AVATAR_TOTAL);
        }
      } catch {
        used = [];
      }

      if (used.length >= AVATAR_TOTAL) {
        round += 1;
        used = [];
      }

      const usedSet = new Set(used);
      const available: number[] = [];
      for (let i = 1; i <= AVATAR_TOTAL; i++) {
        if (!usedSet.has(i)) available.push(i);
      }
      const pick = available[Math.floor(Math.random() * available.length)]!;
      used.push(pick);

      await tx.avatarAssignState.update({
        where: { id: 1 },
        data: { round, usedJson: JSON.stringify(used) },
      });

      return avatarPath(pick);
    });
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
      const code = (e as { code?: string })?.code;
      if (code === 'P2002') {
        throw new ConflictException('账号或身份信息冲突，请重试');
      }
      throw e;
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
    return this.toProfile(u);
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
