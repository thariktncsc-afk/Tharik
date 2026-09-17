/**
 * The Opening → Closing chain, rebuilt in DATE order.
 *
 * A saved day sheet stores its own Opening, fixed when it was keyed. That is
 * right only while days are keyed in calendar order. Key the 16th first —
 * nothing earlier exists, so its Opening is typed by hand — then key the real
 * first day, the 2nd, and the 16th still opens with the figure typed on it: the
 * chain runs 2nd → 15th and then jumps to a number from nowhere. Re-keying an
 * earlier day's sales, adding a receipt or an inspection on an earlier date, or
 * an approved clear of an earlier day breaks it the same way.
 *
 * THE RULE. Only the start of the chain — a day with no earlier balance to
 * carry from — keeps a typed Opening. Every other day opens with the carried
 * balance (stockChain.ts): the latest earlier sheet's Closing, plus godown
 * receipts and inspection on the sheet-less days in between. A missing date is
 * stepped over, never read as zero.
 *
 * So after any change that moves a balance, this walks the shop's sheets from
 * that date forward, in date order, and re-carries each commodity. A rewritten
 * row also takes its own date's inspection adjustments, exactly as re-saving it
 * would, and its Total and Closing follow by the stock guard's arithmetic
 * (open + receipt ± adjustments = total, total − sales = close). The next day
 * then re-carries from the new Closing — across a month end too, because the
 * chain does.
 *
 * Projected sheets are never rewritten: they state a whole month keyed on
 * Monthly Entry (monthProjection.ts). They still serve as the carry source for
 * the days after them.
 */
import type { Commodity, DayEntry } from '@/lib/engine/commodities';
import type { ReceiptRow } from '@/lib/engine/receiptRollup';
import { isProjectedSheet } from '@/lib/engine/monthProjection';
import { resyncReceiptMonth, type ReceiptSyncResult, type ReceiptSyncStores } from '@/lib/engine/receiptSync';
import { buildChainIndex, openingFor } from '@/lib/engine/stockChain';
import { TOLERANCE, expectedClose, expectedTotal } from '@/lib/stockGuard';

export type ChainStores = { entryStore: unknown; inspectionStore: unknown; receiptStore: unknown };
export type Rechained = {
  /** The whole entryStore with the rebuilt sheets written in. */
  entryStore: Record<string, DayEntry>;
  /** ISO dates of the sheets that changed, earliest first. */
  dates: string[];
};

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;
/** Kilos carry three decimals; anything finer is float noise from the sums. */
const kg = (n: number) => Math.round(n * 1000) / 1000;

/** Rebuild one shop's chain for every sheet dated `fromDate` or later. */
export function rebuildChain(stores: ChainStores, crsId: number, fromDate: string): Rechained {
  const next: Record<string, DayEntry> = { ...(isObj(stores.entryStore) ? (stores.entryStore as Record<string, DayEntry>) : {}) };
  const insp: Loose = isObj(stores.inspectionStore) ? stores.inspectionStore : {};
  const ix = buildChainIndex(next, insp, Array.isArray(stores.receiptStore) ? (stores.receiptStore as ReceiptRow[]) : [], crsId);

  const dates: string[] = [];
  for (const ds of ix.sheetDates.filter((d) => d >= fromDate).sort()) {
    const sheet = ix.sheets[ds];
    if (!sheet || isProjectedSheet(sheet)) continue;
    const dayInsp = isObj(insp[`${crsId}_${ds}`]) ? (insp[`${crsId}_${ds}`] as Loose) : {};

    let copy: DayEntry | null = null;
    for (const sec of ['a', 'b'] as const) {
      const secInsp = isObj(dayInsp[sec]) ? (dayInsp[sec] as Loose) : {};
      for (const [id, raw] of Object.entries(sheet[sec] ?? {})) {
        const row = raw as unknown as Loose;
        const carry = openingFor(ix, ds, id, sec).value;
        const a = isObj(secInsp[id]) ? (secInsp[id] as Loose) : {};
        const adj = { excess: num(a.excess), shortage: num(a.shortage), transfer: num(a.transfer) };
        const reopen = carry !== null && !near(num(row.open), carry);
        const readjust = !near(num(row.excess), adj.excess) || !near(num(row.shortage), adj.shortage) || !near(num(row.transfer), adj.transfer);
        if (!reopen && !readjust) continue;

        const fixed: Loose = { ...row, ...(reopen ? { open: kg(carry!) } : {}), ...(readjust ? adj : {}) };
        fixed.total = kg(expectedTotal(fixed));
        fixed.close = kg(expectedClose(fixed));
        if (!copy) {
          copy = { ...sheet };
          if (sheet.a) copy.a = { ...sheet.a };
          if (sheet.b) copy.b = { ...sheet.b };
        }
        copy[sec]![id] = fixed as never;
      }
    }

    if (copy) {
      next[`${crsId}_${ds}`] = copy;
      // The index holds sheets by reference, so the next day re-carries from
      // this one's new Closing.
      ix.sheets[ds] = copy;
      dates.push(ds);
    }
  }
  return { entryStore: next, dates };
}

/**
 * Rebuild the chain from `fromDate` and republish every month it moved, so
 * Monthly Entry, the Dashboard's closing stock, the DSS and the statements all
 * read the rebuilt figures. The browser's save paths and the approved-clear
 * path share this, and so leave identical data.
 */
export function rechainAndRepublish(
  stores: ReceiptSyncStores,
  crsId: number,
  fromDate: string,
  lists?: { a: Commodity[]; b: Commodity[] },
): { patch: ReceiptSyncResult; dates: string[] } {
  const rebuilt = rebuildChain(stores, crsId, fromDate);
  if (!rebuilt.dates.length) return { patch: {}, dates: [] };

  const patch: ReceiptSyncResult = { entryStore: rebuilt.entryStore };
  let current: ReceiptSyncStores = { ...stores, entryStore: rebuilt.entryStore };
  for (const ym of new Set(rebuilt.dates.map((ds) => ds.slice(0, 7)))) {
    const [y, m] = ym.split('-').map(Number);
    const month = resyncReceiptMonth(current, crsId, m, y, lists ? { lists } : undefined);
    Object.assign(patch, month);
    current = { ...current, ...month } as ReceiptSyncStores;
  }
  return { patch, dates: rebuilt.dates };
}
