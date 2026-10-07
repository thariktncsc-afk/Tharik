/**
 * Save a "from Daily" row's BAG counts for one shop-month — what typing into
 * Monthly Sales' Opening / Receipt / Sales bag boxes and pressing Save does
 * (meManualStore[key].dailyBags; monthlyRollup.ts withDailyBags), office
 * 2026-10-07 — then republish that month and the shop's later months with
 * the shop's OWN commodity lists, as the app's save does.
 *
 *   node tools/set-month-bags.mjs --crs=10 --month=9 --year=2026 --id=OAP_FRK --receipt=2 --sales=2          dry run
 *   node tools/set-month-bags.mjs --crs=10 --month=9 --year=2026 --id=OAP_FRK --receipt=2 --sales=2 --write  apply
 *
 * A count is kept only where it differs from kgs ÷ pack size (a typed 0
 * included), exactly as Monthly Sales keeps it; typed back to that figure,
 * it is dropped and the box follows its kgs again. Total = Opening +
 * Receipt and Closing = Total − Sales follow. The kgs are never touched.
 * Only this shop's keys change; backed up to backups/; written under
 * version; the activity log gets the change.
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
const { bagsOf } = await imp('lib/engine/commodities.ts');
const { monthBags, carriedBagsFor } = await imp('lib/engine/bagChain.ts');
const { diffStateWrite } = await imp('lib/activityLog/core.ts');
const { recordActivity } = await imp('lib/activityLog/server.ts');

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const crs = Number(arg('crs')), month = Number(arg('month')), year = Number(arg('year')), id = arg('id');
const want = {};
for (const f of ['receipt', 'sales']) if (arg(f) !== undefined) want[f] = Number(arg(f));
const write = process.argv.includes('--write');
if (!Number.isInteger(crs) || crs < 1 || crs > 30 || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || !id || !Object.keys(want).length || Object.values(want).some((n) => !Number.isInteger(n) || n < 0)) {
  console.error('Usage: node tools/set-month-bags.mjs --crs=N --month=M --year=Y --id=ID [--receipt=n] [--sales=n] [--write]');
  process.exit(2);
}

const KEYS = ['entryStore', 'inspectionStore', 'receiptStore', 'meManualStore', 'meSourceStore', 'monthlyStore', '__commodityMaster'];
const WRITABLE = ['meManualStore', 'meSourceStore', 'monthlyStore'];
const { data, error } = await db.from('crs_state').select('store_key, data, version').eq('scope', 'global').in('store_key', KEYS);
if (error) throw error;
const rows = Object.fromEntries(data.map((r) => [r.store_key, r]));
const stored = Object.fromEntries(KEYS.map((k) => [k, rows[k]?.data ?? (k === 'receiptStore' ? [] : {})]));
const next = JSON.parse(JSON.stringify(stored));
const lists = commodityListsFor(stored.__commodityMaster, crs);
const sec = lists.a.some((c) => c.id === id) ? 'a' : lists.b.some((c) => c.id === id) ? 'b' : null;
if (!sec) { console.error(`${id} is not on CRS ${crs}'s list.`); process.exit(1); }
const key = `${crs}_${month}_${year}`;
const publish = (k, m, y) => {
  const r = rebuildMonthlyFromDaily(crs, m, y, next.entryStore, next.inspectionStore, next.meManualStore[k], lists, next.receiptStore);
  next.monthlyStore[k] = r.merged;
  next.meSourceStore[k] = r.source;
  return r;
};
// The month as it is, from the day sheets, with the shop's own list.
const before = publish(key, month, year);
if (before.source?.[sec]?.[id] !== 'daily') { console.error(`${id} is not a "from Daily" row in ${key} (source ${before.source?.[sec]?.[id]}) — key its bags on Monthly Sales.`); process.exit(1); }
const kg = before.merged[sec][id];
const rec = JSON.parse(JSON.stringify(next.meManualStore[key] ?? { a: {}, b: {} }));
const bags = { ...(rec.dailyBags?.[sec]?.[id] ?? {}) };
for (const [f, n] of Object.entries(want)) {
  const auto = bagsOf(Number(kg[f]) || 0, id);
  if (n !== auto) bags[`g_${f}`] = n; else delete bags[`g_${f}`];
  console.log(`${key} ${sec}:${id} ${f}: ${f === 'receipt' ? kg.receipt : kg.sales} kg → kgs ÷ pack = ${auto}; typed ${n}${n !== auto ? ' (kept)' : ' (= kgs ÷ pack, follows the kgs)'}`);
}
rec.dailyBags = { ...(rec.dailyBags ?? {}) };
rec.dailyBags[sec] = { ...(rec.dailyBags[sec] ?? {}) };
if (Object.keys(bags).length) rec.dailyBags[sec][id] = bags; else delete rec.dailyBags[sec][id];
if (!Object.keys(rec.dailyBags[sec]).length) delete rec.dailyBags[sec];
if (!Object.keys(rec.dailyBags).length) delete rec.dailyBags;
next.meManualStore[key] = rec;
// This month and the shop's later months, with the shop's own list.
const later = Object.keys(next.monthlyStore).filter((k) => k.startsWith(`${crs}_`)).map((k) => k.split('_').map(Number)).filter(([, m, y]) => y * 12 + m >= year * 12 + month).sort((a, b) => a[2] * 12 + a[1] - (b[2] * 12 + b[1]));
for (const [, m, y] of later) publish(`${crs}_${m}_${y}`, m, y);
for (const [, m, y] of later) {
  const k = `${crs}_${m}_${y}`;
  const r = next.monthlyStore[k]?.[sec]?.[id];
  const b = monthBags(next, crs, m, y, lists, carriedBagsFor(next, crs, m, y, lists))[sec]?.[id];
  console.log(`  ${k} ${id}: kgs ${r ? `${r.open} + ${r.receipt} = ${r.total} − ${r.sales} = ${r.close}` : 'no row'} · bags ${b ? `${b.open} + ${b.receipt} = ${b.total} − ${b.sales} = ${b.close}` : 'none'}`);
}
// Which rows of the republished months move — the commodity asked for, and any other (shown, so nothing moves unseen).
for (const [, m, y] of later) {
  const k = `${crs}_${m}_${y}`;
  for (const s of ['a', 'b']) {
    const ids = new Set([...Object.keys(stored.monthlyStore[k]?.[s] ?? {}), ...Object.keys(next.monthlyStore[k]?.[s] ?? {})]);
    const a = (x) => stored.monthlyStore[k]?.[s]?.[x] ?? {};
    const b = (x) => next.monthlyStore[k]?.[s]?.[x] ?? {};
    for (const x of ids) {
      const fields = [...new Set([...Object.keys(a(x)), ...Object.keys(b(x))])].filter((f) => JSON.stringify(a(x)[f]) !== JSON.stringify(b(x)[f]));
      if (fields.length) console.log(`  ${k} ${s}:${x} — ${fields.map((f) => `${f} ${JSON.stringify(a(x)[f])} → ${JSON.stringify(b(x)[f])}`).join(', ')}`);
    }
  }
}
const changed = WRITABLE.filter((k) => JSON.stringify(next[k]) !== JSON.stringify(stored[k]));
const foreign = changed.flatMap((k) => Object.keys(next[k]).filter((x) => JSON.stringify(next[k][x]) !== JSON.stringify(stored[k][x]) && !x.startsWith(`${crs}_`)));
if (foreign.length) { console.error(`Refused: other shops' keys would change: ${foreign.join(', ')}`); process.exit(1); }
console.log(`Stores to write: ${changed.join(', ') || 'none'}`);
if (!changed.length) { console.log('Already so — nothing to write.'); process.exit(0); }
if (!write) { console.log('DRY RUN — pass --write to apply.'); process.exit(0); }

mkdirSync(join(root, 'backups'), { recursive: true });
const file = join(root, 'backups', `month-bags-${key}-${id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify(Object.fromEntries(changed.map((k) => [k, { version: rows[k]?.version, data: stored[k] }])), null, 1));
console.log(`Backed up to ${file}`);
const landed = {};
for (const k of changed) {
  const { data: upd, error: e } = await db.from('crs_state').update({ data: next[k], version: Number(rows[k].version) + 1, updated_at: new Date().toISOString(), updated_by: 'admin' })
    .eq('scope', 'global').eq('store_key', k).eq('version', rows[k].version).select('version');
  if (e) throw e;
  if (!upd?.length) { console.error(`Refused: ${k} changed since it was read. Written so far: ${Object.keys(landed).join(', ') || 'nothing'}.`); process.exit(1); }
  landed[k] = next[k];
  console.log(`WROTE ${k} v${rows[k].version} → v${upd[0].version}`);
}
const session = { userId: 1, username: 'admin', role: 'ADMIN', crsId: null, iat: Math.floor(Date.now() / 1000) };
await recordActivity(session, diffStateWrite(stored, landed, { meManualStore: { [key]: 'edited' } }));
console.log('Activity logged.');
process.exit(0);
