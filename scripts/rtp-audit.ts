/**
 * RTP 审计（改任何赔率表后必跑）
 *
 *   pnpm audit:rtp                 # 全量
 *   pnpm audit:rtp lhc kuai3       # 只跑指定游戏
 *   pnpm audit:rtp control          # 只跑软控能力/奖项节奏仿真
 *   RTP_ROUNDS=1000000 pnpm audit:rtp table
 *   CONTROL_ROUNDS=100000 pnpm audit:rtp control
 *
 * 赔率直接 import 服务端与 shared 的唯一来源，不复制数字；
 * 命中概率用精确枚举 / 组合数求解，牌桌用固定种子的蒙特卡洛
 * （发牌走真实 drawXxxFromDeck）。低返还只警告；能统计确认 RTP > 100%
 * 才硬阻断，避免公平盘在 100% 附近因抽样抖动随机红灯。
 *
 * 判定逻辑（judge / calcPayout）改了之后，本文件的概率口径要同步。
 */
import { createHash } from 'node:crypto';
import {
  drawBaccaratFromDeck,
  calcBaccaratPayout,
} from '../server/src/modules/table/baccarat.game';
import {
  drawZhajinhuaFromDeck,
  calcZhajinhuaPayout,
} from '../server/src/modules/table/zhajinhua.game';
import { drawDouniuFromDeck, calcDouniuPayout } from '../server/src/modules/table/douniu.game';
import { LHC_ODDS, LHC_COLOR_HALF_ODDS, LHC_COLOR_HALF_HALF_ODDS } from '../server/src/modules/lottery/games/lhc-odds';
import { bjscPayTable } from '../server/src/modules/lottery/games/bjsc.game';
import { kuai3Game, kuai3PayTable } from '../server/src/modules/lottery/games/kuai3.game';
import { ffcGame, sscFfcPayTable } from '../server/src/modules/lottery/games/ffc.game';
import { lhcGame } from '../server/src/modules/lottery/games/lhc.game';
import { lhcPayTableSeed } from '../server/src/modules/lottery/games/lhc-odds';
import type {
  LotteryBetPayload,
  LotteryGameDef,
  LotteryPayTable,
} from '../server/src/modules/lottery/lottery.types';
import { freshDeck, type FaceCard } from '../server/src/modules/table/table-cards';
import { deriveRandom } from '../server/src/modules/game-core/fairness.util';
import {
  decidePeriodGuard,
  periodCandidateLegal,
  pickSeedForArcadePool,
  type ArcadePoolPickRuntime,
} from '../server/src/modules/console/control-pick.util';
import {
  periodGuardParams,
  type PeriodGuardParams,
} from '../server/src/modules/console/control.constants';
import {
  getTablePayTable,
  BCBM_RING,
  BCBM_BET_SLOTS,
  BCBM_AWARD_TYPES,
  BCBM_DEFAULT_AWARD_WEIGHTS,
  bcbmIndexesOfBrand,
  bcbmIndexesOfColor,
  bcbmNonFreeIndexes,
  FRUIT_RING,
  FRUIT_BET_SYMBOLS,
  FRUIT_AWARD_TYPES,
  FRUIT_DEFAULT_AWARD_WEIGHTS,
  fruitBigIndexes,
  fruitAppleIndexes,
  fruitLuckIndexes,
  fruitNonLuckIndexes,
  type BcbmAwardType,
  type BcbmBrandId,
  type BcbmColorId,
  type FruitAwardType,
  type FruitBetSymbolId,
} from '@gamebox/shared';

const TARGET_RTP = 0.96;
const WARN_MIN = 0.9;
const HARD_MAX = 1.0;
/** 蒙特卡洛只有在均值减 4 个标准误仍 >100% 时才硬阻断。 */
const MC_SIGMA = 4;
const AUDIT_SEED = process.env.RTP_AUDIT_SEED || 'gamebox-rtp-audit-v1';

/**
 * 沿用全球赌场通行赔率、不按 96% 重标的边。
 * 百家乐「和 1:8」「对子 1:11」的高抽水是行业惯例，改掉反而不像百家乐。
 * 仍然受 100% 硬上限约束：只豁免偏低，不豁免平台负期望。
 */
const INDUSTRY_STANDARD = new Set([
  '百家乐/tie',
  '百家乐/bankerPair',
  '百家乐/playerPair',
  /* 龙虎：市面口径龙 0.95 / 虎 1 / 和 8（和局命中低，RTP 偏低不重标） */
  '龙虎/tie',
  /* 炸金花：对齐 OG New Three Cards 市面赔率（偏低不重标） */
  '炸金花/shunjin',
  '炸金花/baozi',
  '炸金花/san6',
  '炸金花/san7',
  '炸金花/san3',
]);

/**
 * 幸运六合彩截图对齐赔率：部分玩法刻意贴近官方展示（含统一两面 1.98），
 * 单项 RTP 可能低于 90%。不按 96% 重标；审计只提示，不记不合格。
 * 与 INDUSTRY_STANDARD 同理：只豁免偏低，不豁免平台负期望——
 * 贴图不能成为 RTP>100% 的理由，那是玩家可稳定套利的口子。
 */
const SCREENSHOT_ALIGNED = new Set([
  /* 炸金花闲 1:1：庄闲随机对称且比花色后无和，主注按精确 50% 计算 */
  '炸金花/player',
  /*
   * 斗牛：市面给定牌型赔率（含闲 1、部分边注 RTP 偏离 96%）。
   * 牛牛/牛7-9/无牛-牛6 三项按含本口径结算后已回到 96% 附近，不再豁免；
   * 谁再把它们改回净赔率，审计会当场拦下。
   */
  '斗牛/player',
  '斗牛/small',
  '斗牛/flower',
  /*
   * 六合彩两面（特码/合数/特尾/正码）原先挂在这里，是因为审计漏算了特码 49 和局退本、
   * 把 RTP 报成 101.02%。补上退本档后实测 99.02%，本就合格，豁免已无必要，
   * 移除后若有人再改这批赔率，审计会照常拦下。
   */
  '六合彩/四全中',
  '六合彩/特串',
  '六合彩/2肖连中',
  '六合彩/2肖连中·本命',
  '六合彩/3肖连中',
  '六合彩/3肖连中·本命',
  '六合彩/4肖连中',
  '六合彩/4肖连中·本命',
  '六合彩/5肖连中',
  '六合彩/5肖连中·本命',
  '六合彩/2尾连中',
  '六合彩/3尾连中',
  '六合彩/4尾连中',
  '六合彩/5尾连中',
  '六合彩/5尾不中',
  '六合彩/特码1-4头',
  '六合彩/合肖2',
  '六合彩/五行水',
  '六合彩/五行土',
  '六合彩/正肖·非本命',
  '六合彩/正肖·本命',
]);

/**
 * 只作诊断展示、不参与判定的分组。
 * 奔驰宝马「仅 normal」拆出来是为了看 12 仓是否均衡：12 仓覆盖全部赔付格时
 * 普通开奖 RTP 的数学上限就是 1/Σ(1/倍率)≈83%，缺口由大奖补足，
 * 真正要看的是「均押12仓·总RTP」。
 */
