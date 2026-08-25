import { rebateFallbackForCategory } from '@gamebox/shared';
import { overlayDownlineRebate, hydrateGameRebate } from './rebate-policy-games';
import { resolveGamePackages, resolvePayoutRates } from './rebate-chain';

const lottery = rebateFallbackForCategory('LOTTERY');
const slot = rebateFallbackForCategory('SLOT');

describe('resolveGamePackages', () => {
  it('uses admin default for the general package', () => {
    const pkg = resolveGamePackages({ game: lottery, hasGeneral: true });
    expect(pkg.generalPkg).toBe(0.07);
    expect(pkg.agentPkg).toBe(0.05);
    expect(pkg.playerDefault).toBe(0.018);
  });

  it('does not let a leftover self-bump change the general package', () => {
    const pkg = resolveGamePackages({
      game: { ...lottery, agentDefault: 0.04, agentMax: 0.04 },
      hasGeneral: true,
    });
    expect(pkg.generalPkg).toBe(0.07);
    expect(pkg.agentPkg).toBe(0.04);
    expect(pkg.playerMax).toBe(0.03);
  });

  it('uses a lower package for slots and arcade', () => {
    const pkg = resolveGamePackages({ game: slot, hasGeneral: true });
    expect(pkg.generalPkg).toBe(0.025);
    expect(pkg.agentPkg).toBe(0.015);
    expect(pkg.playerDefault).toBe(0.005);
  });
});

describe('resolvePayoutRates', () => {
  const roomBand = {
    agentPkg: 0.05,
    generalPkg: 0,
    playerMin: 0.01,
    playerMax: 0.03,
  };
  const fruit = resolveGamePackages({ game: slot, hasGeneral: false });

  it('彩票用房间默认 1.8%，代理整包 5%', () => {
    const rates = resolvePayoutRates({
      roomBand,
      gamePkg: resolveGamePackages({ game: lottery, hasGeneral: false }),
      agentDefaultRate: 0.018,
    });
    expect(rates.P).toBe(0.018);
    expect(rates.agentPkg).toBe(0.05);
    expect(rates.A).toBe(0.032);
  });

  it('水果机按回水规则默认：代理整包 1.5%，玩家 0.5%，不套彩票 1.8%', () => {
    const rates = resolvePayoutRates({
      roomBand,
      gamePkg: fruit,
      agentDefaultRate: 0.018,
      memberRate: 0.018,
    });
    expect(rates.P).toBe(0.005);
    expect(rates.agentPkg).toBe(0.015);
    expect(rates.A).toBe(0.01);
  });

  it('水果机单游戏覆盖仍按街机框，不能写成彩票点', () => {
    const rates = resolvePayoutRates({
      roomBand,
      gamePkg: fruit,
      roomGameRate: 0.008,
      agentDefaultRate: 0.018,
    });
    expect(rates.P).toBe(0.008);
  });
});

describe('overlayDownlineRebate', () => {
  it('keeps the admin general layer even if the general writes agent/player boxes', () => {
    const admin = hydrateGameRebate({}, lottery);
    const merged = overlayDownlineRebate(admin, {
      agentMin: 0.017,
      agentDefault: 0.04,
      agentMax: 0.04,
      playerMin: 0.01,
      playerDefault: 0.015,
      playerMax: 0.02,
      generalDefault: 0.1,
    });
    expect(merged.generalDefault).toBe(0.07);
    expect(merged.generalMin).toBe(0.07);
    expect(merged.generalMax).toBe(0.1);
    expect(merged.agentDefault).toBe(0.04);
    expect(merged.playerDefault).toBe(0.015);
  });

  it('lets the agent overlay only the player layer', () => {
    const admin = hydrateGameRebate({}, lottery);
    const merged = overlayDownlineRebate(
      admin,
      { agentDefault: 0.04, agentMax: 0.04, playerDefault: 0.016, playerMax: 0.02 },
      { playerDefault: 0.012, playerMin: 0.01, playerMax: 0.018 },
    );
    expect(merged.generalDefault).toBe(0.07);
    expect(merged.agentDefault).toBe(0.04);
    expect(merged.playerDefault).toBe(0.012);
  });

  it('nests old copied 1.7% floors into communicating bounds', () => {
    const nested = hydrateGameRebate({
      generalMin: 0.017, generalDefault: 0.07, generalMax: 0.1,
      agentMin: 0.017, agentDefault: 0.05, agentMax: 0.07,
      playerMin: 0.01, playerDefault: 0.018, playerMax: 0.03,
    }, lottery);
    expect(nested.generalMin).toBe(0.07);
    expect(nested.agentMin).toBe(0.03);
    expect(nested.agentMax).toBe(0.07);
    expect(nested.playerMax).toBe(0.03);
  });
});
