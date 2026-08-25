import { asMoney, roundMoney } from '@gamebox/shared';
import type { OwnerType } from '../points/points.types';

type FlySnap = {
  flying?: unknown;
  sitting?: unknown;
  P?: unknown;
  agentUserId?: unknown;
  generalUserId?: unknown;
  playerHeld?: unknown;
};

export type RebateClaimPart = {
  type: OwnerType;
  id: string;
  amount: number;
  label: string;
};

/**
 * 玩家回水入账户时谁出。
 * 关盘局结已从庄家盘分预扣的，领取只从待入账出，不再扣盘分。
 * 老关盘没预扣的，仍由当时的庄家出。
 */
export function splitRebateClaimPayers(opts: {
  bets: Array<{ payload?: unknown; validFlow: unknown }>;
  totalAmount: number;
  platformId: string;
  house: {
    flying?: boolean;
    type?: string;
    id?: string;
    agentUserId?: string;
    generalUserId?: string;
  };
}): RebateClaimPart[] {
  const { totalAmount, platformId, house } = opts;
  if (totalAmount <= 0) return [];

  const houseAgent = house.agentUserId || (house.type === 'AGENT' ? house.id : '') || '';
  const houseGeneral = house.generalUserId || '';
  const buckets = new Map<string, RebateClaimPart>();

  const add = (type: OwnerType, id: string, label: string, amount: number) => {
    if (amount <= 0 || !id) return;
    const key = `${label}:${id}`;
    const prev = buckets.get(key);
    if (prev) prev.amount = roundMoney(prev.amount + amount);
    else buckets.set(key, { type, id, amount: roundMoney(amount), label });
  };

  for (const bet of opts.bets) {
    const fly = (bet.payload as { fly?: FlySnap } | null | undefined)?.fly;
    const flow = asMoney(bet.validFlow);
    const p = Number(fly?.P);
    const part = flow * (Number.isFinite(p) && p > 0 ? p : 0);
    if (part <= 0) continue;

    const sitting = String(fly?.sitting || '');
    const flying = fly?.flying === true || sitting === 'PLATFORM';
    if (fly?.playerHeld === true) {
      add('PLATFORM', platformId, 'held', part);
      continue;
    }
    if (flying) {
      add('PLATFORM', platformId, 'fly', part);
      continue;
    }
    if (sitting === 'GENERAL') {
      const generalId = String(fly?.generalUserId || houseGeneral || '').trim();
      if (generalId) {
        add('AGENT', generalId, 'general', part);
        continue;
      }
    }
    const agentId = String(fly?.agentUserId || houseAgent || '').trim();
    if (agentId) add('AGENT', agentId, 'agent', part);
    else add('PLATFORM', platformId, 'fly', part);
  }

  const rawParts = [...buckets.values()];
  const raw = rawParts.reduce((s, r) => s + r.amount, 0);
  if (!rawParts.length) {
    if (house.flying) {
      return [{ type: 'PLATFORM', id: platformId, amount: totalAmount, label: 'fly' }];
    }
    if (houseAgent) {
      return [{ type: 'AGENT', id: houseAgent, amount: totalAmount, label: 'agent' }];
    }
    return [{ type: 'PLATFORM', id: platformId, amount: totalAmount, label: 'fly' }];
  }
  if (raw <= 0) return rawParts;

  let used = 0;
  return rawParts.map((row, i) => {
    const amount = i === rawParts.length - 1
      ? roundMoney(totalAmount - used)
      : roundMoney((totalAmount * row.amount) / raw);
    used = roundMoney(used + amount);
    return { ...row, amount };
  }).filter((row) => row.amount > 0);
}
