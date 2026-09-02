/**
 * Holiday rules — ported from 08-dashboard.js (weekly shop holidays) and
 * 10-holidays.js (TN government calendar).
 *
 * Shops close on the 1st & 2nd Fridays and the 3rd & 4th Sundays of each
 * month. The government calendar is a master (`__holidays` in crs_state,
 * seeded from the engine's literals) — callers pass the store's value so a
 * year added by an admin reaches the converted screens too.
 */
export type GovtHolidayMap = Record<string, { d: string; name: string }[]>;

export const MONTH_NAMES_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Week-of-month for the weekly rules (same arithmetic as the engine). */
function weekNum(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  return Math.ceil((date.getDate() + firstDay) / 7);
}

export function isWeeklyHoliday(date: Date): boolean {
  const d = date.getDay();
  const w = weekNum(date);
  if (d === 5 && (w === 1 || w === 2)) return true;
  if (d === 0 && (w === 3 || w === 4)) return true;
  return false;
}

export function weeklyHolidayName(date: Date): string | null {
  const d = date.getDay();
  const w = weekNum(date);
  if (d === 5 && w === 1) return '1st Friday Holiday';
  if (d === 5 && w === 2) return '2nd Friday Holiday';
  if (d === 0 && w === 3) return '3rd Sunday Holiday';
  if (d === 0 && w === 4) return '4th Sunday Holiday';
  return null;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function govtHolidayName(date: Date, holidays: GovtHolidayMap | undefined): string | null {
  const list = holidays?.[String(date.getFullYear())] ?? [];
  return list.find((h) => h.d === iso(date))?.name ?? null;
}
