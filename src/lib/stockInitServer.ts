/**
 * Records that shops have started their stock chain — server only.
 * The rule itself is engine/stockInit.ts.
 *
 * Written under the row's version, like every crs_state write, and retried on
 * a race: two shops saving their first day at the same moment must both end up
 * recorded. Entries are only ever added, so a retry that finds a shop already
 * recorded simply leaves it.
 */
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { readStockInit, STOCK_INIT_KEY, withStarted, type StockInit, type StockInitEntry } from '@/lib/engine/stockInit';

export async function loadStockInit(): Promise<StockInit> {
  const { data } = await supabaseAdmin().from('crs_state').select('data').eq('scope', 'global').eq('store_key', STOCK_INIT_KEY).maybeSingle();
  return readStockInit(data?.data);
}

/** Add these shops. Returns the ones newly recorded; never throws. */
export async function markStarted(
  started: { crsId: number; date: string }[],
  by: string,
  source: StockInitEntry['source'] = 'save',
): Promise<number[]> {
  if (!started.length) return [];
  const db = supabaseAdmin();
  for (let round = 0; round < 4; round++) {
    try {
      const { data: row, error } = await db.from('crs_state').select('data, version').eq('scope', 'global').eq('store_key', STOCK_INIT_KEY).maybeSingle();
      if (error) throw error;
      const current = readStockInit(row?.data);
      const fresh = started.filter((s) => !current[String(s.crsId)]);
      if (!fresh.length) return [];
      const next = withStarted(current, fresh, by, source, new Date().toISOString());

      if (!row) {
        const { error: iErr } = await db.from('crs_state').insert({ scope: 'global', store_key: STOCK_INIT_KEY, data: next, version: 1, updated_by: by });
        if (!iErr) return fresh.map((s) => s.crsId);
        continue; // someone created it first — read it again
      }
      const { data: upd, error: uErr } = await db
        .from('crs_state')
        .update({ data: next, version: Number(row.version) + 1, updated_at: new Date().toISOString(), updated_by: by })
        .eq('scope', 'global')
        .eq('store_key', STOCK_INIT_KEY)
        .eq('version', row.version)
        .select('version')
        .maybeSingle();
      if (uErr) throw uErr;
      if (upd) return fresh.map((s) => s.crsId);
    } catch (e) {
      console.error('[stock-init] could not record started shops:', e instanceof Error ? e.message : e);
      return [];
    }
  }
  console.error('[stock-init] gave up recording started shops after repeated conflicts');
  return [];
}
