/**
 * Has a shop started its stock chain? The one-time Initial Opening Balance.
 *
 * A shop's staff type an Opening Balance exactly ONCE: the first time the shop
 * ever saves stock. From then on every Opening is the previous Closing
 * (stockChain.ts), and only an administrator can correct one.
 *
 * "Started" means THE SHOP HOLDS STOCK DATA, and its first day is the earliest
 * day sheet that does (`sheetHasStock`: any Opening, Receipt, Sales, Total,
 * Closing or adjustment figure, or a Monthly Entry month written out as its
 * last-day sheet). It is recorded, and RECALCULATED from what actually remains
 * whenever a shop's sheets change (`reconcileStockInit`):
 *
 *   - never from the date, the month, or whether today has a sheet;
 *   - never from whether the shop is active — `__shops.active` and
 *     `__crsMaster.status` are not read here, so Active → Inactive → Active
 *     changes nothing;
 *   - an approved clear that removes the shop's only stock data (a wrong
 *     Initial Opening keyed on the wrong date, say) makes it a new shop again:
 *     its record is removed and the Initial Opening can be keyed once more, on
 *     any date. Clear a later day and an earlier one still stands, so nothing
 *     changes. Clear the first day and a later one stands, and the first day
 *     moves to that later sheet.
 *
 * It lives in crs_state under `__stockInit`, one entry per shop:
 *
 *     { "7": { "date": "2026-09-01", "at": "…", "by": "crs7", "source": "save" } }
 *
 * `__stockInit` is NOT in /api/state's writable keys: no browser can write or
 * reset it. Only the server writes it (stockInitServer.ts), after a save lands
 * and after an approved clear; `tools/reconcile-stock-init.mjs` applies the
 * same rule to every shop at once.
 *
 * No database or framework imports, so tools can run it directly.
 */

export const STOCK_INIT_KEY = '__stockInit';

export type StockInitEntry = {
  /** The shop's first stock date — the day that carries its Initial Opening. */
  date: string;
  /** When it was recorded. */
  at: string;
  /** Who saved it (username), or the tool that recorded it. */
  by: string;
  source: 'save' | 'seed' | 'recalculated';
};

export type StockInit = Record<string, StockInitEntry>;

const DAY_KEY = /^(\d+)_(\d{4}-\d{2}-\d{2})$/;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function readStockInit(raw: unknown): StockInit {
  return isObj(raw) ? (raw as StockInit) : {};
}

export function isInitialized(init: StockInit, crsId: number | null | undefined): boolean {
  return !!crsId && isObj(init[String(crsId)]);
}

/** The shop's first stock date, or null before it has one. */
export function initialDate(init: StockInit, crsId: number | null | undefined): string | null {
  const e = crsId ? init[String(crsId)] : undefined;
  return isObj(e) && typeof e.date === 'string' ? e.date : null;
}

// ── Recalculated from what remains ──────────────────────────────────────────

const STOCK_FIELDS = ['open', 'receipt', 'sales', 'total', 'close', 'excess', 'shortage', 'transfer'];

/**
 * Does this day sheet hold stock data? A Monthly Entry month written out as its
 * last day does by definition; otherwise some commodity must carry a figure. A
 * sheet saved with every figure at zero (a form emptied and saved) holds none —
 * it does not use up a shop's Initial Opening, and does not keep one alive.
 */
export function sheetHasStock(sheet: unknown): boolean {
  if (!isObj(sheet)) return false;
  if (sheet.__projection) return true;
  for (const sec of ['a', 'b']) {
    const rows = sheet[sec];
    if (!isObj(rows)) continue;
    for (const row of Object.values(rows)) {
      if (!isObj(row)) continue;
      for (const f of STOCK_FIELDS) {
        const n = Number(row[f]);
        if (Number.isFinite(n) && n !== 0) return true;
      }
    }
  }
  return false;
}

/** Every shop with a day sheet that changed, appeared or disappeared between two entryStores. */
export function shopsTouchedBy(storedEntry: unknown, landedEntry: unknown): number[] {
  const before = isObj(storedEntry) ? storedEntry : {};
  const after = isObj(landedEntry) ? landedEntry : {};
  const out = new Set<number>();
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const m = DAY_KEY.exec(key);
    if (!m) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/** The first date of each shop's stock data, from a whole entryStore. */
export function firstStockDates(entryStore: unknown, shops?: number[]): Map<number, string> {
  const want = shops ? new Set(shops) : null;
  const out = new Map<number, string>();
  for (const [key, sheet] of Object.entries(isObj(entryStore) ? entryStore : {})) {
    const m = DAY_KEY.exec(key);
    if (!m) continue;
    const crsId = Number(m[1]);
    if (want && !want.has(crsId)) continue;
    if (!sheetHasStock(sheet)) continue;
    const first = out.get(crsId);
    if (!first || m[2] < first) out.set(crsId, m[2]);
  }
  return out;
}

export type StockInitChange = { crsId: number; from: string | null; to: string | null };

/**
 * Bring these shops' records into line with the stock data that remains:
 *
 *   no stock data left        → record removed (a new shop again)
 *   stock, no record          → recorded, from its first day
 *   stock, first day moved    → date moved (an earlier Initial Opening keyed
 *                               after a wrong later one was cleared, or the
 *                               first day itself cleared)
 *   stock, same first day     → untouched
 */
export function reconcileStockInit(
  init: StockInit,
  entryStore: unknown,
  shops: number[],
  by: string,
  at: string,
): { next: StockInit; changes: StockInitChange[] } {
  const firsts = firstStockDates(entryStore, shops);
  const next: StockInit = { ...init };
  const changes: StockInitChange[] = [];
  for (const crsId of shops) {
    const key = String(crsId);
    const had = isObj(next[key]) ? next[key] : null;
    const first = firsts.get(crsId) ?? null;
    if (!first) {
      if (had) {
        delete next[key];
        changes.push({ crsId, from: had.date, to: null });
      }
      continue;
    }
    if (!had) {
      next[key] = { date: first, at, by, source: 'save' };
      changes.push({ crsId, from: null, to: first });
    } else if (had.date !== first) {
      next[key] = { date: first, at, by, source: 'recalculated' };
      changes.push({ crsId, from: had.date, to: first });
    }
  }
  return { next, changes };
}
