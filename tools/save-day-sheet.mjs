/**
 * Save ONE shop's day sheet from a paper statement — Daily Entry's own save,
 * run with the app's own functions on the live stores, as an administrator
 * acting on the office's instruction.
 *
 *   node tools/save-day-sheet.mjs --crs=19 --date=2026-09-29 \
 *     --sales=BRA:176,PHH_BRA:50,AAY:35,SUGAR:18.5,AAY_SUGAR:1.5,TOOR:13,PALM:13 \
 *     --remit=1200                                                       dry run
 *   … --write                                                            apply
 *
 * Only SALES and the deposit come from the paper. Everything else is what
 * Daily Entry works out (daily-entry/page.tsx `derive` / `save`):
 *   Opening  = the balance the chain carries in (buildChainIndex / openingFor)
 *   Receipt  = the Receipt Register's figure for that day (receiptQtyForDay)
 *   adj      = that date's inspection (excess / shortage / transfer)
 *   Total    = Opening + Receipt + excess − shortage − transfer
 *   Closing  = Total − Sales;  Amount = Sales × the master rate (free: 0)
 * A commodity not named sells 0. The deposit is one Non-Cereal deposit dated
 * --remit-date (default: the sheet's date); sheetTotals gives remitAmount etc.
 * Then, as the save does: the month's projection and Monthly Entry register
 * row are dropped, the month republished (rebuildMonthlyFromDaily), and the
 * chain rebuilt from the date forward (rechainAndRepublish).
 *
 * Before writing, the server's own guards are run on the result (stock guard,
 * CRS 29 rice guard) — refused writes are not sent. A date that already has
 * a sheet is refused (this tool adds a day; it does not replace one). Every
 * changed store is backed up to backups/ and written under its version; the
 * activity log gets the same rows /api/state would write (diffStateWrite),
 * and the shop's started-record is reconciled as after any landed save.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
// '@/' → src/, extension-less imports → .ts / .tsx / .js (what the bundler does).
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
const { receiptQtyForDay } = await imp('lib/engine/receiptRollup.ts');
const { sheetTotals, newRemitId } = await imp('lib/engine/remittance.ts');
const { dropProjectedSheet, dropProjectedAdjustments } = await imp('lib/engine/monthProjection.ts');
const { dropMonthlyReceipt } = await imp('lib/engine/monthlyReceipt.ts');
const { rebuildMonthlyFromDaily } = await imp('lib/engine/monthlyRollup.ts');
const { rechainAndRepublish } = await imp('lib/engine/rechain.ts');
const { inspectStockWrite, describeStock } = await imp('lib/stockGuard.ts');
const { inspectRiceWrite, describeRice } = await imp('lib/engine/crs29Rice.ts');
const { diffStateWrite } = await imp('lib/activityLog/core.ts');
const { recordActivity } = await imp('lib/activityLog/server.ts');
const { reconcileShops } = await imp('lib/stockInitServer.ts');

const STORES = ['entryStore', 'inspectionStore', 'receiptStore', 'meManualStore', 'meSourceStore', 'monthlyStore', '__commodityMaster', '__stockInit'];
const WRITABLE = ['entryStore', 'inspectionStore', 'receiptStore', 'meSourceStore', 'monthlyStore'];
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const clone = (v) => JSON.parse(JSON.stringify(v));

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const crsId = Number(arg('crs'));
  const date = arg('date') ?? '';
  const remit = arg('remit') !== undefined ? Number(arg('remit')) : null;
  const remitDate = arg('remit-date') ?? date;
  const write = process.argv.includes('--write');
  const sales = {};
  for (const part of (arg('sales') ?? '').split(',').filter(Boolean)) {
    const [id, v] = part.split(':');
    sales[id] = Number(v);
  }
  if (!Number.isInteger(crsId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(remitDate) || Object.values(sales).some((v) => !Number.isFinite(v) || v < 0) || (remit !== null && !(remit > 0))) {
    console.error('Usage: node tools/save-day-sheet.mjs --crs=<n> --date=YYYY-MM-DD --sales=ID:qty,… [--remit=<amount>] [--remit-date=YYYY-MM-DD] [--write]');
    return 2;
  }
  const key = `${crsId}_${date}`;
  const [y, m] = date.split('-').map(Number);

  const { data, error } = await db.from('crs_state').select('store_key,data,version').eq('scope', 'global').in('store_key', STORES);
  if (error) throw error;
  const stored = Object.fromEntries(data.map((r) => [r.store_key, r.data]));
  const versions = Object.fromEntries(data.map((r) => [r.store_key, r.version]));
  if (stored.entryStore[key]) {
    console.error(`Refused: ${key} already has a day sheet — this tool adds a day, it does not replace one.`);
    return 1;
  }
  const lists = commodityListsFor(stored.__commodityMaster ?? null, crsId);
  const unknown = Object.keys(sales).filter((id) => ![...lists.a, ...lists.b].some((c) => c.id === id));
  if (unknown.length) {
    console.error(`Refused: not on CRS ${crsId}'s Daily Entry: ${unknown.join(', ')}`);
    return 1;
  }

  // ── The day sheet, as derive() / save() build it ─────────────────────────
  const chain = buildChainIndex(stored.entryStore, stored.inspectionStore, stored.receiptStore, crsId);
  const dayReceipts = receiptQtyForDay(stored.receiptStore, crsId, date);
  const insp = stored.inspectionStore?.[key];
  const snap = { a: {}, b: {} };
  const shown = [];
  for (const [sec, comms] of [['a', lists.a], ['b', lists.b]]) {
    for (const c of comms) {
      const auto = openingFor(chain, date, c.id, sec).value;
      const open = auto === null ? 0 : auto; // an administrator's untouched Opening: the carry
      const receipt = dayReceipts[c.id] || 0;
      const r = insp?.[sec]?.[c.id] ?? {};
      const adj = { excess: Number(r.excess) || 0, shortage: Number(r.shortage) || 0, transfer: Number(r.transfer) || 0 };
      const s = sales[c.id] ?? 0;
      const total = open + receipt + adj.excess - adj.shortage - adj.transfer;
      const close = total - s;
      const amount = c.free ? 0 : s * c.rate;
      snap[sec][c.id] = { open, receipt, total, sales: s, close, amount, ...adj };
      if (s || receipt || adj.excess || adj.shortage || adj.transfer) shown.push({ id: c.id, en: c.en, open, receipt, total, sales: s, close, rate: c.free ? 'free' : c.rate, amount });
    }
  }
  const remits = remit === null ? [] : [{ id: newRemitId(), amount: remit, date: remitDate, account: 'nc', createdBy: 'admin', createdAt: new Date().toISOString() }];
  snap.remits = remits;
  Object.assign(snap, sheetTotals(remits));

  // ── What the save then does to the stores ────────────────────────────────
  const next = Object.fromEntries(WRITABLE.map((k) => [k, clone(stored[k] ?? (k === 'receiptStore' ? [] : {}))]));
  next.entryStore[key] = snap;
  const tookOver = dropProjectedSheet(next.entryStore, crsId, m, y);
  dropProjectedAdjustments(next.inspectionStore, crsId, m, y);
  const drop = dropMonthlyReceipt(next.receiptStore, crsId, m, y);
  if (drop.dropped) next.receiptStore = drop.rows;
  const month = rebuildMonthlyFromDaily(crsId, m, y, next.entryStore, next.inspectionStore, stored.meManualStore?.[`${crsId}_${m}_${y}`], lists, next.receiptStore);
  next.monthlyStore[`${crsId}_${m}_${y}`] = month.merged;
  next.meSourceStore[`${crsId}_${m}_${y}`] = month.source;
  const chained = rechainAndRepublish({ ...next, meManualStore: stored.meManualStore }, crsId, date, lists);
  for (const [k, v] of Object.entries(chained.patch)) next[k] = v;

  console.log(`CRS ${crsId} · ${date} · new day sheet (${[...lists.a, ...lists.b].length} commodities)`);
  for (const r of shown) console.log(`  ${r.en.padEnd(18)} OB ${r.open}  + Rcp ${r.receipt}  = Total ${r.total}  − Sales ${r.sales}  = CB ${+r.close.toFixed(3)}   ${r.rate === 'free' ? 'free' : `@ ${r.rate} = ₹${r.amount.toFixed(2)}`}`);
  const amt = Object.values(snap.a).concat(Object.values(snap.b)).reduce((t, r) => t + (r.amount || 0), 0);
  console.log(`  Sales amount ₹${amt.toFixed(2)} · deposit ${remits.length ? `₹${remit.toFixed(2)} dated ${remitDate} (Non-Cereal)` : 'none'}`);
  const neg = shown.filter((r) => r.close < -0.0005);
  if (neg.length) console.log(`  ⚠ closes below zero: ${neg.map((r) => `${r.id} ${r.close}`).join(', ')}`);
  console.log(`  projection dropped: ${tookOver} · Monthly register row dropped: ${!!drop.dropped} · chain rebuilt on: ${chained.dates.join(', ') || 'no later day'}`);

  const changed = WRITABLE.filter((k) => canon(next[k]) !== canon(stored[k] ?? (k === 'receiptStore' ? [] : {})));
  // Only this shop may move.
  for (const k of changed) {
    const before = stored[k] ?? {}, after = next[k];
    if (Array.isArray(after)) continue;
    const moved = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((x) => canon(before[x]) !== canon(after[x]));
    const other = moved.filter((x) => !x.startsWith(`${crsId}_`));
    if (other.length) { console.error(`Refused: ${k} would change another shop's ${other.join(', ')}`); return 1; }
    console.log(`  ${k}: ${moved.join(', ')}`);
  }

  // ── The server's own guards, on exactly what would be sent ───────────────
  const incoming = Object.fromEntries(changed.map((k) => [k, next[k]]));
  const broken = inspectStockWrite(stored, incoming, true);
  if (broken.length) { console.error(`Refused by the stock guard: ${describeStock(broken)}`); return 1; }
  const rice = inspectRiceWrite(stored, incoming);
  if (rice.length) { console.error(`Refused by the CRS 29 rice guard: ${describeRice(rice)}`); return 1; }
  console.log('  server guards: stock ✓ · CRS 29 rice ✓');

  if (!write) {
    console.log('DRY RUN — pass --write to apply.');
    return 0;
  }
  mkdirSync(join(root, 'backups'), { recursive: true });
  const file = join(root, 'backups', `day-sheet-${key}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ key, sales, remit, remitDate, versions, before: Object.fromEntries(changed.map((k) => [k, stored[k]])) }, null, 1));
  console.log(`Backed up ${changed.join(', ')} to ${file}`);
  // The day sheet first; the month and anything else after, as the save sends them.
  const order = ['entryStore', ...changed.filter((k) => k !== 'entryStore')].filter((k) => changed.includes(k));
  const landed = {};
  for (const k of order) {
    const { data: upd, error: e } = await db
      .from('crs_state')
      .update({ data: next[k], version: Number(versions[k]) + 1, updated_at: new Date().toISOString(), updated_by: 'admin' })
      .eq('scope', 'global').eq('store_key', k).eq('version', versions[k]).select('version');
    if (e) throw e;
    if (!upd?.length) { console.error(`Refused: ${k} changed since it was read. Written so far: ${Object.keys(landed).join(', ') || 'nothing'} — run it again after checking.`); return 1; }
    landed[k] = next[k];
    console.log(`WROTE ${k} v${versions[k]} → v${upd[0].version}`);
  }
  const session = { userId: 1, username: 'admin', role: 'ADMIN', crsId: null, iat: Math.floor(Date.now() / 1000) };
  await recordActivity(session, diffStateWrite(stored, landed, { entryStore: { [key]: 'edited' } }));
  await reconcileShops([crsId], 'admin');
  console.log(`Done: CRS ${crsId} ${date} saved — activity logged, started-record reconciled.`);
  return 0;
}
// Returned, not process.exit(): exiting while the database socket closes trips a
// libuv assertion on Windows (exit 127) even when all went well.
process.exitCode = await main();
