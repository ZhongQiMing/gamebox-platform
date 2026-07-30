/**
 * 纯函数校验 —— 从原型 common.js 迁移。
 * 仅用于前端即时提示；后端必须独立再校验一遍（安全）。
 */

import { roundMoney } from './money';

/** 账号：8-20 位、英文+数字、且两者都要有。返回 null=通过 */
export function validateAccount(account: string): string | null {
  if (!account) return '请输入账号';
  if (account.length < 8) return '账号至少 8 位';
  if (account.length > 20) return '账号最多 20 位';
  if (!/^[A-Za-z0-9]+$/.test(account)) return '账号只能包含英文字母和数字';
  if (!/[A-Za-z]/.test(account)) return '账号必须包含英文字母';
  if (!/[0-9]/.test(account)) return '账号必须包含数字';
  return null;
}

/** 密码：6-30 位 */
export function validatePassword(password: string): string | null {
  if (!password) return '请输入密码';
  if (password.length < 6) return '密码至少 6 位';
  if (password.length > 30) return '密码最多 30 位';
  return null;
}

/** 金额：正数，最多两位小数（与账本 Decimal(18,2) 一致） */
export function validateAmount(amount: number): string | null {
  if (!Number.isFinite(amount)) return '金额无效';
  if (amount <= 0) return '金额必须大于 0';
  if (Math.abs(roundMoney(amount) - amount) > 1e-9) return '金额最多两位小数';
  return null;
}

/** 服务端/引擎快速校验：正金额且两位小数 */
export function isValidMoney(amount: number, min = 0.01): boolean {
  return Number.isFinite(amount) && amount >= min && Math.abs(roundMoney(amount) - amount) < 1e-9;
}
