-- 拉平历史漂移：schema 里 totalRate 默认值早已改成 7%（总代整包默认），
-- 但没有对应迁移，空库跑完 migrate deploy 后列默认值仍是 5%，
-- 导致 `prisma migrate diff` 始终报差异，真正的 schema 变更会被淹没在噪音里。
-- 只改列默认值，不动已有数据。
ALTER TABLE "RebatePolicy" ALTER COLUMN "totalRate" SET DEFAULT 0.07;
