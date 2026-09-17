/**
 * Repair stored day sheets whose Opening / Total / Closing broke the chain.
 *
 *   node tools/repair-stock-chain.mjs                 dry run, every shop
 *   node tools/repair-stock-chain.mjs --crs=7         dry run, one shop
 *   node tools/repair-stock-chain.mjs --write         apply (after a backup)
 *
 * Sheets saved before the chain was rebuilt on every write can still hold a
 * typed Opening mid-chain — CRS 7's 16 Sep stored NPHH FRK Opening 538 and
 * Closing 100 while its screen, carrying from 15 Sep, showed 3342, so 17 Sep
 * opened at 100. This walks every shop's sheets in DATE order with the same
 * code the app uses on every save (src/lib/engine/rechain.ts,
 * rechainAndRepublish) and writes back only what the chain derives:
 *
 *   Opening, Total, Closing — and Receipt / adjustments where the Receipt
 *   Register or that date's inspection says otherwise.
 *
 * Sales, remittance and every other keyed field are never touched; projected
 * month sheets are never rewritten; the months that moved are republished.
 *
 * SAFETY. Nothing is written without --write. Before writing, every row about
 * to change is saved to backups/stock-chain-repair-<time>.json (gitignored).
 * Each row is written under the version it was read at; if any write fails the
 * rows already written are put back, and nothing is left half-repaired.
 * crs_state_audit records every version as usual (updated_by
 * 'repair:stock-chain').
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) return next(${JSON.stringify(srcUrl)} + spec.slice(2) + '.ts', ctx);
  return next(spec, ctx);
}`)}`,
  import.meta.url,
);
const { rechainAndRepublish } = await import(pathToFileURL(join(root, 'src/lib/engine/rechain.ts')).href);

readFileSync(join(root, '.env.local'), 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const write = process.argv.includes('--write');
const only = Number((process.argv.find((a) => a.startsWith('--crs=')) ?? '').split('=')[1]) || null;
const STORES = ['entryStore', 'inspectionStore', 'receiptStore', 'meManualStore', 'meSourceStore', 'monthlyStore'];
const WRITABLE = ['entryStore', 'meManualStore', 'meSourceStore', 'monthlyStore'];
// Compared by content, not key order: a republished month holds the same
// figures in a different property order, and writing that would bump a row's
// version for nothing — handing every open screen a needless conflict.
const canon = (v) =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const same = (a, b) => canon(a) === canon(b);

// process.exit() trips a libuv assertion on Windows while handles are closing,
// so the flow returns and sets process.exitCode instead.
async function main() {
  const { data, error } = await db.from('crs_state').select('store_key, data, version').eq('scope', 'global').in('store_key', STORES);
  if (error) {
    console.error('Could not read crs_state:', error.message);
    return 1;
  }
  const rows = Object.fromEntries((data ?? []).map((r) => [r.store_key, { data: r.data, version: Number(r.version) }]));
  const original = Object.fromEntries(STORES.map((k) => [k, rows[k]?.data ?? (k === 'receiptStore' ? [] : {})]));
  let stores = JSON.parse(JSON.stringify(original));

  const shops = [...new Set(Object.keys(stores.entryStore).map((k) => Number(k.split('_')[0])).filter((n) => n > 0))]
    .filter((n) => !only || n === only)
    .sort((a, b) => a - b);

  console.log(write ? '── REPAIRING the stock chain ──' : '── DRY RUN — nothing will be written. Pass --write to apply. ──');
  const repaired = [];
  for (const crs of shops) {
    const { patch, dates } = rechainAndRepublish(stores, crs, '0000-00-00');
    const count = Object.keys(stores.entryStore).filter((k) => k.startsWith(`${crs}_`)).length;
    if (!dates.length) {
      console.log(`CRS ${crs}: ${count} day sheet(s) — chain already consistent`);
      continue;
    }
    console.log(`CRS ${crs}: ${count} day sheet(s); ${dates.length} to repair — ${dates.join(', ')}`);
    for (const ds of dates) {
      const key = `${crs}_${ds}`;
      const was = stores.entryStore[key];
      const now = patch.entryStore[key];
      for (const sec of ['a', 'b']) {
        for (const [id, r] of Object.entries(now?.[sec] ?? {})) {
          const w = was?.[sec]?.[id] ?? {};
          if (same(w, r)) continue;
          const bits = ['open', 'receipt', 'total', 'close'].filter((f) => Number(w[f] ?? 0) !== Number(r[f] ?? 0)).map((f) => `${f} ${w[f] ?? 0} → ${r[f]}`);
          const adj = ['excess', 'shortage', 'transfer'].some((f) => Number(w[f] ?? 0) !== Number(r[f] ?? 0)) ? ' (adjustments from inspection)' : '';
          console.log(`   ${ds} ${sec}:${id.padEnd(10)} ${bits.join('  ')}${adj}  [sales ${r.sales ?? 0} kept]`);
        }
      }
      repaired.push({ crs, date: ds });
    }
    // What the republished months now say, for the commodities that moved.
    for (const [mKey, month] of Object.entries(patch.monthlyStore ?? {})) {
      if (!mKey.startsWith(`${crs}_`) || same(month, stores.monthlyStore[mKey])) continue;
      for (const sec of ['a', 'b']) {
        for (const [id, r] of Object.entries(month?.[sec] ?? {})) {
          const w = stores.monthlyStore[mKey]?.[sec]?.[id] ?? {};
          const bits = ['open', 'receipt', 'sales', 'close'].filter((f) => Number(w[f] ?? 0) !== Number(r[f] ?? 0)).map((f) => `${f} ${w[f] ?? 0} → ${r[f]}`);
          if (bits.length) console.log(`   month ${mKey.replace(/^\d+_/, '')} ${sec}:${id.padEnd(10)} ${bits.join('  ')}`);
        }
      }
    }
    stores = { ...stores, ...patch };
  }

  const changed = WRITABLE.filter((k) => !same(stores[k], original[k]));
  console.log(`\n${repaired.length} day sheet(s) across ${new Set(repaired.map((r) => r.crs)).size} shop(s); stores to write: ${changed.join(', ') || 'none'}`);
  if (!write || !changed.length) return 0;

  // ── Backup, then write under version, rolling back on any failure ────────
  mkdirSync(join(root, 'backups'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = join(root, 'backups', `stock-chain-repair-${stamp}.json`);
  writeFileSync(backupFile, JSON.stringify(Object.fromEntries(changed.map((k) => [k, rows[k] ?? null])), null, 1));
  console.log(`backup: ${backupFile}`);

  const done = [];
  try {
    for (const key of changed) {
      const row = rows[key];
      if (!row) throw new Error(`${key} has no row to update`);
      const { data: upd, error: e } = await db
        .from('crs_state')
        .update({ data: stores[key], version: row.version + 1, updated_at: new Date().toISOString(), updated_by: 'repair:stock-chain' })
        .eq('scope', 'global')
        .eq('store_key', key)
        .eq('version', row.version)
        .select('version')
        .maybeSingle();
      if (e) throw new Error(`${key}: ${e.message}`);
      if (!upd) throw new Error(`${key} changed while the repair was running — run it again.`);
      done.push({ key, version: Number(upd.version) });
      console.log(`wrote ${key} (v${row.version} → v${upd.version})`);
    }
  } catch (err) {
    console.error(`FAILED: ${err.message}\nputting back what was written…`);
    for (const d of done.reverse()) {
      await db
        .from('crs_state')
        .update({ data: rows[d.key].data, version: d.version + 1, updated_at: new Date().toISOString(), updated_by: 'repair:stock-chain (rollback)' })
        .eq('scope', 'global')
        .eq('store_key', d.key)
        .eq('version', d.version);
      console.error(`restored ${d.key}`);
    }
    return 1;
  }

  // The activity log, when installed: one System Update per repaired day.
  const { error: logErr } = await db.from('activity_log').insert(
    repaired.map((r) => ({
      actor_username: 'system', actor_name: 'Stock chain repair', actor_role: 'SYSTEM', source: 'system',
      crs_id: r.crs, module: 'Daily Sales', action: 'recalculated', entry_date: r.date, record_key: `${r.crs}_${r.date}`,
      summary: 'Opening / Total / Closing recalculated in date order (repair)',
    })),
  );
  if (logErr) console.log('activity log not updated (migration 0006 not run yet) — crs_state_audit still records every write');
  console.log('\nREPAIR DONE');
  return 0;
}

process.exitCode = await main();
