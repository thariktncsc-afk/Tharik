/**
 * Bring every shop's "started" record (`__stockInit`) into line with the stock
 * data it actually holds — the rule in src/lib/engine/stockInit.ts.
 *
 *   node tools/reconcile-stock-init.mjs            dry run: what would change
 *   node tools/reconcile-stock-init.mjs --write    apply (after a backup)
 *
 * The app does this by itself after every save and every approved clear. This
 * is for records that went stale before it did — a shop whose only Initial
 * Opening was removed while the record kept its date.
 *
 * Only `__stockInit` is written, under its version; the operational data is
 * read and never changed. The previous record is saved to backups/ first.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const { createClient } = createRequire(join(root, 'package.json'))('@supabase/supabase-js');
const I = await import(pathToFileURL(join(root, 'src/lib/engine/stockInit.ts')).href);

readFileSync(join(root, '.env.local'), 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const write = process.argv.includes('--write');

async function main() {
  const { data, error } = await db.from('crs_state').select('store_key, data, version').eq('scope', 'global').in('store_key', [I.STOCK_INIT_KEY, 'entryStore']);
  if (error) {
    console.error('Could not read crs_state:', error.message);
    return 1;
  }
  const initRow = data.find((r) => r.store_key === I.STOCK_INIT_KEY);
  const entry = data.find((r) => r.store_key === 'entryStore')?.data ?? {};
  const init = I.readStockInit(initRow?.data);
  const shops = [...new Set([...Object.keys(init).map(Number), ...I.firstStockDates(entry).keys()])].sort((a, b) => a - b);
  const { next, changes } = I.reconcileStockInit(init, entry, shops, 'reconcile-stock-init', new Date().toISOString());

  for (const crs of shops) {
    const c = changes.find((x) => x.crsId === crs);
    const now = I.initialDate(next, crs);
    console.log(`CRS ${String(crs).padStart(2)}: ${c ? `${c.from ?? 'not started'} → ${c.to ?? 'NOT STARTED (Initial Opening can be entered again)'}` : `unchanged (${now ?? 'not started'})`}`);
  }
  console.log(`\n${changes.length} change(s)`);
  if (!write || !changes.length) {
    if (!write) console.log('DRY RUN — pass --write to apply.');
    return 0;
  }

  mkdirSync(join(root, 'backups'), { recursive: true });
  const file = join(root, 'backups', `stock-init-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(initRow ?? null, null, 1));
  console.log(`backup: ${file}`);
  const { data: upd, error: uErr } = await db
    .from('crs_state')
    .update({ data: next, version: Number(initRow.version) + 1, updated_at: new Date().toISOString(), updated_by: 'reconcile-stock-init' })
    .eq('scope', 'global')
    .eq('store_key', I.STOCK_INIT_KEY)
    .eq('version', initRow.version)
    .select('version')
    .maybeSingle();
  if (uErr || !upd) {
    console.error('update failed — the record changed while this ran; run it again.', uErr?.message ?? '');
    return 1;
  }
  console.log(`WROTE __stockInit v${initRow.version} → v${upd.version}`);
  return 0;
}

process.exitCode = await main();
