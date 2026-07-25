/**
 * 将大脑 betType + value 转成聊天/核对卡可读玩法名（与 H5 口语一致）。
 */
const SIDE_CN: Record<string, string> = {
  big: '大',
  small: '小',
  odd: '单',
  even: '双',
};

const RACE_LHH_PAIRS: Array<[number, number]> = [
  [0, 9], [1, 8], [2, 7], [3, 6], [4, 5],
];

const DIGIT5_POS = ['万', '千', '百', '十', '个'];

const RACING = new Set(['bjsc', 'speed-racing', 'speed-boat']);
const DIGIT5 = new Set(['ssc', 'ffc']);

function formatRacing(type: string, val: string): string {
  if (type === 'top2big') return '冠亚大';
  if (type === 'top2small') return '冠亚小';
  if (type === 'top2odd') return '冠亚单';
  if (type === 'top2even') return '冠亚双';
  if (type === 'gySum') return '冠亚和' + val;
  if (type === 'champion') return '冠军' + val;
  if (type === 'runner') return '亚军' + val;
  if (type === 'posSide') {
    const m = val.match(/^([0-9]):(big|small|odd|even)$/);
    if (m) {
      const pos = +m[1];
      const track = pos === 9 ? '0' : String(pos + 1);
      return track + (SIDE_CN[m[2]] || m[2]);
    }
  }
  if (type === 'position') {
    const m = val.match(/^([0-9]):(10|[1-9])$/);
    if (m) {
      const pos = +m[1];
      const track = pos === 9 ? '0' : String(pos + 1);
      const car = m[2] === '10' ? '0' : m[2];
      /* 统一赛道/车号，不再出「N定M」 */
      return `${track}/${car}`;
    }
  }
  if (type === 'lhh') {
    const m = val.match(/^([0-9]):([0-9]):(龙|虎)$/);
    if (m) {
      const a = +m[1];
      const b = +m[2];
      const pick = m[3];
      const idx = RACE_LHH_PAIRS.findIndex(([x, y]) => x === a && y === b);
      if (idx >= 0) return `${idx + 1}${pick}`;
      return `${a + 1}-${b + 1}${pick}`;
    }
    if (val === '龙' || val === '虎') return val;
  }
  return type + (val ? ':' + val : '');
}

function formatDigit5(type: string, val: string): string {
  if (type === 'big') return '大';
  if (type === 'small') return '小';
  if (type === 'odd') return '单';
  if (type === 'even') return '双';
  if (type === 'exact') return '个' + val;
  if (type === 'ballSide') {
    const m = val.match(/^([0-4]):(big|small|odd|even)$/);
    if (m) return (DIGIT5_POS[+m[1]] || m[1]) + (SIDE_CN[m[2]] || m[2]);
  }
  if (type === 'position') {
    const m = val.match(/^([0-4]):([0-9])$/);
    if (m) return (DIGIT5_POS[+m[1]] || m[1]) + m[2];
  }
  if (type === 'anyDigit') {
    const i = val.indexOf(':');
    if (i > 0) return val.slice(0, i) + val.slice(i + 1);
  }
  if (type === 'group3' || type === 'group6' || type === 'shape') {
    const i = val.indexOf(':');
    if (i > 0) {
      const seg = val.slice(0, i);
      const rest = val.slice(i + 1).replace(/,/g, '');
      const tag = type === 'group3' ? '组三' : type === 'group6' ? '组六' : '';
      return seg + tag + rest;
    }
  }
  if (type === 'lhh') return val || '龙虎';
  if (type === 'niu') {
    const n = Number(val);
    if (n === -1) return '无牛';
    if (n === 10) return '牛牛';
    if (n >= 1 && n <= 9) return '牛' + n;
  }
  if (type === 'niuSide') return '牛' + val;
  return type + (val ? ':' + val : '');
}

function formatKuai3(type: string, val: string): string {
  if (type === 'big') return '大';
  if (type === 'small') return '小';
  if (type === 'odd') return '单';
  if (type === 'even') return '双';
  if (type === 'sum') return '和' + val;
  if (type === 'triplet') return '三同号';
  if (type === 'tripletN') return '三同' + val;
  if (type === 'dice') return '三军' + val;
  if (type === 'pair') return '二同' + val;
  if (type === 'straight') return !val || val === 'any' ? '三连号' : '三连' + val;
  if (type === 'alldiff') return '三不同号';
  if (type === 'long') return '长牌' + val.replace(':', '');
  return type + (val ? ':' + val : '');
}

