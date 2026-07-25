/** 玩家头像池：001～162（022/078/086 为 png）；按「轮次」不重复分配 */

export const AVATAR_TOTAL = 162;
const PNG_IDX = new Set([22, 78, 86]);

export function avatarPath(idx: number): string {
  const n = Math.floor(idx);
  if (n < 1 || n > AVATAR_TOTAL) {
    throw new Error(`头像序号越界: ${idx}`);
  }
  const ext = PNG_IDX.has(n) ? 'png' : 'jpg';
  return `/images/avatars/${String(n).padStart(3, '0')}.${ext}`;
}

/** 从路径解析序号；非法返回 null */
export function avatarIndexFromPath(path: string | null | undefined): number | null {
  if (!path) return null;
  const m = String(path).match(/\/avatars\/(\d{3})\.(?:jpg|png)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > AVATAR_TOTAL) return null;
  return n;
}
