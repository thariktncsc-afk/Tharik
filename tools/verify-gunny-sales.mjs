/**
 * C.Box / Poly sales, and who may key Gunny Stock Management
 * (office, 2026-09-26).
 *
 *   node tools/verify-gunny-sales.mjs
 *
 * A sale of empty card boxes or polythene bags used to leave the grid with a
 * negative closing balance — 166 sold against nothing stocked reads −166.000 —
 * because those bags are not stocked on the sales grid at all. They are held
 * in Gunny Stock Management, and the binding ran the wrong way: typing Issues
 * there WROTE the sales row. Now the sale is the Issues figure, the grid shows
 * no closing for those two lines, and the gunny figures are the office's:
 * shop staff may not key them, in the screen or through /api/state.
 *
 * The rule (monthly-entry/lib.ts `gunnyRowFor`), its legacy twin for the
 * statements (42-gunny-live.js) and the server guard are all exercised here.
 * No database, nothing live.
 */
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
const { gunnyRowFor, NO_CLOSING } = await imp('src/app/(app)/monthly-entry/lib.ts');
const { inspectStockWrite, describeStock } = await imp('src/lib/stockGuard.ts');
const { createStatementEngine } = await imp('src/generated/statements-legacy.js');

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const J = (v) => JSON.stringify(v);

const CRS = 8, MONTH = 9, YEAR = 2026, KEY = `${CRS}_${MONTH}_${YEAR}`, PREV = `${CRS}_8_${YEAR}`;
/** The office's screenshot: 166 card boxes and 61 polythene bags sold. */
const SALES = { EMPTY_BOX: 166, EMPTY_BAG: 61 };
const NONE = {};

console.log('\n1. The sale becomes the Gunny Issues figure');
{
  // Last month closed with 400 boxes and 100 bags; nothing received this month.
  const prev = { cbox: { closing: 400 }, poly: { closing: 100 }, ss50: { closing: 900 } };
  const box = gunnyRowFor('cbox', NONE, prev, undefined, {}, SALES);
  const bag = gunnyRowFor('poly', NONE, prev, undefined, {}, SALES);
  check('C.BOX: opening 400 carried, issues 166 from the sale, closing 234', box.opening === 400 && box.issues === 166 && box.closing === 234, J(box));
  check('POLY: opening 100 carried, issues 61 from the sale, closing 39', bag.opening === 100 && bag.issues === 61 && bag.closing === 39, J(bag));
  check('both are marked automatic, so the screen can lock them', box.issuesAuto && bag.issuesAuto);
  check('Total is still Opening + Receipt, untouched by the sale', box.total === 400 && bag.total === 100);

  const ss = gunnyRowFor('ss50', NONE, prev, undefined, {}, SALES);
  check('50 KG SS has no commodity row: its Issues stay blank and hand-keyed', ss.issues === '' && ss.issuesAuto === false, J(ss));
  const ssKeyed = gunnyRowFor('ss50', { ss50: { issues: 120 } }, prev, undefined, {}, SALES);
  check('…and a keyed 50 KG SS Issues still works: 900 − 120 = 780', ssKeyed.issues === 120 && ssKeyed.closing === 780, J(ssKeyed));

  const corrected = gunnyRowFor('cbox', { cbox: { issues: 150 } }, prev, undefined, {}, SALES);
  check('an administrator\'s correction wins over the sale: 150, closing 250', corrected.issues === 150 && corrected.closing === 250 && corrected.issuesAuto === false, J(corrected));

  const noSale = gunnyRowFor('cbox', NONE, prev, undefined, {}, { EMPTY_BOX: 0 });
  check('no sale keyed: issues 0, closing is the whole opening', noSale.issues === 0 && noSale.closing === 400, J(noSale));
  const noGrid = gunnyRowFor('cbox', NONE, prev, undefined, {});
  check('a caller with no sales figures at all leaves Issues blank', noGrid.issues === '' && noGrid.issuesAuto === false, J(noGrid));
}

