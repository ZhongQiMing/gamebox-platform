-- 软控介入留痕
--
-- 改成独立候选种子之后，开奖结果里已经没有任何「被改过」的痕迹了——对外查不出来是
-- 我们要的，但内部也查不出来就成了问题：事后既无法自证清白，也无法排查是否被人为操纵。
-- 这张表补上内部痕迹，只有 ADMIN 能读。
--
-- 只在放弃自然结果时写一行：分母（总局数）从 GameRound / LotteryIssue 拿，
-- 介入率照样算得出来，行数不会被每一次转轮撑爆。
CREATE TABLE "SoftControlAudit" (
  "id"            TEXT NOT NULL,
  "category"      TEXT NOT NULL,
  "gameCode"      TEXT NOT NULL,
  "refNo"         TEXT NOT NULL,
  "refId"         TEXT,
  "reason"        TEXT NOT NULL,
  "tries"         INTEGER NOT NULL DEFAULT 0,
  "naturalDigest" TEXT,
  "adoptedDigest" TEXT,
  "stake"         DECIMAL(18,2) NOT NULL DEFAULT 0,
  "estPayout"     DECIMAL(18,2) NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SoftControlAudit_pkey" PRIMARY KEY ("id")
);

-- 同一局重复写入直接撞唯一键，天然幂等
CREATE UNIQUE INDEX "SoftControlAudit_category_refNo_key"
  ON "SoftControlAudit" ("category", "refNo");

CREATE INDEX "SoftControlAudit_createdAt_idx"
  ON "SoftControlAudit" ("createdAt");

CREATE INDEX "SoftControlAudit_category_gameCode_createdAt_idx"
  ON "SoftControlAudit" ("category", "gameCode", "createdAt");
