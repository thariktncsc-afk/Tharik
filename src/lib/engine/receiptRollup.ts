/**
 * Godown receipts (receiptStore) → the Receipt column of Daily / Monthly Entry.
 *
 * The Receipt Register is the authoritative record of what the godown actually
 * delivered, so a receipt keyed there fills the Receipt cell of that shop-day
 * instead of being keyed a second time by hand. This is the same precedence the
 * statements have always used — 11-statement-core.js MODULE 4 resolves a
 * commodity's receipt as `receiptTotals[id] || getVal(id,'receipt')`, godown
 * rows first and the keyed column only as the fallback. Applying it in the
 * entry screens as well keeps entryStore/monthlyStore agreeing with the
 * statement rather than quietly diverging from it.
 *
 * BOTH receipt types count here. Regular vs Advance (33-receipt-type.js) decides
 * COLL eligibility, not whether the stock arrived — an Advance receipt is grain
 * physically in the shop, and MODULE 4 has always totalled it into the receipt
 * figure. Only 24-coll.js filters on the type.
 *
 * Commodity ids are unique across sections A and B, so an item id maps to
 * exactly one section without the receipt row having to record one.
 */

export type ReceiptItem = { qty?: number | string } | number | string;
export type ReceiptRow = {
  crsId: number | string;
  date: string;
  receiptNo?: string;
  items?: Record<string, ReceiptItem>;
  type?: 'regular' | 'advance';
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Tolerate both the `{qty}` rows the app writes and a bare number. */
function qtyOf(item: ReceiptItem | undefined): number {
  if (item === undefined || item === null) return 0;
  const raw = typeof item === 'object' ? item.qty : item;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

const sameShop = (row: ReceiptRow, crsId: number) => Number(row.crsId) === Number(crsId);

/**
 * Total received per commodity for one shop-day.
 * A date may carry several receipts (Regular and Advance, or repeats of
 * either) — every one of them is summed, as receiptStore has always allowed.
 */
export function receiptQtyForDay(store: ReceiptRow[] | undefined, crsId: number, dateIso: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!store?.length || !crsId || !dateIso) return out;
  for (const r of store) {
    if (!sameShop(r, crsId) || String(r.date ?? '') !== dateIso) continue;
    for (const [id, item] of Object.entries(r.items ?? {})) {
      const q = qtyOf(item);
      if (q) out[id] = (out[id] ?? 0) + q;
    }
  }
  return out;
}

/** The receipt numbers behind one shop-day's commodity figure, for the tooltip. */
export function receiptRefsForDay(store: ReceiptRow[] | undefined, crsId: number, dateIso: string, commId: string): string[] {
  if (!store?.length || !crsId || !dateIso) return [];
  const refs: string[] = [];
  for (const r of store) {
    if (!sameShop(r, crsId) || String(r.date ?? '') !== dateIso) continue;
    if (!qtyOf(r.items?.[commId])) continue;
    refs.push(r.receiptNo?.trim() || '(no receipt no.)');
  }
  return refs;
}

type SheetRow = { open?: unknown; receipt?: unknown; sales?: unknown; total?: unknown; close?: unknown; excess?: unknown; shortage?: unknown; transfer?: unknown };
type Sheet = { a?: Record<string, SheetRow>; b?: Record<string, SheetRow>; [k: string]: unknown };

/**
 * Write the register's figures onto a day sheet that is already saved.
 *
 * The Receipt column of Daily Entry has always DISPLAYED the register
 * (receiptQtyForDay), and a save writes what is displayed — so a receipt keyed
 * before the day sheet needs nothing more. A receipt keyed AFTER one does: the
 * screen shows the new figure while the stored sheet still holds the old, and
 * two things read the stored sheet rather than the register — the DSS
 * (17-dss-export.js takes `d.receipt` straight off the day) and tomorrow's
 * Opening, which carries from this day's stored Closing. Left alone, the shop
 * sees a Closing of 1250 on the 9th and an Opening of 750 on the 10th.
 *
 * Only commodities the register spoke for — before this change or after it —
 * are touched, so a Receipt keyed by hand on a sheet the register has never
 * mentioned is left exactly as it was. Total and Closing are recomputed from
 * the row's own adjustment fields, which is the arithmetic stockGuard.ts
 * enforces and what Daily Entry itself shows.
 *
 * Returns null when nothing needs changing — including for a projected sheet,
 * which is Monthly Entry's output and states the whole month's receipt.
 */
export function syncSheetReceipts(
  sheet: Sheet | undefined,
  before: ReceiptRow[] | undefined,
  after: ReceiptRow[] | undefined,
  crsId: number,
  dateIso: string,
): Sheet | null {
  if (!sheet || sheet.__projection) return null;
  const was = receiptQtyForDay(before, crsId, dateIso);
  const now = receiptQtyForDay(after, crsId, dateIso);
  const spoken = new Set([...Object.keys(was), ...Object.keys(now)]);
  if (!spoken.size) return null;

  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const next: Sheet = { ...sheet };
  let changed = false;
  for (const sec of ['a', 'b'] as const) {
    const blk = sheet[sec];
    if (!blk) continue;
    let secChanged = false;
    const copy: Record<string, SheetRow> = { ...blk };
    for (const id of spoken) {
      const row = blk[id];
      if (!row) continue;
      const receipt = now[id] ?? 0;
      if (n(row.receipt) === receipt) continue;
      const total = n(row.open) + receipt + n(row.excess) - n(row.shortage) - n(row.transfer);
      copy[id] = { ...row, receipt, total, close: total - n(row.sales) };
      secChanged = true;
    }
    if (secChanged) {
      next[sec] = copy;
      changed = true;
    }
  }
  return changed ? next : null;
}

/**
 * Every day of one month that carries godown receipts, keyed by ISO date.
 * The monthly rollup walks the month day by day and needs to know which days
 * have receipts even when no day sheet was ever saved for them.
 */
export function receiptQtyForMonth(
  store: ReceiptRow[] | undefined,
  crsId: number,
  month: number,
  year: number,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  if (!store?.length || !crsId) return out;
  const prefix = `${year}-${pad2(month)}`;
  for (const r of store) {
    if (!sameShop(r, crsId)) continue;
    const ds = String(r.date ?? '');
    if (!ds.startsWith(prefix)) continue;
    const day = (out[ds] ??= {});
    for (const [id, item] of Object.entries(r.items ?? {})) {
      const q = qtyOf(item);
      if (q) day[id] = (day[id] ?? 0) + q;
    }
  }
  return out;
}
