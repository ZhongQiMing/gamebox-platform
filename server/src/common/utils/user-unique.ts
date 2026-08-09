import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** 用户名已被占用时统一抛出（前端展示「账号已存在」） */
export function throwUsernameTaken(): never {
  throw new ConflictException('账号已存在');
}

/**
 * Prisma 唯一键冲突：username →「账号已存在」；其它（如 uid）→ 通用冲突提示。
 */
export function rethrowUserUniqueConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    const target = e.meta?.target;
    const fields = Array.isArray(target)
      ? target.map(String)
      : [String(target ?? '')];
    if (fields.some((f) => f.toLowerCase().includes('username'))) {
      throwUsernameTaken();
    }
    throw new ConflictException('账号或身份信息冲突，请重试');
  }
  throw e;
}
