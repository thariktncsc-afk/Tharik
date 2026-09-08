/**
 * Monthly-only months: the projected day sheet.
 *
 * A shop that keys its month straight into Monthly Entry has no day sheets,
 * and two things only ever print from day sheets — the DSS, and the two
 * date-wise statement sections (Daily Sales, Remittance). So the month-close
 * writes the month's figures out as ONE day sheet, dated the last calendar day
 * of the month, and marks it as a projection.
 *
 * The marker is the whole design:
 *
 *   - The roll-up (monthlyRollup.ts) never reads a projected sheet. It is an
 *     OUTPUT of the month's manual values, not an input to them — read back,
 *     it would lock every row as "from Daily" and the shop could never correct
 *     its month again; and once a real sheet was keyed the month would count
 *     twice.
 *   - Saving a real day sheet in that month drops the projection. That is the
 *     exclusivity rule: a month is keyed by day OR by month, never both.
 *   - Everything that reads day sheets by date — the DSS, the date-wise
 *     sections, the next month's opening carry — sees an ordinary sheet.
 *     Nothing iterates a sheet's top-level keys, and a sheet already carries
 *     non-a/b keys (remits, remitAmount…), so the marker is invisible to them.
 *
 * Adjustments travel too. The DSS recomputes a day as opening + receipt +
 * inspNet(inspectionStore) and ignores a sheet's own total/close, so a month
 * whose adjustments came in from the imported workbooks (manual rows) needs
 * them in inspectionStore on that date as well, or the DSS disagrees with
 * Monthly Entry. Those entries carry the same marker and go with the sheet.
 * Adjustments recorded through Monthly Inspection are real events and are
 * never marked.
 *
 * Not copied: remittance and gunny. Both have their own monthly stores that
 * the statements already read for a manual month; a copy on the sheet would
 * be counted a second time.
 */
import type { DayEntry, EntryRecord } from '@/lib/engine/commodities';

export const PROJECTION = '__projection' as const;

export type ProjectionMark = { source: 'monthly'; at: string };
export type ProjectedSheet = DayEntry & { [PROJECTION]: ProjectionMark };

/** One commodity's month, as the Monthly Entry grid computes it. */
export type ProjectedRow = {
  open: number;
  receipt: number;
  total: number;
  sales: number;
  close: number;
  amount: number;
  excess: number;
  shortage: number;
  transfer: number;
};
export type ProjectedMonth = { a: Record<string, ProjectedRow>; b: Record<string, ProjectedRow> };

type InspRec = { excess?: number; shortage?: number; transfer?: number; [PROJECTION]?: boolean };
type InspDay = { a?: Record<string, InspRec>; b?: Record<string, InspRec> };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** ISO date of the month's last calendar day — February follows the leap year. */
export function lastDayOfMonth(month: number, year: number): string {
  return `${year}-${pad2(month)}-${pad2(new Date(year, month, 0).getDate())}`;
}

/** entryStore / inspectionStore key of the date a month-close writes to. */
export const projectionKey = (crsId: number, month: number, year: number) => `${crsId}_${lastDayOfMonth(month, year)}`;

export function isProjectedSheet(sheet: unknown): sheet is ProjectedSheet {
  return !!sheet && typeof sheet === 'object' && !!(sheet as Record<string, unknown>)[PROJECTION];
}

const isProjectedAdj = (r: InspRec | undefined) => !!r?.[PROJECTION];
const hasAdj = (r: InspRec | undefined) =>
  !!r && ((Number(r.excess) || 0) !== 0 || (Number(r.shortage) || 0) !== 0 || (Number(r.transfer) || 0) !== 0);

// "1_2026-09-" — the underscore keeps CRS 1 from matching CRS 11's keys.
const monthPrefix = (crsId: number, month: number, year: number) => `${crsId}_${year}-${pad2(month)}-`;

/**
 * Dates in the month with a sheet the shop actually keyed, projections
 * excluded, ascending. Non-empty means the month is keyed by day (Mode A).
 */
export function realSheetDates(entryStore: Record<string, DayEntry>, crsId: number, month: number, year: number): string[] {
  const prefix = monthPrefix(crsId, month, year);
  const dateAt = String(crsId).length + 1;
  const out: string[] = [];
  for (const [k, sheet] of Object.entries(entryStore)) {
    if (k.startsWith(prefix) && !isProjectedSheet(sheet)) out.push(k.slice(dateAt));
  }
  return out.sort();
}

