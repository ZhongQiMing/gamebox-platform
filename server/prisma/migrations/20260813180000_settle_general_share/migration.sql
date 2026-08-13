-- 结账留存总代成数差：现金盘按 代理 → 总代 → 平台 三段交割

ALTER TABLE "RoomWeekSettle" ADD COLUMN IF NOT EXISTS "generalShareRate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "RoomWeekSettle" ADD COLUMN IF NOT EXISTS "generalShareAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- 历史账期都没有总代，成数差为 0，总代成数按代理成数回填保持口径一致
UPDATE "RoomWeekSettle" SET "generalShareRate" = "agentShareRate" WHERE "generalShareRate" = 0;
