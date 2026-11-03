import {
  effectiveGeneralShareRate,
  futurePendingShareRate,
  materializeShareSchedule,
  overflowShareRoomsMessage,
  parseAgentShareRate,
  parseGeneralShareRate,
  roomAgentShareCap,
  roomAgentShareCeiling,
  type GeneralShareSchedule,
} from './general-share-rate.helper';

const mon1 = new Date('2026-09-07T00:00:00.000Z');
const mon2 = new Date('2026-09-14T00:00:00.000Z');
const mon3 = new Date('2026-09-21T00:00:00.000Z');
const wed = new Date('2026-09-09T12:00:00.000Z');

function base(over: Partial<GeneralShareSchedule> = {}): GeneralShareSchedule {
  return {
    shareRate: 0.5,
    shareRateSince: null,
    prevShareRate: null,
    pendingShareRate: null,
    pendingShareFrom: null,
    ...over,
  };
}

describe('parseGeneralShareRate', () => {
  it('小数和百分数都能进，超过 70% 拒绝', () => {
    expect(parseGeneralShareRate(0.3)).toBe(0.3);
    expect(parseGeneralShareRate(30)).toBe(0.3);
    expect(() => parseGeneralShareRate(80)).toThrow('总代占成须在 0%～70%');
  });
});

describe('effectiveGeneralShareRate 下期再生效', () => {
  const scheduled = base({
    shareRate: 0.5,
    pendingShareRate: 0.3,
    pendingShareFrom: mon2,
  });

  it('本期仍用旧档', () => {
    expect(effectiveGeneralShareRate(scheduled, mon1)).toBe(0.5);
    expect(effectiveGeneralShareRate(scheduled, wed)).toBe(0.5);
  });

  it('下期起点起用新档', () => {
    expect(effectiveGeneralShareRate(scheduled, mon2)).toBe(0.3);
    expect(effectiveGeneralShareRate(scheduled, mon3)).toBe(0.3);
  });

  it('落档之后，未结上期还能读到上一档', () => {
    const live = base({
      shareRate: 0.3,
      shareRateSince: mon2,
      prevShareRate: 0.5,
    });
    expect(effectiveGeneralShareRate(live, mon1)).toBe(0.5);
    expect(effectiveGeneralShareRate(live, mon2)).toBe(0.3);
  });
});

describe('建房上限与预约', () => {
  it('预约调低：建房按更严的下期卡', () => {
    const s = base({ pendingShareRate: 0.3, pendingShareFrom: mon2 });
    expect(roomAgentShareCap(s, wed)).toBe(0.3);
    expect(futurePendingShareRate(s, wed)).toBe(0.3);
  });

  it('预约调高：本期建房仍按当前档', () => {
    const s = base({ pendingShareRate: 0.6, pendingShareFrom: mon2 });
    expect(roomAgentShareCap(s, wed)).toBe(0.5);
  });

  it('生效日已过就不算预约', () => {
    const s = base({ pendingShareRate: 0.3, pendingShareFrom: mon1 });
    expect(futurePendingShareRate(s, wed)).toBeNull();
    expect(effectiveGeneralShareRate(s, wed)).toBe(0.3);
  });
});

describe('materializeShareSchedule', () => {
  it('下期已开始才落档，并留下上一档', () => {
    const next = materializeShareSchedule(
      base({ pendingShareRate: 0.3, pendingShareFrom: mon2 }),
      mon2,
    );
    expect(next.shareRate).toBe(0.3);
    expect(next.prevShareRate).toBe(0.5);
    expect(next.shareRateSince).toEqual(mon2);
    expect(next.pendingShareRate).toBeNull();
  });

  it('还在本期不落档', () => {
    const same = materializeShareSchedule(
      base({ pendingShareRate: 0.3, pendingShareFrom: mon2 }),
      mon1,
    );
    expect(same.shareRate).toBe(0.5);
    expect(same.pendingShareRate).toBe(0.3);
  });
});

describe('parseAgentShareRate', () => {
  it('不能超过总代档，百分数也能进', () => {
    expect(parseAgentShareRate(30, 0.5)).toBe(0.3);
    expect(() => parseAgentShareRate(0.4, 0.3)).toThrow('代理占成须在 0%～30%');
  });
});

describe('roomAgentShareCeiling', () => {
  it('已预约调高时按更高档拦总代下调', () => {
    expect(roomAgentShareCeiling({
      agentShareRate: 0.2,
      pendingAgentShareRate: 0.4,
      pendingAgentShareFrom: mon2,
    }, wed)).toBe(0.4);
  });
});

describe('overflowShareRoomsMessage', () => {
  it('带上房间号和占成，方便去查', () => {
    const msg = overflowShareRoomsMessage([
      { roomNo: '1001', name: '一号', agentShareRate: 0.4 },
    ]);
    expect(msg).toContain('名下房间已超出占成，请查证后再修改');
    expect(msg).toContain('1001 40%');
  });
});
