-- 注册身份：昵称全站唯一 + 头像轮次分配状态

-- 1) 先消解已有重复昵称（保留最早一条，其余追加 uid 后缀）
UPDATE "User" u
SET nickname = left(u.nickname, 20) || '_' || right(u.uid, 4)
WHERE u.id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY nickname ORDER BY "createdAt" ASC) AS rn
    FROM "User"
  ) t
  WHERE t.rn > 1
);

-- 极少数仍冲突时再强制唯一
UPDATE "User" u
SET nickname = '玩家' || right(u.uid, 6)
WHERE u.id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY nickname ORDER BY "createdAt" ASC) AS rn
    FROM "User"
  ) t
  WHERE t.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_nickname_key" ON "User"("nickname");

-- 2) 头像轮次状态表
CREATE TABLE IF NOT EXISTS "AvatarAssignState" (
  "id" INTEGER NOT NULL,
  "round" INTEGER NOT NULL DEFAULT 1,
  "usedJson" TEXT NOT NULL DEFAULT '[]',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AvatarAssignState_pkey" PRIMARY KEY ("id")
);

-- 3) 按现有玩家头像占用情况初始化轮次
-- round = max(各头像出现次数, 1)；本轮 used = 出现次数 == round 的头像序号
DO $$
DECLARE
  max_cnt INT;
  used_arr INT[];
BEGIN
  SELECT COALESCE(MAX(cnt), 0) INTO max_cnt
  FROM (
    SELECT COUNT(*)::INT AS cnt
    FROM "User"
    WHERE avatar ~ '/avatars/[0-9]{3}\\.(jpg|png)$'
    GROUP BY substring(avatar from '/avatars/([0-9]{3})\\.')
  ) s;

  IF max_cnt < 1 THEN
    max_cnt := 1;
    used_arr := ARRAY[]::INT[];
  ELSE
    SELECT COALESCE(array_agg(idx ORDER BY idx), ARRAY[]::INT[]) INTO used_arr
    FROM (
      SELECT substring(avatar from '/avatars/([0-9]{3})\\.')::INT AS idx,
             COUNT(*)::INT AS cnt
      FROM "User"
      WHERE avatar ~ '/avatars/[0-9]{3}\\.(jpg|png)$'
      GROUP BY 1
    ) t
    WHERE t.cnt >= max_cnt;
  END IF;

  INSERT INTO "AvatarAssignState" ("id", "round", "usedJson", "updatedAt")
  VALUES (1, max_cnt, COALESCE(to_json(used_arr)::text, '[]'), CURRENT_TIMESTAMP)
  ON CONFLICT ("id") DO UPDATE
  SET "round" = EXCLUDED."round",
      "usedJson" = EXCLUDED."usedJson",
      "updatedAt" = CURRENT_TIMESTAMP;
END $$;
