/**
 * Gunny Stock Management → Monthly Sales and the last-day Daily Entry
 * (office, 2026-09-30).
 *
 *   node tools/verify-gunny-sync.mjs
 *
 * Through the real engine functions (src/lib/engine/gunnySync.ts, the roll-up,
 * the chain), with synthetic stores — no database:
 *   1. CRS 20 as it stands: day sheets to 29-09, Issues C.Box 108 / Poly 72 →
 *      the 30-09 sheet is CREATED (carried Openings, Sales 0 elsewhere, no
 *      remittance) and Monthly Sales reads 108 / 72;
 *   2. saved again: nothing to write; edited: the one sheet is updated, never
 *      a second one;
 *   3. CRS 5 as it stands: a 30-09 sheet already there → updated in place;
 *   4. other days already sold some → the last day carries the rest, the
 *      month adds up to the Issues; more than the Issues → refused, nothing
 *      written;
 *   5. the last date still ahead → Monthly Sales only, no future sheet;
 *   6. a month keyed by month → its projection updated; not closed → the
 *      month-close projects it; CRS 29 → no sheet made without its rice;
 *   7. the next month opens where this one closes — the day chain AND the
 *      Gunny table's Opening;
 *   8. the wiring: Gunny Save syncs first, refuses on a problem, and passes
 *      the shop's rates.
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
const { syncGunnyToSales, gunnySyncNote } = await imp('src/lib/engine/gunnySync.ts');
const { entryListsFor } = await imp('src/lib/engine/commodities.ts');
const { gunnyMonthRecords, gunnyRowFor } = await imp('src/app/(app)/monthly-entry/lib.ts');
const { PROJECTION } = await imp('src/lib/engine/monthProjection.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const row = (o = {}) => ({ open: 0, receipt: 0, total: 0, sales: 0, close: 0, amount: 0, excess: 0, shortage: 0, transfer: 0, ...o });
const sheet = (a, extra = {}) => ({ a, b: {}, remits: [], remitAmount: 0, remitDate: '', ...extra });
const stores = (entryStore, manual = {}, extra = {}) => ({
  entryStore, inspectionStore: {}, receiptStore: [], meManualStore: manual, monthlyStore: {}, meSourceStore: {}, ...extra,
});
const keysOn = (es, crs, date) => Object.keys(es).filter((k) => k === `${crs}_${date}`).length;
const lists = (crs) => entryListsFor(crs);
const dm = (iso) => iso.split('-').reverse().join('-');

console.log('1. CRS 20 as it stands (sheets to 29-09, no 30-09)');
// SUGAR opens 500 on 01-09, sells 20 there and 30 on 29-09 → 30-09 must open at 450.
const crs20 = {
  '20_2026-09-01': sheet({ SUGAR: row({ open: 500, total: 500, sales: 20, close: 480, amount: 500 }), EMPTY_BOX: row(), EMPTY_BAG: row() }),
  '20_2026-09-29': sheet({ SUGAR: row({ open: 480, total: 480, sales: 30, close: 450, amount: 750 }), EMPTY_BOX: row(), EMPTY_BAG: row() }),
};
const manual20 = { '20_9_2026': { a: { EMPTY_BOX: row({ sales: 108, close: -108, amount: 64.8 }), EMPTY_BAG: row({ sales: 72, close: -72, amount: 180 }) }, b: {} } };
const s1 = stores(crs20, manual20);
const r1 = syncGunnyToSales(s1, 20, 9, 2026, { EMPTY_BOX: 108, EMPTY_BAG: 72 }, lists(20), '2026-09-30');
const new30 = r1.patch.entryStore?.['20_2026-09-30'];
check(`30-09 sheet ${r1.lastDay}: C.Box ${new30?.a?.EMPTY_BOX?.sales} (₹${new30?.a?.EMPTY_BOX?.amount}), Poly ${new30?.a?.EMPTY_BAG?.sales} (₹${new30?.a?.EMPTY_BAG?.amount})`,
  r1.ok && r1.lastDay === 'created' && new30?.a?.EMPTY_BOX?.sales === 108 && new30?.a?.EMPTY_BAG?.sales === 72 && Math.abs(new30.a.EMPTY_BOX.amount - 64.8) < 1e-9 && new30.a.EMPTY_BAG.amount === 180);
check(`…as a Daily Entry save makes it: SUGAR opens at the carried 450, Sales 0; no remittance`, new30?.a?.SUGAR?.open === 450 && new30.a.SUGAR.sales === 0 && new30.a.SUGAR.close === 450 && Array.isArray(new30.remits) && new30.remits.length === 0 && !new30[PROJECTION]);
check(`Monthly Sales: C.Box ${r1.monthly.EMPTY_BOX}, Poly ${r1.monthly.EMPTY_BAG} (from the day sheets now: ${r1.patch.meSourceStore?.['20_9_2026']?.a?.EMPTY_BOX})`,
  r1.monthly.EMPTY_BOX === 108 && r1.monthly.EMPTY_BAG === 72 && r1.patch.meSourceStore?.['20_9_2026']?.a?.EMPTY_BOX === 'daily' && r1.patch.monthlyStore?.['20_9_2026']?.a?.EMPTY_BOX?.sales === 108);
check(`only the stores that moved are sent (${Object.keys(r1.patch).join(', ')}); the earlier sheets are untouched`,
  !r1.patch.meManualStore && JSON.stringify(r1.patch.entryStore['20_2026-09-29']) === JSON.stringify(crs20['20_2026-09-29']));
console.log(`        note: "${gunnySyncNote(r1, dm)}"`);

console.log('\n2. Saved again, then edited');
const s2 = { ...s1, ...r1.patch };
const r2 = syncGunnyToSales(s2, 20, 9, 2026, { EMPTY_BOX: 108, EMPTY_BAG: 72 }, lists(20), '2026-09-30');
check(`saved again with the same figures: ${r2.lastDay}, nothing to write`, r2.ok && r2.lastDay === 'unchanged' && Object.keys(r2.patch).length === 0);
const r3 = syncGunnyToSales(s2, 20, 9, 2026, { EMPTY_BOX: 100, EMPTY_BAG: 72 }, lists(20), '2026-09-30');
const es3 = { ...s2.entryStore, ...r3.patch.entryStore };
check(`C.Box edited to 100: the 30-09 sheet ${r3.lastDay} (${es3['20_2026-09-30'].a.EMPTY_BOX.sales}), still ONE sheet on 30-09, Monthly Sales ${r3.monthly.EMPTY_BOX}`,
  r3.ok && r3.lastDay === 'updated' && es3['20_2026-09-30'].a.EMPTY_BOX.sales === 100 && keysOn(es3, 20, '2026-09-30') === 1 && r3.monthly.EMPTY_BOX === 100 && r3.patch.meManualStore?.['20_9_2026']?.a?.EMPTY_BOX?.sales === 100);

console.log('\n3. CRS 5 as it stands (a 30-09 sheet already there)');
const crs5 = {
  '5_2026-09-01': sheet({ SUGAR: row({ open: 10, total: 10, close: 10 }), EMPTY_BOX: row(), EMPTY_BAG: row() }),
  '5_2026-09-29': sheet({ SUGAR: row({ open: 10, total: 10, close: 10 }), EMPTY_BOX: row(), EMPTY_BAG: row() }),
  '5_2026-09-30': sheet({ SUGAR: row({ open: 10, total: 10, close: 10 }), EMPTY_BOX: row(), EMPTY_BAG: row() }, { remits: [{ id: 'x', amount: 848, date: '2026-09-29', account: 'nc' }], remitAmount: 848, remitDate: '2026-09-29' }),
};
const r5 = syncGunnyToSales(stores(crs5, { '5_9_2026': { a: { EMPTY_BOX: row({ sales: 62, close: -62, amount: 37.2 }), EMPTY_BAG: row({ sales: 22, close: -22, amount: 55 }) }, b: {} } }), 5, 9, 2026, { EMPTY_BOX: 62, EMPTY_BAG: 22 }, lists(5), '2026-09-30');
const s5 = r5.patch.entryStore?.['5_2026-09-30'];
check(`30-09 ${r5.lastDay} in place: C.Box ${s5?.a?.EMPTY_BOX?.sales}, Poly ${s5?.a?.EMPTY_BAG?.sales}; its remittance (₹${s5?.remitAmount}) and SUGAR untouched`,
  r5.ok && r5.lastDay === 'updated' && s5.a.EMPTY_BOX.sales === 62 && s5.a.EMPTY_BAG.sales === 22 && s5.remitAmount === 848 && s5.remits.length === 1 && JSON.stringify(s5.a.SUGAR) === JSON.stringify(crs5['5_2026-09-30'].a.SUGAR));
check(`Monthly Sales C.Box ${r5.monthly.EMPTY_BOX} / Poly ${r5.monthly.EMPTY_BAG}, counted once`, r5.monthly.EMPTY_BOX === 62 && r5.monthly.EMPTY_BAG === 22);

console.log('\n4. Other days already sold some');
const part = JSON.parse(JSON.stringify(crs5));
part['5_2026-09-01'].a.EMPTY_BAG = row({ sales: 10, total: 0, close: -10, amount: 25 });
const r6 = syncGunnyToSales(stores(part), 5, 9, 2026, { EMPTY_BAG: 22 }, lists(5), '2026-09-30');
check(`01-09 sold 10 of the 22: the last day carries ${r6.onLastDay.EMPTY_BAG}, the month ${r6.monthly.EMPTY_BAG}`, r6.ok && r6.onLastDay.EMPTY_BAG === 12 && r6.monthly.EMPTY_BAG === 22);
const r7 = syncGunnyToSales(stores(part), 5, 9, 2026, { EMPTY_BAG: 8 }, lists(5), '2026-09-30');
check(`Issues 8 below the 10 already sold: refused, nothing written — "${r7.problems[0]}"`, !r7.ok && Object.keys(r7.patch).length === 0 && /already sell 10/.test(r7.problems[0]));

console.log('\n5. The last date still ahead');
const oct = { '20_2026-10-01': sheet({ SUGAR: row({ open: 450, total: 450, close: 450 }), EMPTY_BOX: row(), EMPTY_BAG: row() }) };
const r8 = syncGunnyToSales(stores(oct), 20, 10, 2026, { EMPTY_BOX: 40 }, lists(20), '2026-10-10');
check(`October saved on 10-10: ${r8.lastDay}; Monthly Sales C.Box ${r8.monthly.EMPTY_BOX} at once; no 31-10 sheet`,
  r8.ok && r8.lastDay === 'waiting' && r8.monthly.EMPTY_BOX === 40 && !r8.patch.entryStore && r8.patch.meManualStore?.['20_10_2026']?.a?.EMPTY_BOX?.sales === 40);
const r9 = syncGunnyToSales({ ...stores(oct), ...r8.patch }, 20, 10, 2026, { EMPTY_BOX: 40 }, lists(20), '2026-10-31');
check(`the first Save on 31-10 writes it: ${r9.lastDay}, C.Box ${r9.patch.entryStore?.['20_2026-10-31']?.a?.EMPTY_BOX?.sales}`, r9.ok && r9.lastDay === 'created' && r9.patch.entryStore?.['20_2026-10-31']?.a?.EMPTY_BOX?.sales === 40);

console.log('\n6. A month keyed by month; CRS 29');
const proj = { '7_2026-08-31': { ...sheet({ SUGAR: row({ open: 5, total: 5, close: 5 }), EMPTY_BAG: row({ sales: 3, close: -3, amount: 7.5 }) }), [PROJECTION]: { source: 'monthly', at: 'x' } } };
const r10 = syncGunnyToSales(stores(proj, { '7_8_2026': { a: { EMPTY_BAG: row({ sales: 3, close: -3, amount: 7.5 }) }, b: {} } }), 7, 8, 2026, { EMPTY_BAG: 9 }, lists(7), '2026-09-30');
const p10 = r10.patch.entryStore?.['7_2026-08-31'];
check(`closed month: its projection ${r10.lastDay} (Poly ${p10?.a?.EMPTY_BAG?.sales}, still a projection), Monthly Sales ${r10.monthly.EMPTY_BAG}`,
  r10.ok && r10.lastDay === 'projection' && p10.a.EMPTY_BAG.sales === 9 && !!p10[PROJECTION] && r10.monthly.EMPTY_BAG === 9);
const r11 = syncGunnyToSales(stores({}), 7, 7, 2026, { EMPTY_BAG: 9 }, lists(7), '2026-09-30');
check(`month not closed: ${r11.lastDay} — Monthly Sales ${r11.monthly.EMPTY_BAG}, no sheet written (the month-close projects it)`, r11.ok && r11.lastDay === 'not-closed' && r11.monthly.EMPTY_BAG === 9 && !r11.patch.entryStore);
const c29 = { '29_2026-09-01': sheet({ BRA: row({ open: 5, total: 5, close: 5 }), EMPTY_BAG: row() }, { freeRice: 0, costRice: 0 }) };
const r12 = syncGunnyToSales(stores(c29), 29, 9, 2026, { EMPTY_BAG: 4 }, lists(29), '2026-09-30');
check(`CRS 29: ${r12.lastDay} — no sheet made without its Free / Cost Rice; Monthly Sales ${r12.monthly.EMPTY_BAG}`, r12.ok && r12.lastDay === 'crs29' && !r12.patch.entryStore?.['29_2026-09-30'] && r12.monthly.EMPTY_BAG === 4);

console.log('\n7. The next month opens where this one closes');
const withOct = { ...crs20, '20_2026-10-01': sheet({ SUGAR: row({ open: 999, total: 999, close: 999 }), EMPTY_BOX: row({ open: 5, total: 5, close: 5 }), EMPTY_BAG: row() }) };
const r13 = syncGunnyToSales(stores(withOct, manual20), 20, 9, 2026, { EMPTY_BOX: 108, EMPTY_BAG: 72 }, lists(20), '2026-09-30');
const es13 = r13.patch.entryStore;
check(`01-10 re-carried from the new 30-09: SUGAR ${es13['20_2026-10-01'].a.SUGAR.open} (= 30-09 close ${es13['20_2026-09-30'].a.SUGAR.close}), C.Box ${es13['20_2026-10-01'].a.EMPTY_BOX.open} (= ${es13['20_2026-09-30'].a.EMPTY_BOX.close})`,
  es13['20_2026-10-01'].a.SUGAR.open === es13['20_2026-09-30'].a.SUGAR.close && es13['20_2026-10-01'].a.EMPTY_BOX.open === es13['20_2026-09-30'].a.EMPTY_BOX.close);
// The Gunny table: September stored with the synced sales, October opens at its Closing.
const ctx = { crsId: 20, month: 9, year: 2026, key: '20_9_2026' };
// Receipt is Monthly Sales' own bags (never typed): BRA 21250 kg = 425 sacks, SUGAR 1600 kg = 32 poly, PALM 1070 pkts = 107 boxes.
const g9 = gunnyMonthRecords({ ss50: { opening: 874, issues: 1000 }, poly: { opening: 40 }, cbox: { opening: 1 } }, {}, ctx, undefined, {}, { BRA: 21250, SUGAR: 1600, PALM: 1070, EMPTY_BAG: 72, EMPTY_BOX: 108 });
const oct10 = (id) => gunnyRowFor(id, {}, g9, undefined, {}, {});
check(`Gunny September: 50 KG SS ${g9.ss50.total}/${g9.ss50.closing}, POLY ${g9.poly.total}/${g9.poly.closing}, C.BOX ${g9.cbox.total}/${g9.cbox.closing} (the office's example)`,
  g9.ss50.total === 1299 && g9.ss50.closing === 299 && g9.poly.total === 72 && g9.poly.closing === 0 && g9.cbox.total === 108 && g9.cbox.closing === 0);
check(`Gunny October opens at September's Closing: 50 KG SS ${oct10('ss50').opening}, POLY ${oct10('poly').opening}, C.BOX ${oct10('cbox').opening}`, oct10('ss50').opening === 299 && oct10('poly').opening === 0 && oct10('cbox').opening === 0);
check('POLY / C.BOX Issues are not stored by the save (they follow the sales)', g9.poly.issues === undefined && g9.cbox.issues === undefined);

console.log('\n8. Wiring');
const gt = readFileSync(join(root, 'src/app/(app)/monthly-entry/GunnyTable.tsx'), 'utf8');
const iSync = gt.indexOf('syncGunnyToSales(stores'), iGun = gt.indexOf('gunnyMonthRecords(merged');
check('Gunny Save syncs first, then stores the gunny rows against the synced sales', iSync > 0 && iGun > iSync && /soldNow/.test(gt.slice(iGun - 200, iGun + 200)));
check('a problem refuses the whole save before anything is written', /if \(!sync\.ok\) \{[\s\S]{0,300}return;/.test(gt) && gt.indexOf('if (!sync.ok)') < gt.indexOf('crsData.set(store'));
check('the tick still waits for the database', gt.indexOf('await crsData.saveConfirmed()') > gt.indexOf('crsData.set(store'));
check('Monthly Entry passes the shop\'s commodity lists (the rates)', /<GunnyTable[^>]*lists=\{lists\}/.test(readFileSync(join(root, 'src/app/(app)/monthly-entry/page.tsx'), 'utf8')));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll gunny-sync checks passed.');
process.exitCode = failures ? 1 : 0;
