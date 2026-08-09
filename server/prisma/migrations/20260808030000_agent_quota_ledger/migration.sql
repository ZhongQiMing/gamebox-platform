-- 代理盘分变动流水：给「只改 pointsQuota」的信用盘补上账目凭证，
-- 同时作为现金/信用两种盘型共用的幂等锚点（此前信用盘无任何锚点，重放会重复加减额度）。

CREATE TABLE "AgentQuotaLedger" (
    "id" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "bookMode" TEXT NOT NULL,
    "bizType" TEXT NOT NULL,
    "delta" DECIMAL(18,2) NOT NULL,
    "quotaAfter" DECIMAL(18,2) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "remark" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentQuotaLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentQuotaLedger_idempotencyKey_key" ON "AgentQuotaLedger"("idempotencyKey");

CREATE INDEX "AgentQuotaLedger_agentUserId_createdAt_idx" ON "AgentQuotaLedger"("agentUserId", "createdAt");
