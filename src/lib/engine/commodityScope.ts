/**
 * Which shops a commodity belongs to (office, 2026-10-01).
 *
 * A Commodity Master row is for ALL shops unless it says otherwise:
 *   { scope: 'shop', shopId: 14 }  → CRS 14 only.
 * One record, never a copy per shop. Rows written before this rule carry no
 * scope and stay All Shops, exactly as they were.
 *
 * Every list a shop sees is "the global commodities + the ones assigned to
 * it", in the master's Order — and the server holds the same line: a shop
 * user is never sent another shop's commodity (route GET), only an
 * administrator writes the master, and nobody keys figures into a commodity
 * that belongs to another shop (inspectScopeWrite).
 */

export type ScopedRow = { id: string; order: number; scope?: 'all' | 'shop'; shopId?: number | string | null };

/** The shop a row is restricted to, or null for All Shops. */
export function scopeShop(row: ScopedRow | undefined): number | null {
  if (!row || row.scope !== 'shop') return null;
  const n = Number(row.shopId);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Does `crsId` see this row? With no shop (an all-shops view), every row is
 * in view — those screens add every shop's stock up.
 */
export function inScope(row: ScopedRow, crsId: number | null | undefined): boolean {
  const only = scopeShop(row);
  if (only === null) return true;
  if (crsId === null || crsId === undefined) return true;
  return Number(crsId) === only;
}

/** The master as one shop may be sent it: its own and the global rows. */
export function masterForShop<T extends ScopedRow>(master: T[] | null | undefined, crsId: number | null | undefined): T[] {
  return (master ?? []).filter((r) => {
    const only = scopeShop(r);
    return only === null || (crsId !== null && crsId !== undefined && Number(crsId) === only);
  });
}

/**
 * Put `id` at Order `order`, moving as little as possible: if another row
 * already holds that number, the rows from it up to the first free number
 * move one step down; every other row keeps its number. Returns the list
 * (mutated in place, as a crsData.update draft) and the ids whose Order moved.
 */
export function placeAtOrder<T extends ScopedRow>(list: T[], id: string, order: number): { moved: string[] } {
  const target = list.find((r) => r.id === id);
  if (!target) return { moved: [] };
  const want = Math.max(1, Math.floor(order));
  const others = list.filter((r) => r.id !== id);
  const taken = new Set(others.map((r) => r.order));
  const moved: string[] = [];
  if (taken.has(want)) {
    // The run of consecutive numbers starting at `want`, held by other rows.
    let end = want;
    while (taken.has(end + 1)) end++;
    for (const r of others) if (r.order >= want && r.order <= end) { r.order += 1; moved.push(r.id); }
  }
  target.order = want;
  return { moved };
}

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const DAY_KEY = /^(\d+)_(\d{4}-\d{2}-\d{2})$/;
const MONTH_KEY = /^(\d+)_(\d{1,2})_(\d{4})$/;
const num = (v: unknown) => Number(v) || 0;

export type ScopeViolation = { store: string; key: string; crsId: number; commodity: string; owner: number };

/**
 * Figures keyed into a commodity that belongs to ANOTHER shop — refused for
 * everyone, administrators included: the commodity is not on that shop's
 * screens, so a figure there would print nowhere and add up nowhere.
 *
 * Only a keyed figure that MOVES is judged (Sales or Receipt on a day sheet;
 * Opening, Receipt or Sales on a hand-keyed month; a receipt line), so a
 * shop's figures saved before its commodity was re-scoped stay untouched and
 * a re-carry of the chain over them is not a keying.
 */
export function inspectScopeWrite(stored: Rec, incoming: Rec, master: ScopedRow[] | null | undefined): ScopeViolation[] {
  const owner = new Map<string, number>();
  for (const r of master ?? []) {
    const only = scopeShop(r);
    if (only !== null) owner.set(r.id, only);
  }
  if (!owner.size) return [];
  const out: ScopeViolation[] = [];
  const foreign = (crsId: number, id: string) => owner.has(id) && owner.get(id) !== crsId;

  const rowsOf = (store: 'entryStore' | 'meManualStore', fields: string[], keyRe: RegExp) => {
    const after = incoming[store];
    if (!isObj(after)) return;
    const before = isObj(stored[store]) ? (stored[store] as Rec) : {};
    for (const [key, rec] of Object.entries(after)) {
      const m = keyRe.exec(key);
      if (!m || !isObj(rec)) continue;
      const crsId = Number(m[1]);
      const prev = isObj(before[key]) ? (before[key] as Rec) : {};
      for (const sec of ['a', 'b']) {
        const blk = isObj(rec[sec]) ? (rec[sec] as Rec) : {};
        const pblk = isObj(prev[sec]) ? (prev[sec] as Rec) : {};
        for (const [id, row] of Object.entries(blk)) {
          if (!foreign(crsId, id) || !isObj(row)) continue;
          const was = isObj(pblk[id]) ? (pblk[id] as Rec) : {};
          if (fields.some((f) => num(row[f]) !== num(was[f]) && num(row[f]) !== 0)) out.push({ store, key, crsId, commodity: id, owner: owner.get(id)! });
        }
      }
    }
  };
  rowsOf('entryStore', ['sales', 'receipt'], DAY_KEY);
  rowsOf('meManualStore', ['open', 'receipt', 'sales'], MONTH_KEY);

  // Receipt Register: a line of another shop's commodity, new or changed.
  if (Array.isArray(incoming.receiptStore)) {
    const prev = new Map<string, Rec>();
    for (const r of (Array.isArray(stored.receiptStore) ? stored.receiptStore : []) as Rec[]) if (isObj(r)) prev.set(String(r.id), r);
    for (const r of incoming.receiptStore as Rec[]) {
      if (!isObj(r) || !isObj(r.items)) continue;
      const crsId = Number(r.crsId);
      const was = prev.get(String(r.id));
      const wasItems = was && isObj(was.items) ? (was.items as Rec) : {};
      for (const [id, it] of Object.entries(r.items as Rec)) {
        if (!foreign(crsId, id)) continue;
        const q = num(isObj(it) ? it.qty : it), pq = num(isObj(wasItems[id]) ? (wasItems[id] as Rec).qty : wasItems[id]);
        if (q !== 0 && q !== pq) out.push({ store: 'receiptStore', key: String(r.receiptNo ?? r.id), crsId, commodity: id, owner: owner.get(id)! });
      }
    }
  }
  return out;
}

export function describeScope(v: ScopeViolation[]): string {
  const first = v[0];
  if (!first) return '';
  return `${first.commodity} belongs to CRS ${first.owner} only — it cannot be entered for CRS ${first.crsId}` + (v.length > 1 ? ` (+${v.length - 1} more)` : '') + '.';
}

type ListRow = ScopedRow & { ta?: string; en?: string; unit?: string; rate?: number | string; free?: boolean; section?: string; active?: boolean; crs29Only?: boolean };
type ListItem = { id: string; ta: string; en: string; unit: string; rate: number; free: boolean };

/**
 * A shop's Daily / Monthly lists, server-side — the same rows and Order as
 * `commodityListsFor` (masters.ts, which is client-only) — but ONLY for a
 * shop that has a commodity of its own (scope 'shop'); null otherwise, so a
 * caller keeps its built-in lists and every other shop's output is exactly
 * as it was (office, 2026-10-07: CRS 10's OAP FRK reaches its statements).
 * CRS 29 keeps its own family: null.
 */
export function ownListsFor(master: ListRow[] | null | undefined, crsId: number): { a: ListItem[]; b: ListItem[] } | null {
  const rows = master ?? [];
  if (Number(crsId) === 29) return null;
  if (!rows.some((r) => scopeShop(r) === Number(crsId) && r.active !== false)) return null;
  const sec = (s: 'a' | 'b') =>
    rows
      .filter((r) => r.section === s && r.active !== false && !r.crs29Only && inScope(r, crsId))
      .sort((x, y) => x.order - y.order)
      .map((r) => ({ id: r.id, ta: r.ta ?? '', en: r.en ?? r.id, unit: r.unit ?? 'KG', rate: Number(r.rate) || 0, free: !!r.free }));
  return { a: sec('a'), b: sec('b') };
}
