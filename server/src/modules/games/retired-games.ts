/**
 * 已退役游戏码：代码早已移除，但旧库里可能还留着 Game 行。
 *
 * 后台列表原来自己藏了一份名单，玩家端大厅却只按 status 过滤——
 * 只要有人手滑把这些行改回 ONLINE，大厅就会冒出一个没有引擎的游戏，
 * 进去下注会直接打到 SLOT 引擎上（payTable 形状对不上会当场崩）。
 * 名单收在这里，各处共用。
 */
export const RETIRED_GAME_CODES = ['slots-mahjong', 'mahjong', 'slots'] as const;

export function isRetiredGameCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return (RETIRED_GAME_CODES as readonly string[]).includes(code.trim());
}
