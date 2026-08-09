-- 单期总账软控 + 慢性失血档位
--
-- 单期铁律原来两头夹（庄赢超上限也判非法），一期只有一两注时候选全非法，
-- 每期都回退自然开奖，软控形同虚设。现在只拦「庄家亏太多」，
-- 触发线从 8% 抬到 50%：亏不到 50% 不介入，9 盖 1 / 8 盖 2 这类覆盖打法
-- 根本进不了软控，不会出现「专开你没买的那个号」。
--
-- 控后冷却停用：冷却期会把防爆权让出去，刚好撞上爆赔就只能认赔；
-- 改由单期金额门（小额认赔、小盘不杀、周期赚够认赔）约束干预频率。
--
-- gearMode：慢性失血档位手动开关，AUTO 按 48 小时周期账自动定档。

ALTER TABLE "GlobalSoftControl"
  ALTER COLUMN "maxPeriodLossPct" SET DEFAULT 50;

-- 存量行：只抬还停在旧默认 8 的行，不覆盖运营手改过的值
UPDATE "GlobalSoftControl"
   SET "maxPeriodLossPct" = 50
 WHERE id = 1
   AND "maxPeriodLossPct" = 8;

ALTER TABLE "GlobalSoftControl"
  ALTER COLUMN "cooldownEnabled" SET DEFAULT false;

UPDATE "GlobalSoftControl"
   SET "cooldownEnabled" = false
 WHERE id = 1;

ALTER TABLE "GlobalSoftControl"
  ADD COLUMN IF NOT EXISTS "gearMode" TEXT NOT NULL DEFAULT 'AUTO';
