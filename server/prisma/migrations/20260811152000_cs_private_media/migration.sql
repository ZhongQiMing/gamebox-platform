CREATE TABLE "CsUpload" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "playerId" TEXT,
    "policy" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "attachedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CsUpload_storageKey_key" ON "CsUpload"("storageKey");
CREATE INDEX "CsUpload_ownerId_createdAt_idx" ON "CsUpload"("ownerId", "createdAt");
CREATE INDEX "CsUpload_playerId_createdAt_idx" ON "CsUpload"("playerId", "createdAt");
CREATE INDEX "CsUpload_attachedAt_createdAt_idx" ON "CsUpload"("attachedAt", "createdAt");
CREATE INDEX "CsUpload_expiresAt_idx" ON "CsUpload"("expiresAt");

ALTER TABLE "CsUpload"
ADD CONSTRAINT "CsUpload_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CsUpload"
ADD CONSTRAINT "CsUpload_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
