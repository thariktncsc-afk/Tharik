/**
 * Enter moves DOWN THE COLUMN the cursor is already in.
 *
 * A clerk keying a shop's day works one column at a time — every commodity's
 * Sales, then every commodity's Opening if it needs one — because that is how
 * the paper in front of them is arranged. Walking the inputs in DOM order
 * instead sends Enter from row 1's Sales into row 2's OPENING, which is a
 * different figure entirely: the fast path quietly becomes the fastest way to
 * put a number in the wrong box.
 *
 * So the column is the unit of travel. Each editable input declares which
 * column it belongs to in `data-col`, and this walks only inputs carrying the
 * same value, in document order — which means Section B follows Section A, and
 * the run continues to the last commodity of the sheet.
 *
 * READ-ONLY CELLS ARE NOT IN THE COLUMN. `data-col` is set only on inputs a
 * given viewer may actually type in, so the permission rules decide the route
 * without this knowing anything about them: a shop user's Receipt column has
 * no stops at all, and their Opening column loses each day that has been saved
 * (src/lib/stockGuard.ts). The selector also excludes readonly/disabled as a
 * second line, so a cell locked without dropping the attribute is still
 * skipped rather than trapping the run.
 *
 * MOBILE. Focus moves synchronously inside the keydown, so the soft keyboard
 * never closes between rows, and the arriving cell is scrolled into view —
 * `nearest` on both axes, which leaves a visible cell where it is and, on
 * these horizontally scrolling grids, never drags the table sideways out of
 * the column being keyed.
 */
import type { KeyboardEvent } from 'react';

/** The attribute an input uses to say which column it is in. */
export const COL_ATTR = 'data-col';

/** Every cell in one column that the current viewer can type into, top to bottom. */
export function columnCells(root: HTMLElement | null, col: string): HTMLInputElement[] {
  if (!root || !col) return [];
  return Array.from(root.querySelectorAll<HTMLInputElement>(`input[${COL_ATTR}="${col}"]:not([readonly]):not([disabled])`));
}

/**
 * Handle Enter / ↓ / ↑ on a grid cell. Anything else is left to the browser,
 * so Tab still walks the row in the ordinary order and typing is untouched.
 *
 * On the last row of a column there is nowhere further down: focus stays put
 * rather than wrapping to the top or jumping to another column, both of which
 * would move the clerk somewhere they did not ask to go.
 */
export function columnKeyDown(e: KeyboardEvent<HTMLInputElement>, root: HTMLElement | null): void {
  if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const col = e.currentTarget.getAttribute(COL_ATTR);
  if (!col) return;
  // Only now: ArrowUp/ArrowDown would otherwise step a number input, and Enter
  // could submit. Both are ours to spend once we know we can act on them.
  e.preventDefault();

  const cells = columnCells(root, col);
  const at = cells.indexOf(e.currentTarget);
  if (at === -1) return;
  const next = cells[at + (e.key === 'ArrowUp' ? -1 : 1)];
  if (!next) return;

  next.focus();
  next.select();
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
