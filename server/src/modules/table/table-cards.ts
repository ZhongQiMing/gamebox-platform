import * as crypto from 'crypto';

export type SuitName = 'spade' | 'heart' | 'club' | 'diamond';
export type RankName = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface FaceCard {
  suit: SuitName;
  rank: RankName;
}

export const SUITS: SuitName[] = ['spade', 'heart', 'club', 'diamond'];
export const RANKS: RankName[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function freshDeck(decks = 1): FaceCard[] {
  const deck: FaceCard[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) deck.push({ suit, rank });
    }
  }
  return deck;
}

/** HMAC-SHA256 Fisher-Yates，可证明公平 */
export function shuffleDeck(deck: FaceCard[], serverSeed: string, nonce: number): FaceCard[] {
  const out = deck.slice();
  const combined = `${serverSeed}:${nonce}`;
  for (let i = out.length - 1; i > 0; i--) {
    const hmac = crypto.createHmac('sha256', combined);
    hmac.update(String(i));
    const hex = hmac.digest('hex').slice(0, 8);
    /* 直接取模：避免 /0xffffffff 在满值时得到 rnd=1，floor 后 j=i+1 越界 */
    const j = parseInt(hex, 16) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function rankToNumber(rank: RankName): number {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return parseInt(rank, 10);
}

export function numberToRank(n: number): RankName {
  if (n === 1) return 'A';
  if (n === 11) return 'J';
  if (n === 12) return 'Q';
  if (n === 13) return 'K';
  return String(n) as RankName;
}

const SUIT_TO_LEGACY: Record<SuitName, 'S' | 'H' | 'D' | 'C'> = {
  spade: 'S',
  heart: 'H',
  diamond: 'D',
  club: 'C',
};

const LEGACY_TO_SUIT: Record<'S' | 'H' | 'D' | 'C', SuitName> = {
  S: 'spade',
  H: 'heart',
  D: 'diamond',
  C: 'club',
};

export function toLegacyDtCard(c: FaceCard): { suit: 'S' | 'H' | 'D' | 'C'; rank: number } {
  return { suit: SUIT_TO_LEGACY[c.suit], rank: rankToNumber(c.rank) };
}

export function fromLegacyDtCard(c: { suit: 'S' | 'H' | 'D' | 'C'; rank: number }): FaceCard {
  return { suit: LEGACY_TO_SUIT[c.suit], rank: numberToRank(c.rank) };
}
