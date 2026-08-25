/**
 * 资金单订单号校验。
 *
 * 订单号既是展示单号也是幂等键锚点，放行一个坏号等于放行一次重复转账，
 * 所以宽松（可注入/超长）和过严（正常号被拒）两边都要看住。
 */
import {
  assertFundOrderNo,
  closedDiskHouseUserId,
  withOrderRemark,
} from './player-fund.helper';

describe('assertFundOrderNo', () => {
  it('接受前端生成的正常订单号', () => {
    expect(assertFundOrderNo('FD20260808A1B2C3')).toBe('FD20260808A1B2C3');
    expect(assertFundOrderNo('a_b-c_1234')).toBe('a_b-c_1234');
  });

  it('去首尾空白后再校验', () => {
    expect(assertFundOrderNo('  FD20260808A1B2  ')).toBe('FD20260808A1B2');
  });

  it('缺号 / 太短一律拒绝', () => {
    expect(() => assertFundOrderNo(undefined)).toThrow('请提供订单号');
    expect(() => assertFundOrderNo('')).toThrow('请提供订单号');
    expect(() => assertFundOrderNo('FD1234')).toThrow('请提供订单号');
  });

  it('非白名单字符一律拒绝', () => {
    for (const bad of ['FD 2026 0808', 'FD2026:0808', "FD'--DROP", 'FD2026/0808', '订单号12345678']) {
      expect(() => assertFundOrderNo(bad)).toThrow('订单号格式无效');
    }
  });

  it('超长先截到 64 位再校验，不会因为多贴了一段就报错', () => {
    const long = 'A'.repeat(200);
    expect(assertFundOrderNo(long)).toBe('A'.repeat(64));
  });

  it('截断后残留非法字符仍然拒绝', () => {
    expect(() => assertFundOrderNo(`${'A'.repeat(60)}!!!!${'B'.repeat(60)}`)).toThrow(
      '订单号格式无效',
    );
  });
});

describe('withOrderRemark', () => {
  it('订单号始终在前，便于流水里直接搜', () => {
    expect(withOrderRemark('FD20260808A1', '玩家上分')).toBe('订单号 FD20260808A1｜玩家上分');
  });

  it('备注为空时用兜底文案', () => {
    expect(withOrderRemark('FD20260808A1', '', '划额度给客服')).toBe(
      '订单号 FD20260808A1｜划额度给客服',
    );
    expect(withOrderRemark('FD20260808A1', '   ', '划额度给客服')).toBe(
      '订单号 FD20260808A1｜划额度给客服',
    );
  });

  it('备注和兜底都没有时只留订单号', () => {
    expect(withOrderRemark('FD20260808A1')).toBe('订单号 FD20260808A1');
  });
});

/**
 * 关盘坐庄方一旦认错人，输赢就结到别人盘分上，而且两本账各自自洽、
 * 日常对账查不出来（对账只验「余额 vs 自己那本流水」）。这里钉死取值来源。
 */
describe('closedDiskHouseUserId', () => {
  it('代理关盘：坐庄方就是房间代理', () => {
    expect(
      closedDiskHouseUserId({ id: 'agent-1', agentUserId: 'agent-1' }),
    ).toBe('agent-1');
  });

  it('总代关盘：坐庄方是总代，不能取成房间代理', () => {
    expect(
      closedDiskHouseUserId({ id: 'general-9', agentUserId: 'agent-1' }),
    ).toBe('general-9');
  });

  it('缺坐庄方时退回房间代理，不返回空串把扣款打到空账户', () => {
    expect(closedDiskHouseUserId({ agentUserId: 'agent-1' })).toBe('agent-1');
    expect(closedDiskHouseUserId({ id: '', agentUserId: 'agent-1' })).toBe('agent-1');
  });

  it('两者都缺时返回空串，由下游 closedDisk* 抛错拦截', () => {
    expect(closedDiskHouseUserId(null)).toBe('');
    expect(closedDiskHouseUserId(undefined)).toBe('');
    expect(closedDiskHouseUserId({})).toBe('');
  });
});
