/**
 * 麻将胡了纯计算层：牌面生成 / 连线评估 / 消除掉落。
 * 不依赖 Nest DI 与数据库，便于 RTP 审计与单测直接调用
 * （`pnpm audit:rtp mahjong` 走的就是这里，与线上开奖同一份逻辑）。
 */
import {
  MAHJONG_BASE_BET,
  MAHJONG_CASCADE_MULTIPLIERS,
  MAHJONG_FREE_SPIN_MULTIPLIERS,
  MAHJONG_PAY_SYMBOLS,
  MAHJONG_PAYTABLE,
  mahjongFreeSpinsFromScatters,
  type MahjongCascadeStepDTO,
  type MahjongGridPosDTO,
  type MahjongPaySymbolId,
  type MahjongSymbolId,
  type MahjongTileDTO,
} from '@gamebox/shared';
import { weightedPick } from './fairness.util';

export const COLS = 5;
export const TOTAL_ROWS = 6;
export const VISIBLE_ROWS = [1, 2, 3, 4] as const;
export const GOLDEN_REELS = new Set([1, 2, 3]);
export const MAX_CASCADES = 20;

/** 符号停留权重（改动后必须跑 `pnpm audit:rtp mahjong`） */
export const DEFAULT_SYMBOL_WEIGHTS: Record<MahjongSymbolId, number> = {
  '2t': 16, '2s': 16, '5t': 12, '5s': 12,
  '8w': 9, bai: 7, zhong: 6, fa: 5, wild: 2, hu: 2.5,
};

export interface MahjongConfig {
  symbolWeights?: Partial<Record<MahjongSymbolId, number>>;
  goldenChance?: number;
}

export interface EvaluatedWin {
  totalWin: number;
  winCells: MahjongGridPosDTO[];
  scatterCount: number;
}

export interface MahjongOutcome {
  initialGrid: MahjongTileDTO[][];
  cascades: MahjongCascadeStepDTO[];
  totalWin: number;
  spinsAwarded: number;
}

export function cascadeMultiplier(index: number, isFree: boolean): number {
  const ladder = isFree ? MAHJONG_FREE_SPIN_MULTIPLIERS : MAHJONG_CASCADE_MULTIPLIERS;
  return ladder[Math.min(index, ladder.length - 1)];
}

export function countScatters(grid: MahjongTileDTO[][]): number {
  return grid.reduce(
    (sum, column) => sum + VISIBLE_ROWS.filter((row) => column[row]?.symbol === 'hu').length,
    0,
  );
}

export function cloneGrid(grid: MahjongTileDTO[][]): MahjongTileDTO[][] {
  return grid.map((column) => column.map((tile) => ({ ...tile })));
}

