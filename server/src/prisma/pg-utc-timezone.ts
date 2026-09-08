/**
 * Prisma 的 DateTime 默认映射成 PostgreSQL `timestamp without time zone`，
 * 写入的是 UTC 墙钟（例如上海 01:41 → 库里 17:41 前一天）。
 *
 * 宝塔 Postgres 会话时区经常是 Asia/Shanghai。查询参数若按 timestamptz 进来，
 * 会被再加 8 小时：JS 里已经算好的「今日 00:00 +08」变成库内 08:00。
 * 凌晨流水就会全部落进「昨日」，界面统计区间却仍显示 00:00。
 *
 * 每条连接启动时把 TimeZone 钉成 UTC，比较才和写入口径一致。
 */
export function ensurePgUtcTimezone(databaseUrl: string): string {
  const raw = String(databaseUrl || '').trim();
  if (!raw) return raw;
  if (/(?:^|[?&]|-c\s+)TimeZone\s*=\s*UTC(?:&|$|\s|%20)/i.test(raw)) return raw;

  if (/[?&]options=/i.test(raw)) {
    return raw.replace(/([?&]options=)([^&]*)/i, (full, pfx: string, val: string) => {
      const decoded = decodeURIComponent(val.replace(/\+/g, ' '));
      if (/TimeZone\s*=/i.test(decoded)) return full;
      return `${pfx}${encodeURIComponent(`${decoded} -c TimeZone=UTC`.trim())}`;
    });
  }

  const joiner = raw.includes('?') ? '&' : '?';
  return `${raw}${joiner}options=${encodeURIComponent('-c TimeZone=UTC')}`;
}
