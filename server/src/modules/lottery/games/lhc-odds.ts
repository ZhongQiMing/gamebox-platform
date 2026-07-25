/**
 * 幸运六合彩 · 赔率表
 * 【赔率唯一来源】改赔率只改本文件；seed 写入 GameConfig；H5 经 /pay-table 拉取覆盖展示。
 * 禁止在 seed / H5 再维护第二份数字。
 *
 * 数值 = 含本金返还倍数，按各玩法命中率标定到 RTP≈96%。
 * 改动后必须跑 `node scripts/rtp-audit.cjs lhc`，任何一项 >100% 都是平台负期望。
 */
export const LHC_ODDS = {
  /* 特码大/单含 49，占 25/49；小/双占 24/49，两边赔率必须区分 */
  big: 1.88,
  small: 1.96,
  odd: 1.88,
  even: 1.96,
  special: 47,
  zhengma: 7.8,
  combo: 3.7,
  colorRed: 2.823,
  colorBlue: 3.003,
  colorGreen: 3.003,
  zodiac: 11.75,
  zodiacYear: 9.55,
  pingTe: 2,
  pingTeYear: 1.73,
  weiShu0: 2,
  weiShu: 1.8,
  weiShuMiss0: 1.81,
  weiShuMiss: 2.15,
  heSide: 1.95,
  weiSide: 1.88,
  weiSideSmall: 1.96,
  sumSide: 1.95,
  sumTail: 1.96,
  liuxiao: 1.95,
  erQuanZhong: 75,
  erZhongTe: 63.5,
  erZhongTeTe: 29,
  teChuan: 188,
  sanQuanZhong: 880,
  sanZhongEr: 23,
  sanZhongSan: 139,
  /* 连肖按非本命肖（4 号/肖）标定；「不中」命中率远高于「连中」，不可共用赔率 */
  sxLianZhong2: 4.68,
  sxLianZhong3: 11.9,
  sxLianZhong4: 34.8,
  sxLianZhong5: 123,
  sxLianBuZhong2: 3.66,
  sxLianBuZhong3: 8,
  sxLianBuZhong4: 19.3,
  sxLianBuZhong5: 52.8,
  /* 连尾按 1-9 尾（5 号/尾）标定 */
  wsLianZhong2: 3.34,
  wsLianZhong3: 7.04,
  wsLianZhong4: 16.6,
  wsLianBuZhong2: 5.36,
  wsLianBuZhong3: 15.3,
  wsLianBuZhong4: 52.8,
  buZhong5: 2.15,
  buZhong6: 2.55,
  buZhong7: 3.05,
  buZhong8: 3.66,
  buZhong9: 4.42,
  buZhong10: 5.36,
  buZhong11: 6.53,
  buZhong12: 8,
} as const;

