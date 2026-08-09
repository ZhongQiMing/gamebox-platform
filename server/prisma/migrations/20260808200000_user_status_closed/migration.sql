-- 玩家自助注销状态。
--
-- 不硬删 User：Bet / RechargeOrder / CommissionRecord / RebateRecord /
-- ActivityClaim 对 User 都是 RESTRICT，且这些是资金凭证，本就不该删。
-- 注销 = 置 CLOSED + 清个人信息 + 作废登录态，账目原样保留。
--
-- 与 DISABLED 分开是为了让后台能区分「运营封禁」和「用户自己注销」。

ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'CLOSED';
