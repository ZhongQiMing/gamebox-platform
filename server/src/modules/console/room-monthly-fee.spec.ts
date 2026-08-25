import { roomMonthlyFeeDue } from './room-settle.service';

const FEE = 1200;

/**
 * 月费的锚点是建房那一刻，收费一律发生在结账时，现金盘信用盘同一套：
 * 第一次结账先收一笔，之后每满一个自然月才收下一笔。
 */
describe('房间月费按建房日锚点计费', () => {
  it('刚建好的房：第一次结账就收第一笔', () => {
    const createdAt = new Date('2026-01-01T14:00:00+08:00');
    const due = roomMonthlyFeeDue(FEE, createdAt, new Date('2026-01-05T00:00:00+08:00'));
    expect(due.months).toBe(1);
    expect(due.amount).toBe(1200);
  });

  it('建房当天就结账也照收：到期时间就是建房那一刻', () => {
    const createdAt = new Date('2026-01-01T14:00:00+08:00');
    const due = roomMonthlyFeeDue(FEE, createdAt, new Date('2026-01-01T14:30:00+08:00'));
    expect(due.months).toBe(1);
  });

  it('1 月 1 日建的房：1 月最后一天结账不再收，下次到期是 2 月 1 日', () => {
    const createdAt = new Date('2026-01-01T14:00:00+08:00');
    const first = roomMonthlyFeeDue(FEE, createdAt, new Date('2026-01-05T00:00:00+08:00'));
    expect(first.nextDueAt?.getTime()).toBe(new Date('2026-02-01T14:00:00+08:00').getTime());

    const monthEnd = roomMonthlyFeeDue(FEE, first.nextDueAt, new Date('2026-01-31T23:59:00+08:00'));
    expect(monthEnd.months).toBe(0);
    expect(monthEnd.amount).toBe(0);
  });

  it('过掉 2 月 1 日之后的那次结账才收第二笔', () => {
    const secondDue = new Date('2026-02-01T14:00:00+08:00');
    const due = roomMonthlyFeeDue(FEE, secondDue, new Date('2026-02-02T00:00:00+08:00'));
    expect(due.months).toBe(1);
    expect(due.amount).toBe(1200);
    expect(due.nextDueAt?.getTime()).toBe(new Date('2026-03-01T14:00:00+08:00').getTime());
  });

  it('隔了三个月没结账：一次补齐三笔，不把欠的抹掉', () => {
    const createdAt = new Date('2026-01-01T14:00:00+08:00');
    const due = roomMonthlyFeeDue(FEE, createdAt, new Date('2026-03-15T00:00:00+08:00'));
    expect(due.months).toBe(3);
    expect(due.amount).toBe(3600);
  });

  it('月费为 0 的房不收，也不排到期时间', () => {
    const due = roomMonthlyFeeDue(0, new Date('2026-01-01T14:00:00+08:00'), new Date());
    expect(due.months).toBe(0);
    expect(due.amount).toBe(0);
    expect(due.nextDueAt).toBeNull();
  });

  it('没排到期时间的房不收', () => {
    const due = roomMonthlyFeeDue(FEE, null, new Date());
    expect(due.months).toBe(0);
    expect(due.amount).toBe(0);
  });

  it('31 号建的房推进到只有 30 天的月份时夹到月末', () => {
    const createdAt = new Date('2026-01-31T09:00:00+08:00');
    const first = roomMonthlyFeeDue(FEE, createdAt, new Date('2026-02-01T00:00:00+08:00'));
    expect(first.months).toBe(1);
    expect(first.nextDueAt?.getMonth()).toBe(1);
  });
});
