/**
 * 客服聊天保留策略。
 *
 * 一份数据、三个可见窗口：客服看得最少，代理次之，管理最多；
 * 物理删除只按最长那一档，删早了上面两档就是空的。
 * 这些数字是跟运营谈定的，改动会直接影响纠纷处理，所以钉在测试里。
 */
import { CsService } from './cs.service';

type Tier = 'CS' | 'AGENT' | 'ADMIN';

/** 只测纯函数部分，不碰数据库；这几个方法是 private，测试里按原型取 */
const svc = Object.create(CsService.prototype) as {
  viewerTier(role: string): Tier;
  textVisibleFrom(tier: Tier): Date;
  stripExpiredImages(text: string, createdAt: Date, tier: Tier): string;
};

const HOUR = 3600_000;
const ago = (h: number) => new Date(Date.now() - h * HOUR);
/** 可见窗口 = now - 窗口小时；换算回小时便于断言 */
const windowHours = (tier: Tier) =>
  Math.round((Date.now() - svc.textVisibleFrom(tier).getTime()) / HOUR);

describe('客服聊天可见窗口', () => {
  it('角色归档：客服自成一档，管理与总监同档，其余按代理算', () => {
    expect(svc.viewerTier('CS')).toBe('CS');
    expect(svc.viewerTier('ADMIN')).toBe('ADMIN');
    expect(svc.viewerTier('BRANCH')).toBe('ADMIN');
    expect(svc.viewerTier('AGENT')).toBe('AGENT');
    /* 总代与子账号没单独一档，跟代理同级 */
    expect(svc.viewerTier('GENERAL')).toBe('AGENT');
    expect(svc.viewerTier('PROXY')).toBe('AGENT');
  });

  it('文字：客服 8 小时、代理 12 小时、管理 3 天', () => {
    expect(windowHours('CS')).toBe(8);
    expect(windowHours('AGENT')).toBe(12);
    expect(windowHours('ADMIN')).toBe(72);
  });

  it('窗口必须逐级放宽，否则上家会比一线看得还少', () => {
    expect(windowHours('CS')).toBeLessThan(windowHours('AGENT'));
    expect(windowHours('AGENT')).toBeLessThan(windowHours('ADMIN'));
  });
});

describe('图片可见窗口', () => {
  const IMG = '付款截图 [img]/api/cs/media/abcdefghijkl';

  it('客服 3 小时内看得到原图', () => {
    expect(svc.stripExpiredImages(IMG, ago(1), 'CS')).toContain('[img]');
  });

  it('客服超过 3 小时只剩提示，逼他要最新截图', () => {
    const out = svc.stripExpiredImages(IMG, ago(4), 'CS');
    expect(out).not.toContain('[img]');
    expect(out).toContain('图片已过期');
  });

  it('同一条消息可能文字还在、图片已过期，不整条隐藏', () => {
    /* 4 小时前：文字在客服 8 小时窗口内，图片已超 3 小时 */
    const out = svc.stripExpiredImages(IMG, ago(4), 'CS');
    expect(out).toContain('付款截图');
  });

  it('纯图片消息过期后不会变成空串', () => {
    const out = svc.stripExpiredImages('[img]/api/cs/media/abcdefghijkl', ago(4), 'CS');
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it('代理 12 小时、管理 3 天内仍看得到图', () => {
    expect(svc.stripExpiredImages(IMG, ago(10), 'AGENT')).toContain('[img]');
    expect(svc.stripExpiredImages(IMG, ago(50), 'ADMIN')).toContain('[img]');
  });

  it('没有图片的消息原样返回', () => {
    expect(svc.stripExpiredImages('你好', ago(100), 'CS')).toBe('你好');
  });
});
