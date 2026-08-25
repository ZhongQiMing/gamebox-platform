/** 连码中文玩法 → 赔率表主键（多档时取最高赔那档来限红） */
const LIANMA_LIMIT_KEY: Record<string, string> = {
  四全中: 'siQuanZhong',
  三全中: 'sanQuanZhong',
  三中二: 'sanZhongSan',
  二全中: 'erQuanZhong',
  二中特: 'erZhongTeTe',
  特串: 'teChuan',
};

/** 把一注映射到赔率表 / 限红表上的玩法键 */
export function lotteryPlayLimitKey(
  betType: string,
  betValue: string | number | undefined,
  payTable: unknown,
): string {
  const table = payTable && typeof payTable === 'object' && !Array.isArray(payTable)
    ? (payTable as Record<string, unknown>)
    : {};
  if (betType === 'lianma') {
    try {
      const play = JSON.parse(String(betValue ?? ''))?.play;
      const key = typeof play === 'string' ? LIANMA_LIMIT_KEY[play] : undefined;
      if (key && table[key]) return key;
    } catch { /* 交给 validateBet */ }
  }
  if (betType === 'shape') {
    const shape = String(betValue ?? '').split(':')[1];
    if (shape && table[`shape_${shape}`]) return `shape_${shape}`;
  }
  if (betValue != null && String(betValue) !== '') {
    const compound = `${betType}_${betValue}`;
    if (table[compound]) return compound;
  }
  if (table[betType]) return betType;
  if (betType === 'dice' && table.dice1) return 'dice1';
  return betType;
}
