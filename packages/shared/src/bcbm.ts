/**
 * 奔驰宝马（YoPlay YJBZ 风格）权威盘面与赔率。
 * 前后端必须同源引用，禁止各自改一份。
 *
 * 玩法：26 格跑灯 = 4 车标 × 红/绿/黄 × 2 份 + 2 格免费游戏；
 * 玩家押 12 个仓位（车标×颜色），可触发大三元 / 大四喜。
 */

export const BCBM_BRANDS = [
  { id: 'benz', label: '奔驰' },
  { id: 'bmw', label: '宝马' },
  { id: 'audi', label: '奥迪' },
  { id: 'vw', label: '大众' },
] as const;

export const BCBM_COLORS = [
  { id: 'red', label: '红' },
  { id: 'green', label: '绿' },
  { id: 'yellow', label: '黄' },
] as const;

export type BcbmBrandId = (typeof BCBM_BRANDS)[number]['id'];
export type BcbmColorId = (typeof BCBM_COLORS)[number]['id'];

/** 押注仓位 id：benz_red / bmw_green … */
export type BcbmBetId = `${BcbmBrandId}_${BcbmColorId}`;

export interface BcbmBetSlot {
  id: BcbmBetId;
  brand: BcbmBrandId;
  color: BcbmColorId;
  label: string;
  mult: number;
}

/** 与 YoPlay 官方一致的 12 仓赔率 */
export const BCBM_BET_SLOTS: readonly BcbmBetSlot[] = [
  { id: 'benz_red', brand: 'benz', color: 'red', label: '红奔驰', mult: 45 },
  { id: 'benz_green', brand: 'benz', color: 'green', label: '绿奔驰', mult: 38 },
  { id: 'benz_yellow', brand: 'benz', color: 'yellow', label: '黄奔驰', mult: 27 },
  { id: 'bmw_red', brand: 'bmw', color: 'red', label: '红宝马', mult: 22 },
  { id: 'bmw_green', brand: 'bmw', color: 'green', label: '绿宝马', mult: 16 },
  { id: 'bmw_yellow', brand: 'bmw', color: 'yellow', label: '黄宝马', mult: 13 },
  { id: 'audi_red', brand: 'audi', color: 'red', label: '红奥迪', mult: 12 },
  { id: 'audi_green', brand: 'audi', color: 'green', label: '绿奥迪', mult: 10 },
  { id: 'audi_yellow', brand: 'audi', color: 'yellow', label: '黄奥迪', mult: 6 },
  { id: 'vw_red', brand: 'vw', color: 'red', label: '红大众', mult: 7 },
  { id: 'vw_green', brand: 'vw', color: 'green', label: '绿大众', mult: 5 },
  { id: 'vw_yellow', brand: 'vw', color: 'yellow', label: '黄大众', mult: 4 },
] as const;

const SLOT_BY_ID = Object.fromEntries(BCBM_BET_SLOTS.map((s) => [s.id, s])) as Record<
  BcbmBetId,
  BcbmBetSlot
>;

export function isBcbmBetId(id: string): id is BcbmBetId {
  return id in SLOT_BY_ID;
}

export function bcbmBetSlot(id: BcbmBetId): BcbmBetSlot {
  return SLOT_BY_ID[id];
}

export type BcbmCellKind = BcbmBetId | 'free';

export interface BcbmRingCell {
  kind: BcbmCellKind;
  brand: BcbmBrandId | null;
  color: BcbmColorId | null;
  mult: number;
  /** 普通停点权重 */
  weight: number;
  label: string;
}

