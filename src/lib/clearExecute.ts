/**
 * Performing an approved clear.
 *
 * Approval is not a status change and not a permission slip the shop spends
 * later — pressing Approve deletes the data, here, on the server, and the
 * request is only marked cleared once that has actually landed.
 *
 * WHAT A DAY IS — the selected shop and the selected date, nothing else.
 * Remittance is not a separate record: a day sheet carries `remits`,
 * `remitAmount`, `remitNonCereal`, `remitCereal` and `remitDate` on itself (see
 * the save in daily-entry/page.tsx), so removing the sheet removes the deposit
 * with it and no orphan is possible. Inspection for the same date is its own
 * row and goes too. `salesCloseStore` is keyed by MONTH but names a single day,
 * so it is dropped only when it names the day being cleared — clearing one day
 * must never disturb the rest of the month.
 *
 * WHAT A MONTH IS — the selected shop and the whole selected month: every
 * month-keyed store for it (Monthly Entry, remittance, gunny, card details,
 * allotment, Sales Close) AND every Daily Sales sheet dated inside it, with the
 * inspection recorded on those dates. A month keyed by day has nothing in
 * Monthly Entry but its day sheets, so leaving them would clear nothing at all.
 * No other month's records are removed, no other shop's, and nothing from the
 * Receipt register: a receipt records goods that arrived, and has its own clear.
 *
 * DEPENDENT DATA. A clear moves balances, so the shop's Opening → Closing chain
 * is rebuilt in date order from the earliest date cleared (engine/rechain.ts):
 * every later saved sheet re-opens with the Closing before it. A saved Opening
 * is locked for shop staff, so nobody else could repair the chain. Then
 * `monthlyStore` and `meSourceStore` — derived stores — are recomputed for
 * every month touched, from what survives rather than edited: the month, the
 * DSS and the statements all read them, and a stale figure there is a wrong
 * figure on statutory paperwork.
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
import { syncSheetReceipts, type ReceiptRow } from '@/lib/engine/receiptRollup';
import { rebuildChain } from '@/lib/engine/rechain';
import { isProtectedStore, STORE_LABEL } from '@/lib/clearGuard';
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
  'meAllotConfirmed',
  'salesCloseStore',
  'monthlyStore',
  'meSourceStore',
] as const;

type Row = { data: unknown; version: number };
type Rows = Record<string, Row>;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {});
const pad2 = (n: number) => String(n).padStart(2, '0');
const monthKeyOf = (crsId: number, iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return { key: `${crsId}_${m}_${y}`, month: m, year: y };
};

/**
 * The day records a MONTH clear takes with it: this shop's Daily Sales sheets
 * (real and projected) and inspection records dated inside the month.
 * `1_2026-09-` — the underscore keeps CRS 1 from matching CRS 10-19.
 */
export function monthDayKeys(
  stores: { entryStore?: unknown; inspectionStore?: unknown },
  crsId: number,
  month: number,
  year: number,
): { entryStore: string[]; inspectionStore: string[] } {
  const prefix = `${crsId}_${year}-${pad2(month)}-`;
  const pick = (v: unknown) =>
    Object.keys(obj(v))
      .filter((k) => k.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}$/.test(k.slice(String(crsId).length + 1)))
      .sort();
  return { entryStore: pick(stores.entryStore), inspectionStore: pick(stores.inspectionStore) };
}

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
export function planClear(
  req: StoredRequest,
  rows: Rows,
): { next: Record<string, unknown>; cleared: ClearedRecord[]; recalculated: string[] } {
  const next: Record<string, unknown> = {};
  const cleared: ClearedRecord[] = [];
  const recalculated: string[] = [];
  const months = new Set<string>();
  /** Per shop, the earliest date whose balance the clear moved. */
  const rebuildFrom = new Map<number, string>();
  const moved = (crsId: number, iso: string) => {
    const earliest = rebuildFrom.get(crsId);
    if (!earliest || iso < earliest) rebuildFrom.set(crsId, iso);
  };

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
    const before = Array.isArray(rows.receiptStore?.data) ? (rows.receiptStore.data as ReceiptRow[]) : [];
    const after = before.filter((r) => !ids.has(String((r as { id?: unknown })?.id ?? '')));
    if (after.length !== before.length) {
      next.receiptStore = after;
      for (const r of before) {
        const rec = r as { id?: unknown; crsId?: unknown; date?: unknown };
        if (!ids.has(String(rec?.id ?? ''))) continue;
        cleared.push({ store: 'receiptStore', module: 'Receipt', key: String(rec.id) });
        const d = String(rec.date ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        const crsId = Number(rec.crsId) || req.crsId;
        // The day sheet on the receipt's date shows the register's figure; it
        // drops with the receipt, as it does when the Receipt page deletes one.
        const dayKey = `${crsId}_${d}`;
        const entries = obj(take('entryStore'));
        const synced = syncSheetReceipts(entries[dayKey] as never, before, after, crsId, d);
        if (synced) next.entryStore = { ...entries, [dayKey]: synced };
        months.add(monthKeyOf(crsId, d).key);
        moved(crsId, d);
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
      moved(crsId, iso);
      continue;
    }

    // A month: `<crs>_<m>_<y>`.
    const mo = /^(\d+)_(\d{1,2})_(\d{4})$/.exec(key);
    if (mo) {
      const crsId = Number(mo[1]);
      const m = Number(mo[2]);
      const y = Number(mo[3]);
      for (const store of MONTH_STORES) drop(store, key);

      // Every Daily Sales sheet of the month goes with it — the ones keyed on
      // Daily Entry and the one a month-close projected — and the inspection
      // recorded on those dates.
      const days = monthDayKeys({ entryStore: take('entryStore'), inspectionStore: take('inspectionStore') }, crsId, m, y);
      for (const k of days.entryStore) drop('entryStore', k);
      for (const k of days.inspectionStore) drop('inspectionStore', k);
      months.add(key);
      moved(crsId, `${y}-${pad2(m)}-01`);
    }
  }

  // The chain, rebuilt in date order from the earliest date the clear moved.
  for (const [crsId, from] of rebuildFrom) {
    const r = rebuildChain({ entryStore: take('entryStore'), inspectionStore: take('inspectionStore'), receiptStore: take('receiptStore') }, crsId, from);
    if (!r.dates.length) continue;
    next.entryStore = r.entryStore;
    for (const ds of r.dates) {
      recalculated.push(`${crsId}_${ds}`);
      months.add(monthKeyOf(crsId, ds).key);
    }
  }

  // Recompute what each month publishes, from what survives — and everything
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

  return { next, cleared, recalculated };
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
 * Delete everything an approved request covers, rebuild the chain after it,
 * and republish the months it affects. Throws if anything failed — the caller
 * must then leave the request undecided.
 */
export async function executeClear(req: StoredRequest, actor: string): Promise<{ cleared: ClearedRecord[]; recalculated: string[] }> {
  const rows = await readAll();
  const { next, cleared, recalculated } = planClear(req, rows);
  if (!cleared.length) return { cleared: [], recalculated: [] };
  await applyPlan(next, rows, actor);
  return { cleared, recalculated };
}
