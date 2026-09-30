/**
 * Monthly Entry's month-close (💾 மாத விற்பனை நிறைவு), run as an administrator
 * on the office's instruction, for a month keyed BY MONTH — the figures read
 * off a shop's POS stock summary ("பொருட்கள் இருப்பு நிலவரச் சுருக்கம்").
 *
 *   node tools/close-month.mjs --crs=14 --month=9 --year=2026 --sales=BRA:10892,… [--shortage=BRA:25,…] [--expect=BRA:-7917,…]            dry run
 *   … --write                                                                                                                          apply
 *
 * Only SALES (and the month's Inspection shortages) come from the paper.
 * Everything else is what the screen has: Opening as the month holds it
 * (carried, or the administrator's own), Receipt
 * from the Receipt Register (key receipts with add-receipts.mjs first), Total,
 * Closing and Amount (master rate) worked out as Monthly Entry's rowFor does.
 *
 * Then exactly what the month-close does (monthly-entry/page.tsx save()):
 *   · meManualStore[key] = the month's hand-keyed rows;
 *   · the shortages as the month's Inspection (inspectionStore on the last
 *     calendar day — Monthly Inspection's record);
 *   · the month written out as ONE projected day sheet on the last calendar
 *     day (buildProjectedSheet, __projection), with the manual rows'
 *     adjustments carried across (applyProjectedAdjustments) — so the DSS and
 *     the date-wise statements have the month to print, once;
 *   · the month republished, the chain rebuilt from the 1st, Gunny refreshed.
 *
 *   --open=ID:qty,…   an administrator's Opening on the month's rows — what
 *        typing into Monthly Entry's Opening box does (a shop's opening
 *        stock, read off the POS's ஆரம்ப இருப்பு). Rows not named keep theirs.
 *        Sales not given on a run keep the month's stored Sales, so an
 *        Opening can be set on a month already closed.
 *   --gunny-open=ss50:n,poly:n,cbox:n   the month's Gunny Stock Opening as an
 *        administrator types it (openingAuto false).
 *
 * Refused, with nothing written: a month that has REAL day sheets (it is
 * keyed by day — use save-day-sheet.mjs), a commodity not on the shop's
 * sales grid, a quantity below 0, a shortage on police ration, CRS 29 (its
 * sheet needs Free / Cost Rice), a Receipt the register does not hold, any
 * change to another shop's keys, any --expect Closing that differs, or the
 * server's stock guard. Stores backed up to backups/, written under version,
 * activity logged, started-record reconciled. A re-run with the same figures
 * writes nothing.
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
const { bagsOf } = await imp('lib/engine/commodities.ts');
const { rebuildMonthlyFromDaily } = await imp('lib/engine/monthlyRollup.ts');
const { realSheetDates, buildProjectedSheet, applyProjectedAdjustments, projectionKey, lastDayOfMonth } = await imp('lib/engine/monthProjection.ts');
const { keyedReceiptTotals } = await imp('lib/engine/monthlyReceipt.ts');
const { rechainAndRepublish } = await imp('lib/engine/rechain.ts');
const { packTypesFor } = await imp('lib/engine/gunnyPack.ts');
const { refreshGunnyMonths, NO_GUNNY } = await imp('app/(app)/monthly-entry/lib.ts');
const { inspectStockWrite, describeStock } = await imp('lib/stockGuard.ts');
const { diffStateWrite } = await imp('lib/activityLog/core.ts');
const { recordActivity } = await imp('lib/activityLog/server.ts');
const { reconcileShops } = await imp('lib/stockInitServer.ts');

const STORES = ['entryStore', 'inspectionStore', 'receiptStore', 'meManualStore', 'meSourceStore', 'monthlyStore', 'meGunnyStore', '__commodityMaster', '__stockInit'];
const WRITABLE = ['entryStore', 'inspectionStore', 'meManualStore', 'meSourceStore', 'monthlyStore', 'meGunnyStore'];
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const clone = (v) => JSON.parse(JSON.stringify(v));
const r3 = (n) => Math.round(n * 1000) / 1000;
// Figures only: when a record was written is not what it says.
const figures = (v) => canon(v).replace(/"(updatedAt|at)":"[^"]*",?/g, '');

async function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const pairs = (name) => Object.fromEntries((arg(name) ?? '').split(',').filter(Boolean).map((p) => { const [id, v] = p.split(':'); return [id, Number(v)]; }));
  const write = process.argv.includes('--write');
  const crsId = Number(arg('crs')), month = Number(arg('month')), year = Number(arg('year'));
  const sales = pairs('sales'), shortage = pairs('shortage'), expect = pairs('expect'), opens = pairs('open'), gunnyOpen = pairs('gunny-open');
  if (!Number.isInteger(crsId) || !(month >= 1 && month <= 12) || !(year >= 2020) || !(Object.keys(sales).length || Object.keys(opens).length || Object.keys(gunnyOpen).length)) {
    console.error('Usage: node tools/close-month.mjs --crs=N --month=M --year=Y [--sales=ID:qty,…] [--open=ID:qty,…] [--gunny-open=ss50:n,…] [--shortage=ID:qty,…] [--expect=ID:closing,…] [--write]');
    return 2;
  }
  if (crsId === 29) { console.error('Refused: CRS 29\'s last-day sheet needs Free / Cost Rice — close it on Monthly Entry.'); return 1; }
  if ([sales, shortage, expect, opens, gunnyOpen].some((o) => Object.values(o).some((v) => !Number.isFinite(v))) || [sales, shortage, opens, gunnyOpen].some((o) => Object.values(o).some((v) => v < 0))) {
    console.error('Refused: quantities must be numbers, 0 or more.'); return 1;
  }
  if (Object.keys(gunnyOpen).some((k) => !['ss50', 'poly', 'cbox'].includes(k))) { console.error('Refused: --gunny-open items are ss50 / poly / cbox.'); return 1; }

  const { data, error } = await db.from('crs_state').select('store_key,data,version').eq('scope', 'global').in('store_key', STORES);
  if (error) throw error;
  const stored = Object.fromEntries(data.map((r) => [r.store_key, r.data]));
  const versions = Object.fromEntries(data.map((r) => [r.store_key, r.version]));
  const lists = commodityListsFor(stored.__commodityMaster ?? null, crsId);
  const all = [...lists.a.map((c) => ['a', c]), ...lists.b.map((c) => ['b', c])];
  const secOf = Object.fromEntries(all.map(([s, c]) => [c.id, s]));
  const unknown = [...new Set([...Object.keys(sales), ...Object.keys(shortage), ...Object.keys(expect), ...Object.keys(opens)])].filter((id) => !secOf[id]);
  if (unknown.length) { console.error(`Refused: not on CRS ${crsId}'s sales grid: ${unknown.join(', ')}`); return 1; }
  const police = Object.keys(shortage).filter((id) => secOf[id] === 'b');
  if (police.length) { console.error(`Refused: police ration has no shortage: ${police.join(', ')}`); return 1; }
  const byDay = realSheetDates(stored.entryStore ?? {}, crsId, month, year);
  if (byDay.length) { console.error(`Refused: ${month}/${year} is keyed by day (${byDay.length} day sheets) — use save-day-sheet.mjs.`); return 1; }

  const key = `${crsId}_${month}_${year}`;
  const last = lastDayOfMonth(month, year);
  const next = Object.fromEntries(WRITABLE.map((k) => [k, clone(stored[k] ?? {})]));

  // The month's Inspection — Monthly Inspection's record, the last calendar day (a real record, not a projection).
  if (Object.keys(shortage).length) {
    const ik = `${crsId}_${last}`;
    const rec = { a: { ...(next.inspectionStore[ik]?.a ?? {}) }, b: { ...(next.inspectionStore[ik]?.b ?? {}) } };
    for (const [id, q] of Object.entries(shortage)) {
      const { __projection: _p, ...prev } = rec.a[id] ?? {};
      rec.a[id] = { ...prev, shortage: q };
    }
    next.inspectionStore[ik] = rec;
  }
  // Adjustments summed over the month, as rowFor's inspMonth.
  const inspMonth = {};
  for (const [k, day] of Object.entries(next.inspectionStore)) {
    if (!k.startsWith(`${crsId}_${year}-${String(month).padStart(2, '0')}-`)) continue;
    for (const sec of ['a', 'b']) for (const [id, r] of Object.entries(day?.[sec] ?? {})) {
      if (r?.__projection) continue;
      const t = (inspMonth[`${sec}:${id}`] ??= { excess: 0, shortage: 0, transfer: 0 });
      t.excess += Number(r.excess) || 0; t.shortage += Number(r.shortage) || 0; t.transfer += Number(r.transfer) || 0;
    }
  }

  // The screen as it stands (rowFor): each row's Opening and Receipt as the month holds them, the paper's Sales.
  const { merged, source } = rebuildMonthlyFromDaily(crsId, month, year, next.entryStore, next.inspectionStore, next.meManualStore[key], lists, next.receiptStore ?? stored.receiptStore);
  const register = keyedReceiptTotals(stored.receiptStore, crsId, month, year);
  const manual = { a: {}, b: {} };
  const whole = { a: {}, b: {} };
  const shown = [];
  for (const [sec, c] of all) {
    const rec = merged[sec][c.id];
    if (source[sec][c.id] === 'daily') { console.error(`Refused: ${c.id} is from Daily`); return 1; }
    const open = opens[c.id] ?? (Number(rec?.open) || 0);
    const receipt = Number(rec?.receipt) || 0;
    const s = sales[c.id] ?? (Number(rec?.sales) || 0);
    let adj = inspMonth[`${sec}:${c.id}`] ?? { excess: 0, shortage: 0, transfer: 0 };
    if (!adj.excess && !adj.shortage && !adj.transfer && rec) adj = { excess: Number(rec.excess) || 0, shortage: Number(rec.shortage) || 0, transfer: Number(rec.transfer) || 0 };
    const cs = Number(rec?.cs) || 0, gCs = Number(rec?.g_cs) || 0;
    const total = r3(open + receipt + adj.excess - adj.shortage - adj.transfer);
    const close = r3(total - s - cs);
    const amount = c.free ? 0 : r3(s * c.rate);
    whole[sec][c.id] = { open, receipt, total, sales: s, close, amount, excess: adj.excess, shortage: adj.shortage, transfer: adj.transfer };
    const g = { open: bagsOf(open, c.id), receipt: bagsOf(receipt, c.id), sales: bagsOf(s, c.id) };
    const row = { open, receipt, total, sales: s, close, amount, excess: adj.excess, shortage: adj.shortage, transfer: adj.transfer, cs, g_cs: gCs,
      g_open: g.open, g_receipt: g.receipt, g_total: g.open + g.receipt, g_sales: g.sales, g_close: g.open + g.receipt - g.sales - gCs };
    if (open || receipt || s || close || amount || cs) manual[sec][c.id] = row;
    if (open || receipt || s || adj.shortage || adj.excess || adj.transfer) shown.push({ id: c.id, open, receipt, short: adj.shortage, s, close, amount });
  }
  // Receipt is the register's, never typed here: every Receipt the month states must be a register total.
  const unreg = Object.entries(whole.a).concat(Object.entries(whole.b)).filter(([id, r]) => r.receipt > 0 && Math.abs((register[id] ?? 0) - r.receipt) > 0.0005);
  if (unreg.length) { console.error(`Refused: Receipt not in the register: ${unreg.map(([id, r]) => `${id} ${r.receipt}`).join(', ')}`); return 1; }

  const at = new Date().toISOString();
  next.meManualStore[key] = { ...manual, ...(next.meManualStore[key]?.dailyBags ? { dailyBags: next.meManualStore[key].dailyBags } : {}) };
  const pKey = projectionKey(crsId, month, year);
  const prevSheet = stored.entryStore?.[pKey];
  const sheet = buildProjectedSheet(whole, at);
  // Same figures as the sheet already there → keep it byte for byte (a re-run writes nothing).
  next.entryStore[pKey] = prevSheet && figures(sheet) === figures(prevSheet) ? prevSheet : sheet;
  const carried = applyProjectedAdjustments(next.inspectionStore, crsId, month, year, whole);
  const rebuilt = rebuildMonthlyFromDaily(crsId, month, year, next.entryStore, next.inspectionStore, next.meManualStore[key], lists, stored.receiptStore);
  next.monthlyStore[key] = rebuilt.merged;
  next.meSourceStore[key] = rebuilt.source;
  const chained = rechainAndRepublish({ ...next, receiptStore: stored.receiptStore }, crsId, `${year}-${String(month).padStart(2, '0')}-01`, lists);
  for (const [k, v] of Object.entries(chained.patch)) if (WRITABLE.includes(k)) next[k] = v;
  // The Gunny table's Opening, as an administrator types it (openingAuto false).
  if (Object.keys(gunnyOpen).length) {
    const own = { ...(next.meGunnyStore[key] ?? {}) };
    const LABEL = { ss50: '50 KG SS', poly: 'POLY', cbox: 'C.BOX' };
    for (const [item, n] of Object.entries(gunnyOpen)) own[item] = { itemName: LABEL[item], crsId: String(crsId), month, year, ...(own[item] ?? {}), opening: n, openingAuto: false };
    next.meGunnyStore = { ...next.meGunnyStore, [key]: own };
  }
  for (const ym of [...new Set([`${year}-${String(month).padStart(2, '0')}`, ...chained.dates.map((d) => d.slice(0, 7))])].sort()) {
    const [yy, mm] = ym.split('-').map(Number);
    const g = refreshGunnyMonths(next.meGunnyStore, crsId, mm, yy, next.monthlyStore, (mo, yr) => packTypesFor(stored.receiptStore, crsId, mo, yr));
    if (g) next.meGunnyStore = g;
  }
  // A Gunny record re-worked to the same figures keeps its stored copy.
  for (const k of Object.keys(next.meGunnyStore)) if (stored.meGunnyStore?.[k] && figures(next.meGunnyStore[k]) === figures(stored.meGunnyStore[k])) next.meGunnyStore[k] = stored.meGunnyStore[k];

  console.log(`CRS ${crsId} · ${month}/${year} · keyed by month · last-day sheet ${pKey}${prevSheet ? ' (replaces the earlier projection)' : ' (new)'}${carried ? ` · ${carried} adjustment(s) carried` : ''}`);
  console.log('  commodity      Opening    Receipt   Shortage      Sales     Closing     Amount');
  for (const r of shown) console.log(`  ${r.id.padEnd(12)} ${String(r.open).padStart(9)} ${String(r.receipt).padStart(10)} ${String(r.short || '').padStart(10)} ${String(r.s).padStart(10)} ${String(r.close).padStart(11)} ${String(r.amount).padStart(10)}`);
  const pub = next.monthlyStore[key];
  const off = Object.entries(expect).filter(([id, v]) => Math.abs((Number(pub?.[secOf[id]]?.[id]?.close) || 0) - v) > 0.0005);
  if (off.length) { console.error(`Refused: Closing differs from --expect: ${off.map(([id, v]) => `${id} ${pub?.[secOf[id]]?.[id]?.close} ≠ ${v}`).join(', ')}`); return 1; }
  if (Object.keys(expect).length) console.log(`  --expect: all ${Object.keys(expect).length} Closings match`);

  const changed = WRITABLE.filter((k) => canon(next[k]) !== canon(stored[k] ?? {}));
  for (const k of changed) {
    const b = stored[k] ?? {}, a = next[k];
    const moved = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((x) => canon(b[x]) !== canon(a[x]));
    const other = moved.filter((x) => !x.startsWith(`${crsId}_`));
    if (other.length) { console.error(`Refused: ${k} would change another shop's ${other.join(', ')}`); return 1; }
    console.log(`  ${k}: ${moved.join(', ')}`);
  }
  if (!changed.length) { console.log('Already closed exactly so — nothing to write.'); return 0; }
  const incoming = Object.fromEntries(changed.map((k) => [k, next[k]]));
  const broken = inspectStockWrite(stored, incoming, true);
  if (broken.length) { console.error(`Refused by the stock guard: ${describeStock(broken)}`); return 1; }
  console.log('  stock guard ✓');
  if (!write) { console.log('DRY RUN — pass --write to apply.'); return 0; }

  mkdirSync(join(root, 'backups'), { recursive: true });
  const bk = join(root, 'backups', `close-month-crs${crsId}-${month}-${year}-${at.replace(/[:.]/g, '-')}.json`);
  writeFileSync(bk, JSON.stringify({ crsId, month, year, sales, shortage, expect, versions, before: Object.fromEntries(changed.map((k) => [k, stored[k]])) }, null, 1));
  console.log(`Backed up ${changed.join(', ')} to ${bk}`);
  const landed = {};
  for (const k of changed) {
    const { data: upd, error: e } = await db.from('crs_state')
      .update({ data: next[k], version: Number(versions[k]) + 1, updated_at: new Date().toISOString(), updated_by: 'admin' })
      .eq('scope', 'global').eq('store_key', k).eq('version', versions[k]).select('version');
    if (e) throw e;
    if (!upd?.length) { console.error(`Refused: ${k} changed since it was read. Written so far: ${Object.keys(landed).join(', ') || 'nothing'} — check, then run it again.`); return 1; }
    landed[k] = next[k];
    console.log(`WROTE ${k} v${versions[k]} → v${upd[0].version}`);
  }
  const session = { userId: 1, username: 'admin', role: 'ADMIN', crsId: null, iat: Math.floor(Date.now() / 1000) };
  await recordActivity(session, diffStateWrite(stored, landed, { meManualStore: { [key]: 'closed' } }));
  await reconcileShops([crsId], 'admin');
  console.log(`Done: CRS ${crsId} ${month}/${year} closed — activity logged, started-record reconciled.`);
  return 0;
}
process.exitCode = await main();
