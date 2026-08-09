import { FaceCard, freshDeck, shuffleDeck } from './table-cards';
import { getTablePayTable, payoutForTableSide } from '@gamebox/shared';

export type DouniuSide =
  | 'banker'
  | 'player'
  | 'small'
  | 'niuniu'
  | 'niu79'
  | 'niu06'
  | 'flower';

export interface DnCard extends FaceCard {
  niuVal: number;
  val: number;
}

export interface DnHandEval {
  type: 'small' | 'bomb' | 'flower' | 'niuniu' | 'niu' | 'none';
  label: string;
  tier: number;
  niu: number;
  special: 'small' | 'bomb' | 'flower' | null;
  tenIdx: number[] | null;
  restIdx?: number[];
}

export interface DouniuOutcome {
  game: 'douniu';
  banker: DnCard[];
  player: DnCard[];
  result: 'banker' | 'player';
  bankerType: DnHandEval;
  playerType: DnHandEval;
}

function dnOdds(): Record<string, number> {
  const pt = getTablePayTable('douniu');
  return pt && pt.mode === 'profit-odds' ? pt.odds : {};
}

const SUIT_POWER: Record<FaceCard['suit'], number> = {
  spade: 4,
  heart: 3,
  club: 2,
  diamond: 1,
};

function makeCard(c: FaceCard): DnCard {
  const niuVal =
    c.rank === 'A'
      ? 1
      : c.rank === 'J' || c.rank === 'Q' || c.rank === 'K' || c.rank === '10'
        ? 10
        : parseInt(c.rank, 10);
  const val =
    c.rank === 'A'
      ? 1
      : c.rank === 'K'
        ? 13
        : c.rank === 'Q'
          ? 12
          : c.rank === 'J'
            ? 11
            : parseInt(c.rank, 10);
  return { ...c, niuVal, val };
}

function isFlower(cards: DnCard[]) {
  return cards.every((c) => c.rank === 'J' || c.rank === 'Q' || c.rank === 'K');
}

function isBomb(cards: DnCard[]) {
  const counts: Record<string, number> = {};
  for (const c of cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
  return Object.values(counts).some((n) => n === 4);
}

function isSmallBull(cards: DnCard[]) {
  if (cards.some((c) => c.niuVal > 5)) return false;
  return cards.reduce((s, c) => s + c.niuVal, 0) <= 10;
}

export function evalDnHand(cards: DnCard[]): DnHandEval {
  if (isSmallBull(cards)) {
    return { type: 'small', label: '五小牛', tier: 100, niu: 11, special: 'small', tenIdx: null };
  }
  if (isBomb(cards)) {
    return { type: 'bomb', label: '炸弹牛', tier: 90, niu: 11, special: 'bomb', tenIdx: null };
  }
  if (isFlower(cards)) {
    return { type: 'flower', label: '五花牛', tier: 80, niu: 11, special: 'flower', tenIdx: null };
  }
  const vals = cards.map((c) => c.niuVal);
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (let k = j + 1; k < 5; k++) {
        const s = vals[i] + vals[j] + vals[k];
        if (s % 10 === 0) {
          const restIdx: number[] = [];
          for (let idx = 0; idx < 5; idx++) {
            if (idx !== i && idx !== j && idx !== k) restIdx.push(idx);
          }
          const n = (vals[restIdx[0]] + vals[restIdx[1]]) % 10;
          const niu = n === 0 ? 10 : n;
          return {
            type: niu === 10 ? 'niuniu' : 'niu',
            label: niu === 10 ? '牛牛' : `牛${niu}`,
            tier: 70 + niu,
            niu,
            special: null,
            tenIdx: [i, j, k],
            restIdx,
          };
        }
      }
    }
  }
  return { type: 'none', label: '无牛', tier: 0, niu: 0, special: null, tenIdx: null };
}

function maxCard(cards: DnCard[]): DnCard {
  return cards.slice().sort((a, b) => {
    if (b.val !== a.val) return b.val - a.val;
    return (SUIT_POWER[b.suit] || 0) - (SUIT_POWER[a.suit] || 0);
  })[0];
}

function compareHands(aEval: DnHandEval, bEval: DnHandEval, aCards: DnCard[], bCards: DnCard[]): number {
  if (aEval.tier !== bEval.tier) return aEval.tier > bEval.tier ? 1 : -1;
  const ac = maxCard(aCards);
  const bc = maxCard(bCards);
  if (ac.val !== bc.val) return ac.val > bc.val ? 1 : -1;
  const ap = SUIT_POWER[ac.suit] || 0;
  const bp = SUIT_POWER[bc.suit] || 0;
  if (ap !== bp) return ap > bp ? 1 : -1;
  return 1; // 斗牛无和局：完全相同算庄赢
}

function handHitsSide(ev: DnHandEval, key: string): boolean {
  if (key === 'small') return ev.special === 'small';
  if (key === 'flower') return ev.special === 'flower';
  if (key === 'niuniu') return ev.special == null && ev.niu === 10;
  if (key === 'niu79') return ev.special == null && ev.niu >= 7 && ev.niu <= 9;
  if (key === 'niu06') return ev.special == null && ev.niu >= 0 && ev.niu <= 6;
  return false;
}

function sideBetHit(key: string, bt: DnHandEval, pt: DnHandEval, result: DouniuOutcome['result']) {
  if (result === 'banker') return handHitsSide(bt, key);
  if (result === 'player') return handHitsSide(pt, key);
  return handHitsSide(bt, key) || handHitsSide(pt, key);
}

export function drawDouniu(serverSeed: string, nonce: number): DouniuOutcome {
  return drawDouniuFromDeck(shuffleDeck(freshDeck(2), serverSeed, nonce));
}

/** 按已洗好的牌堆发牌（RTP 审计 / 单测入口） */
export function drawDouniuFromDeck(raw: FaceCard[]): DouniuOutcome {
  const deck = raw.map(makeCard);
  const banker = [deck[0], deck[2], deck[4], deck[6], deck[8]];
  const player = [deck[1], deck[3], deck[5], deck[7], deck[9]];
  const bankerType = evalDnHand(banker);
  const playerType = evalDnHand(player);
  const cmp = compareHands(bankerType, playerType, banker, player);
  const result = cmp > 0 ? 'banker' : 'player';
  return { game: 'douniu', banker, player, result, bankerType, playerType };
}

export function calcDouniuPayout(side: string, outcome: DouniuOutcome, amount: number): number {
  const odds = dnOdds()[side];
  if (typeof odds !== 'number') return 0;
  let win: boolean;
  if (side === 'banker') win = outcome.result === 'banker';
  else if (side === 'player') win = outcome.result === 'player';
  else win = sideBetHit(side, outcome.bankerType, outcome.playerType, outcome.result);
  if (win) return payoutForTableSide('douniu', side, amount);
  return 0;
}

export const DOUNIU_SIDES: DouniuSide[] = [
  'banker',
  'player',
  'small',
  'niuniu',
  'niu79',
  'niu06',
  'flower',
];

export const DOUNIU_ODDS = dnOdds();
