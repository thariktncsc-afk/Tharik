/**
 * The stock chain: today's closing is tomorrow's opening, with no break.
 *
 *     opening(D) = closing of the last day that moved stock before D
 *     closing(D) = opening(D) + receipt(D) + excess − shortage − transfer − sales(D)
 *
 * The carry used to be "the closing of the last SAVED DAY SHEET", on the
 * reasoning that stock does not move on a day the shop did not trade. That was
 * true when a sheet was the only way stock could move. It stopped being true
 * when the Receipt Register began feeding Daily Entry: a godown delivery moves
 * stock on its own, on a date nobody keyed a sheet for.
 *
 * So a shop with a sheet on the 8th closing at 918, a 3224 kg delivery on the
 * 9th and no sheet for the 9th opened the 10th at 918 — the delivery fell
 * through the gap, and every day after it inherited the wrong balance. The
 * month was right the whole time, because dailyRollupForMonth already walks
 * every date and counts receipts and inspections on sheet-less days; it was
 * only the day-to-day carry that skipped them.
 *
 * WHAT COUNTS IN THE GAP. Days between the last sheet and D have no sheet, so
 * they have no sales — a sale is only ever recorded on a sheet. What they can
 * have is a godown receipt and an inspection adjustment, and both move stock.
 * They are added to the carried closing in the same arithmetic the grid uses.
 *
 * The index is built once per shop and reused for every commodity: a Daily
 * Entry render asks this 26 times and would otherwise rescan the register each
 * time.
 */
import type { DayEntry } from '@/lib/engine/commodities';
import { type ReceiptRow } from '@/lib/engine/receiptRollup';

type InspRec = { excess?: unknown; shortage?: unknown; transfer?: unknown };
type InspDay = { a?: Record<string, InspRec>; b?: Record<string, InspRec> };
export type Section = 'a' | 'b';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type ChainIndex = {
  crsId: number;
  /** Dates this shop has a saved sheet for, newest first. */
  sheetDates: string[];
  sheets: Record<string, DayEntry>;
  /** date → commodity → kgs delivered by the godown. */
  receipts: Record<string, Record<string, number>>;
  /** date → `<sec>:<comm>` → net adjustment (excess − shortage − transfer). */
  adjustments: Record<string, Record<string, number>>;
};

/**
 * One pass over the three stores, keeping only this shop.
 *
 * Keys are matched on the NUMBER before the first underscore, never a string
 * prefix — CRS 1 must not pick up CRS 10-19's days.
 */
export function buildChainIndex(
  entryStore: Record<string, DayEntry> | undefined,
  // Loosely typed on purpose: three screens hold this store under three
  // slightly different shapes, and every field is read defensively below.
  inspectionStore: Record<string, unknown> | undefined,
  receiptStore: ReceiptRow[] | undefined,
  crsId: number,
): ChainIndex {
  const mine = (key: string): string | null => {
    const at = key.indexOf('_');
    if (at === -1 || Number(key.slice(0, at)) !== Number(crsId)) return null;
    const ds = key.slice(at + 1);
    return ISO.test(ds) ? ds : null;
  };

  const sheets: Record<string, DayEntry> = {};
  const sheetDates: string[] = [];
  for (const [k, sheet] of Object.entries(entryStore ?? {})) {
    const ds = mine(k);
    if (!ds) continue;
    sheets[ds] = sheet;
    sheetDates.push(ds);
  }
  sheetDates.sort().reverse();

  const adjustments: Record<string, Record<string, number>> = {};
  for (const [k, raw] of Object.entries(inspectionStore ?? {})) {
    const ds = mine(k);
    if (!ds) continue;
    const day = (raw ?? {}) as InspDay;
    const out: Record<string, number> = {};
    for (const sec of ['a', 'b'] as const) {
      for (const [id, r] of Object.entries(day?.[sec] ?? {})) {
        // The grid's own arithmetic: excess adds, shortage and an outward
        // transfer subtract (TRANSFER_IS_OUTWARD in the engine).
        const net = num(r?.excess) - num(r?.shortage) - num(r?.transfer);
        if (net) out[`${sec}:${id}`] = net;
      }
    }
    if (Object.keys(out).length) adjustments[ds] = out;
  }

  const receipts: Record<string, Record<string, number>> = {};
  for (const row of receiptStore ?? []) {
    if (Number(row?.crsId) !== Number(crsId)) continue;
    const ds = String(row?.date ?? '');
    if (!ISO.test(ds)) continue;
    const day = (receipts[ds] ??= {});
    for (const [id, item] of Object.entries(row?.items ?? {})) {
      const raw = item && typeof item === 'object' ? (item as { qty?: unknown }).qty : item;
      const q = num(raw);
      if (q) day[id] = (day[id] ?? 0) + q;
    }
  }

  return { crsId, sheetDates, sheets, receipts, adjustments };
}

