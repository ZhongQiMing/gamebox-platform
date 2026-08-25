import { roomPurgeBlockReasons } from './room-purge.helper';

const empty = {
  rounds: 0,
  settles: 0,
  fundOrders: 0,
  leftoverBooks: 0,
  rebates: 0,
};

describe('房间真删除门槛', () => {
  it('空房可以真删', () => {
    expect(roomPurgeBlockReasons(empty)).toEqual([]);
  });

  it('有过注单或账本就不能真删', () => {
    expect(roomPurgeBlockReasons({ ...empty, rounds: 2 }).join('')).toContain('注单');
    expect(roomPurgeBlockReasons({ ...empty, leftoverBooks: 1 }).join('')).toContain('账本');
    expect(roomPurgeBlockReasons({ ...empty, fundOrders: 3 }).join('')).toContain('上下分');
  });
});
