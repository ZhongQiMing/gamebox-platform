-- AlterTable
ALTER TABLE "RoomGameConfig" ADD COLUMN IF NOT EXISTS "robotPlan" JSONB;

-- AlterTable
ALTER TABLE "ControlPolicy" ADD COLUMN IF NOT EXISTS "playerId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ControlPolicy_playerId_status_idx" ON "ControlPolicy"("playerId", "status");

-- CreateTable
CREATE TABLE IF NOT EXISTS "RoomWeekSettle" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "bookMode" TEXT NOT NULL,
    "agentShareRate" DOUBLE PRECISION NOT NULL,
    "betFlow" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "housePnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "agentShareAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "platformShareAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "settledAt" TIMESTAMP(3),
    "settledById" TEXT,
    "creditRestored" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomWeekSettle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RoomWeekSettle_roomId_weekStart_key" ON "RoomWeekSettle"("roomId", "weekStart");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoomWeekSettle_roomId_status_idx" ON "RoomWeekSettle"("roomId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoomWeekSettle_weekStart_idx" ON "RoomWeekSettle"("weekStart");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "RoomWeekSettle" ADD CONSTRAINT "RoomWeekSettle_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
