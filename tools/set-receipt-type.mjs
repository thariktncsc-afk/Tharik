/**
 * Change a saved receipt's TYPE — Regular ↔ Advance — in the Receipt Register
 * (office, 2026-10-07: CRS 10's R/2026/087, 2 kg OAP FRK, was saved Advance;
 * its 2 kg were September's stock, sold 30-09, so COLL read −2).
 *
 *   node tools/set-receipt-type.mjs --crs=10 --receipt-no=R/2026/087 --type=regular          dry run
 *   … --write                                                                              apply
 *
 * The type matters to COLL alone (24-coll.js: an Advance receipt stays out of
 * its RECEIVED / CLOSING and prints in the ADVANCE table). Daily Entry, the
 * month and the chain count both types as stock received, so nothing else
 * moves — the tool proves it by rebuilding the receipt's month before and
 * after and refusing if any figure differs. Only that receipt's `type`
 * changes; receiptStore is backed up to backups/ and written under version;
 * the activity log gets the change.
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
const { buildChainIndex } = await imp('lib/engine/stockChain.ts');
const { diffStateWrite } = await imp('lib/activityLog/core.ts');
const { recordActivity } = await imp('lib/activityLog/server.ts');

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const crs = Number(arg('crs'));
const no = arg('receipt-no') ?? '';
const type = arg('type');
const write = process.argv.includes('--write');
if (!Number.isInteger(crs) || crs < 1 || crs > 30 || !no || (type !== 'regular' && type !== 'advance')) {
  console.error('Usage: node tools/set-receipt-type.mjs --crs=N --receipt-no=NO --type=regular|advance [--write]');
  process.exit(2);
}
const KEYS = ['receiptStore', 'entryStore', 'inspectionStore', 'meManualStore', '__commodityMaster'];
const { data, error } = await db.from('crs_state').select('store_key, data, version').eq('scope', 'global').in('store_key', KEYS);
if (error) throw error;
const rows = Object.fromEntries(data.map((r) => [r.store_key, r]));
const stored = Object.fromEntries(KEYS.map((k) => [k, rows[k]?.data ?? (k === 'receiptStore' ? [] : {})]));
const hits = stored.receiptStore.filter((r) => Number(r.crsId) === crs && r.receiptNo === no);
if (hits.length !== 1) { console.error(`Refused: CRS ${crs} has ${hits.length} receipts numbered ${no}.`); process.exit(1); }
const rec = hits[0];
const was = rec.type === 'advance' ? 'advance' : 'regular';
console.log(`CRS ${crs} · ${no} · ${rec.date} · ${JSON.stringify(rec.items)} · type ${was} → ${type}`);
if (was === type) { console.log('Already so — nothing to write.'); process.exit(0); }
const nextReceipts = stored.receiptStore.map((r) => (r === rec ? { ...r, type } : r));
// Nothing but COLL reads the type: the month and the chain must come out the same.
const [y, m] = rec.date.split('-').map(Number);
const lists = commodityListsFor(stored.__commodityMaster, crs);
const month = (rs) => JSON.stringify(rebuildMonthlyFromDaily(crs, m, y, stored.entryStore, stored.inspectionStore, stored.meManualStore[`${crs}_${m}_${y}`], lists, rs).merged);
const chain = (rs) => JSON.stringify(buildChainIndex(stored.entryStore, stored.inspectionStore, rs, crs).closes);
if (month(stored.receiptStore) !== month(nextReceipts) || chain(stored.receiptStore) !== chain(nextReceipts)) {
  console.error('Refused: the month or the chain would change — the type is not COLL\'s alone here.');
  process.exit(1);
}
console.log(`Month ${m}/${y} and the stock chain: identical before and after (only COLL reads the type).`);
if (!write) { console.log('DRY RUN — pass --write to apply.'); process.exit(0); }
mkdirSync(join(root, 'backups'), { recursive: true });
const file = join(root, 'backups', `receipt-type-crs${crs}-${no.replace(/[^\w-]/g, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ version: rows.receiptStore.version, receipt: rec }, null, 1));
console.log(`Backed up to ${file}`);
const { data: upd, error: e } = await db.from('crs_state').update({ data: nextReceipts, version: Number(rows.receiptStore.version) + 1, updated_at: new Date().toISOString(), updated_by: 'admin' })
  .eq('scope', 'global').eq('store_key', 'receiptStore').eq('version', rows.receiptStore.version).select('version');
if (e) throw e;
if (!upd?.length) { console.error('Refused: receiptStore changed since it was read. Nothing was written — run it again.'); process.exit(1); }
console.log(`WROTE receiptStore v${rows.receiptStore.version} → v${upd[0].version}`);
const session = { userId: 1, username: 'admin', role: 'ADMIN', crsId: null, iat: Math.floor(Date.now() / 1000) };
await recordActivity(session, diffStateWrite({ receiptStore: stored.receiptStore }, { receiptStore: nextReceipts }, {}));
console.log('Activity logged.');
process.exit(0);
