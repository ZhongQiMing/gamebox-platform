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

export function staffRoleLabel(role: string | null | undefined): string {
  if (!role) return '';
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
