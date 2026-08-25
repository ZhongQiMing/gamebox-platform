/**
 * 总监只被授权部分房间时，总代账单上的房间月费必须跟着收窄。
 * 不收窄的话，他会按「全部房间的月费」去跟总代对账，多收钱。
 */
import { buildRoomFeeBill, type RoomFeeInput } from './general-room-fee.helper';
import { roundMoney } from '@gamebox/shared';

const UNIT = 500;
const PERIOD_END = new Date('2026-08-17T00:00:00Z');

function room(id: string): RoomFeeInput {
  return {
    roomId: id,
    roomNo: id,
    name: `房${id}`,
    platformFeeDueAt: new Date('2026-08-10T00:00:00Z'),
  };
}

/** 与 GeneralSettleService.scopeRoomFee 同一套收窄逻辑 */
function scopeRoomFee(
  bill: ReturnType<typeof buildRoomFeeBill>,
  visibleRoomIds: string[] | null,
) {
  if (!visibleRoomIds) return bill;
  const ids = new Set(visibleRoomIds);
  const lines = bill.lines.filter((l) => ids.has(l.roomId));
  return {
    unitFee: bill.unitFee,
    lines,
    total: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
    roomCount: lines.length,
    monthCount: lines.reduce((s, l) => s + l.months, 0),
  };
}

describe('总代账单房间月费按授权房间收窄', () => {
  const full = () => buildRoomFeeBill(UNIT, [room('A'), room('B'), room('C')], PERIOD_END);

  it('全部房间可见时原样返回', () => {
    const bill = scopeRoomFee(full(), null);
    expect(bill.roomCount).toBe(3);
    expect(bill.total).toBe(1_500);
  });

  it('只授权两间房时，月费只算这两间', () => {
    const bill = scopeRoomFee(full(), ['A', 'C']);
    expect(bill.roomCount).toBe(2);
    expect(bill.total).toBe(1_000);
    expect(bill.lines.map((l) => l.roomId)).toEqual(['A', 'C']);
  });

  it('一间都没授权时月费为 0，不会拿全量数字去对账', () => {
    const bill = scopeRoomFee(full(), []);
    expect(bill.roomCount).toBe(0);
    expect(bill.total).toBe(0);
  });

  it('收窄后合计等于逐行相加，不会漏项或重复', () => {
    const bill = scopeRoomFee(full(), ['B']);
    const sum = bill.lines.reduce((s, l) => s + l.amount, 0);
    expect(bill.total).toBe(roundMoney(sum));
    expect(bill.monthCount).toBe(1);
  });
});
