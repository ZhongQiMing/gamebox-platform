import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@gamebox/shared';

/** 仅玩家可下注；运营/代理/客服/子账号可观摩，不可用真金下单 */
export function assertCanPlaceBet(role: string | undefined | null) {
  if (role === UserRole.PLAYER) return;
  throw new ForbiddenException('请使用玩家账号游玩');
}
