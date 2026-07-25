/**
 * RTP 审计（改任何赔率表后必跑）
 *
 *   pnpm audit:rtp                 # 全量
 *   pnpm audit:rtp lhc kuai3       # 只跑指定游戏
 *   RTP_ROUNDS=1000000 pnpm audit:rtp table
 *
 * 赔率直接 import 服务端与 shared 的唯一来源，不复制数字；
 * 命中概率用精确枚举 / 组合数求解，牌桌用蒙特卡洛（发牌走真实 drawXxxFromDeck）。
 * 任何一项 RTP > 100% 都是平台负期望，玩家可稳定套利。
 *
 * 判定逻辑（judge / calcPayout）改了之后，本文件的概率口径要同步。
 */
import {
  drawBaccaratFromDeck,
  calcBaccaratPayout,
} from '../server/src/modules/table/baccarat.game';
import {
  drawZhajinhuaFromDeck,
  calcZhajinhuaPayout,
} from '../server/src/modules/table/zhajinhua.game';
import { drawDouniuFromDeck, calcDouniuPayout } from '../server/src/modules/table/douniu.game';
import { LHC_ODDS } from '../server/src/modules/lottery/games/lhc-odds';
import { bjscPayTable } from '../server/src/modules/lottery/games/bjsc.game';
import { kuai3PayTable } from '../server/src/modules/lottery/games/kuai3.game';
import { sscFfcPayTable } from '../server/src/modules/lottery/games/ffc.game';
import { freshDeck, type FaceCard } from '../server/src/modules/table/table-cards';
import { generateMahjongOutcome } from '../server/src/modules/game-core/mahjong-math';
import {
  getTablePayTable,
  payoutFromStakeMultCommission,
  BCBM_RING,
  BCBM_BET_SLOTS,
  BCBM_AWARD_TYPES,
  BCBM_DEFAULT_AWARD_WEIGHTS,
  bcbmIndexesOfBrand,
  bcbmIndexesOfColor,
  bcbmNonFreeIndexes,
  FRUIT_RING,
  FRUIT_BET_SYMBOLS,
  FRUIT_DEFAULT_AWARD_WEIGHTS,
  fruitBigIndexes,
  fruitAppleIndexes,
  fruitNonLuckIndexes,
  type BcbmAwardType,
  type BcbmBrandId,
  type BcbmColorId,
} from '@gamebox/shared';

const TARGET_RTP = 0.96;
const PASS_MIN = 0.9;
const PASS_MAX = 1.0;

/**
 * 沿用全球赌场通行赔率、不按 96% 重标的边。
 * 百家乐「和 1:8」「对子 1:11」的高抽水是行业惯例，改掉反而不像百家乐。
 * 仍然受 PASS_MAX 约束：只豁免偏低，不豁免平台负期望。
 */
const INDUSTRY_STANDARD = new Set([
  '百家乐/tie',
  '百家乐/bankerPair',
  '百家乐/playerPair',
]);

/**
 * 只作诊断展示、不参与判定的分组。
 * 奔驰宝马「仅 normal」拆出来是为了看 12 仓是否均衡：12 仓覆盖全部赔付格时
 * 普通开奖 RTP 的数学上限就是 1/Σ(1/倍率)≈83%，缺口由大奖补足，
 * 真正要看的是「均押12仓·总RTP」。
 */
const DIAGNOSTIC_GROUPS = new Set(['奔驰宝马·仅normal', '麻将胡了·诊断']);
/** 蒙特卡洛用大额本金，规避 Math.floor 取整噪声 */
const UNIT = 1_000_000;

const pct = (x: number) => (x * 100).toFixed(2) + '%';

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
/** payout = 本金 + 本金 × profitOdds（牌桌口径） */
function checkProfit(game: string, play: string, p: number, rtp: number, profitOdds: number) {
  rows.push({
    game, play, p, current: profitOdds, rtp,
    suggest: p > 0 ? TARGET_RTP / p - 1 : 0, unit: '利润赔率',
  });
}

