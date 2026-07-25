import { shortTableRoundLabel } from '@gamebox/shared';
import {
  alignedRoundNo,
  drawOutcome,
  tableOutcomesMatch,
  timingOf,
} from './table-rules';

describe('alignedRoundNo', () => {
  const noonShanghai = Date.parse('2026-07-25T12:00:00+08:00');

  it('四家前缀不同且格式正确', () => {
    const codes = ['dragon-tiger', 'baccarat', 'zhajinhua', 'douniu', 'longhu'] as const;
    const expectPrefix: Record<string, string> = {
      'dragon-tiger': 'LHD',
      longhu: 'LHD',
      baccarat: 'BJL',
      zhajinhua: 'ZJH',
      douniu: 'DN',
    };
    for (const code of codes) {
      const no = alignedRoundNo(code, noonShanghai);
      expect(no).toMatch(new RegExp(`^${expectPrefix[code]}\\d{8}-\\d{4}$`));
      expect(no.startsWith(expectPrefix[code] + '20260725-')).toBe(true);
    }
    expect(alignedRoundNo('baccarat', noonShanghai)).not.toBe(
      alignedRoundNo('douniu', noonShanghai),
    );
  });

  it('同一墙钟周期内局号稳定', () => {
    const t = timingOf('baccarat');
    const cycleStart = Math.floor(noonShanghai / t.cycleMs) * t.cycleMs;
    const a = alignedRoundNo('baccarat', cycleStart);
    const b = alignedRoundNo('baccarat', cycleStart + Math.floor(t.cycleMs / 2));
    expect(a).toBe(b);
  });

  it('跨上海日切后日期段变化', () => {
    const before = Date.parse('2026-07-25T23:59:00+08:00');
    const after = Date.parse('2026-07-26T00:01:00+08:00');
    const a = alignedRoundNo('zhajinhua', before);
    const b = alignedRoundNo('zhajinhua', after);
    expect(a.includes('20260725')).toBe(true);
    expect(b.includes('20260726')).toBe(true);
  });

  it('短号只是全号派生，旧格式不得误识别', () => {
    const full = alignedRoundNo('baccarat', noonShanghai);
    const short = shortTableRoundLabel(full);
    expect(short).toMatch(/^\d{4}$/);
    expect(full.endsWith(`-${short}`)).toBe(true);
    expect(shortTableRoundLabel('TZHAJIN29748168')).toBeNull();
    expect(shortTableRoundLabel('29261197')).toBeNull();
  });
});

describe('tableOutcomesMatch', () => {
  it('龙虎：H5 与旧 winner 字段语义一致', () => {
    const a = {
      result: 'dragon',
      winner: 'DRAGON',
      dragon: { suit: 'spade', rank: 'K' },
      tiger: { suit: 'heart', rank: '3' },
    };
    const b = {
      winner: 'DRAGON',
      dragon: { suit: 'S', rank: 13 },
      tiger: { suit: 'H', rank: 3 },
    };
    expect(tableOutcomesMatch('dragon-tiger', a, b)).toBe(true);
    expect(tableOutcomesMatch('longhu', a, b)).toBe(true);
  });

  it('龙虎：结果不同则失败', () => {
    const a = {
      result: 'dragon',
      dragon: { suit: 'spade', rank: 'K' },
      tiger: { suit: 'heart', rank: '3' },
    };
    const b = {
      result: 'tiger',
      dragon: { suit: 'spade', rank: 'K' },
      tiger: { suit: 'heart', rank: '3' },
    };
    expect(tableOutcomesMatch('dragon-tiger', a, b)).toBe(false);
  });

  it('复算与 drawOutcome 自洽', () => {
    for (const code of ['baccarat', 'zhajinhua', 'douniu', 'dragon-tiger'] as const) {
      const out = drawOutcome(code, 'seed-for-test', 7);
      expect(tableOutcomesMatch(code, out, { ...out, extraNoise: 1 })).toBe(true);
    }
  });

  it('忽略 JSON 字段顺序噪音：多余字段不误杀', () => {
    const base = drawOutcome('baccarat', 'abc', 1);
    const noisy = {
      ...base,
      natural: true,
      unused: { foo: 1 },
    };
    expect(tableOutcomesMatch('baccarat', base, noisy)).toBe(true);
  });
});
