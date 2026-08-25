-- 下注热路径索引
--
-- 每笔下注都要在事务里做两次「只看自己」的查询：
--   1) 对冲互斥：本局本人是否已押对立方向
--   2) 个人单边累计：本局本人这一方向已押多少
-- 现有索引只有 (roundId, status)，一局上千注时这两次查询要把整局的注单
-- 全捞出来再逐行过滤，且这段查询正好在下注临界区里。
-- 加上 playerId 后直接定位到本人那几笔。
CREATE INDEX IF NOT EXISTS "Bet_roundId_playerId_status_idx"
  ON "Bet" ("roundId", "playerId", "status");
