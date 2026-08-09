-- 对齐 schema.prisma 与迁移历史之间残留的列默认值漂移。
-- 这些差异只存在于「纯迁移建出来的库」（= 生产），开发库因为用过 db push 已经是对的，
-- 所以本地看不出来，上线才会踩：
--   Game.maxBet            迁移里是 1000000，schema 是 100000（默认限红差 10 倍）
--   ControlPolicy.strength 迁移里是 0.5，schema 是 1
--   GlobalSoftControl.candidateTries 迁移里是 10，schema 是 8
--   AvatarAssignState.id   迁移里无默认值，schema 是 1（Prisma 建行时不传 id，会 NOT NULL 报错）
-- 另外几处 updatedAt 的 DEFAULT CURRENT_TIMESTAMP 是 schema 里没有的，一并去掉；
-- 现有写入方（Prisma @updatedAt 与各迁移/脚本的 INSERT）都会显式带上该列。
-- 全部是 catalog 层面的元数据改动，不重写数据、不长时间持锁。

-- AlterTable
ALTER TABLE "Game" ALTER COLUMN "maxBet" SET DEFAULT 100000;

-- AlterTable
ALTER TABLE "ControlPolicy" ALTER COLUMN "strength" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "GlobalSoftControl" ALTER COLUMN "candidateTries" SET DEFAULT 8,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AvatarAssignState" ALTER COLUMN "id" SET DEFAULT 1,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CommissionDebt" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "GlobalSoftBias" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "RoomPlayerHang" ALTER COLUMN "updatedAt" DROP DEFAULT;
