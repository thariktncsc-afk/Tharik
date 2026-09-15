/**
 * CRS 29 (Refugee Camp) — the day's Free Rice and Cost Rice.
 *
 * The camp's C RICE statement splits each day's rice between rice issued free
 * and rice sold at cost. The commodity grid cannot say that — B.RICE is one
 * line whichever way a bag went out — so Daily Entry asks for the two figures
 * directly, in kilos, and a CRS 29 day cannot be completed without them. Zero
 * is an answer; blank is not.
 *
 * WHERE THEY LIVE. On the day sheet itself, `entryStore['29_<date>']`, as
 * `freeRice` and `costRice`: they are that day's facts, the statement already
 * reads the month day by day, and a sheet replaced or cleared takes them with
 * it. A month keyed straight into Monthly Entry has no day sheets, so its
 * figures ride on the projected last-day sheet the month-close writes
 * (monthProjection.ts) — the one day-shaped record that month has.
 *
 * WHERE THEY PRINT. src/legacy/40-crs29-rice.js: FREE RICE (KG'S) → TOTAL,
 * COST RICE BRA, and TOTAL RICE as the two together. The month's figure is the
 * statement's own TOTAL row over the days, so nothing is stored per month.
 *
 * WHAT THE SERVER HOLDS TO. /api/state refuses a new CRS 29 day sheet without
 * both figures, a save that strips them from a sheet that had them, and any
 * figure that is not a number of 0 or more — for administrators too. Sheets
 * saved before the fields existed are history and are left alone until someone
 * re-saves them on the screen, the same courtesy the stock guard extends.
 *
 * No other shop has these fields, on screen or in storage.
 */
import { isCrs29 } from '@/lib/engine/commodities';

export const RICE_DAILY_REQUIRED = 'Please enter Free Rice and Cost Rice details before completing Daily Sales.';
export const RICE_MONTHLY_REQUIRED = 'Please enter Free Rice and Cost Rice details before completing Monthly Sales.';
export const RICE_INVALID = 'Free Rice and Cost Rice must be numbers of 0 or more.';
export const RICE_REMOVED = 'Free Rice and Cost Rice were already saved for this day and cannot be removed.';

export type Rice = { freeRice: number; costRice: number };
export type RiceBoxError = 'missing' | 'invalid';

/** Only CRS 29 records rice this way. */
export const hasRiceFields = (crsId: number | null | undefined) => isCrs29(crsId);

const FIELDS = ['freeRice', 'costRice'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A stored figure: a finite number of 0 or more, or nothing usable. */
const figure = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** Kilos carry three decimals, like every other quantity on the sheet. */
const kg = (n: number) => Math.round(n * 1000) / 1000;

/** Both figures from a stored sheet, or null when either is absent or unusable. */
export function riceOf(sheet: unknown): Rice | null {
  if (!isObj(sheet)) return null;
  const freeRice = figure(sheet.freeRice);
  const costRice = figure(sheet.costRice);
  return freeRice === null || costRice === null ? null : { freeRice, costRice };
}

/** A stored figure back into its input box. Zero shows as 0, never blank. */
export const riceBox = (v: unknown): string => {
  const n = figure(v);
  return n === null ? '' : String(n);
};

/** One input box: blank is missing, anything but a number of 0 or more is invalid. */
export function readRiceBox(raw: string): { value: number | null; error?: RiceBoxError } {
  const s = raw.trim();
  if (s === '') return { value: null, error: 'missing' };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return { value: null, error: 'invalid' };
  return { value: kg(n) };
}

/** Both boxes — what a save checks before it writes anything. */
export function checkRiceBoxes(free: string, cost: string): { rice: Rice | null; free?: RiceBoxError; cost?: RiceBoxError; invalid: boolean } {
  const f = readRiceBox(free);
  const c = readRiceBox(cost);
  return {
    rice: f.value !== null && c.value !== null ? { freeRice: f.value, costRice: c.value } : null,
    free: f.error,
    cost: c.error,
    invalid: f.error === 'invalid' || c.error === 'invalid',
  };
}

/** The sheet with the figures written on — or the same sheet, when there are none. */
export function withRice<T extends object>(sheet: T, rice: Rice | null): T {
  return rice ? { ...sheet, freeRice: rice.freeRice, costRice: rice.costRice } : sheet;
}

export type MonthRice = Rice & { sheets: number; missing: string[] };

/**
 * A day-keyed month over its real day sheets — what C RICE's TOTAL row prints.
 * Dates whose sheet carries no figures (saved before the fields existed) are
 * listed rather than counted as zero.
 */
export function riceForMonth(entryStore: Record<string, unknown>, crsId: number, month: number, year: number): MonthRice {
  // "29_2026-08-" — the underscore keeps CRS 2 from matching CRS 29's keys.
  const prefix = `${crsId}_${year}-${String(month).padStart(2, '0')}-`;
  const out: MonthRice = { freeRice: 0, costRice: 0, sheets: 0, missing: [] };
  for (const [key, sheet] of Object.entries(entryStore)) {
    if (!key.startsWith(prefix) || !isObj(sheet) || sheet.__projection) continue;
    out.sheets++;
    const r = riceOf(sheet);
    if (!r) {
      out.missing.push(key.slice(String(crsId).length + 1));
      continue;
    }
    out.freeRice = kg(out.freeRice + r.freeRice);
    out.costRice = kg(out.costRice + r.costRice);
  }
  out.missing.sort();
  return out;
}

export type RiceViolation = { key: string; date: string; kind: 'missing' | 'removed' | 'invalid'; detail: string };

/** `<crs>_<YYYY-MM-DD>` — a day store key. */
const DAY_KEY = /^(\d+)_(\d{4}-\d{2}-\d{2})$/;

/**
 * Every CRS 29 day sheet in one /api/state payload that breaks the rule.
 *
 * Only sheets this write actually changes are judged. A new sheet, or a
 * month's projection turning into a real day sheet, must carry both figures;
 * a sheet that already had them may not lose them; a figure present at all
 * must be usable, and one without the other is not a pair.
 */
export function inspectRiceWrite(stored: Record<string, unknown>, incoming: Record<string, unknown>): RiceViolation[] {
  const out: RiceViolation[] = [];
  const after = incoming.entryStore;
  if (!isObj(after)) return out;
  const before = isObj(stored.entryStore) ? stored.entryStore : {};

  for (const [key, rec] of Object.entries(after)) {
    const m = DAY_KEY.exec(key);
    if (!m || !hasRiceFields(Number(m[1])) || !isObj(rec)) continue;
    const prev = before[key];
    if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(rec)) continue;
    const note = (kind: RiceViolation['kind'], detail: string) => out.push({ key, date: m[2], kind, detail });

    const projected = !!rec.__projection;
    const required = projected ? RICE_MONTHLY_REQUIRED : RICE_DAILY_REQUIRED;
    const present = FIELDS.filter((f) => f in rec);
    if (present.some((f) => figure(rec[f]) === null)) {
      note('invalid', RICE_INVALID);
      continue;
    }
    if (riceOf(rec)) continue;
    if (present.length) {
      note('missing', required);
      continue;
    }
    const takesOver = isObj(prev) && !!prev.__projection && !projected;
    if (prev === undefined || takesOver) note('missing', required);
    else if (riceOf(prev)) note('removed', RICE_REMOVED);
  }
  return out;
}

/** One line per refused sheet, for the error message and the audit row. */
export function describeRice(violations: RiceViolation[]): string {
  return violations.map((v) => `CRS 29 ${v.date}: ${v.detail}`).join(' ');
}
