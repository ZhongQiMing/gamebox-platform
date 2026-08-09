-- 偏热回拉独立试号次数（与轻微调节分开）
ALTER TABLE "GlobalSoftControl" ADD COLUMN IF NOT EXISTS "candidateTriesHalt" INTEGER NOT NULL DEFAULT 16;
