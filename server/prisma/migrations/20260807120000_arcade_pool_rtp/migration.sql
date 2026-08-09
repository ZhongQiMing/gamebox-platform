-- 街机/电子独立长期资金池：目标返还率
ALTER TABLE "GlobalSoftControl"
  ADD COLUMN IF NOT EXISTS "arcadeRtpTarget" DOUBLE PRECISION NOT NULL DEFAULT 0.65;
