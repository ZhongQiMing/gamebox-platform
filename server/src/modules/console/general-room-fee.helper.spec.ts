import {
  addOneMonth,
  buildRoomFeeBill,
  roomFeeFloor,
  type RoomFeeInput,
} from './general-room-fee.helper';

const UNIT = 500;

function room(roomId: string, dueAt: string | null): RoomFeeInput {
  return {
    roomId,
    roomNo: roomId,
    name: `房${roomId}`,
    platformFeeDueAt: dueAt ? new Date(dueAt) : null,
  };
}

describe('平台向总代收的房间月费', () => {
  it('刚建的房：下一次结账就收第一笔（预收）', () => {
    const bill = buildRoomFeeBill(UNIT, [room('A', '2026-08-12T10:00:00Z')], new Date('2026-08-17T00:00:00Z'));
    expect(bill.lines).toHaveLength(1);
    expect(bill.lines[0].months).toBe(1);
    expect(bill.total).toBe(500);
  });

  it('同一个月内再结一次账不重复收：到期时间已推到下个月', () => {
    const due = new Date('2026-08-12T10:00:00Z');
    const first = buildRoomFeeBill(UNIT, [room('A', due.toISOString())], new Date('2026-08-17T00:00:00Z'));
    const next = first.lines[0].nextDueAt;
    const second = buildRoomFeeBill(UNIT, [{ ...room('A', null), platformFeeDueAt: next }], new Date('2026-08-24T00:00:00Z'));
    expect(second.lines).toHaveLength(0);
    expect(second.total).toBe(0);
  });

  it('隔了三个月没结：一次补收三笔，不会把欠的抹掉', () => {
    const bill = buildRoomFeeBill(UNIT, [room('A', '2026-05-10T00:00:00Z')], new Date('2026-08-17T00:00:00Z'));
    expect(bill.lines[0].months).toBe(4);
    expect(bill.total).toBe(2_000);
  });

  it('开几间房就收几间的钱，每间单独列出来', () => {
    const bill = buildRoomFeeBill(UNIT, [
      room('A', '2026-08-01T00:00:00Z'),
      room('B', '2026-08-05T00:00:00Z'),
      room('C', '2026-08-09T00:00:00Z'),
    ], new Date('2026-08-17T00:00:00Z'));
    expect(bill.roomCount).toBe(3);
    expect(bill.total).toBe(1_500);
    expect(bill.lines.map((l) => l.roomId)).toEqual(['A', 'B', 'C']);
  });

  it('直挂房（没有到期时间）不进总代账单', () => {
    const bill = buildRoomFeeBill(UNIT, [room('A', null)], new Date('2026-08-17T00:00:00Z'));
    expect(bill.lines).toHaveLength(0);
  });

  it('单价为 0 时整块不收', () => {
    const bill = buildRoomFeeBill(0, [room('A', '2026-08-01T00:00:00Z')], new Date('2026-08-17T00:00:00Z'));
    expect(bill.total).toBe(0);
    expect(bill.lines).toHaveLength(0);
  });

  it('到期时间还没到的房这期不收', () => {
    const bill = buildRoomFeeBill(UNIT, [room('A', '2026-09-20T00:00:00Z')], new Date('2026-08-17T00:00:00Z'));
    expect(bill.lines).toHaveLength(0);
  });

  it('脏数据（到期时间在很久以前）被上限兜住，不会算出天文数字', () => {
    const bill = buildRoomFeeBill(UNIT, [room('A', '1990-01-01T00:00:00Z')], new Date('2026-08-17T00:00:00Z'));
    expect(bill.lines[0].months).toBe(120);
  });
});

describe('按自然月推进到期时间', () => {
  it('保留几号与时分秒', () => {
    const d = addOneMonth(new Date(2026, 7, 12, 10, 30, 0));
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(12);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(30);
  });

  it('31 号推进到只有 30 天的月份时夹到月末，不会溢出到下下个月', () => {
    const d = addOneMonth(new Date(2026, 7, 31));
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(30);
  });

  it('1 月 31 日推进到 2 月按月末算', () => {
    const d = addOneMonth(new Date(2026, 0, 31));
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(28);
  });

  it('跨年正常', () => {
    const d = addOneMonth(new Date(2026, 11, 15));
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0);
  });
});

/*
 * 房间月费的下限 = 平台向总代收的单价。
 * 低于它总代每月按差额倒贴，而且要到结账才看得出来，所以必须在入口拦住。
 */
describe('房间月费下限', () => {
  it('挂总代：下限就是平台单价', () => {
    expect(roomFeeFloor(500)).toBe(500);
  });

  it('直挂房（没有总代）：不设下限', () => {
    expect(roomFeeFloor(null)).toBe(0);
    expect(roomFeeFloor(undefined)).toBe(0);
  });

  it('平台不向总代收时也不设下限', () => {
    expect(roomFeeFloor(0)).toBe(0);
  });

  it('负数与脏数据一律当没下限，不能算出负的门槛', () => {
    expect(roomFeeFloor(-500)).toBe(0);
    expect(roomFeeFloor(Number.NaN)).toBe(0);
    expect(roomFeeFloor('abc' as unknown as number)).toBe(0);
  });

  it('带小数的单价向下取整，避免下限比实际收的还高一分钱', () => {
    expect(roomFeeFloor(500.9)).toBe(500);
  });
});
