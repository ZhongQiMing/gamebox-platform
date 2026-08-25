-- 总监 ↔ 总代 可见性授权表
CREATE TABLE "GeneralOwnerGrant" (
    "id" TEXT NOT NULL,
    "generalAgentId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneralOwnerGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeneralOwnerGrant_generalAgentId_ownerId_key"
    ON "GeneralOwnerGrant"("generalAgentId", "ownerId");

CREATE INDEX "GeneralOwnerGrant_ownerId_idx" ON "GeneralOwnerGrant"("ownerId");

ALTER TABLE "GeneralOwnerGrant"
    ADD CONSTRAINT "GeneralOwnerGrant_generalAgentId_fkey"
    FOREIGN KEY ("generalAgentId") REFERENCES "Agent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeneralOwnerGrant"
    ADD CONSTRAINT "GeneralOwnerGrant_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 存量回填：现有总代对现有总监一律可见，保持升级前的行为不变。
-- 收紧只对「以后新建的总代」按勾选生效，管理员也可以事后手工撤销。
INSERT INTO "GeneralOwnerGrant" ("id", "generalAgentId", "ownerId", "createdAt")
SELECT
    'gog_' || md5(ag."id" || ':' || b."id"),
    ag."id",
    b."id",
    CURRENT_TIMESTAMP
FROM "Agent" ag
JOIN "User" gu ON gu."id" = ag."userId" AND gu."role" = 'GENERAL'
CROSS JOIN "User" b
WHERE b."role" = 'BRANCH'
ON CONFLICT ("generalAgentId", "ownerId") DO NOTHING;
