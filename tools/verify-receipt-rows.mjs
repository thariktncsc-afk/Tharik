/**
 * The Receipt statement's rows follow the receipts — as executable cases.
 *
 *   node tools/verify-receipt-rows.mjs
 *
 * The sheet reproduces a paper form with ten ruled lines: seven, a TOTAL,
 * three more, a second TOTAL. The builder used to emit all ten whether or not
 * there was anything to put on them, so a month with two receipts printed two
 * rows and eight empty ones, a month with none printed ten empty rows under
 * the headings — and an ELEVENTH receipt was not printed at all, because the
 * second block was capped at the three lines the paper had.
 *
 * Now the lines follow the entries: one row per receipt, a batch's TOTAL only
 * when that batch has rows, nothing but the headings when the month has no
 * receipts, and every receipt printed however many there are.
 *
 * Each case is rendered through the REAL statement engine
 * (src/generated/statements-legacy.js) from a made-up month, so what is
 * checked is what a shop would actually be handed.
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
const MONTH = 6;
const YEAR = 2026;

/** A month with exactly `n` receipts recorded for CRS 7. */
const receipts = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    crsId: CRS,
    date: `${YEAR}-0${MONTH}-${String(i + 1).padStart(2, '0')}`,
    receiptNo: `R/${YEAR}/${String(i + 1).padStart(3, '0')}`,
    items: { BRA: { qty: 1000 + i }, SUGAR: { qty: 50 } },
    type: 'regular',
  }));

/** The Receipt statement for a month holding `n` receipts. */
function render(n) {
  const engine = createStatementEngine({
    stores: {
      entryStore: {},
      inspectionStore: {},
      monthlyStore: {},
      meManualStore: {},
      meSourceStore: {},
      meRemitStore: {},
      meGunnyStore: {},
      meCardStore: {},
      salesCloseStore: {},
      receiptStore: receipts(n),
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
  return engine.buildSection('receipt', engine.getData(CRS, MONTH, YEAR));
}

/** Rows of the receipt table itself — the gunny report below it is separate. */
function rowsOf(html) {
  const table = html.slice(html.indexOf('<table class="rcp-table"'), html.indexOf('</table>'));
  const body = table.slice(table.indexOf('<tbody>'), table.indexOf('</tbody>'));
  const rows = body.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  const totals = rows.filter((r) => r.includes('>TOTAL<'));
  const data = rows.filter((r) => !r.includes('>TOTAL<'));
  const empty = data.filter((r) => !/<td[^>]*>[^<\s][\s\S]*?<\/td>/.test(r.replace(/<td[^>]*><\/td>/g, '')));
  return { all: rows.length, data: data.length, totals: totals.length, empty: empty.length, rows: data };
}

console.log('\nThe rows follow the receipts');
{
  const none = rowsOf(render(0));
  check('no receipts → no data rows at all', none.data === 0, JSON.stringify(none));
  check('…and no TOTAL row standing over nothing', none.totals === 0);
  check('…the headings are still there', /RECEIPT DETAILS FOR THE MONTH OF/.test(render(0)) && /DATE OF ISSUE/.test(render(0)));

  for (const n of [1, 2, 4, 7]) {
    const r = rowsOf(render(n));
    check(`${n} receipt${n === 1 ? '' : 's'} → exactly ${n} data row${n === 1 ? '' : 's'}`, r.data === n, JSON.stringify(r));
    check(`…with one TOTAL beneath them`, r.totals === 1, JSON.stringify(r));
  }
  check('never a reserved blank line under the entries', [0, 1, 2, 4, 7].every((n) => rowsOf(render(n)).empty === 0));
}

console.log('\nMore than the paper form had room for');
{
  const eight = rowsOf(render(8));
  check('8 receipts → 8 rows, in two blocks with a TOTAL each', eight.data === 8 && eight.totals === 2, JSON.stringify(eight));
  const ten = rowsOf(render(10));
  check('10 receipts → 10 rows', ten.data === 10, JSON.stringify(ten));
  const twelve = rowsOf(render(12));
  check('12 receipts → all 12 printed (the 11th used to be dropped)', twelve.data === 12, JSON.stringify(twelve));
  const many = rowsOf(render(25));
  check('25 receipts → all 25 printed', many.data === 25, JSON.stringify(many));
}

console.log('\nEvery saved receipt is on the sheet, unchanged');
{
  const n = 5;
  const html = render(n);
  const { rows } = rowsOf(html);
  check(`all ${n} receipt numbers appear`, receipts(n).every((r) => html.includes(r.receiptNo)), '');
  check('…each on its own row, in order', rows.every((row, i) => row.includes(receipts(n)[i].receiptNo)));
  check('…numbered 1..n down the sheet', rows.every((row, i) => new RegExp(`<td class="sl-col">${i + 1}</td>`).test(row)), rows[0]?.slice(0, 80));
  check('…carrying their quantities', rows.every((row, i) => row.includes(String(1000 + i))), '');
  const total = html.match(/<tr><td class="sl-col total-row">[\s\S]*?<\/tr>/)?.[0] ?? '';
  const sum = receipts(n).reduce((t, r) => t + r.items.BRA.qty, 0);
  check(`the TOTAL still adds them up (${sum})`, total.includes(String(sum)), total.slice(0, 120));
}

console.log('\nThe rest of the statement is untouched');
{
  const html = render(3);
  check('the gunny report below it is still there', /GUNNY REPORT FOR THE MONTH OF/.test(html) && /50KG SS/.test(html));
  check('the title, month and shop line are unchanged', /TAMIL NADU CIVIL SUPPLIES CORPORATION/.test(html) && /CRS 7/.test(html));
  check('the commodity headings are unchanged', /NPHH FRK RRA/.test(html) && /SALT\(RFFS\)/.test(html) && /PJ 100/.test(html));
  check('the signature line is unchanged', /BILL CLERK|PACKER/i.test(html));
  check('the sheet is still laid out landscape-wide (37 columns)',
    (html.match(/<col\b/g) ?? []).length === 0 && (rowsOf(html).rows[0].match(/<td/g) ?? []).length === 37,
    String((rowsOf(html).rows[0].match(/<td/g) ?? []).length));
}

console.log(failures ? `\n${failures} FAILED` : '\nRECEIPT ROWS OK');
process.exitCode = failures ? 1 : 0;
