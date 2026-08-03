import { FaceCard, freshDeck, shuffleDeck } from './table-cards';
import { getTablePayTable, payoutFromProfitOdds } from '@gamebox/shared';

export type ZhajinhuaSide =
  | 'banker'
  | 'player'
  | 'shunjin'
  | 'baozi'
  | 'san2'
  | 'san3'
  | 'san6'
  | 'san7';

export interface ZjhHandEval {
  type: 'leopard' | 'straight-flush' | 'flush' | 'straight' | 'pair' | 'high';
  label: string;
  score: number;
  vals: number[];
}

export interface ZhajinhuaOutcome {
  game: 'zhajinhua';
  banker: FaceCard[];
  player: FaceCard[];
  result: 'banker' | 'player';
  bankerType: ZjhHandEval;
  playerType: ZjhHandEval;
}

/** 黑桃 > 红心 > 梅花 > 方块 */
const SUIT_POWER: Record<FaceCard['suit'], number> = {
  spade: 4,
  heart: 3,
  club: 2,
  diamond: 1,
};

function zjhOdds(): Record<string, number> {
  const pt = getTablePayTable('zhajinhua');
  return pt && pt.mode === 'profit-odds' ? pt.odds : {};
}

function cardValue(rank: FaceCard['rank']): number {
  if (rank === 'A') return 14;
  if (rank === 'K') return 13;
  if (rank === 'Q') return 12;
  if (rank === 'J') return 11;
  return parseInt(rank, 10);
}

export function evalZjhHand(cards: FaceCard[]): ZjhHandEval {
  const vals = cards.map((c) => cardValue(c.rank)).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits[0] === suits[1] && suits[1] === suits[2];
  const uniq: number[] = [];
  for (const v of vals) if (!uniq.includes(v)) uniq.push(v);
  const sorted = vals.slice().sort((a, b) => a - b);
  let isStraight = false;
  if (uniq.length === 3) {
    isStraight = sorted[2] - sorted[1] === 1 && sorted[1] - sorted[0] === 1;
    if (!isStraight && sorted.join(',') === '2,3,14') isStraight = true;
  }
  if (uniq.length === 1) return { type: 'leopard', label: '豹子', score: 6, vals };
  if (isFlush && isStraight) return { type: 'straight-flush', label: '顺金', score: 5, vals };
  if (isFlush) return { type: 'flush', label: '金花', score: 4, vals };
  if (isStraight) {
    const svals = sorted.join(',') === '2,3,14' ? [3, 2, 1] : vals;
    return { type: 'straight', label: '顺子', score: 3, vals: svals };
  }
  if (uniq.length === 2) {
    const pairVal = vals[0] === vals[1] ? vals[0] : vals[1];
    const kicker = vals[0] === vals[1] ? vals[2] : vals[0];
    return { type: 'pair', label: '对子', score: 2, vals: [pairVal, kicker, 0] };
  }
  return { type: 'high', label: '散牌', score: 1, vals };
}

/** vals 中的 1 表示 A-2-3 顺子里的 A */
function valToRankNum(v: number): number {
  return v === 1 ? 14 : v;
}

function bestSuitAtValue(cards: FaceCard[], val: number): number {
  let best = 0;
  for (const c of cards) {
    if (cardValue(c.rank) === val) best = Math.max(best, SUIT_POWER[c.suit]);
  }
  return best;
}

/** 点数相同比花色；单副牌下恒有胜负 */
function compareBySuit(aCards: FaceCard[], bCards: FaceCard[], evalA: ZjhHandEval): number {
  if (evalA.type === 'pair') {
    const pairVal = evalA.vals[0];
    const kicker = evalA.vals[1];
    const pa = bestSuitAtValue(aCards, pairVal);
    const pb = bestSuitAtValue(bCards, pairVal);
    if (pa !== pb) return pa > pb ? 1 : -1;
    const ka = bestSuitAtValue(aCards, kicker);
    const kb = bestSuitAtValue(bCards, kicker);
    if (ka !== kb) return ka > kb ? 1 : -1;
    return 0;
  }
  for (let i = 0; i < 3; i++) {
    const v = evalA.vals[i];
    if (!v) continue;
    const rv = valToRankNum(v);
    const sa = bestSuitAtValue(aCards, rv);
    const sb = bestSuitAtValue(bCards, rv);
    if (sa !== sb) return sa > sb ? 1 : -1;
  }
  return 0;
}

export function compareHands(
  a: ZjhHandEval,
  b: ZjhHandEval,
  aCards: FaceCard[],
  bCards: FaceCard[],
): number {
  if (a.score !== b.score) return a.score > b.score ? 1 : -1;
  for (let i = 0; i < 3; i++) {
    if (a.vals[i] !== b.vals[i]) return a.vals[i] > b.vals[i] ? 1 : -1;
  }
  const bySuit = compareBySuit(aCards, bCards, a);
  if (bySuit !== 0) return bySuit;
  /* 理论上不会到这；兜底庄赢，保证无和局 */
  return 1;
}

function sideBetHit(
  key: string,
  bt: ZjhHandEval,
  pt: ZjhHandEval,
  result: ZhajinhuaOutcome['result'],
): boolean {
  const need =
    key === 'baozi'
      ? 'leopard'
      : key === 'shunjin'
        ? 'straight-flush'
        : key === 'san7'
          ? 'flush'
          : key === 'san6'
            ? 'straight'
            : key === 'san3'
              ? 'pair'
              : key === 'san2'
                ? 'high'
                : null;
  if (!need) return false;
  if (result === 'banker') return bt.type === need;
  if (result === 'player') return pt.type === need;
  return false;
}

export function drawZhajinhua(serverSeed: string, nonce: number): ZhajinhuaOutcome {
  return drawZhajinhuaFromDeck(shuffleDeck(freshDeck(1), serverSeed, nonce));
}

/** 按已洗好的牌堆发牌（RTP 审计 / 单测入口） */
export function drawZhajinhuaFromDeck(deck: FaceCard[]): ZhajinhuaOutcome {
  const banker = [deck[0], deck[2], deck[4]];
  const player = [deck[1], deck[3], deck[5]];
  const bankerType = evalZjhHand(banker);
  const playerType = evalZjhHand(player);
  const cmp = compareHands(bankerType, playerType, banker, player);
  const result = cmp >= 0 ? 'banker' : 'player';
  return { game: 'zhajinhua', banker, player, result, bankerType, playerType };
}

export function calcZhajinhuaPayout(side: string, outcome: ZhajinhuaOutcome, amount: number): number {
  const oddsMap = zjhOdds();
  const odds = oddsMap[side];
  if (typeof odds !== 'number') return 0;
  let win = false;
  if (side === 'banker') win = outcome.result === 'banker';
  else if (side === 'player') win = outcome.result === 'player';
  else win = sideBetHit(side, outcome.bankerType, outcome.playerType, outcome.result);

  if (win) return payoutFromProfitOdds(amount, odds);
  return 0;
}

export const ZHAJINHUA_SIDES: ZhajinhuaSide[] = [
  'banker',
  'player',
  'shunjin',
  'baozi',
  'san2',
  'san3',
  'san6',
  'san7',
];

export const ZHAJINHUA_ODDS = zjhOdds();
