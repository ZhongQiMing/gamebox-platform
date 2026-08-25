-- 挂了总代的房间，可见性必须整个总代一起放、一起收。
--
-- 只放开名下一半房间时，总监拉出来的总代账期总表会缺掉另一半的流水与月费，
-- 照着那个数跟总代结账必然算错。存量数据这里一次性拉齐。
--
-- 取并集：某总监只要能看见该总代名下任意一间房，就补齐看得见全部房间。
-- 不用交集，避免有人突然丢掉本来看得见的房。
--
-- 别名避开 grant / room 这类保留字与表名同名，否则 PostgreSQL 会在解析处报错。
INSERT INTO "RoomOwnerGrant" ("id", "roomId", "ownerId", "createdAt")
SELECT
  gen_random_uuid()::text,
  r."id",
  g.owner_id,
  NOW()
FROM "Room" r
JOIN (
  SELECT DISTINCT gr."generalAgentId" AS general_id, og."ownerId" AS owner_id
  FROM "RoomOwnerGrant" og
  JOIN "Room" gr ON gr."id" = og."roomId"
  WHERE gr."generalAgentId" IS NOT NULL
) g ON g.general_id = r."generalAgentId"
WHERE r."generalAgentId" IS NOT NULL
ON CONFLICT ("roomId", "ownerId") DO NOTHING;

-- 补齐后，凡是已有总监可见的总代房间，就不该再挂在管理名下当兜底
DELETE FROM "RoomOwnerGrant" ga
USING "Room" r, "User" u
WHERE ga."roomId" = r."id"
  AND ga."ownerId" = u."id"
  AND u."role" = 'ADMIN'
  AND r."generalAgentId" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "RoomOwnerGrant" bg
    JOIN "User" bu ON bu."id" = bg."ownerId"
    WHERE bg."roomId" = r."id" AND bu."role" = 'BRANCH'
  );
