import { roleEarning, type RoomEarningInput } from './share-split.helper';

/**
 * 一间挂总代的房，成数：代理 50%、总代 70%。
 * 三种坐庄各赢 1000：飞上台 1000、总代坐庄 1000、代理关盘 1000。
 */
const ROOM: RoomEarningInput = {
  flownHousePnl: 1000,
  generalSatHousePnl: 1000,
  agentSatHousePnl: 1000,
  agentShareRate: 0.5,
  generalShareRate: 0.7,
};

describe('三方今日净赚', () => {
  it('平台：只吃飞上台那 1000，分给代理 500、总代 200，自己剩 300', () => {
    const e = roleEarning('PLATFORM', [ROOM]);
    expect(e.satHousePnl).toBe(1000);
    expect(e.myShareAmount).toBe(300);
    expect(e.netEarning).toBe(300);
  });

  it('总代：飞上台拿成数差 200，自己坐庄 1000 扣掉代理 500 留 500，合计 700', () => {
    const e = roleEarning('GENERAL', [ROOM]);
    expect(e.satHousePnl).toBe(1000);
    expect(e.myShareAmount).toBe(700);
    expect(e.netEarning).toBe(700);
  });

  it('代理：飞出去两截各拿 50% 共 1000，自己关盘 1000 全归自己，合计 2000', () => {
    const e = roleEarning('AGENT', [ROOM]);
    expect(e.satHousePnl).toBe(1000);
    expect(e.myShareAmount).toBe(1000);
    expect(e.netEarning).toBe(2000);
  });

  it('代理的挂靠佣金要从净赚里扣，平台和总代不受影响', () => {
    expect(roleEarning('AGENT', [ROOM], 300).netEarning).toBe(1700);
    expect(roleEarning('GENERAL', [ROOM], 300).netEarning).toBe(700);
    expect(roleEarning('PLATFORM', [ROOM], 300).netEarning).toBe(300);
  });

  it('这一局三方净赚加起来 = 三种坐庄的输赢总和', () => {
    const total =
      roleEarning('PLATFORM', [ROOM]).netEarning +
      roleEarning('GENERAL', [ROOM]).netEarning +
      roleEarning('AGENT', [ROOM]).netEarning;
    expect(total).toBe(ROOM.flownHousePnl + ROOM.generalSatHousePnl + ROOM.agentSatHousePnl);
  });

  it('代理自己关盘的钱不进总代和平台的账', () => {
    const noSat: RoomEarningInput = { ...ROOM, agentSatHousePnl: 0 };
    expect(roleEarning('GENERAL', [ROOM]).netEarning).toBe(
      roleEarning('GENERAL', [noSat]).netEarning,
    );
    expect(roleEarning('PLATFORM', [ROOM]).netEarning).toBe(
      roleEarning('PLATFORM', [noSat]).netEarning,
    );
  });

  it('直挂房（无总代）：平台与代理对半，总代那份为 0', () => {
    const direct: RoomEarningInput = {
      flownHousePnl: 1000,
      generalSatHousePnl: 0,
      agentSatHousePnl: 0,
      agentShareRate: 0.5,
      generalShareRate: null,
    };
    expect(roleEarning('PLATFORM', [direct]).netEarning).toBe(500);
    expect(roleEarning('AGENT', [direct]).netEarning).toBe(500);
    expect(roleEarning('GENERAL', [direct]).netEarning).toBe(0);
  });

  it('输钱时三方一起亏，符号跟着走', () => {
    const lose: RoomEarningInput = { ...ROOM, flownHousePnl: -1000, generalSatHousePnl: 0, agentSatHousePnl: 0 };
    expect(roleEarning('PLATFORM', [lose]).netEarning).toBe(-300);
    expect(roleEarning('GENERAL', [lose]).netEarning).toBe(-200);
    expect(roleEarning('AGENT', [lose]).netEarning).toBe(-500);
  });

  it('多间房累加', () => {
    const e = roleEarning('AGENT', [ROOM, ROOM]);
    expect(e.netEarning).toBe(4000);
  });

  it('没有房间时全是 0', () => {
    for (const side of ['PLATFORM', 'GENERAL', 'AGENT'] as const) {
      expect(roleEarning(side, []).netEarning).toBe(0);
    }
  });
});
