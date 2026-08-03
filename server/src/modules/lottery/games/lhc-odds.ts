/**
 * 幸运六合彩 · 赔率表
 * 【赔率唯一来源】改赔率只改本文件；seed 写入 GameConfig；H5 经 /pay-table 拉取覆盖展示。
 * 禁止在 seed / H5 再维护第二份数字。
 *
 * 数值对齐官方截图玩法表；改动后建议跑 `pnpm audit:rtp lhc`（截图赔率可能单项 >100% 告警）。
 */
export const LHC_ODDS = {
  /* 特码两面：官方约 1.98；特码 49 为和局退本（非大/单） */
  big: 1.98,
  small: 1.98,
  odd: 1.98,
  even: 1.98,
  special: 48.5,
  zhengma: 7.21,
  /** 正码特（正一特~正六特） */
  zhengTe: 48.5,
  combo: 3.7,
  /** 正码1~6 组合（大单等） */
  zhengCombo: 3.7,
  colorRed: 2.7,
  colorBlue: 2.9,
  colorGreen: 2.9,
  /* 半波 / 半半波见下方 LHC_COLOR_HALF_* 表（V66 盘面逐项） */
  zodiac: 11.3,
  zodiacYear: 9.3,
  pingTe: 2.07,
  pingTeYear: 1.79,
  weiShu0: 2.07,
  weiShu: 1.79,
  weiShuMiss0: 1.81,
  weiShuMiss: 2.15,
  heSide: 1.98,
  weiSide: 1.98,
  weiSideSmall: 1.98,
  /** 正码位两面/合/尾 */
  zhengSide: 1.98,
  zhengHe: 1.98,
  zhengWei: 1.98,
  zhengWeiSmall: 1.98,
  sumSide: 1.93,
  sumTail: 1.96,
  liuxiao: 1.95,
  /* 连码：V66 盘面（二中特/三中二为双赔率） */
  erQuanZhong: 60,
  erZhongTe: 50,
  erZhongTeTe: 25.5,
  teChuan: 150,
  sanQuanZhong: 670,
  sanZhongEr: 20,
  sanZhongSan: 100,
  siQuanZhong: 9000,
  /* 连肖：V66 二~五连肖（本命肖更低） */
  sxLianZhong2: 4.12,
  sxLianZhong3: 11.12,
  sxLianZhong4: 31.2,
  sxLianZhong5: 98,
  sxLianZhong2Year: 3.32,
  sxLianZhong3Year: 9.02,
  sxLianZhong4Year: 25.3,
  sxLianZhong5Year: 87,
  sxLianBuZhong2: 3.66,
  sxLianBuZhong3: 8,
  sxLianBuZhong4: 19.3,
  sxLianBuZhong5: 52.8,
  /* 连尾：V66 二~五连尾（五连尾含 0 尾 45，其余 40） */
  wsLianZhong2: 3.18,
  wsLianZhong3: 7.08,
  wsLianZhong4: 15.8,
  wsLianZhong5: 40,
  wsLianZhong5Zero: 45,
  wsLianBuZhong2: 5.36,
  wsLianBuZhong3: 15.3,
  wsLianBuZhong4: 52.8,
  wsLianBuZhong5: 120,
  /* 自选不中：V66 选 N 个后动态赔率 */
  buZhong5: 1.75,
  buZhong6: 1.9,
  buZhong7: 2.5,
  buZhong8: 3,
  buZhong9: 4,
  buZhong10: 5,
  buZhong11: 6,
  buZhong12: 7,
  /* 特码头 / 特码尾（特码位，非平特尾） */
  temaTou0: 5,
  temaTou: 4.36,
  temaWei0: 12,
  temaWei: 9.6,
  /* 合肖 二~十一：V66 盘面 */
  heXiao2: 5.6,
  heXiao3: 3.7,
  heXiao4: 2.8,
  heXiao5: 2.2,
  heXiao6: 1.99,
  heXiao7: 1.63,
  heXiao8: 1.43,
  heXiao9: 1.27,
  heXiao10: 1.14,
  heXiao11: 1.05,
  /* 五行 */
  wuxingJin: 4.3,
  wuxingMu: 4.3,
  wuxingShui: 5.2,
  wuxingHuo: 3.5,
  wuxingTu: 4.7,
  /* 正肖 */
  zhengXiao: 1.88,
  zhengXiaoYear: 1.62,
} as const;

