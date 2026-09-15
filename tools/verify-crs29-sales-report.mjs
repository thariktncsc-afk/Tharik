/**
 * CRS 29's Sales Report against the office's own sheet.
 *
 *   node tools/verify-crs29-sales-report.mjs      (after npm run build:stmt)
 *
 * "CRS 29-REFUGEE CAMP AUG'26 - SALES REPORT.pdf" is the format. Its trading
 * days are keyed below the way Daily Entry saves them — each commodity's sales
 * and the day's Cost Rice, nothing more — and the rendered report must print
 * the PDF's figures: every quantity, every amount, the TOTAL row, the titles
 * and the headings.
 *
 * The amounts are the independent check. The PDF's TOTAL SALE AMOUNT was
 * worked out by the office, not by this code, so each PDF row is first checked
 * against the rates on its own (6 Aug: 270.50 × 25 + 198 × 30 + 198 × 25 =
 * 17652.50) before the report is asked to match it.
 *
 * Geometry is the PDF's too: the column rules and the page it prints on.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

const CRS_LIST = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `CRS ${i + 1}` }));
const engineFor = (entryStore) =>
  createStatementEngine({
    stores: {
      entryStore, inspectionStore: {}, monthlyStore: {}, meManualStore: {}, meSourceStore: {}, meRemitStore: {},
      meGunnyStore: {}, meCardStore: {}, salesCloseStore: {}, receiptStore: [], meAllotStore: {}, meCardConfirmed: {}, meAdvanceStore: {},
    },
    users: [], CRS_LIST, CRS_MASTER: [], TN_GOVT_HOLIDAYS: undefined, APP_CONFIG: {}, CRS_ACCOUNTS: {}, currentUser: null,
  });

const row = (s) => ({ open: 0, receipt: 0, total: 0, sales: s, close: -s, amount: 0 });
/** A CRS 29 day sheet as Daily Entry saves it: every commodity, plus the rice figures. */
const day = ({ bra = 0, cost = 0, rra = 0, sugar = 0, toor = 0, palm = 0, kero = 0, wheat = 0 }) => ({
  a: { BRA: row(bra), RRA: row(rra), SUGAR: row(sugar), WHEAT: row(wheat), TOOR: row(toor), PALM: row(palm), KERO: row(kero) },
  b: {},
  remits: [{ id: 'r', amount: 1, date: '2026-08-01', account: 'nc' }],
  remitAmount: 1,
  remitDate: '2026-08-01',
  freeRice: bra + rra,
  costRice: cost,
});

/** Rows of the report: class list and raw cell contents. */
const rowsOf = (html) =>
  [...html.matchAll(/<tr class="([^"]*)">([\s\S]*?)<\/tr>/g)].map((m) => ({
    cls: m[1].split(' '),
    raw: m[2],
    cells: [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]),
  }));
const text = (h) => h.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// ── The PDF, as printed ─────────────────────────────────────────────────────
// SL, DATE, BRA FREE, BRA COST, RRA, SUGAR, T.DHALL, P.OIL, KEROSENE, AMOUNT
const PDF_ROWS = {
  '06/08/2026': ['6', '06/08/2026', '3223.00', '2748.00', '405.00', '270.50', '198.00', '198.00', '', '17652.50'],
  '08/08/2026': ['8', '08/08/2026', '3475.00', '2724.00', '306.00', '276.00', '201.00', '201.00', '', '17955.00'],
  '21/08/2026': ['21', '21/08/2026', '', '', '', '', '', '', '1224.00', '19094.40'],
  '22/08/2026': ['22', '22/08/2026', '', '', '', '', '', '', '955.00', '14898.00'],
  '25/08/2026': ['25', '25/08/2026', '4725.00', '3874.00', '340.00', '374.00', '271.00', '271.00', '', '24255.00'],
  '27/08/2026': ['27', '27/08/2026', '1616.00', '1221.00', '206.00', '128.50', '100.00', '100.00', '', '8712.50'],
};
const PDF_TOTAL = ['32', 'TOTAL', '13039.00', '10567.00', '1257.00', '1049.00', '770.00', '770.00', '2179.00', '102567.40'];
const PDF_TITLES = ['TAMIL CIVIL SUPPLIES CORPORATION - MADURAI REGION', 'CRS-29   REFUGEE CAMP AANAIYUR', "SALES REPORT - DATE WISE - AUG'26"];
const PDF_RULES = [90.4, 109.1, 157.4, 201.5, 249.2, 295.7, 343.4, 390.5, 438.2, 486.5, 541.4];

