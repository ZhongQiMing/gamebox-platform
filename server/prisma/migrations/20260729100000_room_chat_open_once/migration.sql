-- 系统卡防重：纳入 open（开盘线）
DROP INDEX IF EXISTS "RoomChatMessage_system_once_key";
CREATE UNIQUE INDEX IF NOT EXISTS "RoomChatMessage_system_once_key"
ON "RoomChatMessage" ("roomId", "gameCode", "kind", "issueNo")
WHERE kind IN ('close', 'open', 'result', 'bet_verify', 'win_verify');
