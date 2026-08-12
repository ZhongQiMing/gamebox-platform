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

function configuredWebOrigins(): Set<string> {
  const values = [
    process.env.PUBLIC_BASE_URL ?? '',
    ...(process.env.AUTH_ALLOWED_ORIGINS ?? '').split(','),
  ];
  return new Set(values.map(normalizedOrigin).filter(Boolean));
}

/**
 * 建立/替换会话不能依赖双提交 token（登录前还没有 token），改校验浏览器来源。
 * 无 Origin/Referer/Fetch Metadata 的非浏览器客户端继续允许；现代跨站表单至少会带
 * Origin/Referer 或 Sec-Fetch-Site: cross-site，因此会被拒绝。
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
    return capacitor.has(origin) || (expectedAllowed && origin === expected);
  }

  const referer = headerValue(req.headers.referer).trim();
  if (referer) {
    try {
      return (
        expectedAllowed &&
        normalizedOrigin(new URL(referer).origin) === expected
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
