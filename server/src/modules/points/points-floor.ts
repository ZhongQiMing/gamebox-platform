/**
 * 各类账户的余额下限。
 *
 * 单独一个文件是因为 PointsService（写账）与 PlatformBalanceMergerService（补余额、
 * 判红线）都要用，放在任一方都会让另一方产生反向依赖。
 */
import type { OwnerType } from './points.types';

/**
 * 平台账户余额下限。
 * 平台侧允许为负（代表已下发到生态的积分总量），但不能无底线——
 * 一旦跌破说明赔率配置或风控出了问题，此时全站进维护，
 * 比闷声亏到底更容易被发现。可用 PLATFORM_BALANCE_FLOOR 覆盖。
 */
const DEFAULT_PLATFORM_FLOOR = -100_000_000;
/** 代理欠账下限（飞盘关闭后玩家继续赢） */
const DEFAULT_AGENT_FLOOR = -100_000_000;
/** 历史 ROOM 分桶下限（已废弃，结算走平台池；保留兼容旧账户） */
const DEFAULT_ROOM_FLOOR = -100_000_000;

export function platformFloor(): number {
  const raw = Number(process.env.PLATFORM_BALANCE_FLOOR);
  return Number.isFinite(raw) ? raw : DEFAULT_PLATFORM_FLOOR;
}

export function ownerFloor(ownerType: OwnerType): number | null {
  if (ownerType === 'PLATFORM') return platformFloor();
  if (ownerType === 'AGENT') {
    const raw = Number(process.env.AGENT_BALANCE_FLOOR);
    return Number.isFinite(raw) ? raw : DEFAULT_AGENT_FLOOR;
  }
  if (ownerType === 'ROOM') {
    const raw = Number(process.env.ROOM_BALANCE_FLOOR);
    return Number.isFinite(raw) ? raw : DEFAULT_ROOM_FLOOR;
  }
  return 0;
}