console.log('\n2. Deducted once, and only there');
{
  const prev = { cbox: { closing: 400 } };
  const row = gunnyRowFor('cbox', NONE, prev, undefined, {}, SALES);
  check('the sale is not counted twice: 400 − 166 = 234, not 68', row.closing === 234, J(row));
  check('C.Box and Poly show no Closing on the entry grid', NO_CLOSING.has('EMPTY_BOX') && NO_CLOSING.has('EMPTY_BAG'));
  check('every other commodity still shows its Closing', !NO_CLOSING.has('BRA') && !NO_CLOSING.has('SUGAR') && !NO_CLOSING.has('PALM') && NO_CLOSING.size === 2);
}

console.log('\n3. Next month opens where this one closed');
{
  // What Monthly Entry writes out on save: the derived copies, and NO issues
  // figure — a stored one would read as the office's own and stop following
  // the sales.
  const saved = { cbox: { itemName: 'C.BOX', opening: 400, openingAuto: true, receipt: 0, total: 400, closing: 234 } };
  const reread = gunnyRowFor('cbox', saved, { cbox: { closing: 400 } }, undefined, {}, SALES);
  check('a saved month still takes its Issues from the sales', reread.issues === 166 && reread.issuesAuto === true && reread.closing === 234, J(reread));
  const afterSaleEdited = gunnyRowFor('cbox', saved, { cbox: { closing: 400 } }, undefined, {}, { EMPTY_BOX: 200 });
  check('…so correcting the sale to 200 moves the gunny row with it: closing 200', afterSaleEdited.issues === 200 && afterSaleEdited.closing === 200, J(afterSaleEdited));

  const sept = { cbox: { closing: 234 }, poly: { closing: 39 } };
  const oct = gunnyRowFor('cbox', NONE, sept, undefined, {}, { EMPTY_BOX: 0 });
  check('October opens at September\'s 234, carried and locked', oct.opening === 234 && oct.openingAuto === true, J(oct));
  const octAfterFix = gunnyRowFor('cbox', NONE, { cbox: { closing: 250 } }, undefined, {}, { EMPTY_BOX: 0 });
  check('an administrator corrects September to 250 → October opens at 250', octAfterFix.opening === 250, J(octAfterFix));
}

