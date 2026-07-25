import { FaceCard, freshDeck, shuffleDeck } from './table-cards';
import { getTablePayTable, payoutFromProfitOdds } from '@gamebox/shared';

export type BaccaratSide = 'banker' | 'player' | 'tie' | 'bankerPair' | 'playerPair';

export interface BaccaratOutcome {
  game: 'baccarat';
  player: FaceCard[];
  banker: FaceCard[];
  result: 'banker' | 'player' | 'tie';
  bankerPoint: number;
  playerPoint: number;
  bankerPair: boolean;
  playerPair: boolean;
  natural: boolean;
  playerDrew: boolean;
  bankerDrew: boolean;
}

function cardPoint(rank: FaceCard['rank']): number {
  if (rank === 'A') return 1;
  if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 0;
  return parseInt(rank, 10);
}

function handPoint(cards: FaceCard[]): number {
  let s = 0;
  for (const c of cards) s += cardPoint(c.rank);
  return s % 10;
}

function playerNeedsDraw(pp: number) {
  return pp <= 5;
}

function bankerNeedsDraw(bp: number, playerDrew: boolean, p3Point: number | null) {
  if (bp <= 2) return true;
  if (bp === 7) return false;
  if (!playerDrew) return bp <= 5;
  if (bp === 3) return p3Point !== 8;
  if (bp === 4) return p3Point !== 0 && p3Point !== 1 && p3Point !== 8 && p3Point !== 9;
  if (bp === 5) return p3Point === 4 || p3Point === 5 || p3Point === 6 || p3Point === 7;
  if (bp === 6) return p3Point === 6 || p3Point === 7;
  return false;
}

export function drawBaccarat(serverSeed: string, nonce: number): BaccaratOutcome {
  return drawBaccaratFromDeck(shuffleDeck(freshDeck(8), serverSeed, nonce));
}

/** 按已洗好的牌堆发牌（RTP 审计 / 单测入口） */
export function drawBaccaratFromDeck(deck: FaceCard[]): BaccaratOutcome {
  const player: FaceCard[] = [deck[0], deck[2]];
  const banker: FaceCard[] = [deck[1], deck[3]];
  let next = 4;
  let pp = handPoint(player);
  let bp = handPoint(banker);
  const natural = pp >= 8 || bp >= 8;
  let playerDrew = false;
  let bankerDrew = false;
  let p3Point: number | null = null;

  if (!natural) {
    if (playerNeedsDraw(pp)) {
      player.push(deck[next++]);
      playerDrew = true;
      p3Point = cardPoint(player[2].rank);
      pp = handPoint(player);
    }
    if (bankerNeedsDraw(bp, playerDrew, p3Point)) {
      banker.push(deck[next++]);
      bankerDrew = true;
      bp = handPoint(banker);
    }
  }

  const result = bp > pp ? 'banker' : pp > bp ? 'player' : 'tie';
  return {
    game: 'baccarat',
    player,
    banker,
    result,
    bankerPoint: bp,
    playerPoint: pp,
    bankerPair: banker[0].rank === banker[1].rank,
    playerPair: player[0].rank === player[1].rank,
    natural,
    playerDrew,
    bankerDrew,
  };
}

export function calcBaccaratPayout(side: string, outcome: BaccaratOutcome, amount: number): number {
  const pt = getTablePayTable('baccarat');
  const odds = pt && pt.mode === 'profit-odds' ? pt.odds : {};
  if (side === 'banker' && outcome.result === 'banker') {
    return payoutFromProfitOdds(amount, odds.banker ?? 0.95);
  }
  if (side === 'player' && outcome.result === 'player') {
    return payoutFromProfitOdds(amount, odds.player ?? 1);
  }
  if (side === 'tie' && outcome.result === 'tie') {
    return payoutFromProfitOdds(amount, odds.tie ?? 8);
  }
  if (side === 'bankerPair' && outcome.bankerPair) {
    return payoutFromProfitOdds(amount, odds.bankerPair ?? 11);
  }
  if (side === 'playerPair' && outcome.playerPair) {
    return payoutFromProfitOdds(amount, odds.playerPair ?? 11);
  }
  if ((side === 'banker' || side === 'player') && outcome.result === 'tie') {
    return amount;
  }
  return 0;
}

export const BACCARAT_SIDES: BaccaratSide[] = [
  'banker',
  'player',
  'tie',
  'bankerPair',
  'playerPair',
];