const DIAGNOSTIC_GROUPS = new Set(['奔驰宝马·仅normal']);
/** 蒙特卡洛用大额本金，规避 Math.floor 取整噪声 */
const UNIT = 1_000_000;

const pct = (x: number) => (x * 100).toFixed(2) + '%';

/** 每个审计分组单独固定随机流；只跑子集时结果也与全量一致。 */
function seededRandom(scope: string): () => number {
  let state = createHash('sha256')
    .update(`${AUDIT_SEED}:${scope}`)
    .digest()
    .readUInt32LE(0);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicSeed(scope: string, index: number): string {
  return createHash('sha256').update(`${AUDIT_SEED}:${scope}:${index}`).digest('hex');
}

function standardError(sum: number, sumSq: number, n: number): number {
  if (n <= 1) return 0;
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return Math.sqrt(variance / n);
}

function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

interface Row {
  game: string;
  play: string;
  /** 命中率；纯期望口径的行传 null */
  p: number | null;
  current: number;
  rtp: number;
  /** 蒙特卡洛均值标准误；精确枚举不传。 */
  stderr?: number;
  suggest: number;
  unit: '倍数' | '利润赔率' | '整体放大系数';
}
const rows: Row[] = [];

/** payout = 下注 × multiplier（彩票口径） */
function checkMult(game: string, play: string, p: number, multiplier: number) {
  rows.push({
    game, play, p, current: multiplier, rtp: p * multiplier,
    suggest: p > 0 ? TARGET_RTP / p : 0, unit: '倍数',
  });
}
/**
 * 带和局退本的彩票玩法：pRefund 概率下原样退回本金，既不算赢也不算输。
 * 六合彩特码 49、赛车冠亚和 11 都走 judge 的 'refund' 档；
 * 漏算这一档会把命中率和 RTP 一起报高，制造 >100% 的假警报。
 */
function checkMultRefund(
  game: string,
  play: string,
  p: number,
  multiplier: number,
  pRefund: number,
) {
  rows.push({
    game, play, p, current: multiplier, rtp: p * multiplier + pRefund,
    suggest: p > 0 ? (TARGET_RTP - pRefund) / p : 0, unit: '倍数',
  });
}
/** payout = 本金 + 本金 × profitOdds（牌桌口径） */
function checkProfit(
  game: string,
  play: string,
  p: number,
  rtp: number,
  profitOdds: number,
  stderr?: number,
) {
  rows.push({
    game, play, p, current: profitOdds, rtp, stderr,
    suggest: p > 0 ? TARGET_RTP / p - 1 : 0, unit: '利润赔率',
  });
}

/**
 * 一个玩法按结果分多档赔付（三中二、二中特等）时，
 * RTP 要合并各档，逐档判定会误报。
 */
function checkTiered(
  game: string,
  play: string,
  tiers: Array<{ p: number; multiplier: number }>,
) {
  const p = tiers.reduce((s, t) => s + t.p, 0);
  const rtp = tiers.reduce((s, t) => s + t.p * t.multiplier, 0);
  rows.push({
    game, play, p, current: p > 0 ? rtp / p : 0, rtp,
    suggest: rtp > 0 ? TARGET_RTP / rtp : 0, unit: '整体放大系数',
  });
}

// ───────────────────────────────────────── 六合彩
function auditLhc() {
  const O = LHC_ODDS;
  const g = '六合彩';
  /** 7 个开奖号中「指定 m 个号一个都不出现」的概率 */
  const none = (m: number) => comb(49 - m, 7) / comb(49, 7);
  /** n 组号码（每组 per 个）全部至少出现一次 */
  const allHit = (n: number, per: number) => {
    let s = 0;
    for (let k = 0; k <= n; k++) s += (k % 2 ? -1 : 1) * comb(n, k) * none(per * k);
    return s;
  };

  /**
   * 特码 49 是和局退本（lhc.game.ts 的 big/small/odd/even/combo/zhengSide/
   * zhengCombo/zhengHe/zhengWei/colorHalf/colorHalfHalf/heSide/weiSide/
   * heXiao/liuxiao 都 return 'refund'），胜出集合一律不含 49。
   */
  const TIE49 = 1 / 49;
  checkMultRefund(g, '特码大(25-48)', 24 / 49, O.big, TIE49);
  checkMultRefund(g, '特码小(1-24)', 24 / 49, O.small, TIE49);
  checkMultRefund(g, '特码单(1-47)', 24 / 49, O.odd, TIE49);
  checkMultRefund(g, '特码双', 24 / 49, O.even, TIE49);
  checkMult(g, '特码号', 1 / 49, O.special);
  checkMult(g, '正码', 6 / 49, O.zhengma);
  checkMult(g, '正码特', 1 / 49, O.zhengTe);
  checkMultRefund(g, '特码大单', 12 / 49, O.combo, TIE49);
  checkMultRefund(g, '特码大双/小单/小双', 12 / 49, O.combo, TIE49);
  checkMult(g, '红波(17号)', 17 / 49, O.colorRed);
  checkMult(g, '蓝波(16号)', 16 / 49, O.colorBlue);
  checkMult(g, '绿波(16号)', 16 / 49, O.colorGreen);
  checkMultRefund(g, '半波·红大', 7 / 49, LHC_COLOR_HALF_ODDS['红大'], TIE49);
  checkMultRefund(g, '半波·红小', 10 / 49, LHC_COLOR_HALF_ODDS['红小'], TIE49);
  checkMultRefund(g, '半半波·红大单', 3 / 49, LHC_COLOR_HALF_HALF_ODDS['红大单'], TIE49);
  checkMultRefund(g, '半半波·红小单', 5 / 49, LHC_COLOR_HALF_HALF_ODDS['红小单'], TIE49);
  checkMult(g, '特肖·非本命', 4 / 49, O.zodiac);
  checkMult(g, '特肖·本命', 5 / 49, O.zodiacYear);
  checkMult(g, '平特·非本命', 1 - none(4), O.pingTe);
  checkMult(g, '平特·本命', 1 - none(5), O.pingTeYear);
  checkMult(g, '0尾(4号)', 1 - none(4), O.weiShu0);
  checkMult(g, '1-9尾(5号)', 1 - none(5), O.weiShu);
  checkMult(g, '0尾不中', none(4), O.weiShuMiss0);
  checkMult(g, '1-9尾不中', none(5), O.weiShuMiss);
  checkMultRefund(g, '合数大(>=7)', 24 / 49, O.heSide, TIE49);
  checkMultRefund(g, '合数小', 24 / 49, O.heSide, TIE49);
  checkMultRefund(g, '特尾大(5-9)', 24 / 49, O.weiSide, TIE49);
  checkMultRefund(g, '特尾小(0-4)', 24 / 49, O.weiSideSmall, TIE49);
  checkMultRefund(g, '正码两面', 24 / 49, O.zhengSide, TIE49);
  checkMultRefund(g, '正码组合', 12 / 49, O.zhengCombo, TIE49);
  checkMultRefund(g, '六肖·中(24号)', 24 / 49, O.liuxiao, TIE49);
  checkMultRefund(g, '六肖·不中(24号)', 24 / 49, O.liuxiao, TIE49);
  checkMult(g, '二全中', (6 / 49) * (5 / 48), O.erQuanZhong);
  checkMult(g, '三全中', comb(6, 3) / comb(49, 3), O.sanQuanZhong);
  checkMult(g, '四全中', comb(6, 4) / comb(49, 4), O.siQuanZhong);
  /* 三中二 / 二中特：同一注按命中数分档赔付，RTP 取合并 */
  checkTiered(g, '三中二(中二+中三)', [
    { p: (comb(6, 2) * 43) / comb(49, 3), multiplier: O.sanZhongEr },
    { p: comb(6, 3) / comb(49, 3), multiplier: O.sanZhongSan },
  ]);
  checkTiered(g, '二中特(中特+中二)', [
    { p: 2 * (1 / 49) * (6 / 48), multiplier: O.erZhongTeTe },
    { p: (6 / 49) * (5 / 48), multiplier: O.erZhongTe },
  ]);
  checkMult(g, '特串', 2 * (1 / 49) * (6 / 48), O.teChuan);
  /* 连肖按非本命肖 4 号/肖，连尾按 1-9 尾 5 号/尾 */
  for (const n of [2, 3, 4, 5] as const) {
    checkMult(g, `${n}肖连中`, allHit(n, 4), O[`sxLianZhong${n}`]);
    checkMult(g, `${n}肖连中·本命`, allHit(n, 4), O[`sxLianZhong${n}Year`]);
    checkMult(g, `${n}肖不中`, none(4 * n), O[`sxLianBuZhong${n}`]);
  }
  for (const n of [2, 3, 4, 5] as const) {
    checkMult(g, `${n}尾连中`, allHit(n, 5), O[`wsLianZhong${n}`]);
    checkMult(g, `${n}尾不中`, none(5 * n), O[`wsLianBuZhong${n}`]);
  }
  for (const n of [5, 6, 7, 8, 9, 10, 11, 12] as const) {
    checkMult(g, `${n}不中`, none(n), O[`buZhong${n}`]);
  }
  checkMult(g, '特码0头', 9 / 49, O.temaTou0);
  checkMult(g, '特码1-4头', 10 / 49, O.temaTou);
  checkMult(g, '特码0尾', 4 / 49, O.temaWei0);
  checkMult(g, '特码1-9尾', 5 / 49, O.temaWei);
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const) {
    checkMultRefund(g, `合肖${n}`, (n * 4) / 49, O[`heXiao${n}` as keyof typeof O], TIE49);
  }
  checkMult(g, '五行金', 11 / 49, O.wuxingJin);
  checkMult(g, '五行木', 11 / 49, O.wuxingMu);
  checkMult(g, '五行水', 6 / 49, O.wuxingShui);
  checkMult(g, '五行火', 13 / 49, O.wuxingHuo);
  checkMult(g, '五行土', 8 / 49, O.wuxingTu);
  checkMult(g, '正肖·非本命', 1 - none(4), O.zhengXiao);
  checkMult(g, '正肖·本命', 1 - none(5), O.zhengXiaoYear);
}

