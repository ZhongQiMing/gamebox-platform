ALTER TABLE "DailyRebateSettlement"
ADD COLUMN "roomId" TEXT;

CREATE INDEX "DailyRebateSettlement_playerId_roomId_rebateDate_periodEnd_idx"
ON "DailyRebateSettlement"("playerId", "roomId", "rebateDate", "periodEnd");

ALTER TABLE "Game"
ADD COLUMN "maintenanceSource" TEXT,
ADD COLUMN "maintenanceBatchId" TEXT;

CREATE INDEX "Game_status_maintenanceSource_maintenanceBatchId_idx"
ON "Game"("status", "maintenanceSource", "maintenanceBatchId");

-- 迁移前没有可靠来源标记。现存 MAINTENANCE 必须按人工维护保守处理，
-- 宁可要求人工上线，也绝不能在重启恢复时误上线。
UPDATE "Game"
SET "maintenanceSource" = 'MANUAL'
WHERE "status" = 'MAINTENANCE'
  AND "maintenanceSource" IS NULL;
