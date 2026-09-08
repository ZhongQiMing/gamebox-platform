import { ensurePgUtcTimezone } from './pg-utc-timezone';

describe('ensurePgUtcTimezone', () => {
  it('给没有 options 的 URL 钉上 TimeZone=UTC', () => {
    const url = 'postgresql://gamebox:x@localhost:5432/gamebox?schema=public';
    const out = ensurePgUtcTimezone(url);
    expect(out).toContain('options=');
    expect(decodeURIComponent(out)).toContain('TimeZone=UTC');
  });

  it('已有 TimeZone=UTC 则不重复追加', () => {
    const url =
      'postgresql://gamebox:x@localhost:5432/gamebox?schema=public&options='
      + encodeURIComponent('-c TimeZone=UTC');
    expect(ensurePgUtcTimezone(url)).toBe(url);
  });

  it('已有 options 时合并进同一参数', () => {
    const url =
      'postgresql://gamebox:x@localhost:5432/gamebox?options='
      + encodeURIComponent('-c search_path=public');
    const out = ensurePgUtcTimezone(url);
    const opt = new URL(out).searchParams.get('options') || '';
    expect(opt).toContain('search_path=public');
    expect(opt).toContain('TimeZone=UTC');
  });
});
