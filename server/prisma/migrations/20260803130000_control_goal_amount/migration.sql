-- 控奖：目标回血金额（替代运营手填时长）
ALTER TABLE "ControlPolicy" ADD COLUMN IF NOT EXISTS "goalAmount" DECIMAL(18,2);
