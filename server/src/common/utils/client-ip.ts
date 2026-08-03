/** 从 Express / Nest 请求头解析客户端 IP（兼容反代） */
export function extractClientIp(req: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string | null {
  const xf = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(xf) ? xf[0] : xf;
  const fromFwd = raw?.split(',')[0]?.trim();
  const ip = fromFwd || req.ip || req.socket?.remoteAddress || null;
  if (!ip) return null;
  // ::ffff:127.0.0.1 → 127.0.0.1
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/** 内网/本机 IP 不做同 IP 多号告警，避免开发环境误报 */
export function isPrivateOrLocalIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (!v || v === '::1' || v === 'localhost') return true;
  if (v.startsWith('127.')) return true;
  if (v.startsWith('10.')) return true;
  if (v.startsWith('192.168.')) return true;
  if (v.startsWith('169.254.')) return true;
  const m = /^172\.(\d+)\./.exec(v);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}
