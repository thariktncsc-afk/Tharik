/**
 * A commodity's BAG counts carry from month to month (office, 2026-10-01).
 *
 *   Opening bags + Receipt bags = Total bags
 *   Total bags − Sales bags (− C.S bags) = Closing bags
 *   last month's Closing bags = this month's Opening bags
 *
 * CRS 23: September's Opening bags were saved as 47 for BRA Rice (the kgs,
 * 2316.998 ÷ 50, give 46) and closed at 47 — and October opened at 46,
 * because every Opening bag count that nobody had typed was worked out again
 * from the kgs. The bag count is a stock figure of its own: it is carried,
 * never re-derived from the kgs.
 *
 * - **Opening** = last month's Closing bags, worked out month by month from
 *   the shop's first month (`carriedBagsFor`). An Opening typed for the month
 *   wins — a "from Daily" row's `dailyBags.g_open`, or a hand-keyed row saved
 *   with `g_openFixed` — so an administrator's correction stays.
 * - Only in the shop's FIRST month — where there is no earlier month to carry
 *   from — does the Opening fall back to what it always was: the typed or
 *   imported figure, else kgs ÷ pack size.
 * - **Receipt and Sales** bags are unchanged: typed, else the office's stored
 *   count, else kgs ÷ pack size (the Gunny Receipt adds the Sales bags up).
 * - Empty Card+Box / Polythene Bag (stocked in Gunny Stock Management) and
 *   the police rows with no bag boxes (`NO_GUNNY`) carry nothing.
 *
 * One rule for Monthly Sales (rowFor, and its save) and the statements
 * (`stmtBagCounts`, given each month's Opening by the server). Nothing is
 * cached: every call reads the stores as they are.
 */
import { rebuildMonthlyFromDaily, type DailyBagField, type ManualMonth, type MonthlyRec, type MonthlySource } from '@/lib/engine/monthlyRollup';
import { bagsOf, entryListsFor, type Commodity } from '@/lib/engine/commodities';
import { NO_GUNNY } from '@/app/(app)/monthly-entry/lib';

export type BagRow = { open: number; receipt: number; total: number; sales: number; close: number };
export type BagSec = 'a' | 'b';
export type CarriedBags = { a: Record<string, number>; b: Record<string, number> };

type Stores = {
  entryStore: Record<string, unknown>;
  inspectionStore: Record<string, unknown>;
  meManualStore: Record<string, unknown>;
  receiptStore: unknown[];
};

/** Does this commodity's bag count carry from month to month? */
export const carriesBags = (id: string) => !NO_GUNNY.has(id);

/** A month record's hand-keyed row may say its Opening bags were typed. */
export type BagFixed = { g_openFixed?: boolean };

/**
 * One row's bag counts, as Monthly Sales shows them before anything is typed
 * on screen. `kgs` are the row's own Opening / Receipt / Sales; `carried` is
 * last month's Closing bags (null in the shop's first month, or for a row
 * that carries nothing). `openDefault` is what the Opening falls back to when
 * nothing is typed — the save keeps a typed Opening only when it differs.
 */
export function bagRowFor(
  sec: BagSec,
  id: string,
  rec: Partial<MonthlyRec> | undefined,
  src: MonthlySource | undefined,
  manual: ManualMonth | undefined,
  kgs: { open: number; receipt: number; sales: number },
  carried: number | null,
): BagRow & { openDefault: number; openTyped: boolean } {
  const derived = src === 'daily';
  const typed = derived ? manual?.dailyBags?.[sec]?.[id] : undefined;
  const saved = (manual?.[sec] as Record<string, (Partial<MonthlyRec> & BagFixed) | undefined> | undefined)?.[id];
  const carry = carriesBags(id) ? carried : null;
  // Receipt / Sales — and the Opening in the shop's first month — as before.
  const legacy = (f: 'open' | 'receipt' | 'sales') => {
    const t = typed?.[`g_${f}` as DailyBagField];
    if (typeof t === 'number' && Number.isFinite(t)) return t;
    const auto = bagsOf(kgs[f], id);
    const stored = Number(rec?.[`g_${f}` as keyof MonthlyRec]) || 0;
    // A stored count that differs from kgs ÷ pack is the office's own figure;
    // on a 'receipt' row the Receipt's count describes the figure the
    // register just replaced, so it is re-derived.
    const stale = src === 'receipt' && f === 'receipt';
    return !derived && !stale && stored > 0 && stored !== auto ? stored : auto;
  };
  let open: number;
  let openTyped = false;
  if (carry === null) {
    open = legacy('open');
  } else if (derived) {
    const t = typed?.g_open;
    openTyped = typeof t === 'number' && Number.isFinite(t);
    open = openTyped ? (t as number) : carry;
  } else if (saved?.g_openFixed) {
    openTyped = true;
    open = Number(saved.g_open) || 0;
  } else {
    open = carry;
  }
  const receipt = legacy('receipt');
  const sales = legacy('sales');
  const cs = Number(rec?.g_cs) || 0;
  const total = open + receipt;
  return { open, receipt, total, sales, close: total - sales - cs, openDefault: carry ?? bagsOf(kgs.open, id), openTyped };
}

const ym = (y: number, m: number) => y * 12 + (m - 1);

