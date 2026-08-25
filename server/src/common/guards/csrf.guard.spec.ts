import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { CsrfGuard } from './csrf.guard';

function request(input: {
  url?: string;
  method?: string;
  protocol?: string;
  host?: string;
  headers?: Record<string, string>;
}): Request {
  const headers = input.headers ?? {};
  const cookies = Object.fromEntries(
    String(headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([key, value]) => !!key && value !== undefined),
  );
  return {
    method: input.method ?? 'POST',
    originalUrl: input.url ?? '/api/auth/login',
    url: input.url ?? '/api/auth/login',
    protocol: input.protocol ?? 'https',
    headers,
    cookies,
    get: (name: string) =>
      name.toLowerCase() === 'host'
        ? (input.host ?? 'gamebox.example')
        : headers[name.toLowerCase()],
  } as unknown as Request;
}

function context(req: Request): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: jest.fn(),
      getNext: jest.fn(),
    }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard 认证端点来源校验', () => {
  const guard = new CsrfGuard();
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowedOrigins = process.env.AUTH_ALLOWED_ORIGINS;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalAllowedOrigins === undefined) {
      delete process.env.AUTH_ALLOWED_ORIGINS;
    } else {
      process.env.AUTH_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  });

  it('允许同源 Web 登录', () => {
    const req = request({
      headers: { origin: 'https://gamebox.example' },
    });
    expect(guard.canActivate(context(req))).toBe(true);
  });

  it('拒绝普通跨站表单替换登录会话', () => {
    const req = request({
      headers: {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(() => guard.canActivate(context(req))).toThrow(
      ForbiddenException,
    );
  });

  it('Origin 缺失时仍拒绝 cross-site Fetch Metadata', () => {
    const req = request({
      url: '/api/auth/logout',
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(() => guard.canActivate(context(req))).toThrow(
      '认证请求来源校验失败',
    );
  });

  it.each([
    'https://localhost',
    'capacitor://localhost',
    'http://localhost',
  ])('允许 Capacitor 来源 %s', (origin) => {
    const req = request({ headers: { origin } });
    expect(guard.canActivate(context(req))).toBe(true);
  });

  it('允许没有浏览器来源信号的原生 HTTP 客户端', () => {
    expect(guard.canActivate(context(request({ headers: {} })))).toBe(true);
  });

  it('开发环境允许 Vite 代理过来的后台 Origin（端口与 Host 不同）', () => {
    process.env.NODE_ENV = 'development';
    const req = request({
      protocol: 'http',
      host: 'localhost:3000',
      headers: { origin: 'http://localhost:3001' },
    });
    expect(guard.canActivate(context(req))).toBe(true);
  });

  it('开发环境允许调试包从局域网 IP 登录', () => {
    process.env.NODE_ENV = 'development';
    const req = request({
      protocol: 'http',
      host: 'localhost:3000',
      headers: { origin: 'http://192.168.1.16:5173' },
    });
    expect(guard.canActivate(context(req))).toBe(true);
  });

  it('生产环境不放行局域网 IP Origin', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_ALLOWED_ORIGINS = 'https://app.example';
    const req = request({
      host: 'app.example',
      headers: { origin: 'http://192.168.1.16:5173' },
    });
    expect(() => guard.canActivate(context(req))).toThrow(ForbiddenException);
  });

  it('生产环境只允许显式列出的玩家端与管理端 Origin', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_ALLOWED_ORIGINS =
      'https://app.example,https://admin.example';

    expect(
      guard.canActivate(
        context(
          request({
            host: 'admin.example',
            headers: { origin: 'https://admin.example' },
          }),
        ),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        context(
          request({
            host: 'shadow.example',
            headers: { origin: 'https://shadow.example' },
          }),
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('普通 Cookie 写请求仍要求双提交 CSRF token', () => {
    const req = request({
      url: '/api/users/profile',
      headers: {
        origin: 'https://gamebox.example',
        cookie: 'gb_session=session; gb_csrf=csrf-a',
        'x-csrf-token': 'csrf-b',
      },
    });
    expect(() => guard.canActivate(context(req))).toThrow('CSRF 校验失败');
  });
});
