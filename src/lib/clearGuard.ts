/**
 * What counts as destroying saved data, and who is allowed to do it.
 *
 * This is the rule the server applies to every /api/state write. It lives in
 * its own module, with no database or Next.js imports, so it can be tested
 * directly (tools/verify-clear-guard.mjs).
 *
 * WHY IT IS SERVER-SIDE. The Clear buttons on the screens only reset React
 * state — they never wrote to the database. The ways saved figures actually
 * disappear are: clearing the form and pressing Save (the emptied sheet
 * overwrites the stored one), deleting a receipt, or simply POSTing a store to
 * /api/state with a key removed. That last one is available to anyone with a
 * session and devtools, which is why a confirmation dialog in the browser
 * cannot be the protection. The dialog is the manners; this is the lock.
 *
 * TWO RULES, both enforced on the diff between what is stored and what is
 * being written, so an unchanged copy of somebody else's data passes freely
 * (every client holds all shops' stores and posts them back whole):
 *
 *   1. A non-admin may only change records belonging to their own shop.
 *   2. Destroying a record — removing its key, or blanking every figure in it
 *      — needs an approved clear request covering it. Editing figures does
 *      not; correcting 100 to 90 is a correction, and 100 to 0 on its own is
 *      still a correction. Only wiping the whole record is a clear.
 *
 * ADMINS BYPASS BOTH. The point is a reviewed trail for shop staff, not a
 * padlock on the office.
 */

/** Stores whose records are shop data. Masters and counters are not here. */
export const PROTECTED_STORES = [
  'entryStore',
  'inspectionStore',
  'monthlyStore',
  'meManualStore',
  'meSourceStore',
  'meRemitStore',
  'meGunnyStore',
  'meCardStore',
  'meAllotStore',
  'meAdvanceStore',
  'meCardConfirmed',
  'salesCloseStore',
  'receiptStore',
] as const;
export type ProtectedStore = (typeof PROTECTED_STORES)[number];

const PROTECTED = new Set<string>(PROTECTED_STORES);
export const isProtectedStore = (k: string): k is ProtectedStore => PROTECTED.has(k);

/** Human labels for the modules named in the security rule. */
export const STORE_LABEL: Record<string, string> = {
  entryStore: 'Daily Sales',
  inspectionStore: 'Inspection',
  monthlyStore: 'Monthly Entry',
  meManualStore: 'Monthly Entry',
  meSourceStore: 'Monthly Entry',
  meRemitStore: 'Remittance',
  meGunnyStore: 'Gunny',
  meCardStore: 'Card Details',
  meAllotStore: 'Allotment',
  meAdvanceStore: 'Allotment',
  meCardConfirmed: 'Card Details',
  salesCloseStore: 'Sales Close',
  receiptStore: 'Receipt',
};

export type ChangeKind = 'removed' | 'emptied';
export type DestructiveChange = {
  store: string;
  /** Store key, or the receipt id for receiptStore. */
  key: string;
  crsId: number | null;
  /** '2026-12-05' for a day, '12_2026' for a month, the receipt's date otherwise. */
  period: string;
  kind: ChangeKind;
  label: string;
};
export type ScopeViolation = { store: string; key: string; crsId: number | null };

export type GuardVerdict = {
  destructive: DestructiveChange[];
  /** Records outside the user's own shop that this write would change. */
  foreign: ScopeViolation[];
};

/** A grant already approved: everything it covers may be destroyed once. */
export type ClearGrant = {
  id: number;
  crsId: number;
  /** Store keys this grant covers, exactly as they appear in the stores. */
  keys: string[];
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Marker keys that are bookkeeping rather than figures. `__projection` marks a
 * sheet Monthly Entry generated from its own manual values; the month-close
 * writes and removes those by design (see monthProjection.ts), so they must
 * not need anybody's approval.
 */
const MARKER_KEYS = new Set(['__projection', 'updatedAt', 'createdAt', 'id', 'crsId', 'itemName', 'month', 'year']);

/**
 * A record the app generated rather than a clerk keyed.
 *
 * Two shapes carry the marker. A projected DAY SHEET holds it at the top
 * level. Projected INSPECTION adjustments hold it per commodity, because a day
 * can mix them with real ones — so an inspection day counts as generated only
 * when every entry carrying a figure is marked. That distinction matters: the
 * month-close removes its own adjustments when a real day sheet takes over
 * (dropProjectedAdjustments), and if that removal needed an administrator the
 * two-mode switch would stall for every shop user.
 */
export const isSystemRecord = (rec: unknown): boolean => {
  if (!isObj(rec)) return false;
  if (rec.__projection) return true;

  let sawMarked = false;
  for (const sec of ['a', 'b']) {
    const blk = rec[sec];
    if (!isObj(blk)) continue;
    for (const entry of Object.values(blk)) {
      if (!isObj(entry) || !hasData(entry)) continue;
      if (!entry.__projection) return false; // a real adjustment lives here
      sawMarked = true;
    }
  }
  return sawMarked;
};

/**
 * Does this record carry any figure a clerk would recognise as data? A day
 * sheet writes a row for every commodity, so an all-zero sheet is empty.
 */
export function hasData(v: unknown, depth = 0): boolean {
  if (v === null || v === undefined || depth > 6) return false;
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (typeof v === 'string') return v.trim() !== '' && v.trim() !== '0';
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.some((x) => hasData(x, depth + 1));
  if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (MARKER_KEYS.has(k)) continue;
      if (hasData(x, depth + 1)) return true;
    }
  }
  return false;
}