/** The months, as y*12+(m−1), in which a shop holds anything at all. */
export function shopMonths(stores: Stores, crsId: number): number[] {
  const out = new Set<number>();
  for (const k of Object.keys(stores.entryStore ?? {})) {
    const m = k.match(/^(\d+)_(\d{4})-(\d{2})-\d{2}$/);
    if (m && Number(m[1]) === crsId) out.add(ym(Number(m[2]), Number(m[3])));
  }
  for (const k of [...Object.keys(stores.meManualStore ?? {}), ...Object.keys(stores.inspectionStore ?? {})]) {
    const m = k.match(/^(\d+)_(\d{1,2})_(\d{4})$/);
    if (m && Number(m[1]) === crsId) out.add(ym(Number(m[3]), Number(m[2])));
    const d = k.match(/^(\d+)_(\d{4})-(\d{2})-\d{2}$/);
    if (d && Number(d[1]) === crsId) out.add(ym(Number(d[2]), Number(d[3])));
  }
  for (const r of (stores.receiptStore ?? []) as { crsId?: unknown; date?: unknown }[]) {
    const d = String(r?.date ?? '').match(/^(\d{4})-(\d{2})/);
    if (d && Number(r.crsId) === crsId) out.add(ym(Number(d[1]), Number(d[2])));
  }
  return [...out].sort((a, b) => a - b);
}

/** One month's bag counts for every commodity, given last month's Closing bags. */
export function monthBags(
  stores: Stores,
  crsId: number,
  month: number,
  year: number,
  lists: { a: Commodity[]; b: Commodity[] },
  carried: CarriedBags | null,
): { a: Record<string, BagRow & { openDefault: number; openTyped: boolean }>; b: Record<string, BagRow & { openDefault: number; openTyped: boolean }> } {
  const key = `${crsId}_${month}_${year}`;
  const manual = (stores.meManualStore as Record<string, ManualMonth | undefined>)[key];
  const { merged, source } = rebuildMonthlyFromDaily(
    crsId, month, year,
    stores.entryStore as never, stores.inspectionStore as never,
    manual, lists, stores.receiptStore as never,
  );
  const out = { a: {} as Record<string, BagRow & { openDefault: number; openTyped: boolean }>, b: {} as Record<string, BagRow & { openDefault: number; openTyped: boolean }> };
  for (const sec of ['a', 'b'] as const) {
    for (const c of lists[sec]) {
      const rec = merged[sec][c.id] as Partial<MonthlyRec> | undefined;
      const kgs = { open: Number(rec?.open) || 0, receipt: Number(rec?.receipt) || 0, sales: Number(rec?.sales) || 0 };
      out[sec][c.id] = bagRowFor(sec, c.id, rec, source[sec][c.id], manual, kgs, carried ? carried[sec][c.id] ?? 0 : null);
    }
  }
  return out;
}

/**
 * Last month's Closing bags for every commodity — worked out month by month
 * from the shop's first month — or null when the month IS the shop's first
 * (nothing earlier to carry from). A month in between that holds nothing
 * passes its Opening straight through.
 */
export function carriedBagsFor(
  stores: Stores,
  crsId: number,
  month: number,
  year: number,
  lists: { a: Commodity[]; b: Commodity[] },
): CarriedBags | null {
  const target = ym(year, month);
  const months = shopMonths(stores, crsId);
  if (!months.length || months[0] >= target) return null;
  let carried: CarriedBags | null = null;
  for (let t = months[0]; t < target; t++) {
    const bags = monthBags(stores, crsId, (t % 12) + 1, Math.floor(t / 12), lists, carried);
    const next: CarriedBags = { a: {}, b: {} };
    for (const sec of ['a', 'b'] as const) for (const [id, r] of Object.entries(bags[sec])) next[sec][id] = r.close;
    carried = next;
  }
  return carried;
}

/**
 * For the statement engine (ctx.bagOpening → 45-bag-counts.js): a month's
 * Opening bags by key, section and commodity — or null where nothing carries
 * (the shop's first month, a row that carries nothing), so the builders' own
 * rule applies. Worked out once per month from the stores handed in, over the
 * compiled lists the server's month rebuild uses (the statements print no
 * added commodity). Never throws: a statement is not lost over this.
 */
export function bagOpeningLookup(
  stores: Stores,
  listsFor: (crsId: number) => { a: Commodity[]; b: Commodity[] } = entryListsFor,
): (key: string, sec: BagSec, id: string) => number | null {
  const cache = new Map<string, CarriedBags | null>();
  return (key, sec, id) => {
    if (!cache.has(key)) {
      let out: CarriedBags | null = null;
      try {
        const [cid, m, y] = key.split('_').map(Number);
        const lists = listsFor(cid);
        const carried = carriedBagsFor(stores, cid, m, y, lists);
        if (carried) {
          const bags = monthBags(stores, cid, m, y, lists, carried);
          out = { a: {}, b: {} };
          for (const s of ['a', 'b'] as const) for (const [cId, r] of Object.entries(bags[s])) if (carriesBags(cId)) out[s][cId] = r.open;
        }
      } catch {
        out = null;
      }
      cache.set(key, out);
    }
    const v = cache.get(key)?.[sec]?.[id];
    return typeof v === 'number' ? v : null;
  };
}
