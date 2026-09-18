/**
 * Which dates get a DSS page — and the page for a date with receipts only.
 *
 * The DSS is ONE statement per shop per date. A date belongs in it when the
 * shop's stock moved that day for any reason on record:
 *
 *   Sales saved (a day sheet)          → that sheet, as it always has been
 *   Receipt only (Receipt Register)    → a page built here, Sales 0
 *   Receipt + Sales on the same date   → the day sheet, which already carries
 *                                        the register's receipt (rechain.ts
 *                                        keeps it in line) — still ONE page
 *
 * A receipt-only page is never stored: it is worked out every time the DSS
 * opens, from the same chain Daily Entry shows (stockChain.ts) —
 *
 *     Opening = the balance carried in (previous day's Closing, plus anything
 *               that moved on sheet-less days in between)
 *     Receipt = that date's register receipts
 *     Total   = Opening + Receipt (the DSS adds that date's inspection itself)
 *     Closing = Total − 0
 *
 * — so adding, editing or deleting a receipt, or saving Sales on that date
 * later, changes the page at once, and there is nothing to fall out of step or
 * to duplicate. The dates after it already carry the receipt (stockChain's
 * gap rule), so the pages agree with each other.
 *
 * Left out, deliberately:
 *   - a month keyed on Monthly Entry (it has a projected last-day sheet that
 *     already states the whole month, receipts included — a separate receipt
 *     page would count them twice);
 *   - a receipt before the shop's first day sheet: there is no Opening to
 *     carry into it (the shop's Initial Opening Balance comes later).
 *
 * The DSS fee counts the same set of days (/api/payments), so a shop pays for
 * exactly the pages it receives.
 */
import type { DayEntry } from '@/lib/engine/commodities';
import { receiptQtyForDay, type ReceiptRow } from '@/lib/engine/receiptRollup';
import { buildChainIndex, openingFor } from '@/lib/engine/stockChain';

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v);
const kg = (n: number) => Math.round(n * 1000) / 1000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** A generated page carries this mark, so nothing mistakes it for a saved sheet. */
export const RECEIPT_ONLY = '__receiptOnly';

/**
 * The shop-month's day sheets plus a generated page for every date with
 * register receipts and no sheet. Returns a NEW entryStore (for the DSS
 * engine) — the stores passed in are not touched.
 */
export function withReceiptOnlyDays(
  entryStore: Record<string, unknown> | undefined,
  inspectionStore: Record<string, unknown> | undefined,
  receiptStore: ReceiptRow[] | undefined,
  crsId: number,
  month: number,
  year: number,
): Record<string, unknown> {
  const entries = isObj(entryStore) ? entryStore : {};
  const out: Record<string, unknown> = { ...entries };
  const prefix = `${crsId}_${year}-${pad2(month)}-`;
  // A month keyed on Monthly Entry already states its receipts in the projection.
  if (Object.entries(entries).some(([k, v]) => k.startsWith(prefix) && isObj(v) && v.__projection)) return out;

  const days = new Date(year, month, 0).getDate();
  let ix: ReturnType<typeof buildChainIndex> | null = null;
  for (let d = 1; d <= days; d++) {
    const ds = `${year}-${pad2(month)}-${pad2(d)}`;
    const key = `${crsId}_${ds}`;
    if (entries[key]) continue;
    const register = receiptQtyForDay(receiptStore, crsId, ds);
    if (!Object.keys(register).length) continue;

    ix ??= buildChainIndex(entries as Record<string, DayEntry>, inspectionStore, receiptStore, crsId);
    // The commodities the shop carries: those on its sheets so far, plus what arrived.
    const ids = new Map<string, 'a' | 'b'>();
    for (const sd of ix.sheetDates) {
      if (sd >= ds) continue;
      const sh = ix.sheets[sd] as unknown as Loose;
      for (const sec of ['a', 'b'] as const) for (const id of Object.keys(isObj(sh?.[sec]) ? (sh[sec] as Loose) : {})) ids.set(`${sec}:${id}`, sec);
    }
    if (!ids.size) continue; // before the shop's first sheet: no Opening to carry in
    for (const id of Object.keys(register)) if (!ids.has(`a:${id}`) && !ids.has(`b:${id}`)) ids.set(`a:${id}`, 'a');

    const page: Loose = { a: {}, b: {}, [RECEIPT_ONLY]: true };
    for (const [k, sec] of ids) {
      const id = k.slice(2);
      const open = kg(openingFor(ix, ds, id, sec).value ?? 0);
      const receipt = kg(register[id] ?? 0);
      const total = kg(open + receipt);
      (page[sec] as Loose)[id] = { open, receipt, total, sales: 0, close: total, amount: 0 };
    }
    out[key] = page;
  }
  return out;
}

/** How many DSS pages this shop-month has — the days the DSS fee is charged for. */
export function dssDayCount(
  entryStore: Record<string, unknown> | undefined,
  inspectionStore: Record<string, unknown> | undefined,
  receiptStore: ReceiptRow[] | undefined,
  crsId: number,
  month: number,
  year: number,
): number {
  const prefix = `${crsId}_${year}-${pad2(month)}-`;
  return Object.keys(withReceiptOnlyDays(entryStore, inspectionStore, receiptStore, crsId, month, year)).filter((k) => k.startsWith(prefix)).length;
}
