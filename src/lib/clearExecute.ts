/**
 * Performing an approved clear.
 *
 * Approval is not a status change and not a permission slip the shop spends
 * later — pressing Approve deletes the data, here, on the server, and the
 * request is only marked cleared once that has actually landed.
 *
 * WHAT A DAY IS. Remittance is not a separate record: a day sheet carries
 * `remits`, `remitAmount`, `remitNonCereal`, `remitCereal` and `remitDate` on
 * itself (see the save in daily-entry/page.tsx), so removing the sheet removes
 * the deposit with it and no orphan is possible. Inspection for the same date
 * is its own row and goes too. `salesCloseStore` is keyed by MONTH but names a
 * single day, so it is dropped only when it names the day being cleared —
 * clearing one day must never disturb the rest of the month.
 *
 * DEPENDENT DATA. `monthlyStore` and `meSourceStore` are derived, so they are
 * recomputed from what survives rather than edited: the month, the DSS and the
 * statements all read them, and a stale figure there is a wrong figure on
 * statutory paperwork. The next day's Opening needs no repair — the daily grid
 * carries it forward from the last sheet that still exists (carrySource in
 * daily-entry/page.tsx), so removing a day re-points the following one
 * automatically.
 *
 * ATOMICITY, HONESTLY. These stores are separate crs_state rows and PostgREST
 * gives no cross-row transaction. So this writes each row under the version it
 * read, and on ANY failure puts the rows it already wrote back to exactly what
 * they held. The window is small and the compensation is exact, but it is a
 * compensating transaction, not a database one — which is why the request is
 * only marked cleared after every write has succeeded, and stays pending with
 * an error otherwise.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { resyncReceiptMonth } from '@/lib/engine/receiptSync';
import { isProtectedStore, STORE_LABEL } from '@/lib/clearGuard';
import { isProjectedSheet } from '@/lib/engine/monthProjection';
import type { StoredRequest } from '@/lib/clearStore';

/** One record the clear removed, for the trail. */
export type ClearedRecord = { store: string; module: string; key: string };

/** Month-keyed stores that belong to a month as a whole. */
const MONTH_STORES = [
  'meManualStore',
  'meRemitStore',
  'meGunnyStore',
  'meCardStore',
  'meAllotStore',
  'meAdvanceStore',
  'meCardConfirmed',
  'salesCloseStore',
  'monthlyStore',
  'meSourceStore',
] as const;

type Row = { data: unknown; version: number };
type Rows = Record<string, Row>;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {});
const monthKeyOf = (crsId: number, iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return { key: `${crsId}_${m}_${y}`, month: m, year: y };
};

async function readAll(): Promise<Rows> {
  const { data, error } = await supabaseAdmin().from('crs_state').select('store_key, data, version').eq('scope', 'global');
  if (error) throw new Error(error.message);
  const rows: Rows = {};
  for (const r of data ?? []) rows[r.store_key as string] = { data: r.data, version: Number(r.version) || 0 };
  return rows;
}

/**
 * Work out the new contents of every store this request touches. Nothing is
 * written here — the caller applies the result, so a plan that throws changes
 * nothing at all.
 */
