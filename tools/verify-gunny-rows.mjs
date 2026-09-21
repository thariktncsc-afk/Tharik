/**
 * The Gunny Stock statement's rows and cells — as executable cases.
 *
 *   node tools/verify-gunny-rows.mjs
 *
 * Two things the office asked for (2026-09-20):
 *
 *   A fourth row of eleven empty cells printed under the three varieties on
 *   every statement — a spare ruled line carried over from the paper form.
 *   It is gone; the three varieties remain, a variety with no figures keeping
 *   its row with its cells empty, because a stock statement that leaves a
 *   variety out reads as if none was ever held.
 *
 *   50KG SS was written into the GUNNY WITH GRAINS sub-column while POLY and
 *   C. BOX went into EMPTY GUNNY, so the figures sat in different cells down
 *   the sheet and read as scattered. Every variety's figures now go in the
 *   EMPTY GUNNY sub-column of its group — which is also where the Receipt
 *   statement's own gunny report puts them, so the two sheets agree.
 *
 * What must NOT change: which figure belongs to which variety and stage. Each
 * case below states the whole table, cell by cell, so a figure that moved to
 * another variety, another stage or another row would fail here.
 *
 * Rendered through the real statement engine, so this is the sheet a shop
 * would be handed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { createStatementEngine } = await import('file://' + join(root, 'src', 'generated', 'statements-legacy.js'));

let failures = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
};

const shopsTs = readFileSync(join(root, 'src', 'lib', 'engine', 'shops.ts'), 'utf8');
const CRS_NAMES = {};
for (const m of shopsTs.matchAll(/^\s*(\d+):\s*'([^']+)',\s*$/gm)) CRS_NAMES[Number(m[1])] = m[2];
const CRS_LIST = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: CRS_NAMES[i + 1] }));

const CRS = 7;
const KEY = `${CRS}_6_2026`;
const PREV_KEY = `${CRS}_5_2026`;

/**
 * A month, with whatever of it matters here: the Gunny Stock table, the
 * previous month's table (a carried Opening comes from its Closing), the
 * published month (whose sales bag counts are a receipt's last source) and a
 * Sales Close.
 */
function engineFor({ gunny = {}, prev = null, monthly = null, salesClose = null } = {}) {
  const meGunnyStore = { [KEY]: gunny };
  if (prev) meGunnyStore[PREV_KEY] = prev;
  return createStatementEngine({
    stores: {
      entryStore: {},
      inspectionStore: {},
      monthlyStore: monthly ? { [KEY]: monthly } : {},
      meManualStore: {},
      meSourceStore: {},
      meRemitStore: {},
      meGunnyStore,
      meCardStore: {},
      salesCloseStore: salesClose ? { [KEY]: salesClose } : {},
      receiptStore: [],
      meAllotStore: {},
      meCardConfirmed: {},
      meAdvanceStore: {},
    },
    users: [],
    CRS_LIST,
    CRS_MASTER: [],
    APP_CONFIG: {},
    CRS_ACCOUNTS: {},
    currentUser: null,
  });
}

/** The figures the statements are built from, per item. */
function resolved(opts) {
  const e = engineFor(opts);
  return e.getData(CRS, 6, 2026).gunny;
}

/** A month whose Gunny Stock table holds exactly these figures. */
function render(gunny) {
  const e = engineFor({ gunny });
  return e.buildSection('gunny', e.getData(CRS, 6, 2026));
}

/** A published month with these bag counts on its sales rows. */
const bagSales = (counts) => ({ a: Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, { g_sales: n }])), b: {} });

/** The statement's body rows, each as [variety, ...ten sub-cells]. */
function table(html) {
  const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  return (body.match(/<tr>[\s\S]*?<\/tr>/g) ?? []).map((r) =>
    (r.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? []).map((c) => c.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()),
  );
}

/** The five EMPTY GUNNY cells of a row (OB, Receipt, Total, Issues, Closing) — where every figure belongs. */
const figures = (row) => [row[2], row[4], row[6], row[8], row[10]];
/** The five GUNNY WITH GRAINS cells, which stay blank. */
const withGrains = (row) => [row[1], row[3], row[5], row[7], row[9]];

// As the Gunny Stock table stores them (monthly-entry/lib.ts GunnyRec): the
// KEYED figures only — Opening, Issues and the office's imported Receipt.
// `receipt`, `total` and `closing` are derived copies and are deliberately not
// set here, because nothing may read them (see "Where each figure comes from").
const ss = { opening: 31, receiptImported: 289, issues: 0 };
const poly = { opening: 0, receiptImported: 22, issues: 22 };
const cbox = { opening: 0, receiptImported: 78, issues: 78 };