/** The month as a day sheet — the same fields a Daily Entry save writes. */
export function buildProjectedSheet(month: ProjectedMonth, at: string = new Date().toISOString()): ProjectedSheet {
  const sheet: ProjectedSheet = { a: {}, b: {}, [PROJECTION]: { source: 'monthly', at } };
  for (const sec of ['a', 'b'] as const) {
    for (const [id, r] of Object.entries(month[sec])) {
      const rec: EntryRecord & Pick<ProjectedRow, 'total' | 'excess' | 'shortage' | 'transfer'> = {
        open: r.open,
        receipt: r.receipt,
        total: r.total,
        sales: r.sales,
        close: r.close,
        amount: r.amount,
        excess: r.excess,
        shortage: r.shortage,
        transfer: r.transfer,
      };
      sheet[sec]![id] = rec;
    }
  }
  return sheet;
}

/**
 * Writes onto the projection date the adjustments the grid took from the
 * manual rows — the ones no inspection in the month spoke for. An entry
 * somebody recorded is never overwritten, zero or not; a stale projected
 * entry from an earlier month-close is replaced or removed. Returns how many
 * were written. Mutates `inspDraft` (a crsData.update draft).
 */
export function applyProjectedAdjustments(
  inspDraft: Record<string, InspDay>,
  crsId: number,
  month: number,
  year: number,
  monthRows: ProjectedMonth,
): number {
  const prefix = monthPrefix(crsId, month, year);
  const spoken = new Set<string>();
  for (const [k, day] of Object.entries(inspDraft)) {
    if (!k.startsWith(prefix)) continue;
    for (const sec of ['a', 'b'] as const) {
      for (const [id, r] of Object.entries(day[sec] ?? {})) if (!isProjectedAdj(r) && hasAdj(r)) spoken.add(`${sec}:${id}`);
    }
  }

  const key = projectionKey(crsId, month, year);
  const cur = inspDraft[key];
  const next: Required<InspDay> = { a: { ...(cur?.a ?? {}) }, b: { ...(cur?.b ?? {}) } };
  let written = 0;
  let changed = false;
  for (const sec of ['a', 'b'] as const) {
    for (const [id, r] of Object.entries(monthRows[sec])) {
      const slot = next[sec][id];
      if (slot && !isProjectedAdj(slot)) continue;
      const wants = (r.excess !== 0 || r.shortage !== 0 || r.transfer !== 0) && !spoken.has(`${sec}:${id}`);
      if (wants) {
        next[sec][id] = { excess: r.excess, shortage: r.shortage, transfer: r.transfer, [PROJECTION]: true };
        written++;
        changed = true;
      } else if (slot) {
        delete next[sec][id];
        changed = true;
      }
    }
  }
  // Nothing to write is nothing to touch: a record somebody keyed must come
  // out of here byte-for-byte as it went in.
  if (!changed) return 0;
  if (Object.keys(next.a).length || Object.keys(next.b).length) inspDraft[key] = next;
  else delete inspDraft[key];
  return written;
}

/**
 * Removes the marked sheet(s) in the month. Real sheets are untouched.
 * Mutates the crsData.update draft; returns whether anything went.
 */
export function dropProjectedSheet(entryDraft: Record<string, DayEntry>, crsId: number, month: number, year: number): boolean {
  const prefix = monthPrefix(crsId, month, year);
  let dropped = false;
  for (const [k, s] of Object.entries(entryDraft)) {
    if (k.startsWith(prefix) && isProjectedSheet(s)) {
      delete entryDraft[k];
      dropped = true;
    }
  }
  return dropped;
}

/**
 * Removes the marked adjustment entries on the projection date. Entries an
 * inspector recorded — through Daily or Monthly Inspection — are untouched.
 * Mutates the crsData.update draft; returns how many went.
 */
export function dropProjectedAdjustments(inspDraft: Record<string, InspDay>, crsId: number, month: number, year: number): number {
  const key = projectionKey(crsId, month, year);
  const cur = inspDraft[key];
  if (!cur) return 0;
  const next: Required<InspDay> = { a: { ...(cur.a ?? {}) }, b: { ...(cur.b ?? {}) } };
  let dropped = 0;
  for (const sec of ['a', 'b'] as const) {
    for (const [id, r] of Object.entries(next[sec])) {
      if (isProjectedAdj(r)) {
        delete next[sec][id];
        dropped++;
      }
    }
  }
  if (dropped) {
    if (Object.keys(next.a).length || Object.keys(next.b).length) inspDraft[key] = next;
    else delete inspDraft[key];
  }
  return dropped;
}