// ───────────────────────────────────────── 赛车 PK10
function auditBjsc() {
  const P = bjscPayTable;
  const g = '赛车PK10';
  const cnt: Record<number, number> = {};
  let tot = 0;
  for (let a = 1; a <= 10; a++) {
    for (let b = 1; b <= 10; b++) {
      if (a === b) continue;
      cnt[a + b] = (cnt[a + b] ?? 0) + 1;
      tot++;
    }
  }
  let big = 0, small = 0, odd = 0, even = 0, tie11 = 0;
  for (const key of Object.keys(cnt)) {
    const n = Number(key);
    const c = cnt[n];
    /* 官方：冠亚和 11 为和局，大小单双一律退本（bjsc.game.ts 的 top2* → 'refund'） */
    if (n === 11) { tie11 += c; continue; }
    if (n >= 12) big += c; else small += c;
    if (n % 2) odd += c; else even += c;
  }
  const pTie11 = tie11 / tot;
  checkMultRefund(g, '冠亚和大(12-19)', big / tot, P.top2big.multiplier, pTie11);
  checkMultRefund(g, '冠亚和小(3-10)', small / tot, P.top2small.multiplier, pTie11);
  checkMultRefund(g, '冠亚和单', odd / tot, P.top2odd.multiplier, pTie11);
  checkMultRefund(g, '冠亚和双', even / tot, P.top2even.multiplier, pTie11);
  for (let s = 3; s <= 19; s++) {
    const key = `gySum_${s}` as keyof typeof P;
    checkMult(g, `冠亚和值${s}`, cnt[s] / tot, (P[key] as { multiplier: number }).multiplier);
  }
  checkMult(g, '冠军号', 1 / 10, P.champion.multiplier);
  checkMult(g, '亚军号', 1 / 10, P.runner.multiplier);
  checkMult(g, '定位车号', 1 / 10, P.position.multiplier);
  checkMult(g, '名次两面', 1 / 2, P.posSide.multiplier);
  checkMult(g, '龙虎', 1 / 2, P.lhh.multiplier);
}

// ───────────────────────────────────────── 快三
function auditKuai3() {
  const P = kuai3PayTable;
  const g = '快三';
  const all: number[][] = [];
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++)
      for (let c = 1; c <= 6; c++) all.push([a, b, c]);
  const T = all.length;
  const trip = (d: number[]) => d[0] === d[1] && d[1] === d[2];
  const cntOf = (d: number[], n: number) => d.filter((x) => x === n).length;
  const straight = (d: number[]) => {
    if (trip(d)) return false;
    const s = [...d].sort((x, y) => x - y);
    return s[0] + 1 === s[1] && s[1] + 1 === s[2];
  };
  const pairShape = (d: number[]) =>
    !trip(d) && (d[0] === d[1] || d[1] === d[2] || d[0] === d[2]);
  const sum = (d: number[]) => d[0] + d[1] + d[2];
  const p = (f: (d: number[]) => boolean) => all.filter(f).length / T;

  checkMult(g, '大(11-17非豹)', p((d) => !trip(d) && sum(d) >= 11), P.big.multiplier);
  checkMult(g, '小(4-10非豹)', p((d) => !trip(d) && sum(d) <= 10), P.small.multiplier);
  checkMult(g, '单(非豹)', p((d) => !trip(d) && sum(d) % 2 === 1), P.odd.multiplier);
  checkMult(g, '双(非豹)', p((d) => !trip(d) && sum(d) % 2 === 0), P.even.multiplier);
  checkMult(g, '任意豹子', p(trip), P.triplet.multiplier);
  checkMult(g, '指定豹子', p((d) => trip(d) && d[0] === 1), P.tripletN.multiplier);
  for (let s = 4; s <= 17; s++) {
    const key = `sum_${s}` as keyof typeof P;
    checkMult(g, `和值${s}`, p((d) => sum(d) === s), (P[key] as { multiplier: number }).multiplier);
  }
  /* 三军：所选点数出现至少一次即中，出现多次仍只派彩一次 */
  checkMult(g, '三军(出现即中)', p((d) => cntOf(d, 1) >= 1), P.dice1.multiplier);
  checkMult(g, '二同号(指定)', p((d) => cntOf(d, 1) === 2), P.pair.multiplier);
  checkMult(g, '三连号通选', p(straight), P.straight.multiplier);
  checkMult(
    g, '三连号单选',
    p((d) => {
      const s = [...d].sort((x, y) => x - y);
      return s[0] === 1 && s[1] === 2 && s[2] === 3;
    }),
    P.straightN.multiplier,
  );
  checkMult(g, '三不同号', p((d) => !trip(d) && !pairShape(d) && !straight(d)), P.alldiff.multiplier);
  checkMult(g, '长牌(1&2)', p((d) => d.includes(1) && d.includes(2)), P.long.multiplier);
}

