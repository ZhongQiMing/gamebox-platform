-- 客服角色 + 档案表
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'CS';
ALTER TYPE "AccountOwnerType" ADD VALUE IF NOT EXISTS 'CS';

CREATE TABLE IF NOT EXISTS "CsStaff" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "parentAgentUserId" TEXT NOT NULL,
  "wageRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "idleWeight" INTEGER NOT NULL DEFAULT 100,
  "workStatus" TEXT NOT NULL DEFAULT 'REST',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CsStaff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CsStaff_userId_key" ON "CsStaff"("userId");
CREATE INDEX IF NOT EXISTS "CsStaff_parentAgentUserId_workStatus_idx" ON "CsStaff"("parentAgentUserId", "workStatus");

DO $$ BEGIN
  ALTER TABLE "CsStaff" ADD CONSTRAINT "CsStaff_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
