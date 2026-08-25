/**
 * 平台向总代收的房间月费。
 *
 * 规则：总代每开一间房，每月按平台给他定的单价缴一笔，预收——
 * 建房当刻起算，下一次总代结账就收第一笔，之后每满一个月收一笔。
 *
 * 与「总代向代理收的房间月费」（Room.monthlyFee）是两条腿：
 * 那笔是总代自己定价、自己收，多收的差价归他，平台不管。
 *
 * 但两条腿有个硬约束：**代理那笔不能低于平台这笔**（见 assertRoomFeeAboveFloor）。
 * 平台按单价 × 房间数向总代收，不看代理实际交多少；一旦房间月费低于单价，
 * 总代就是每月倒贴差额，而且账面上完全看不出来——他要到结账才发现被扣了。
 */
import { roundMoney } from '@gamebox/shared';

/**
 * 挂总代的房，月费只能高于或等于平台给该总代定的单价。
 *
 * 传 null / 0 表示没挂总代或平台不收，此时不设下限。
 * 返回下限值，方便调用方拿去做默认值。
 */
export function roomFeeFloor(generalRoomMonthlyFee: number | null | undefined): number {
  const unit = Math.max(0, Math.floor(Number(generalRoomMonthlyFee) || 0));
  return Number.isFinite(unit) ? unit : 0;
}

export type RoomFeeInput = {
  roomId: string;
  roomNo: string;
  name: string;
  /** 平台向总代收本房月费的下一个到期时间；null=不走总代这条腿 */
  platformFeeDueAt: Date | null;
};

export type RoomFeeLine = {
  roomId: string;
  roomNo: string;
  name: string;
  /** 本期该收几个月（补收欠账时会 >1） */
  months: number;
  unitFee: number;
  amount: number;
  /** 结清后该写回房间的下一个到期时间 */
  nextDueAt: Date;
};

export type RoomFeeBill = {
  unitFee: number;
  lines: RoomFeeLine[];
  /** 本期月费合计，总代应付平台 */
  total: number;
  roomCount: number;
  monthCount: number;
};

/** 按自然月推进，保留时分秒；月末日按目标月份夹到最后一天 */
export function addOneMonth(from: Date): Date {
  const d = new Date(from.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/**
 * 到 asOf 为止该收几个月，以及收完后的下一个到期时间。
 *
 * 到期时间的锚点是建房那一刻，所以 1 月 1 日建的房，之后每期的到期日都是 1 号：
 * 1 月 31 日结账时 2 月 1 日还没到，这期不收；2 月 1 日之后的那次结账才收第二笔。
 *
 * 隔了几个月没结就一次补收几笔，不能把欠的抹掉。上限兜一下，
 * 免得脏数据（到期时间被写到很久以前）算出天文数字。
 */
export function dueMonthsUntil(
  dueAt: Date | null | undefined,
  asOf: Date,
): { months: number; nextDueAt: Date | null } {
  if (!dueAt) return { months: 0, nextDueAt: null };
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(due.getTime())) return { months: 0, nextDueAt: null };

  let cursor = new Date(due.getTime());
  let months = 0;
  while (cursor.getTime() <= asOf.getTime() && months < 120) {
    months += 1;
    cursor = addOneMonth(cursor);
  }
  return { months, nextDueAt: cursor };
}

/**
 * 算出一个账期内该向总代收的房间月费。
 *
 * @param unitFee 平台给这个总代定的单价；<=0 时不收
 * @param periodEnd 账期结束时间：到期时间早于它的都算进本期
 */
export function buildRoomFeeBill(
  unitFee: number,
  rooms: RoomFeeInput[],
  periodEnd: Date,
): RoomFeeBill {
  const unit = roundMoney(Math.max(0, Number(unitFee) || 0));
  const empty: RoomFeeBill = {
    unitFee: unit,
    lines: [],
    total: 0,
    roomCount: 0,
    monthCount: 0,
  };
  if (unit <= 0) return empty;

  const lines: RoomFeeLine[] = [];
  for (const room of rooms) {
    const { months, nextDueAt } = dueMonthsUntil(room.platformFeeDueAt, periodEnd);
    if (months <= 0 || !nextDueAt) continue;
    lines.push({
      roomId: room.roomId,
      roomNo: room.roomNo,
      name: room.name,
      months,
      unitFee: unit,
      amount: roundMoney(unit * months),
      nextDueAt,
    });
  }

  return {
    unitFee: unit,
    lines,
    total: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
    roomCount: lines.length,
    monthCount: lines.reduce((s, l) => s + l.months, 0),
  };
}
