-- AlterEnum: AccountOwnerType + ROOM
ALTER TYPE "AccountOwnerType" ADD VALUE IF NOT EXISTS 'ROOM';

-- Agent: flyCover + defaults
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "flyCover" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "Agent" ALTER COLUMN "commissionRate" SET DEFAULT 0.002;
ALTER TABLE "Agent" ALTER COLUMN "rebateRate" SET DEFAULT 0.018;

-- RoomMember: fly + per-player rebate
ALTER TABLE "RoomMember" ADD COLUMN IF NOT EXISTS "flyEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "RoomMember" ADD COLUMN IF NOT EXISTS "playerRebateRate" DOUBLE PRECISION;

-- RebatePolicy: totalRate / playerMinRate
ALTER TABLE "RebatePolicy" ADD COLUMN IF NOT EXISTS "totalRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05;
ALTER TABLE "RebatePolicy" ADD COLUMN IF NOT EXISTS "playerMinRate" DOUBLE PRECISION NOT NULL DEFAULT 0.018;
ALTER TABLE "RebatePolicy" ALTER COLUMN "minRate" SET DEFAULT 0.018;
ALTER TABLE "RebatePolicy" ALTER COLUMN "maxRate" SET DEFAULT 0.05;

INSERT INTO "RebatePolicy" ("id", "minRate", "maxRate", "totalRate", "playerMinRate", "defaults", "updatedAt")
VALUES (1, 0.018, 0.05, 0.05, 0.018, '{}', NOW())
ON CONFLICT ("id") DO UPDATE SET
  "totalRate" = COALESCE("RebatePolicy"."totalRate", 0.05),
  "playerMinRate" = COALESCE("RebatePolicy"."playerMinRate", 0.018);
