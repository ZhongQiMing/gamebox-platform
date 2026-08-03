import * as crypto from 'crypto';
import type { Card, DragonTigerOutcome } from './table.types';
import { getTablePayTable, payoutFromProfitOdds } from '@gamebox/shared';

const SUITS: Card['suit'][] = ['S', 'H', 'D', 'C'];

/** 生成 52 张牌的完整牌组 */
function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let r = 1; r <= 13; r++) {
      deck.push({ suit, rank: r });
    }
  }
  return deck;
}

/** 用 serverSeed + nonce Fisher-Yates 洗牌（可证明公平） */
export function drawCards(serverSeed: string, nonce: number): DragonTigerOutcome {
  const deck = freshDeck();
  const combined = `${serverSeed}:${nonce}`;

  // 用 HMAC-SHA256 逐步生成随机字节 → 归一到 [0,1)
  for (let i = deck.length - 1; i > 0; i--) {
    const hmac = crypto.createHmac('sha256', combined);
    hmac.update(i.toString());
    const hex = hmac.digest('hex').slice(0, 8);
    /* 直接取模：避免 /0xffffffff 满值时 rnd=1 导致 j 越界 */
    const j = parseInt(hex, 16) % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const dragon = deck[0];
  const tiger = deck[1];

  // A=1 最小，K=13 最大；平局（rank 相同）赔率特殊
  let winner: DragonTigerOutcome['winner'];
  if (dragon.rank > tiger.rank) winner = 'DRAGON';
  else if (tiger.rank > dragon.rank) winner = 'TIGER';
  else winner = 'TIE';

  return { dragon, tiger, winner };
}

/** 赢利抽水与倍数见 @gamebox/shared TABLE_PAYTABLE */

/**
 * 结算返还（含本金）：
 * - 龙 1:0.95 / 虎 1:1 / 和 1:8（利润倍率，见 TABLE_PAYTABLE）
 * - 开和时：龙/虎注全退
 * - 买错：×0
 */
export function calcPayout(side: string, outcome: DragonTigerOutcome, amount: number): number {
  const pt = getTablePayTable('dragon-tiger');
  const oddsMap = pt && pt.mode === 'profit-odds' ? pt.odds : {};

  if (side === outcome.winner) {
    const odds = oddsMap[side] ?? (side === 'TIE' ? 8 : side === 'DRAGON' ? 0.95 : 1);
    return payoutFromProfitOdds(amount, odds);
  }
  if (outcome.winner === 'TIE' && side !== 'TIE') {
    return amount; // 开和全退
  }
  return 0;
}
