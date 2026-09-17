/**
 * Record which shops have ALREADY started their stock chain — the one-time
 * Initial Opening Balance (src/lib/engine/stockInit.ts).
 *
 *   node tools/seed-stock-init.mjs                      dry run: what is recorded, and which shops hold day sheets
 *   node tools/seed-stock-init.mjs --crs=7,19,30        dry run for exactly these shops
 *   node tools/seed-stock-init.mjs --crs=7,19,30 --write
 *
 * The shops are named explicitly, never inferred, because "started" is the
 * office's call: a shop can hold a test sheet and still not have begun. Each is
 * recorded with its earliest saved day sheet as its first day.
 *
 * SAFE BY CONSTRUCTION. It writes one crs_state row, `__stockInit`, and only
 * ever ADDS shops to it — a shop already recorded is left exactly as it is, and
 * no other row is read for writing. Version-locked like every other write.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
readFileSync(join(root, '.env.local'), 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const KEY = '__stockInit';
const write = process.argv.includes('--write');
const crsArg = (process.argv.find((a) => a.startsWith('--crs=')) ?? '').split('=')[1] ?? '';
const wanted = [...new Set(crsArg.split(',').map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))];

async function main() {
  const { data, error } = await db.from('crs_state').select('store_key, data, version').eq('scope', 'global').in('store_key', [KEY, 'entryStore']);
  if (error) {
    console.error('Could not read crs_state:', error.message);
    return 1;
  }
  const initRow = data.find((r) => r.store_key === KEY);
  const current = initRow?.data && typeof initRow.data === 'object' ? initRow.data : {};
  const entry = data.find((r) => r.store_key === 'entryStore')?.data ?? {};

  const firstDay = {};
  for (const k of Object.keys(entry)) {
    const m = /^(\d+)_(\d{4}-\d{2}-\d{2})$/.exec(k);
    if (m && (!firstDay[m[1]] || m[2] < firstDay[m[1]])) firstDay[m[1]] = m[2];
  }

  console.log(`recorded now: ${Object.keys(current).length ? Object.entries(current).map(([c, e]) => `CRS ${c} (${e.date})`).join(', ') : 'none'}`);
  console.log(`shops holding day sheets: ${Object.entries(firstDay).map(([c, d]) => `CRS ${c} from ${d}`).join(', ') || 'none'}`);
  if (!wanted.length) {
    console.log('\nName the started shops with --crs=… to record them.');
    return 0;
  }

  const at = new Date().toISOString();
  const add = wanted.filter((c) => !current[String(c)]);
  const next = { ...current };
  for (const c of add) next[String(c)] = { date: firstDay[String(c)] ?? at.slice(0, 10), at, by: 'seed-stock-init', source: 'seed' };
  const skipped = wanted.filter((c) => current[String(c)]);
  console.log(`\nto add: ${add.map((c) => `CRS ${c} (first day ${next[String(c)].date})`).join(', ') || 'nothing'}${skipped.length ? `; already recorded, left alone: ${skipped.map((c) => `CRS ${c}`).join(', ')}` : ''}`);
  if (!write || !add.length) {
    if (!write) console.log('DRY RUN — pass --write to record.');
    return 0;
  }

  if (!initRow) {
    const { error: iErr } = await db.from('crs_state').insert({ scope: 'global', store_key: KEY, data: next, version: 1, updated_by: 'seed-stock-init' });
    if (iErr) {
      console.error('insert failed:', iErr.message);
      return 1;
    }
  } else {
    const { data: upd, error: uErr } = await db
      .from('crs_state')
      .update({ data: next, version: Number(initRow.version) + 1, updated_at: at, updated_by: 'seed-stock-init' })
      .eq('scope', 'global')
      .eq('store_key', KEY)
      .eq('version', initRow.version)
      .select('version')
      .maybeSingle();
    if (uErr || !upd) {
      console.error('update failed — the record changed while this ran; run it again.', uErr?.message ?? '');
      return 1;
    }
  }
  console.log('RECORDED');
  return 0;
}

process.exitCode = await main();
