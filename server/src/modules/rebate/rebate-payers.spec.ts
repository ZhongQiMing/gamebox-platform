import { splitRebateClaimPayers } from './rebate-payers';

const platformId = 'plat';
const house = {
  flying: false,
  agentUserId: 'agent-1',
  generalUserId: 'general-1',
};

function bet(flow: number, fly: Record<string, unknown>) {
  return { validFlow: flow, payload: { fly } };
}

describe('玩家回水领取谁出', () => {
  it('飞盘由平台出', () => {
    expect(splitRebateClaimPayers({
      bets: [bet(3800, { flying: true, sitting: 'PLATFORM', P: 0.005 })],
      totalAmount: 19,
      platformId,
      house: { ...house, flying: true },
    })).toEqual([{ type: 'PLATFORM', id: platformId, amount: 19, label: 'fly' }]);
  });

  it('关盘已预扣的领取不再扣盘分', () => {
    expect(splitRebateClaimPayers({
      bets: [bet(3800, {
        flying: false,
        sitting: 'GENERAL',
        P: 0.005,
        playerHeld: true,
        generalUserId: 'general-1',
        agentUserId: 'agent-1',
      })],
      totalAmount: 19,
      platformId,
      house,
    })).toEqual([{ type: 'PLATFORM', id: platformId, amount: 19, label: 'held' }]);
  });

  it('总代关盘由总代出，不扣代理', () => {
    expect(splitRebateClaimPayers({
      bets: [bet(3800, {
        flying: false,
        sitting: 'GENERAL',
        P: 0.005,
        generalUserId: 'general-1',
        agentUserId: 'agent-1',
      })],
      totalAmount: 19,
      platformId,
      house,
    })).toEqual([{ type: 'AGENT', id: 'general-1', amount: 19, label: 'general' }]);
  });

  it('代理关盘由代理出', () => {
    expect(splitRebateClaimPayers({
      bets: [bet(3800, { flying: false, sitting: 'AGENT', P: 0.005, agentUserId: 'agent-1' })],
      totalAmount: 19,
      platformId,
      house,
    })).toEqual([{ type: 'AGENT', id: 'agent-1', amount: 19, label: 'agent' }]);
  });

  it('同一天飞、关混在一起时分开出', () => {
    const parts = splitRebateClaimPayers({
      bets: [
        bet(2000, { flying: true, sitting: 'PLATFORM', P: 0.005 }),
        bet(2000, {
          flying: false,
          sitting: 'GENERAL',
          P: 0.005,
          generalUserId: 'general-1',
        }),
      ],
      totalAmount: 20,
      platformId,
      house,
    });
    expect(parts).toEqual([
      { type: 'PLATFORM', id: platformId, amount: 10, label: 'fly' },
      { type: 'AGENT', id: 'general-1', amount: 10, label: 'general' },
    ]);
  });

  it('老关盘注单没有 sitting 时仍由代理出', () => {
    expect(splitRebateClaimPayers({
      bets: [bet(1000, { flying: false, P: 0.005 })],
      totalAmount: 5,
      platformId,
      house,
    })).toEqual([{ type: 'AGENT', id: 'agent-1', amount: 5, label: 'agent' }]);
  });
});
