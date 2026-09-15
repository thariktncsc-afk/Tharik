/**
 * CRS 29's Free Rice and Cost Rice, as executable cases.
 *
 *   node tools/verify-crs29-rice.mjs      (after npm run build:stmt)
 *
 * Four things are under test:
 *
 *   - what counts as entered — 0 does, blank does not (engine/crs29Rice.ts)
 *   - what /api/state refuses, and that no other shop is touched by it
 *   - that a monthly-keyed month keeps its figures on the projected last-day
 *     sheet when a receipt resync rebuilds it
 *   - that C RICE prints them where the camp's own sheet has room, and that no
 *     other CRS 29 section changes because a sheet carries them
 *
 * `verify:statements` proves the sheet-without-figures case byte for byte;
 * the golden data has no CRS 29 day sheets. This proves the other case.
 *
 * The C RICE figures are the camp's own August 2026 sheet: on 6 Aug RBA 405,
 * BRA 3223, Free 3628, Cost 2748, Total 6376; on 8 Aug 307, 3475, 3781, 2724,
 * 6505.
 *
 * Runs the TypeScript source directly (Node >= 23.6 strips types).
 */
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

const R = await import(pathToFileURL(join(root, 'src/lib/engine/crs29Rice.ts')).href);
const SY = await import(pathToFileURL(join(root, 'src/lib/engine/receiptSync.ts')).href);
const { createStatementEngine } = await import(pathToFileURL(join(root, 'src/generated/statements-legacy.js')).href);

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** One commodity row that adds up: total = open+receipt, close = total−sales. */
const row = (open, receipt, sales) => ({ open, receipt, total: open + receipt, sales, close: open + receipt - sales, amount: 0 });
const rcp = (id, crsId, date, items, extra = {}) => ({ id, crsId, date, receiptNo: `R/${id}`, items, ...extra });
const PROJ = { source: 'monthly', at: '2026-08-31T10:00:00Z' };

console.log('\nWhat counts as entered');
{
  check('0 and 0 are both answers', same(R.checkRiceBoxes('0', '0').rice, { freeRice: 0, costRice: 0 }));
  const blankFree = R.checkRiceBoxes('', '0');
  check('a blank Free Rice is refused', blankFree.rice === null && blankFree.free === 'missing' && blankFree.cost === undefined);
  check('...and it is "missing", not "invalid"', blankFree.invalid === false);
  const blankCost = R.checkRiceBoxes('12.5', '   ');
  check('whitespace is still blank', blankCost.rice === null && blankCost.cost === 'missing');
  check('a negative figure is invalid', R.checkRiceBoxes('-1', '5').free === 'invalid' && R.checkRiceBoxes('-1', '5').invalid);
  check('text is invalid', R.checkRiceBoxes('abc', '5').invalid);
  check('the camp’s figures read back as kilos', same(R.checkRiceBoxes(' 3628 ', '2748').rice, { freeRice: 3628, costRice: 2748 }));
  check('kilos keep three decimals', R.checkRiceBoxes('1.23456', '0').rice.freeRice === 1.235);

  check('a saved 0 refills its box as 0, not blank', R.riceBox(0) === '0');
  check('nothing saved refills blank', R.riceBox(undefined) === '');
  check('a decimal refills as typed', R.riceBox(12.5) === '12.5');
  check('a stored string is not a figure', R.riceBox('5') === '');

  check('riceOf reads a pair of zeros', same(R.riceOf({ freeRice: 0, costRice: 0 }), { freeRice: 0, costRice: 0 }));
  check('riceOf wants both', R.riceOf({ freeRice: 1 }) === null);
  check('riceOf refuses a negative', R.riceOf({ freeRice: -1, costRice: 1 }) === null);
  check('riceOf refuses a string', R.riceOf({ freeRice: '1', costRice: 1 }) === null);
  check('riceOf of nothing is null', R.riceOf(null) === null && R.riceOf(undefined) === null);

  const plain = { a: {}, b: {} };
  check('withRice with nothing to write returns the same sheet', R.withRice(plain, null) === plain);
  const written = R.withRice(plain, { freeRice: 1, costRice: 2 });
  check('withRice writes both figures', written.freeRice === 1 && written.costRice === 2);
  check('...without touching the sheet it was given', !('freeRice' in plain));

  check('CRS 29 has the fields', R.hasRiceFields(29));
  check('CRS 1, 28 and 30 do not', !R.hasRiceFields(1) && !R.hasRiceFields(28) && !R.hasRiceFields(30));
  check('no shop selected has none', !R.hasRiceFields(null));
}

