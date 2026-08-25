-- 平台向总代收的房间月费单价：总代每开一间房，每月按这个价缴给平台。
-- 总代向代理收多少走 Room.monthlyFee，由总代自己定，差价归他。
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "roomMonthlyFee" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- 平台向总代收本房月费的下一个到期时间（预收：建房即计，下次结账收第一笔）。
-- 与 Room.nextBillAt 是两条腿：那个是向代理收，这个是平台向总代收。
-- 直挂房为 NULL：平台直接向代理收，不走总代这条腿。
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "platformFeeDueAt" TIMESTAMP(3);

-- 存量挂总代的房从现在起按新规则计费：下次总代结账收第一笔。
-- 历史账期不追补（已结清的数字改了会跟线下已交割的对不上）。
UPDATE "Room"
SET "platformFeeDueAt" = NOW()
WHERE "generalAgentId" IS NOT NULL
  AND "status" <> 'CLOSED'
  AND "platformFeeDueAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Room_platformFeeDueAt_idx" ON "Room" ("platformFeeDueAt");

-- 总代账期里这一期收的房间月费快照；已含在 settlePay 里，收了哪几间房记在 note
ALTER TABLE "GeneralPeriodSettle" ADD COLUMN IF NOT EXISTS "roomFee" DECIMAL(18,2) NOT NULL DEFAULT 0;
