-- 玩家积分按房分账：PointsAccount 增加 roomId；PLAYER 一人一房一账
-- 非 PLAYER（代理/客服/平台等）roomId 固定为空串 ''

ALTER TABLE "PointsAccount" ADD COLUMN "roomId" TEXT NOT NULL DEFAULT '';

-- 存量 PLAYER：余额归入最近更新的 APPROVED 房间；无房则暂留 ''
UPDATE "PointsAccount" AS pa
SET "roomId" = sub."roomId"
FROM (
  SELECT DISTINCT ON (rm."playerId")
    rm."playerId" AS "playerId",
    rm."roomId" AS "roomId"
  FROM "RoomMember" rm
  WHERE rm."status" = 'APPROVED'
  ORDER BY rm."playerId", rm."updatedAt" DESC
) AS sub
WHERE pa."ownerType" = 'PLAYER'
  AND pa."ownerId" = sub."playerId";

DROP INDEX IF EXISTS "PointsAccount_ownerId_key";

CREATE UNIQUE INDEX "PointsAccount_ownerType_ownerId_roomId_key"
  ON "PointsAccount"("ownerType", "ownerId", "roomId");

CREATE INDEX "PointsAccount_ownerType_roomId_idx"
  ON "PointsAccount"("ownerType", "roomId");

-- 上下分申请单绑定运营房间
ALTER TABLE "RechargeOrder" ADD COLUMN "roomId" TEXT;

CREATE INDEX "RechargeOrder_roomId_idx" ON "RechargeOrder"("roomId");
