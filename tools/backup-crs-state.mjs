/**
 * Snapshots the crs_state store rows to a JSON file, and restores them.
 *
 *   node tools/backup-crs-state.mjs backup            -> backups/crs_state-<date>.json
 *   node tools/backup-crs-state.mjs restore <file>    -> writes the snapshot back
 *
 * Taken before a bulk import so a bad run is reversible: restore rewrites each
 * row's data exactly as snapshotted (version bumped, updated_by 'restore').
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const STORES = ['monthlyStore', 'meManualStore', 'meSourceStore', 'meGunnyStore', 'meCardStore', 'meRemitStore'];

readFileSync('.env.local', 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const [, , mode, fileArg] = process.argv;

if (mode === 'backup') {
  const { data, error } = await db.from('crs_state')
    .select('store_key, data, version, updated_by, updated_at')
    .eq('scope', 'global').in('store_key', STORES);
  if (error) { console.error(error.message); process.exit(1); }
  mkdirSync('backups', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const path = join('backups', `crs_state-${stamp}.json`);
  writeFileSync(path, JSON.stringify({ takenAt: new Date().toISOString(), rows: data }, null, 2));
  for (const r of data) console.log(`  ${r.store_key.padEnd(15)} v${r.version} (${Object.keys(r.data || {}).length} keys)`);
  console.log(`\nsnapshot written: ${path}`);
} else if (mode === 'restore' && fileArg) {
  const snap = JSON.parse(readFileSync(fileArg, 'utf8'));
  console.log(`restoring snapshot taken ${snap.takenAt}`);
  for (const row of snap.rows) {
    const cur = await db.from('crs_state').select('version').eq('scope', 'global').eq('store_key', row.store_key).maybeSingle();
    const res = cur.data
      ? await db.from('crs_state')
          .update({ data: row.data, version: cur.data.version + 1, updated_at: new Date().toISOString(), updated_by: 'restore:backup' })
          .eq('scope', 'global').eq('store_key', row.store_key)
      : await db.from('crs_state')
          .insert({ scope: 'global', store_key: row.store_key, data: row.data, version: 1, updated_by: 'restore:backup' });
    console.log(`  ${row.store_key.padEnd(15)} ${res.error ? 'FAILED: ' + res.error.message : 'restored'}`);
  }
} else {
  console.error('usage: node tools/backup-crs-state.mjs backup | restore <file>');
  process.exit(1);
}
