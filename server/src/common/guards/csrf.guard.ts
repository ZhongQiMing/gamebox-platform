import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AUTH_COOKIE, CSRF_COOKIE, CSRF_HEADER, readCookie,
} from '../../modules/auth/auth-cookie';

/** 只读方法不改状态，CSRF 不适用 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 登录/注册是在「建立」会话，登出是在「拆除」会话。
 * 这三类若仍要求 CSRF，会出现死锁：
 *   手机端登录成功后服务端一律下发 gb_session，但 App 不走 Cookie 认证、也不带头；
 *   同域下浏览器仍会自动带上旧 Cookie → 再次登录/换入口登录就被 403。
 * SameSite=Strict 已挡住跨站伪造登录；这里只放行本域建/拆会话。
 */
const CSRF_EXEMPT_PATH =
  /\/auth\/(login|register|logout)\/?$/;

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
    if (CSRF_EXEMPT_PATH.test(path)) return true;

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