console.log('\nThe PDF agrees with the rates on its own');
{
  const n = (s) => (s === '' ? 0 : Number(s));
  for (const [date, c] of Object.entries(PDF_ROWS)) {
    const worked = n(c[5]) * 25 + n(c[6]) * 30 + n(c[7]) * 25 + n(c[8]) * 15.6;
    check(`${date}: sugar×25 + dhall×30 + oil×25 + kerosene×15.60 = ${c[9]}`, Math.abs(worked - n(c[9])) < 0.005, `worked out ${worked}`);
  }
  const cols = [2, 3, 4, 5, 6, 7, 8, 9].map((i) => Object.values(PDF_ROWS).reduce((s, c) => s + n(c[i]), 0).toFixed(2));
  check('its TOTAL row is the sum of its days', same(cols, PDF_TOTAL.slice(2)), cols.join(' | '));
}

console.log('\nAugust 2026, keyed as the camp keyed it');
const AUG = {
  '29_2026-08-06': day({ bra: 3223, cost: 2748, rra: 405, sugar: 270.5, toor: 198, palm: 198, wheat: 50 }),
  '29_2026-08-08': day({ bra: 3475, cost: 2724, rra: 306, sugar: 276, toor: 201, palm: 201 }),
  '29_2026-08-21': day({ kero: 1224 }),
  '29_2026-08-22': day({ kero: 955 }),
  '29_2026-08-25': day({ bra: 4725, cost: 3874, rra: 340, sugar: 374, toor: 271, palm: 271 }),
  '29_2026-08-27': day({ bra: 1616, cost: 1221, rra: 206, sugar: 128.5, toor: 100, palm: 100 }),
};
{
  const engine = engineFor(AUG);
  const html = engine.buildSection('sales_report', engine.getData(29, 8, 2026));
  const rows = rowsOf(html);
  const titles = rows.filter((r) => r.cls.includes('t'));
  const h1 = rows.find((r) => r.cls.includes('h1'));
  const h2 = rows.find((r) => r.cls.includes('h2'));
  const days = rows.filter((r) => r.cls.includes('g') && !r.cls.includes('h1') && !r.cls.includes('h2') && !r.cls.includes('tot'));
  const total = rows.find((r) => r.cls.includes('tot'));

  check('the three title lines are the sheet’s, word for word', same(titles.map((r) => r.cells[0]), PDF_TITLES), titles.map((r) => r.cells[0]).join(' / '));
  check('each title spans the whole table', titles.every((r) => /colspan="10"/.test(r.raw)));
  check(
    'the headings are the sheet’s',
    same(h1?.cells.map(text), ['SL NO', 'DATE OF SALES', 'BRA', 'RRA', 'SUGAR', 'T.DHALL', 'P.OIL', 'KEROSENE', 'TOTAL SALE AMOUNT']),
    h1?.cells.map(text).join(' | '),
  );
  check('BRA spans FREE and COST', /<td colspan="2">BRA<\/td>/.test(h1?.raw ?? ''));
  check('the second heading row carries FREE and COST only', same(h2?.cells, ['', '', 'FREE', 'COST', '', '', '', '', '', '']));

  check('one row for every day of August', days.length === 31);
  check('...in date order', days.every((r, i) => r.cells[1] === `${String(i + 1).padStart(2, '0')}/08/2026` && r.cells[0] === String(i + 1)));
  const byDate = Object.fromEntries(days.map((r) => [r.cells[1], r.cells]));
  for (const [date, want] of Object.entries(PDF_ROWS)) {
    check(`${date} prints the sheet’s row`, same(byDate[date], want), (byDate[date] ?? []).join(' | '));
  }
  check('a day with no sales prints only its 0.00 amount', same(byDate['01/08/2026'], ['1', '01/08/2026', '', '', '', '', '', '', '', '0.00']));
  check('wheat has no column and no price, so it moves nothing', same(byDate['06/08/2026'], PDF_ROWS['06/08/2026']));
  check('the TOTAL row is the sheet’s, next serial number included', same(total?.cells, PDF_TOTAL), (total?.cells ?? []).join(' | '));

  check('rows to the 15th are 12.1pt, as the sheet’s are', days.slice(0, 15).every((r) => r.cls.includes('s')));
  check('...and 12.7pt after, TOTAL included', days.slice(15).every((r) => r.cls.includes('m')) && total?.cls.includes('m'));

  const widths = [...html.matchAll(/<col style="width:([\d.]+)pt">/g)].map((m) => Number(m[1]));
  let x = PDF_RULES[0];
  const rules = [x, ...widths.map((w) => +(x += w).toFixed(1))];
  check('the column rules fall where the PDF draws them', same(rules, PDF_RULES), rules.join(' '));
  check('it prints on its own A4-portrait page, with the PDF’s left and top margins',
    html.includes('@page c29-sales{size:A4 portrait;margin:121.9pt 53.6pt 36pt 90.4pt}') && html.includes('.c29s{page:c29-sales;'));
  check('in the PDF’s type sizes', ['12.56pt', '10.99pt', '9.42pt', '8.63pt'].every((s) => html.includes(s)));
  check('none of the old layout is left: no REMITTED, no QTY column, no signature line',
    !/REMIT|QTY|SIGNATURE|c29-tbl/.test(html));

  const meta = engine.sectionsFor(29).find((s) => s.id === 'sales_report');
  check('the Statements card no longer promises remittance', !!meta && !/remit/i.test(meta.desc), meta?.desc);
  check('...and the section is otherwise as it was', meta?.label === 'Sales Report' && meta?.copies === 1);
}