/**
 * 一个玩法按结果分多档赔付（三中二、二中特、快三三军）时，
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

  checkMult(g, '特码大(25-49)', 25 / 49, O.big);
  checkMult(g, '特码小(1-24)', 24 / 49, O.small);
  checkMult(g, '特码单(含49)', 25 / 49, O.odd);
  checkMult(g, '特码双', 24 / 49, O.even);
  checkMult(g, '特码号', 1 / 49, O.special);
  checkMult(g, '正码', 6 / 49, O.zhengma);
  checkMult(g, '特码大单', 13 / 49, O.combo);
  checkMult(g, '特码大双/小单/小双', 12 / 49, O.combo);
  checkMult(g, '红波(17号)', 17 / 49, O.colorRed);
  checkMult(g, '蓝波(16号)', 16 / 49, O.colorBlue);
  checkMult(g, '绿波(16号)', 16 / 49, O.colorGreen);
  checkMult(g, '特肖·非本命', 4 / 49, O.zodiac);
  checkMult(g, '特肖·本命', 5 / 49, O.zodiacYear);
  checkMult(g, '平特·非本命', 1 - none(4), O.pingTe);
  checkMult(g, '平特·本命', 1 - none(5), O.pingTeYear);
  checkMult(g, '0尾(4号)', 1 - none(4), O.weiShu0);
  checkMult(g, '1-9尾(5号)', 1 - none(5), O.weiShu);
  checkMult(g, '0尾不中', none(4), O.weiShuMiss0);
  checkMult(g, '1-9尾不中', none(5), O.weiShuMiss);
  checkMult(g, '合数大(>=7)', 25 / 49, O.heSide);
  checkMult(g, '合数小', 24 / 49, O.heSide);
  checkMult(g, '特尾大(5-9)', 25 / 49, O.weiSide);
  checkMult(g, '特尾小(0-4)', 24 / 49, O.weiSideSmall);
  checkMult(g, '六肖·中(24号)', 24 / 49, O.liuxiao);
  checkMult(g, '六肖·不中(25号)', 25 / 49, O.liuxiao);
  checkMult(g, '二全中', (6 / 49) * (5 / 48), O.erQuanZhong);
  checkMult(g, '三全中', comb(6, 3) / comb(49, 3), O.sanQuanZhong);
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
    checkMult(g, `${n}肖不中`, none(4 * n), O[`sxLianBuZhong${n}`]);
  }
  for (const n of [2, 3, 4] as const) {
    checkMult(g, `${n}尾连中`, allHit(n, 5), O[`wsLianZhong${n}`]);
    checkMult(g, `${n}尾不中`, none(5 * n), O[`wsLianBuZhong${n}`]);
  }
  for (const n of [5, 6, 7, 8, 9, 10, 11, 12] as const) {
    checkMult(g, `${n}不中`, none(n), O[`buZhong${n}`]);
  }
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
  let big = 0, small = 0, odd = 0, even = 0;
  for (const key of Object.keys(cnt)) {
    const n = Number(key);
    const c = cnt[n];
    if (n >= 12) big += c; else small += c;
    if (n % 2) odd += c; else even += c;
  }
  checkMult(g, '冠亚和大(12-19)', big / tot, P.top2big.multiplier);
  checkMult(g, '冠亚和小(3-11)', small / tot, P.top2small.multiplier);
  checkMult(g, '冠亚和单', odd / tot, P.top2odd.multiplier);
  checkMult(g, '冠亚和双', even / tot, P.top2even.multiplier);
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
  /* 三军：押一个点数，按出现 1/2/3 次分档赔付 */
  checkTiered(g, '三军(1/2/3次)', [
    { p: p((d) => cntOf(d, 1) === 1), multiplier: P.dice1.multiplier },
    { p: p((d) => cntOf(d, 1) === 2), multiplier: P.dice2.multiplier },
    { p: p((d) => cntOf(d, 1) === 3), multiplier: P.dice3.multiplier },
  ]);
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
    if ((ss[0] === 1 && ss[1] === 1 && ss[2] === 2) || (ss[0] === 1 && ss[1] === 2 && ss[2] === 2)) g3++;
    if (new Set(seg).size === 3 && seg.includes(1) && seg.includes(2) && seg.includes(3)) g6++;
  }

  checkMult(g, '总和大(>=23)', big / N, P.big.multiplier);
  checkMult(g, '总和单', odd / N, P.odd.multiplier);
  checkMult(g, '猜个位', 1 / 10, P.exact.multiplier);
  checkMult(g, '定位胆', 1 / 10, P.position.multiplier);
  checkMult(g, '定位两面', 1 / 2, P.ballSide.multiplier);
  checkMult(g, '不定位', 1 - 0.9 ** 3, P.anyDigit.multiplier);
  checkMult(g, '三星组三(选2码)', g3 / N, P.group3.multiplier);
  checkMult(g, '三星组六(选3码)', g6 / N, P.group6.multiplier);
  checkMult(g, '龙(万>个)', dragon / N, P.dragon.multiplier);
  checkMult(g, '和(万=个)', tie / N, P.tie.multiplier);
  checkMult(g, '无牛', niuCnt[-1] / N, P.noNiu.multiplier);
  checkMult(g, '牛牛(10)', niuCnt[10] / N, P.niu.multiplier);
  checkMult(g, '牛1(最低档)', niuCnt[1] / N, P.niu.multiplier);
  checkMult(g, '牛2(最高档)', niuCnt[2] / N, P.niu.multiplier);
  /* 牛两面：无牛退本，RTP = 命中×赔率 + 无牛×1 */
  let nBig = 0;
  for (let k = 6; k <= 10; k++) nBig += niuCnt[k] / N;
  const push = niuCnt[-1] / N;
  rows.push({
    game: g, play: '牛大(无牛退本)', p: nBig, current: P.niuSide.multiplier,
    rtp: nBig * P.niuSide.multiplier + push,
    suggest: nBig > 0 ? (TARGET_RTP - push) / nBig : 0, unit: '倍数',
  });
  for (const k of Object.keys(shapeCnt)) {
    const key = `shape_${k}` as keyof typeof P;
    checkMult(g, `形态·${k}`, shapeCnt[k] / N, (P[key] as { multiplier: number }).multiplier);
  }
}

