-- 挂靠佣金欠账：盘分不足时记 PENDING，补足后自动补发
CREATE TABLE IF NOT EXISTS "CommissionDebt" (
  "id" TEXT NOT NULL,
  "payerAgentUserId" TEXT NOT NULL,
  "beneficiaryId" TEXT NOT NULL,
  "sourceUserId" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "sourceRoundId" TEXT,
  "idemKey" TEXT NOT NULL,
  "baseFlow" DECIMAL(18,2) NOT NULL,
  "rate" DOUBLE PRECISION NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "settledAt" TIMESTAMP(3),
  "settleLedgerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionDebt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommissionDebt_idemKey_key"
  ON "CommissionDebt"("idemKey");
CREATE INDEX IF NOT EXISTS "CommissionDebt_payerAgentUserId_status_createdAt_idx"
  ON "CommissionDebt"("payerAgentUserId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "CommissionDebt_beneficiaryId_status_idx"
  ON "CommissionDebt"("beneficiaryId", "status");
CREATE INDEX IF NOT EXISTS "CommissionDebt_status_createdAt_idx"
  ON "CommissionDebt"("status", "createdAt");