function formatLhc(type: string, val: string): string {
  if (type === 'big') return '特码大';
  if (type === 'small') return '特码小';
  if (type === 'odd') return '特码单';
  if (type === 'even') return '特码双';
  const map: Record<string, string> = {
    special: '特码',
    zhengma: '正码',
    combo: '特码',
    color: '',
    temaZodiac: '特肖',
    pingZodiac: '一肖',
    heSide: '合',
    weiSide: '尾',
    sumSide: '总',
    sumTail: '总尾',
    weiShu: '尾',
    weiShuMiss: '尾不中',
    lianma: '连码',
    sxLian: '生肖连',
    wsLian: '尾数连',
    buZhong: '不中',
    liuxiao: '六肖',
  };
  const cn = map[type] || type;
  if (!val) return cn || type;
  if (val.charAt(0) === '{') {
    try {
      const j = JSON.parse(val) as Record<string, unknown>;
      const CN: Record<number, string> = {
        2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十', 11: '十一', 12: '十二',
      };
      if (type === 'lianma' && j.play && Array.isArray(j.nums)) {
        const mode = String(j.mode || '复式');
        const nums = (j.nums as number[]).map((n) => String(n).padStart(2, '0')).join(',');
        return `${mode}${String(j.play)}${nums}`;
      }
      if (type === 'sxLian' && Array.isArray(j.zodiacs)) {
        const n = Number(j.n) || (j.zodiacs as string[]).length;
        const hit = j.hit ? '中' : '不中';
        const mode = String(j.mode || '复式');
        return `${mode}${CN[n] || ''}肖${hit}${(j.zodiacs as string[]).join(',')}`;
      }
      if (type === 'wsLian' && Array.isArray(j.tails)) {
        const tails = j.tails as number[];
        const n = Number(j.n) || tails.length;
        const hit = j.hit ? '中' : '不中';
        const mode = String(j.mode || '复式');
        return `${mode}${CN[n] || ''}尾${hit}${tails.map((t) => t + '尾').join(',')}`;
      }
      if (type === 'buZhong' && Array.isArray(j.nums)) {
        const nums = j.nums as number[];
        const n = Number(j.n) || nums.length;
        return `复式${CN[n] || ''}不中${nums.map((x) => String(x).padStart(2, '0')).join(',')}`;
      }
      if (type === 'liuxiao' && Array.isArray(j.zodiacs)) {
        return (j.hit ? '六肖中' : '六肖不中') + (j.zodiacs as string[]).join(',');
      }
    } catch {
      /* ignore */
    }
  }
  if (type === 'special' || type === 'zhengma') {
    const n = parseInt(val, 10);
    if (n >= 1 && n <= 49) return cn + String(n).padStart(2, '0');
  }
  if (type === 'color') return val + '波';
  if (type === 'combo') return '特码' + val;
  if (type === 'temaZodiac' || type === 'pingZodiac') return cn + val;
  if (type === 'heSide') return '合' + val;
  if (type === 'weiSide') return '尾' + val;
  if (type === 'sumSide') return '总和' + val;
  if (type === 'sumTail') return '总尾' + val;
  if (type === 'weiShu') return val + '尾';
  if (type === 'weiShuMiss') return val + '尾不中';
  return cn + val;
}

export function formatLotteryPlayLabel(
  gameCode: string,
  betType: string,
  value?: string | number | null,
): string {
  const type = String(betType || '');
  const val = value == null || value === '' ? '' : String(value);
  if (!type) return val || '下注';

  if (RACING.has(gameCode)) return formatRacing(type, val);
  if (DIGIT5.has(gameCode)) return formatDigit5(type, val);
  if (gameCode === 'kuai3') return formatKuai3(type, val);
  if (gameCode === 'lhc') return formatLhc(type, val);

  /* 兜底：按玩法族猜测 */
  if (type.startsWith('top2') || type === 'gySum' || type === 'posSide') return formatRacing(type, val);
  if (type === 'ballSide' || type === 'niu' || type === 'niuSide') return formatDigit5(type, val);
  return type + (val ? ':' + val : '');
}
