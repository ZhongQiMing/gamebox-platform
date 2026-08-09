-- 街机/电子资金池：与共盘解耦的试号数 + 统计窗口，并把目标返还率抬到 0.92
--
-- 为什么要窗口：原来池子按全历史累计算余额，平台上个月赚到的钱会被当成负债，
-- 在之后的开奖里一路吐回去。加窗口后，窗口之外的盈亏永久落袋，不再参与挑号。
--
-- 为什么要单独的试号数：街机原先复用共盘 candidateTries，
-- 调共盘轻微调节会连带改街机爆率。

ALTER TABLE "GlobalSoftControl"
  ADD COLUMN IF NOT EXISTS "arcadeCandidateTries" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "GlobalSoftControl"
  ADD COLUMN IF NOT EXISTS "arcadePoolWindowDays" INTEGER NOT NULL DEFAULT 14;

ALTER TABLE "GlobalSoftControl"
  ALTER COLUMN "arcadeRtpTarget" SET DEFAULT 0.92;

-- 存量行：只把还停在旧默认 0.65 的行抬到 0.92，避免覆盖运营手改过的值
UPDATE "GlobalSoftControl"
   SET "arcadeRtpTarget" = 0.92
 WHERE id = 1
   AND "arcadeRtpTarget" = 0.65;
