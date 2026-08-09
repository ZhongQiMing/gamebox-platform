-- CreateTable
CREATE TABLE "CsDeskSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quickReplies" JSONB NOT NULL DEFAULT '[]',
    "wechatQrs" JSONB NOT NULL DEFAULT '[]',
    "alipayQrs" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsDeskSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CsDeskSetting_userId_key" ON "CsDeskSetting"("userId");

-- AddForeignKey
ALTER TABLE "CsDeskSetting" ADD CONSTRAINT "CsDeskSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
