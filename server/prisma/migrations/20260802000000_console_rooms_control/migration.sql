-- AlterTable User: session revocation
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable Room
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "title" TEXT;

-- RoomOwnerGrant
CREATE TABLE IF NOT EXISTS "RoomOwnerGrant" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomOwnerGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RoomOwnerGrant_roomId_ownerId_key" ON "RoomOwnerGrant"("roomId", "ownerId");
CREATE INDEX IF NOT EXISTS "RoomOwnerGrant_ownerId_idx" ON "RoomOwnerGrant"("ownerId");
ALTER TABLE "RoomOwnerGrant" DROP CONSTRAINT IF EXISTS "RoomOwnerGrant_roomId_fkey";
ALTER TABLE "RoomOwnerGrant" ADD CONSTRAINT "RoomOwnerGrant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomOwnerGrant" DROP CONSTRAINT IF EXISTS "RoomOwnerGrant_ownerId_fkey";
ALTER TABLE "RoomOwnerGrant" ADD CONSTRAINT "RoomOwnerGrant_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RoomGameConfig
CREATE TABLE IF NOT EXISTS "RoomGameConfig" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "gameCode" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "robotCount" INTEGER NOT NULL DEFAULT 14,
    "minBet" DECIMAL(18,2),
    "maxBet" DECIMAL(18,2),
    "rebateRate" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomGameConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RoomGameConfig_roomId_gameCode_key" ON "RoomGameConfig"("roomId", "gameCode");
CREATE INDEX IF NOT EXISTS "RoomGameConfig_gameCode_idx" ON "RoomGameConfig"("gameCode");
ALTER TABLE "RoomGameConfig" DROP CONSTRAINT IF EXISTS "RoomGameConfig_roomId_fkey";
ALTER TABLE "RoomGameConfig" ADD CONSTRAINT "RoomGameConfig_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ControlPolicy
CREATE TABLE IF NOT EXISTS "ControlPolicy" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roomId" TEXT,
    "gameCode" TEXT,
    "targetType" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "remark" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ControlPolicy_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ControlPolicy_status_startAt_endAt_idx" ON "ControlPolicy"("status", "startAt", "endAt");
CREATE INDEX IF NOT EXISTS "ControlPolicy_roomId_gameCode_status_idx" ON "ControlPolicy"("roomId", "gameCode", "status");
ALTER TABLE "ControlPolicy" DROP CONSTRAINT IF EXISTS "ControlPolicy_roomId_fkey";
ALTER TABLE "ControlPolicy" ADD CONSTRAINT "ControlPolicy_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RebatePolicy singleton
CREATE TABLE IF NOT EXISTS "RebatePolicy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "minRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "defaults" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RebatePolicy_pkey" PRIMARY KEY ("id")
);
INSERT INTO "RebatePolicy" ("id", "minRate", "maxRate", "defaults", "updatedAt")
VALUES (1, 0, 0.03, '{}', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
