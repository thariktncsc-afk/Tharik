/**
 * "Who did what, and when" — derived from the audit trail, not a second log.
 *
 * WHY DERIVED. `crs_state_audit` already records every write to `crs_state`
 * (migration 0001's trigger), with the username, the store and the timestamp.
 * A separate activity table would have to be written by every save path, and
 * the one path someone forgets is invisible forever. This reads the trail the
 * database keeps whether the app remembers to or not, so it cannot be bypassed
 * and it works for writes made before this feature existed.
 *
 * WHICH SHOP. The audit row holds the whole store, not the change, so the shop
 * comes from diffing a version against the one before it: the top-level keys
 * that differ are `<crsId>_<date>` or `<crsId>_<month>_<year>`, and the shop
 * falls out of the key. A row whose predecessor is outside the window still
 * reports the module and the user — better a slightly vaguer line than a
 * dropped one.
 *
 * SCOPING IS THE CALLER'S JOB and must happen on the server: a shop user is
 * shown only entries touching its own shop. See /api/activity.
 */
import { STORE_LABEL } from '@/lib/clearGuard';

export type AuditRow = {
  id: number;
  store_key: string;
  version: number;
  updated_at: string;
  updated_by: string | null;
  data: unknown;
};

export type ActivityItem = {
  id: number;
  at: string;
  /** Username from the audit row, or a job name like `import:xlsx`. */
  actor: string;
  /** "Daily Sales", "Receipt", … */
  module: string;
  store: string;
  /** Shops this write touched. Empty when it could not be attributed. */
  crsIds: number[];
  /** Periods touched — '2026-10-05' or '9_2026', at most a few. */
  periods: string[];
  /** added / updated / removed counts, for the wording. */
  added: number;
  updated: number;
  removed: number;
};

/** Stores worth showing. Masters and derived stores are noise on this panel. */
const INTERESTING = new Set([
  'entryStore', 'inspectionStore', 'monthlyStore', 'meManualStore',
  'meRemitStore', 'meGunnyStore', 'meCardStore', 'meAllotStore',
  'meAdvanceStore', 'meCardConfirmed', 'salesCloseStore', 'receiptStore',
]);

/**
 * `meSourceStore` and `monthlyStore` are republished by the roll-up on every
 * save, so they would double every entry. `monthlyStore` is kept because a
 * month-close can change it alone; `meSourceStore` never carries figures.
 */
const SKIP = new Set(['meSourceStore']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const crsOf = (key: string): number | null => {
  const m = /^(\d+)_/.exec(key);
  return m ? Number(m[1]) : null;
};
const periodOf = (key: string) => {
  const i = key.indexOf('_');
  return i === -1 ? key : key.slice(i + 1);
};

/** Receipts are an array keyed by row id; everything else is an object map. */
function keysOf(data: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (Array.isArray(data)) {
    for (const r of data) {
      if (!isObj(r)) continue;
      const id = String(r.id ?? '');
      if (id) out.set(id, JSON.stringify(r));
    }
    return out;
  }
  if (isObj(data)) for (const [k, v] of Object.entries(data)) out.set(k, JSON.stringify(v));
  return out;
}

/** Shop + period for a receipt row, which is not encoded in its id. */
function receiptShop(data: unknown, id: string): { crsId: number | null; period: string } {
  if (!Array.isArray(data)) return { crsId: null, period: '' };
  const row = data.find((r) => isObj(r) && String(r.id ?? '') === id);
  if (!isObj(row)) return { crsId: null, period: '' };
  return { crsId: Number(row.crsId) || null, period: String(row.date ?? '') };
}

/**
 * Turn audit rows into activity, newest first.
 *
 * `rows` may be in any order; the caller normally passes a recent window.
 */
export function deriveActivity(rows: AuditRow[]): ActivityItem[] {
  const byStore = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (!INTERESTING.has(r.store_key) || SKIP.has(r.store_key)) continue;
    byStore.set(r.store_key, [...(byStore.get(r.store_key) ?? []), r]);
  }

  const items: ActivityItem[] = [];
  for (const [store, list] of byStore) {
    list.sort((a, b) => a.version - b.version);
    for (let i = 0; i < list.length; i++) {
      const cur = list[i];
      const prev = i > 0 ? list[i - 1] : null;
      // Without the version before it there is no way to say what this write
      // changed, so it is dropped rather than shown as a line with no shop and
      // no counts. Version 1 is the exception: nothing preceded it, so
      // everything in it is genuinely new.
      if (!prev && cur.version !== 1) continue;
      const now = keysOf(cur.data);
      const was = prev ? keysOf(prev.data) : new Map<string, string>();

      const changed: string[] = [];
      let added = 0;
      let updated = 0;
      let removed = 0;

      for (const [k, v] of now) {
        const before = was.get(k);
        if (before === undefined) {
          added++;
          changed.push(k);
        } else if (before !== v) {
          updated++;
          changed.push(k);
        }
      }
      for (const k of was.keys()) {
        if (!now.has(k)) {
          removed++;
          changed.push(k);
        }
      }
      // Nothing actually moved — a re-save of identical content.
      if (!changed.length) continue;

      const crsIds = new Set<number>();
      const periods = new Set<string>();
      for (const k of changed) {
        if (store === 'receiptStore') {
          const r = receiptShop(cur.data, k) ;
          const p = r.crsId ? r : receiptShop(prev?.data, k);
          if (p.crsId) crsIds.add(p.crsId);
          if (p.period) periods.add(p.period);
          continue;
        }
        const c = crsOf(k);
        if (c) crsIds.add(c);
        periods.add(periodOf(k));
      }

      items.push({
        id: cur.id,
        at: cur.updated_at,
        actor: cur.updated_by || 'unknown',
        module: STORE_LABEL[store] ?? store,
        store,
        crsIds: [...crsIds].sort((a, b) => a - b),
        periods: [...periods].slice(0, 4),
        added,
        updated,
        removed,
      });
    }
  }

  return items.sort((a, b) => b.id - a.id);
}

/** Only what this viewer may see. `crsId` null means an administrator. */
export function scopeToShop(items: ActivityItem[], crsId: number | null): ActivityItem[] {
  if (crsId === null) return items;
  // An entry that could not be attributed to any shop is withheld rather than
  // shown to everyone — it may describe another shop's data.
  return items.filter((i) => i.crsIds.includes(crsId)).map((i) => ({ ...i, crsIds: [crsId] }));
}

/** One readable line: "Daily Sales · CRS 1 · 05-10-2026". */
export function describeActivity(i: ActivityItem): string {
  const parts = [i.module];
  if (i.crsIds.length === 1) parts.push(`CRS ${i.crsIds[0]}`);
  else if (i.crsIds.length > 1) parts.push(`${i.crsIds.length} shops`);
  const p = i.periods[0];
  if (p) parts.push(/^\d{4}-\d{2}-\d{2}$/.test(p) ? p.split('-').reverse().join('-') : p.replace('_', '/'));
  const verb = i.removed && !i.added && !i.updated ? 'removed' : i.added && !i.updated ? 'added' : 'updated';
  return `${parts.join(' · ')} — ${verb}`;
}