console.log('\nOther months');
{
  const r = (s) => row(s);
  const store = {
    '29_2026-09-30': { a: { BRA: r(5000), RRA: r(600), SUGAR: r(1000) }, b: {}, __projection: { source: 'monthly', at: 'x' }, freeRice: 5600, costRice: 4000 },
    '29_2026-10-05': { a: { BRA: r(100) }, b: {} },
  };
  const engine = engineFor(store);

  const sep = rowsOf(engine.buildSection('sales_report', engine.getData(29, 9, 2026)));
  const sepDays = sep.filter((x) => x.cls.includes('g') && !x.cls.some((c) => c === 'h1' || c === 'h2' || c === 'tot'));
  check('the title follows the month chosen', sep.filter((x) => x.cls.includes('t'))[2]?.cells[0] === "SALES REPORT - DATE WISE - SEP'26");
  check('September has 30 rows', sepDays.length === 30);
  check('...and its TOTAL row is serial 31', sep.find((x) => x.cls.includes('tot'))?.cells[0] === '31');
  check('a month keyed by month prints on its last day, Cost Rice included',
    same(sepDays[29]?.cells, ['30', '30/09/2026', '5000.00', '4000.00', '600.00', '1000.00', '', '', '', '25000.00']), sepDays[29]?.cells.join(' | '));

  const oct = rowsOf(engine.buildSection('sales_report', engine.getData(29, 10, 2026)));
  const oct5 = oct.find((x) => x.cells[1] === '05/10/2026');
  check('a sheet saved before Cost Rice existed leaves COST blank', same(oct5?.cells, ['5', '05/10/2026', '100.00', '', '', '', '', '', '', '0.00']), oct5?.cells.join(' | '));

  const feb = rowsOf(engine.buildSection('sales_report', engine.getData(29, 2, 2028)));
  check('a leap February has 29 rows', feb.filter((x) => x.cls.includes('s') || (x.cls.includes('m') && !x.cls.includes('tot'))).length === 29);
  check("...titled FEB'28", feb.filter((x) => x.cls.includes('t'))[2]?.cells[0] === "SALES REPORT - DATE WISE - FEB'28");
}

console.log(`\n${failures ? `${failures} FAILED` : 'CRS 29 SALES REPORT OK'}`);
if (failures) process.exitCode = 1;