console.log('\nWhat /api/state refuses');
{
  const D = '29_2026-08-06';
  const sheet = (extra = {}) => ({ a: { BRA: row(5000, 0, 3223), RRA: row(1000, 0, 405) }, b: {}, remits: [{ id: 'r1', amount: 100, date: '2026-08-06', account: 'nc' }], ...extra });
  const judge = (before, after) => R.inspectRiceWrite({ entryStore: before }, { entryStore: after });
  const kinds = (v) => v.map((x) => x.kind).join(',');

  const bare = judge({}, { [D]: sheet() });
  check('a new CRS 29 day sheet without the figures is refused', kinds(bare) === 'missing');
  check('...with the message the screen shows', bare[0]?.detail === R.RICE_DAILY_REQUIRED);
  check('...naming the day', R.describeRice(bare).startsWith('CRS 29 2026-08-06:'));
  check('a new sheet with 0 and 0 passes', judge({}, { [D]: sheet({ freeRice: 0, costRice: 0 }) }).length === 0);
  check('a new sheet with the camp’s figures passes', judge({}, { [D]: sheet({ freeRice: 3628, costRice: 2748 }) }).length === 0);

  check('CRS 1 is never asked', judge({}, { '1_2026-08-06': sheet() }).length === 0);
  check('nor CRS 28 or CRS 30', judge({}, { '28_2026-08-06': sheet(), '30_2026-08-06': sheet() }).length === 0);
  check('CRS 2 does not match CRS 29 by prefix', judge({}, { '2_2026-08-06': sheet() }).length === 0);

  const legacy = sheet();
  check('an untouched sheet saved before the fields existed passes', judge({ [D]: legacy }, { [D]: legacy }).length === 0);
  check(
    '...and so does the Receipt page re-closing it',
    judge({ [D]: legacy }, { [D]: { ...legacy, a: { ...legacy.a, BRA: row(5000, 500, 3223) } } }).length === 0,
  );

  const had = sheet({ freeRice: 3628, costRice: 2748 });
  check('figures once saved cannot be stripped', kinds(judge({ [D]: had }, { [D]: sheet() })) === 'removed');
  check('...but can be corrected', judge({ [D]: had }, { [D]: sheet({ freeRice: 3600, costRice: 2776 }) }).length === 0);
  check('...or corrected to 0', judge({ [D]: had }, { [D]: sheet({ freeRice: 0, costRice: 0 }) }).length === 0);
  check('one without the other is not a pair', kinds(judge({ [D]: had }, { [D]: sheet({ freeRice: 3628 }) })) === 'missing');
  check('...even on a sheet that never had them', kinds(judge({ [D]: legacy }, { [D]: sheet({ costRice: 5 }) })) === 'missing');

  check('a negative figure is refused', kinds(judge({}, { [D]: sheet({ freeRice: -1, costRice: 0 }) })) === 'invalid');
  check('a string figure is refused', kinds(judge({}, { [D]: sheet({ freeRice: '3628', costRice: 0 }) })) === 'invalid');
  check('a null figure is refused', kinds(judge({}, { [D]: sheet({ freeRice: null, costRice: 0 }) })) === 'invalid');

  const L = '29_2026-08-31';
  const projection = (extra = {}) => ({ a: { BRA: row(5000, 0, 4000) }, b: {}, __projection: PROJ, ...extra });
  const bareProj = judge({}, { [L]: projection() });
  check('a new month-close sheet without the figures is refused', kinds(bareProj) === 'missing');
  check('...with the Monthly Entry wording', bareProj[0]?.detail === R.RICE_MONTHLY_REQUIRED);
  check('a month-close sheet with them passes', judge({}, { [L]: projection({ freeRice: 5600, costRice: 4000 }) }).length === 0);
  check(
    'a day sheet taking over an old projection must bring its own figures',
    kinds(judge({ [L]: projection() }, { [L]: { a: { BRA: row(5000, 0, 100) }, b: {} } })) === 'missing',
  );
  check(
    'an old projection rebuilt by a receipt resync is left alone',
    judge({ [L]: projection() }, { [L]: projection({ a: { BRA: row(5000, 500, 4000) }, b: {} }) }).length === 0,
  );

  check('removing a sheet is the clear guard’s business, not this one', judge({ [D]: had }, {}).length === 0);
  check('month keys in entryStore are not day sheets', judge({}, { '29_8_2026': sheet() }).length === 0);
  check('a payload without entryStore has nothing to judge', R.inspectRiceWrite({ entryStore: { [D]: had } }, { meManualStore: {} }).length === 0);
}

