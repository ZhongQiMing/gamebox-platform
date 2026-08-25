-- 工作台/报表按 status + createdAt 扫 Bet；原先只有 (status, settledAt)，未结算或按下注日统计会全表扫。
CREATE INDEX "Bet_status_createdAt_idx" ON "Bet"("status", "createdAt");

-- 按房归因走 payload.fly.roomId + 时间窗；表达式索引避免 JSON 全表扫。
CREATE INDEX "Bet_flyRoomId_createdAt_idx"
ON "Bet" ((payload->'fly'->>'roomId'), "createdAt")
WHERE payload->'fly'->>'roomId' IS NOT NULL;
