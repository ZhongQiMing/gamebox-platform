import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * 浏览器端的会话 Cookie（管理后台、玩家网页版、手机运营端网页都走它）。
 *
 * 为什么浏览器用 Cookie、App 继续用 Bearer：
 * 浏览器里的页面跟接口同域，Cookie 能设成 HttpOnly——JS 读不到，
 * 就算哪天出了 XSS 也偷不走身份。而 App 的页面是从安装包本地加载的，
 * 来源是 capacitor://localhost，跟接口天然跨站，iOS 的 WKWebView 又对
 * 跨站 Cookie 卡得很死，硬上会变成「安卓能用、iOS 登不上」。
 *
 * 两条路并存：JWT 校验先看 Authorization 头，没有再看 Cookie。
 * 客户端选哪条见 client-app/src/api/session.ts。
 */
export const AUTH_COOKIE = 'gb_session';

/**
 * CSRF 双提交令牌。
 *
 * Cookie 是浏览器自动带的，所以换成 Cookie 的同时必须防 CSRF：
 * 这个值故意**不设** HttpOnly，前端读得到、随请求头回传一份，
 * 服务端比对两者是否一致。别的站点读不到我们域名下的 Cookie，
 * 也就伪造不出这个头。
 */
export const CSRF_COOKIE = 'gb_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** 与 JWT_EXPIRES_IN 对齐；Cookie 活得比 token 久没有意义 */
function maxAgeMs(expiresIn: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(String(expiresIn || '').trim());
  if (!m) return 8 * 3600_000;
  const n = Number(m[1]);
  const unit = m[2] || 's';
  const mult = unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000;
  return n * mult;
}

export function newCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

export function setAuthCookies(
  res: Response,
  token: string,
  opts: { isProd: boolean; expiresIn: string; persist?: boolean },
): string {
  const csrf = newCsrfToken();
  /*
   * persist !== false：写 maxAge，关浏览器也还在（玩家网页版）。
   * persist === false：会话 Cookie，关浏览器进程就掉（管理后台）。
   */
  const persist = opts.persist !== false;
  const base: {
    sameSite: 'strict';
    secure: boolean;
    path: string;
    maxAge?: number;
  } = {
    /* Strict：跨站请求一律不带，CSRF 的第一道闸 */
    sameSite: 'strict',
    /* 生产必须 Secure；本地 http 调试下加了会导致浏览器直接丢弃 */
    secure: opts.isProd,
    path: '/',
  };
  if (persist) base.maxAge = maxAgeMs(opts.expiresIn);
  res.cookie(AUTH_COOKIE, token, { ...base, httpOnly: true });
  /* 这个要给前端读，不能 httpOnly */
  res.cookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false });
  return csrf;
}

export function clearAuthCookies(res: Response, opts: { isProd: boolean }) {
  const base = {
    sameSite: 'strict' as const,
    secure: opts.isProd,
    path: '/',
  };
  res.clearCookie(AUTH_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
}

export function readCookie(req: Request, name: string): string | null {
  const jar = (req as Request & { cookies?: Record<string, string> }).cookies;
  const v = jar?.[name];
  return typeof v === 'string' && v ? v : null;
}
