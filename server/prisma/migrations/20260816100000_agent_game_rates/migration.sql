-- 总代/代理按游戏自己加减的回水额度
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "gameRates" JSONB NOT NULL DEFAULT '{}';
