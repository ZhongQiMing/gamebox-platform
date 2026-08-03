#!/usr/bin/env bash
# PostgreSQL 逻辑备份（宝塔 / Linux 定时任务）
#
# 用法：
#   export DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/gamebox'
#   ./scripts/backup-postgres.sh
#
# 或复制 scripts/backup-postgres.env.example → scripts/backup-postgres.env 后直接跑。
# 建议宝塔计划任务每日凌晨执行；保留最近 N 天（BACKUP_KEEP_DAYS）。

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$(dirname "$0")/backup-postgres.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
fi

: "${DATABASE_URL:?请设置 DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups/postgres}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/gamebox_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
echo "[backup] → $OUT"
pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip -c > "$OUT"
echo "[backup] ok $(du -h "$OUT" | awk '{print $1}')"

# 清理过期
find "$BACKUP_DIR" -type f -name 'gamebox_*.sql.gz' -mtime +"$KEEP_DAYS" -print -delete || true
echo "[backup] keep last ${KEEP_DAYS} days"