export type Carry = {
  /** The sheet the balance is carried from, or null when none exists yet. */
  from: { date: string; close: number } | null;
  /** Godown deliveries on the sheet-less days in between. */
  received: number;
  /** Inspection net on those days. */
  adjusted: number;
  /** Those dates, earliest first — what to name when explaining the figure. */
  movedOn: string[];
  /** The balance itself, or null when there is no earlier sheet to carry from. */
  value: number | null;
};

/**
 * Walk the chain up to a boundary date for one commodity.
 *
 * `upto` is exclusive for an opening (what the day starts with) and inclusive
 * for a closing (where the day ends). Both are the same walk; only the bound
 * differs, which is the whole point — an opening IS the previous closing.
 */
function walk(ix: ChainIndex, upto: string, commId: string, sec: Section, inclusive: boolean): Carry {
  const within = (ds: string) => (inclusive ? ds <= upto : ds < upto);

  // The last sheet that actually states this commodity. A sheet saved before
  // the commodity existed does not, and is not a balance for it.
  let from: Carry['from'] = null;
  for (const ds of ix.sheetDates) {
    if (!within(ds)) continue;
    const rec = ix.sheets[ds]?.[sec]?.[commId];
    if (rec !== undefined) {
      from = { date: ds, close: num(rec.close) };
      break;
    }
  }
  if (!from) return { from: null, received: 0, adjusted: 0, movedOn: [], value: null };

  let received = 0;
  let adjusted = 0;
  const movedOn = new Set<string>();
  for (const [ds, day] of Object.entries(ix.receipts)) {
    if (ds <= from.date || !within(ds)) continue;
    const q = day[commId] ?? 0;
    if (q) {
      received += q;
      movedOn.add(ds);
    }
  }
  for (const [ds, day] of Object.entries(ix.adjustments)) {
    if (ds <= from.date || !within(ds)) continue;
    const net = day[`${sec}:${commId}`] ?? 0;
    if (net) {
      adjusted += net;
      movedOn.add(ds);
    }
  }

  return { from, received, adjusted, movedOn: [...movedOn].sort(), value: from.close + received + adjusted };
}

/** What this commodity's Opening should be on `dateIso`. */
export function openingFor(ix: ChainIndex, dateIso: string, commId: string, sec: Section): Carry {
  return walk(ix, dateIso, commId, sec, false);
}

/**
 * This commodity's stock position AS AT `dateIso`, the figure the Dashboard's
 * Closing Stock shows. A sheet on that date states it outright; without one it
 * is the carried balance plus whatever that day itself received.
 */
export function closingAsAt(ix: ChainIndex, dateIso: string, commId: string, sec: Section): Carry {
  return walk(ix, dateIso, commId, sec, true);
}

/**
 * Every date at or before `upto` where stock moved without a sheet — the days
 * a carry silently stepped over. For explaining a figure, not for arithmetic.
 */
export function unsheetedMoves(ix: ChainIndex, fromDate: string, upto: string): string[] {
  const out = new Set<string>();
  for (const ds of [...Object.keys(ix.receipts), ...Object.keys(ix.adjustments)]) {
    if (ds > fromDate && ds < upto && ix.sheets[ds] === undefined) out.add(ds);
  }
  return [...out].sort();
}
