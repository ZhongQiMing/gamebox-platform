-- 偏置：庄家视角回血/放水 + 比例%；历史硬控 ACTIVE 一律停用
ALTER TABLE "GlobalSoftBias" ADD COLUMN "biasPct" DOUBLE PRECISION NOT NULL DEFAULT 3;

UPDATE "GlobalSoftBias"
SET "biasPct" = CASE WHEN "weight" = 'MEDIUM' THEN 5 ELSE 3 END;

UPDATE "GlobalSoftBias" SET "kind" = 'ROOM_RECOVER' WHERE "kind" = 'ROOM_PRESS';
UPDATE "GlobalSoftBias" SET "kind" = 'ROOM_RELEASE' WHERE "kind" = 'ROOM_FAVOR';

ALTER TABLE "GlobalSoftBias" DROP COLUMN "weight";

UPDATE "ControlPolicy" SET "status" = 'HALTED', "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'ACTIVE';
