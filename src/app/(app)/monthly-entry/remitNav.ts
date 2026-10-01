/**
 * Keyboard travel in the Monthly Remittance table (office, 2026-10-01).
 * One handler on the table body (`remitKeyDown`), so every row — the
 * hand-keyed days and the three extra rows, however many — behaves alike.
 *
 * In a Non-Cereal A/C amount box (`data-remit-amt`):
 *   Enter / ↓   the amount box of the next row that has one
 *   ↑           the one above
 *   ←           the Remittance Date of the same row
 * ↑ / ↓ never step the figure (a number input's own arrows would), Enter never
 * submits, and the last / first box stays put rather than wrapping.
 *
 * In a Remittance Date box (the DateField text box in `data-remit-cell="date"`):
 *   →           back to the same row's amount — only with the cursor at the
 *               end, so → still moves through a date being typed
 *   Enter       straight after arriving: opens the calendar to change it
 *               (typing a date works too); after a date was typed: the date is
 *               taken (DateField commits it) and the cursor moves on to the
 *               row's amount — the next cell along
 *
 * Rows a Daily Entry deposit fills are read-only (no boxes), so they are not
 * stops. Navigation only moves the focus: no value is written, and the save
 * flow (Save Remittance) is unchanged.
 */
import type { FocusEvent, FormEvent, KeyboardEvent } from 'react';

export const AMT_ATTR = 'data-remit-amt';
export const DATE_CELL_ATTR = 'data-remit-cell';

/** Every amount box a viewer can type in, top to bottom. */
export function amountBoxes(root: HTMLElement): HTMLInputElement[] {
  return Array.from(root.querySelectorAll<HTMLInputElement>(`input[${AMT_ATTR}]:not([readonly]):not([disabled])`));
}

const rowOf = (el: HTMLElement) => el.closest('tr');
const dateBoxOf = (row: Element | null) => row?.querySelector<HTMLInputElement>(`[${DATE_CELL_ATTR}="date"] .date-field input[type="text"]`) ?? null;
const amountOf = (row: Element | null) => row?.querySelector<HTMLInputElement>(`input[${AMT_ATTR}]:not([readonly]):not([disabled])`) ?? null;

function land(el: HTMLInputElement | null) {
  if (!el) return;
  el.focus();
  el.select?.();
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** A date box typed into since it took the focus (so Enter moves on rather than opening the calendar). */
const TYPED = 'remitTyped';

export function remitFocus(e: FocusEvent<HTMLElement>) {
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement && t.closest(`[${DATE_CELL_ATTR}="date"]`)) delete t.dataset[TYPED];
}

export function remitInput(e: FormEvent<HTMLElement>) {
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement && t.closest(`[${DATE_CELL_ATTR}="date"]`)) t.dataset[TYPED] = '1';
}

export function remitKeyDown(e: KeyboardEvent<HTMLElement>) {
  const t = e.target as HTMLElement;
  if (!(t instanceof HTMLInputElement) || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
  const root = e.currentTarget;

  // ── An amount box ──
  if (t.hasAttribute(AMT_ATTR)) {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const boxes = amountBoxes(root);
      const at = boxes.indexOf(t);
      if (at !== -1) land(boxes[at + (e.key === 'ArrowUp' ? -1 : 1)] ?? null);
      return;
    }
    if (e.key === 'ArrowLeft') {
      const date = dateBoxOf(rowOf(t));
      if (date) {
        e.preventDefault();
        land(date);
      }
    }
    return;
  }

  // ── A remittance date ──
  const cell = t.closest(`[${DATE_CELL_ATTR}="date"]`);
  if (!cell) return;
  if (e.key === 'ArrowRight') {
    const atEnd = t.type !== 'text' || (t.selectionStart === t.value.length && t.selectionEnd === t.value.length) || (t.selectionStart === 0 && t.selectionEnd === t.value.length);
    if (!atEnd) return;
    const amt = amountOf(rowOf(t));
    if (amt) {
      e.preventDefault();
      land(amt);
    }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (t.type === 'text' && !t.dataset[TYPED]) {
      // Arrived and pressed Enter: change the date. DateField has just let go
      // of the box (its own Enter blurs); take it back, ready to type, and
      // open the calendar beside it.
      land(t);
      cell.querySelector<HTMLButtonElement>('.date-field-btn')?.click();
      return;
    }
    // A date typed (DateField took it as it was typed) or picked: on to the amount.
    land(amountOf(rowOf(t)));
  }
}
