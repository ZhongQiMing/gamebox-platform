import {
  actorCanListClosedRooms,
  allowClosedInRoomList,
  hasOpenRoomSome,
  keepClosedRoomInPeriodList,
} from './open-room.where';

describe('关房经营名单口径', () => {
  it('只有管理/总监能要已关闭房间', () => {
    expect(actorCanListClosedRooms('ADMIN')).toBe(true);
    expect(actorCanListClosedRooms('BRANCH')).toBe(true);
    expect(actorCanListClosedRooms('GENERAL')).toBe(false);
    expect(actorCanListClosedRooms('AGENT')).toBe(false);
    expect(actorCanListClosedRooms('PROXY')).toBe(false);
  });

  it('总代就算传 includeClosed 也不给已关闭', () => {
    expect(allowClosedInRoomList('GENERAL', true)).toBe(false);
    expect(allowClosedInRoomList('ADMIN', true)).toBe(true);
    expect(allowClosedInRoomList('ADMIN', false)).toBe(false);
    expect(allowClosedInRoomList('BRANCH', true)).toBe(true);
  });

  it('账号树绑房条件必须带未关状态，避免关房代理变成未绑定', () => {
    expect(hasOpenRoomSome(['r1']).rooms.some).toEqual({
      id: { in: ['r1'] },
      status: { not: 'CLOSED' },
    });
    expect(hasOpenRoomSome().rooms.some).toEqual({ status: { not: 'CLOSED' } });
  });

  it('已关且本期没动静的房从名单拿掉', () => {
    expect(keepClosedRoomInPeriodList({ status: 'CLOSED' })).toBe(false);
    expect(keepClosedRoomInPeriodList({ status: 'OPEN' })).toBe(true);
    expect(keepClosedRoomInPeriodList({ status: 'CLOSED', betFlow: 100 })).toBe(true);
    expect(keepClosedRoomInPeriodList({ status: 'CLOSED', housePnl: -20 })).toBe(true);
    expect(keepClosedRoomInPeriodList({ status: 'CLOSED', upCount: 1 })).toBe(true);
  });
});
