-- 对账结果落库 + 出款闸门
--
-- 对账结论原先只存在进程内存里，重启就没了。而「对账不平即禁止出款」这条闸门
-- 必须依赖最近一次结论，内存态会让刚重启的实例既无法放行也无法拦截。
CREATE TABLE "FundReconRun" (
  "id"         TEXT NOT NULL,
  "trigger"    TEXT NOT NULL,
  "ok"         BOOLEAN NOT NULL,
  "totalBad"   INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "report"     JSONB NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FundReconRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FundReconRun_createdAt_idx" ON "FundReconRun" ("createdAt");
CREATE INDEX "FundReconRun_ok_createdAt_idx" ON "FundReconRun" ("ok", "createdAt");

-- 对账不平时一律禁止出款；误报会把整个生意冻住，所以留一条「管理员知情放行」的口子：
-- 必须填原因、过二次密码、且有到期时间，全程留痕。
CREATE TABLE "PayoutGateRelease" (
  "id"          TEXT NOT NULL,
  "reason"      TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PayoutGateRelease_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayoutGateRelease_expiresAt_idx" ON "PayoutGateRelease" ("expiresAt");

ALTER TABLE "PayoutGateRelease"
  ADD CONSTRAINT "PayoutGateRelease_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
