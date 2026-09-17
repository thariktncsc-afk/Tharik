/**
 * Has a shop started its stock chain? The one-time Initial Opening Balance.
 *
 * A shop's staff type an Opening Balance exactly ONCE: the first time the shop
 * ever saves stock. From then on every Opening is the previous Closing
 * (stockChain.ts), and only an administrator can correct one.
 *
 * "Started" is a PERSISTENT FACT, not something worked out from today's data:
 *
 *   - not from the date, the month, or whether today has a sheet;
 *   - not from whether the shop is active — `__shops.active` and
 *     `__crsMaster.status` are never read here, so Active → Inactive → Active
 *     cannot hand a shop a second Initial Opening;
 *   - not from whether sheets still exist — an approved clear removing every
 *     sheet leaves the shop started.
 *
 * It lives in crs_state under `__stockInit`, one entry per shop:
 *
 *     { "7": { "date": "2026-09-01", "at": "…", "by": "crs7", "source": "save" } }
 *
 * `__stockInit` is NOT in /api/state's writable keys: no browser can write or
 * reset it. The server adds an entry when a day sheet for a shop without one
 * lands (stockInitServer.ts); `tools/seed-stock-init.mjs` recorded the shops
 * that had already started before this existed. Entries are only ever added.
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
  source: 'save' | 'seed';
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

/**
 * The shops a write STARTS: a day sheet for them was added or changed by this
 * write, and they have no entry yet. Each with the earliest sheet date it now
 * holds. Only changed sheets count — the whole entryStore travels with every
 * save, and another shop's untouched sheet must not start that shop.
 */
export function shopsStartedBy(
  init: StockInit,
  storedEntry: unknown,
  landedEntry: unknown,
): { crsId: number; date: string }[] {
  if (!isObj(landedEntry)) return [];
  const before = isObj(storedEntry) ? storedEntry : {};
  const touched = new Set<number>();
  for (const [key, sheet] of Object.entries(landedEntry)) {
    const m = DAY_KEY.exec(key);
    if (!m) continue;
    if (key in before && JSON.stringify(before[key]) === JSON.stringify(sheet)) continue;
    const crsId = Number(m[1]);
    if (!isInitialized(init, crsId)) touched.add(crsId);
  }
  const out: { crsId: number; date: string }[] = [];
  for (const crsId of touched) {
    const dates = Object.keys(landedEntry)
      .map((k) => DAY_KEY.exec(k))
      .filter((m): m is RegExpExecArray => !!m && Number(m[1]) === crsId)
      .map((m) => m[2])
      .sort();
    if (dates.length) out.push({ crsId, date: dates[0] });
  }
  return out;
}

/** The same record with these shops added. Existing entries are never changed. */
export function withStarted(init: StockInit, started: { crsId: number; date: string }[], by: string, source: StockInitEntry['source'], at: string): StockInit {
  const next: StockInit = { ...init };
  for (const s of started) {
    if (isInitialized(next, s.crsId)) continue;
    next[String(s.crsId)] = { date: s.date, at, by, source };
  }
  return next;
}