console.log('\nThe month');
{
  const store = {
    '29_2026-08-06': { a: {}, b: {}, freeRice: 3628, costRice: 2748 },
    '29_2026-08-08': { a: {}, b: {}, freeRice: 3781, costRice: 2724 },
    '29_2026-08-10': { a: {}, b: {} },
    '29_2026-09-01': { a: {}, b: {}, freeRice: 1, costRice: 1 },
    '2_2026-08-06': { a: {}, b: {}, freeRice: 100, costRice: 100 },
    '29_2026-08-31': { a: {}, b: {}, __projection: PROJ, freeRice: 5, costRice: 5 },
  };
  const m = R.riceForMonth(store, 29, 8, 2026);
  check('a day-keyed month totals its day sheets', m.freeRice === 7409 && m.costRice === 5472);
  check('...counting only that shop, that month, and real sheets', m.sheets === 3);
  check('...and lists the sheet saved before the fields existed', same(m.missing, ['2026-08-10']));
}
{
  // The monthly-keyed month: its figures live on the projected sheet, and a
  // receipt deleted afterwards must not wash them off when it is rebuilt.
  const mrec = (open, receipt, sales) => {
    const total = open + receipt;
    return { open, receipt, total, sales, close: total - sales, amount: 0, excess: 0, shortage: 0, transfer: 0, cs: 0, g_cs: 0,
      g_open: open / 50, g_receipt: receipt / 50, g_total: total / 50, g_sales: sales / 50, g_close: (total - sales) / 50 };
  };
  const L = '29_2026-08-31';
  const had = [rcp(15, 29, '2026-08-31', { BRA: { qty: 1000 } })];
  const before = { a: { BRA: row(1000, 1000, 1000) }, b: {}, __projection: PROJ, freeRice: 5600, costRice: 4000 };
  const patch = SY.resyncReceiptMonth(
    {
      entryStore: { [L]: JSON.parse(JSON.stringify(before)) },
      inspectionStore: {},
      meManualStore: { '29_8_2026': { a: { BRA: mrec(1000, 1000, 1000) }, b: {} } },
      meSourceStore: { '29_8_2026': { a: { BRA: 'receipt' }, b: {} } },
      monthlyStore: { '29_8_2026': { a: { BRA: mrec(1000, 1000, 1000) }, b: {} } },
      receiptStore: [],
    },
    29, 8, 2026, { dateIso: '2026-08-31', before: had },
  );
  const proj = patch.entryStore?.[L];
  check('the projected sheet is rebuilt without the deleted receipt', proj?.a.BRA.receipt === 0 && !!proj?.__projection);
  check('...and keeps the Free Rice and Cost Rice keyed at the month-close', proj?.freeRice === 5600 && proj?.costRice === 4000);
  check('the rebuilt sheet passes the rice guard', R.inspectRiceWrite({ entryStore: { [L]: before } }, { entryStore: patch.entryStore }).length === 0);

  const other = SY.resyncReceiptMonth(
    {
      entryStore: { '1_2026-08-31': { a: { BRA: row(1000, 1000, 1000) }, b: {}, __projection: PROJ } },
      inspectionStore: {},
      meManualStore: { '1_8_2026': { a: { BRA: mrec(1000, 1000, 1000) }, b: {} } },
      meSourceStore: { '1_8_2026': { a: { BRA: 'receipt' }, b: {} } },
      monthlyStore: {},
      receiptStore: [],
    },
    1, 8, 2026, { dateIso: '2026-08-31', before: [rcp(16, 1, '2026-08-31', { BRA: { qty: 1000 } })] },
  );
  const p1 = other.entryStore?.['1_2026-08-31'];
  check('another shop’s rebuilt projection gains no rice fields', !!p1 && !('freeRice' in p1) && !('costRice' in p1));
}