export function lhcPayTableSeed(): Record<string, { multiplier: number; desc: string }> {
  const o = LHC_ODDS;
  return {
    refund: { multiplier: 1, desc: '和局退本' },
    big: { multiplier: o.big, desc: '特码大（25-49，含49）' },
    small: { multiplier: o.small, desc: '特码小（1-24）' },
    odd: { multiplier: o.odd, desc: '特码单（含49）' },
    even: { multiplier: o.even, desc: '特码双' },
    special: { multiplier: o.special, desc: '特码号码' },
    zhengma: { multiplier: o.zhengma, desc: '正码号码' },
    combo: { multiplier: o.combo, desc: '特码大单/大双/小单/小双' },
    colorRed: { multiplier: o.colorRed, desc: '红波' },
    colorBlue: { multiplier: o.colorBlue, desc: '蓝波' },
    colorGreen: { multiplier: o.colorGreen, desc: '绿波' },
    zodiac: { multiplier: o.zodiac, desc: '特肖（非本命）' },
    zodiacYear: { multiplier: o.zodiacYear, desc: '特肖（本命）' },
    pingTe: { multiplier: o.pingTe, desc: '一肖/平特（非本命）' },
    pingTeYear: { multiplier: o.pingTeYear, desc: '一肖/平特（本命）' },
    weiShu0: { multiplier: o.weiShu0, desc: '0尾' },
    weiShu: { multiplier: o.weiShu, desc: '1-9尾' },
    weiShuMiss0: { multiplier: o.weiShuMiss0, desc: '0尾不中' },
    weiShuMiss: { multiplier: o.weiShuMiss, desc: '1-9尾不中' },
    heSide: { multiplier: o.heSide, desc: '合数两面' },
    weiSide: { multiplier: o.weiSide, desc: '特尾大' },
    weiSideSmall: { multiplier: o.weiSideSmall, desc: '特尾小' },
    sumSide: { multiplier: o.sumSide, desc: '总和两面' },
    sumTail: { multiplier: o.sumTail, desc: '总尾大小' },
    liuxiao: { multiplier: o.liuxiao, desc: '六肖' },
    erQuanZhong: { multiplier: o.erQuanZhong, desc: '二全中' },
    erZhongTe: { multiplier: o.erZhongTe, desc: '二中特·中二' },
    erZhongTeTe: { multiplier: o.erZhongTeTe, desc: '二中特·中特' },
    teChuan: { multiplier: o.teChuan, desc: '特串' },
    sanQuanZhong: { multiplier: o.sanQuanZhong, desc: '三全中' },
    sanZhongEr: { multiplier: o.sanZhongEr, desc: '三中二·中二' },
    sanZhongSan: { multiplier: o.sanZhongSan, desc: '三中二·中三' },
    sxLianZhong2: { multiplier: o.sxLianZhong2, desc: '二肖中' },
    sxLianZhong3: { multiplier: o.sxLianZhong3, desc: '三肖中' },
    sxLianZhong4: { multiplier: o.sxLianZhong4, desc: '四肖中' },
    sxLianZhong5: { multiplier: o.sxLianZhong5, desc: '五肖中' },
    sxLianBuZhong2: { multiplier: o.sxLianBuZhong2, desc: '二肖不中' },
    sxLianBuZhong3: { multiplier: o.sxLianBuZhong3, desc: '三肖不中' },
    sxLianBuZhong4: { multiplier: o.sxLianBuZhong4, desc: '四肖不中' },
    sxLianBuZhong5: { multiplier: o.sxLianBuZhong5, desc: '五肖不中' },
    wsLianZhong2: { multiplier: o.wsLianZhong2, desc: '二尾中' },
    wsLianZhong3: { multiplier: o.wsLianZhong3, desc: '三尾中' },
    wsLianZhong4: { multiplier: o.wsLianZhong4, desc: '四尾中' },
    wsLianBuZhong2: { multiplier: o.wsLianBuZhong2, desc: '二尾不中' },
    wsLianBuZhong3: { multiplier: o.wsLianBuZhong3, desc: '三尾不中' },
    wsLianBuZhong4: { multiplier: o.wsLianBuZhong4, desc: '四尾不中' },
    buZhong5: { multiplier: o.buZhong5, desc: '五不中' },
    buZhong6: { multiplier: o.buZhong6, desc: '六不中' },
    buZhong7: { multiplier: o.buZhong7, desc: '七不中' },
    buZhong8: { multiplier: o.buZhong8, desc: '八不中' },
    buZhong9: { multiplier: o.buZhong9, desc: '九不中' },
    buZhong10: { multiplier: o.buZhong10, desc: '十不中' },
    buZhong11: { multiplier: o.buZhong11, desc: '十一不中' },
    buZhong12: { multiplier: o.buZhong12, desc: '十二不中' },
  };
}

/** 春节公历日起：此前仍算上一年生肖 */
const CNY: Array<[number, number, number, string]> = [
  [2023, 1, 22, '兔'],
  [2024, 2, 10, '龙'],
  [2025, 1, 29, '蛇'],
  [2026, 2, 17, '马'],
  [2027, 2, 6, '羊'],
  [2028, 1, 26, '猴'],
  [2029, 2, 13, '鸡'],
  [2030, 2, 3, '狗'],
  [2031, 1, 23, '猪'],
  [2032, 2, 11, '鼠'],
  [2033, 1, 31, '牛'],
  [2034, 2, 19, '虎'],
  [2035, 2, 8, '兔'],
  [2036, 1, 28, '龙'],
];

const ZODIAC_CYCLE = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'] as const;

export function yearZodiacAt(date = new Date()): string {
  /* 农历春节切肖必须用上海日历，避免服务器 UTC 导致特肖/平特错年 */
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || '1');
  const y = get('year');
  const m = get('month');
  const d = get('day');
  let cur = '马';
  for (const [yy, mm, dd, z] of CNY) {
    if (y > yy || (y === yy && (m > mm || (m === mm && d >= dd)))) cur = z;
  }
  return cur;
}

/** 号码 1 → 本命生肖，依次倒推（港彩公式） */
export function zodiacOrderForYear(yearZ: string): string[] {
  const idx = ZODIAC_CYCLE.indexOf(yearZ as (typeof ZODIAC_CYCLE)[number]);
  const start = idx >= 0 ? idx : ZODIAC_CYCLE.indexOf('马');
  const out: string[] = [];
  for (let i = 0; i < 12; i++) out.push(ZODIAC_CYCLE[(start - i + 12) % 12]);
  return out;
}

export function zodiacOfNum(n: number, yearZ = yearZodiacAt()): string {
  const order = zodiacOrderForYear(yearZ);
  return order[(n - 1) % 12];
}

const RED = [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46];
const BLUE = [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48];

export function waveColorOf(n: number): '红' | '蓝' | '绿' {
  if (RED.includes(n)) return '红';
  if (BLUE.includes(n)) return '蓝';
  return '绿';
}
