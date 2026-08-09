import type { Prisma } from '@prisma/client';
import { AVATAR_TOTAL, avatarPath } from './avatar-pool';

type Tx = Prisma.TransactionClient;

/**
 * 头像按轮次不重复：本轮 162 张各用一次（顺序随机），用完进入下一轮。
 * 须在已有事务内调用（配合 FOR UPDATE）。
 */
export async function pickAvatarUniqueInTx(tx: Tx): Promise<string> {
  await tx.$executeRaw`INSERT INTO "AvatarAssignState" ("id", "round", "usedJson", "updatedAt")
    VALUES (1, 1, '[]', CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO NOTHING`;

  const rows = await tx.$queryRaw<Array<{ round: number; usedJson: string }>>`
    SELECT "round", "usedJson" FROM "AvatarAssignState" WHERE "id" = 1 FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new Error('头像分配状态缺失');

  let round = row.round;
  let used: number[] = [];
  try {
    const parsed = JSON.parse(row.usedJson || '[]');
    if (Array.isArray(parsed)) {
      used = parsed.map(Number).filter((n) => n >= 1 && n <= AVATAR_TOTAL);
    }
  } catch {
    used = [];
  }

  if (used.length >= AVATAR_TOTAL) {
    round += 1;
    used = [];
  }

  const usedSet = new Set(used);
  const available: number[] = [];
  for (let i = 1; i <= AVATAR_TOTAL; i++) {
    if (!usedSet.has(i)) available.push(i);
  }
  const pick = available[Math.floor(Math.random() * available.length)]!;
  used.push(pick);

  await tx.avatarAssignState.update({
    where: { id: 1 },
    data: { round, usedJson: JSON.stringify(used) },
  });

  return avatarPath(pick);
}
