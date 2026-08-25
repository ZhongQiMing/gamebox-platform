import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 对外接口不得泄漏软控痕迹。
 *
 * 彩票的候选是「同一把种子的第 N 页」，所以 nonce>1 就等于公开宣布这一期
 * 放弃了自然结果。牌桌已经在改独立候选种子时堵掉同类泄漏，彩票这一侧也必须堵。
 * 种子与指纹照常公布，玩家仍能复算——那个 nonce 由后台留痕持有。
 *
 * 这条用源码断言而不是跑接口：它是一条「以后别人加回去」的护栏，
 * 源码级检查最直接，也不需要起数据库。
 */
describe('彩票公开接口不泄漏 nonce', () => {
  const src = readFileSync(
    join(__dirname, 'lottery.service.ts'),
    'utf8',
  );

  /** 取出某个方法体（到下一个同缩进的方法为止） */
  function methodBody(name: string): string {
    const start = src.indexOf(`async ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start);
    const end = rest.indexOf('\n  }\n');
    return rest.slice(0, end > 0 ? end : rest.length);
  }

  it('history 的 select 不包含 nonce', () => {
    const body = methodBody('history');
    expect(body).toContain('serverSeed: true');
    expect(body).toContain('serverSeedHash: true');
    expect(body).not.toMatch(/\bnonce:\s*true/);
  });

  it('currentIssue 的 select 不包含 nonce 与 serverSeed', () => {
    const body = methodBody('currentIssue');
    expect(body).not.toMatch(/\bnonce:\s*true/);
    expect(body).not.toMatch(/\bserverSeed:\s*true/);
  });

  it('myBets 不返回 nonce', () => {
    const body = methodBody('myBets');
    expect(body).not.toMatch(/\bnonce:\s*true/);
  });
});
