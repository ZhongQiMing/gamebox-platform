-- 共盘软控：控后冷却开关（街机资金池不使用冷却）
ALTER TABLE "GlobalSoftControl" ADD COLUMN IF NOT EXISTS "cooldownEnabled" BOOLEAN NOT NULL DEFAULT true;
