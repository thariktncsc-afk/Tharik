/**
 * A shop's Daily Entry dates — "Last Entry Date" and "Total Entry Dates" at
 * the top of Daily Entry (office, 2026-09-28).
 *
 * A date counts when the shop has a REAL day sheet saved for it:
 *   - one sheet per `<crsId>_<YYYY-MM-DD>` key, so a date is counted once
 *     however many commodities were keyed on it;
 *   - holding data — some Opening, Receipt, Sales, Total, Closing or
 *     adjustment that is not zero (`sheetHasStock`, the same test that decides
 *     whether a shop has started) — so a form emptied and saved, or a blank
 *     default record, is not an entry;
 *   - NOT a Monthly Entry projection (`__projection`): a month keyed by month
 *     is written out as one sheet on its last day for the DSS, but nobody keyed
 *     that day on Daily Entry.
 * Calendar days, working days, holidays and missing days play no part.
 *
 * The page reads the saved copy of the store (dataStore `useSavedStore`), so a
 * sheet still being sent, or one the server refused, is not counted.
 */
import { sheetHasStock } from '@/lib/engine/stockInit';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Is this saved day sheet an actual Daily Entry? */
export function isDailyEntry(sheet: unknown): boolean {
  if (!sheet || typeof sheet !== 'object') return false;
  if ((sheet as { __projection?: unknown }).__projection) return false;
  return sheetHasStock(sheet);
}

export type EntrySummary = {
  /** ISO date of the latest entry, or null when the shop has none. */
  last: string | null;
  /** Unique entry dates. */
  count: number;
};

/** The shop's entry dates, from a (saved) entryStore. */
export function entrySummary(entryStore: Record<string, unknown> | undefined, crsId: number | string): EntrySummary {
  const prefix = `${crsId}_`;
  let last: string | null = null;
  let count = 0;
  for (const [key, sheet] of Object.entries(entryStore ?? {})) {
    if (!key.startsWith(prefix)) continue; // CRS 2 must not match CRS 23: the prefix carries the underscore
    const ds = key.slice(prefix.length);
    if (!DAY.test(ds) || !isDailyEntry(sheet)) continue;
    count++;
    if (!last || ds > last) last = ds; // ISO dates sort as text
  }
  return { last, count };
}

/** `2026-09-19` → `19-09-2026`. */
export const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('-');
