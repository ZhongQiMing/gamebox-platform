export async function acceptLoginRole(
  role: string,
  acceptsRole: (role: string) => boolean,
  clearServerSession: () => Promise<unknown>,
): Promise<boolean> {
  if (acceptsRole(role)) return true
  try {
    await clearServerSession()
  } catch {
    /* 登录入口不匹配时仍按不存在展示，但必须等清理请求落定后才允许下一次提交。 */
  }
  return false
}