/** 26 格灯环（与 YoPlay 索引一致） */
export const BCBM_RING: readonly BcbmRingCell[] = (() => {
  const mk = (kind: BcbmCellKind, weight: number): BcbmRingCell => {
    if (kind === 'free') {
      return { kind, brand: null, color: null, mult: 0, weight, label: '免费游戏' };
    }
    const s = SLOT_BY_ID[kind];
    return {
      kind,
      brand: s.brand,
      color: s.color,
      mult: s.mult,
      weight,
      label: s.label,
    };
  };
  /**
   * 停点权重严格取 round(900 / 倍率)，使 12 个仓位的普通开奖 RTP 全部落在 82%±1%。
   * 早先的权重只是「大致反比」，红/绿奔驰与红宝马单独就超过 100%，是平台负期望。
   * 12 仓覆盖全部赔付格时，普通开奖 RTP 的数学上限为 1/Σ(1/倍率) ≈ 83.1%，
   * 剩余部分由大三元 / 大四喜等大奖补足到目标 RTP（见 BCBM_DEFAULT_AWARD_WEIGHTS）。
   * 改权重后必须跑 `pnpm audit:rtp arcade`。
   */
  return [
    mk('vw_red', 129),
    mk('vw_green', 180),
    mk('vw_yellow', 225),
    mk('free', 0) /* 视觉格，不进普通停点池 */,
    mk('benz_red', 20),
    mk('benz_green', 24),
    mk('benz_yellow', 33),
    mk('bmw_red', 41),
    mk('bmw_green', 56),
    mk('bmw_yellow', 69),
    mk('audi_red', 75),
    mk('audi_green', 90),
    mk('audi_yellow', 150),
    mk('vw_red', 129),
    mk('vw_green', 180),
    mk('vw_yellow', 225),
    mk('free', 0) /* 视觉格，不进普通停点池 */,
    mk('benz_red', 20),
    mk('benz_green', 24),
    mk('benz_yellow', 33),
    mk('bmw_red', 41),
    mk('bmw_green', 56),
    mk('bmw_yellow', 69),
    mk('audi_red', 75),
    mk('audi_green', 90),
    mk('audi_yellow', 150),
  ];
})();

/**
 * 对齐 YoPlay YBEN ResultBonus 0–5（locale Benz_hans.bonusName）：
 * 0 ALL_COLOR 大三元 / 1 ALL_CAR 大四喜 / 2 FURIOIUS 极速狂飙
 * 3 UTURN U型弯道 / 4 LIGHTNING 霹雳闪电 / 5 DRIFT 全民漂移
 * `free` 保留兼容旧配置，表现同 lightning。
 */
export const BCBM_AWARD_TYPES = [
  'normal',
  'free',
  'sanyuan_benz',
  'sanyuan_bmw',
  'sanyuan_audi',
  'sanyuan_vw',
  'sixi_red',
  'sixi_green',
  'sixi_yellow',
  'fast',
  'uturn',
  'lightning',
  'drift',
] as const;

export type BcbmAwardType = (typeof BCBM_AWARD_TYPES)[number];

export const BCBM_AWARD_LABELS: Record<BcbmAwardType, string> = {
  normal: '普通中奖',
  free: '霹雳闪电（兼容）',
  sanyuan_benz: '大三元·奔驰',
  sanyuan_bmw: '大三元·宝马',
  sanyuan_audi: '大三元·奥迪',
  sanyuan_vw: '大三元·大众',
  sixi_red: '大四喜·红',
  sixi_green: '大四喜·绿',
  sixi_yellow: '大四喜·黄',
  fast: '极速狂飙',
  uturn: 'U型弯道',
  lightning: '霹雳闪电',
  drift: '全民漂移',
};

/**
 * 大奖权重（分母 1000）。
 *
 * sanyuan / sixi / fast / uturn / drift 是「无条件全额赔付整组仓位」，不受灯环权重约束：
 * 押满 12 仓时大三元·奔驰一把赔 110 倍、全民漂移一把赔 205 倍，
 * 因此权重必须是千分位量级，否则单靠大奖就能把 RTP 顶到 200% 以上。
 * 这里让大奖合计补足约 13 个百分点，与普通开奖的 82% 合成目标 RTP。
 */
export const BCBM_DEFAULT_AWARD_WEIGHTS: Record<BcbmAwardType, number> = {
  normal: 950,
  free: 0,
  sanyuan_benz: 1,
  sanyuan_bmw: 2,
  sanyuan_audi: 4,
  sanyuan_vw: 8,
  sixi_red: 1,
  sixi_green: 2,
  sixi_yellow: 3,
  fast: 5,
  uturn: 8,
  lightning: 15,
  drift: 1,
};

export function bcbmIndexesOfBet(id: BcbmBetId): number[] {
  return BCBM_RING.map((c, i) => (c.kind === id ? i : -1)).filter((i) => i >= 0);
}

export function bcbmIndexesOfBrand(brand: BcbmBrandId): number[] {
  return BCBM_RING.map((c, i) => (c.brand === brand ? i : -1)).filter((i) => i >= 0);
}

export function bcbmIndexesOfColor(color: BcbmColorId): number[] {
  return BCBM_RING.map((c, i) => (c.color === color ? i : -1)).filter((i) => i >= 0);
}

