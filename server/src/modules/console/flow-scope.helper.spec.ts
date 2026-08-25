import { flowViewFor, flowViewerSide, type FlowBuckets } from './flow-scope.helper';

/**
 * 同一间房、同一批注，三级账本各管各的。
 * 场景：飞上台 10000、飞到总代 3000、代理自己关盘 2000。
 */
const ROOM: FlowBuckets = {
  flown: 10_000,
  agentFly: 13_000,
  all: 15_000,
};

describe('三级账本拆账', () => {
  it('代理：接到全部 15000，飞出去 13000，自己坐庄 2000', () => {
    const v = flowViewFor('AGENT', ROOM);
    expect(v.total).toBe(15_000);
    expect(v.flying).toBe(13_000);
    expect(v.closed).toBe(2_000);
  });

  it('总代：只接代理飞上来的 13000，再飞出去 10000，自己坐庄 3000', () => {
    const v = flowViewFor('GENERAL', ROOM);
    expect(v.total).toBe(13_000);
    expect(v.flying).toBe(10_000);
    expect(v.closed).toBe(3_000);
  });

  it('代理自己关盘的那截不进总代的账', () => {
    const general = flowViewFor('GENERAL', ROOM);
    const agent = flowViewFor('AGENT', ROOM);
    expect(agent.total - general.total).toBe(agent.closed);
  });

  it('平台：只见飞上来的 10000，下级关盘不占管理端栏位', () => {
    const v = flowViewFor('PLATFORM', ROOM);
    expect(v.total).toBe(10_000);
    expect(v.flying).toBe(10_000);
    expect(v.closed).toBe(0);
  });

  it('贯穿链路：每一级飞出去的 = 上一级接到的', () => {
    const agent = flowViewFor('AGENT', ROOM);
    const general = flowViewFor('GENERAL', ROOM);
    const platform = flowViewFor('PLATFORM', ROOM);

    expect(agent.flying).toBe(general.total);
    expect(general.flying).toBe(platform.total);
  });

  it('每一级都满足：飞出去 + 自己坐庄 = 接到的', () => {
    for (const side of ['GENERAL', 'AGENT'] as const) {
      const v = flowViewFor(side, ROOM);
      expect(v.flying + v.closed).toBe(v.total);
    }
  });

  it('整房关盘：代理全自己扛，总代和平台都收不到单', () => {
    const closedRoom: FlowBuckets = { flown: 0, agentFly: 0, all: 8_000 };
    expect(flowViewFor('AGENT', closedRoom)).toEqual({
      total: 8_000,
      flying: 0,
      closed: 8_000,
    });
    expect(flowViewFor('GENERAL', closedRoom)).toEqual({ total: 0, flying: 0, closed: 0 });
    expect(flowViewFor('PLATFORM', closedRoom)).toEqual({ total: 0, flying: 0, closed: 0 });
  });

  it('全飞上台：三级接到的都是同一批，中间层不留单', () => {
    const allFly: FlowBuckets = { flown: 6_000, agentFly: 6_000, all: 6_000 };
    expect(flowViewFor('AGENT', allFly)).toEqual({ total: 6_000, flying: 6_000, closed: 0 });
    expect(flowViewFor('GENERAL', allFly)).toEqual({ total: 6_000, flying: 6_000, closed: 0 });
    expect(flowViewFor('PLATFORM', allFly)).toEqual({ total: 6_000, flying: 6_000, closed: 0 });
  });

  it('角色判定：房主侧优先于总代侧', () => {
    expect(flowViewerSide({ isPlatformSide: true, isGeneralSide: true })).toBe('PLATFORM');
    expect(flowViewerSide({ isPlatformSide: false, isGeneralSide: true })).toBe('GENERAL');
    expect(flowViewerSide({ isPlatformSide: false, isGeneralSide: false })).toBe('AGENT');
  });
});
