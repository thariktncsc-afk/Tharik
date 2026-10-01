/**
 * Bring the STORED Gunny Stock copies up to the rule, for one month, every
 * shop (office, 2026-09-30).
 *
 *   node tools/refresh-gunny.mjs --month=9 --year=2026 [--crs=7,11] [--write]
 *
 * The screen and the statements work Gunny out live, but the NEXT month opens
 * at the Closing stored here — and until 2026-09-30 that copy was written only
 * by a Gunny Save or a month-close, so many shops' stored Receipt / Total /
 * Closing lag their sales (CRS 11 September: Closing 870 stored, 1291 by the
 * rule). From that date Daily Entry, the Receipt page, the month-close and an
 * approved clear keep it current (lib/gunnyRefresh.ts); this tool catches up
 * the months saved before.
 *
 * Exactly what those saves do — refreshGunnyMonths (monthly-entry/lib.ts),
 * from the month as the roll-up publishes it and the Receipt page's saved
 * Gunny / Poly switch: Receipt, Total, Closing re-worked, a carried Opening
 * re-carried, and the following months re-carry after it. Keyed figures stay
 * as keyed (an Opening the office set, Issues, an administrator's Receipt).
 * A shop with sales and no record gets one (next month needs its Closing).
 *
 * Dry run by default. --write: meGunnyStore only, backed up to backups/
 * first, the server's stock guard run on the result, written under its
 * version. A re-run writes nothing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(`
const SRC = ${JSON.stringify(srcUrl)};
export async function resolve(spec, ctx, next) {
  let s = spec;
  if (s === 'next/headers' || s === 'next/server') s += '.js';
  const rel = (s.startsWith('./') || s.startsWith('../')) && ctx.parentURL && ctx.parentURL.startsWith(SRC);
  if (s.startsWith('@/') || rel) {
    const base = s.startsWith('@/') ? SRC + s.slice(2) : new URL(s, ctx.parentURL).href;
    if (/\\.[a-z]+$/.test(s)) return next(base, ctx);
    for (const ext of ['.ts', '.tsx', '.js']) { try { return await next(base + ext, ctx); } catch {} }
  }
  const r = await next(s, ctx);
  return r.url.endsWith('.json') ? { ...r, importAttributes: { type: 'json' } } : r;
}`)}`,
  import.meta.url,
);
readFileSync(join(root, '.env.local'), 'utf8').split('\n').forEach((l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
});
const imp = (p) => import(pathToFileURL(join(root, 'src', p)).href);
const { createClient } = createRequire(join(root, 'package.json'))('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { commodityListsFor } = await imp('lib/masters.ts');
const { rebuildMonthlyFromDaily } = await imp('lib/engine/monthlyRollup.ts');
const { packTypesFor } = await imp('lib/engine/gunnyPack.ts');
const { refreshGunnyMonths } = await imp('app/(app)/monthly-entry/lib.ts');
const { inspectStockWrite, describeStock } = await imp('lib/stockGuard.ts');
const { diffStateWrite } = await imp('lib/activityLog/core.ts');
const { recordActivity } = await imp('lib/activityLog/server.ts');

const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const ITEMS = ['ss50', 'poly', 'cbox'];

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const month = Number(arg('month'));
  const year = Number(arg('year'));
  const only = (arg('crs') ?? '').split(',').filter(Boolean).map(Number);
  const write = process.argv.includes('--write');
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2020) {
    console.error('Usage: node tools/refresh-gunny.mjs --month=<1-12> --year=<yyyy> [--crs=N,…] [--write]');
    return 2;
  }
  const KEYS = ['entryStore', 'inspectionStore', 'receiptStore', 'meManualStore', 'monthlyStore', 'meGunnyStore', '__commodityMaster'];
  const { data, error } = await db.from('crs_state').select('store_key,data,version').eq('scope', 'global').in('store_key', KEYS);
  if (error) throw error;
  const stored = Object.fromEntries(data.map((r) => [r.store_key, r.data]));
  const versions = Object.fromEntries(data.map((r) => [r.store_key, r.version]));
  if (!stored.meGunnyStore) { console.error('meGunnyStore row missing — not creating stores from a tool.'); return 1; }

  let gunny = stored.meGunnyStore;
  const moved = [];
  for (let crsId = 1; crsId <= 30; crsId++) {
    if (only.length && !only.includes(crsId)) continue;
    const key = `${crsId}_${month}_${year}`;
    // The month as the roll-up publishes it — what a save leaves in monthlyStore.
    const merged = rebuildMonthlyFromDaily(crsId, month, year, stored.entryStore ?? {}, stored.inspectionStore ?? {}, stored.meManualStore?.[key], commodityListsFor(stored.__commodityMaster ?? null, crsId), stored.receiptStore ?? []).merged;
    const next = refreshGunnyMonths(gunny, crsId, month, year, { ...(stored.monthlyStore ?? {}), [key]: merged }, (m, y) => packTypesFor(stored.receiptStore ?? [], crsId, m, y));
    if (!next) continue;
    // Figures only: a record re-worked to the same figures differs from the stored one by its updatedAt alone.
    const figures = (v) => canon(v).replace(/"updatedAt":"[^"]*",?/g, '');
    const keys = Object.keys(next).filter((k) => figures(next[k]) !== figures(gunny[k]));
    for (const k of keys) {
      const a = gunny[k] ?? {}, b = next[k];
      const line = ITEMS.map((i) => `${i} ${a[i]?.opening ?? '·'}+${a[i]?.receipt ?? '·'}=${a[i]?.total ?? '·'}→${a[i]?.closing ?? '·'}  ⇒  ${b[i]?.opening ?? '·'}+${b[i]?.receipt}=${b[i]?.total}→${b[i]?.closing}`).join(' | ');
      console.log(`  ${k.padEnd(10)} ${gunny[k] ? '' : '(new) '}${line}`);
    }
    moved.push(...keys);
    gunny = next;
  }
  if (!moved.length) { console.log('Every stored Gunny record already agrees — nothing to write.'); return 0; }
  const other = moved.filter((k) => !only.length ? false : !only.some((c) => k.startsWith(`${c}_`)));
  if (other.length) { console.error(`Refused: would change a shop not named: ${other.join(', ')}`); return 1; }

  const broken = inspectStockWrite(stored, { meGunnyStore: gunny }, true);
  if (broken.length) { console.error(`Refused by the stock guard: ${describeStock(broken)}`); return 1; }
  console.log(`${moved.length} record(s) · meGunnyStore v${versions.meGunnyStore} · stock guard ✓`);
  if (!write) { console.log('DRY RUN — pass --write to apply.'); return 0; }

  mkdirSync(join(root, 'backups'), { recursive: true });
  const file = join(root, 'backups', `refresh-gunny-${month}-${year}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ month, year, only, version: versions.meGunnyStore, keys: moved, before: stored.meGunnyStore }, null, 1));
  console.log(`Backed up meGunnyStore to ${file}`);
  const { data: upd, error: e } = await db
    .from('crs_state')
    .update({ data: gunny, version: Number(versions.meGunnyStore) + 1, updated_at: new Date().toISOString(), updated_by: 'admin' })
    .eq('scope', 'global').eq('store_key', 'meGunnyStore').eq('version', versions.meGunnyStore).select('version');
  if (e) throw e;
  if (!upd?.length) { console.error('Refused: meGunnyStore changed since it was read — nothing written. Run it again.'); return 1; }
  console.log(`WROTE meGunnyStore v${versions.meGunnyStore} → v${upd[0].version}`);
  const session = { userId: 1, username: 'admin', role: 'ADMIN', crsId: null, iat: Math.floor(Date.now() / 1000) };
  await recordActivity(session, diffStateWrite(stored, { meGunnyStore: gunny }, {}));
  console.log('Done — activity logged.');
  return 0;
}
process.exitCode = await main();
