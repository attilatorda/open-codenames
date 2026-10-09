import type { BoardLayout } from '../types';

// Ids are rows×cols. The default is the 5 columns × 4 rows picture grid.
// Open Codenames has no assassin ("lose the game") card: the slot is an extra neutral picture.
// The engine still supports assassins for rule variants (set `assassin` > 0 on a custom layout).
export const LAYOUTS: readonly BoardLayout[] = [
  { id: '4x4', short: '4×4', label: '4 × 4 — quick (16 pictures)', rows: 4, cols: 4, starting: 6, other: 5, neutral: 5, assassin: 0 },
  { id: '4x5', short: '5×4', label: '5 × 4 — standard (20 pictures)', rows: 4, cols: 5, starting: 8, other: 7, neutral: 5, assassin: 0 },
  { id: '5x5', short: '5×5', label: '5 × 5 — large (25 pictures)', rows: 5, cols: 5, starting: 9, other: 8, neutral: 8, assassin: 0 },
];

export const DEFAULT_LAYOUT_ID = '4x5';

export function getLayout(id: string): BoardLayout {
  return LAYOUTS.find((l) => l.id === id) ?? LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT_ID)!;
}

export function layoutSize(layout: BoardLayout): number {
  return layout.rows * layout.cols;
}

/** "A1" … "E5": row letter + 1-based column. */
export function coordFor(index: number, layout: BoardLayout): string {
  const row = Math.floor(index / layout.cols);
  const col = index % layout.cols;
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}
