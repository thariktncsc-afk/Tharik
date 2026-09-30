/**
 * Gunny Stock Management's own Save button (office, 2026-09-29).
 *
 *   node tools/verify-gunny-save.mjs
 *
 * The button stores the month's gunny rows exactly as the month-close always
 * has — one function, `gunnyMonthRecords` (monthly-entry/lib.ts), called by
 * both — then waits for the database before the tick. Checked here, with no
 * database and nothing live:
 *   1. the office's CRS 8 September figures come out as the screen shows them;
 *   2. what the button stores passes the server's gunny rule for a SHOP user
 *      (stockGuard rule 5), so the permissions are unchanged;
 *   3. POLY / C.BOX automatic Issues are not stored; 50 KG SS keyed Issues are;
 *   4. saving twice changes nothing, and next month opens at this Closing;
 *   5. what is refused and what is asked before saving;
 *   6. the wiring: one function for the month-close and the button, the tick
 *      only after saveConfirmed(), the wording.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = pathToFileURL(join(root, 'src') + '/').href;
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function resolve(s,c,n){if(s.startsWith('@/'))return n(${JSON.stringify(srcUrl)}+s.slice(2)+(/\\.[a-z]+$/.test(s)?'':'.ts'),c);return n(s,c);}`,
  )}`,
  import.meta.url,
);
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { gunnyRowFor, gunnyMonthRecords, gunnySaveProblems, ME_GUNNY_ITEMS } = await imp('src/app/(app)/monthly-entry/lib.ts');
const { inspectStockWrite, describeStock } = await imp('src/lib/stockGuard.ts');
const { gunnySaved } = await imp('src/lib/saveSuccess.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const CRS = 8;
const KEY = `${CRS}_9_2026`;
const PREV = `${CRS}_8_2026`;
const NEXT = `${CRS}_10_2026`;
const ctx = { crsId: CRS, month: 9, year: 2026, key: KEY };
const NOW = '2026-09-29T10:00:00.000Z';

// CRS 8, September 2026, as the office's screenshot shows it:
//   50 KG SS 739 / 217 / 956 / 650 / 306 · POLY 36 / 27 / 63 / 63 / 0 · C.BOX 112 / 56 / 168 / 168 / 0
const prev = { ss50: { closing: 739 }, poly: { closing: 36 }, cbox: { closing: 112 } };
const salesClose = { date: '2026-09-30', gunny: 217, poly: 27, cbox: 56 };
// Receipt is counted from the month's SALES (office, 2026-09-30 — Sales Close no longer sets it):
// BRA 10850 kg = 217 sacks, SUGAR 1350 kg = 27 poly, PALM 560 pkts = 56 boxes. Sales Close is
// still passed, with the same totals, to show it no longer decides anything.
const packSales = { BRA: 10850, SUGAR: 1350, PALM: 560, EMPTY_BAG: 63, EMPTY_BOX: 168 };
const own = { ss50: { itemName: '50 KG SS', issues: 650 } };
const expect = { ss50: [739, 217, 956, 650, 306], poly: [36, 27, 63, 63, 0], cbox: [112, 56, 168, 168, 0] };

console.log('1. The office\'s CRS 8 September figures');
const saved = gunnyMonthRecords(own, prev, ctx, salesClose, {}, packSales, NOW);
for (const item of ME_GUNNY_ITEMS) {
  const r = gunnyRowFor(item.id, saved, prev, salesClose, {}, packSales);
  const got = [r.opening, r.rc.val, r.total, Number(r.issues), r.closing];
  check(`${item.label}: ${got.join(' / ')}`, JSON.stringify(got) === JSON.stringify(expect[item.id]), `expected ${expect[item.id].join(' / ')}`);
  const s = saved[item.id];
  check(`${item.label}: stored Opening ${s.opening}, Receipt ${s.receipt}, Total ${s.total}, Closing ${s.closing}`,
    s.opening === expect[item.id][0] && s.receipt === expect[item.id][1] && s.total === expect[item.id][2] && s.closing === expect[item.id][4]);
  check(`${item.label}: stored for CRS ${CRS}, September 2026`, s.crsId === String(CRS) && s.month === 9 && s.year === 2026);
}

console.log('\n2. A shop user\'s Save passes the server\'s gunny rule (stockGuard rule 5)');
{
  const stored = {
    meGunnyStore: { [PREV]: prev, [KEY]: own },
    salesCloseStore: { [KEY]: salesClose },
    monthlyStore: { [KEY]: { a: { BRA: { sales: 10850 }, SUGAR: { sales: 1350 }, PALM: { sales: 560 }, EMPTY_BAG: { sales: 63 }, EMPTY_BOX: { sales: 168 } }, b: {} } },
  };
  const v = inspectStockWrite(stored, { meGunnyStore: { ...stored.meGunnyStore, [KEY]: saved } }, false);
  check('shop user: the write lands', v.length === 0, describeStock(v));
  const va = inspectStockWrite(stored, { meGunnyStore: { ...stored.meGunnyStore, [KEY]: saved } }, true);
  check('administrator: the write lands', va.length === 0, describeStock(va));
  // Permissions unchanged: a shop user still cannot move an Opening through it.
  const tampered = gunnyMonthRecords({ ...own, poly: { opening: 900 } }, prev, ctx, salesClose, {}, packSales, NOW);
  const vt = inspectStockWrite(stored, { meGunnyStore: { ...stored.meGunnyStore, [KEY]: tampered } }, false);
  check('shop user: an Opening the office did not set is still refused', vt.some((x) => /Opening is the office/.test(x.detail)), describeStock(vt));
  const vta = inspectStockWrite(stored, { meGunnyStore: { ...stored.meGunnyStore, [KEY]: tampered } }, true);
  check('administrator: the same correction lands', vta.length === 0, describeStock(vta));
  // An administrator's saved correction is then the month as it stands, and a shop user's next Save keeps it.
  const stored2 = { ...stored, meGunnyStore: { ...stored.meGunnyStore, [KEY]: tampered } };
  const again = gunnyMonthRecords(tampered, prev, ctx, salesClose, {}, packSales, '2026-09-30T09:00:00.000Z');
  const v2 = inspectStockWrite(stored2, { meGunnyStore: { ...stored2.meGunnyStore, [KEY]: again } }, false);
  check('shop user: re-saving after an admin correction lands', v2.length === 0, describeStock(v2));
}

console.log('\n3. What is stored for Issues');
check('POLY: automatic Issues not stored (it keeps following the sales)', !('issues' in saved.poly));
check('C.BOX: automatic Issues not stored', !('issues' in saved.cbox));
check('50 KG SS: the keyed Issues 650 stored', saved.ss50.issues === 650);
{
  const later = gunnyRowFor('poly', saved, prev, salesClose, {}, { ...packSales, EMPTY_BAG: 70 });
  check('POLY Issues follow a later sale (63 → 70) after the Save', later.issues === 70 && later.issuesAuto);
}

console.log('\n4. Saving again, and next month');
{
  const twice = gunnyMonthRecords(saved, prev, ctx, salesClose, {}, packSales, NOW);
  check('a second Save of the same month stores the same figures', JSON.stringify(twice) === JSON.stringify(saved));
  const oct = Object.fromEntries(ME_GUNNY_ITEMS.map((i) => [i.id, gunnyRowFor(i.id, {}, saved, undefined, {}, {})]));
  check('October opens at September\'s Closing: 306 / 0 / 0',
    oct.ss50.opening === 306 && oct.poly.opening === 0 && oct.cbox.opening === 0 && oct.ss50.openingAuto, JSON.stringify(Object.values(oct).map((r) => r.opening)));
  const d = { [PREV]: prev, [KEY]: own, [NEXT]: { ss50: { opening: 1 } }, '9_9_2026': { ss50: { issues: 5 } } };
  const before = JSON.stringify({ a: d[PREV], b: d[NEXT], c: d['9_9_2026'] });
  d[KEY] = gunnyMonthRecords(d[KEY], d[PREV], ctx, salesClose, {}, packSales, NOW);
  check('only this shop and month is written (last month, next month, another shop untouched)', JSON.stringify({ a: d[PREV], b: d[NEXT], c: d['9_9_2026'] }) === before);
}

console.log('\n5. Refused, and asked');
{
  const ok = gunnySaveProblems(own, prev, salesClose, {}, packSales);
  check('the office\'s figures: nothing to refuse, nothing to ask', ok.errors.length === 0 && ok.deficits.length === 0, JSON.stringify(ok));
  const neg = gunnySaveProblems({ ss50: { issues: -5 } }, prev, salesClose, {}, packSales);
  check('negative Issues are refused', neg.errors.some((e) => /50 KG SS: Issues/.test(e)), JSON.stringify(neg));
  // Receipt is never typed since 2026-09-30 (Monthly Sales is its only source), so a stored
  // receiptImported is neither read nor judged; Opening and Issues still are.
  const nan = gunnySaveProblems({ poly: { opening: 'abc' }, cbox: { issues: 'x', receiptImported: -1 } }, prev, salesClose, {}, packSales);
  check('a non-number Opening and a non-number Issues are refused; a stored typed Receipt is not read', nan.errors.length === 2 && !nan.errors.some((e) => /Receipt/.test(e)), JSON.stringify(nan));
  const ignored = gunnyRowFor('cbox', { cbox: { receiptImported: 999 } }, prev, salesClose, {}, packSales);
  check(`…C.BOX Receipt stays Monthly Sales' ${ignored.rc.val} with a typed 999 stored`, ignored.rc.val === 56);
  const blank = gunnySaveProblems({ ss50: { issues: '' }, poly: { opening: '' } }, prev, salesClose, {}, packSales);
  check('blank boxes are not errors (blank = not keyed)', blank.errors.length === 0, JSON.stringify(blank));
  const zero = gunnySaveProblems({ ss50: { issues: 0 } }, prev, salesClose, {}, packSales);
  check('0 is an answer', zero.errors.length === 0);
  const over = gunnySaveProblems({ ss50: { issues: 1000 } }, prev, salesClose, {}, packSales);
  check('Issues over Total: asked, not refused', over.errors.length === 0 && over.deficits.length === 1 && /Closing -44/.test(over.deficits[0]), JSON.stringify(over));
}

console.log('\n6. Wiring');
{
  const page = readFileSync(join(root, 'src/app/(app)/monthly-entry/page.tsx'), 'utf8');
  const table = readFileSync(join(root, 'src/app/(app)/monthly-entry/GunnyTable.tsx'), 'utf8');
  // Since 2026-09-30 the month-close stores them through refreshGunnyFor → refreshGunnyMonths → gunnyMonthRecords.
  const libSrc = readFileSync(join(root, 'src/app/(app)/monthly-entry/lib.ts'), 'utf8');
  check('the month-close stores the gunny rows through the one rule (refreshGunnyFor → gunnyMonthRecords)',
    /refreshGunnyFor\(ctx\.crsId/.test(page) && /gunnyMonthRecords\(/.test(libSrc.slice(libSrc.indexOf('export function refreshGunnyMonths'))));
  check('…and has no gunny calculation of its own any more', !/gunnyRowFor\(item\.id/.test(page));
  check('the Save button stores through the same function', /d\[ctx\.key\] = gunnyMonthRecords\(/.test(table));
  const save = table.slice(table.indexOf('const save = async'), table.indexOf('const th ='));
  check('the tick waits for the database (saveConfirmed before saveSuccess)', /if \(await crsData\.saveConfirmed\(\)\) \{\s*saveSuccess\(gunnySaved\(/.test(save));
  check('a second tap while saving is ignored', /if \(busy\.current\) return;/.test(save));
  check('validation runs before anything is written', save.indexOf('gunnySaveProblems') < save.indexOf('crsData.update'));
  // Opening and Receipt stay the office's; Issues are typed by the shop too (office, 2026-09-30).
  check('the inputs\' read-only rules: Opening / Receipt admin-only, Issues typed by everyone', /readOnly=\{!isAdmin\}/.test(table) && !/readOnly=\{issuesAuto && !isAdmin\}/.test(table));
  check('the button is below the notes, never over the table', table.indexOf('gunny-save-bar') > table.indexOf('Closing = Total − Issues'));
  const w = gunnySaved(8, 9, 2026);
  check(`wording: "${w.title}" / "${w.detail}"`, w.title === 'Gunny Stock Saved Successfully' && w.detail === 'Gunny Stock for September 2026 has been saved successfully.' && w.key === 'gunny:8:9:2026');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll gunny-save checks passed.');
process.exitCode = failures ? 1 : 0;
