-- 补建 RoomChatMessage / RoomMember / DailyRebateSettlement。
-- 这三张表历史上只在开发库用 db push 建过，迁移历史里从未 CREATE TABLE，
-- 导致空库执行 migrate deploy 时后续迁移会因「表不存在」失败：
--   20260725120000_room_chat_system_once   -> RoomChatMessage
--   20260725220000_daily_rebate_once_per_day -> DailyRebateSettlement
--   20260802010000_fly_disk_quota          -> RoomMember
-- 因此本迁移刻意排在它们之前；全部语句幂等，已建库重复执行安全。

-- CreateTable
CREATE TABLE IF NOT EXISTS "RoomChatMessage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "gameCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "issueNo" TEXT,
    "senderId" TEXT,
    "senderName" TEXT NOT NULL,
    "senderAvatar" TEXT,
    "isRobot" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RoomMember" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "flyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "playerRebateRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DailyRebateSettlement" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "rebateDate" DATE NOT NULL,
    "validFlow" DECIMAL(18,2) NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "claimType" TEXT NOT NULL,
    "ledgerId" TEXT,
    "periodEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gameDetail" JSONB,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyRebateSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoomChatMessage_roomId_gameCode_createdAt_idx" ON "RoomChatMessage"("roomId", "gameCode", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoomChatMessage_roomId_gameCode_id_idx" ON "RoomChatMessage"("roomId", "gameCode", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoomChatMessage_roomId_gameCode_kind_issueNo_idx" ON "RoomChatMessage"("roomId", "gameCode", "kind", "issueNo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoomMember_playerId_status_idx" ON "RoomMember"("playerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RoomMember_playerId_roomId_key" ON "RoomMember"("playerId", "roomId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DailyRebateSettlement_playerId_rebateDate_idx" ON "DailyRebateSettlement"("playerId", "rebateDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DailyRebateSettlement_playerId_claimedAt_idx" ON "DailyRebateSettlement"("playerId", "claimedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DailyRebateSettlement_playerId_periodEnd_idx" ON "DailyRebateSettlement"("playerId", "periodEnd");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "RoomChatMessage" ADD CONSTRAINT "RoomChatMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "DailyRebateSettlement" ADD CONSTRAINT "DailyRebateSettlement_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
