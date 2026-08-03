-- 彩票开奖页码（nonce），供控奖后复算：SHA256(serverSeed:server:nonce)
ALTER TABLE "LotteryIssue" ADD COLUMN IF NOT EXISTS "nonce" INTEGER;
