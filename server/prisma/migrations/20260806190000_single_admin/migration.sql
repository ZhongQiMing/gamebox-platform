-- 全站有且仅有一名 ADMIN（部分唯一索引）
CREATE UNIQUE INDEX IF NOT EXISTS "User_single_admin_role"
ON "User" ("role")
WHERE "role" = 'ADMIN';
