-- 总代与平台的账期结算：按总代自己的周期汇总名下所有房间，一次清账

CREATE TABLE IF NOT EXISTS "GeneralPeriodSettle" (
  "id"                  TEXT NOT NULL,
  "generalUserId"       TEXT NOT NULL,
  "periodStart"         TIMESTAMP(3) NOT NULL,
  "periodEnd"           TIMESTAMP(3) NOT NULL,
  "bookMode"            TEXT NOT NULL,
  "generalShareRate"    DOUBLE PRECISION NOT NULL,
  "betFlow"             DECIMAL(18,2) NOT NULL DEFAULT 0,
  "payout"              DECIMAL(18,2) NOT NULL DEFAULT 0,
  "housePnl"            DECIMAL(18,2) NOT NULL DEFAULT 0,
  "agentShareAmount"    DECIMAL(18,2) NOT NULL DEFAULT 0,
  "generalShareAmount"  DECIMAL(18,2) NOT NULL DEFAULT 0,
  "platformShareAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "settlePay"           DECIMAL(18,2) NOT NULL DEFAULT 0,
  "quotaAtClose"        DECIMAL(18,2) NOT NULL DEFAULT 0,
  "creditLimit"         DECIMAL(18,2) NOT NULL DEFAULT 0,
  "roomsSnapshot"       TEXT NOT NULL DEFAULT '[]',
  "roomCount"           INTEGER NOT NULL DEFAULT 0,
  "status"              TEXT NOT NULL DEFAULT 'OPEN',
  "closedAt"            TIMESTAMP(3),
  "settledAt"           TIMESTAMP(3),
  "settledById"         TEXT,
  "note"                TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeneralPeriodSettle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GeneralPeriodSettle_generalUserId_periodStart_key"
  ON "GeneralPeriodSettle"("generalUserId", "periodStart");
CREATE INDEX IF NOT EXISTS "GeneralPeriodSettle_generalUserId_status_idx"
  ON "GeneralPeriodSettle"("generalUserId", "status");
CREATE INDEX IF NOT EXISTS "GeneralPeriodSettle_periodStart_idx"
  ON "GeneralPeriodSettle"("periodStart");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GeneralPeriodSettle_generalUserId_fkey'
  ) THEN
    ALTER TABLE "GeneralPeriodSettle"
      ADD CONSTRAINT "GeneralPeriodSettle_generalUserId_fkey"
      FOREIGN KEY ("generalUserId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
