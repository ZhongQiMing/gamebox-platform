-- 房间级玩家挂靠（与全局 User.parentId 组织树分离）
CREATE TABLE "RoomPlayerHang" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "hangPath" TEXT NOT NULL DEFAULT '/',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomPlayerHang_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoomPlayerHang_roomId_playerId_key" ON "RoomPlayerHang"("roomId", "playerId");
CREATE INDEX "RoomPlayerHang_roomId_parentId_idx" ON "RoomPlayerHang"("roomId", "parentId");
CREATE INDEX "RoomPlayerHang_roomId_hangPath_idx" ON "RoomPlayerHang"("roomId", "hangPath");

ALTER TABLE "RoomPlayerHang" ADD CONSTRAINT "RoomPlayerHang_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomPlayerHang" ADD CONSTRAINT "RoomPlayerHang_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoomPlayerHang" ADD CONSTRAINT "RoomPlayerHang_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 回填：已进房且有全局上级的玩家，按房复制一份（上级须同房成员或本房代理）
INSERT INTO "RoomPlayerHang" ("id", "roomId", "playerId", "parentId", "hangPath", "depth", "createdAt", "updatedAt")
SELECT
  md5(rm."roomId" || ':' || rm."playerId" || ':hang') AS "id",
  rm."roomId",
  rm."playerId",
  u."parentId",
  CASE
    WHEN u."agentPath" IS NULL OR u."agentPath" = '' THEN '/'
    ELSE u."agentPath"
  END AS "hangPath",
  COALESCE(u."depth", 0) AS "depth",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "RoomMember" rm
JOIN "User" u ON u."id" = rm."playerId"
JOIN "Room" r ON r."id" = rm."roomId"
LEFT JOIN "Agent" oa ON oa."id" = r."ownerAgentId"
WHERE rm."status" = 'APPROVED'
  AND u."role" = 'PLAYER'
  AND u."parentId" IS NOT NULL
  AND (
    EXISTS (
      SELECT 1 FROM "RoomMember" pm
      WHERE pm."roomId" = rm."roomId"
        AND pm."playerId" = u."parentId"
        AND pm."status" = 'APPROVED'
    )
    OR oa."userId" = u."parentId"
  )
ON CONFLICT ("roomId", "playerId") DO NOTHING;
