-- 日账佣金估算已绑定回水规则 RebatePolicy.totalRate，删除误导字段
ALTER TABLE "GlobalSoftControl" DROP COLUMN IF EXISTS "commissionRatePct";
