-- CreateTable
CREATE TABLE "PlatformApplyQueue" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformApplyQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformApplyQueue_ledgerId_key" ON "PlatformApplyQueue"("ledgerId");

-- CreateIndex
CREATE INDEX "PlatformApplyQueue_accountId_createdAt_id_idx" ON "PlatformApplyQueue"("accountId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "PlatformApplyQueue" ADD CONSTRAINT "PlatformApplyQueue_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PointsAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