export type LhcOddsKey = keyof typeof LHC_ODDS;

export function lhcPayTableSeed(): Record<string, { multiplier: number; desc: string }> {
  const o = LHC_ODDS;
  return {
    refund: { multiplier: 1, desc: '和局退本' },
    big: { multiplier: o.big, desc: '特码大' },
    small: { multiplier: o.small, desc: '特码小' },
    odd: { multiplier: o.odd, desc: '特码单' },
    even: { multiplier: o.even, desc: '特码双' },
    special: { multiplier: o.special, desc: '特码号码' },
    zhengma: { multiplier: o.zhengma, desc: '正码号码' },
    zhengTe: { multiplier: o.zhengTe, desc: '正码特' },
    combo: { multiplier: o.combo, desc: '特码大单/大双/小单/小双' },
    zhengCombo: { multiplier: o.zhengCombo, desc: '正码组合' },
    colorRed: { multiplier: o.colorRed, desc: '红波' },
    colorBlue: { multiplier: o.colorBlue, desc: '蓝波' },
    colorGreen: { multiplier: o.colorGreen, desc: '绿波' },
    ...Object.fromEntries(
      Object.entries(LHC_COLOR_HALF_ODDS).map(([k, mul]) => [
        `colorHalf_${k}`,
        { multiplier: mul, desc: '半波' + k },
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(LHC_COLOR_HALF_HALF_ODDS).map(([k, mul]) => [
        `colorHalfHalf_${k}`,
        { multiplier: mul, desc: '半半波' + k },
      ]),
    ),
    zodiac: { multiplier: o.zodiac, desc: '特肖（非本命）' },
    zodiacYear: { multiplier: o.zodiacYear, desc: '特肖（本命）' },
    pingTe: { multiplier: o.pingTe, desc: '一肖/平特（非本命）' },
    pingTeYear: { multiplier: o.pingTeYear, desc: '一肖/平特（本命）' },
    weiShu0: { multiplier: o.weiShu0, desc: '平特0尾' },
    weiShu: { multiplier: o.weiShu, desc: '平特1-9尾' },
    weiShuMiss0: { multiplier: o.weiShuMiss0, desc: '0尾不中' },
    weiShuMiss: { multiplier: o.weiShuMiss, desc: '1-9尾不中' },
    heSide: { multiplier: o.heSide, desc: '合数两面' },
    weiSide: { multiplier: o.weiSide, desc: '特尾大' },
    weiSideSmall: { multiplier: o.weiSideSmall, desc: '特尾小' },
    zhengSide: { multiplier: o.zhengSide, desc: '正码两面' },
    zhengHe: { multiplier: o.zhengHe, desc: '正码合数' },
    zhengWei: { multiplier: o.zhengWei, desc: '正码尾大' },
    zhengWeiSmall: { multiplier: o.zhengWeiSmall, desc: '正码尾小' },
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
    siQuanZhong: { multiplier: o.siQuanZhong, desc: '四全中' },
    sxLianZhong2: { multiplier: o.sxLianZhong2, desc: '二肖中' },
    sxLianZhong3: { multiplier: o.sxLianZhong3, desc: '三肖中' },
    sxLianZhong4: { multiplier: o.sxLianZhong4, desc: '四肖中' },
    sxLianZhong5: { multiplier: o.sxLianZhong5, desc: '五肖中' },
    sxLianZhong2Year: { multiplier: o.sxLianZhong2Year, desc: '二肖中·含本命' },
    sxLianZhong3Year: { multiplier: o.sxLianZhong3Year, desc: '三肖中·含本命' },
    sxLianZhong4Year: { multiplier: o.sxLianZhong4Year, desc: '四肖中·含本命' },
    sxLianZhong5Year: { multiplier: o.sxLianZhong5Year, desc: '五肖中·含本命' },
    sxLianBuZhong2: { multiplier: o.sxLianBuZhong2, desc: '二肖不中' },
    sxLianBuZhong3: { multiplier: o.sxLianBuZhong3, desc: '三肖不中' },
    sxLianBuZhong4: { multiplier: o.sxLianBuZhong4, desc: '四肖不中' },
    sxLianBuZhong5: { multiplier: o.sxLianBuZhong5, desc: '五肖不中' },
    wsLianZhong2: { multiplier: o.wsLianZhong2, desc: '二尾中' },
    wsLianZhong3: { multiplier: o.wsLianZhong3, desc: '三尾中' },
    wsLianZhong4: { multiplier: o.wsLianZhong4, desc: '四尾中' },
    wsLianZhong5: { multiplier: o.wsLianZhong5, desc: '五尾中' },
    wsLianZhong5Zero: { multiplier: o.wsLianZhong5Zero, desc: '五尾中·含0尾' },
    wsLianBuZhong2: { multiplier: o.wsLianBuZhong2, desc: '二尾不中' },
    wsLianBuZhong3: { multiplier: o.wsLianBuZhong3, desc: '三尾不中' },
    wsLianBuZhong4: { multiplier: o.wsLianBuZhong4, desc: '四尾不中' },
    wsLianBuZhong5: { multiplier: o.wsLianBuZhong5, desc: '五尾不中' },
    buZhong5: { multiplier: o.buZhong5, desc: '五不中' },
    buZhong6: { multiplier: o.buZhong6, desc: '六不中' },
    buZhong7: { multiplier: o.buZhong7, desc: '七不中' },
    buZhong8: { multiplier: o.buZhong8, desc: '八不中' },
    buZhong9: { multiplier: o.buZhong9, desc: '九不中' },
    buZhong10: { multiplier: o.buZhong10, desc: '十不中' },
    buZhong11: { multiplier: o.buZhong11, desc: '十一不中' },
    buZhong12: { multiplier: o.buZhong12, desc: '十二不中' },
    temaTou0: { multiplier: o.temaTou0, desc: '特码0头' },
    temaTou: { multiplier: o.temaTou, desc: '特码1-4头' },
    temaWei0: { multiplier: o.temaWei0, desc: '特码0尾' },
    temaWei: { multiplier: o.temaWei, desc: '特码1-9尾' },
    heXiao2: { multiplier: o.heXiao2, desc: '合肖二肖' },
    heXiao3: { multiplier: o.heXiao3, desc: '合肖三肖' },
    heXiao4: { multiplier: o.heXiao4, desc: '合肖四肖' },
    heXiao5: { multiplier: o.heXiao5, desc: '合肖五肖' },
    heXiao6: { multiplier: o.heXiao6, desc: '合肖六肖' },
    heXiao7: { multiplier: o.heXiao7, desc: '合肖七肖' },
    heXiao8: { multiplier: o.heXiao8, desc: '合肖八肖' },
    heXiao9: { multiplier: o.heXiao9, desc: '合肖九肖' },
    heXiao10: { multiplier: o.heXiao10, desc: '合肖十肖' },
    heXiao11: { multiplier: o.heXiao11, desc: '合肖十一肖' },
    wuxingJin: { multiplier: o.wuxingJin, desc: '五行金' },
    wuxingMu: { multiplier: o.wuxingMu, desc: '五行木' },
    wuxingShui: { multiplier: o.wuxingShui, desc: '五行水' },
    wuxingHuo: { multiplier: o.wuxingHuo, desc: '五行火' },
    wuxingTu: { multiplier: o.wuxingTu, desc: '五行土' },
    /* 基赔供 H5 展示；结算用下方 ×1..×5 档 */
    zhengXiao: { multiplier: o.zhengXiao, desc: '正肖（非本命）基赔' },
    zhengXiaoYear: { multiplier: o.zhengXiaoYear, desc: '正肖（本命）基赔' },
    zhengXiao1: { multiplier: o.zhengXiao * 1, desc: '正肖（非本命）×1' },
    zhengXiao2: { multiplier: o.zhengXiao * 2, desc: '正肖（非本命）×2' },
    zhengXiao3: { multiplier: o.zhengXiao * 3, desc: '正肖（非本命）×3' },
    zhengXiao4: { multiplier: o.zhengXiao * 4, desc: '正肖（非本命）×4' },
    zhengXiao5: { multiplier: o.zhengXiao * 5, desc: '正肖（非本命）×5' },
    zhengXiaoYear1: { multiplier: o.zhengXiaoYear * 1, desc: '正肖（本命）×1' },
    zhengXiaoYear2: { multiplier: o.zhengXiaoYear * 2, desc: '正肖（本命）×2' },
    zhengXiaoYear3: { multiplier: o.zhengXiaoYear * 3, desc: '正肖（本命）×3' },
    zhengXiaoYear4: { multiplier: o.zhengXiaoYear * 4, desc: '正肖（本命）×4' },
    zhengXiaoYear5: { multiplier: o.zhengXiaoYear * 5, desc: '正肖（本命）×5' },
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

/** 特码半波赔率（截图顺序） */
export const LHC_COLOR_HALF_ODDS: Record<string, number> = {
  红大: 6.51, 红单: 5.61, 红双: 5.05, 红小: 4.52,
  蓝小: 6.51, 蓝单: 5.61, 蓝双: 5.61, 蓝大: 5.05,
  绿小: 6.51, 绿双: 6.51, 绿大: 5.61, 绿单: 5.61,
};

/** 特码半半波赔率（截图顺序） */
export const LHC_COLOR_HALF_HALF_ODDS: Record<string, number> = {
  红大单: 13.5, 红大双: 11.6, 红小单: 9.3, 红小双: 9.3,
  蓝小单: 13.5, 蓝大双: 11.6, 蓝小双: 11.6, 蓝大单: 9.3,
  绿小双: 13.5, 绿大单: 11.6, 绿大双: 11.6, 绿小单: 11.6,
};

export function colorHalfPayKey(spec: string): string | null {
  return Object.prototype.hasOwnProperty.call(LHC_COLOR_HALF_ODDS, spec)
    ? `colorHalf_${spec}`
    : null;
}

export function colorHalfHalfPayKey(spec: string): string | null {
  return Object.prototype.hasOwnProperty.call(LHC_COLOR_HALF_HALF_ODDS, spec)
    ? `colorHalfHalf_${spec}`
    : null;
}

/** 特码半波 / 半半波：色 + 大小/单双 / 大小单双 */
export function matchColorCombo(n: number, spec: string): boolean {
  if (!spec || spec.length < 2) return false;
  const color = spec[0];
  if (color !== '红' && color !== '蓝' && color !== '绿') return false;
  if (waveColorOf(n) !== color) return false;
  const rest = spec.slice(1);
  const big = n >= 25;
  const odd = n % 2 !== 0;
  if (rest === '大') return big;
  if (rest === '小') return !big;
  if (rest === '单') return odd;
  if (rest === '双') return !odd;
  if (rest === '大单') return big && odd;
  if (rest === '大双') return big && !odd;
  if (rest === '小单') return !big && odd;
  if (rest === '小双') return !big && !odd;
  return false;
}

/**
 * 五行号码表（互斥覆盖 1–49）：火最多、水最少，对齐截图赔率方向。
 * 火13 / 金11 / 木11 / 土8 / 水6
 */
const WUXING_TABLE: Record<number, '金' | '木' | '水' | '火' | '土'> = {
  1: '火', 2: '火', 3: '金', 4: '金', 5: '土', 6: '土', 7: '木', 8: '木', 9: '火', 10: '火',
  11: '金', 12: '金', 13: '土', 14: '水', 15: '木', 16: '木', 17: '火', 18: '火', 19: '金', 20: '金',
  21: '土', 22: '水', 23: '木', 24: '木', 25: '火', 26: '火', 27: '金', 28: '金', 29: '土', 30: '水',
  31: '木', 32: '木', 33: '火', 34: '火', 35: '金', 36: '金', 37: '土', 38: '水', 39: '木', 40: '木',
  41: '火', 42: '火', 43: '金', 44: '土', 45: '水', 46: '水', 47: '木', 48: '土', 49: '火',
};

export function wuxingOf(n: number): '金' | '木' | '水' | '火' | '土' {
  return WUXING_TABLE[n] || '火';
}

export function wuxingPayKey(wx: string): string | null {
  if (wx === '金') return 'wuxingJin';
  if (wx === '木') return 'wuxingMu';
  if (wx === '水') return 'wuxingShui';
  if (wx === '火') return 'wuxingHuo';
  if (wx === '土') return 'wuxingTu';
  return null;
}

/** 该五行对应的全部号码（展示用） */
export function numsOfWuxing(wx: string): number[] {
  const out: number[] = [];
  for (let n = 1; n <= 49; n++) {
    if (wuxingOf(n) === wx) out.push(n);
  }
  return out;
}