export function bcbmFreeIndexes(): number[] {
  return BCBM_RING.map((c, i) => (c.kind === 'free' ? i : -1)).filter((i) => i >= 0);
}

export function bcbmNonFreeIndexes(): number[] {
  return BCBM_RING.map((c, i) => (c.kind !== 'free' ? i : -1)).filter((i) => i >= 0);
}

/**
 * YoPlay SpinPanel 官方坐标（相对 858×538 跑道底板，单位 px）。
 * 来源：PC_YJBZ SpinPanelSkin.exml icon0..icon25
 */
export const BCBM_RING_SIZE = { w: 858, h: 538 } as const;

export const BCBM_RING_XY: ReadonlyArray<readonly [number, number]> = [
  [152.69, 26.68],
  [226.68, 11.0],
  [298.69, 10.0],
  [370.0, 0.0], // free（EXML 未写 y，默认 0）
  [467.02, 14.0],
  [537.02, 14.01],
  [615.35, 28.01],
  [684.68, 66.68],
  [728.68, 121.68],
  [754.35, 191.01],
  [750.69, 270.0],
  [726.02, 336.34],
  [680.68, 393.35],
  [615.35, 428.02],
  [539.35, 442.68],
  [469.68, 445.34],
  [370.0, 430.0], // free
  [294.7, 442.68],
  [224.01, 442.68],
  [148.7, 428.68],
  [87.69, 394.68],
  [40.02, 336.34],
  [12.92, 266.01],
  [12.21, 194.34],
  [40.58, 121.34],
  [87.35, 61.36],
];

/** @deprecated 使用 BCBM_RING_XY；保留别名避免旧引用报错 */
export const BCBM_SLOT_POS = BCBM_RING_XY;

/**
 * YoPlay 24 格展示环 playType（0..11）↔ 押注仓位。
 * 与前端 `BCBM_WHEEL_PLAYTYPE` / `BCBM_PLAYTYPE_META` 一致：
 * carPos p 的 playType = 11 - (p % 12)。
 */
export const BCBM_DISPLAY_PLAYTYPE_BY_BET: Record<BcbmBetId, number> = {
  vw_yellow: 0,
  vw_green: 1,
  vw_red: 2,
  audi_yellow: 3,
  audi_green: 4,
  audi_red: 5,
  bmw_yellow: 6,
  bmw_green: 7,
  bmw_red: 8,
  benz_yellow: 9,
  benz_green: 10,
  benz_red: 11,
};

/** 某仓位在 24 格展示环上的两个候选 carPos（左右半环各一） */
export function bcbmCarPosCandidatesForBet(betId: BcbmBetId): readonly [number, number] {
  const pt = BCBM_DISPLAY_PLAYTYPE_BY_BET[betId];
  const a = 11 - pt;
  return [a, a + 12];
}

/**
 * 服务端 26 格灯环索引 → YoPlay 24 格展示 carPos。
 * 免费格无展示图标时，用 winnerKind（须为仓位 id）回退。
 */
export function bcbmRingIndexToCarPos(stopIndex: number, winnerKind?: string): number {
  const idx = ((Math.floor(Number(stopIndex)) % BCBM_RING.length) + BCBM_RING.length) % BCBM_RING.length;
  const cell = BCBM_RING[idx];
  let betId: BcbmBetId | null = null;
  if (cell.kind !== 'free' && isBcbmBetId(cell.kind)) {
    betId = cell.kind;
  } else if (winnerKind && isBcbmBetId(winnerKind)) {
    betId = winnerKind;
  } else {
    const prev = BCBM_RING[(idx - 1 + BCBM_RING.length) % BCBM_RING.length];
    const next = BCBM_RING[(idx + 1) % BCBM_RING.length];
    const fallback = prev.kind !== 'free' ? prev.kind : next.kind;
    if (isBcbmBetId(fallback)) betId = fallback;
  }
  if (!betId) return 0;
  const cands = bcbmCarPosCandidatesForBet(betId);
  const occs = bcbmIndexesOfBet(betId);
  const occ = occs.indexOf(idx);
  if (occ >= 0) return cands[Math.min(occ, cands.length - 1)]!;
  return cands[0]!;
}

/** 批量映射命中格（去重，保持首次出现顺序） */
export function bcbmRingIndexesToCarPositions(hitIndexes: readonly number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const i of hitIndexes) {
    const carPos = bcbmRingIndexToCarPos(i);
    if (seen.has(carPos)) continue;
    seen.add(carPos);
    out.push(carPos);
  }
  return out;
}
