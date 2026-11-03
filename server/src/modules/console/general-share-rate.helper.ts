import { BadRequestException } from '@nestjs/common';

/** 总代占成上限，与建号同一条 */
export const GENERAL_SHARE_MAX = 0.7;

export const GENERAL_SHARE_SCHEDULE_SELECT = {
  shareRate: true,
  shareRateSince: true,
  prevShareRate: true,
  pendingShareRate: true,
  pendingShareFrom: true,
} as const;

export type GeneralShareSchedule = {
  shareRate: number;
  shareRateSince: Date | null;
  prevShareRate: number | null;
  pendingShareRate: number | null;
  pendingShareFrom: Date | null;
};

export function scheduleFromAgent(row: {
  shareRate?: number | null;
  shareRateSince?: Date | null;
  prevShareRate?: number | null;
  pendingShareRate?: number | null;
  pendingShareFrom?: Date | null;
}): GeneralShareSchedule {
  return {
    shareRate: Number(row.shareRate ?? 0),
    shareRateSince: row.shareRateSince ?? null,
    prevShareRate: row.prevShareRate == null ? null : Number(row.prevShareRate),
    pendingShareRate: row.pendingShareRate == null ? null : Number(row.pendingShareRate),
    pendingShareFrom: row.pendingShareFrom ?? null,
  };
}

export function clampShare01(n: number): number {
  return Math.min(1, Math.max(0, Number(n) || 0));
}

/** 入参可以是 0.3 或 30；超范围直接拒 */
export function parseGeneralShareRate(raw: unknown, fallback?: number): number {
  let n = Number(raw);
  if (!Number.isFinite(n)) {
    if (fallback != null) return fallback;
    throw new BadRequestException('总代占成无效');
  }
  if (n > 1) n = n / 100;
  if (n < 0 || n > GENERAL_SHARE_MAX + 1e-9) {
    throw new BadRequestException('总代占成须在 0%～70%');
  }
  return n;
}

/**
 * 某一账期该用哪一档占成。
 * pending 从 pendingShareFrom（下期起点）起生效；更早的未结账期走 prev。
 */
export function effectiveGeneralShareRate(
  s: GeneralShareSchedule,
  periodStart: Date,
): number {
  const t = periodStart.getTime();
  if (
    s.pendingShareFrom
    && s.pendingShareRate != null
    && t >= s.pendingShareFrom.getTime()
  ) {
    return clampShare01(s.pendingShareRate);
  }
  if (s.shareRateSince && s.prevShareRate != null && t < s.shareRateSince.getTime()) {
    return clampShare01(s.prevShareRate);
  }
  return clampShare01(s.shareRate);
}

/** 还没到生效日的预约占成；已过期的不当作预约 */
export function futurePendingShareRate(
  s: GeneralShareSchedule,
  now = new Date(),
): number | null {
  if (
    s.pendingShareFrom
    && s.pendingShareRate != null
    && s.pendingShareFrom.getTime() > now.getTime()
  ) {
    return clampShare01(s.pendingShareRate);
  }
  return null;
}

/** 建房上限：本期与已预约下期取更严的一档，避免下期一到就超 */
export function roomAgentShareCap(s: GeneralShareSchedule, now = new Date()): number {
  const live = effectiveGeneralShareRate(s, now);
  const pending = futurePendingShareRate(s, now);
  return pending == null ? live : Math.min(live, pending);
}

/** 下期已经开始时，把预约写进当前档，并留下上一档给未结的上期 */
export function materializeShareSchedule(
  s: GeneralShareSchedule,
  currentPeriodStart: Date,
): GeneralShareSchedule {
  if (
    s.pendingShareFrom
    && s.pendingShareRate != null
    && currentPeriodStart.getTime() >= s.pendingShareFrom.getTime()
  ) {
    return {
      shareRate: clampShare01(s.pendingShareRate),
      shareRateSince: s.pendingShareFrom,
      prevShareRate: clampShare01(s.shareRate),
      pendingShareRate: null,
      pendingShareFrom: null,
    };
  }
  return s;
}

export function publicGeneralShareView(s: GeneralShareSchedule, now = new Date()) {
  return {
    shareRate: effectiveGeneralShareRate(s, now),
    pendingShareRate: futurePendingShareRate(s, now),
    pendingShareFrom: futurePendingShareRate(s, now) == null ? null : s.pendingShareFrom,
  };
}

export function sharePctLabel(rate: number): string {
  return `${Math.round(clampShare01(rate) * 100)}%`;
}

export const ROOM_AGENT_SHARE_SCHEDULE_SELECT = {
  agentShareRate: true,
  agentShareRateSince: true,
  prevAgentShareRate: true,
  pendingAgentShareRate: true,
  pendingAgentShareFrom: true,
} as const;

export function scheduleFromRoom(row: {
  agentShareRate?: number | null;
  agentShareRateSince?: Date | null;
  prevAgentShareRate?: number | null;
  pendingAgentShareRate?: number | null;
  pendingAgentShareFrom?: Date | null;
}): GeneralShareSchedule {
  return {
    shareRate: Number(row.agentShareRate ?? 0),
    shareRateSince: row.agentShareRateSince ?? null,
    prevShareRate: row.prevAgentShareRate == null ? null : Number(row.prevAgentShareRate),
    pendingShareRate: row.pendingAgentShareRate == null ? null : Number(row.pendingAgentShareRate),
    pendingShareFrom: row.pendingAgentShareFrom ?? null,
  };
}

export function publicRoomAgentShareView(row: Parameters<typeof scheduleFromRoom>[0], now = new Date()) {
  const view = publicGeneralShareView(scheduleFromRoom(row), now);
  return {
    agentShareRate: view.shareRate,
    pendingAgentShareRate: view.pendingShareRate,
    pendingAgentShareFrom: view.pendingShareFrom,
  };
}

export function roomSchedulePrismaData(s: GeneralShareSchedule) {
  return {
    agentShareRate: s.shareRate,
    agentShareRateSince: s.shareRateSince,
    prevAgentShareRate: s.prevShareRate,
    pendingAgentShareRate: s.pendingShareRate,
    pendingAgentShareFrom: s.pendingShareFrom,
  };
}

/** 校验总代占成时看房间「现在或已预约」里更高的那档 */
export function roomAgentShareCeiling(row: Parameters<typeof scheduleFromRoom>[0], now = new Date()): number {
  const s = scheduleFromRoom(row);
  const live = effectiveGeneralShareRate(s, now);
  const pending = futurePendingShareRate(s, now);
  return pending == null ? live : Math.max(live, pending);
}

/** 直挂房建房上限 50%；挂总代则跟总代档走 */
export const DIRECT_AGENT_SHARE_CAP = 0.5;

export function parseAgentShareRate(raw: unknown, cap: number): number {
  let n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new BadRequestException('代理占成无效');
  }
  if (n > 1) n = n / 100;
  const top = Math.min(GENERAL_SHARE_MAX, Math.max(0, cap));
  if (n < 0 || n > top + 1e-9) {
    throw new BadRequestException(`代理占成须在 0%～${Math.round(top * 100)}%`);
  }
  return n;
}

export function overflowShareRoomsMessage(
  rooms: { roomNo: string; name: string; agentShareRate: number }[],
): string {
  const detail = rooms
    .slice(0, 8)
    .map((r) => `${r.roomNo} ${sharePctLabel(r.agentShareRate)}`)
    .join('、');
  const extra = rooms.length > 8 ? ` 等 ${rooms.length} 间` : '';
  return `名下房间已超出占成，请查证后再修改（${detail}${extra}）`;
}