console.log('\n4. /api/state refuses a shop user keying the gunny figures');
{
  const stored = {
    meGunnyStore: { [PREV]: { cbox: { closing: 400 } }, [KEY]: {} },
    monthlyStore: { [KEY]: { a: { EMPTY_BOX: { sales: 166 }, EMPTY_BAG: { sales: 61 } }, b: {} } },
  };
  const write = (row) => ({ meGunnyStore: { ...stored.meGunnyStore, [KEY]: { cbox: { itemName: 'C.BOX', ...row } } } });
  const asShop = (row) => inspectStockWrite(stored, write(row), false);
  const asAdmin = (row) => inspectStockWrite(stored, write(row), true);

  // What the screen itself sends: the derived copies.
  const honest = { opening: 400, receipt: 0, total: 400, issues: 166, closing: 234 };
  check('the screen\'s own write lands', asShop(honest).length === 0, describeStock(asShop(honest)));

  const openTamper = asShop({ ...honest, opening: 900, total: 900, closing: 734 });
  check('a shop user inventing an Opening of 900 is refused', openTamper.length > 0 && /Opening is the office's figure: 400/.test(describeStock(openTamper)), describeStock(openTamper));
  const rcTamper = asShop({ ...honest, receipt: 500, total: 900, closing: 734 });
  check('…a Receipt of 500 is refused', rcTamper.some((v) => /Receipt is the office/.test(v.detail)), describeStock(rcTamper));
  const closeTamper = asShop({ ...honest, closing: 999 });
  check('…a Closing of 999 is refused', closeTamper.some((v) => /Closing is the office/.test(v.detail)), describeStock(closeTamper));
  const totalTamper = asShop({ ...honest, total: 999 });
  check('…a Total of 999 is refused', totalTamper.some((v) => /Total is the office/.test(v.detail)), describeStock(totalTamper));
  const issuesTamper = asShop({ ...honest, issues: 5, closing: 395 });
  check('…and C.BOX Issues of 5 against a sale of 166 is refused', issuesTamper.some((v) => /Issues is the office/.test(v.detail)), describeStock(issuesTamper));

  check('an administrator may key all of them', asAdmin({ opening: 900, receipt: 500, total: 1400, issues: 5, closing: 1395 }).length === 0);
  check('the refusal names the store, so /api/state can say "Gunny Stock"', openTamper[0].store === 'meGunnyStore' && openTamper[0].kind === 'gunny-locked');

  // 50 KG SS: the shop's own figure, and its arithmetic still checked.
  const ssStored = { meGunnyStore: { [PREV]: { ss50: { closing: 900 } }, [KEY]: {} }, monthlyStore: {} };
  const ssWrite = (row) => ({ meGunnyStore: { ...ssStored.meGunnyStore, [KEY]: { ss50: row } } });
  check('a shop user may key 50 KG SS Issues: 900 − 120 = 780',
    inspectStockWrite(ssStored, ssWrite({ opening: 900, receipt: 0, total: 900, issues: 120, closing: 780 }), false).length === 0,
    describeStock(inspectStockWrite(ssStored, ssWrite({ opening: 900, receipt: 0, total: 900, issues: 120, closing: 780 }), false)));
  const ssBad = inspectStockWrite(ssStored, ssWrite({ opening: 900, receipt: 0, total: 900, issues: 120, closing: 900 }), false);
  check('…but a Closing that does not follow from it is refused', ssBad.some((v) => /Closing is the office/.test(v.detail)), describeStock(ssBad));

  check('a write that changes nothing is not judged', inspectStockWrite(stored, { meGunnyStore: stored.meGunnyStore }, false).length === 0);
  check('another store is untouched by this rule', inspectStockWrite(stored, { meCardStore: { [KEY]: { rice: { count: 5 } } } }, false).length === 0);
}

console.log('\n5. The statements follow the same rule');
{
  const engine = (gunny, sales) => createStatementEngine({
    stores: {
      entryStore: {}, inspectionStore: {},
      monthlyStore: { [KEY]: { a: { EMPTY_BOX: { sales: sales.EMPTY_BOX ?? 0 }, EMPTY_BAG: { sales: sales.EMPTY_BAG ?? 0 } }, b: {} } },
      meManualStore: {}, meSourceStore: {}, meRemitStore: {}, meGunnyStore: gunny, meCardStore: {},
      salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [], CRS_MASTER: [{ id: CRS, coll: false, police: false }],
    CRS_LIST: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Shop ${i + 1}` })),
  });
  const g = { [PREV]: { cbox: { closing: 400 }, poly: { closing: 100 } }, [KEY]: {} };
  const d = engine(g, SALES).getData(CRS, MONTH, YEAR);
  check('the Gunny statement deducts the sale: C.BOX 400 − 166 = 234', d.gunny.cbox.iss === 166 && d.gunny.cbox.cb === 234, J(d.gunny.cbox));
  check('…and POLY 100 − 61 = 39', d.gunny.poly.iss === 61 && d.gunny.poly.cb === 39, J(d.gunny.poly));
  const keyed = engine({ ...g, [KEY]: { cbox: { issues: 150 } } }, SALES).getData(CRS, MONTH, YEAR);
  check('an administrator\'s keyed Issues wins there too: 150', keyed.gunny.cbox.iss === 150 && keyed.gunny.cbox.cb === 250, J(keyed.gunny.cbox));
  const quiet = engine(g, {}).getData(CRS, MONTH, YEAR);
  check('a month with no C.Box/Poly sales is exactly as it was: 400 and 100 carried', quiet.gunny.cbox.cb === 400 && quiet.gunny.poly.cb === 100, J([quiet.gunny.cbox, quiet.gunny.poly]));
  check('50 KG SS is untouched by any of this', quiet.gunny.ss50.iss === 0);
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
