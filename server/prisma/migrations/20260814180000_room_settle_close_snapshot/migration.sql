-- 信用盘封账快照：账期一到定格账本，实际对接时按快照收钱、按「当前剩余 − 封账超出」补额度，
-- 封账之后到对接之间的输赢自动留给下一期。

ALTER TABLE "RoomWeekSettle" ADD COLUMN IF NOT EXISTS "quotaAtClose" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "RoomWeekSettle" ADD COLUMN IF NOT EXISTS "playerBalancesAtClose" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "RoomWeekSettle" ADD COLUMN IF NOT EXISTS "csBalancesAtClose" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "RoomWeekSettle" ADD COLUMN IF NOT EXISTS "excessAtClose" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "RoomWeekSettle" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
