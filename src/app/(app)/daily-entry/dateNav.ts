/**
 * Daily Entry's Previous / Next date buttons (office, 2026-09-21).
 *
 * Clerks lost track of which day they were keying, so the foot of the form
 * says it plainly — `← 20-09-2026 | 21-09-2026 | 22-09-2026 →` — worked out
 * from the date on screen, never from today. The rules live here so they can
 * be checked without a browser (tools/verify-daily-date-nav.mjs).
 */

/**
 * The calendar date `days` away from `iso` (YYYY-MM-DD), worked in UTC so no
 * time zone can move it by a day: 2026-09-30 + 1 is 2026-10-01, and
 * 2026-03-01 − 1 is 2026-02-28.
 */
export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** DD-MM-YYYY, the way the office writes a date. */
export function dmy(iso: string): string {
  return iso.split('-').reverse().join('-');
}

export type DateNav = {
  prev: string;
  current: string;
  next: string;
  /** Next would be a day that has not happened — the date box stops at today too. */
  nextDisabled: boolean;
};

/** The three dates the navigation shows, from the date on screen. */
export function dateNav(current: string, today: string): DateNav {
  const next = shiftIso(current, 1);
  return { prev: shiftIso(current, -1), current, next, nextDisabled: next > today };
}
