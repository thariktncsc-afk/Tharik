/**
 * Place one commodity of the live Commodity Master (`__commodityMaster`):
 * its Order (position on every list) and its Scope (All Shops / one CRS) —
 * exactly what Commodity Master → Edit saves (office, 2026-10-07).
 *
 *   node tools/set-commodity-place.mjs --id=OAP_FRK --order=10 --crs=10          dry run
 *   node tools/set-commodity-place.mjs --id=OAP_FRK --order=10 --crs=10 --write  apply
 *   node tools/set-commodity-place.mjs --id=OAP_FRK --order=10 --all [--write]   All Shops
 *
 * Order follows the screen's rule (commodityScope.ts `placeAtOrder`): a free
 * number moves nothing; a taken one moves only the run of rows from it up to
 * the first free number, one step down — so every other commodity keeps its
 * place relative to the rest, on every shop's list.
 *
 * Narrowing to one shop refuses while another shop holds a figure for the
 * commodity (its figures would leave that shop's screens), as the screen asks.
 * Only `__commodityMaster` is written; no figure anywhere is touched — every
 * record is keyed by the commodity's id, never its position. The row is
 * backed up to backups/ first and written under its version; the activity
 * log gets the change.
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
const { placeAtOrder, scopeShop } = await imp('lib/engine/commodityScope.ts');
const { commodityListsFor } = await imp('lib/masters.ts');
const { diffStateWrite } = await imp('lib/activityLog/core.ts');
const { recordActivity } = await imp('lib/activityLog/server.ts');

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const id = arg('id');
const order = Number(arg('order'));
const crs = arg('crs') ? Number(arg('crs')) : null;
const all = process.argv.includes('--all');
const write = process.argv.includes('--write');
if (!id || !Number.isInteger(order) || order < 1 || (crs === null) === !all || (crs !== null && (!Number.isInteger(crs) || crs < 1 || crs > 30))) {
  console.error('Usage: node tools/set-commodity-place.mjs --id=<ID> --order=<n> (--crs=<1-30> | --all) [--write]');
  process.exit(2);
}

const read = async (key) => {
  const { data, error } = await db.from('crs_state').select('data, version').eq('scope', 'global').eq('store_key', key).maybeSingle();
  if (error) throw error;
  return data;
};
const row = await read('__commodityMaster');
if (!row || !Array.isArray(row.data)) { console.error('No __commodityMaster in crs_state.'); process.exit(1); }
const target = row.data.find((r) => r.id === id);
if (!target) { console.error(`${id} is not on the Commodity Master.`); process.exit(1); }

// Who holds a figure for it — a shop narrowed away from would lose sight of it.
const holders = new Set();
const nz = (r) => !!r && ['open', 'receipt', 'sales', 'close', 'total'].some((f) => Number(r[f]));
for (const key of ['entryStore', 'monthlyStore', 'meManualStore', 'receiptStore']) {
  const s = (await read(key))?.data;
  if (!s) continue;
  const each = Array.isArray(s) ? s.map((r) => [String(r?.crsId ?? ''), r]) : Object.entries(s).map(([k, r]) => [k.split('_')[0], r]);
  for (const [shop, r] of each) {
    if (!r || typeof r !== 'object') continue;
    if (nz(r.a?.[id]) || nz(r.b?.[id]) || Number(r.items?.[id]?.qty ?? r.items?.[id]) > 0) holders.add(Number(shop));
  }
}
const others = [...holders].filter((h) => crs !== null && h !== crs).sort((a, b) => a - b);
if (others.length) {
  console.error(`Refused: CRS ${others.join(', ')} hold figures for ${id}; narrowing it to CRS ${crs} would take it off their screens.`);
  process.exit(1);
}

const next = row.data.map((r) => ({ ...r }));
const t = next.find((r) => r.id === id);
const { moved } = placeAtOrder(next, id, order);
if (crs !== null) { t.scope = 'shop'; t.shopId = crs; } else { delete t.scope; delete t.shopId; }
const wasScope = scopeShop(target) ? `CRS ${scopeShop(target)}` : 'All Shops';
const nowScope = crs !== null ? `CRS ${crs}` : 'All Shops';
console.log(`__commodityMaster v${row.version} · ${id} (${target.en}) · Order ${target.order} → ${t.order} · Scope ${wasScope} → ${nowScope}`);
console.log(`Figures held for ${id}: ${holders.size ? [...holders].map((h) => `CRS ${h}`).join(', ') : 'none'}.`);
console.log(`Order numbers moved one step down (their place among the rest unchanged): ${moved.length ? moved.join(', ') : 'none'}`);
const show = (master, shop) => {
  const l = commodityListsFor(master, shop).a;
  const i = l.findIndex((c) => c.id === 'OAP');
  return l.map((c, n) => `${n + 1}.${c.id}`).slice(Math.max(0, i - 1), i + 4).join('  ');
};
for (const shop of [crs ?? 10, crs === 1 ? 2 : 1, 20]) {
  console.log(`  CRS ${shop}: before ${show(row.data, shop)}\n          after  ${show(next, shop)}`);
}
const relative = (master, shop) => commodityListsFor(master, shop).a.map((c) => c.id).filter((x) => x !== id).join();
const shifted = Array.from({ length: 30 }, (_, i) => i + 1).filter((s) => relative(row.data, s) !== relative(next, s));
console.log(`Shops whose other commodities change order: ${shifted.length ? shifted.join(', ') : 'none'}`);
if (shifted.length) { console.error('Refused: another commodity would change place.'); process.exit(1); }
if (JSON.stringify(next) === JSON.stringify(row.data)) { console.log('Already so — nothing to write.'); process.exit(0); }
if (!write) { console.log('DRY RUN — pass --write to apply.'); process.exit(0); }

mkdirSync(join(root, 'backups'), { recursive: true });
const file = join(root, 'backups', `commodity-place-${id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(row, null, 1));
console.log(`Backed up to ${file}`);
const { data: upd, error: e2 } = await db
  .from('crs_state')
  .update({ data: next, version: Number(row.version) + 1, updated_at: new Date().toISOString(), updated_by: 'admin' })
  .eq('scope', 'global').eq('store_key', '__commodityMaster').eq('version', row.version)
  .select('version');
if (e2) throw e2;
if (!upd?.length) { console.error('Refused: __commodityMaster changed since it was read. Nothing was written — run it again.'); process.exit(1); }
console.log(`WROTE __commodityMaster v${row.version} → v${upd[0].version}`);
const session = { userId: 1, username: 'admin', role: 'ADMIN', crsId: null, iat: Math.floor(Date.now() / 1000) };
await recordActivity(session, diffStateWrite({ __commodityMaster: row.data }, { __commodityMaster: next }, {}));
console.log('Activity logged.');
process.exit(0);
