/**
 * 奔驰宝马中奖灯位：亮的格子必须就是派了钱的格子。
 *
 * 服务端在 26 格灯环上算命中（含 2 个免费格），前端转盘只有 24 个可押格。
 * 两边索引空间不同，只能用 bcbmRingIndexesToCarPositions 换算。
 * 前端曾自己按 `(carPos + n) % 24` 重算，激情狂飙 / U 型弯道会把灯亮到
 * 转盘对面另一圈的格子上——钱是对的，灯是错的，玩家会以为少赔了。
 */
import {
  BCBM_DISPLAY_PLAYTYPE_BY_BET,
  BCBM_RING,
  bcbmIndexesOfBrand,
  bcbmIndexesOfColor,
  bcbmNonFreeIndexes,
  bcbmRingIndexesToCarPositions,
  isBcbmBetId,
  type BcbmBetId,
} from '@gamebox/shared';

/** carPos → 押注仓位：playType = 11 - (carPos % 12)，再反查仓位 id */
const BET_BY_PLAYTYPE = new Map<number, BcbmBetId>(
  (Object.keys(BCBM_DISPLAY_PLAYTYPE_BY_BET) as BcbmBetId[]).map((id) => [
    BCBM_DISPLAY_PLAYTYPE_BY_BET[id],
    id,
  ]),
);

function betIdOfCarPos(carPos: number): BcbmBetId {
  const playType = 11 - (((carPos % 12) + 12) % 12);
  const id = BET_BY_PLAYTYPE.get(playType);
  if (!id) throw new Error(`carPos ${carPos} 没有对应仓位`);
  return id;
}

function betIdOfRingIndex(ringIndex: number): BcbmBetId | null {
  const kind = BCBM_RING[ringIndex]!.kind;
  return isBcbmBetId(kind) ? kind : null;
}

/** 服务端 resolveHits 的几何部分：从非免费格列表里连走 n 格 */
function serverFastHits(start: number): number[] {
  const ring = bcbmNonFreeIndexes();
  return Array.from({ length: 5 }, (_, n) => ring[(start + n) % ring.length]!);
}

/** 服务端 uturn：非免费格列表上 mid 与 mid±5 */
function serverUturnHits(mid: number): number[] {
  const ring = bcbmNonFreeIndexes();
  const len = ring.length;
  return [ring[(mid - 5 + len * 5) % len]!, ring[mid]!, ring[(mid + 5) % len]!];
}

/** 旧前端算法：拿停点 carPos 直接在 24 格上做加减 */
function legacyFastCarPositions(stopCarPos: number): number[] {
  const e = ((stopCarPos % 24) + 24) % 24;
  return [0, 1, 2, 3, 4].map((n) => (e + n) % 24);
}

function legacyUturnCarPositions(stopCarPos: number): number[] {
  const e = ((stopCarPos % 24) + 24) % 24;
  return [(((e - 5) % 24) + 24) % 24, e, (e + 5) % 24];
}

/** 亮的每一格都必须对应一个真的中奖仓位，且每个中奖仓位都至少亮一格 */
function expectHighlightMatchesPaidSlots(hitRingIndexes: number[]) {
  const paidSlots = new Set<BcbmBetId>();
  for (const i of hitRingIndexes) {
    const id = betIdOfRingIndex(i);
    if (id) paidSlots.add(id);
  }

  const carPositions = bcbmRingIndexesToCarPositions(hitRingIndexes);
  expect(carPositions.length).toBeGreaterThan(0);

  const litSlots = new Set<BcbmBetId>();
  for (const pos of carPositions) {
    const id = betIdOfCarPos(pos);
    litSlots.add(id);
    expect(paidSlots.has(id)).toBe(true);
  }
  for (const id of paidSlots) {
    expect(litSlots.has(id)).toBe(true);
  }
}

describe('灯环索引 → 转盘格位', () => {
  it('26 格灯环里恰好 2 个免费格，其余 24 格与转盘一一对应', () => {
    expect(BCBM_RING.length).toBe(26);
    expect(bcbmNonFreeIndexes().length).toBe(24);
    const all = bcbmRingIndexesToCarPositions(bcbmNonFreeIndexes());
    expect(new Set(all).size).toBe(24);
  });

  it('免费格不会被算成某个可押格的重复灯位', () => {
    const frees = BCBM_RING.map((c, i) => (c.kind === 'free' ? i : -1)).filter((i) => i >= 0);
    expect(frees.length).toBe(2);
  });
});

describe('激情狂飙 / U 型弯道：亮灯必须等于派彩格', () => {
  const starts = Array.from({ length: 24 }, (_, i) => i);

  it('激情狂飙每个起点都对得上', () => {
    for (const start of starts) {
      expectHighlightMatchesPaidSlots(serverFastHits(start));
    }
  });

  it('U 型弯道每个中点都对得上', () => {
    for (const mid of starts) {
      expectHighlightMatchesPaidSlots(serverUturnHits(mid));
    }
  });

  /*
   * 回归护栏：旧算法在跨圈处会亮错格。
   * 只要有一个起点亮错，就说明不能拿 carPos 自己做加减。
   */
  it('旧的 (carPos + n) % 24 算法确实会亮错格', () => {
    let mismatched = 0;
    for (const start of starts) {
      const hits = serverFastHits(start);
      const correct = bcbmRingIndexesToCarPositions(hits);
      const stopCarPos = correct[0]!;
      const legacy = legacyFastCarPositions(stopCarPos);
      if (legacy.join(',') !== correct.join(',')) mismatched += 1;
    }
    expect(mismatched).toBeGreaterThan(0);
  });

  it('U 型弯道旧算法同样会亮错格', () => {
    let mismatched = 0;
    for (const mid of starts) {
      const hits = serverUturnHits(mid);
      const correct = bcbmRingIndexesToCarPositions(hits);
      const legacy = legacyUturnCarPositions(correct[1] ?? correct[0]!);
      if ([...legacy].sort().join(',') !== [...correct].sort().join(',')) mismatched += 1;
    }
    expect(mismatched).toBeGreaterThan(0);
  });
});

describe('大三元 / 大四喜 / 全民漂移：灯位数量与官方一致', () => {
  it('大三元一个车标 6 个灯位', () => {
    for (const brand of ['benz', 'bmw', 'audi', 'vw'] as const) {
      const hits = bcbmIndexesOfBrand(brand);
      expect(bcbmRingIndexesToCarPositions(hits).length).toBe(6);
      expectHighlightMatchesPaidSlots(hits);
    }
  });

  it('大四喜一种颜色 8 个灯位', () => {
    for (const color of ['red', 'green', 'yellow'] as const) {
      const hits = bcbmIndexesOfColor(color);
      expect(bcbmRingIndexesToCarPositions(hits).length).toBe(8);
      expectHighlightMatchesPaidSlots(hits);
    }
  });

  it('全民漂移亮满 24 格', () => {
    const hits = bcbmNonFreeIndexes();
    expect(bcbmRingIndexesToCarPositions(hits).length).toBe(24);
    expectHighlightMatchesPaidSlots(hits);
  });
});
