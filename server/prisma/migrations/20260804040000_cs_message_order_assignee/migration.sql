-- AlterTable
ALTER TABLE "CsMessage" ADD COLUMN IF NOT EXISTS "rechargeOrderId" TEXT;
ALTER TABLE "CsMessage" ADD COLUMN IF NOT EXISTS "assigneeId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CsMessage_assigneeId_createdAt_idx" ON "CsMessage"("assigneeId", "createdAt");
CREATE INDEX IF NOT EXISTS "CsMessage_rechargeOrderId_idx" ON "CsMessage"("rechargeOrderId");
