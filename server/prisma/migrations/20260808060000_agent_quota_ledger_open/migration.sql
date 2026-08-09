-- 盘分流水期初：给这次改造之前就存在的额度补一行 OPEN，
-- 让 sum(AgentQuotaLedger.delta) 恒等于 Agent.pointsQuota，对账任务才有基准。
--
-- 上线前若清过库，这条一行也插不出来，属于「忘了清库」时的兜底。
-- 只补 pointsQuota != 0 且尚无任何流水的代理，重跑不会重复补（有唯一键兜底）。

INSERT INTO "AgentQuotaLedger" (
    "id", "agentUserId", "bookMode", "bizType",
    "delta", "quotaAfter", "refType", "refId", "remark", "idempotencyKey"
)
SELECT
    md5(a."userId" || ':quota_open')::text,
    a."userId",
    -- 代理名下有信用盘房间就算信用盘，否则现金盘
    CASE WHEN EXISTS (
        SELECT 1 FROM "Room" r
        WHERE r."ownerAgentId" = a."id" AND r."bookMode" = 'CREDIT'
    ) THEN 'CREDIT' ELSE 'CASH' END,
    'OPEN',
    a."pointsQuota",
    a."pointsQuota",
    'agent_open',
    a."userId",
    '流水启用前的存量额度（迁移补记）',
    'agent_quota_open:' || a."userId"
FROM "Agent" a
WHERE a."pointsQuota" <> 0
  AND NOT EXISTS (
      SELECT 1 FROM "AgentQuotaLedger" l WHERE l."agentUserId" = a."userId"
  )
ON CONFLICT ("idempotencyKey") DO NOTHING;