// ───────────────────────────────────────── 时时彩 / 分分彩
function auditFfc() {
  const P = sscFfcPayTable;
  const g = '时时彩';
  const niuValue = (n: number[]) => {
    const total = n.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 4; j++)
        for (let k = j + 1; k < 5; k++)
          if ((n[i] + n[j] + n[k]) % 10 === 0) {
            const v = (total - n[i] - n[j] - n[k]) % 10;
            return v === 0 ? 10 : v;
          }
    return -1;
  };
  const shapeOf = (a3: number[]) => {
    const s = [...a3].sort((x, y) => x - y);
    if (s[0] === s[2]) return '豹子';
    if (s[0] === s[1] || s[1] === s[2]) return '对子';
    for (let a = 0; a < 10; a++) {
      const st = new Set([a, (a + 1) % 10, (a + 2) % 10]);
      if (st.has(s[0]) && st.has(s[1]) && st.has(s[2])) return '顺子';
    }
    const adj = (x: number, y: number) => Math.abs(x - y) === 1 || Math.abs(x - y) === 9;
    return adj(s[0], s[1]) || adj(s[1], s[2]) || adj(s[0], s[2]) ? '半顺' : '杂六';
  };

  const N = 100_000; // 5 球 0-9 全枚举
  let big = 0, odd = 0, tie = 0, dragon = 0, g3 = 0, g6 = 0;
  const niuCnt: Record<number, number> = {};
  const shapeCnt: Record<string, number> = { 豹子: 0, 顺子: 0, 对子: 0, 半顺: 0, 杂六: 0 };
  for (let v = 0; v < N; v++) {
    const d = [
      Math.floor(v / 10000) % 10, Math.floor(v / 1000) % 10,
      Math.floor(v / 100) % 10, Math.floor(v / 10) % 10, v % 10,
    ];
    const s = d.reduce((a, b) => a + b, 0);
    if (s >= 23) big++;
    if (s % 2) odd++;
    const nv = niuValue(d);
    niuCnt[nv] = (niuCnt[nv] ?? 0) + 1;
    if (d[0] > d[4]) dragon++;
    if (d[0] === d[4]) tie++;
    const seg = d.slice(0, 3);
    shapeCnt[shapeOf(seg)]++;
    const ss = [...seg].sort((x, y) => x - y);
    /* 组三一张注单只认一个重复形态；112 与 122 是两张独立注单 */
    if (ss[0] === 1 && ss[1] === 1 && ss[2] === 2) g3++;
    if (new Set(seg).size === 3 && seg.includes(1) && seg.includes(2) && seg.includes(3)) g6++;
  }

  checkMult(g, '总和大(>=23)', big / N, P.big.multiplier);
  checkMult(g, '总和单', odd / N, P.odd.multiplier);
  checkMult(g, '猜个位', 1 / 10, P.exact.multiplier);
  checkMult(g, '定位胆', 1 / 10, P.position.multiplier);
  checkMult(g, '定位两面', 1 / 2, P.ballSide.multiplier);
  checkMult(g, '不定位', 1 - 0.9 ** 3, P.anyDigit.multiplier);
  checkMult(g, '三星组三(单注AAB)', g3 / N, P.group3.multiplier);
  checkMult(g, '三星组六(选3码)', g6 / N, P.group6.multiplier);
  checkMult(g, '龙(万>个)', dragon / N, P.dragon.multiplier);
  checkMult(g, '和(万=个)', tie / N, P.tie.multiplier);
  checkMult(g, '无牛', niuCnt[-1] / N, P.noNiu.multiplier);
  checkMult(g, '牛牛(10)', niuCnt[10] / N, P.niu.multiplier);
  checkMult(g, '牛1(最低档)', niuCnt[1] / N, P.niu.multiplier);
  checkMult(g, '牛2(最高档)', niuCnt[2] / N, P.niu.multiplier);
  /* 牛两面：无牛判输（不退本），RTP = 命中×赔率 */
  let nBig = 0;
  for (let k = 6; k <= 10; k++) nBig += niuCnt[k] / N;
  checkMult(g, '牛大(无牛判输)', nBig, P.niuSide.multiplier);
  for (const k of Object.keys(shapeCnt)) {
    const key = `shape_${k}` as keyof typeof P;
    checkMult(g, `形态·${k}`, shapeCnt[k] / N, (P[key] as { multiplier: number }).multiplier);
  }
}

