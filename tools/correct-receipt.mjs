/**
 * Move a saved Receipt Register line to the commodity it belongs to — an
 * administrator's correction on the Receipt page, for one receipt of one shop.
 *
 *   node tools/correct-receipt.mjs --crs=14 --receipt-no=S184606559 --move=PHH_BRA:PHH_FRK,AAY:AAY_FRK            dry run
 *   node tools/correct-receipt.mjs --crs=14 --receipt-no=S184606559 --move=PHH_BRA:PHH_FRK,AAY:AAY_FRK --write    apply
 *
 * Each FROM:TO takes the line's quantity off FROM and puts the same quantity
 * on TO — nothing is added or lost, the receipt's date, number, type and every
 * other line stay as they are. Then, exactly as the Receipt page's
 * republishMonth: the day sheet takes the figure where it has one
 * (resyncReceiptMonth), the month republishes, the chain is rebuilt from the
 * receipt's date (rechainAndRepublish) and the Gunny Stock copies follow.
 *
 * Refused, with nothing written: a receipt number the shop's register does
 * not hold exactly once, a FROM the receipt does not carry, a TO it already
 * carries or that is not on the shop's Receipt list, any change to another
 * shop's keys or another receipt, or the server's stock guard. Stores are
 * backed up to backups/, written under their version, and the activity log
 * gets diffStateWrite's rows. A re-run finds nothing to move.
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
const { resyncReceiptMonth } = await imp('lib/engine/receiptSync.ts');
const { rechainAndRepublish } = await imp('lib/engine/rechain.ts');
const { packTypesFor, PACK_SWITCHABLE } = await imp('lib/engine/gunnyPack.ts');
const { refreshGunnyMonths } = await imp('app/(app)/monthly-entry/lib.ts');
const { inspectStockWrite, describeStock } = await imp('lib/stockGuard.ts');
const { diffStateWrite } = await imp('lib/activityLog/core.ts');
const { recordActivity } = await imp('lib/activityLog/server.ts');
const { reconcileShops } = await imp('lib/stockInitServer.ts');

const STORES = ['entryStore', 'inspectionStore', 'receiptStore', 'meManualStore', 'meSourceStore', 'monthlyStore', 'meGunnyStore', '__commodityMaster', '__stockInit'];
const WRITABLE = ['receiptStore', 'entryStore', 'meManualStore', 'meSourceStore', 'monthlyStore', 'meGunnyStore'];
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const clone = (v) => JSON.parse(JSON.stringify(v));

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const write = process.argv.includes('--write');
  const crsId = Number(arg('crs'));
  const receiptNo = arg('receipt-no');
  const moves = (arg('move') ?? '').split(',').filter(Boolean).map((p) => p.split(':'));
  if (!Number.isInteger(crsId) || !receiptNo || !moves.length || moves.some((m) => m.length !== 2 || !m[0] || !m[1])) {
    console.error('Usage: node tools/correct-receipt.mjs --crs=N --receipt-no=NO --move=FROM:TO[,FROM:TO…] [--write]');
    return 2;
  }

  const { data, error } = await db.from('crs_state').select('store_key,data,version').eq('scope', 'global').in('store_key', STORES);
  if (error) throw error;
  const stored = Object.fromEntries(data.map((r) => [r.store_key, r.data]));
  const versions = Object.fromEntries(data.map((r) => [r.store_key, r.version]));
  const lists = commodityListsFor(stored.__commodityMaster ?? null, crsId);
  const onList = new Set([...lists.a, ...lists.b].map((c) => c.id).filter((id) => id !== 'EMPTY_BOX' && id !== 'EMPTY_BAG'));

  const register0 = stored.receiptStore ?? [];
  const at = register0.map((r, i) => [r, i]).filter(([r]) => Number(r.crsId) === crsId && r.receiptNo === receiptNo);
  if (at.length !== 1) { console.error(`Refused: CRS ${crsId}'s register holds ${receiptNo} ${at.length} times — expected exactly once.`); return 1; }
  const [row, idx] = at[0];
  const problems = [];
  const froms = new Set(), tos = new Set();
  for (const [from, to] of moves) {
    if (!row.items?.[from]) problems.push(`${receiptNo} carries no ${from} line`);
    if (row.items?.[to] && !moves.some(([f]) => f === to)) problems.push(`${receiptNo} already carries ${to} (${row.items[to].qty}) — a move would merge two lines`);
    if (!onList.has(to)) problems.push(`${to} is not on CRS ${crsId}'s Receipt list`);
    if (froms.has(from) || tos.has(to)) problems.push(`${from}:${to} repeats a commodity`);
    froms.add(from); tos.add(to);
  }
  if (problems.length) { console.error('Refused:\n  ' + problems.join('\n  ')); return 1; }

  // The receipt, lines moved; a switchable line keeps / takes the Receipt page's Gunny / Poly shape.
  const items = { ...row.items };
  for (const [from] of moves) delete items[from];
  for (const [from, to] of moves) {
    const qty = Number(row.items[from].qty);
    items[to] = PACK_SWITCHABLE.has(to) ? { qty, pack: row.items[from].pack === 'POLY' ? 'POLY' : 'GUNNY' } : { qty };
  }
  const fixed = { ...row, items };
  const next = Object.fromEntries(WRITABLE.map((k) => [k, clone(stored[k] ?? (k === 'receiptStore' ? [] : {}))]));
  const before = clone(next.receiptStore);
  next.receiptStore[idx] = fixed;
  const [y, m] = row.date.split('-').map(Number);
  const patch = resyncReceiptMonth({ ...next, inspectionStore: stored.inspectionStore ?? {} }, crsId, m, y, { dateIso: row.date, before, lists });
  for (const [k, v] of Object.entries(patch)) next[k] = v;
  const chained = rechainAndRepublish({ ...next, inspectionStore: stored.inspectionStore ?? {} }, crsId, row.date, lists);
  for (const [k, v] of Object.entries(chained.patch)) next[k] = v;
  for (const ym of [...new Set([row.date, ...chained.dates].map((d) => d.slice(0, 7)))].sort()) {
    const [yy, mm] = ym.split('-').map(Number);
    const g = refreshGunnyMonths(next.meGunnyStore, crsId, mm, yy, next.monthlyStore, (mo, yr) => packTypesFor(next.receiptStore, crsId, mo, yr));
    if (g) next.meGunnyStore = g;
  }
  console.log(`  ${receiptNo} · ${row.date} · ${String(row.type ?? 'regular').toUpperCase()} · ${moves.map(([f, t]) => `${f} ${row.items[f].qty} → ${t}`).join(', ')}`);

  const changed = WRITABLE.filter((k) => canon(next[k]) !== canon(stored[k] ?? (k === 'receiptStore' ? [] : {})));
  for (const k of changed) {
    const b = stored[k] ?? {}, a = next[k];
    if (k === 'receiptStore') {
      const other = a.map((r, i) => [r, i]).filter(([r, i]) => i !== idx && canon(r) !== canon(b[i]));
      if (a.length !== b.length || other.length) { console.error('Refused: receiptStore would change a row other than the one being corrected'); return 1; }
      continue;
    }
    const moved = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((x) => canon(b[x]) !== canon(a[x]));
    const other = moved.filter((x) => !x.startsWith(`${crsId}_`));
    if (other.length) { console.error(`Refused: ${k} would change another shop's ${other.join(', ')}`); return 1; }
    console.log(`  ${k}: ${moved.join(', ')}`);
  }
  if (!changed.length) { console.log('Already corrected — nothing to write.'); return 0; }
  const incoming = Object.fromEntries(changed.map((k) => [k, next[k]]));
  const broken = inspectStockWrite(stored, incoming, true);
  if (broken.length) { console.error(`Refused by the stock guard: ${describeStock(broken)}`); return 1; }
  const key = `${crsId}_${m}_${y}`, pa = stored.monthlyStore?.[key]?.a ?? {}, na = next.monthlyStore?.[key]?.a ?? {};
  for (const id of new Set(moves.flat())) console.log(`  ${key} ${id.padEnd(10)} Receipt ${pa[id]?.receipt ?? 0} → ${na[id]?.receipt ?? 0} · Closing ${pa[id]?.close ?? 0} → ${na[id]?.close ?? 0}`);
  console.log('  stock guard ✓');
  if (!write) { console.log('DRY RUN — pass --write to apply.'); return 0; }

  mkdirSync(join(root, 'backups'), { recursive: true });
  const bk = join(root, 'backups', `correct-receipt-crs${crsId}-${receiptNo.replace(/[^\w-]/g, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(bk, JSON.stringify({ crsId, receiptNo, moves, versions, before: Object.fromEntries(changed.map((k) => [k, stored[k]])) }, null, 1));
  console.log(`Backed up ${changed.join(', ')} to ${bk}`);
  const landed = {};
  for (const k of ['receiptStore', ...changed.filter((x) => x !== 'receiptStore')].filter((x) => changed.includes(x))) {
    const { data: upd, error: e } = await db.from('crs_state')
      .update({ data: next[k], version: Number(versions[k]) + 1, updated_at: new Date().toISOString(), updated_by: 'admin' })
      .eq('scope', 'global').eq('store_key', k).eq('version', versions[k]).select('version');
    if (e) throw e;
    if (!upd?.length) { console.error(`Refused: ${k} changed since it was read. Written so far: ${Object.keys(landed).join(', ') || 'nothing'} — check, then run it again.`); return 1; }
    landed[k] = next[k];
    console.log(`WROTE ${k} v${versions[k]} → v${upd[0].version}`);
  }
  const session = { userId: 1, username: 'admin', role: 'ADMIN', crsId: null, iat: Math.floor(Date.now() / 1000) };
  await recordActivity(session, diffStateWrite(stored, landed, {}));
  await reconcileShops([crsId], 'admin');
  console.log(`Done: ${receiptNo} corrected for CRS ${crsId} — activity logged.`);
  return 0;
}
process.exitCode = await main();
