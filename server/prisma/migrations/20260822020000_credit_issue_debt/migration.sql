-- CreateTable
CREATE TABLE "CreditIssueDebt" (
    "id" TEXT NOT NULL,
    "debtorUserId" TEXT NOT NULL,
    "creditorKind" TEXT NOT NULL,
    "creditorUserId" TEXT,
    "roomId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "remaining" DECIMAL(18,2) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "remark" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditIssueDebt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditIssueDebt_idempotencyKey_key" ON "CreditIssueDebt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditIssueDebt_debtorUserId_remaining_idx" ON "CreditIssueDebt"("debtorUserId", "remaining");

-- CreateIndex
CREATE INDEX "CreditIssueDebt_creditorKind_creditorUserId_remaining_idx" ON "CreditIssueDebt"("creditorKind", "creditorUserId", "remaining");

-- CreateIndex
CREATE INDEX "CreditIssueDebt_roomId_remaining_idx" ON "CreditIssueDebt"("roomId", "remaining");