console.log('\nThe CRS 29 statement');
const CRS_LIST = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` }));
const engineFor = (entryStore) =>
  createStatementEngine({
    stores: {
      entryStore, inspectionStore: {}, monthlyStore: {}, meManualStore: {}, meSourceStore: {}, meRemitStore: {},
      meGunnyStore: {}, meCardStore: {}, salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [], CRS_LIST, CRS_MASTER: [], TN_GOVT_HOLIDAYS: undefined, APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });

/** A CRS 29 day as Daily Entry saves it: rice and sugar sold, figures optional. */
const campDay = (bra, rra, rice) => ({
  a: { BRA: row(20000, 0, bra), RRA: row(5000, 0, rra), SUGAR: { ...row(3000, 0, 270.5), amount: 270.5 * 25 } },
  b: {},
  remits: [{ id: 'r', amount: 6762.5, date: '2026-08-06', account: 'nc' }],
  remitAmount: 6762.5,
  remitDate: '2026-08-06',
  ...(rice ? { freeRice: rice[0], costRice: rice[1] } : {}),
});
const withFigures = {
  '29_2026-08-06': campDay(3223, 405, [3628, 2748]),
  '29_2026-08-08': campDay(3475, 307, [3781, 2724]),
  '29_2026-08-10': campDay(100, 0, null), // saved before the fields existed
  '29_2026-08-12': campDay(0, 0, [0, 0]),
  '29_2026-09-30': { a: { BRA: row(20000, 0, 5000), RRA: row(5000, 0, 600) }, b: {}, __projection: PROJ, freeRice: 5600, costRice: 4000 },
  '1_2026-08-06': campDay(50, 0, null),
};
const stripped = Object.fromEntries(
  Object.entries(withFigures).map(([k, v]) => {
    const { freeRice: _f, costRice: _c, ...rest } = v;
    return [k, rest];
  }),
);

/** C RICE rows by date → the seven figure cells after SL NO and DATE. */
const riceRows = (html) => {
  const out = {};
  for (const m of html.matchAll(/<tr><td>\d+<\/td><td>(\d\d\/\d\d\/\d{4})<\/td>((?:<td>[^<]*<\/td>)+)<\/tr>/g)) {
    out[m[1]] = [...m[2].matchAll(/<td>([^<]*)<\/td>/g)].map((c) => c[1]);
  }
  const total = /<tr class="sub"><td><\/td><td>TOTAL<\/td>((?:<td>[^<]*<\/td>)+)<\/tr>/.exec(html);
  out.TOTAL = total ? [...total[1].matchAll(/<td>([^<]*)<\/td>/g)].map((c) => c[1]) : null;
  return out;
};

{
  const on = engineFor(withFigures);
  const off = engineFor(stripped);
  check('C RICE is one of CRS 29’s sections', on.sectionsFor(29).some((s) => s.id === 'c_rice'));
  check('...and not CRS 1’s', !on.sectionsFor(1).some((s) => s.id === 'c_rice'));

  const aug = riceRows(on.buildSection('c_rice', on.getData(29, 8, 2026)));
  const cells = (ds) => (aug[ds] ?? []).join(' | ');
  check('6 Aug prints the camp’s row: RBA 405, BRA 3223, Free 3628, Cost 2748, Total 6376',
    cells('06/08/2026') === '405 | 3223 | 3628 | 2748 | 6376 |  | ', cells('06/08/2026'));
  check('8 Aug: 307, 3475, Free 3781 as keyed, Cost 2724, Total 6505',
    cells('08/08/2026') === '307 | 3475 | 3781 | 2724 | 6505 |  | ', cells('08/08/2026'));
  check('a sheet saved before the fields existed prints as it always did',
    cells('10/08/2026') === '0 | 100 | 100 | 0 | 100 |  | ', cells('10/08/2026'));
  check('0 and 0 keyed print as 0', cells('12/08/2026') === '0 | 0 | 0 | 0 | 0 |  | ', cells('12/08/2026'));
  check('a day with no sheet prints zeros', cells('07/08/2026') === '0 | 0 | 0 | 0 | 0 |  | ', cells('07/08/2026'));
  check('the TOTAL row is the month: 712, 6798, Free 7509, Cost 5472, Total 12981',
    (aug.TOTAL ?? []).join(' | ') === '712 | 6798 | 7509 | 5472 | 12981 | 0 | 0', (aug.TOTAL ?? []).join(' | '));
  check('the month has every day and nothing else', Object.keys(aug).length === 32);

  const sep = riceRows(on.buildSection('c_rice', on.getData(29, 9, 2026)));
  check('a monthly-keyed month prints its figures on the last day',
    (sep['30/09/2026'] ?? []).join(' | ') === '600 | 5000 | 5600 | 4000 | 9600 |  | ', (sep['30/09/2026'] ?? []).join(' | '));
  check('...and in its TOTAL row', (sep.TOTAL ?? []).join(' | ') === '600 | 5000 | 5600 | 4000 | 9600 | 0 | 0', (sep.TOTAL ?? []).join(' | '));

  const augOff = riceRows(off.buildSection('c_rice', off.getData(29, 8, 2026)));
  check('without the figures 6 Aug falls back to the derived split',
    (augOff['06/08/2026'] ?? []).join(' | ') === '405 | 3223 | 3628 | 0 | 3628 |  | ', (augOff['06/08/2026'] ?? []).join(' | '));

  for (const [crs, month] of [[29, 8], [29, 9], [1, 8]]) {
    const dOn = on.getData(crs, month, 2026);
    const dOff = off.getData(crs, month, 2026);
    const changed = on
      .sectionsFor(crs)
      .map((s) => s.id)
      // C RICE prints both figures and the Sales Report prints Cost Rice
      // (41-crs29-sales-report.js); nothing else may move.
      .filter((id) => id !== 'c_rice' && id !== 'sales_report' && on.buildSection(id, dOn) !== off.buildSection(id, dOff));
    check(`CRS ${crs} ${month}/2026: no section but C RICE and SALES REPORT changes because a sheet carries the figures`, changed.length === 0, changed.join(', '));
  }
}

console.log(`\n${failures ? `${failures} FAILED` : 'CRS 29 RICE OK'}`);
if (failures) process.exitCode = 1;
