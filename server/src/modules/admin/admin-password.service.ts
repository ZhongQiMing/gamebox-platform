import {
  BadRequestException, ForbiddenException, Injectable,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 敏感操作的二次验密。
 *
 * 光有 JWT 不够：token 会躺在浏览器 localStorage 里，一次 XSS 或一台没锁屏的电脑
 * 就够别人以管理员身份操作。改开奖倾向、删房、往账本里补记差额这类动作，
 * 要求当场再输一次密码，把「拿到 token」和「知道密码」拆成两件事。
 *
 * 只有 ADMIN 能过：代理和客服没有这个口令，他们的高危动作靠订单号 + 操作日志约束。
 */
@Injectable()
export class AdminPasswordService {
  constructor(private prisma: PrismaService) {}

  async verify(actor: { id: string; role: string }, password: string | undefined) {
    const pwd = String(password || '');
    if (!pwd) throw new BadRequestException('请输入管理员密码');
    const u = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { id: true, role: true, passwordHash: true },
    });
    if (!u || u.role !== 'ADMIN' || !u.passwordHash) {
      throw new ForbiddenException('无权操作');
    }
    if (!(await bcrypt.compare(pwd, u.passwordHash))) {
      throw new BadRequestException('管理员密码错误');
    }
    return { ok: true };
  }
}
