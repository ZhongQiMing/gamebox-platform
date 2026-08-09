-- 玩家偏置按目标金额；房间仍用 biasPct
ALTER TABLE "GlobalSoftBias" ADD COLUMN "goalAmount" DECIMAL(18, 2);
