-- 全局软控：滚动窗分档 → 上海自然日账 + 模式带
-- 旧列废弃，新列带默认值

ALTER TABLE "GlobalSoftControl" ADD COLUMN IF NOT EXISTS "minFlowToControl" DOUBLE PRECISION NOT NULL DEFAULT 50000;
ALTER TABLE "GlobalSoftControl" ADD COLUMN IF NOT EXISTS "targetNetPct" DOUBLE PRECISION NOT NULL DEFAULT 4;
ALTER TABLE "GlobalSoftControl" ADD COLUMN IF NOT EXISTS "bandLowPct" DOUBLE PRECISION NOT NULL DEFAULT 2;
ALTER TABLE "GlobalSoftControl" ADD COLUMN IF NOT EXISTS "bandHighPct" DOUBLE PRECISION NOT NULL DEFAULT 6;
ALTER TABLE "GlobalSoftControl" ADD COLUMN IF NOT EXISTS "maxPeriodWinPct" DOUBLE PRECISION NOT NULL DEFAULT 40;
ALTER TABLE "GlobalSoftControl" ADD COLUMN IF NOT EXISTS "maxPeriodLossPct" DOUBLE PRECISION NOT NULL DEFAULT 8;
ALTER TABLE "GlobalSoftControl" ADD COLUMN IF NOT EXISTS "commissionRatePct" DOUBLE PRECISION NOT NULL DEFAULT 5;

ALTER TABLE "GlobalSoftControl" DROP COLUMN IF EXISTS "windowHours";
ALTER TABLE "GlobalSoftControl" DROP COLUMN IF EXISTS "targetHoldPct";
ALTER TABLE "GlobalSoftControl" DROP COLUMN IF EXISTS "tier1MinPct";
ALTER TABLE "GlobalSoftControl" DROP COLUMN IF EXISTS "tier1MaxPct";
ALTER TABLE "GlobalSoftControl" DROP COLUMN IF EXISTS "tier2EnterLossPct";
ALTER TABLE "GlobalSoftControl" DROP COLUMN IF EXISTS "tier2EnterWinPct";
ALTER TABLE "GlobalSoftControl" DROP COLUMN IF EXISTS "tier3EnterLossPct";

UPDATE "GlobalSoftControl" SET "candidateTries" = 8 WHERE "candidateTries" = 10;
UPDATE "GlobalSoftControl" SET "candidateTriesBoost" = 20 WHERE "candidateTriesBoost" < 8;
