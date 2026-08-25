import { UserRole } from './enums';

const LABELS: Record<string, string> = {
  ADMIN: '管理',
  BRANCH: '总监',
  GENERAL: '总代',
  AGENT: '代理',
  PROXY: '子账号',
  CS: '客服',
  PLAYER: '玩家',
};

export function staffRoleLabel(
  role: string | null | undefined,
  parentRole?: string | null,
): string {
  if (!role) return '';
  if (role === 'PROXY' && parentRole === 'GENERAL') return '总代子账号';
  if (role === 'PROXY' && parentRole === 'AGENT') return '代理子账号';
  return LABELS[role] || role;
}

export const PLATFORM_ROLES = ['ADMIN', 'BRANCH'] as const;
export const ROOM_OPERATOR_ROLES = ['GENERAL', 'AGENT', 'PROXY'] as const;

export function isPlatformStaff(role: string | null | undefined): boolean {
  return role === UserRole.ADMIN || role === UserRole.BRANCH;
}

export function isGeneralAgent(role: string | null | undefined): boolean {
  return role === 'GENERAL';
}

/** 总代本人，或挂在总代下的子账号（分身，与总代同权） */
export function isGeneralSide(
  role?: string | null,
  parentRole?: string | null,
): boolean {
  if (role === 'GENERAL') return true;
  return role === 'PROXY' && parentRole === 'GENERAL';
}

/** 房间代理本人，或挂在代理下的子账号（只读帮手）。PROXY 未带回 parentRole 时按房间代理处理 */
export function isRoomAgentSide(
  role?: string | null,
  parentRole?: string | null,
): boolean {
  if (role === 'AGENT') return true;
  return role === 'PROXY' && parentRole !== 'GENERAL';
}

/** 路由/菜单：写了 GENERAL 的入口，总代子账号同样能进 */
export function staffMatchesRoles(
  role: string | null | undefined,
  roles: string[],
  parentRole?: string | null,
): boolean {
  if (!role) return false;
  if (roles.includes(role)) return true;
  return roles.includes('GENERAL') && isGeneralSide(role, parentRole);
}
