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

/**
 * 密码强度。
 *
 * 原来只卡 6～30 位，`111111` 就能过。这是个能提现的账号系统，
 * 撞库脚本对纯数字六位的成功率高得离谱，所以要求字母+数字混合。
 * 不强制大小写与符号：门槛再往上抬，玩家改成「把密码写在便签上」，反而更糟。
 */
export const PASSWORD_MIN_LEN = 8;
/** 运营账号（代理/客服/子账号）由后台创建，可以要求更长 */
export const OPS_PASSWORD_MIN_LEN = 10;
export const PASSWORD_MAX_LEN = 30;
export const PLAYER_PASSWORD_HINT = `至少 ${PASSWORD_MIN_LEN} 位，须含字母和数字`;
export const OPS_PASSWORD_HINT = `至少 ${OPS_PASSWORD_MIN_LEN} 位，须含字母和数字`;

function checkPassword(password: string, min: number, label: string): string | null {
  if (!password) return '请输入密码';
  if (password.length < min) return `${label}至少 ${min} 位`;
  if (password.length > PASSWORD_MAX_LEN) return `${label}最多 ${PASSWORD_MAX_LEN} 位`;
  if (!/[A-Za-z]/.test(password)) return `${label}必须包含英文字母`;
  if (!/[0-9]/.test(password)) return `${label}必须包含数字`;
  return null;
}

/** 玩家密码：8-30 位，字母+数字 */
export function validatePassword(password: string): string | null {
  return checkPassword(password, PASSWORD_MIN_LEN, '密码');
}

/** 运营账号密码：10-30 位，字母+数字 */
export function validateOpsPassword(password: string, label = '密码'): string | null {
  return checkPassword(password, OPS_PASSWORD_MIN_LEN, label);
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