// ───────────────────────────────────────── 牌桌（固定种子蒙特卡洛）
function shuffled(deck: FaceCard[], random: () => number): FaceCard[] {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function auditTables(rounds: number) {
  const base = freshDeck(1);

  const run = (
    game: string,
    deck: FaceCard[],
    draw: (d: FaceCard[]) => unknown,
    calc: (side: string, o: never, amt: number) => number,
    odds: Record<string, number>,
  ) => {
    const ret: Record<string, number> = {};
    const retSq: Record<string, number> = {};
    const hit: Record<string, number> = {};
    const random = seededRandom(`table:${game}`);
    for (const k of Object.keys(odds)) { ret[k] = 0; retSq[k] = 0; hit[k] = 0; }
    for (let t = 0; t < rounds; t++) {
      const o = draw(shuffled(deck, random));
      for (const k of Object.keys(odds)) {
        const pay = calc(k, o as never, UNIT);
        const x = pay / UNIT;
        ret[k] += x;
        retSq[k] += x * x;
        if (pay > UNIT) hit[k]++;
      }
    }
    for (const k of Object.keys(odds)) {
      /*
       * 炸金花庄闲拿牌完全对称，compareHands 比到花色后恒有胜负，所以双方精确各 50%。
       * 主注若继续用抽样值，闲 1:1 会在 100% 上下随机抖，闸门不是偶红就是放宽过头。
       */
      if (game === '炸金花' && (k === 'banker' || k === 'player')) {
        const exactP = 0.5;
        checkProfit(game, k, exactP, exactP * (1 + odds[k]), odds[k]);
        continue;
      }
      checkProfit(
        game,
        k,
        hit[k] / rounds,
        ret[k] / rounds,
        odds[k],
        standardError(ret[k], retSq[k], rounds),
      );
    }
  };

  const zjh = getTablePayTable('zhajinhua');
  if (zjh?.mode === 'profit-odds') {
    run('炸金花', base, drawZhajinhuaFromDeck, calcZhajinhuaPayout as never, zjh.odds);
  }
  const dn = getTablePayTable('douniu');
  if (dn?.mode === 'profit-odds') {
    run('斗牛', base.concat(base), drawDouniuFromDeck, calcDouniuPayout as never, dn.odds);
  }
  const bjl = getTablePayTable('baccarat');
  if (bjl?.mode === 'profit-odds') {
    const deck8: FaceCard[] = [];
    for (let i = 0; i < 8; i++) deck8.push(...base);
    run('百家乐', deck8, drawBaccaratFromDeck, calcBaccaratPayout as never, bjl.odds);
  }

  /* 龙虎可精确枚举：52 张取 2，按 rank 比大小；开和龙/虎退本 */
  const lhd = getTablePayTable('dragon-tiger');
  if (lhd?.mode === 'profit-odds') {
    let dragonWin = 0, tigerWin = 0, tie = 0, total = 0;
    for (let a = 1; a <= 13; a++) {
      for (let b = 1; b <= 13; b++) {
        const c = a === b ? 4 * 3 : 4 * 4;
        total += c;
        if (a > b) dragonWin += c;
        else if (a < b) tigerWin += c;
        else tie += c;
      }
    }
    const pD = dragonWin / total;
    const pT = tigerWin / total;
    const pTie = tie / total;
    const dRet = 1 + lhd.odds.dragon;
    const tRet = 1 + lhd.odds.tiger;
    const tieRet = 1 + lhd.odds.tie;
    /* 开和退本：龙/虎 EV = pWin*(1+odds) + pTie*1 */
    checkProfit('龙虎', 'dragon(开和退本)', pD, pD * dRet + pTie, lhd.odds.dragon);
    checkProfit('龙虎', 'tiger(开和退本)', pT, pT * tRet + pTie, lhd.odds.tiger);
    checkProfit('龙虎', 'tie', pTie, pTie * tieRet, lhd.odds.tie);
  }
}

// ───────────────────────────────────────── 街机
function auditArcade() {
  /* 奔驰宝马：均押 12 仓，逐奖型算期望返还 */
  const W = BCBM_DEFAULT_AWARD_WEIGHTS;
  const totalAwardW = BCBM_AWARD_TYPES.reduce((s, t) => s + (W[t] ?? 0), 0);
  const nonFree = bcbmNonFreeIndexes();
  const ringW = nonFree.reduce((s, i) => s + BCBM_RING[i].weight, 0);
  const stake = BCBM_BET_SLOTS.length;
  /** 一组命中格 → 按仓位去重后的总赔付倍数 */
  const payOf = (idxs: number[]) => {
    const seen = new Set<string>();
    let s = 0;
    for (const i of idxs) {
      const kind = BCBM_RING[i].kind;
      if (kind === 'free' || seen.has(kind)) continue;
      seen.add(kind);
      s += BCBM_RING[i].mult;
    }
    return s;
  };
  let bcbmTotal = 0;
  for (const t of BCBM_AWARD_TYPES as readonly BcbmAwardType[]) {
    const w = W[t] ?? 0;
    if (w <= 0) continue;
    let ev = 0;
    if (t === 'normal' || t === 'free' || t === 'lightning') {
      for (const i of nonFree) ev += (BCBM_RING[i].weight / ringW) * BCBM_RING[i].mult;
    } else if (t.startsWith('sanyuan_')) {
      ev = payOf(bcbmIndexesOfBrand(t.replace('sanyuan_', '') as BcbmBrandId));
    } else if (t.startsWith('sixi_')) {
      ev = payOf(bcbmIndexesOfColor(t.replace('sixi_', '') as BcbmColorId));
    } else if (t === 'fast' || t === 'uturn') {
      const span = t === 'fast' ? [0, 1, 2, 3, 4] : [-5, 0, 5];
      const L = nonFree.length;
      for (let s = 0; s < L; s++) {
        const wgt = BCBM_RING[nonFree[s]].weight / ringW;
        ev += wgt * payOf(span.map((d) => nonFree[(s + d + L * 5) % L]));
      }
    } else if (t === 'drift') {
      ev = payOf(nonFree);
    }
    bcbmTotal += (w / totalAwardW) * (ev / stake);
  }
  rows.push({
    game: '奔驰宝马', play: '均押12仓·总RTP', p: null,
    current: bcbmTotal, rtp: bcbmTotal, suggest: 0, unit: '倍数',
  });
  for (const s of BCBM_BET_SLOTS) {
    const w = nonFree
      .filter((i) => BCBM_RING[i].kind === s.id)
      .reduce((a, i) => a + BCBM_RING[i].weight, 0);
    checkMult('奔驰宝马·仅normal', s.label, w / ringW, s.mult);
  }

  /* 水果机：蒙特卡洛，命中逻辑与 fruit-machine-engine.resolveHits 对齐 */
  const fruitRounds = Math.max(50_000, Math.floor(Number(process.env.RTP_ROUNDS || 1_000_000) / 5));
  for (const sym of FRUIT_BET_SYMBOLS) {
    let sum = 0;
    let sumSq = 0;
    const random = seededRandom(`fruit:${sym.id}`);
    for (let r = 0; r < fruitRounds; r++) {
      const award = fruitPickAwardType(FRUIT_DEFAULT_AWARD_WEIGHTS, random());
      const { hitIndexes } = fruitResolveHits(award, random);
      let roundPayout = 0;
      for (const i of hitIndexes) {
        const cell = FRUIT_RING[i];
        if (cell?.symbol === (sym.id as FruitBetSymbolId)) roundPayout += cell.mult;
      }
      sum += roundPayout;
      sumSq += roundPayout * roundPayout;
    }
    const ev = sum / fruitRounds;
    rows.push({
      game: '水果机',
      play: sym.label,
      p: null,
      current: ev,
      rtp: ev,
      stderr: standardError(sum, sumSq, fruitRounds),
      suggest: 0,
      unit: '倍数',
    });
  }
}

/** 与 server fruit-machine-engine 同口径（改引擎命中时请同步） */
function fruitWeightedPick(weights: number[], rnd: number): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = 0;
  const target = rnd * total;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]!;
    if (target < acc) return i;
  }
  return weights.length - 1;
}

function fruitPickAwardType(
  weights: Record<FruitAwardType, number>,
  rnd: number,
): FruitAwardType {
  const list = FRUIT_AWARD_TYPES.map((t) => Math.max(0, weights[t] ?? 0));
  return FRUIT_AWARD_TYPES[fruitWeightedPick(list, rnd)]!;
}

function fruitPickWeightedIndex(
  indexes: number[],
  weights: number[],
  random: () => number,
): number {
  const w = indexes.map((i) => Math.max(0, weights[i] ?? 1));
  return indexes[fruitWeightedPick(w, random())]!;
}

function fruitPickOne(indexes: number[], random: () => number): number {
  return indexes[Math.floor(random() * indexes.length) % indexes.length]!;
}

function fruitPickDistinct(
  pool: number[],
  count: number,
  weights: number[],
  random: () => number,
): number[] {
  const left = [...pool];
  const out: number[] = [];
  const n = Math.min(count, left.length);
  for (let i = 0; i < n; i++) {
    const w = left.map((idx) => Math.max(0, weights[idx] ?? 1));
    const pick = fruitWeightedPick(w, random());
    out.push(left[pick]!);
    left.splice(pick, 1);
  }
  return out;
}