// ───────────────────────────────────────── 牌桌（蒙特卡洛）
function shuffled(deck: FaceCard[]): FaceCard[] {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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
    const hit: Record<string, number> = {};
    for (const k of Object.keys(odds)) { ret[k] = 0; hit[k] = 0; }
    for (let t = 0; t < rounds; t++) {
      const o = draw(shuffled(deck));
      for (const k of Object.keys(odds)) {
        const pay = calc(k, o as never, UNIT);
        ret[k] += pay / UNIT;
        if (pay > UNIT) hit[k]++;
      }
    }
    for (const k of Object.keys(odds)) {
      checkProfit(game, k, hit[k] / rounds, ret[k] / rounds, odds[k]);
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

  /* 龙虎可精确枚举：52 张取 2，按 rank 比大小 */
  const lhd = getTablePayTable('dragon-tiger');
  if (lhd?.mode === 'stake-mult-commission') {
    let win = 0, tie = 0, total = 0;
    for (let a = 1; a <= 13; a++) {
      for (let b = 1; b <= 13; b++) {
        const c = a === b ? 4 * 3 : 4 * 4;
        total += c;
        if (a > b) win += c; else if (a === b) tie += c;
      }
    }
    const pWin = win / total;
    const pTie = tie / total;
    const sideRet = payoutFromStakeMultCommission(UNIT, lhd.mult.dragon, lhd.commission) / UNIT;
    checkProfit('龙虎', 'dragon/tiger(开和退本)', pWin, pWin * sideRet + pTie, lhd.mult.dragon);
    const tieRet = payoutFromStakeMultCommission(UNIT, lhd.mult.tie, lhd.commission) / UNIT;
    checkProfit('龙虎', 'tie', pTie, pTie * tieRet, lhd.mult.tie);
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

  /* 水果机：逐符号单押 */
  const FW = FRUIT_DEFAULT_AWARD_WEIGHTS;
  const fTypes = Object.keys(FW) as Array<keyof typeof FW>;
  const fTotalW = fTypes.reduce((s, t) => s + FW[t], 0);
  const fRingW = FRUIT_RING.reduce((s, c) => s + c.weight, 0);
  const nonLuck = fruitNonLuckIndexes();
  for (const sym of FRUIT_BET_SYMBOLS) {
    const multAt = (i: number) => (FRUIT_RING[i].symbol === sym.id ? FRUIT_RING[i].mult : 0);
    let ev = 0;
    for (const t of fTypes) {
      const share = FW[t] / fTotalW;
      let e = 0;
      if (t === 'normal' || t === 'luck_send' || t === 'luck_eat') {
        for (let i = 0; i < FRUIT_RING.length; i++) e += (FRUIT_RING[i].weight / fRingW) * multAt(i);
      } else if (t === 'slam') {
        e = nonLuck.reduce((s, i) => s + multAt(i), 0);
      } else if (t === 'train') {
        for (let s0 = 0; s0 < nonLuck.length; s0++) {
          let sub = 0;
          for (let n = 0; n < 5; n++) sub += multAt(nonLuck[(s0 + n) % nonLuck.length]);
          e += sub / nonLuck.length;
        }
      } else {
        const group =
          t === 'four' ? fruitAppleIndexes()
            : t === 'big3' ? ['bar', 'seven', 'star'].flatMap((s) => fruitBigIndexes(s as never))
              : ['melon', 'bell', 'lemon'].flatMap((s) => fruitBigIndexes(s as never));
        e = group.reduce((s, i) => s + multAt(i), 0);
      }
      ev += share * e;
    }
    rows.push({
      game: '水果机', play: sym.label, p: null, current: ev, rtp: ev, suggest: 0, unit: '倍数',
    });
  }
}

// ───────────────────────────────────────── 麻将胡了（含级联与免费局）
function auditMahjong(rounds: number) {
  const BET = 2000; // 100 × 基准注 20，规避逐符号 Math.floor 的取整噪声
  let staked = 0;
  let won = 0;
  let freeSpins = 0;
  let triggers = 0;
  let cascadeSteps = 0;

  for (let i = 0; i < rounds; i++) {
    staked += BET;
    const base = generateMahjongOutcome({
      amount: BET,
      isFree: false,
      rawConfig: null,
      random: Math.random,
    });
    won += base.totalWin;
    cascadeSteps += base.cascades.length;

    /* 免费局：不再扣注，倍率阶梯更高，且可重触发 */
    let remaining = base.spinsAwarded;
    if (remaining > 0) triggers++;
    let guard = 0;
    while (remaining > 0 && guard++ < 500) {
      remaining--;
      freeSpins++;
      const free = generateMahjongOutcome({
        amount: BET,
        isFree: true,
        rawConfig: null,
        random: Math.random,
      });
      won += free.totalWin;
      remaining += free.spinsAwarded;
    }
  }

  const rtp = won / staked;
  rows.push({
    game: '麻将胡了', play: '总RTP(含免费局)', p: null,
    current: rtp, rtp, suggest: 0, unit: '倍数',
  });
  const diag = (play: string, p: number | null, value: number) =>
    rows.push({ game: '麻将胡了·诊断', play, p, current: value, rtp: 1, suggest: 0, unit: '倍数' });
  diag('免费局触发率', triggers / rounds, triggers / rounds);
  diag('每局附赠免费局数', null, freeSpins / rounds);
  diag('每局平均级联步数', null, cascadeSteps / rounds);
}

// ───────────────────────────────────────── 输出
function report(): number {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const list = groups.get(r.game) ?? [];
    list.push(r);
    groups.set(r.game, list);
  }
  let bad = 0;
  for (const [game, list] of groups) {
    const diagnostic = DIAGNOSTIC_GROUPS.has(game);
    console.log('\n===== ' + game + (diagnostic ? '（仅诊断，不判定）' : '') + ' =====');
    for (const r of list) {
      const standard = INDUSTRY_STANDARD.has(`${r.game}/${r.play}`);
      const over = r.rtp > PASS_MAX && !diagnostic;
      const under = r.rtp < PASS_MIN && !standard && !diagnostic;
      if (over || under) bad++;
      const flag = over ? '✗ 平台负期望' : under ? '✗ 偏离目标'
        : diagnostic ? '·' : standard ? '✓ 行业标准' : '✓';
      const sug = (over || under) && r.suggest > 0
        ? `  建议${r.unit}=${r.suggest.toFixed(r.suggest > 100 ? 0 : 2)}`
        : '';
      console.log(
        r.play.padEnd(22) +
        ' P=' + (r.p === null ? '   -   ' : pct(r.p).padStart(7)) +
        '  当前=' + r.current.toFixed(3).padStart(9) +
        '  RTP=' + pct(r.rtp).padStart(8) +
        '  ' + flag.padEnd(14) + sug,
      );
    }
  }
  console.log(`\n目标 RTP ${pct(TARGET_RTP)}，合格区间 ${pct(PASS_MIN)}~${pct(PASS_MAX)}`);
  console.log(bad === 0 ? '全部通过 ✓' : `不合格 ${bad} 项 ✗`);
  return bad;
}

function main() {
  const args = process.argv.slice(2).map((s) => s.toLowerCase());
  const want = (name: string) => args.length === 0 || args.includes(name);
  /* 牌桌低频边（顺金/豹子/五小牛约 0.1%~0.4% 命中）在 20 万局下抽样误差可达 ±3%，
     默认给到百万局，跑一次约十几秒 */
  const rounds = Number(process.env.RTP_ROUNDS || 1_000_000);
  if (want('lhc')) auditLhc();
  if (want('bjsc')) auditBjsc();
  if (want('kuai3')) auditKuai3();
  if (want('ffc') || want('ssc')) auditFfc();
  if (want('table')) auditTables(rounds);
  if (want('arcade')) auditArcade();
  if (want('mahjong')) auditMahjong(Math.min(rounds, 200_000));
  process.exitCode = report() > 0 ? 1 : 0;
}

main();
