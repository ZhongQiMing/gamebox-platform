-- 全站软控：房间/玩家软偏置（次级排序）
CREATE TABLE IF NOT EXISTS "GlobalSoftBias" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "playerId" TEXT,
    "weight" TEXT NOT NULL DEFAULT 'LIGHT',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "remark" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalSoftBias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GlobalSoftBias_enabled_kind_idx" ON "GlobalSoftBias"("enabled", "kind");
CREATE INDEX IF NOT EXISTS "GlobalSoftBias_roomId_idx" ON "GlobalSoftBias"("roomId");
CREATE INDEX IF NOT EXISTS "GlobalSoftBias_playerId_idx" ON "GlobalSoftBias"("playerId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GlobalSoftBias_roomId_fkey'
  ) THEN
    ALTER TABLE "GlobalSoftBias"
      ADD CONSTRAINT "GlobalSoftBias_roomId_fkey"
      FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
