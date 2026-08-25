import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AUTH_COOKIE, CSRF_COOKIE, CSRF_HEADER, readCookie,
} from '../../modules/auth/auth-cookie';
import { CAPACITOR_APP_ORIGINS } from '../security.constants';

/** 只读方法不改状态，CSRF 不适用 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const AUTH_SESSION_PATH = /\/auth\/(login|register|logout)\/?$/;

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function normalizedOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

const DEV_WEB_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
];

function configuredWebOrigins(): Set<string> {
  const values = [
    process.env.PUBLIC_BASE_URL ?? '',
    ...(process.env.AUTH_ALLOWED_ORIGINS ?? '').split(','),
    ...(process.env.NODE_ENV === 'production' ? [] : DEV_WEB_ORIGINS),
  ];
  return new Set(values.map(normalizedOrigin).filter(Boolean));
}

/**
 * 调试包里的页面是从开发机局域网 IP 加载的（`http://192.168.1.16:5173`），
 * 而 DEV_WEB_ORIGINS 只列了 localhost —— 手机/模拟器上登录会被判成跨站。
 * IP 随路由器分配变动，写死一个没有意义，所以开发环境按私网网段整体放行。
 * 仅在非生产生效；生产仍只认 PUBLIC_BASE_URL / AUTH_ALLOWED_ORIGINS。
 */
function isDevLanOrigin(origin: string): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function isTrustedWebOrigin(origin: string, expected: string, expectedAllowed: boolean): boolean {
  if (!origin || !expectedAllowed) return false;
  const configured = configuredWebOrigins();
  return origin === expected || configured.has(origin) || isDevLanOrigin(origin);
}

/**
 * 建立/替换会话不能依赖双提交 token（登录前还没有 token），改校验浏览器来源。
 * 无 Origin/Referer/Fetch Metadata 的非浏览器客户端继续允许；现代跨站表单至少会带
 * Origin/Referer 或 Sec-Fetch-Site: cross-site，因此会被拒绝。
 *
 * 本地 Vite 会把后台(3001)/玩家端(5173)代理到接口(3000)，浏览器 Origin 仍是前端端口，
 * Host 却变成 3000。这时不能只认「Origin === Host」，还要认 AUTH_ALLOWED_ORIGINS。
 */
export function hasTrustedAuthSource(req: Request): boolean {
  const host = req.get('host');
  const expected = host ? normalizedOrigin(`${req.protocol}://${host}`) : '';
  const capacitor = new Set(CAPACITOR_APP_ORIGINS.map(normalizedOrigin));
  const configured = configuredWebOrigins();
  const expectedAllowed =
    process.env.NODE_ENV !== 'production' || configured.has(expected);

  const origin = normalizedOrigin(headerValue(req.headers.origin));
  if (origin) {
    return capacitor.has(origin) || isTrustedWebOrigin(origin, expected, expectedAllowed);
  }

  const referer = headerValue(req.headers.referer).trim();
  if (referer) {
    try {
      return isTrustedWebOrigin(
        normalizedOrigin(new URL(referer).origin),
        expected,
        expectedAllowed,
      );
    } catch {
      return false;
    }
  }

  const fetchSite = headerValue(req.headers['sec-fetch-site']).toLowerCase();
  if (fetchSite) {
    return (
      expectedAllowed &&
      (fetchSite === 'same-origin' || fetchSite === 'none')
    );
  }

  /* curl、原生 HTTP 客户端等没有浏览器来源信号，也不会自动携带受害者 Cookie。 */
  return true;
}

/**
 * CSRF 双提交校验。
 *
 * 换成 Cookie 认证就必须补这一层：Cookie 是浏览器**自动**带上的，
 * 别的网站只要诱导你点一下，就能借你的登录态发请求。Bearer 不会自动带，
 * 所以只在「靠 Cookie 认证」的请求上校验，App 完全不受影响。
 *
 * 做法是双提交：登录时同时下发一个非 HttpOnly 的随机值，前端读出来放进请求头，
 * 服务端比对两者。别的域名读不到我们的 Cookie，也就凑不出这个头。
 * 再叠加 SameSite=Strict，等于两道独立的闸。
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const path = String(req.originalUrl || req.url || '').split('?')[0];
    if (AUTH_SESSION_PATH.test(path)) {
      if (!hasTrustedAuthSource(req)) {
        throw new ForbiddenException('认证请求来源校验失败');
      }
      return true;
    }

    /* 没带会话 Cookie 就不是 Cookie 认证：App 的 Bearer 请求从这里直接过 */
    if (!readCookie(req, AUTH_COOKIE)) return true;
    /* 同时带了 Bearer：以 Bearer 为准（jwt 策略也是这个顺序） */
    if (req.headers.authorization) return true;

    const cookieToken = readCookie(req, CSRF_COOKIE);
    const headerToken = req.headers[CSRF_HEADER];
    if (!cookieToken || typeof headerToken !== 'string' || headerToken !== cookieToken) {
      throw new ForbiddenException('CSRF 校验失败，请重新登录');
    }
    return true;
  }
}