function fruitResolveHits(
  awardType: FruitAwardType,
  random: () => number,
): { stopIndex: number; hitIndexes: number[] } {
  const luckIdx = fruitLuckIndexes();
  const nonLuck = fruitNonLuckIndexes();
  const cellWeights = FRUIT_RING.map((c) => Math.max(0, c.weight));

  if (awardType === 'luck_eat') {
    const stopIndex = fruitPickWeightedIndex(luckIdx, cellWeights, random);
    return { stopIndex, hitIndexes: [] };
  }
  if (awardType === 'luck_send') {
    const stopIndex = fruitPickWeightedIndex(luckIdx, cellWeights, random);
    const count = 1 + Math.floor(random() * 5);
    return { stopIndex, hitIndexes: fruitPickDistinct(nonLuck, count, cellWeights, random) };
  }
  if (awardType === 'train') {
    const start = fruitPickWeightedIndex(nonLuck, cellWeights, random);
    const len = 4 + Math.floor(random() * 3);
    const hits: number[] = [];
    for (let i = 0; i < len; i++) {
      const idx = (start + i) % FRUIT_RING.length;
      if (FRUIT_RING[idx]!.size !== 'luck') hits.push(idx);
    }
    return { stopIndex: start, hitIndexes: hits };
  }
  if (awardType === 'big3') {
    const hits = [
      fruitPickOne(fruitBigIndexes('seven'), random),
      fruitPickOne(fruitBigIndexes('star'), random),
      fruitPickOne(fruitBigIndexes('melon'), random),
    ];
    return { stopIndex: hits[0]!, hitIndexes: hits };
  }
  if (awardType === 'small3') {
    const hits = [
      fruitPickOne(fruitBigIndexes('bell'), random),
      fruitPickOne(fruitBigIndexes('lemon'), random),
      fruitPickOne(fruitBigIndexes('orange'), random),
    ];
    return { stopIndex: hits[0]!, hitIndexes: hits };
  }
  if (awardType === 'four') {
    const hits = fruitAppleIndexes();
    return { stopIndex: hits[0] ?? 0, hitIndexes: hits };
  }
  if (awardType === 'slam') {
    return { stopIndex: nonLuck[0] ?? 0, hitIndexes: [...nonLuck] };
  }
  // normal：与引擎一致，只停非 LUCK；送灯/吃灯走独立奖型
  const stopIndex = fruitPickWeightedIndex(nonLuck, cellWeights, random);
  return { stopIndex, hitIndexes: [stopIndex] };
}

// ───────────────────────────────────────── 软控场景仿真（不连接数据库、不改配置）
type SimStats = {
  rounds: number;
  stake: number;
  payout: number;
  returned: number;
  smallWin: number;
  mediumWin: number;
  tenX: number;
  noReturnRun: number;
  maxNoReturnRun: number;
  maxReturnRatio: number;
};

function newSimStats(): SimStats {
  return {
    rounds: 0,
    stake: 0,
    payout: 0,
    returned: 0,
    smallWin: 0,
    mediumWin: 0,
    tenX: 0,
    noReturnRun: 0,
    maxNoReturnRun: 0,
    maxReturnRatio: 0,
  };
}

function observe(stats: SimStats, stake: number, payout: number) {
  stats.rounds++;
  stats.stake += stake;
  stats.payout += payout;
  if (payout > 0) {
    stats.returned++;
    stats.noReturnRun = 0;
  } else {
    stats.noReturnRun++;
    stats.maxNoReturnRun = Math.max(stats.maxNoReturnRun, stats.noReturnRun);
  }
  if (stake > 0) {
    const ratio = payout / stake;
    if (ratio > 1 && ratio < 3) stats.smallWin++;
    else if (ratio >= 3 && ratio < 10) stats.mediumWin++;
    else if (ratio >= 10) stats.tenX++;
    stats.maxReturnRatio = Math.max(stats.maxReturnRatio, ratio);
  }
}

function rtpOf(stats: SimStats): number {
  return stats.payout / Math.max(1, stats.stake);
}

function statSummary(stats: SimStats): string {
  return [
    `RTP=${pct(stats.payout / Math.max(1, stats.stake))}`,
    cadenceSummary(stats),
  ].join('  ');
}

function cadenceSummary(stats: SimStats): string {
  const n = Math.max(1, stats.rounds);
  return [
    `有返还=${pct(stats.returned / n)}`,
    `小奖(1~3倍)=${pct(stats.smallWin / n)}`,
    `中奖(3~10倍)=${pct(stats.mediumWin / n)}`,
    `大奖(≥10倍)=${pct(stats.tenX / n)}`,
    `最长空奖=${stats.maxNoReturnRun}局`,
    `单局最高=${stats.maxReturnRatio.toFixed(1)}倍`,
  ].join('  ');
}

type LotteryAuditBet = { amount: number; payload: LotteryBetPayload };

function settleLotteryAuditBets(
  game: LotteryGameDef,
  payTable: LotteryPayTable,
  draw: ReturnType<LotteryGameDef['draw']>,
  bets: LotteryAuditBet[],
): number {
  let payout = 0;
  for (const bet of bets) {
    const hit = game.judge(bet.payload, draw, payTable);
    if (!hit) continue;
    const multiplier = hit === 'refund'
      ? (payTable[hit]?.multiplier ?? 1)
      : (payTable[hit]?.multiplier ?? 0);
    payout += bet.amount * multiplier;
  }
  return payout;
}

/**
 * 单期总账软控仿真：走线上同一套 decidePeriodGuard / periodCandidateLegal，
 * 只是把「几百人几千玩法」压成一组固定注单来看行为。
 */
function simulateSharedCandidateCoverage(opts: {
  label: string;
  game: LotteryGameDef;
  payTable: LotteryPayTable;
  bets: LotteryAuditBet[];
  rounds: number;
  tries: number;
  /** 本期有效人数：小盘保护要用 */
  playerCount: number;
  /** 该游戏 48h 周期盈利 */
  cycleProfit: number;
  params: PeriodGuardParams;
}) {
  const stats = newSimStats();
  const controlled = newSimStats();
  const stake = opts.bets.reduce((sum, bet) => sum + bet.amount, 0);
  let steered = 0;
  let wipeoutAllowed = 0;
  let changed = 0;
  let fallback = 0;

  for (let round = 0; round < opts.rounds; round++) {
    const seed = deterministicSeed(`shared:${opts.label}`, round);
    const natural = opts.game.draw(seed, 'server', 1);
    const naturalPay = settleLotteryAuditBets(opts.game, opts.payTable, natural, opts.bets);
    observe(stats, stake, naturalPay);

    const guard = decidePeriodGuard({
      periodStake: stake,
      naturalPayout: naturalPay,
      playerCount: opts.playerCount,
      cycleProfit: opts.cycleProfit,
      params: opts.params,
    });
    if (!guard.steer) {
      observe(controlled, stake, naturalPay);
      continue;
    }
    steered++;
    if (guard.allowWipeout) wipeoutAllowed++;

    let bestPay: number | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let nonce = 1; nonce <= opts.tries; nonce++) {
      const draw = nonce === 1 ? natural : opts.game.draw(seed, 'server', nonce);
      const payout = settleLotteryAuditBets(opts.game, opts.payTable, draw, opts.bets);
      if (!periodCandidateLegal({ periodStake: stake, periodPayout: payout, decision: guard })) {
        continue;
      }
      const score = Math.abs(
        ((payout - stake) / stake) * 100 - guard.targetLossPct,
      ) * stake;
      if (score < bestScore) {
        bestScore = score;
        bestPay = payout;
      }
    }
    if (bestPay == null) {
      fallback++;
      observe(controlled, stake, naturalPay);
      continue;
    }
    if (Math.abs(bestPay - naturalPay) > 1e-9) changed++;
    observe(controlled, stake, bestPay);
  }

  return {
    stats,
    controlled,
    steerRate: steered / opts.rounds,
    wipeoutRate: steered > 0 ? wipeoutAllowed / steered : 0,
    changedRate: opts.rounds > 0 ? changed / opts.rounds : 0,
    fallbackRate: steered > 0 ? fallback / steered : 0,
  };
}

