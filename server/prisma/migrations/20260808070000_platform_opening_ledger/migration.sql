-- 平台盘口池开账分录。
-- 那笔初始资金是 seed 直接写进 balance 的，没有流水，
-- 于是「逐账户 SUM(PointsLedger.amount) == balance」对平台账户永远差一整个初始额。
-- 补上之后不变量零豁免，对账不必给平台开后门。
--
-- 金额取「当前余额 − 已有流水合计」，即真正缺的那部分；已对平的库插 0 行。

INSERT INTO "PointsLedger" (
    "id", "accountId", "bizType", "amount", "balanceAfter",
    "refType", "refId", "remark", "idempotencyKey", "createdAt"
)
SELECT
    md5(a."id" || ':platform_opening')::text,
    a."id",
    'ADJUST'::"LedgerBizType",
    a."balance" - COALESCE(SUM(l."amount"), 0),
    a."balance",
    'platform_opening',
    'PLATFORM',
    '平台盘口池开账（迁移补记）',
    'platform_opening_balance',
    -- 排在所有流水之前，账户明细按时间读才是从开账开始的
    COALESCE(MIN(l."createdAt") - INTERVAL '1 second', NOW())
FROM "PointsAccount" a
LEFT JOIN "PointsLedger" l ON l."accountId" = a."id"
WHERE a."ownerType" = 'PLATFORM' AND a."ownerId" = 'PLATFORM'
GROUP BY a."id", a."balance"
HAVING a."balance" <> COALESCE(SUM(l."amount"), 0)
ON CONFLICT ("idempotencyKey") DO NOTHING;
