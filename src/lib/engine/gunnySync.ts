/**
 * Gunny Stock Management → Monthly Sales and the month's last-day Daily Entry
 * (office, 2026-09-30). `npm run verify:gunny-sync`.
 *
 * POLY and C.BOX leave the gunny stock as Empty Polythene Bag / Empty
 * Card+Box SALES — the only rows those bags have on Monthly and Daily Entry,
 * and the figure their money (₹2.50 / ₹0.60) reaches remittance from. When
 * Gunny Stock Management is saved, its POLY / C.BOX Issues become those sales:
 *
 *   Monthly Sales  meManualStore's EMPTY_BAG / EMPTY_BOX row = the Issues
 *                  (the row Monthly Entry's grid keys, same arithmetic).
 *   Last day       the sheet on the month's last CALENDAR date carries what
 *                  the month's other day sheets have not already sold, so the
 *                  month adds up to the Issues exactly once:
 *                    · keyed by day, sheet there → its two rows updated;
 *                    · keyed by day, no sheet, and the date has come → the
 *                      sheet is created as a Daily Entry save would make it
 *                      (carried Openings, the day's receipts and inspection,
 *                      Sales 0 elsewhere, no remittance) — office's choice;
 *                    · the date still ahead → nothing written yet (office's
 *                      choice: no future-dated sheet); Monthly Sales carries it,
 *                      and the first Gunny Save on or after the date writes it;
 *                    · keyed by month → its projection updated if the month
 *                      was closed; otherwise the month-close projects it.
 *   Then           the month is republished and the chain rebuilt from the
 *                  last day (next month's Opening carries from it), exactly as
 *                  a Daily Entry save does.
 *
 * 50 KG SS has no commodity row of its own on either screen, so it stays in
 * Gunny Stock Management only. Nothing here reads a Gunny figure back from the
 * sales, so there is no loop: the Gunny table already derives POLY / C.BOX
 * Issues from these sales when none is keyed. Pure — the caller writes the
 * patch through the data layer, and /api/state's guards judge it as ever.
 */
import { isCrs29, type Commodity, type DayEntry } from '@/lib/engine/commodities';
import { buildChainIndex, openingFor } from '@/lib/engine/stockChain';
import { receiptQtyForDay, type ReceiptRow } from '@/lib/engine/receiptRollup';
import { sheetTotals } from '@/lib/engine/remittance';
import { dropProjectedAdjustments, dropProjectedSheet, isProjectedSheet, lastDayOfMonth, realSheetDates } from '@/lib/engine/monthProjection';
import { dropMonthlyReceipt } from '@/lib/engine/monthlyReceipt';
import { rebuildMonthlyFromDaily, type MonthlyBlock, type MonthlyRec, type SourceBlock } from '@/lib/engine/monthlyRollup';
import { rechainAndRepublish } from '@/lib/engine/rechain';

export const GUNNY_SYNC_IDS = ['EMPTY_BOX', 'EMPTY_BAG'] as const;
export type GunnySyncId = (typeof GUNNY_SYNC_IDS)[number];