console.log('\nThree varieties, and no spare line');
{
  const rows = table(render({ ss50: ss, poly, cbox }));
  check('exactly three rows — the fourth empty one is gone', rows.length === 3, JSON.stringify(rows.map((r) => r[0])));
  check('…50KG SS, POLY, C. BOX, in that order', rows.map((r) => r[0]).join('|') === '50KG SS|POLY|C. BOX');
  check('no row is entirely empty', !rows.some((r) => r.every((c) => c === '')));
  check('every row has the full eleven cells', rows.every((r) => r.length === 11), JSON.stringify(rows.map((r) => r.length)));
}

console.log('\nEvery figure in its own row, its own stage, in EMPTY GUNNY');
{
  const rows = table(render({ ss50: ss, poly, cbox }));
  check('50KG SS: 31 / 289 / 320 / (issues blank) / 320', JSON.stringify(figures(rows[0])) === JSON.stringify(['31', '289', '320', '', '320']), JSON.stringify(figures(rows[0])));
  check('POLY: (opening blank) / 22 / 22 / 22 / 0', JSON.stringify(figures(rows[1])) === JSON.stringify(['', '22', '22', '22', '0']), JSON.stringify(figures(rows[1])));
  check('C. BOX: (opening blank) / 78 / 78 / 78 / 0', JSON.stringify(figures(rows[2])) === JSON.stringify(['', '78', '78', '78', '0']), JSON.stringify(figures(rows[2])));
  check('the GUNNY WITH GRAINS sub-columns are left blank throughout', rows.every((r) => withGrains(r).every((c) => c === '')), JSON.stringify(rows.map(withGrains)));
  check('50KG SS’s figures sit in the same column as POLY’s and C. BOX’s',
    figures(rows[0]).filter((c) => c !== '').length === 4 && withGrains(rows[0]).every((c) => c === ''));
  check('a closing balance of zero is still printed as 0, not left blank', rows[1][10] === '0' && rows[2][10] === '0');
  check('an issues of zero stays blank, as it always did', rows[0][8] === '');
}

console.log('\nOne variety, two varieties, three');
{
  const none = { opening: 0, receiptImported: 0, issues: 0 };
  const one = table(render({ ss50: ss, poly: none, cbox: none }));
  check('only 50KG SS has figures → still three rows', one.length === 3);
  check('…50KG SS carries them', JSON.stringify(figures(one[0])) === JSON.stringify(['31', '289', '320', '', '320']));
  check('…and the other two show empty cells, not invented figures', figures(one[1]).join('') === '0' && figures(one[2]).join('') === '0', JSON.stringify([figures(one[1]), figures(one[2])]));

  const two = table(render({ ss50: ss, poly, cbox: none }));
  check('two varieties with figures → still three rows, no blank row', two.length === 3 && !two.some((r) => r.every((c) => c === '')));
  check('…each variety keeps its own figures', figures(two[0])[1] === '289' && figures(two[1])[1] === '22' && figures(two[2])[1] === '');

  const empty = table(render({ ss50: none, poly: none, cbox: none }));
  check('nothing recorded at all → three named rows, no spare line', empty.length === 3 && empty.map((r) => r[0]).join('|') === '50KG SS|POLY|C. BOX');
  check('…and no figure invented anywhere but the zero closings', empty.every((r) => figures(r).slice(0, 4).every((c) => c === '')));
}

console.log('\nThe figures are the ones Gunny Stock Management shows');
{
  // CRS 19, September 2026, as it actually stood: the stored row was last
  // written on 11 Sep with Receipt 10, while the screen showed 205 / 14 / 57
  // worked out from the month's sales bags. The statement printed the stale 10
  // and nothing at all for POLY and C. BOX.
  const stale = { ss50: { opening: 291, openingAuto: false, receipt: 10, total: 301, closing: 301 } };
  const month = bagSales({ BRA: 106, PHH_FRK: 58, AAY_FRK: 14, TOOR: 10, WHEAT: 17, SUGAR: 14, PALM: 52, OOTY: 5 });
  const g = resolved({ gunny: stale, monthly: month });
  check('50KG SS: Opening 291 kept, Receipt 205 recomputed, Total 496, Closing 496',
    JSON.stringify([g.ss50.ob, g.ss50.rec, g.ss50.tot, g.ss50.cb]) === JSON.stringify([291, 205, 496, 496]), JSON.stringify(g.ss50));
  check('POLY: 14 from the month’s sugar and salt bags', g.poly.rec === 14 && g.poly.tot === 14 && g.poly.cb === 14, JSON.stringify(g.poly));
  check('C. BOX: 57 from the palm and OOTY boxes', g.cbox.rec === 57 && g.cbox.tot === 57 && g.cbox.cb === 57, JSON.stringify(g.cbox));
  check('the stale stored Receipt of 10 is not printed anywhere', g.ss50.rec !== 10 && g.ss50.tot !== 301);
  check('…nor its stored Total or Closing of 301', g.ss50.cb === 496);
}

