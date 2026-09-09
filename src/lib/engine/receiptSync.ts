/**
 * Bring one shop-month back in step after the Receipt Register changed.
 *
 * The register is the record of what the godown delivered, so a receipt that
 * is created, corrected or deleted has to reach everything downstream of it.
 * Four things hold a copy of that figure, and each goes stale for its own
 * reason:
 *
 *   1. THE DAY SHEET for the receipt's own date. The Daily grid displays the
 *      register, but a sheet saved earlier stored the old number — and the DSS
 *      (17-dss-export.js reads `d.receipt` straight off the day), tomorrow's
 *      Opening carry and Dashboard Closing Stock all read the stored sheet.
 *
 *   2. meManualStore. A Monthly Entry save writes the row it displayed, and on
 *      a register-sourced row that row IS the register's total. Once the last
 *      receipt is deleted the roll-up stops overriding it (`d.godown` is
 *      false), so the copy survives its source and the month keeps a Receipt
 *      no record anywhere accounts for. THIS is why a deleted receipt appeared
 *      to linger in Monthly Entry. meSourceStore says which rows were
 *      register-sourced, which is what makes the stale ones identifiable.
 *
 *   3. monthlyStore / meSourceStore — republished from the above.
 *
 *   4. THE PROJECTED SHEET of a monthly-keyed month. It is the month written
 *      out as its last day for the DSS and the date-wise sections, and it is
 *      regenerated only by a Monthly Entry save — so a receipt deleted in
 *      between left it stating stock that no longer exists.
 *
 * It lives here, apart from both callers, because a receipt can be deleted two
 * ways — an administrator on the Receipt page, or an approved clear request
 * (clearExecute.ts) — and the two paths must leave the data identical. Pure
 * in, pure out: tools/verify-stock-lock.mjs runs it directly.
 */
import { type Commodity, type DayEntry } from '@/lib/engine/commodities';
import {
  rebuildMonthlyFromDaily,
  withRegisterReceipt,
  type MonthlyBlock,
  type MonthlyRec,
  type SourceBlock,
} from '@/lib/engine/monthlyRollup';
import { receiptQtyForMonth, syncSheetReceipts, type ReceiptRow } from '@/lib/engine/receiptRollup';
import { buildProjectedSheet, isProjectedSheet, projectionKey, realSheetDates, type ProjectedMonth } from '@/lib/engine/monthProjection';

type InspStore = Record<string, unknown>;

export type ReceiptSyncStores = {
  entryStore: Record<string, DayEntry>;
  inspectionStore: InspStore;
  meManualStore: Record<string, Partial<MonthlyBlock>>;
  meSourceStore: Record<string, SourceBlock>;
  monthlyStore: Record<string, MonthlyBlock>;
  receiptStore: ReceiptRow[];
};

/** Only the stores that actually changed, ready to be written back. */
export type ReceiptSyncResult = Partial<Pick<ReceiptSyncStores, 'entryStore' | 'meManualStore' | 'meSourceStore' | 'monthlyStore'>>;

/** The register's total per commodity across one shop-month. */
export function registerMonthTotals(store: ReceiptRow[] | undefined, crsId: number, month: number, year: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const day of Object.values(receiptQtyForMonth(store, crsId, month, year))) {
    for (const [id, qty] of Object.entries(day)) out[id] = (out[id] ?? 0) + qty;
  }
  return out;
}

/**
 * Put every register-sourced Receipt in the manual month back to what the
 * register now says — zero when nothing is left of it.
 *
 * Only rows meSourceStore marked `'receipt'` are touched: those are the ones
 * whose figure was the register's to begin with. A Receipt keyed by hand into
 * a month the register has never spoken for is somebody's own work and is left
 * exactly as it is.
 *
 * Returns null when nothing needed changing, so an idle republish writes
 * nothing and the audit trail stays a record of real changes.
 */
