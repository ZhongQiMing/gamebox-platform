-- 客服上下分佣金账单（现金盘可先记未结）
CREATE TABLE IF NOT EXISTS "CsWageBill" (
  "id" TEXT NOT NULL,
  "csUserId" TEXT NOT NULL,
  "agentUserId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "fundAmount" DECIMAL(18,2) NOT NULL,
  "wageAmount" DECIMAL(18,2) NOT NULL,
  "wageRate" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "refType" TEXT,
  "refId" TEXT,
  "settledAt" TIMESTAMP(3),
  "settleLedgerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CsWageBill_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CsWageBill_csUserId_status_createdAt_idx"
  ON "CsWageBill"("csUserId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "CsWageBill_agentUserId_status_idx"
  ON "CsWageBill"("agentUserId", "status");