function dedupe(cells: MahjongGridPosDTO[]): MahjongGridPosDTO[] {
  const seen = new Set<string>();
  return cells.filter(({ col, row }) => {
    const key = `${col}:${row}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * ways 玩法：从第 1 列起连续列各自的匹配格数连乘。
 * 返回未取整的精确赔付——逐个符号 Math.floor 会把不足 1 分的零头一次次抹掉，
 * 小额下注时甚至会让整步赔付变 0 而误判级联结束。取整只在整局结算时做一次。
 */
export function evaluateGrid(
  grid: MahjongTileDTO[][],
  amount: number,
  cascadeIndex: number,
  isFree: boolean,
): EvaluatedWin {
  const winCells: MahjongGridPosDTO[] = [];
  let totalWin = 0;
  for (const symbol of MAHJONG_PAY_SYMBOLS) {
    const positionsByReel: MahjongGridPosDTO[][] = [];
    for (let col = 0; col < COLS; col++) {
      const positions = VISIBLE_ROWS.filter((row) =>
        ['wild', symbol].includes(grid[col]?.[row]?.symbol),
      ).map((row) => ({ col, row }));
      if (positions.length === 0) break;
      positionsByReel.push(positions);
    }
    if (positionsByReel.length < 3) continue;
    const ways = positionsByReel.reduce((product, positions) => product * positions.length, 1);
    const pay = MAHJONG_PAYTABLE[symbol][positionsByReel.length - 3];
    totalWin += (amount / MAHJONG_BASE_BET) * pay * ways * cascadeMultiplier(cascadeIndex, isFree);
    positionsByReel.forEach((positions) => winCells.push(...positions));
  }
  return { totalWin, winCells: dedupe(winCells), scatterCount: countScatters(grid) };
}

export function dropAndRefill(
  grid: MahjongTileDTO[][],
  removeCells: MahjongGridPosDTO[],
  rollTile: (col: number) => MahjongTileDTO,
) {
  const byColumn = new Map<number, Set<number>>();
  for (const { col, row } of removeCells) {
    const rows = byColumn.get(col) ?? new Set<number>();
    rows.add(row);
    byColumn.set(col, rows);
  }
  const refillColumns: Array<{ col: number; tiles: MahjongTileDTO[] }> = [];
  for (let col = 0; col < COLS; col++) {
    const rows = byColumn.get(col) ?? new Set<number>();
    if (rows.size === 0) continue;
    const kept = grid[col].filter((_, row) => !rows.has(row));
    const tiles = Array.from({ length: TOTAL_ROWS - kept.length }, () => rollTile(col));
    grid[col] = [...kept, ...tiles];
    refillColumns.push({ col, tiles });
  }
  return refillColumns;
}

/**
 * 生成一局完整结果（含级联链）。
 * @param random 取值 [0,1) 的随机源；线上传 deriveRandom(serverSeed, clientSeed, nonce++)
 */
export function generateMahjongOutcome(opts: {
  amount: number;
  isFree: boolean;
  rawConfig: MahjongConfig | null | undefined;
  random: () => number;
}): MahjongOutcome {
  const { amount, isFree, random } = opts;
  const raw = opts.rawConfig;
  const config = (!raw || Array.isArray(raw) ? {} : raw) as MahjongConfig;
  const weights = { ...DEFAULT_SYMBOL_WEIGHTS, ...(config.symbolWeights ?? {}) };
  const symbols = Object.keys(weights) as MahjongSymbolId[];
  const goldenChance = Math.min(1, Math.max(0, config.goldenChance ?? 0.14));

  const rollTile = (col: number): MahjongTileDTO => {
    const symbol = symbols[weightedPick(symbols.map((id) => weights[id] ?? 0), random())];
    const isGolden =
      MAHJONG_PAY_SYMBOLS.includes(symbol as MahjongPaySymbolId) &&
      GOLDEN_REELS.has(col) &&
      random() < goldenChance;
    return { symbol, isGolden };
  };
  const rollGrid = () =>
    Array.from({ length: COLS }, (_, col) =>
      Array.from({ length: TOTAL_ROWS }, () => rollTile(col)),
    );

  const initialGrid = rollGrid();
  const grid = cloneGrid(initialGrid);
  const cascades: MahjongCascadeStepDTO[] = [];
  let totalWin = 0;
  /* 散牌按初盘计：级联后重数会让免费游戏触发率翻数倍 */
  const scatterCount = countScatters(grid);

  for (let index = 0; index < MAX_CASCADES; index++) {
    const evaluated = evaluateGrid(grid, amount, index, isFree);
    if (evaluated.totalWin <= 0 || evaluated.winCells.length === 0) break;

    const goldenToWild = evaluated.winCells.filter(({ col, row }) => {
      const tile = grid[col]?.[row];
      return Boolean(
        tile?.isGolden && MAHJONG_PAY_SYMBOLS.includes(tile.symbol as MahjongPaySymbolId),
      );
    });
    const goldenKeys = new Set(goldenToWild.map(({ col, row }) => `${col}:${row}`));
    const removeCells = evaluated.winCells.filter(
      ({ col, row }) => !goldenKeys.has(`${col}:${row}`),
    );
    for (const { col, row } of goldenToWild) {
      grid[col][row] = { symbol: 'wild', isGolden: false };
    }
    const refillColumns = dropAndRefill(grid, removeCells, rollTile);
    totalWin += evaluated.totalWin;
    cascades.push({
      cascadeIndex: index,
      multiplier: cascadeMultiplier(index, isFree),
      winCells: evaluated.winCells,
      goldenToWild,
      removeCells,
      refillColumns,
      gridAfter: cloneGrid(grid),
      stepWin: Math.floor(evaluated.totalWin),
    });
  }

  return {
    initialGrid,
    cascades,
    totalWin: Math.floor(totalWin),
    spinsAwarded: mahjongFreeSpinsFromScatters(scatterCount),
  };
}
