import { AUTH_COOKIE, CSRF_COOKIE, setAuthCookies } from './auth-cookie';

function mockRes() {
  const cookies: Array<[string, string, Record<string, unknown>]> = [];
  return {
    cookies,
    cookie(name: string, val: string, opts: Record<string, unknown>) {
      cookies.push([name, val, opts]);
    },
  };
}

describe('setAuthCookies', () => {
  it('默认写入 maxAge，关浏览器也还在（玩家网页版）', () => {
    const res = mockRes();
    setAuthCookies(res as never, 'tok', { isProd: false, expiresIn: '1d' });
    expect(res.cookies[0][0]).toBe(AUTH_COOKIE);
    expect(res.cookies[0][2].maxAge).toBe(86_400_000);
    expect(res.cookies[1][0]).toBe(CSRF_COOKIE);
    expect(res.cookies[1][2].maxAge).toBe(86_400_000);
  });

  it('persist:false 不写 maxAge，作为会话 Cookie（管理后台）', () => {
    const res = mockRes();
    setAuthCookies(res as never, 'tok', {
      isProd: false,
      expiresIn: '1d',
      persist: false,
    });
    expect(res.cookies[0][2].maxAge).toBeUndefined();
    expect(res.cookies[1][2].maxAge).toBeUndefined();
    expect(res.cookies[0][2].httpOnly).toBe(true);
    expect(res.cookies[1][2].httpOnly).toBe(false);
  });
});
