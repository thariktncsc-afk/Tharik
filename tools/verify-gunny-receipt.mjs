/**
 * Gunny Stock's automatic Receipt, counted from the month's saved sales
 * (office, 2026-09-30).
 *
 *   node tools/verify-gunny-receipt.mjs
 *
 * Through the real functions (engine/gunnyPack.ts, monthly-entry/lib.ts, the
 * roll-up, stockGuard rule 5, the statement engine), synthetic data only:
 *   1. each commodity's pack and size — Gunny ÷50, Poly ÷50 / salt ÷25,
 *      C.Box palm oil ÷10 / tea ÷50 — one commodity at a time;
 *   2. the Receipt page's Gunny / Poly switch, saved on the receipt, for
 *      Wheat, RRA and NPHH FRK RRA;
 *   3. the office's example month;
 *   4. keyed by day and keyed by month give the same Receipt, counted once;
 *   5. Receipt is Monthly Sales' own bag counts — not Sales Close, and not a
 *      Receipt typed into the Gunny table (CRS 5: 227 / 28, never 236 / 23);
 *      Issues are typed and never replaced;
 *   6. after a Daily save: this month's Receipt / Total / Closing follow,
 *      and next month opens at the new Closing;
 *   7. the server's rule 5 takes that write from a shop user;
 *   8. the Gunny statement prints the same Receipt as the screen;
 *   9. the wiring: Daily Entry, Receipt, Monthly Entry and approved clears.
 */
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
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
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { packTypesFor, packCounts, salesBags, PACK_BASE } = await imp('src/lib/engine/gunnyPack.ts');
const { gunnyRowFor, refreshGunnyMonths } = await imp('src/app/(app)/monthly-entry/lib.ts');
const { rebuildMonthlyFromDaily } = await imp('src/lib/engine/monthlyRollup.ts');
const { entryListsFor } = await imp('src/lib/engine/commodities.ts');
const { inspectStockWrite, describeStock } = await imp('src/lib/stockGuard.ts');
const { createStatementEngine } = await import(pathToFileURL(join(root, 'src/generated/statements-legacy.js')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const CRS = 20;
const rcpt = (id, pack, date = '2026-09-10', rid = 1) => ({ id: rid, crsId: CRS, date, receiptNo: `R${rid}`, items: { [id]: pack ? { qty: 100, pack } : { qty: 100 } } });
const receiptOf = (sales, receipts = [], id = 'ss50') => {
  const types = packTypesFor(receipts, CRS, 9, 2026);
  return gunnyRowFor(id, {}, {}, undefined, {}, sales, types).rc.val;
};

console.log('1. Each commodity, on its own');
for (const [id, kg, item, packs] of [
  ['BRA', 500, 'ss50', 10], ['RRA', 250, 'ss50', 5], ['AAY', 100, 'ss50', 2], ['AAY_FRK', 150, 'ss50', 3], ['NPHH_FRK', 200, 'ss50', 4],
  ['PHH_FRK', 50, 'ss50', 1], ['PHH_BRA', 1000, 'ss50', 20], ['NPHH_RRA', 99, 'ss50', 1], ['WHEAT', 100, 'ss50', 2], ['TOOR', 616, 'ss50', 12],
  ['SUGAR', 100, 'poly', 2], ['AAY_SUGAR', 27, 'poly', 0], ['SALT_CIS', 225, 'poly', 9], ['SALT_RFFS', 50, 'poly', 2],
  ['PALM', 30, 'cbox', 3], ['OOTY', 150, 'cbox', 3], ['TAN', 100, 'cbox', 2],
]) {
  const got = { ss50: receiptOf({ [id]: kg }, [], 'ss50'), poly: receiptOf({ [id]: kg }, [], 'poly'), cbox: receiptOf({ [id]: kg }, [], 'cbox') };
  const others = Object.entries(got).filter(([k]) => k !== item).every(([, v]) => v === 0);
  check(`${id} ${kg} → ${item.toUpperCase()} ${got[item]} (÷${{ PALM: 10, SALT_CIS: 25, SALT_RFFS: 25 }[id] ?? 50}), nothing elsewhere`, got[item] === packs && others, JSON.stringify(got));
}

console.log('\n2. The Gunny / Poly switch (Wheat, RRA, NPHH FRK RRA)');
for (const id of ['WHEAT', 'RRA', 'NPHH_RRA']) {
  const s = { [id]: 500 };
  check(`${id}: switch Gunny → 10 sacks; switch Poly → 10 poly; no receipt → Gunny`,
    receiptOf(s, [rcpt(id, 'GUNNY')], 'ss50') === 10 && receiptOf(s, [rcpt(id, 'GUNNY')], 'poly') === 0 &&
    receiptOf(s, [rcpt(id, 'POLY')], 'poly') === 10 && receiptOf(s, [rcpt(id, 'POLY')], 'ss50') === 0 &&
    receiptOf(s, [], 'ss50') === 10);
}
check('the switch cannot move a commodity it does not apply to (SUGAR "GUNNY" on a receipt stays Poly)', receiptOf({ SUGAR: 100 }, [rcpt('SUGAR', 'GUNNY')], 'poly') === 2);
{
  // Only rows with a bag box on the Monthly Sales grid are counted — police sugar / wheat / dhall / palm oil have none.
  const { NO_GUNNY } = await imp('src/app/(app)/monthly-entry/lib.ts');
  check('no commodity without a bag box on Monthly Sales is counted (police sugar / wheat / dhall / palm oil)', Object.keys(PACK_BASE).every((id) => !NO_GUNNY.has(id)));
  const pol = { PB_WHEAT: 500, PB_SUGAR: 500, PB_TOOR: 500, PB_PALM: 500, PB_BRA: 100 };
  check('police BRA (it has a box) counts 2 sacks; the four without a box count nothing', receiptOf(pol, [], 'ss50') === 2 && receiptOf(pol, [], 'poly') === 0 && receiptOf(pol, [], 'cbox') === 0);
}
check('another shop\'s receipt does not decide', packTypesFor([{ ...rcpt('WHEAT', 'POLY'), crsId: 21 }], CRS, 9, 2026).WHEAT === 'GUNNY');

console.log('\n3. The office\'s example: BRA 500, RRA 250, Wheat 100, Sugar 100, P.OIL 30');
{
  const sales = { BRA: 500, RRA: 250, WHEAT: 100, SUGAR: 100, PALM: 30 };
  const base = packCounts(sales, packTypesFor([], CRS, 9, 2026));
  check(`all as the base rule: Gunny ${base.GUNNY} (10 + 5 + 2), Poly ${base.POLY} (2), C.Box ${base.CBOX} (3)`, base.GUNNY === 17 && base.POLY === 2 && base.CBOX === 3);
  const sw = packCounts(sales, packTypesFor([rcpt('RRA', 'POLY'), rcpt('WHEAT', 'POLY', '2026-09-11', 2)], CRS, 9, 2026));
  check(`RRA and Wheat switched to Poly: Gunny ${sw.GUNNY} (10), Poly ${sw.POLY} (5 + 2 + 2), C.Box ${sw.CBOX}`, sw.GUNNY === 10 && sw.POLY === 9 && sw.CBOX === 3);
}

console.log('\n4. Keyed by day or by month — the same Receipt, counted once');
{
  const lists = entryListsFor(CRS);
  const row = (sales) => ({ open: 1000, receipt: 0, total: 1000, sales, close: 1000 - sales, amount: 0 });
  // By day: BRA 60 + 70 + 120 = 250 kg over three sheets = 5 sacks (per-day floors would say 1 + 1 + 2 = 4).
  const entryStore = {
    [`${CRS}_2026-09-01`]: { a: { BRA: row(60) }, b: {} },
    [`${CRS}_2026-09-02`]: { a: { BRA: row(70) }, b: {} },
    [`${CRS}_2026-09-03`]: { a: { BRA: row(120) }, b: {} },
  };
  const byDay = rebuildMonthlyFromDaily(CRS, 9, 2026, entryStore, {}, undefined, lists, []);
  const byMonth = rebuildMonthlyFromDaily(CRS, 9, 2026, {}, {}, { a: { BRA: { open: 1000, receipt: 0, total: 1000, sales: 250, close: 750, amount: 0 } }, b: {} }, lists, []);
  // A day-keyed month with a stale manual row left over: the day sheets win, it is not added.
  const both = rebuildMonthlyFromDaily(CRS, 9, 2026, entryStore, {}, { a: { BRA: { open: 1000, receipt: 0, total: 1000, sales: 999, close: 1, amount: 0 } }, b: {} }, lists, []);
  const rcp = (m) => receiptOf({ BRA: Number(m.merged.a.BRA?.sales) || 0 });
  check(`by day ${rcp(byDay)} = by month ${rcp(byMonth)} = 5 sacks (250 kg, the month's total, not per-day floors)`, rcp(byDay) === 5 && rcp(byMonth) === 5);
  check(`a stale Monthly row beside the day sheets is not added: still ${rcp(both)}`, rcp(both) === 5);
}

console.log('\n5. Where the Receipt comes from; Issues');
{
  const sc = { date: '2026-09-30', gunny: 112, poly: 11, cbox: 33 };
  const r = gunnyRowFor('ss50', {}, {}, sc, {}, { BRA: 15550 }, PACK_BASE);
  check(`Sales Close (112) no longer sets it — the sales do: ${r.rc.val} (15550 kg ÷ 50)`, r.rc.val === 311 && !r.rc.imported);
  // CRS 5 September as it stood: a Receipt of 236 / 23 typed into the Gunny table while
  // Monthly Sales' bag columns said 227 / 28 (office, 2026-09-30). Monthly Sales is the source.
  const crs5 = { BRA: 5814, NPHH_FRK: 168, PHH_FRK: 175, PHH_BRA: 2866, AAY: 700, RRA: 381, WHEAT: 750, TOOR: 616, SUGAR: 1031.5, AAY_SUGAR: 27, SALT_CIS: 215, PALM: 616 };
  const typedRc = { ss50: { opening: 89, receiptImported: 236 }, poly: { opening: 0, receiptImported: 23, issues: 22 }, cbox: { opening: 2, issues: 62 } };
  const g5 = Object.fromEntries(['ss50', 'poly', 'cbox'].map((k) => [k, gunnyRowFor(k, typedRc, {}, sc, {}, crs5, PACK_BASE)]));
  check(`CRS 5's month: Gunny ${g5.ss50.rc.val} (116+3+3+57+14+7+15+12), Poly ${g5.poly.rc.val} (20+0+8), C.Box ${g5.cbox.rc.val} — the typed 236 / 23 are not read`,
    g5.ss50.rc.val === 227 && g5.poly.rc.val === 28 && g5.cbox.rc.val === 61 && !g5.ss50.rc.imported);
  check(`…Total and Closing follow: 50 KG SS ${g5.ss50.total} / ${g5.ss50.closing}, POLY ${g5.poly.total} / ${g5.poly.closing}, C.BOX ${g5.cbox.total} / ${g5.cbox.closing}`,
    g5.ss50.total === 316 && g5.ss50.closing === 316 && g5.poly.total === 28 && g5.poly.closing === 6 && g5.cbox.total === 63 && g5.cbox.closing === 1);
  // What Monthly Sales SHOWS is the figure: the grid's own bag counts, summed by pack.
  const grid = { BRA: 116, NPHH_FRK: 3, PHH_FRK: 3, PHH_BRA: 57, AAY: 14, RRA: 7, WHEAT: 15, TOOR: 12, SUGAR: 20, AAY_SUGAR: 0, SALT_CIS: 8, PALM: 61 };
  const fromGrid = Object.fromEntries(['ss50', 'poly', 'cbox'].map((k) => [k, gunnyRowFor(k, typedRc, {}, sc, grid, crs5, PACK_BASE).rc.val]));
  check(`the grid's displayed bags give the same: ${fromGrid.ss50} / ${fromGrid.poly} / ${fromGrid.cbox}`, fromGrid.ss50 === 227 && fromGrid.poly === 28 && fromGrid.cbox === 61);
  // A bag count the office keyed on Monthly Sales (it differs from the division) is what the grid shows — and so what Gunny takes.
  check('a bag count keyed on Monthly Sales (BRA 120 shown, 116 by division) is the one Gunny takes: 231',
    gunnyRowFor('ss50', {}, {}, undefined, { ...grid, BRA: 120 }, crs5, PACK_BASE).rc.val === 231 && salesBags({ sales: 5814, g_sales: 120 }, 'BRA') === 120 && salesBags({ sales: 5814, g_sales: 0 }, 'BRA') === 116 && salesBags({ sales: 5814 }, 'BRA') === 116);
  const wheatPoly = packTypesFor([{ id: 1, crsId: CRS, date: '2026-09-10', receiptNo: 'R', items: { WHEAT: { qty: 1, pack: 'POLY' } } }], CRS, 9, 2026);
  check('with Wheat switched to Poly its 15 bags move: Gunny 212, Poly 43 — one switch, both figures',
    gunnyRowFor('ss50', {}, {}, undefined, grid, crs5, wheatPoly).rc.val === 212 && gunnyRowFor('poly', {}, {}, undefined, grid, crs5, wheatPoly).rc.val === 43);
  const typed = gunnyRowFor('poly', { poly: { issues: 30 } }, {}, undefined, {}, { SUGAR: 1000, EMPTY_BAG: 72 }, PACK_BASE);
  check(`typed Issues 30 stand, whatever the sales (Poly sold 72): Issues ${typed.issues}, Total ${typed.total}, Closing ${typed.closing}`, typed.issues === 30 && !typed.issuesAuto && typed.total === 20 && typed.closing === -10);
}

console.log('\n5b. An administrator\'s typed Receipt (receiptTyped, 2026-09-30)');
{
  const grid = { BRA: 116 };
  const t = gunnyRowFor('ss50', { ss50: { opening: 89, receiptTyped: 237, receiptImported: 236 } }, {}, undefined, grid, { BRA: 5814 }, PACK_BASE);
  check(`a typed 237 wins over Monthly Sales' ${t.rcAuto}: Receipt ${t.rc.val}, Total ${t.total} (the legacy 236 is ignored)`, t.rc.val === 237 && t.rc.imported && t.rcAuto === 116 && t.total === 326);
  const cleared = gunnyRowFor('ss50', { ss50: { opening: 89, receiptTyped: '', receiptImported: 236 } }, {}, undefined, grid, { BRA: 5814 }, PACK_BASE);
  check(`cleared ('') → back to Monthly Sales: ${cleared.rc.val}`, cleared.rc.val === 116 && !cleared.rc.imported);
  const { gunnySaveProblems } = await imp('src/app/(app)/monthly-entry/lib.ts');
  check('a negative typed Receipt is refused by Save', gunnySaveProblems({ ss50: { receiptTyped: -1 } }, {}, undefined, grid, { BRA: 5814 }).errors.some((e) => /Receipt must be a number/.test(e)));
  const stored = { meGunnyStore: { '20_9_2026': { ss50: { opening: 874 } } }, monthlyStore: { '20_9_2026': { a: { BRA: { sales: 21250 } }, b: {} } }, receiptStore: [] };
  const typedWrite = { meGunnyStore: { '20_9_2026': { ss50: { opening: 874, receiptTyped: 500, receipt: 500, total: 1374, closing: 1374 } } } };
  check('a shop user may not type a Receipt (rule 5 refuses)', inspectStockWrite(stored, typedWrite, false).some((v) => /Receipt/.test(v.detail)));
  check('an administrator may', inspectStockWrite(stored, typedWrite, true).length === 0);
  const later = { ...stored, meGunnyStore: typedWrite.meGunnyStore };
  const shopKeeps = { meGunnyStore: { '20_9_2026': { ss50: { opening: 874, receiptTyped: 500, receipt: 500, total: 1374, issues: 10, closing: 1364 } } } };
  check('…and a shop user\'s later Save keeps it (Issues typed, Receipt untouched) — lands', inspectStockWrite(later, shopKeeps, false).length === 0, describeStock(inspectStockWrite(later, shopKeeps, false)));
}

console.log('\n6. After a Daily save');
{
  const types = () => PACK_BASE;
  const store = {
    [`${CRS}_9_2026`]: { ss50: { opening: 874, openingAuto: false, issues: 1000, receipt: 400, total: 1274, closing: 274 }, poly: { opening: 40, openingAuto: false, issues: 30, receipt: 0, total: 40, closing: 10 } },
    [`${CRS}_10_2026`]: { ss50: { opening: 274, openingAuto: true, issues: 5, receipt: 0, total: 274, closing: 269 }, poly: { opening: 10, openingAuto: true, receipt: 0, total: 10, closing: 10 } },
  };
  // September's sales now empty 425 sacks and 32 poly (21250 kg BRA, 1600 kg SUGAR).
  const monthly = { [`${CRS}_9_2026`]: { a: { BRA: { sales: 21250 }, SUGAR: { sales: 1600 } }, b: {} }, [`${CRS}_10_2026`]: { a: {}, b: {} } };
  const next = refreshGunnyMonths(store, CRS, 9, 2026, monthly, types);
  const s = next?.[`${CRS}_9_2026`], o = next?.[`${CRS}_10_2026`];
  check(`September: Receipt ${s?.ss50?.receipt}, Total ${s?.ss50?.total}, Closing ${s?.ss50?.closing} (874 + 425 − 1000); Issues 1000 kept`, s.ss50.receipt === 425 && s.ss50.total === 1299 && s.ss50.closing === 299 && s.ss50.issues === 1000);
  check(`POLY: Receipt ${s.poly.receipt}, typed Issues ${s.poly.issues} kept, Closing ${s.poly.closing}`, s.poly.receipt === 32 && s.poly.issues === 30 && s.poly.closing === 42);
  check(`October re-carries: Opening ${o?.ss50?.opening} (= Sept Closing 299), Closing ${o?.ss50?.closing}; POLY Opening ${o?.poly?.opening}`, o.ss50.opening === 299 && o.ss50.closing === 294 && o.poly.opening === 42);
  const again = refreshGunnyMonths(next, CRS, 9, 2026, monthly, types);
  check('saved again with nothing new: nothing to write', again === null);
  const keyedOct = { ...next, [`${CRS}_10_2026`]: { ...o, ss50: { ...o.ss50, opening: 500, openingAuto: false } } };
  const withKeyed = refreshGunnyMonths(keyedOct, CRS, 9, 2026, { ...monthly, [`${CRS}_9_2026`]: { a: { BRA: { sales: 25000 } }, b: {} } }, types);
  check(`an Opening an administrator set in October is kept (${withKeyed?.[`${CRS}_10_2026`]?.ss50?.opening})`, withKeyed[`${CRS}_10_2026`].ss50.opening === 500);
  const noRec = refreshGunnyMonths({}, CRS, 8, 2026, { [`${CRS}_8_2026`]: { a: {}, b: {} } }, types);
  check('a month with no sales and no record is left alone', noRec === null);

  console.log('\n7. The server (stockGuard rule 5) takes it from a shop user');
  const stored = { meGunnyStore: store, monthlyStore: monthly, receiptStore: [] };
  const v = inspectStockWrite(stored, { meGunnyStore: next, monthlyStore: monthly }, false);
  check('shop user: September refreshed AND October re-carried in one write — lands', v.length === 0, describeStock(v));
  const tamper = { ...next, [`${CRS}_9_2026`]: { ...s, ss50: { ...s.ss50, receipt: 500, total: 1374, closing: 374 } } };
  const vt = inspectStockWrite(stored, { meGunnyStore: tamper, monthlyStore: monthly }, false);
  check('…a Receipt that is not the sales is still refused', vt.some((x) => /Receipt is the office/.test(x.detail)), describeStock(vt));
  // The shop types POLY Issues 12: the screen stores the month, and the months after re-carry (refreshGunnyFor).
  const typedIss = refreshGunnyMonths({ ...next, [`${CRS}_9_2026`]: { ...s, poly: { ...s.poly, issues: 12, closing: 60 } } }, CRS, 9, 2026, monthly, types);
  const vi = inspectStockWrite(stored, { meGunnyStore: typedIss, monthlyStore: monthly }, false);
  check('…typed POLY Issues (12, Closing 60) land', vi.length === 0, describeStock(vi));
}

console.log('\n8. The Gunny statement prints the same Receipt as the screen');
{
  const sales = { BRA: 5000, WHEAT: 1000, SUGAR: 1000, SALT_CIS: 250, PALM: 55, OOTY: 100 };
  const receipts = [{ id: 1, crsId: CRS, date: '2026-09-05', receiptNo: 'R1', items: { WHEAT: { qty: 1000, pack: 'POLY' } } }];
  const e = createStatementEngine({
    stores: { entryStore: {}, inspectionStore: {}, monthlyStore: { [`${CRS}_9_2026`]: { a: Object.fromEntries(Object.entries(sales).map(([id, s]) => [id, { sales: s }])), b: {} } }, meManualStore: {}, meSourceStore: {}, meRemitStore: {}, meGunnyStore: {}, meCardStore: {}, salesCloseStore: { [`${CRS}_9_2026`]: { date: '2026-09-30', gunny: 1, poly: 1, cbox: 1 } }, receiptStore: receipts, meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {} },
    users: [], CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` })), CRS_MASTER: [], APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });
  const g = e.getData(CRS, 9, 2026).gunny;
  const types = packTypesFor(receipts, CRS, 9, 2026);
  const screen = Object.fromEntries(['ss50', 'poly', 'cbox'].map((k) => [k, gunnyRowFor(k, {}, {}, undefined, {}, sales, types).rc.val]));
  check(`statement ${g.ss50.rec} / ${g.poly.rec} / ${g.cbox.rec} = screen ${screen.ss50} / ${screen.poly} / ${screen.cbox} (Wheat switched to Poly; Sales Close ignored)`,
    g.ss50.rec === screen.ss50 && g.poly.rec === screen.poly && g.cbox.rec === screen.cbox && screen.ss50 === 100 && screen.poly === 50 && screen.cbox === 7);
}

console.log('\n9. Wiring');
{
  const de = readFileSync(join(root, 'src/app/(app)/daily-entry/page.tsx'), 'utf8');
  check('Daily Entry: the save refreshes Gunny after the chain', de.indexOf('refreshGunnyFor(Number(crsVal)') > de.indexOf('rechainAndRepublish('));
  const rc = readFileSync(join(root, 'src/app/(app)/receipt/page.tsx'), 'utf8');
  check('Receipt: the switch is saved on the line, and Gunny refreshed after', /pack: r\.type === 'POLY' \? 'POLY' : 'GUNNY'/.test(rc) && /refreshGunnyFor\(rCrsId/.test(rc));
  const me = readFileSync(join(root, 'src/app/(app)/monthly-entry/page.tsx'), 'utf8');
  check('Monthly Entry: the month-close refreshes Gunny; the table gets the switch types', /refreshGunnyFor\(ctx\.crsId/.test(me) && /packTypes=\{packTypes\}/.test(me));
  const gt = readFileSync(join(root, 'src/app/(app)/monthly-entry/GunnyTable.tsx'), 'utf8');
  check('Gunny table: Issues typable by everyone; Opening and Receipt admin-only (receiptTyped, never receiptImported)',
    !/readOnly=\{issuesAuto && !isAdmin\}/.test(gt) && (gt.match(/readOnly=\{!isAdmin\}/g) ?? []).length === 2 && !/receiptImported:/.test(gt) && /receiptTyped:/.test(gt) && /data-gunny-receipt/.test(gt));
  check('Gunny table: typing changes a draft, never the store — only Save writes', !/crsData\.update[^;]*\n?[^;]*write\b/.test(gt) && /setDrafts\(/.test(gt.slice(gt.indexOf('const write'), gt.indexOf('const rows'))) && !/crsData\.update/.test(gt.slice(gt.indexOf('const write'), gt.indexOf('const rows'))));
  const lib = readFileSync(join(root, 'src/app/(app)/monthly-entry/lib.ts'), 'utf8');
  check('the legacy typed Receipt (receiptImported) is read nowhere; the new one (receiptTyped) by the screen and the statements',
    !/rec\.receiptImported/.test(lib) && !/rec\.receiptImported/.test(readFileSync(join(root, 'src/legacy/42-gunny-live.js'), 'utf8')) && /rec\.receiptTyped/.test(lib) && /rec\.receiptTyped/.test(readFileSync(join(root, 'src/legacy/42-gunny-live.js'), 'utf8')));
  check('the server and the PV read Monthly Sales\' bag counts (salesBags)', /salesBags\(row, id\)/.test(readFileSync(join(root, 'src/lib/stockGuard.ts'), 'utf8')) && /salesBags\(r, id\)/.test(readFileSync(join(root, 'src/lib/engine/pvQuarter.ts'), 'utf8')));
  const cx = readFileSync(join(root, 'src/lib/clearExecute.ts'), 'utf8');
  check('an approved clear refreshes the Gunny months it moved', /refreshGunnyMonths\(gunny/.test(cx));
  const lg = readFileSync(join(root, 'src/legacy/42-gunny-live.js'), 'utf8');
  check('the statements no longer read Sales Close', !/d\.salesClose/.test(lg));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll gunny-receipt checks passed.');
process.exitCode = failures ? 1 : 0;
