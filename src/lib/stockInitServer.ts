/**
 * Keeps each shop's "started" record in line with the stock data it actually
 * holds — server only. The rule itself is engine/stockInit.ts.
 *
 * Called after a save lands in /api/state (for the shops whose sheets it
 * changed) and after an approved clear (for the shop it cleared). Both read
 * the entryStore as it now stands in the database, not a copy from before the
 * write, so a clear that removed a shop's only Initial Opening resets the shop,
 * and a save of an earlier Initial Opening moves its first day.
 *
 * Written under the row's version, like every crs_state write, and retried on
 * a race. Never throws: the save or clear it follows has already succeeded,
 * and the next write to the same shop reconciles it again.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { readStockInit, reconcileStockInit, STOCK_INIT_KEY, type StockInit, type StockInitChange } from '@/lib/engine/stockInit';

export async function loadStockInit(): Promise<StockInit> {
  const { data } = await supabaseAdmin().from('crs_state').select('data').eq('scope', 'global').eq('store_key', STOCK_INIT_KEY).maybeSingle();
  return readStockInit(data?.data);
}

/** Reconcile these shops against the stored entryStore. Returns what changed. */
export async function reconcileShops(shops: number[], by: string): Promise<StockInitChange[]> {
  if (!shops.length) return [];
  const db = supabaseAdmin();
  for (let round = 0; round < 4; round++) {
    try {
      const { data: rows, error } = await db.from('crs_state').select('store_key, data, version').eq('scope', 'global').in('store_key', [STOCK_INIT_KEY, 'entryStore']);
      if (error) throw error;
      const initRow = rows?.find((r) => r.store_key === STOCK_INIT_KEY);
      const entry = rows?.find((r) => r.store_key === 'entryStore')?.data ?? {};
      const { next, changes } = reconcileStockInit(readStockInit(initRow?.data), entry, shops, by, new Date().toISOString());
      if (!changes.length) return [];

      if (!initRow) {
        const { error: iErr } = await db.from('crs_state').insert({ scope: 'global', store_key: STOCK_INIT_KEY, data: next, version: 1, updated_by: by });
        if (!iErr) return changes;
        continue; // someone created it first — read it again
      }
      const { data: upd, error: uErr } = await db
        .from('crs_state')
        .update({ data: next, version: Number(initRow.version) + 1, updated_at: new Date().toISOString(), updated_by: by })
        .eq('scope', 'global')
        .eq('store_key', STOCK_INIT_KEY)
        .eq('version', initRow.version)
        .select('version')
        .maybeSingle();
      if (uErr) throw uErr;
      if (upd) return changes;
    } catch (e) {
      console.error('[stock-init] could not reconcile:', e instanceof Error ? e.message : e);
      return [];
    }
  }
  console.error('[stock-init] gave up reconciling after repeated conflicts');
  return [];
}