type Row = Record<string, unknown>;
type Sheet = DayEntry & Record<string, unknown>;
export type GunnySyncStores = {
  entryStore: Record<string, Sheet>;
  inspectionStore: Record<string, unknown>;
  receiptStore: ReceiptRow[];
  meManualStore: Record<string, Partial<MonthlyBlock>>;
  monthlyStore: Record<string, MonthlyBlock>;
  meSourceStore: Record<string, SourceBlock>;
};
export type LastDayAction = 'updated' | 'created' | 'unchanged' | 'waiting' | 'projection' | 'not-closed' | 'none' | 'crs29';
export type GunnySyncResult = {
  /** False when the figures cannot be placed — nothing may be written. */
  ok: boolean;
  problems: string[];
  /** Only the stores that changed. */
  patch: Partial<GunnySyncStores>;
  lastDate: string;
  lastDay: LastDayAction;
  /** What the last-day sheet carries for each (the Issues less the other days'). */
  onLastDay: Partial<Record<GunnySyncId, number>>;
  /** Monthly Sales after the sync. */
  monthly: Partial<Record<GunnySyncId, number>>;
  /** Keys the person's save wrote directly (for the activity log). */
  edited: { meManualStore?: string; entryStore?: string };
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const num = (v: unknown) => Number(v) || 0;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A sales row re-worked with a new Sales, the grid's own arithmetic. */
function withSales(row: Row | undefined, sales: number, c: Commodity): Row {
  const cur = row ?? {};
  const total = cur.total !== undefined ? num(cur.total) : num(cur.open) + num(cur.receipt) + num(cur.excess) - num(cur.shortage) - num(cur.transfer);
  return {
    open: 0, receipt: 0, excess: 0, shortage: 0, transfer: 0,
    ...cur,
    total,
    sales,
    close: r3(total - sales - num(cur.cs)),
    amount: c.free ? 0 : sales * c.rate,
  };
}

export function syncGunnyToSales(
  stores: GunnySyncStores,
  crsId: number,
  month: number,
  year: number,
  /** POLY → EMPTY_BAG, C.BOX → EMPTY_BOX: the Issues Gunny Stock Management shows. */
  want: Partial<Record<GunnySyncId, number>>,
  lists: { a: Commodity[]; b: Commodity[] },
  /** Today's date, YYYY-MM-DD — only to tell whether the last date has come. */
  today: string,
): GunnySyncResult {
  const key = `${crsId}_${month}_${year}`;
  const lastDate = lastDayOfMonth(month, year);
  const lastKey = `${crsId}_${lastDate}`;
  const out: GunnySyncResult = { ok: true, problems: [], patch: {}, lastDate, lastDay: 'none', onLastDay: {}, monthly: {}, edited: {} };
  const ids = GUNNY_SYNC_IDS.filter((id) => want[id] !== undefined && Number.isFinite(Number(want[id])));
  const comm = (id: string) => lists.a.find((c) => c.id === id);
  for (const id of ids) {
    if (!comm(id)) out.problems.push(`${id} is not on CRS ${crsId}'s sales grid.`);
    if (num(want[id]) < 0) out.problems.push(`${id}: Issues cannot be below 0.`);
  }
  if (out.problems.length || !ids.length) return { ...out, ok: !out.problems.length };

  const entryStore = clone(stores.entryStore) ?? {};
  let inspectionStore = stores.inspectionStore;
  let receiptStore = stores.receiptStore;
  const meManualStore = clone(stores.meManualStore) ?? {};

  // ── Monthly Sales: the hand-keyed row, as the grid keys it ────────────────
  const manual = (meManualStore[key] = { a: { ...(meManualStore[key]?.a ?? {}) }, b: { ...(meManualStore[key]?.b ?? {}) } });
  for (const id of ids) {
    const w = r3(num(want[id]));
    const cur = manual.a![id] as Row | undefined;
    if (!cur && w === 0) continue; // nothing keyed, nothing to state
    if (cur && r3(num(cur.sales)) === w) continue;
    manual.a![id] = withSales(cur, w, comm(id)!) as unknown as MonthlyRec;
  }

  // ── The last calendar day ─────────────────────────────────────────────────
  const real = realSheetDates(entryStore as Record<string, DayEntry>, crsId, month, year);
  let sheetMoved = false;
  if (real.length) {
    // Keyed by day: the last day carries what the other days have not sold.
    for (const id of ids) {
      const others = real.filter((d) => d !== lastDate).reduce((s, d) => s + num((entryStore[`${crsId}_${d}`]?.a?.[id] as Row | undefined)?.sales), 0);
      const onLast = r3(num(want[id]) - others);
      if (onLast < 0) out.problems.push(`${comm(id)!.en}: the month's day sheets already sell ${r3(others)}, more than the Gunny Issues ${r3(num(want[id]))}. Correct the day sheets or the Issues.`);
      out.onLastDay[id] = onLast;
    }
    if (out.problems.length) return { ...out, ok: false };
    const sheet = entryStore[lastKey];
    const needs = ids.some((id) => out.onLastDay[id]! !== 0);
    if (sheet && !isProjectedSheet(sheet)) {
      const next: Sheet = { ...sheet, a: { ...(sheet.a ?? {}) } };
      for (const id of ids) {
        const row = next.a![id] as Row | undefined;
        if (row ? r3(num(row.sales)) !== out.onLastDay[id] : out.onLastDay[id] !== 0) {
          next.a![id] = withSales(row, out.onLastDay[id]!, comm(id)!) as never;
        }
      }
      if (!same(next, sheet)) {
        entryStore[lastKey] = next;
        sheetMoved = true;
        out.lastDay = 'updated';
      } else out.lastDay = 'unchanged';
    } else if (!needs) {
      out.lastDay = 'unchanged';
    } else if (lastDate > today) {
      out.lastDay = 'waiting';
    } else if (isCrs29(crsId)) {
      // A CRS 29 day sheet is not complete without its Free / Cost Rice, which
      // only the camp can state (crs29Rice.ts) — the clerk's own save of the
      // day carries these sales in from Monthly Sales' row.
      out.lastDay = 'crs29';
    } else {
      // A Daily Entry save of that date (daily-entry/page.tsx derive / save).
      const chain = buildChainIndex(entryStore as never, inspectionStore as never, receiptStore as never, crsId);
      const dayReceipts = receiptQtyForDay(receiptStore, crsId, lastDate);
      const insp = (inspectionStore as Record<string, { a?: Record<string, Row>; b?: Record<string, Row> }>)[lastKey];
      const snap: Sheet = { a: {}, b: {} } as Sheet;
      for (const [sec, comms] of [['a', lists.a], ['b', lists.b]] as const) {
        for (const c of comms) {
          const carried = openingFor(chain, lastDate, c.id, sec).value;
          const open = carried === null ? 0 : carried;
          const receipt = dayReceipts[c.id] || 0;
          const r = insp?.[sec]?.[c.id] ?? {};
          const adj = { excess: num(r.excess), shortage: num(r.shortage), transfer: num(r.transfer) };
          const sales = sec === 'a' && (ids as readonly string[]).includes(c.id) ? out.onLastDay[c.id as GunnySyncId]! : 0;
          const total = open + receipt + adj.excess - adj.shortage - adj.transfer;
          snap[sec]![c.id] = { open, receipt, total, sales, close: total - sales, amount: c.free ? 0 : sales * c.rate, ...adj } as never;
        }
      }
      snap.remits = [];
      Object.assign(snap, sheetTotals([]));
      entryStore[lastKey] = snap;
      sheetMoved = true;
      out.lastDay = 'created';
      dropProjectedSheet(entryStore as Record<string, DayEntry>, crsId, month, year);
      const insp2 = clone(inspectionStore) as Record<string, never>;
      if (dropProjectedAdjustments(insp2, crsId, month, year)) inspectionStore = insp2;
      const drop = dropMonthlyReceipt(receiptStore, crsId, month, year);
      if (drop.dropped) receiptStore = drop.rows;
    }
  } else {
    // Keyed by month: the month-close's projection is the last-day sheet.
    const proj = entryStore[lastKey];
    if (isProjectedSheet(proj)) {
      const next: Sheet = { ...proj, a: { ...(proj.a ?? {}) } };
      for (const id of ids) {
        out.onLastDay[id] = r3(num(want[id]));
        const row = next.a![id] as Row | undefined;
        if (row ? r3(num(row.sales)) !== out.onLastDay[id] : out.onLastDay[id] !== 0) next.a![id] = withSales(row, out.onLastDay[id]!, comm(id)!) as never;
      }
      if (!same(next, proj)) {
        entryStore[lastKey] = next;
        sheetMoved = true;
        out.lastDay = 'projection';
      } else out.lastDay = 'unchanged';
    } else {
      out.lastDay = 'not-closed';
    }
  }

  // ── Republish the month, then the chain from the last day on ──────────────
  const merged = rebuildMonthlyFromDaily(crsId, month, year, entryStore as Record<string, DayEntry>, inspectionStore as never, meManualStore[key], lists, receiptStore);
  const monthlyStore = { ...stores.monthlyStore, [key]: merged.merged };
  const meSourceStore = { ...stores.meSourceStore, [key]: merged.source };
  let next: GunnySyncStores = { entryStore, inspectionStore, receiptStore, meManualStore, monthlyStore, meSourceStore };
  if (sheetMoved) {
    const chained = rechainAndRepublish(next as never, crsId, lastDate, lists);
    next = { ...next, ...(chained.patch as Partial<GunnySyncStores>) };
  }
  for (const id of ids) out.monthly[id] = r3(num((next.monthlyStore[key]?.a?.[id] as Row | undefined)?.sales));

  for (const k of Object.keys(next) as (keyof GunnySyncStores)[]) {
    if (!same(next[k], stores[k])) (out.patch as Record<string, unknown>)[k] = next[k];
  }
  if (out.patch.meManualStore && !same(meManualStore[key], stores.meManualStore?.[key])) out.edited.meManualStore = key;
  if (out.patch.entryStore && !same(next.entryStore[lastKey], stores.entryStore?.[lastKey])) out.edited.entryStore = lastKey;
  return out;
}

/** One line for the Save's status: what reached Monthly Sales and the last day. */
export function gunnySyncNote(r: GunnySyncResult, fmt: (iso: string) => string): string {
  const said = (ids: Partial<Record<GunnySyncId, number>>) =>
    GUNNY_SYNC_IDS.filter((id) => ids[id] !== undefined).map((id) => `${id === 'EMPTY_BOX' ? 'C.Box' : 'Poly'} ${ids[id]}`).join(', ');
  const monthly = said(r.monthly);
  const day = fmt(r.lastDate);
  const last: Record<LastDayAction, string> = {
    updated: `the ${day} sheet updated (${said(r.onLastDay)})`,
    created: `the ${day} sheet created (${said(r.onLastDay)})`,
    unchanged: `the ${day} sheet already agrees`,
    waiting: `the ${day} sheet follows on the first Gunny Save on or after that date`,
    projection: `the month's ${day} sheet updated`,
    'not-closed': `the ${day} sheet is written when the month is closed`,
    none: '',
    crs29: `the ${day} sheet takes them when it is saved on Daily Entry (CRS 29 needs its Free / Cost Rice)`,
  };
  return monthly ? `Monthly Sales: ${monthly}${last[r.lastDay] ? `; ${last[r.lastDay]}` : ''}.` : '';
}
