-- Agent.flyCover 自 2026-08-09 起就没有任何代码写入，只被读出来展示，
-- 而真正做飞/关判断的是另一套算法，两者长期不一致，是排查故障时的主要误导源。
-- 现在「可飞额度」改为实时计算（代理盘分 + 客服未发出 + 名下房间玩家持分，
-- 见 credit-settle.helper.ts 的 agentFlyAvailable），不再需要存储列。
-- 列里残留的 11 个值都是 8/9 之前的旧语义，保留没有意义。
ALTER TABLE "Agent" DROP COLUMN IF EXISTS "flyCover";
