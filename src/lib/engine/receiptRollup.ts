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