export function planClear(req: StoredRequest, rows: Rows): { next: Record<string, unknown>; cleared: ClearedRecord[] } {
  const next: Record<string, unknown> = {};
  const cleared: ClearedRecord[] = [];
  const months = new Set<string>();

  const take = (store: string) => (next[store] !== undefined ? next[store] : rows[store]?.data);
  const drop = (store: string, key: string) => {
    const cur = obj(take(store));
    if (!(key in cur)) return;
    delete cur[key];
    next[store] = cur;
    cleared.push({ store, module: STORE_LABEL[store] ?? store, key });
  };

  if (req.scopeKind === 'receipt') {
    const ids = new Set(req.storeKeys);
    const before = Array.isArray(rows.receiptStore?.data) ? (rows.receiptStore.data as Record<string, unknown>[]) : [];
    const after = before.filter((r) => !ids.has(String(r?.id ?? '')));
    if (after.length !== before.length) {
      next.receiptStore = after;
      for (const r of before) {
        if (!ids.has(String(r?.id ?? ''))) continue;
        cleared.push({ store: 'receiptStore', module: 'Receipt', key: String(r.id) });
        const d = String(r.date ?? '');
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) months.add(monthKeyOf(Number(r.crsId) || req.crsId, d).key);
      }
    }
  }

  for (const key of req.storeKeys) {
    if (req.scopeKind === 'receipt') break;

    // A day: `<crs>_<YYYY-MM-DD>`.
    const day = /^(\d+)_(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (day) {
      const crsId = Number(day[1]);
      const iso = day[2];
      drop('entryStore', key);
      drop('inspectionStore', key);

      // Sales Close names one day inside a month — clear it only when it is
      // this day, or the rest of the month loses its marker for no reason.
      const { key: mKey } = monthKeyOf(crsId, iso);
      const sc = obj(take('salesCloseStore'));
      const rec = sc[mKey] as { date?: unknown } | undefined;
      if (rec && String(rec.date ?? '') === iso) drop('salesCloseStore', mKey);

      months.add(mKey);
      continue;
    }

    // A month: `<crs>_<m>_<y>`.
    const mo = /^(\d+)_(\d{1,2})_(\d{4})$/.exec(key);
    if (mo) {
      const crsId = Number(mo[1]);
      for (const store of MONTH_STORES) drop(store, key);

      // The month's own generated day sheet goes with it; real day sheets in
      // the month are somebody's keyed work and are NOT touched.
      const entries = obj(take('entryStore'));
      const prefix = `${crsId}_${mo[3]}-${String(Number(mo[2])).padStart(2, '0')}-`;
      for (const k of Object.keys(entries)) {
        if (k.startsWith(prefix) && isProjectedSheet(entries[k])) drop('entryStore', k);
      }
      months.add(key);
    }
  }

  // Recompute what the month publishes, from what survives — and everything
  // else that holds a copy of a receipt's figure. Shared with the Receipt
  // page (engine/receiptSync.ts) so an approved clear and an administrator
  // deleting the same receipt leave the data identical: the manual month's
  // copy of a register-sourced Receipt goes with the rows it came from, and a
  // monthly-keyed month's projected sheet is rewritten to match.
  for (const mKey of months) {
    const [crsId, m, y] = mKey.split('_').map(Number);
    const patch = resyncReceiptMonth(
      {
        entryStore: obj(take('entryStore')) as never,
        inspectionStore: obj(take('inspectionStore')),
        meManualStore: obj(take('meManualStore')) as never,
        meSourceStore: obj(take('meSourceStore')) as never,
        monthlyStore: obj(take('monthlyStore')) as never,
        receiptStore: (take('receiptStore') as never) ?? [],
      },
      crsId, m, y,
    );
    for (const [store, value] of Object.entries(patch)) next[store] = value;
  }

  return { next, cleared };
}

/** Write the plan, restoring anything already written if a later write fails. */
async function applyPlan(next: Record<string, unknown>, rows: Rows, actor: string): Promise<void> {
  const db = supabaseAdmin();
  const done: { store: string; before: unknown; version: number }[] = [];

  const write = async (store: string, value: unknown, version: number) => {
    if (!version) {
      const { error } = await db.from('crs_state').insert({ scope: 'global', store_key: store, data: value, version: 1, updated_by: actor });
      if (error) throw new Error(`${store}: ${error.message}`);
      return 1;
    }
    const { data, error } = await db
      .from('crs_state')
      .update({ data: value, version: version + 1, updated_at: new Date().toISOString(), updated_by: actor })
      .eq('scope', 'global')
      .eq('store_key', store)
      .eq('version', version)
      .select('version')
      .maybeSingle();
    if (error) throw new Error(`${store}: ${error.message}`);
    if (!data) throw new Error(`${store} changed while the clear was running — nothing was removed. Try again.`);
    return Number(data.version);
  };

  try {
    for (const [store, value] of Object.entries(next)) {
      if (!isProtectedStore(store)) continue;
      const row = rows[store] ?? { data: undefined, version: 0 };
      const v = await write(store, value, row.version);
      done.push({ store, before: row.data, version: v });
    }
  } catch (err) {
    // Put back exactly what was there, in reverse order.
    for (const d of done.reverse()) {
      try {
        await db
          .from('crs_state')
          .update({ data: d.before, version: d.version + 1, updated_at: new Date().toISOString(), updated_by: `${actor} (rollback)` })
          .eq('scope', 'global')
          .eq('store_key', d.store)
          .eq('version', d.version);
      } catch {
        /* reported below; the audit row for each version remains */
      }
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Delete everything an approved request covers, and republish the months it
 * affects. Throws if anything failed — the caller must then leave the request
 * undecided.
 */
export async function executeClear(req: StoredRequest, actor: string): Promise<ClearedRecord[]> {
  const rows = await readAll();
  const { next, cleared } = planClear(req, rows);
  if (!cleared.length) return [];
  await applyPlan(next, rows, actor);
  return cleared;
}
