/**
 * 实时开奖 / 大厅底条：把服务端 lastDraw 串解析成和游戏里同一套图。
 * 只放路径与文案，不碰 DOM。
 */
import { bcbmBetSlot, isBcbmBetId } from './bcbm';
import { FRUIT_RING } from './fruit-machine';

const FRUIT_KIND_RE = /^(bar|seven|star|melon|bell|lemon|orange|apple)_(big|small)$/;

const BCBM_FILE_BRAND: Record<string, string> = {
  benz: 'benz',
  bmw: 'bmw',
  audi: 'audi',
  vw: 'volkswagen',
};

export type TableBeadTone = 'banker' | 'player' | 'tie' | 'dragon' | 'tiger';

export interface TableBead {
  text: string;
  tone: TableBeadTone;
}

const TABLE_BEAD: Record<string, TableBead> = {
  庄: { text: '庄', tone: 'banker' },
  闲: { text: '闲', tone: 'player' },
  和: { text: '和', tone: 'tie' },
  龙: { text: '龙', tone: 'dragon' },
  虎: { text: '虎', tone: 'tiger' },
  BANKER: { text: '庄', tone: 'banker' },
  PLAYER: { text: '闲', tone: 'player' },
  TIE: { text: '和', tone: 'tie' },
  DRAGON: { text: '龙', tone: 'dragon' },
  TIGER: { text: '虎', tone: 'tiger' },
  LONG: { text: '龙', tone: 'dragon' },
  HU: { text: '虎', tone: 'tiger' },
};

export function parseDrawTokens(raw: string | null | undefined): string[] {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function fruitDrawIconPath(kind: string): string | null {
  if (kind === 'luck') return '/images/games/slots/center/symbols/luck.webp';
  const m = kind.match(FRUIT_KIND_RE);
  if (!m) return null;
  return `/images/games/slots/center/symbols/${m[1]}_icon.webp`;
}

export function fruitDrawLabel(kind: string): string {
  const cell = FRUIT_RING.find((c) => c.kind === kind);
  return cell?.label || '';
}

export function isFruitDrawKind(kind: string): boolean {
  return kind === 'luck' || FRUIT_KIND_RE.test(kind);
}

export function bcbmDrawIconPath(kind: string): string | null {
  if (!isBcbmBetId(kind)) return null;
  const slot = bcbmBetSlot(kind);
  const brand = BCBM_FILE_BRAND[slot.brand];
  if (!brand) return null;
  return `/images/games/bcbm/benz/main/yben_icon_history_s_${brand}_${slot.color}.webp`;
}

export function bcbmDrawLabel(kind: string): string {
  if (kind === 'free') return '免费游戏';
  if (isBcbmBetId(kind)) return bcbmBetSlot(kind).label;
  return '';
}

export function isBcbmDrawKind(kind: string): boolean {
  return kind === 'free' || isBcbmBetId(kind);
}

export function tableDrawBead(token: string): TableBead | null {
  return TABLE_BEAD[token] || TABLE_BEAD[token.toUpperCase()] || null;
}
