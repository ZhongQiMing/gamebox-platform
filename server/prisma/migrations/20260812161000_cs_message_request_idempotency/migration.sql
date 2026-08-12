CREATE TABLE "CsMessageRequest" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "playerMessageId" TEXT NOT NULL,
    "systemMessageId" TEXT,
    "rechargeOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsMessageRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CsMessageRequest_playerId_clientRequestId_key"
ON "CsMessageRequest"("playerId", "clientRequestId");

CREATE INDEX "CsMessageRequest_playerMessageId_idx"
ON "CsMessageRequest"("playerMessageId");

CREATE INDEX "CsMessageRequest_systemMessageId_idx"
ON "CsMessageRequest"("systemMessageId");

CREATE INDEX "CsMessageRequest_rechargeOrderId_idx"
ON "CsMessageRequest"("rechargeOrderId");

ALTER TABLE "CsMessageRequest"
ADD CONSTRAINT "CsMessageRequest_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
