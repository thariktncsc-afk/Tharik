/**
 * An administrator's Opening correction on a SAVED day sheet — Daily Entry's
 * own (daily-entry/page.tsx `derive`: a typed Opening where the chain carries
 * in is saved fixed, and the days after carry from it), for a correction the
 * office decides on.
 *
 *   node tools/correct-opening.mjs --crs=5 --date=2026-09-01 --id=PB_BRA --open=12          dry run
 *   … --write                                                                             apply
 *
 * The row gets Opening = --open, openFixed, and its Total / Closing worked
 * out from its own receipt, adjustments and sales. Then, as a save does, the
 * month is republished and the chain rebuilt from that date forward
 * (rechainAndRepublish). A LATER sheet whose fixed Opening now equals the
 * balance carried into it is no longer a correction ("typed back to exactly
 * the carry is no correction at all") and loses the mark — so the chain reads
 * as one line again.
 *
 * The server's stock guard is run on the result (as an administrator); only
 * the named shop's keys may change; every changed store is backed up to
 * backups/ and written under its version; the activity log gets the rows
 * /api/state would write (diffStateWrite).
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
const { buildChainIndex, openingFor } = await imp('lib/engine/stockChain.ts');
const { rebuildMonthlyFromDaily } = await imp('lib/engine/monthlyRollup.ts');
const { rechainAndRepublish } = await imp('lib/engine/rechain.ts');
const { inspectStockWrite, describeStock } = await imp('lib/stockGuard.ts');
const { diffStateWrite } = await imp('lib/activityLog/core.ts');
const { recordActivity } = await imp('lib/activityLog/server.ts');
const { reconcileShops } = await imp('lib/stockInitServer.ts');

const STORES = ['entryStore', 'inspectionStore', 'receiptStore', 'meManualStore', 'meSourceStore', 'monthlyStore', '__commodityMaster', '__stockInit'];
const WRITABLE = ['entryStore', 'meSourceStore', 'monthlyStore'];
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const clone = (v) => JSON.parse(JSON.stringify(v));
const near3 = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.0005;

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const crsId = Number(arg('crs'));
  const date = arg('date') ?? '';
  const id = arg('id') ?? '';
  const value = Number(arg('open'));
  const write = process.argv.includes('--write');
  if (!Number.isInteger(crsId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !id || arg('open') === undefined || !Number.isFinite(value) || value < 0) {
    console.error('Usage: node tools/correct-opening.mjs --crs=<n> --date=YYYY-MM-DD --id=<commodity> --open=<value ≥ 0> [--write]');
    return 2;
  }
  const key = `${crsId}_${date}`;
  const { data, error } = await db.from('crs_state').select('store_key,data,version').eq('scope', 'global').in('store_key', STORES);
  if (error) throw error;
  const stored = Object.fromEntries(data.map((r) => [r.store_key, r.data]));
  const versions = Object.fromEntries(data.map((r) => [r.store_key, r.version]));
  const next = Object.fromEntries(WRITABLE.map((k) => [k, clone(stored[k] ?? {})]));
  const sheet = next.entryStore[key];
  const sec = sheet?.a?.[id] ? 'a' : sheet?.b?.[id] ? 'b' : null;
  if (!sheet || !sec || sheet.__projection) {
    console.error(`Refused: ${key} is not a saved day sheet holding ${id}.`);
    return 1;
  }
  const lists = commodityListsFor(stored.__commodityMaster ?? null, crsId);

  // The correction itself.
  const r = sheet[sec][id];
  const total = value + (Number(r.receipt) || 0) + (Number(r.excess) || 0) - (Number(r.shortage) || 0) - (Number(r.transfer) || 0);
  sheet[sec][id] = { ...r, open: value, openFixed: true, total, close: total - (Number(r.sales) || 0) };
  console.log(`CRS ${crsId} · ${date} · ${id}: Opening ${r.open} → ${value}${r.openFixed ? '' : ' (now fixed)'}; Total ${r.total} → ${total}; Closing ${r.close} → ${total - (Number(r.sales) || 0)}`);

  // A later fixed Opening that now equals its carry is no correction any more.
  const later = Object.keys(next.entryStore).filter((k) => k.startsWith(`${crsId}_`) && k.slice(k.indexOf('_') + 1) > date && !next.entryStore[k].__projection).sort();
  const unfixed = [];
  for (const k of later) {
    const row = next.entryStore[k][sec]?.[id];
    if (!row?.openFixed) continue;
    const chain = buildChainIndex(next.entryStore, stored.inspectionStore, stored.receiptStore, crsId);
    const carry = openingFor(chain, k.slice(k.indexOf('_') + 1), id, sec).value;
    if (carry !== null && near3(carry, row.open)) {
      const { openFixed: _f, ...rest } = row;
      next.entryStore[k][sec][id] = rest;
      unfixed.push(`${k} (carry ${carry} = its ${row.open})`);
    } else {
      console.log(`  note: ${k} keeps its own fixed Opening ${row.open} (carry would be ${carry})`);
    }
  }
  if (unfixed.length) console.log(`  no longer a correction (equals the carry): ${unfixed.join(', ')}`);

  // Republish every month from the date on, and rebuild the chain, as a save does.
  const chained = rechainAndRepublish({ ...next, inspectionStore: stored.inspectionStore, receiptStore: stored.receiptStore, meManualStore: stored.meManualStore }, crsId, date, lists);
  for (const [k, v] of Object.entries(chained.patch)) if (WRITABLE.includes(k)) next[k] = v;
  const months = new Set([date, ...later.map((k) => k.slice(k.indexOf('_') + 1))].map((d) => d.slice(0, 7)));
  for (const ym of months) {
    const [y, m] = ym.split('-').map(Number);
    const month = rebuildMonthlyFromDaily(crsId, m, y, next.entryStore, stored.inspectionStore, stored.meManualStore?.[`${crsId}_${m}_${y}`], lists, stored.receiptStore);
    next.monthlyStore[`${crsId}_${m}_${y}`] = month.merged;
    next.meSourceStore[`${crsId}_${m}_${y}`] = month.source;
    const row = month.merged[sec]?.[id];
    console.log(`  month ${m}/${y} ${id}: Opening ${row?.open} + Receipt ${row?.receipt} − Sales ${row?.sales} = Closing ${row?.close}`);
  }
  const chain = buildChainIndex(next.entryStore, stored.inspectionStore, stored.receiptStore, crsId);
  for (const k of later) {
    const d = k.slice(k.indexOf('_') + 1);
    const row = next.entryStore[k][sec]?.[id];
    if (row) console.log(`  ${d} ${id}: Opening ${row.open}${row.openFixed ? ' (fixed)' : ''} (carry ${openingFor(chain, d, id, sec).value}), Closing ${row.close}`);
  }

  const changed = WRITABLE.filter((k) => canon(next[k]) !== canon(stored[k] ?? {}));
  for (const k of changed) {
    const before = stored[k] ?? {};
    const moved = [...new Set([...Object.keys(before), ...Object.keys(next[k])])].filter((x) => canon(before[x]) !== canon(next[k][x]));
    const other = moved.filter((x) => !x.startsWith(`${crsId}_`));
    if (other.length) { console.error(`Refused: ${k} would change another shop's ${other.join(', ')}`); return 1; }
    console.log(`  ${k}: ${moved.join(', ')}`);
  }
  const incoming = Object.fromEntries(changed.map((k) => [k, next[k]]));
  const broken = inspectStockWrite(stored, incoming, true);
  if (broken.length) { console.error(`Refused by the stock guard: ${describeStock(broken)}`); return 1; }
  console.log('  server guard: stock ✓');
  if (!write) {
    console.log('DRY RUN — pass --write to apply.');
    return 0;
  }
  mkdirSync(join(root, 'backups'), { recursive: true });
  const file = join(root, 'backups', `correct-opening-${key}-${id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ key, id, value, versions, before: Object.fromEntries(changed.map((k) => [k, stored[k]])) }, null, 1));
  console.log(`Backed up ${changed.join(', ')} to ${file}`);
  const landed = {};
  for (const k of ['entryStore', ...changed.filter((k) => k !== 'entryStore')].filter((k) => changed.includes(k))) {
    const { data: upd, error: e } = await db
      .from('crs_state')
      .update({ data: next[k], version: Number(versions[k]) + 1, updated_at: new Date().toISOString(), updated_by: 'admin' })
      .eq('scope', 'global').eq('store_key', k).eq('version', versions[k]).select('version');
    if (e) throw e;
    if (!upd?.length) { console.error(`Refused: ${k} changed since it was read. Written so far: ${Object.keys(landed).join(', ') || 'nothing'}.`); return 1; }
    landed[k] = next[k];
    console.log(`WROTE ${k} v${versions[k]} → v${upd[0].version}`);
  }
  const session = { userId: 1, username: 'admin', role: 'ADMIN', crsId: null, iat: Math.floor(Date.now() / 1000) };
  await recordActivity(session, diffStateWrite(stored, landed, { entryStore: { [key]: 'edited' } }));
  await reconcileShops([crsId], 'admin');
  console.log(`Done: ${key} ${id} Opening ${value} — activity logged.`);
  return 0;
}
// Returned, not process.exit(): see save-day-sheet.mjs (libuv on Windows).
process.exitCode = await main();
