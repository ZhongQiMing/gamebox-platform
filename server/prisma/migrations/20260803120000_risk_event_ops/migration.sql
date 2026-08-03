-- 风控事件运营字段 + 登录 IP 索引
ALTER TABLE "RiskEvent" ADD COLUMN IF NOT EXISTS "handleNote" TEXT;
ALTER TABLE "RiskEvent" ADD COLUMN IF NOT EXISTS "handledAt" TIMESTAMP(3);
ALTER TABLE "RiskEvent" ADD COLUMN IF NOT EXISTS "handledBy" TEXT;

CREATE INDEX IF NOT EXISTS "RiskEvent_handled_createdAt_idx" ON "RiskEvent"("handled", "createdAt");
CREATE INDEX IF NOT EXISTS "RiskEvent_targetId_createdAt_idx" ON "RiskEvent"("targetId", "createdAt");
CREATE INDEX IF NOT EXISTS "User_lastLoginIp_idx" ON "User"("lastLoginIp");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RiskEvent_handledBy_fkey'
  ) THEN
    ALTER TABLE "RiskEvent"
      ADD CONSTRAINT "RiskEvent_handledBy_fkey"
      FOREIGN KEY ("handledBy") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