console.log('\nWhere each figure comes from');
{
  const month = bagSales({ BRA: 100, SUGAR: 7, PALM: 3 });

  // Opening: keyed, else carried from last month's closing, else nothing.
  check('a keyed Opening is used as keyed', resolved({ gunny: { ss50: { opening: 250 } }, monthly: month }).ss50.ob === 250);
  check('no Opening this month → last month’s Closing is carried',
    resolved({ gunny: {}, prev: { ss50: { closing: 180 } }, monthly: month }).ss50.ob === 180);
  check('…and this month’s own figure still wins over the carry',
    resolved({ gunny: { ss50: { opening: 250 } }, prev: { ss50: { closing: 180 } }, monthly: month }).ss50.ob === 250);
  check('nothing either side → Opening 0', resolved({ gunny: {}, monthly: month }).ss50.ob === 0);
  check('a keyed Opening of 0 is respected, not treated as missing',
    resolved({ gunny: { ss50: { opening: 0 } }, prev: { ss50: { closing: 180 } }, monthly: month }).ss50.ob === 0);

  // Receipt: imported → Sales Close → the month's own sales bags.
  check('the office’s imported Receipt wins over everything',
    resolved({ gunny: { ss50: { receiptImported: 42 } }, monthly: month, salesClose: { date: '2026-06-20', gunny: 99, poly: 9, cbox: 9 } }).ss50.rec === 42);
  check('…else the month’s Sales Close totals',
    resolved({ gunny: {}, monthly: month, salesClose: { date: '2026-06-20', gunny: 99, poly: 9, cbox: 9 } }).ss50.rec === 99);
  check('…else the month’s own sales bags', resolved({ gunny: {}, monthly: month }).ss50.rec === 100);
  check('each pack type reads its own commodities',
    resolved({ gunny: {}, monthly: month }).poly.rec === 7 && resolved({ gunny: {}, monthly: month }).cbox.rec === 3);

  // Issues are keyed, and the arithmetic follows.
  const withIssues = resolved({ gunny: { ss50: { opening: 300, issues: 120 } }, monthly: month }).ss50;
  check('Issues are taken as keyed', withIssues.iss === 120);
  check('Total = Opening + Receipt, Closing = Total − Issues', withIssues.tot === 400 && withIssues.cb === 280, JSON.stringify(withIssues));
  check('a stored Total and Closing are never trusted over the arithmetic',
    resolved({ gunny: { ss50: { opening: 10, total: 9999, closing: 9999 } }, monthly: month }).ss50.tot === 110);
}

console.log('\nThe sheet itself is unchanged');
{
  const html = render({ ss50: ss, poly, cbox });
  check('title, shop and month line', /TAMIL NADU CIVIL SUPPLIES CORPORATION - MADURAI REGION/.test(html) && /GUNNY STOCK STATEMENT FOR THE MONTH OF JUNE'2026/.test(html));
  check('both sub-headings are still printed', (html.match(/GUNNY<br>WITH GRAINS/g) ?? []).length === 5 && (html.match(/EMPTY<br>GUNNY/g) ?? []).length === 5);
  check('the five stage headings are still printed', ['OPENING', 'RECEIPT', 'TOTAL', 'ISSUES', 'CLOSING'].every((h) => html.includes(h)));
  // This fixture's shop has no staff, so no BILL CLERK label is printed —
  // never an empty one (43-staff-posts.js; verify:staff-posts has the rest).
  check('the signature line is still there, with no empty staff label', /class="gy-sig"/.test(html) && /AREA SUPERVISOR/.test(html) && !/BILL CLERKs*:s*</.test(html));
  check('the column widths are unchanged (11 columns across the page)', (html.match(/<col\b/g) ?? []).length === 11);
}

console.log(failures ? `\n${failures} FAILED` : '\nGUNNY ROWS OK');
process.exitCode = failures ? 1 : 0;
