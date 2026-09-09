/**
 * A complete, restorable snapshot of every crs_state row — plus an inventory
 * of what each store holds.
 *
 *   node tools/snapshot-all-state.mjs            -> backups/full-state-<stamp>.json + inventory
 *   node tools/snapshot-all-state.mjs restore <file>
 *
 * tools/backup-crs-state.mjs covers only six stores, which is not enough to
 * undo a clear-down. This takes everything, so the operation is reversible.
 * Nothing here writes unless `restore` is passed explicitly.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

readFileSync('.env.local', 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const [, , mode, fileArg] = process.argv;

/** Rows are objects keyed by id, or arrays. Count what a clerk would call records. */
const countOf = (data) => {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === 'object') return Object.keys(data).length;
  return data === null || data === undefined ? 0 : 1;
};

if (mode === 'restore') {
  if (!fileArg) throw new Error('restore needs a snapshot file');
  const snap = JSON.parse(readFileSync(fileArg, 'utf8'));
  for (const row of snap.rows) {
    const { error } = await db
      .from('crs_state')
      .update({ data: row.data, updated_at: new Date().toISOString(), updated_by: 'restore' })
      .eq('scope', row.scope)
      .eq('store_key', row.store_key);
    console.log(`${error ? 'FAIL' : 'ok  '} ${row.store_key}`);
  }
  console.log(`\nRestored ${snap.rows.length} store(s) from ${fileArg}`);
  process.exit(0);
}

const { data, error } = await db.from('crs_state').select('scope, store_key, data, version, updated_at, updated_by');
if (error) {
  console.error(error.message);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
if (!existsSync('backups')) mkdirSync('backups', { recursive: true });
const out = join('backups', `full-state-${stamp}.json`);
writeFileSync(out, JSON.stringify({ takenAt: new Date().toISOString(), rows: data }, null, 2));

console.log(`Snapshot: ${out}  (${data.length} rows, ${(JSON.stringify(data).length / 1024).toFixed(0)} KB)\n`);
console.log('store_key'.padEnd(22) + 'records'.padStart(9) + '   version   last written by');
console.log('─'.repeat(74));
for (const r of [...data].sort((a, b) => a.store_key.localeCompare(b.store_key))) {
  console.log(
    r.store_key.padEnd(22) + String(countOf(r.data)).padStart(9) + '   ' + String(r.version).padStart(7) + '   ' + (r.updated_by ?? ''),
  );
}
