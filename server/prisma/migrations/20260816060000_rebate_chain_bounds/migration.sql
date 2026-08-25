-- 回水一条链：管理定总代/代理整包与玩家框；总代定给代理的整包和给玩家的上下限
ALTER TABLE "RebatePolicy" ADD COLUMN IF NOT EXISTS "generalMinRate" DOUBLE PRECISION NOT NULL DEFAULT 0.018;
ALTER TABLE "RebatePolicy" ADD COLUMN IF NOT EXISTS "agentMinRate" DOUBLE PRECISION NOT NULL DEFAULT 0.018;
ALTER TABLE "RebatePolicy" ADD COLUMN IF NOT EXISTS "agentMaxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.07;
ALTER TABLE "RebatePolicy" ADD COLUMN IF NOT EXISTS "playerMaxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05;

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "downlineFlowRate" DOUBLE PRECISION;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "playerMinRate" DOUBLE PRECISION;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "playerMaxRate" DOUBLE PRECISION;

UPDATE "RebatePolicy"
SET
  "playerMaxRate" = COALESCE("maxRate", 0.05),
  "agentMaxRate" = LEAST(COALESCE("generalDefaultRate", "totalRate", 0.07), 0.07),
  "generalMinRate" = COALESCE("playerMinRate", 0.018),
  "agentMinRate" = COALESCE("playerMinRate", 0.018)
WHERE "id" = 1;
