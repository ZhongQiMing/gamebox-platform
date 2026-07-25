-- 系统类房间消息（封盘/结果/注单核对/中奖核对）按期唯一，防并发双推

-- 1) 清理历史重复（保留最早一条）
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "roomId", "gameCode", kind, "issueNo"
           ORDER BY "createdAt" ASC, id ASC
         ) AS rn
  FROM "RoomChatMessage"
  WHERE kind IN ('close', 'result', 'bet_verify', 'win_verify')
    AND "issueNo" IS NOT NULL
)
DELETE FROM "RoomChatMessage"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) 部分唯一索引：仅约束系统 kind（下注 bet 可多条）
CREATE UNIQUE INDEX IF NOT EXISTS "RoomChatMessage_system_once_key"
ON "RoomChatMessage" ("roomId", "gameCode", "kind", "issueNo")
WHERE kind IN ('close', 'result', 'bet_verify', 'win_verify')
  AND "issueNo" IS NOT NULL;