export function reconcileManualReceipts(
  manual: Partial<MonthlyBlock> | undefined,
  source: SourceBlock | undefined,
  regTotals: Record<string, number>,
): Partial<MonthlyBlock> | null {
  if (!manual || !source) return null;
  const next: Partial<MonthlyBlock> = { ...manual };
  let changed = false;
  for (const sec of ['a', 'b'] as const) {
    const blk = manual[sec];
    if (!blk) continue;
    const copy: Record<string, MonthlyRec> = { ...blk };
    let secChanged = false;
    for (const [id, rec] of Object.entries(blk)) {
      if (source[sec]?.[id] !== 'receipt') continue;
      const want = regTotals[id] ?? 0;
      if (Math.abs((Number(rec.receipt) || 0) - want) < 0.0005) continue;
      copy[id] = withRegisterReceipt(rec, want, id);
      secChanged = true;
    }
    if (secChanged) {
      next[sec] = copy;
      changed = true;
    }
  }
  return changed ? next : null;
}

/** The published month as the rows a projected day sheet is built from. */
function asProjectedMonth(merged: MonthlyBlock): ProjectedMonth {
  const out: ProjectedMonth = { a: {}, b: {} };
  for (const sec of ['a', 'b'] as const) {
    for (const [id, r] of Object.entries(merged[sec] ?? {})) {
      out[sec][id] = {
        open: Number(r.open) || 0,
        receipt: Number(r.receipt) || 0,
        total: Number(r.total) || 0,
        sales: Number(r.sales) || 0,
        close: Number(r.close) || 0,
        amount: Number(r.amount) || 0,
        excess: Number(r.excess) || 0,
        shortage: Number(r.shortage) || 0,
        transfer: Number(r.transfer) || 0,
      };
    }
  }
  return out;
}

/** Does a published month carry anything at all? */
const published = (b: MonthlyBlock) => !!(Object.keys(b.a ?? {}).length || Object.keys(b.b ?? {}).length);

/**
 * Resync one shop-month after its receipts changed.
 *
 * `dateIso` + `before` are the receipt's own date and the register as it stood
 * beforehand; pass both to bring that day's saved sheet along too. Everything
 * else is derived from the register as it stands now.
 */
export function resyncReceiptMonth(
  stores: ReceiptSyncStores,
  crsId: number,
  month: number,
  year: number,
  opts?: { dateIso?: string; before?: ReceiptRow[]; lists?: { a: Commodity[]; b: Commodity[] } },
): ReceiptSyncResult {
  const out: ReceiptSyncResult = {};
  const mKey = `${crsId}_${month}_${year}`;

  // 1 — the receipt's own day sheet.
  let entryStore = stores.entryStore;
  if (opts?.dateIso && opts.before) {
    const dayKey = `${crsId}_${opts.dateIso}`;
    const synced = syncSheetReceipts(entryStore[dayKey], opts.before, stores.receiptStore, crsId, opts.dateIso);
    if (synced) {
      entryStore = { ...entryStore, [dayKey]: synced as DayEntry };
      out.entryStore = entryStore;
    }
  }

  // 2 — the manual month's copy of the register's figure.
  let manual = stores.meManualStore[mKey];
  const fixed = reconcileManualReceipts(manual, stores.meSourceStore[mKey], registerMonthTotals(stores.receiptStore, crsId, month, year));
  if (fixed) {
    manual = fixed;
    out.meManualStore = { ...stores.meManualStore, [mKey]: fixed };
  }

  // 3 — republish the month from what survives.
  const built = rebuildMonthlyFromDaily(
    crsId,
    month,
    year,
    entryStore,
    stores.inspectionStore as never,
    manual,
    opts?.lists,
    stores.receiptStore,
  );
  const monthly = { ...stores.monthlyStore };
  const source = { ...stores.meSourceStore };
  if (published(built.merged)) {
    monthly[mKey] = built.merged;
    source[mKey] = built.source;
  } else {
    delete monthly[mKey];
    delete source[mKey];
  }
  out.monthlyStore = monthly;
  out.meSourceStore = source;

  // 4 — the projected sheet of a monthly-keyed month. It prints the month as
  // its last day, so it has to state the month the register now describes.
  const pKey = projectionKey(crsId, month, year);
  const projection = entryStore[pKey];
  if (isProjectedSheet(projection) && realSheetDates(entryStore, crsId, month, year).length === 0) {
    // The month-close is still the one the clerk did — only its figures moved
    // — so the recorded time stays as it was.
    const at = projection.__projection.at;
    const next = { ...entryStore };
    if (published(built.merged)) next[pKey] = buildProjectedSheet(asProjectedMonth(built.merged), at);
    else delete next[pKey];
    out.entryStore = next;
  }

  return out;
}

