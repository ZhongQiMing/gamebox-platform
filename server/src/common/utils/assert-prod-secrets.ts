import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

const MIN_SECRET_LEN = 32;

/** .env.example 占位串与常见弱口令，命中即视为未改密钥 */
const PLACEHOLDER_SECRETS = new Set([
  'change_me',
  'changeme',
  'change_me_to_a_long_random_string',
  'secret',
  'jwt_secret',
  'jwtsecret',
  'dev',
  'devsecret',
  'test',
  'password',
  '123456',
]);

/**
 * 人写的开发密钥特征。
 *
 * 只看长度会漏：`gamebox_dev_jwt_secret_local_only_2026` 有 39 位、字符也够杂，
 * 照样过关。可它是仓库里人人可见的本地串，复制 .env 上线就等于把签发权公开。
 * 真随机串（hex / base64url）不会出现这些词。
 */
const DEV_SECRET_MARKERS = [
  'dev',
  'local',
  'sample',
  'example',
  'demo',
  'test',
  'placeholder',
  'gamebox',
];

/** 香农熵（bit/字符）：随机 hex 约 4、base64url 约 6；人写的口令通常 < 3.5 */
function shannonEntropyPerChar(v: string): number {
  const freq = new Map<string, number>();
  for (const ch of v) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of freq.values()) {
    const p = n / v.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function isWeakSecret(raw: string): boolean {
  const v = raw.trim();
  if (v.length < MIN_SECRET_LEN) return true;
  const lower = v.toLowerCase();
  if (PLACEHOLDER_SECRETS.has(lower)) return true;
  /* 单一字符重复（aaaa…）不算随机 */
  if (new Set(v).size <= 4) return true;
  if (DEV_SECRET_MARKERS.some((m) => lower.includes(m))) return true;
  return shannonEntropyPerChar(v) < 3.5;
}

/**
 * 启动前校验运行期密钥：生产直接终止进程，开发只告警。
 * JWT_SECRET 一旦沿用占位值，任何人都能伪造管理员 token。
 */
export function assertProdSecrets(config: ConfigService, isProd: boolean) {
  const logger = new Logger('Security');
  const problems: string[] = [];

  if (isWeakSecret(String(config.get<string>('JWT_SECRET') ?? ''))) {
    problems.push(`JWT_SECRET 需为至少 ${MIN_SECRET_LEN} 位随机串，且不得沿用 .env.example 占位值`);
  }

  if (isProd && !String(config.get<string>('CORS_ORIGIN') ?? '').trim()) {
    logger.log('未设置 CORS_ORIGIN：仅放行 App 的 WebView 来源，网页走同源反代');
  }

  if (!problems.length) return;
  if (isProd) throw new Error(`[security] ${problems.join('；')}`);
  for (const p of problems) logger.warn(`${p}（开发环境仅告警）`);
}