/**
 * The shop a store key belongs to. Keys are `<crsId>_<date>` for day stores
 * and `<crsId>_<month>_<year>` for month stores; both start with the id.
 */
export function crsOfKey(key: string): number | null {
  const m = /^(\d+)_/.exec(key);
  return m ? Number(m[1]) : null;
}

/** The period half of a store key, for showing an admin what is being cleared. */
export function periodOfKey(key: string): string {
  const i = key.indexOf('_');
  return i === -1 ? key : key.slice(i + 1);
}

type ReceiptRow = { id?: unknown; crsId?: unknown; date?: unknown; items?: unknown };

/** Receipts are an array, so they are diffed by row id rather than by key. */
function receiptRows(v: unknown): Map<string, ReceiptRow> {
  const out = new Map<string, ReceiptRow>();
  if (!Array.isArray(v)) return out;
  for (const r of v) {
    if (!isObj(r)) continue;
    const id = r.id === undefined || r.id === null ? '' : String(r.id);
    if (id) out.set(id, r as ReceiptRow);
  }
  return out;
}

/**
 * Compare what is stored against what is being written, for ONE store.
 * Returns the destroyed records and the ones outside `ownCrsId`.
 *
 * `ownCrsId` null means an admin — scope is not checked, and nothing is
 * reported as foreign.
 */
export function diffStore(store: string, before: unknown, after: unknown, ownCrsId: number | null): GuardVerdict {
  const destructive: DestructiveChange[] = [];
  const foreign: ScopeViolation[] = [];
  const label = STORE_LABEL[store] ?? store;

  const note = (key: string, crsId: number | null, period: string, kind: ChangeKind) =>
    destructive.push({ store, key, crsId, period, kind, label });
  const changed = (key: string, crsId: number | null) => {
    if (ownCrsId !== null && crsId !== null && crsId !== ownCrsId) foreign.push({ store, key, crsId });
  };

  if (store === 'receiptStore') {
    const b = receiptRows(before);
    const a = receiptRows(after);
    for (const [id, row] of b) {
      const crsId = Number(row.crsId) || null;
      const period = String(row.date ?? '');
      const next = a.get(id);
      if (!next) {
        changed(id, crsId);
        note(id, crsId, period, 'removed');
        continue;
      }
      if (JSON.stringify(row) !== JSON.stringify(next)) changed(id, crsId);
      // A receipt with every commodity taken off it is a deleted receipt in
      // all but name.
      if (hasData(row.items) && !hasData(next.items)) note(id, crsId, period, 'emptied');
    }
    for (const [id, row] of a) {
      if (!b.has(id)) changed(id, Number(row.crsId) || null);
    }
    return { destructive, foreign };
  }

  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};

  for (const [key, rec] of Object.entries(b)) {
    const crsId = crsOfKey(key);
    const period = periodOfKey(key);
    const has = Object.prototype.hasOwnProperty.call(a, key);
    const next = a[key];

    if (!has) {
      // A generated sheet is the month's own output, not keyed data — the
      // month-close removes it whenever a real day sheet takes over.
      if (isSystemRecord(rec)) continue;
      changed(key, crsId);
      if (hasData(rec)) note(key, crsId, period, 'removed');
      continue;
    }

    if (JSON.stringify(rec) === JSON.stringify(next)) continue;
    changed(key, crsId);
    if (isSystemRecord(rec) && !isSystemRecord(next)) continue; // projection → real sheet
    if (hasData(rec) && !hasData(next)) note(key, crsId, period, 'emptied');
  }

  for (const key of Object.keys(a)) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) changed(key, crsOfKey(key));
  }

  return { destructive, foreign };
}

/** Run diffStore over every protected store in one payload. */
export function inspectWrite(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
  ownCrsId: number | null,
): GuardVerdict {
  const destructive: DestructiveChange[] = [];
  const foreign: ScopeViolation[] = [];
  for (const [store, value] of Object.entries(incoming)) {
    if (!isProtectedStore(store)) continue;
    const v = diffStore(store, stored[store], value, ownCrsId);
    destructive.push(...v.destructive);
    foreign.push(...v.foreign);
  }
  return { destructive, foreign };
}

/**
 * Which destructive changes no approved grant covers. A grant matches by shop
 * and store key (the receipt id for receiptStore), so approving "clear
 * 5 Dec 2026" does not also authorise clearing a different day.
 */
export function unapproved(changes: DestructiveChange[], grants: ClearGrant[]): DestructiveChange[] {
  const covered = new Set<string>();
  for (const g of grants) for (const k of g.keys) covered.add(`${g.crsId}:${k}`);
  return changes.filter((c) => !covered.has(`${c.crsId}:${c.key}`));
}

/** The grants a set of changes actually used, so they can be marked spent. */
export function grantsUsed(changes: DestructiveChange[], grants: ClearGrant[]): number[] {
  const used = new Set<number>();
  for (const g of grants) {
    for (const c of changes) {
      if (c.crsId === g.crsId && g.keys.includes(c.key)) {
        used.add(g.id);
        break;
      }
    }
  }
  return [...used];
}

/** One line per destroyed record, for an error message or an audit row. */
export function describe(changes: DestructiveChange[]): string {
  return changes
    .map((c) => `${c.label} — CRS ${c.crsId ?? '?'} ${c.period}${c.kind === 'emptied' ? ' (all figures blanked)' : ''}`)
    .join('; ');
}
