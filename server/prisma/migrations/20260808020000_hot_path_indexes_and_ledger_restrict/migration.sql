-- 1) 补高频查询缺失的索引
-- 2) 资金/审计类表的父行外键由 CASCADE 收紧为 RESTRICT
--
-- 关于锁：CREATE INDEX（非 CONCURRENTLY）会阻塞该表写入，ADD FOREIGN KEY 需要全表校验。
-- 本迁移面向上线前的空库/小库执行，成本接近 0；
-- 若在已有大量数据的库上补跑，请改用 CONCURRENTLY + NOT VALID/VALIDATE 手工执行
-- （Prisma 迁移在事务里跑，CONCURRENTLY 不能写在这里）。

-- ---------- 索引 ----------

-- Bet 此前没有任何 settledAt 索引：每日自助回水任务与共盘日账都按 settledAt 区间全表扫
CREATE INDEX IF NOT EXISTS "Bet_playerId_settledAt_idx" ON "Bet"("playerId", "settledAt");
CREATE INDEX IF NOT EXISTS "Bet_status_settledAt_idx" ON "Bet"("status", "settledAt");

-- RoomMember 只有 (playerId,*) 索引；而「按房拉成员」是客服台/报表/结算/风控的高频入口
CREATE INDEX IF NOT EXISTS "RoomMember_roomId_status_idx" ON "RoomMember"("roomId", "status");

-- 复合唯一首列是 ownerType，只给 ownerId 时用不上
CREATE INDEX IF NOT EXISTS "PointsAccount_ownerId_roomId_idx" ON "PointsAccount"("ownerId", "roomId");

-- 上下分：待审队列按时间倒序分页 + 按房资金报表 groupBy
CREATE INDEX IF NOT EXISTS "RechargeOrder_status_createdAt_idx" ON "RechargeOrder"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "RechargeOrder_roomId_status_createdAt_idx" ON "RechargeOrder"("roomId", "status", "createdAt");
-- 被上面的 (roomId, status, createdAt) 完全覆盖
DROP INDEX IF EXISTS "RechargeOrder_roomId_idx";

-- 报表按周期统计新增玩家
CREATE INDEX IF NOT EXISTS "User_role_createdAt_idx" ON "User"("role", "createdAt");

-- 超管全量日志列表无 where、只按时间倒序分页
CREATE INDEX IF NOT EXISTS "AdminLog_createdAt_idx" ON "AdminLog"("createdAt");

-- 跨房统计某上级的挂靠下级
CREATE INDEX IF NOT EXISTS "RoomPlayerHang_parentId_idx" ON "RoomPlayerHang"("parentId");

-- ---------- 外键：资金/审计流水禁止被父行连坐删除 ----------

ALTER TABLE "PointsLedger" DROP CONSTRAINT IF EXISTS "PointsLedger_accountId_fkey";
ALTER TABLE "PointsLedger" ADD CONSTRAINT "PointsLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PointsAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Bet" DROP CONSTRAINT IF EXISTS "Bet_playerId_fkey";
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RechargeOrder" DROP CONSTRAINT IF EXISTS "RechargeOrder_playerId_fkey";
ALTER TABLE "RechargeOrder" ADD CONSTRAINT "RechargeOrder_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommissionRecord" DROP CONSTRAINT IF EXISTS "CommissionRecord_beneficiaryId_fkey";
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommissionRecord" DROP CONSTRAINT IF EXISTS "CommissionRecord_sourceUserId_fkey";
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_sourceUserId_fkey" FOREIGN KEY ("sourceUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RebateRecord" DROP CONSTRAINT IF EXISTS "RebateRecord_playerId_fkey";
ALTER TABLE "RebateRecord" ADD CONSTRAINT "RebateRecord_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DailyRebateSettlement" DROP CONSTRAINT IF EXISTS "DailyRebateSettlement_playerId_fkey";
ALTER TABLE "DailyRebateSettlement" ADD CONSTRAINT "DailyRebateSettlement_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActivityClaim" DROP CONSTRAINT IF EXISTS "ActivityClaim_playerId_fkey";
ALTER TABLE "ActivityClaim" ADD CONSTRAINT "ActivityClaim_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AdminLog" DROP CONSTRAINT IF EXISTS "AdminLog_operatorId_fkey";
ALTER TABLE "AdminLog" ADD CONSTRAINT "AdminLog_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RoomWeekSettle" DROP CONSTRAINT IF EXISTS "RoomWeekSettle_roomId_fkey";
ALTER TABLE "RoomWeekSettle" ADD CONSTRAINT "RoomWeekSettle_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
