-- 每日自助回水：同一玩家同一自然日只允许一条结算记录
-- 历史数据若已有同日多条，保留最早一条，其余挪到 claimedAt 所在日期以免唯一约束建不上
WITH ranked AS (
  SELECT
    "id",
    "playerId",
    "rebateDate",
    ROW_NUMBER() OVER (
      PARTITION BY "playerId", "rebateDate"
      ORDER BY "claimedAt" ASC, "id" ASC
    ) AS rn
  FROM "DailyRebateSettlement"
)
DELETE FROM "DailyRebateSettlement"
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX "DailyRebateSettlement_playerId_rebateDate_key"
  ON "DailyRebateSettlement"("playerId", "rebateDate");