type FruitAuditBets = Partial<Record<FruitBetSymbolId, number>>;

function fruitAuditPayout(hitIndexes: number[], bets: FruitAuditBets): number {
  let payout = 0;
  for (const index of hitIndexes) {
    const cell = FRUIT_RING[index];
    if (!cell?.symbol) continue;
    payout += (bets[cell.symbol] ?? 0) * cell.mult;
  }
  return payout;
}

function simulateFruitPool(opts: {
  label: string;
  bets: FruitAuditBets;
  rounds: number;
  controlled: boolean;
  tries: number;
  targetRtp: number;
}) {
  const stats = newSimStats();
  const stake = Object.values(opts.bets).reduce((sum, amount) => sum + (amount ?? 0), 0);
  let poolStake = 0;
  let poolPayout = 0;
  let seedIndex = 0;
  let steered = 0;
  let special = 0;
  const specialAwards = new Set<FruitAwardType>(['train', 'big3', 'small3', 'four', 'slam']);

  for (let round = 0; round < opts.rounds; round++) {
    const runtime: ArcadePoolPickRuntime | null = opts.controlled
      ? {
          needPick: true,
          tries: opts.tries,
          poolStake,
          poolPayout,
          targetRtp: opts.targetRtp,
        }
      : null;
    const clientSeed = `audit:${opts.label}:${round}`;
    const picked = pickSeedForArcadePool({
      runtime,
      stake,
      gen: () => ({
        seed: deterministicSeed(`fruit-pool:${opts.label}:${opts.controlled ? 'on' : 'off'}`, seedIndex++),
        hash: '',
      }),
      simulate: (seed) => {
        let nonce = 0;
        const random = () => deriveRandom(seed, clientSeed, ++nonce);
        const awardType = fruitPickAwardType(FRUIT_DEFAULT_AWARD_WEIGHTS, random());
        const hit = fruitResolveHits(awardType, random);
        return {
          payout: fruitAuditPayout(hit.hitIndexes, opts.bets),
          awardType,
        };
      },
    });

    observe(stats, stake, picked.result.payout);
    poolStake += stake;
    poolPayout += picked.result.payout;
    if (picked.steered) steered++;
    if (specialAwards.has(picked.result.awardType)) special++;
  }

  return {
    stats,
    steeredRate: steered / opts.rounds,
    specialRate: special / opts.rounds,
  };
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function reportControlSimulation(rounds: number) {
  const tries = Math.max(1, Math.floor(envNumber('CONTROL_TRIES', 8)));
  const arcadeTarget = envNumber('ARCADE_RTP_TARGET', 0.92);
  /* 街机试号与共盘分开，默认对齐 GlobalSoftControl.arcadeCandidateTries */
  const arcadeTries = Math.max(1, Math.floor(envNumber('ARCADE_TRIES', 3)));
  const lhcPayTable = lhcPayTableSeed() as unknown as LotteryPayTable;
  const normal = periodGuardParams('NORMAL');
  const recover = periodGuardParams('RECOVER');

  console.log('\n===== 软控能力仿真（仅诊断，不改游戏） =====');
  console.log(
    `固定样本 ${rounds.toLocaleString()} 局；共盘 tries=${tries}；` +
      `单期开档线 ${normal.openLossPct}%、目标亏 ${normal.targetLossPct}%、` +
      `通杀门 ${normal.smallLossAmount}/${normal.bigLossAmount} 元、` +
      `小盘 <${normal.minPlayers}人 或 <${normal.minStake}元 不通杀；` +
      `街机目标 RTP=${pct(arcadeTarget)}，街机 tries=${arcadeTries}`,
  );

  /* 定位胆按每号 1000 元覆盖：验证「买 9 个漏 1 个」不会被定点开缺口 */
  const coverBets = (k: number, unit: number): LotteryAuditBet[] =>
    Array.from({ length: k }, (_, digit) => ({
      amount: unit,
      payload: { betType: 'position', value: `0:${digit}` },
    }));

  const scenarios: Array<{
    label: string;
    result: ReturnType<typeof simulateSharedCandidateCoverage>;
  }> = [
    {
      label: '9盖1·每号1000',
      result: simulateSharedCandidateCoverage({
        label: 'ssc-cover-9',
        game: ffcGame,
        payTable: sscFfcPayTable as unknown as LotteryPayTable,
        bets: coverBets(9, 1000),
        rounds,
        tries,
        playerCount: 1,
        cycleProfit: 500_000,
        params: normal,
      }),
    },
    {
      label: '8盖2·每号1000',
      result: simulateSharedCandidateCoverage({
        label: 'ssc-cover-8',
        game: ffcGame,
        payTable: sscFfcPayTable as unknown as LotteryPayTable,
        bets: coverBets(8, 1000),
        rounds,
        tries,
        playerCount: 1,
        cycleProfit: 500_000,
        params: normal,
      }),
    },
    {
      label: '9盖1·回收档',
      result: simulateSharedCandidateCoverage({
        label: 'ssc-cover-9-recover',
        game: ffcGame,
        payTable: sscFfcPayTable as unknown as LotteryPayTable,
        bets: coverBets(9, 1000),
        rounds,
        tries,
        playerCount: 1,
        cycleProfit: 0,
        params: recover,
      }),
    },
    {
      label: '组三单注1元',
      result: simulateSharedCandidateCoverage({
        label: 'ssc-group3-aab',
        game: ffcGame,
        payTable: sscFfcPayTable as unknown as LotteryPayTable,
        bets: [{ amount: 1, payload: { betType: 'group3', value: '前三:1,1,2' } }],
        rounds,
        tries,
        playerCount: 1,
        cycleProfit: 500_000,
        params: normal,
      }),
    },
    {
      label: '快三三军1元',
      result: simulateSharedCandidateCoverage({
        label: 'kuai3-dice-one',
        game: kuai3Game,
        payTable: kuai3PayTable as unknown as LotteryPayTable,
        bets: [{ amount: 1, payload: { betType: 'dice', value: 1 } }],
        rounds,
        tries,
        playerCount: 1,
        cycleProfit: 500_000,
        params: normal,
      }),
    },
    {
      label: '四全中50·小盘',
      result: simulateSharedCandidateCoverage({
        label: 'lhc-siquan-small',
        game: lhcGame,
        payTable: lhcPayTable,
        bets: [{
          amount: 50,
          payload: {
            betType: 'lianma',
            value: JSON.stringify({ play: '四全中', nums: [1, 2, 3, 4] }),
          },
        }],
        rounds,
        tries,
        playerCount: 1,
        cycleProfit: 500_000,
        params: normal,
      }),
    },
    {
      label: '四全中50·大盘',
      result: simulateSharedCandidateCoverage({
        label: 'lhc-siquan-big',
        game: lhcGame,
        payTable: lhcPayTable,
        bets: [
          {
            amount: 50,
            payload: {
              betType: 'lianma',
              value: JSON.stringify({ play: '四全中', nums: [1, 2, 3, 4] }),
            },
          },
          /* 同期还有 20 个人各押 1000 特码：把盘口做厚，才轮得到通杀那层 */
          ...Array.from({ length: 20 }, (_, i) => ({
            amount: 1000,
            payload: { betType: 'special', value: i + 1 },
          })),
        ],
        rounds,
        tries,
        playerCount: 21,
        cycleProfit: 200_000,
        params: normal,
      }),
    },
  ];

  for (const { label, result } of scenarios) {
    console.log(
      `${label.padEnd(16)} 自然RTP=${pct(rtpOf(result.stats))}  ` +
        `控后RTP=${pct(rtpOf(result.controlled))}  ` +
        `开档=${pct(result.steerRate)}  允许通杀=${pct(result.wipeoutRate)}  ` +
        `改号=${pct(result.changedRate)}  无合法回退=${pct(result.fallbackRate)}`,
    );
  }
  console.log(
    '开档=自然亏超开档线的期数占比；改号=最终真的换了结果的占比。' +
      '覆盖打法（9盖1/8盖2）开档应为 0%，即软控根本不介入，不存在「专开你没买的号」。',
  );

  const appleBets: FruitAuditBets = { apple: 1 };
  const allFruitBets = Object.fromEntries(
    FRUIT_BET_SYMBOLS.map((symbol) => [symbol.id, 1]),
  ) as FruitAuditBets;
  for (const [label, bets] of [
    ['苹果单押', appleBets],
    ['八种水果各押1', allFruitBets],
  ] as const) {
    const natural = simulateFruitPool({
      label,
      bets,
      rounds,
      controlled: false,
      tries: arcadeTries,
      targetRtp: arcadeTarget,
    });
    const controlled = simulateFruitPool({
      label,
      bets,
      rounds,
      controlled: true,
      tries: arcadeTries,
      targetRtp: arcadeTarget,
    });
    console.log(`${label}·自然`.padEnd(18) + statSummary(natural.stats));
    console.log(
      `${label}·池控`.padEnd(18) + statSummary(controlled.stats) +
        `  改种子=${pct(controlled.steeredRate)}  特殊奖=${pct(controlled.specialRate)}`,
    );
  }

  console.log(
    '结论提示：全候选非法会直接回退自然；“有返还”不等于净赢，' +
      '小奖频率、大奖频率与资金 RTP 必须分开验收。',
  );
}

// ───────────────────────────────────────── 输出
function report(): number {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const list = groups.get(r.game) ?? [];
    list.push(r);
    groups.set(r.game, list);
  }
  let hardFailures = 0;
  let warnings = 0;
  for (const [game, list] of groups) {
    const diagnostic = DIAGNOSTIC_GROUPS.has(game);
    console.log('\n===== ' + game + (diagnostic ? '（仅诊断，不判定）' : '') + ' =====');
    for (const r of list) {
      const key = `${r.game}/${r.play}`;
      const standard = INDUSTRY_STANDARD.has(key);
      const shot = SCREENSHOT_ALIGNED.has(key);
      const lowerBound = r.stderr == null ? r.rtp : r.rtp - MC_SIGMA * r.stderr;
      const over = lowerBound > HARD_MAX + 1e-12 && !diagnostic;
      const under = r.rtp < WARN_MIN && !standard && !diagnostic && !shot;
      const mcBorderline = r.stderr != null && r.rtp > HARD_MAX && !over && !diagnostic;
      const thinMargin = r.rtp >= 0.995 && !over && !diagnostic;
      if (over) hardFailures++;
      if (under || mcBorderline || thinMargin) warnings++;
      const flag = over ? '✗ 平台负期望' : under ? '⚠ 低返还'
        : mcBorderline ? '⚠ 抽样临界'
        : thinMargin ? '⚠ 毛利过薄'
        : shot && r.rtp < WARN_MIN ? '· 截图对齐'
        : diagnostic ? '·' : standard ? '✓ 行业标准' : '✓';
      const sug = (over || under) && r.suggest > 0
        ? `  建议${r.unit}=${r.suggest.toFixed(r.suggest > 100 ? 0 : 2)}`
        : '';
      const confidence = r.stderr == null
        ? ''
        : `  4σ=${pct(MC_SIGMA * r.stderr)}`;
      console.log(
        r.play.padEnd(22) +
        ' P=' + (r.p === null ? '   -   ' : pct(r.p).padStart(7)) +
        '  当前=' + r.current.toFixed(3).padStart(9) +
        '  RTP=' + pct(r.rtp).padStart(8) +
        '  ' + flag.padEnd(14) + confidence + sug,
      );
    }
  }
  console.log(
    `\n目标 RTP ${pct(TARGET_RTP)}；低于 ${pct(WARN_MIN)} 仅警告；` +
      `精确值或蒙特卡洛 4σ 下界高于 ${pct(HARD_MAX)} 才硬阻断`,
  );
  console.log(
    hardFailures === 0
      ? `硬阻断 0 项 ✓，警告 ${warnings} 项`
      : `硬阻断 ${hardFailures} 项 ✗，警告 ${warnings} 项`,
  );
  return hardFailures;
}

function main() {
  const args = process.argv.slice(2).map((s) => s.toLowerCase());
  const want = (name: string) => args.length === 0 || args.includes(name);
  /* 牌桌低频边（顺金/豹子/五小牛约 0.1%~0.4% 命中）在 20 万局下抽样误差可达 ±3%，
     默认给到百万局，跑一次约十几秒 */
  const rounds = Number(process.env.RTP_ROUNDS || 1_000_000);
  const controlRounds = Math.max(1_000, Math.floor(envNumber('CONTROL_ROUNDS', 50_000)));
  if (want('lhc')) auditLhc();
  if (want('bjsc')) auditBjsc();
  if (want('kuai3')) auditKuai3();
  if (want('ffc') || want('ssc')) auditFfc();
  if (want('table')) auditTables(rounds);
  if (want('arcade')) auditArcade();
  const hardFailures = rows.length ? report() : 0;
  if (want('control')) reportControlSimulation(controlRounds);
  process.exitCode = hardFailures > 0 ? 1 : 0;
}

main();
