/**
 * The Opening → Closing chain, rebuilt in DATE order and written back.
 *
 * A saved day sheet stores its own Opening, Total and Closing, fixed when it
 * was keyed. That is right only while days are keyed in calendar order. Key the
 * 16th first — nothing earlier exists, so its Opening is typed by hand — then
 * key the real first day, the 2nd, and the 16th still holds the figure typed on
 * it: the chain runs 2nd → 15th and then jumps to a number from nowhere.
 * Re-keying an earlier day's sales, adding a receipt or an inspection on an
 * earlier date, or an approved clear of an earlier day breaks it the same way.
 *
 * THE RULE. Only the start of the chain — a day with no earlier balance to
 * carry from — keeps a typed Opening. Every other day opens with the carried
 * balance (stockChain.ts): the previous applicable day's CALCULATED Closing,
 * plus godown receipts and inspection on the sheet-less days in between. A
 * missing date is stepped over, never read as zero.
 *
 * So after any change that moves a balance, this walks the shop's sheets from
 * that date forward, in date order, and brings every derived figure on each
 * row into line with what the chain says the day is:
 *
 *   Opening   the carried balance (unless it is the start of the chain, or fixed)
 *   Receipt   the Receipt Register's figure, where the register has one that day
 *   Excess / Shortage / Transfer   that date's inspection, as a re-save takes it
 *   Total     Opening + Receipt ± adjustments
 *   Closing   Total − Sales
 *
 * Sales — and everything else the clerk keyed, remittance included — is never
 * touched. The next day then carries from this Closing, across a month end
 * too, because the chain does.
 *
 * Projected sheets are never rewritten: they state a whole month keyed on
 * Monthly Entry (monthProjection.ts). They still serve as the carry source for
 * the days after them.
 */
import type { Commodity, DayEntry } from '@/lib/engine/commodities';
import type { ReceiptRow } from '@/lib/engine/receiptRollup';
import { isProjectedSheet } from '@/lib/engine/monthProjection';
import { resyncReceiptMonth, type ReceiptSyncResult, type ReceiptSyncStores } from '@/lib/engine/receiptSync';
import { buildChainIndex, isOpenFixed, openingFor } from '@/lib/engine/stockChain';
import { TOLERANCE } from '@/lib/stockGuard';

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
        const godown = ix.receipts[ds]?.[id] ?? 0;

        // A fixed Opening (an administrator's correction, or a shop's Initial
        // Opening Balance) is an anchor: it stays, and the days after carry from it.
        const open = carry === null || isOpenFixed(row) ? num(row.open) : kg(carry);
        const receipt = godown > 0 ? godown : num(row.receipt);
        const excess = num(a.excess);
        const shortage = num(a.shortage);
        const transfer = num(a.transfer);
        const total = kg(open + receipt + excess - shortage - transfer);
        const close = kg(total - num(row.sales) - num(row.cs));

        const same =
          near(num(row.open), open) && near(num(row.receipt), receipt) &&
          near(num(row.excess), excess) && near(num(row.shortage), shortage) && near(num(row.transfer), transfer) &&
          near(num(row.total), total) && near(num(row.close), close);
        if (same) continue;

        const fixed: Loose = { ...row, open, receipt, total, close };
        // Adjustment fields are written only where the sheet already carries
        // them or the inspection has one, so an old sheet does not grow zeros.
        for (const [f, v] of [['excess', excess], ['shortage', shortage], ['transfer', transfer]] as const) {
          if (f in row || v) fixed[f] = v;
        }
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
      ix.sheets[ds] = copy;
      dates.push(ds);
    }
  }
  return { entryStore: next, dates };
}

/**
 * Rebuild the chain from `fromDate` and republish every month it moved, so
 * Monthly Entry, the Dashboard's closing stock, the DSS and the statements all
 * read the rebuilt figures. The browser's save paths, the approved-clear path
 * and tools/repair-stock-chain.mjs share this, and so leave identical data.
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
