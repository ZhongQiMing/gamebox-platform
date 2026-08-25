-- AlterTable
ALTER TABLE "CsStaff" ADD COLUMN     "slaLockReason" TEXT,
ADD COLUMN     "slaLockedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CsSlaPolicy" (
    "id" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "remindSec" INTEGER NOT NULL DEFAULT 180,
    "kickSec" INTEGER NOT NULL DEFAULT 480,
    "lateFine" DECIMAL(18,2) NOT NULL DEFAULT 10,
    "missFine" DECIMAL(18,2) NOT NULL DEFAULT 50,
    "dailyFineCapRate" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "bonusMinRate" DOUBLE PRECISION NOT NULL DEFAULT 0.95,
    "bonusMinRounds" INTEGER NOT NULL DEFAULT 20,
    "dailyBonus" DECIMAL(18,2) NOT NULL DEFAULT 100,
    "streakDays" INTEGER NOT NULL DEFAULT 7,
    "streakBonus" DECIMAL(18,2) NOT NULL DEFAULT 500,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsSlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsSlaEvent" (
    "id" TEXT NOT NULL,
    "csUserId" TEXT NOT NULL,
    "agentUserId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "askedAt" TIMESTAMP(3) NOT NULL,
    "askMessageId" TEXT NOT NULL,
    "repliedAt" TIMESTAMP(3),
    "responseSec" INTEGER,
    "level" TEXT NOT NULL DEFAULT 'PENDING',
    "remindedAt" TIMESTAMP(3),
    "kickedAt" TIMESTAMP(3),
    "fineAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "waived" BOOLEAN NOT NULL DEFAULT false,
    "waivedBy" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waiveReason" TEXT,
    "dayKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsSlaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsDutySpan" (
    "id" TEXT NOT NULL,
    "csUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "dayKey" TEXT NOT NULL,

    CONSTRAINT "CsDutySpan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CsSlaPolicy_agentUserId_key" ON "CsSlaPolicy"("agentUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CsSlaEvent_askMessageId_key" ON "CsSlaEvent"("askMessageId");

-- CreateIndex
CREATE INDEX "CsSlaEvent_csUserId_dayKey_idx" ON "CsSlaEvent"("csUserId", "dayKey");

-- CreateIndex
CREATE INDEX "CsSlaEvent_agentUserId_dayKey_idx" ON "CsSlaEvent"("agentUserId", "dayKey");

-- CreateIndex
CREATE INDEX "CsSlaEvent_level_repliedAt_idx" ON "CsSlaEvent"("level", "repliedAt");

-- CreateIndex
CREATE INDEX "CsDutySpan_csUserId_dayKey_idx" ON "CsDutySpan"("csUserId", "dayKey");

-- CreateIndex
CREATE INDEX "CsDutySpan_csUserId_endedAt_idx" ON "CsDutySpan"("csUserId", "endedAt");
