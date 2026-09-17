/**
 * Holiday rules — THE one holiday engine. The Dashboard's status and its
 * working-day counts, Daily Entry's date line and the holiday calendar all ask
 * this; nothing keeps a formula of its own.
 *
 * For any date, in this order:
 *
 *   1. A GOVERNMENT HOLIDAY on exactly that date → that holiday, by name.
 *      The calendar is a master (`__holidays` in crs_state, `{ d, name }` per
 *      year); callers pass the store's value, so a year added there reaches
 *      every screen. A holiday matches its own date and no other — it cannot
 *      linger into the next day.
 *   2. The 1st or 2nd FRIDAY, or the 3rd or 4th SUNDAY, of the month.
 *   3. Otherwise a working day — every other Friday and Sunday included.
 *
 * "The 3rd Sunday" means the third Sunday IN the month: day 15–21. It used to
 * be worked out from the calendar row the date sits in, which is a different
 * thing whenever the month does not start on the right weekday — September
 * 2026 starts on a Tuesday, so its 2nd Sunday (13th) was called the 3rd, its
 * 3rd (20th) the 4th, and its real 4th Sunday (27th) was a working day. The
 * nth occurrence of a weekday is simply ceil(day / 7).
 *
 * Every function takes the date it is asked about. Nothing here remembers a
 * previous answer, so a screen that asks again after midnight gets the new
 * day's answer.
 */
export type GovtHolidayMap = Record<string, { d: string; name: string }[]>;

export const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Which occurrence of its weekday this date is in its month: 1st … 5th. */
export function nthWeekdayOfMonth(date: Date): number {
  return Math.ceil(date.getDate() / 7);
}

export function isWeeklyHoliday(date: Date): boolean {
  return weeklyHolidayName(date) !== null;
}

export function weeklyHolidayName(date: Date): string | null {
  const d = date.getDay();
  const n = nthWeekdayOfMonth(date);
  if (d === 5 && n === 1) return '1st Friday Holiday';
  if (d === 5 && n === 2) return '2nd Friday Holiday';
  if (d === 0 && n === 3) return '3rd Sunday Holiday';
  if (d === 0 && n === 4) return '4th Sunday Holiday';
  return null;
}

/** The date as YYYY-MM-DD in local time — how the calendar master writes it. */
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function govtHolidayName(date: Date, holidays: GovtHolidayMap | undefined): string | null {
  const list = holidays?.[String(date.getFullYear())] ?? [];
  const day = isoDate(date);
  return list.find((h) => h?.d === day)?.name ?? null;
}

export type HolidayInfo =
  | { kind: 'govt'; name: string; headline: string }
  | { kind: 'friday' | 'sunday'; name: string; headline: string };

/**
 * Is this date a holiday, and which? Government first, then the weekly rule.
 * `headline` is the Dashboard's "Today is …" line.
 */
export function holidayOn(date: Date, holidays: GovtHolidayMap | undefined): HolidayInfo | null {
  const govt = govtHolidayName(date, holidays);
  if (govt) return { kind: 'govt', name: govt, headline: `Today is ${govt}` };
  const weekly = weeklyHolidayName(date);
  if (!weekly) return null;
  return date.getDay() === 5
    ? { kind: 'friday', name: weekly, headline: 'Today is a Friday Holiday' }
    : { kind: 'sunday', name: weekly, headline: 'Today is a Sunday Holiday' };
}

/** A holiday of either kind — the test every working-day count uses. */
export function isHoliday(date: Date, holidays: GovtHolidayMap | undefined): boolean {
  return holidayOn(date, holidays) !== null;
}

/**
 * Working days up to and including `uptoDay` of a month, split by whether a day
 * sheet exists — the Dashboard's "Entries This Month" and "Days Without Entry".
 * A holiday of either kind is neither: it is not a missed day.
 */
export function workingDayCounts(
  hasEntry: (isoDay: string) => boolean,
  year: number,
  month: number,
  uptoDay: number,
  holidays: GovtHolidayMap | undefined,
): { withEntry: number; withoutEntry: number; holidays: number } {
  let withEntry = 0;
  let withoutEntry = 0;
  let off = 0;
  for (let d = 1; d <= uptoDay; d++) {
    const date = new Date(year, month - 1, d);
    if (isHoliday(date, holidays)) {
      off++;
      continue;
    }
    if (hasEntry(isoDate(date))) withEntry++;
    else withoutEntry++;
  }
  return { withEntry, withoutEntry, holidays: off };
}
